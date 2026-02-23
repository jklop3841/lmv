import { applyPatch, type Operation } from "fast-json-patch";

interface MemoryResponse {
  memory: {
    version: number;
    blocks: Record<string, unknown>;
    updated_at: string;
  };
  snapshot_cursor: number;
  ledger_cursor: number;
}

interface LedgerResponse {
  entries: Array<{
    cursor: number;
    base_version: number;
    new_version: number;
    patch: Operation[];
  }>;
  next_cursor: number;
  has_more: boolean;
  snapshot_cursor: number;
  ledger_cursor: number;
}

class AgentClient {
  private readonly baseUrl: string;
  private readonly actor: string;
  private localVersion = 0;
  private localBlocks: Record<string, unknown> = {};
  private ledgerCursor = 0;

  constructor(baseUrl: string, actor: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.actor = actor;
  }

  async syncMemory(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/memory`);
    if (!res.ok) {
      throw new Error(`GET /v1/memory failed: ${res.status}`);
    }
    const body = (await res.json()) as MemoryResponse;
    this.localVersion = body.memory.version;
    this.localBlocks = body.memory.blocks;
    this.ledgerCursor = body.ledger_cursor;
    console.log(`sync memory version=${this.localVersion} ledger_cursor=${this.ledgerCursor}`);
  }

  private async pullLedgerAndReplay(): Promise<void> {
    let hasMore = true;
    while (hasMore) {
      const res = await fetch(`${this.baseUrl}/v1/ledger?since=${this.ledgerCursor}&limit=100`);
      if (!res.ok) {
        throw new Error(`GET /v1/ledger failed: ${res.status}`);
      }
      const body = (await res.json()) as LedgerResponse;
      for (const entry of body.entries) {
        if (entry.base_version !== this.localVersion) {
          throw new Error(
            `local replay version mismatch: expected=${this.localVersion} got=${entry.base_version}`
          );
        }
        const patched = applyPatch(
          JSON.parse(JSON.stringify(this.localBlocks)),
          entry.patch,
          true,
          false
        );
        this.localBlocks = patched.newDocument as Record<string, unknown>;
        this.localVersion = entry.new_version;
      }
      this.ledgerCursor = body.next_cursor;
      hasMore = body.has_more;
    }
    console.log(`replayed to version=${this.localVersion} ledger_cursor=${this.ledgerCursor}`);
  }

  async patchWithConflictHandling(patch: Operation[], reason: string): Promise<void> {
    const tryPatch = async (): Promise<Response> =>
      fetch(`${this.baseUrl}/v1/memory`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json-patch+json",
          "if-match": `"v${this.localVersion}"`,
          "x-lmv-actor": this.actor,
          "x-lmv-reason": reason
        },
        body: JSON.stringify(patch)
      });

    let res = await tryPatch();
    if (res.status === 409) {
      console.log("conflict detected, pull ledger then replay local state...");
      await this.pullLedgerAndReplay();
      res = await tryPatch();
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PATCH failed: ${res.status} ${text}`);
    }

    const body = (await res.json()) as MemoryResponse;
    this.localVersion = body.memory.version;
    this.localBlocks = body.memory.blocks;
    this.ledgerCursor = body.ledger_cursor;
    console.log(`patch success version=${this.localVersion} ledger_cursor=${this.ledgerCursor}`);
  }
}

async function main(): Promise<void> {
  const baseUrl = process.env.LMV_BASE_URL ?? "http://127.0.0.1:8787";
  const client = new AgentClient(baseUrl, "example-agent");
  await client.syncMemory();

  const patch: Operation[] = [
    { op: "add", path: "/projects/demo", value: { status: "active", owner: "example-agent" } }
  ];
  await client.patchWithConflictHandling(patch, "create demo project block");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`agent_client failed: ${message}`);
  process.exit(1);
});
