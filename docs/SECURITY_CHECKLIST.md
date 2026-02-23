# LMV Security Checklist (Pre-Release)

Use this checklist before every tagged release.

- [ ] Release package does **not** include:
  - `data/`
  - `*.enc`
  - `meta.json`
  - any user data artifacts
- [ ] CI logs do **not** contain:
  - `LMV_PASSPHRASE`
  - `LMV_NEW_PASSPHRASE`
  - token values
- [ ] Ledger audit does not leak token values:
  - only `auth: "token"` or `auth: "none"` is recorded
- [ ] Error messages do not echo sensitive env values
  - including startup fail-fast paths
- [ ] `reencrypt` flow uses:
  - temporary staging files
  - atomic rename/swap
  - rollback on failure without damaging original files
- [ ] `verify-ledger` integrity verification runs after reencrypt and must pass
- [ ] Release attachments include SBOM and audit evidence with matching tag:
  - `lmv-vX.Y.Z-sbom.cdx.json`
  - `lmv-vX.Y.Z-npm-audit.txt`
  - `lmv-vX.Y.Z-npm-audit.json`
- [ ] `npm-audit` evidence file does not contain token/passphrase values
- [ ] If audit gate is enabled (`LMV_AUDIT_GATE_LEVEL`), severity policy is explicit for this release

## Optional Operator Verification Commands

```powershell
# sanity check: no unintended local artifacts before tag
git status --porcelain

# integration matrix before release tag
npm -C lmv run test:integration
```
