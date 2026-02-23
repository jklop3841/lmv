# LMV Agent Contract (v1)

## 1. Actor naming

Use:

`agent:<name>@<host>`

Examples:
- `agent:codex-5.3@controlpc`
- `agent:seed-worker@node-a`

## 2. Reason format

`<project>/<task>/<why>`

Example:

`lmv/bootstrap/import_kimi_memory/normalize_blocks`

Reason is required on every write request through header `X-LMV-Reason`.

## 3. Patch granularity

One PATCH should modify only one block or one subtree.

Good:
- `/projects/lmv_demo`
- `/rules/security`

Avoid:
- editing multiple top-level blocks in one patch (harder conflict triage)

## 4. Conflict default strategy

On HTTP `409`:

1. `GET /v1/memory` to fetch latest `ETag` and `version`
2. `GET /v1/ledger?since=<local_cursor>&limit=<n>` to pull remote deltas
3. Replay remote patch entries locally
4. Recompute or replay intended patch
5. Retry `PATCH /v1/memory` with latest `If-Match`

Reference client:

`examples/agent_client.ts`
