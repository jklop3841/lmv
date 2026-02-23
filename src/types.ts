import type { Operation } from "fast-json-patch";

export const SCHEMA_VERSION = 1 as const;
export const UID = "lmv-v1" as const;

export interface MemoryBlocks {
  identity?: unknown;
  methodology?: unknown;
  projects?: unknown;
  rules?: unknown;
  [key: string]: unknown;
}

export interface MemoryState {
  version: number;
  blocks: MemoryBlocks;
  updated_at: string;
}

export interface VaultSnapshotPlain {
  uid: string;
  schema_version: number;
  memory: MemoryState;
  snapshot_cursor: number;
  updated_at: string;
}

export interface LedgerEntryPlain {
  cursor: number;
  ts: string;
  actor: string;
  base_version: number;
  new_version: number;
  reason: string;
  auth?: "none" | "token";
  patch: Operation[];
  prev_hash: string;
  entry_hash: string;
}

export interface EnvelopeV1 {
  v: number;
  kdf: {
    name: "scrypt";
    N: 32768;
    r: 8;
    p: 1;
    keylen: 32;
    salt_b64: string;
  };
  hkdf: {
    name: "hkdf-sha256";
    info: "vault" | "ledger";
  };
  aead: {
    alg: "aes-256-gcm";
    iv_b64: string;
    tag_b64: string;
    aad_b64: string;
  };
  ciphertext_b64: string;
}

export interface AADContext {
  record_type: "vault" | "ledger_entry";
  uid: string;
  schema_version: number;
  vault_version?: number;
  entry_cursor?: number;
}

export interface CurrentState {
  memory: MemoryState;
  snapshot_cursor: number;
  ledger_cursor: number;
}

export interface LmvMeta {
  schema_version: 1;
  kdf: {
    name: "scrypt";
    N: 32768;
    r: 8;
    p: 1;
    keylen: 32;
  };
  hkdf: {
    name: "hkdf-sha256";
    infos: ["vault", "ledger"];
  };
  envelope_version: 1;
  updated_at: string;
}
