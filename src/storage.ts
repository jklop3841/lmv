import { promises as fs } from "node:fs";
import path from "node:path";
import { applyPatch } from "fast-json-patch";
import { canonicalJson, sha256Hex } from "./canonical";
import { decryptEnvelope, encryptEnvelope } from "./crypto";
import {
  ConflictError,
  PatchApplyError,
  SchemaValidationError,
  StorageCorruptionError
} from "./errors";
import {
  blocksSchema,
  type JsonPatchInput,
  jsonPatchSchema,
  ledgerEntrySchema,
  metaSchema,
  memorySchema,
  vaultSnapshotSchema
} from "./schema";
import { SCHEMA_VERSION, UID } from "./types";
import type { Operation } from "fast-json-patch";
import type {
  AADContext,
  CurrentState,
  LedgerEntryPlain,
  LmvMeta,
  MemoryState,
  VaultSnapshotPlain
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseIfMatch(ifMatch: string): number | null {
  const m = /^"v(\d+)"$/.exec(ifMatch.trim());
  if (!m) {
    return null;
  }
  return Number.parseInt(m[1], 10);
}

function etagForVersion(version: number): string {
  return `"v${version}"`;
}

function emptyMemory(): MemoryState {
  return {
    version: 0,
    blocks: {
      identity: {},
      methodology: {},
      projects: {},
      rules: {}
    },
    updated_at: nowIso()
  };
}

interface PatchInput {
  ifMatchHeader: string;
  patch: JsonPatchInput;
  actor: string;
  reason: string;
  auth: "none" | "token";
}

export class LMVStorage {
  private readonly vaultPath: string;
  private readonly ledgerPath: string;
  private readonly metaPath: string;
  private readonly passphrase: string;
  private lock: Promise<void> = Promise.resolve();

  constructor(dataDir: string, passphrase: string) {
    if (!passphrase) {
      throw new Error("LMV_PASSPHRASE is required");
    }
    this.passphrase = passphrase;
    this.vaultPath = path.join(dataDir, "vault.enc");
    this.ledgerPath = path.join(dataDir, "ledger.jsonl.enc");
    this.metaPath = path.join(dataDir, "meta.json");
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prior = this.lock;
    let release = () => {};
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async ensureDataFiles(): Promise<void> {
    await fs.mkdir(path.dirname(this.vaultPath), { recursive: true });
    const vaultExists = await fs
      .access(this.vaultPath)
      .then(() => true)
      .catch(() => false);
    if (!vaultExists) {
      const snapshot: VaultSnapshotPlain = {
        uid: UID,
        schema_version: SCHEMA_VERSION,
        memory: emptyMemory(),
        snapshot_cursor: 0,
        updated_at: nowIso()
      };
      await this.writeVault(snapshot);
    }

    const ledgerExists = await fs
      .access(this.ledgerPath)
      .then(() => true)
      .catch(() => false);
    if (!ledgerExists) {
      await fs.writeFile(this.ledgerPath, "", "utf8");
    }
    await this.ensureMetaFile();
  }

  private defaultMeta(): LmvMeta {
    return {
      schema_version: 1,
      kdf: {
        name: "scrypt",
        N: 32768,
        r: 8,
        p: 1,
        keylen: 32
      },
      hkdf: {
        name: "hkdf-sha256",
        infos: ["vault", "ledger"]
      },
      envelope_version: 1,
      updated_at: nowIso()
    };
  }

  private async ensureMetaFile(): Promise<void> {
    const exists = await fs
      .access(this.metaPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      await this.writeMeta(this.defaultMeta());
    }
  }

  public async readMeta(): Promise<LmvMeta> {
    await this.ensureDataFiles();
    const raw = await fs.readFile(this.metaPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new StorageCorruptionError("meta.json is not valid JSON");
    }
    const validated = metaSchema.safeParse(parsed);
    if (!validated.success) {
      throw new StorageCorruptionError("meta.json schema mismatch", validated.error.flatten());
    }
    return validated.data as LmvMeta;
  }

  public async writeMeta(meta: LmvMeta): Promise<void> {
    const validated = metaSchema.safeParse(meta);
    if (!validated.success) {
      throw new SchemaValidationError("Invalid meta.json schema", validated.error.flatten());
    }
    await fs.writeFile(this.metaPath, JSON.stringify(validated.data, null, 2), "utf8");
  }

  private vaultAAD(snapshot: VaultSnapshotPlain): AADContext {
    return {
      record_type: "vault",
      uid: snapshot.uid,
      schema_version: snapshot.schema_version,
      vault_version: snapshot.memory.version
    };
  }

  private ledgerAAD(entry: LedgerEntryPlain): AADContext {
    return {
      record_type: "ledger_entry",
      uid: UID,
      schema_version: SCHEMA_VERSION,
      entry_cursor: entry.cursor
    };
  }

  private async readVault(): Promise<VaultSnapshotPlain> {
    const raw = await fs.readFile(this.vaultPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new StorageCorruptionError("vault.enc is not valid JSON");
    }
    const decrypted = await decryptEnvelope(parsed, this.passphrase, "vault");
    const validated = vaultSnapshotSchema.safeParse(decrypted.payload);
    if (!validated.success) {
      throw new StorageCorruptionError("Vault payload schema mismatch", validated.error.flatten());
    }
    const snapshot = validated.data as VaultSnapshotPlain;
    const expectedAAD = this.vaultAAD(snapshot);
    if (JSON.stringify(expectedAAD) !== JSON.stringify(decrypted.aad)) {
      throw new StorageCorruptionError("Vault AAD context mismatch");
    }
    return snapshot;
  }

  private async writeVault(snapshot: VaultSnapshotPlain): Promise<void> {
    const validated = vaultSnapshotSchema.safeParse(snapshot);
    if (!validated.success) {
      throw new SchemaValidationError("Invalid vault snapshot schema", validated.error.flatten());
    }
    const envelope = await encryptEnvelope(
      validated.data,
      this.passphrase,
      "vault",
      this.vaultAAD(validated.data)
    );
    await fs.writeFile(this.vaultPath, JSON.stringify(envelope), "utf8");
  }

  private computeEntryHash(entry: Omit<LedgerEntryPlain, "entry_hash">): string {
    return sha256Hex(canonicalJson(entry));
  }

  private async readLedgerEntries(): Promise<LedgerEntryPlain[]> {
    const raw = await fs.readFile(this.ledgerPath, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const entries: LedgerEntryPlain[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      try {
        const envelopeRaw = JSON.parse(line);
        const decrypted = await decryptEnvelope(envelopeRaw, this.passphrase, "ledger");
        const validated = ledgerEntrySchema.safeParse(decrypted.payload);
        if (!validated.success) {
          throw new StorageCorruptionError("Ledger entry schema mismatch", validated.error.flatten());
        }
        const entry = validated.data as LedgerEntryPlain;
        const expectedAAD = this.ledgerAAD(entry);
        if (JSON.stringify(expectedAAD) !== JSON.stringify(decrypted.aad)) {
          throw new StorageCorruptionError("Ledger AAD context mismatch", { cursor: entry.cursor });
        }
        entries.push(entry);
      } catch (error) {
        if (i === lines.length - 1) {
          break;
        }
        if (error instanceof StorageCorruptionError) {
          throw error;
        }
        throw new StorageCorruptionError("Failed to parse/decrypt ledger entry", {
          line: i + 1,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    let previousHash = "";
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const expectedCursor = i + 1;
      if (entry.cursor !== expectedCursor) {
        throw new StorageCorruptionError("Ledger cursor is not contiguous", {
          expected: expectedCursor,
          found: entry.cursor
        });
      }
      if (entry.prev_hash !== previousHash) {
        throw new StorageCorruptionError("Ledger hash chain broken at prev_hash", { cursor: entry.cursor });
      }
      const hashInput: Omit<LedgerEntryPlain, "entry_hash"> = {
        cursor: entry.cursor,
        ts: entry.ts,
        actor: entry.actor,
        base_version: entry.base_version,
        new_version: entry.new_version,
        reason: entry.reason,
        patch: entry.patch,
        prev_hash: entry.prev_hash
      };
      if (entry.auth) {
        hashInput.auth = entry.auth;
      }
      const recomputed = this.computeEntryHash(hashInput);
      if (recomputed !== entry.entry_hash) {
        throw new StorageCorruptionError("Ledger hash chain broken at entry_hash", { cursor: entry.cursor });
      }
      previousHash = entry.entry_hash;
    }

    return entries;
  }

  private replayLedger(snapshot: VaultSnapshotPlain, entries: LedgerEntryPlain[]): CurrentState {
    if (snapshot.snapshot_cursor > entries.length) {
      throw new StorageCorruptionError("snapshot_cursor is ahead of ledger");
    }
    const memory = clone(snapshot.memory);
    for (const entry of entries) {
      if (entry.cursor <= snapshot.snapshot_cursor) {
        continue;
      }
      if (entry.base_version !== memory.version) {
        throw new StorageCorruptionError("Ledger base_version mismatch", {
          cursor: entry.cursor,
          expected: memory.version,
          found: entry.base_version
        });
      }
      const result = applyPatch(clone(memory.blocks), entry.patch, true, false);
      memory.blocks = result.newDocument as MemoryState["blocks"];
      memory.version = entry.new_version;
      memory.updated_at = entry.ts;
      const validatedMemory = memorySchema.safeParse(memory);
      if (!validatedMemory.success) {
        throw new StorageCorruptionError("Memory invalid after ledger replay", {
          cursor: entry.cursor,
          issues: validatedMemory.error.flatten()
        });
      }
      memory.blocks = validatedMemory.data.blocks;
    }
    return {
      memory,
      snapshot_cursor: snapshot.snapshot_cursor,
      ledger_cursor: entries.length
    };
  }

  private assertPatchAllowed(patch: JsonPatchInput): void {
    for (const op of patch) {
      if (op.path === "/version" || op.path === "/updated_at") {
        throw new PatchApplyError("Patch cannot modify /version or /updated_at");
      }
    }
  }

  private async appendLedgerEntry(entry: LedgerEntryPlain): Promise<void> {
    const envelope = await encryptEnvelope(entry, this.passphrase, "ledger", this.ledgerAAD(entry));
    const handle = await fs.open(this.ledgerPath, "a");
    try {
      await handle.write(`${JSON.stringify(envelope)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  public async initialize(): Promise<void> {
    await this.withLock(async () => {
      await this.ensureDataFiles();
    });
  }

  public async getCurrentState(): Promise<CurrentState> {
    await this.ensureDataFiles();
    const snapshot = await this.readVault();
    const entries = await this.readLedgerEntries();
    return this.replayLedger(snapshot, entries);
  }

  public async patchMemory(input: PatchInput): Promise<{
    state: CurrentState;
    applied_entry_cursor: number;
  }> {
    const parsedPatch = jsonPatchSchema.safeParse(input.patch);
    if (!parsedPatch.success) {
      throw new SchemaValidationError("Invalid JSON Patch schema", parsedPatch.error.flatten());
    }

    this.assertPatchAllowed(parsedPatch.data);
    const baseVersion = parseIfMatch(input.ifMatchHeader);
    if (baseVersion === null) {
      throw new SchemaValidationError('Invalid If-Match. Expected format: "v{n}"');
    }

    return this.withLock(async () => {
      await this.ensureDataFiles();
      const snapshot = await this.readVault();
      const entries = await this.readLedgerEntries();
      const current = this.replayLedger(snapshot, entries);
      const currentETag = etagForVersion(current.memory.version);
      if (baseVersion !== current.memory.version) {
        throw new ConflictError("Version conflict", currentETag);
      }

      let patchedBlocks: MemoryState["blocks"];
      try {
        const patchResult = applyPatch(
          clone(current.memory.blocks),
          parsedPatch.data as Operation[],
          true,
          false
        );
        patchedBlocks = patchResult.newDocument as MemoryState["blocks"];
      } catch (error) {
        throw new PatchApplyError("Patch application failed", {
          reason: error instanceof Error ? error.message : String(error)
        });
      }

      const validatedBlocks = blocksSchema.safeParse(patchedBlocks);
      if (!validatedBlocks.success) {
        throw new PatchApplyError("Patch result violates blocks schema", validatedBlocks.error.flatten());
      }

      const cursor = entries.length + 1;
      const prevHash = entries.length > 0 ? entries[entries.length - 1].entry_hash : "";
      const entryBase = {
        cursor,
        ts: nowIso(),
        actor: input.actor,
        base_version: current.memory.version,
        new_version: current.memory.version + 1,
        reason: input.reason,
        auth: input.auth,
        patch: parsedPatch.data as Operation[],
        prev_hash: prevHash
      };
      const entryHash = this.computeEntryHash(entryBase);
      const entry: LedgerEntryPlain = {
        ...entryBase,
        entry_hash: entryHash
      };
      await this.appendLedgerEntry(entry);

      const nextMemory: MemoryState = {
        version: entry.new_version,
        blocks: validatedBlocks.data as MemoryState["blocks"],
        updated_at: entry.ts
      };

      return {
        state: {
          memory: nextMemory,
          snapshot_cursor: snapshot.snapshot_cursor,
          ledger_cursor: cursor
        },
        applied_entry_cursor: cursor
      };
    });
  }

  public async getLedger(since: number, limit: number): Promise<{
    entries: LedgerEntryPlain[];
    next_cursor: number;
    has_more: boolean;
    snapshot_cursor: number;
    ledger_cursor: number;
  }> {
    await this.ensureDataFiles();
    const snapshot = await this.readVault();
    const entries = await this.readLedgerEntries();
    const normalizedSince = Math.max(0, since);
    const normalizedLimit = Math.max(1, Math.min(limit, 500));
    const filtered = entries.filter((entry) => entry.cursor > normalizedSince);
    const page = filtered.slice(0, normalizedLimit);
    const hasMore = filtered.length > page.length;
    const nextCursor =
      page.length > 0 ? page[page.length - 1].cursor : normalizedSince;

    return {
      entries: page,
      next_cursor: nextCursor,
      has_more: hasMore,
      snapshot_cursor: snapshot.snapshot_cursor,
      ledger_cursor: entries.length
    };
  }

  public async snapshot(): Promise<{
    snapshot_cursor: number;
    ledger_cursor: number;
    memory_version: number;
  }> {
    return this.withLock(async () => {
      await this.ensureDataFiles();
      const snapshot = await this.readVault();
      const entries = await this.readLedgerEntries();
      const current = this.replayLedger(snapshot, entries);
      if (current.ledger_cursor <= snapshot.snapshot_cursor) {
        return {
          snapshot_cursor: snapshot.snapshot_cursor,
          ledger_cursor: current.ledger_cursor,
          memory_version: current.memory.version
        };
      }
      const nextSnapshot: VaultSnapshotPlain = {
        uid: UID,
        schema_version: SCHEMA_VERSION,
        memory: current.memory,
        snapshot_cursor: current.ledger_cursor,
        updated_at: nowIso()
      };
      await this.writeVault(nextSnapshot);
      return {
        snapshot_cursor: nextSnapshot.snapshot_cursor,
        ledger_cursor: current.ledger_cursor,
        memory_version: current.memory.version
      };
    });
  }

  public async verifyLedger(): Promise<{ entries: number; ledger_cursor: number }> {
    await this.ensureDataFiles();
    const entries = await this.readLedgerEntries();
    return { entries: entries.length, ledger_cursor: entries.length };
  }

  public async readVaultPlain(): Promise<VaultSnapshotPlain> {
    await this.ensureDataFiles();
    return this.readVault();
  }

  public async readLedgerPlain(): Promise<LedgerEntryPlain[]> {
    await this.ensureDataFiles();
    return this.readLedgerEntries();
  }

  public async rewriteEncryptedData(
    snapshot: VaultSnapshotPlain,
    entries: LedgerEntryPlain[],
    meta: LmvMeta
  ): Promise<void> {
    await this.withLock(async () => {
      await this.ensureDataFiles();
      await this.writeVault(snapshot);
      await fs.writeFile(this.ledgerPath, "", "utf8");
      for (const entry of entries) {
        await this.appendLedgerEntry(entry);
      }
      await this.writeMeta(meta);
    });
  }

  public static etagForVersion(version: number): string {
    return etagForVersion(version);
  }
}
