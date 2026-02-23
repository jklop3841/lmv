# CI→CD Release Flow

## 1) 配置 secrets
GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret

- NPM_TOKEN: (npm access token, publish 权限)

## 2) 发布
```bash
npm test
git tag v1.0.4
git push origin v1.0.4
```

## 3) 验证
- Actions -> lmv-release -> publish job 通过
- npm 上能看到新版本（或 dry-run log 正常）
