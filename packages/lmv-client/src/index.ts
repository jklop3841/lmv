import type { Operation } from "fast-json-patch";

export interface MemoryPayload {
  version: number;
  blocks: Record<string, unknown>;
  updated_at: string;
}

export interface GetMemoryResponse {
  etag: string;
  memory: MemoryPayload;
  snapshot_cursor: number;
  ledger_cursor: number;
}

export interface LedgerEntry {
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

export interface PullLedgerResponse {
  entries: LedgerEntry[];
  next_cursor: number;
  has_more: boolean;
  snapshot_cursor: number;
  ledger_cursor: number;
}

export interface PatchResponse {
  etag: string;
  memory: MemoryPayload;
  applied_entry_cursor: number;
  snapshot_cursor: number;
  ledger_cursor: number;
}

export interface SnapshotResponse {
  snapshot_cursor: number;
  ledger_cursor: number;
  memory_version: number;
}

export interface LMVClientOptions {
  baseUrl: string;
  writeToken?: string;
  fetchImpl?: typeof fetch;
}

export class LMVClient {
  private readonly baseUrl: string;
  private readonly writeToken?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LMVClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.writeToken = options.writeToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private authHeaders(): Record<string, string> {
    if (!this.writeToken) {
      return {};
    }
    return { Authorization: `Bearer ${this.writeToken}` };
  }

  private async parseJsonOrThrow<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return (await response.json()) as T;
  }

  async getMemory(): Promise<GetMemoryResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/memory`);
    const body = await this.parseJsonOrThrow<{
      memory: MemoryPayload;
      snapshot_cursor: number;
      ledger_cursor: number;
    }>(response);
    const etag = response.headers.get("etag") ?? "";
    return {
      etag,
      memory: body.memory,
      snapshot_cursor: body.snapshot_cursor,
      ledger_cursor: body.ledger_cursor
    };
  }

  async patch(
    patchOps: Operation[],
    actor: string,
    reason: string,
    etag: string
  ): Promise<PatchResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/memory`, {
      method: "PATCH",
      headers: {
        ...this.authHeaders(),
        "content-type": "application/json-patch+json",
        "if-match": etag,
        "x-lmv-actor": actor,
        "x-lmv-reason": reason
      },
      body: JSON.stringify(patchOps)
    });

    if (response.status === 409) {
      const conflictBody = await response.text();
      const current = response.headers.get("etag") ?? "";
      throw new LMVConflictError("Version conflict", current, conflictBody);
    }

    const body = await this.parseJsonOrThrow<{
      memory: MemoryPayload;
      applied_entry_cursor: number;
      snapshot_cursor: number;
      ledger_cursor: number;
    }>(response);
    return {
      etag: response.headers.get("etag") ?? "",
      memory: body.memory,
      applied_entry_cursor: body.applied_entry_cursor,
      snapshot_cursor: body.snapshot_cursor,
      ledger_cursor: body.ledger_cursor
    };
  }

  async pullLedger(cursor: number, limit = 100): Promise<PullLedgerResponse> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/ledger?since=${encodeURIComponent(String(cursor))}&limit=${encodeURIComponent(
        String(limit)
      )}`
    );
    return this.parseJsonOrThrow<PullLedgerResponse>(response);
  }

  async snapshot(): Promise<SnapshotResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/snapshot`, {
      method: "POST",
      headers: this.authHeaders()
    });
    return this.parseJsonOrThrow<SnapshotResponse>(response);
  }

  async applyWithRetry(
    patchOps: Operation[],
    actor: string,
    reason: string,
    retry = 3
  ): Promise<PatchResponse> {
    let memory = await this.getMemory();
    let lastErr: unknown = null;
    for (let i = 0; i < retry; i += 1) {
      try {
        return await this.patch(patchOps, actor, reason, memory.etag);
      } catch (error) {
        lastErr = error;
        if (!(error instanceof LMVConflictError)) {
          throw error;
        }
        memory = await this.getMemory();
      }
    }
    throw lastErr ?? new Error("applyWithRetry failed");
  }
}

export class LMVConflictError extends Error {
  public readonly currentETag: string;
  public readonly payload: string;

  constructor(message: string, currentETag: string, payload: string) {
    super(message);
    this.currentETag = currentETag;
    this.payload = payload;
  }
}
