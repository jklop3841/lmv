# LMV (Local Memory Vault) v1.0

LMV is a local encrypted memory hub: JSON Patch with ETag/If-Match gating, auditable ledger, optional write-token auth, passphrase rotation (rollback + verification), and cross-platform CI-backed versioned delivery artifacts (zip + sha256 + changelog notes).

Local encrypted memory service with append-only encrypted ledger and optimistic concurrency.

## Core

- Runtime: Node 20 + TypeScript + Fastify
- Storage (encrypted at rest):
  - `data/vault.enc` (snapshot)
  - `data/ledger.jsonl.enc` (append-only ledger)
  - `data/meta.json` (kdf/hkdf metadata, no secrets)
- Encryption:
  - Envelope v1: `{v,kdf,hkdf,aead,ciphertext_b64}`
  - KDF: `scrypt N=32768 r=8 p=1 keylen=32`
  - Key separation: HKDF info `"vault"` / `"ledger"`
  - AEAD: AES-256-GCM with AAD bound to context
- Concurrency:
  - `GET /v1/memory` returns `ETag: "v{version}"`
  - `PATCH /v1/memory` requires `If-Match: "v{n}"`; mismatch -> `409`
- Ledger:
  - immutable append
  - hash chain (`prev_hash`, `entry_hash`)
  - crash recovery ignores only trailing broken line

## Write Auth Gate (P0)

Optional env:

- `LMV_WRITE_TOKEN`

When set:

- `GET /v1/memory`, `GET /v1/ledger` remain public (read-only)
- `PATCH /v1/memory`, `POST /v1/snapshot` require:
  - `Authorization: Bearer <LMV_WRITE_TOKEN>`
- Missing/invalid token -> `401`
- Ledger entries include audit marker `auth: "token"` (token value is never stored)

When not set:

- write endpoints are allowed without Authorization
- ledger entries mark `auth: "none"`

## Start

```powershell
$env:LMV_PASSPHRASE = "replace-with-strong-passphrase"
# optional:
$env:LMV_WRITE_TOKEN = "replace-with-write-token"
docker compose up --build
```

Network:

- app listens `0.0.0.0:8787` in container
- compose exposes `127.0.0.1:${LMV_PORT:-8787}:8787`
- app accepts `LMV_PORT` (or fallback `PORT`)
- app accepts `LMV_DATA_DIR` (or fallback `DATA_DIR`, default `./data`)

Fail-fast:

- missing `LMV_PASSPHRASE` => process exits immediately

## curl examples

1. Read memory:

```bash
curl -i http://127.0.0.1:8787/v1/memory
```

2. Patch without token (works only if `LMV_WRITE_TOKEN` unset):

```bash
curl -i -X PATCH http://127.0.0.1:8787/v1/memory \
  -H 'Content-Type: application/json-patch+json' \
  -H 'If-Match: "v0"' \
  -H 'X-LMV-Actor: agent:demo@localhost' \
  -H 'X-LMV-Reason: lmv/demo/add_identity' \
  --data '[{"op":"add","path":"/identity/name","value":"Alice"}]'
```

3. Patch with token (required when `LMV_WRITE_TOKEN` is set):

```bash
curl -i -X PATCH http://127.0.0.1:8787/v1/memory \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json-patch+json' \
  -H 'If-Match: "v1"' \
  -H 'X-LMV-Actor: agent:demo@localhost' \
  -H 'X-LMV-Reason: lmv/demo/add_rule' \
  --data '[{"op":"add","path":"/rules/strict","value":true}]'
```

4. Pull ledger increment:

```bash
curl "http://127.0.0.1:8787/v1/ledger?since=0&limit=50"
```

5. Snapshot with token:

```bash
curl -i -X POST http://127.0.0.1:8787/v1/snapshot \
  -H 'Authorization: Bearer <token>'
```

## Re-encrypt / rotate passphrase (P0)

Command:

```bash
LMV_PASSPHRASE=old-pass LMV_NEW_PASSPHRASE=new-pass npm run reencrypt
```

Behavior:

1. decrypt+validate with old passphrase
2. re-encrypt `vault.enc` + `ledger.jsonl.enc` into temp stage files
3. update `meta.json` (`updated_at`)
4. atomically swap staged files into `data/`
5. auto-verify integrity (`verifyLedger` + state replay)
6. on any error, rollback to original files

No passphrase is written to disk or logs.

Post-check:

```bash
LMV_PASSPHRASE=new-pass npm run verify-ledger
```

## Scripts

- `npm run init-seed`
- `npm run verify-ledger`
- `npm run reencrypt`
- `npm run test:integration`
- `pwsh -File .\scripts\replay_min.ps1`

## Integration tests

Run on Windows PowerShell:

```powershell
npm run test:integration
```

This test suite starts real service processes and validates:

- mode A (no `LMV_WRITE_TOKEN`): write endpoints return `200`
- mode B (`LMV_WRITE_TOKEN=testtoken`):
  - `PATCH` without/invalid token -> `401`
  - `PATCH` with valid token -> `200`
  - stale `If-Match` -> `409`
  - ledger latest entry has `auth: "token"` and does not leak token value
  - `POST /v1/snapshot` without token -> `401`, with token -> `200`

## CI and acceptance package

- CI workflow: `.github/workflows/ci.yml` (Windows + Ubuntu)
- Acceptance evidence template: `docs/ACCEPTANCE_EVIDENCE_TEMPLATE.md`
- Security pre-release checklist: `docs/SECURITY_CHECKLIST.md`
- Release workflow: `.github/workflows/release.yml` (tag `v*.*.*` -> zip + sha256 + release notes)
  - also publishes SBOM (`lmv-vX.Y.Z-sbom.cdx.json`) and production audit evidence (`lmv-vX.Y.Z-npm-audit.txt`)
  - also publishes machine-readable audit (`lmv-vX.Y.Z-npm-audit.json`)

## Versioned release flow

1. Update `CHANGELOG.md` with the next version section.
2. Create and push tag (example `v1.0.1`):

```bash
git tag v1.0.1
git push origin v1.0.1
```

3. GitHub Actions release workflow will:
   - run build + integration tests on Windows and Ubuntu
   - package delivery zips (`win-x64`, `linux-x64`)
   - generate sha256 checksums
   - generate SBOM (CycloneDX) and npm production audit evidence
   - create GitHub Release with notes from `CHANGELOG.md`

Optional audit gate:

- `LMV_AUDIT_GATE_LEVEL=off|low|moderate|high|critical` (default: `off`)
- when set to a severity, release fails if vulnerabilities at or above that level exist

## SDK: `packages/lmv-client` (P1)

Exports:

- `getMemory()`
- `patch(patchOps, actor, reason, etag)`
- `pullLedger(cursor, limit?)`
- `snapshot()`
- `applyWithRetry(patchOps, actor, reason, retry?)` (handles 409 by refreshing ETag)

Example:

```ts
import { LMVClient } from "./packages/lmv-client/src";

const client = new LMVClient({
  baseUrl: "http://127.0.0.1:8787",
  writeToken: process.env.LMV_WRITE_TOKEN
});

const memory = await client.getMemory();
const result = await client.applyWithRetry(
  [{ op: "add", path: "/projects/demo", value: { ok: true } }],
  "agent:sdk@localhost",
  "lmv/demo/apply_with_retry"
);
console.log(result.memory.version, memory.etag);
```

## Agent coordination

See `docs/agent_contract.md` for actor naming, reason format, patch granularity, and conflict strategy.
