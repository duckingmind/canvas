# Contributing

感谢参与 Canvas。请在提交前确认改动只涉及本项目目录，并避免提交本机路径、构建产物、测试截图、签名 URL、令牌或真实账户数据。

## 开发流程

```bash
npm ci
npm run typecheck
npm run build
npm test
```

界面或交互改动可额外运行 `npm run test:e2e:creator`。平台授权、发布和 Electron 命令属于可选宿主集成；请在宿主仓库中验证，不要把宿主依赖复制进默认独立构建。

提交说明应描述用户可观察的行为、数据迁移或兼容性影响。新增网络请求必须经过 `network-boundary.ts` 或说明为什么不需要；新增持久化字段需要更新恢复/迁移测试。
