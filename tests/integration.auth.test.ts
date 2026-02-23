import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "./helpers/spawn";
import { makeTempDataDir, removeTempDataDir } from "./helpers/tmpdir";

const WORKDIR = process.cwd();

async function getMemory(baseUrl: string): Promise<{
  etag: string;
  body: {
    memory: { version: number; blocks: Record<string, unknown>; updated_at: string };
    snapshot_cursor: number;
    ledger_cursor: number;
  };
}> {
  const response = await fetch(`${baseUrl}/v1/memory`);
  assert.equal(response.status, 200);
  const etag = response.headers.get("etag");
  assert.ok(etag);
  const body = (await response.json()) as {
    memory: { version: number; blocks: Record<string, unknown>; updated_at: string };
    snapshot_cursor: number;
    ledger_cursor: number;
  };
  return { etag, body };
}

function patchRequest(
  baseUrl: string,
  etag: string,
  token?: string
): Promise<Response> {
  return fetch(`${baseUrl}/v1/memory`, {
    method: "PATCH",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json-patch+json",
      "if-match": etag,
      "x-lmv-actor": "agent:test@ci",
      "x-lmv-reason": "lmv/test/integration_auth"
    },
    body: JSON.stringify([
      {
        op: "add",
        path: "/projects/integration_auth",
        value: { ok: true, ts: new Date().toISOString() }
      }
    ])
  });
}

test("Mode A: no write token -> patch and snapshot are 200", async () => {
  const dataDir = await makeTempDataDir("lmv-it-a-");
  const server = await startServer({
    workdir: WORKDIR,
    port: 18787,
    dataDir,
    passphrase: "integration-pass-a"
  });

  try {
    const memory = await getMemory(server.baseUrl);
    const patchResponse = await patchRequest(server.baseUrl, memory.etag);
    assert.equal(patchResponse.status, 200);

    const snapshotResponse = await fetch(`${server.baseUrl}/v1/snapshot`, {
      method: "POST"
    });
    assert.equal(snapshotResponse.status, 200);
  } finally {
    await server.stop();
    await removeTempDataDir(dataDir);
  }
});

test("Mode B: write token gate -> 401/200/409 and ledger auth marker", async () => {
  const dataDir = await makeTempDataDir("lmv-it-b-");
  const token = "testtoken";
  const server = await startServer({
    workdir: WORKDIR,
    port: 18788,
    dataDir,
    passphrase: "integration-pass-b",
    writeToken: token
  });

  try {
    const memory = await getMemory(server.baseUrl);
    const staleEtag = memory.etag;

    const noTokenPatch = await patchRequest(server.baseUrl, staleEtag);
    assert.equal(noTokenPatch.status, 401);

    const wrongTokenPatch = await patchRequest(server.baseUrl, staleEtag, "wrongtoken");
    assert.equal(wrongTokenPatch.status, 401);

    const goodPatch = await patchRequest(server.baseUrl, staleEtag, token);
    assert.equal(goodPatch.status, 200);

    const stalePatch = await patchRequest(server.baseUrl, staleEtag, token);
    assert.equal(stalePatch.status, 409);

    const ledgerResponse = await fetch(`${server.baseUrl}/v1/ledger?since=0&limit=20`);
    assert.equal(ledgerResponse.status, 200);
    const ledger = (await ledgerResponse.json()) as {
      entries: Array<Record<string, unknown>>;
      ledger_cursor: number;
    };
    assert.ok(Array.isArray(ledger.entries));
    assert.ok(ledger.entries.length > 0);
    const lastEntry = ledger.entries[ledger.entries.length - 1];
    assert.equal(lastEntry.auth, "token");
    assert.equal(JSON.stringify(lastEntry).includes(token), false);

    const noTokenSnapshot = await fetch(`${server.baseUrl}/v1/snapshot`, { method: "POST" });
    assert.equal(noTokenSnapshot.status, 401);

    const goodSnapshot = await fetch(`${server.baseUrl}/v1/snapshot`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(goodSnapshot.status, 200);
  } finally {
    await server.stop();
    await removeTempDataDir(dataDir);
  }
});
