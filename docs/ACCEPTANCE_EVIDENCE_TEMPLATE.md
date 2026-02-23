# Local Memory Vault (LMV) v1.0 验收证据（模板）

## 1. 交付范围
- 本地加密记忆库（at-rest encryption）
- 版本门禁（ETag + If-Match）
- 多 Agent 协作写入（409 冲突保护）
- 追加审计账本（ledger，含 auth 字段不泄密）
- 写入门禁（可选 token）
- 快照压缩（snapshot gate）
- 集成测试覆盖（401/200/409 + token 开/关 + ledger auth + snapshot 门禁）

## 2. 环境
- Node: 20.x
- OS: Windows / Linux（CI 双平台验证）
- Passphrase: 必填（缺失 fail-fast）

## 3. 验收命令
```powershell
# Windows / PowerShell
npm run build
npm run test:integration
```

```bash
# Linux/macOS
npm run build
npm run test:integration
```

## 4. 关键验收点（必须全部通过）

### Mode A（无 LMV_WRITE_TOKEN）

- PATCH /v1/memory -> 200
- POST /v1/snapshot -> 200

### Mode B（LMV_WRITE_TOKEN=testtoken）

- PATCH 无 Authorization -> 401
- PATCH 错 token -> 401
- PATCH 正确 token -> 200
- stale ETag PATCH -> 409
- GET /v1/ledger 最新 entry: auth == "token" 且不含 token 明文
- snapshot 无 token -> 401
- snapshot 正确 token -> 200

## 5. CI 证据

- GitHub Actions：Windows + Ubuntu 均通过
- 证据形式：
  - Actions 运行截图（两平台）
  - `test:integration` 输出日志（artifact）

## 6. 安全声明（交付红线）

- passphrase 不落盘、不写日志
- token 不落盘、不写 ledger
- ledger 仅记录 auth="token"/"none" 供审计，不包含 token 值
