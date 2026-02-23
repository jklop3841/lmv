# LMV CI/CD Engine Spec

## Capability
- cross-platform CI (win + linux)
- deterministic node test runner
- release automation

## Guarantees
- version match enforcement
- artifact integrity check
- deterministic test discovery

## Requirements
- node >=20
- npm registry token (optional)

## Integration time
≈ 3 min

## Failure surface
Only fails if:
- dist missing
- test fails
- version mismatch
