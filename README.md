# Canvas

Canvas 是一个基于 React、Vite 和 Proxy App SDK 的节点式创作工作台。它把提示词、参考素材和图片、视频、音乐任务放在同一张可恢复画布中，支持本地草稿、任务恢复、资产库和键盘/触控操作。

Canvas 在平台工作区的 `apps/canvas` 目录中构建。SDK 使用 npm 包，Proxy App CLI 使用同一工作区 `app/cli` 的源码链接，确保构建契约和运行时注册实现保持一致；正式平台授权与应用登记仍由平台服务负责。当前公开项目范围是 Web 应用，不包含桌面宿主或 Electron 发行包。

## 快速开始

需要 Node.js 22.18 或更新版本：

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run dev
```

`npm run dev` 通过工作区 Proxy App CLI 启动本地开发代理和 Vite 服务，并按配置连接平台。只启动 Vite 可使用 `npm run dev:server`；测试 fixture 会自行提供临时认证端点。

## 版本规则

`manifest.version` 使用 `MAJOR.MINOR.PATCH` 语义版本。日常本地开发修改源码不要求每次都升级版本；上传过的应用包不可覆盖，修改已上传的包时必须提升版本后重新构建和上传。同一版本的相同包可以重复上传。发布时可切回历史已发布版本用于回滚，因此不设固定版本上限，也不要求每次切换线上版本时版本号都递增。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 通过 Proxy App CLI 启动开发代理和 Vite |
| `npm run dev:server` | 只启动底层 Vite 服务 |
| `npm run typecheck` | 执行 TypeScript 严格检查 |
| `npm run build` | 生成网页构建并写入 Agent 契约 |
| `npm run validate` | 校验构建产物和应用契约 |
| `npm run pack` | 重建、校验并生成 `dist/canvas.zip` |
| `npm test` | 运行默认单元测试 |
| `npm run test:e2e:creator` | 使用本机 fixture 运行一个 Playwright 创作回归 |
| `npm run test:e2e:canvas-switch` | 验证画布切换反馈、就绪过渡和失败保留旧画布 |

Playwright 回归是可选检查。首次运行前安装浏览器：

```bash
npx playwright install chromium
npm run test:e2e:creator
```

端到端脚本使用 `tests/platform-fixture.mjs` 等本机夹具，不连接真实账户、第三方站点或付费模型。可用 `CANVAS_PLAYWRIGHT_MODULE` 指向已安装的 Playwright 模块，用 `CANVAS_BROWSER_CHANNEL` 选择浏览器通道。

## 项目结构

```text
canvas/
├── src/                 React 页面、画布领域逻辑和平台适配
│   ├── shared/          Canvas 自带的无副作用状态/诊断 helper 和设计 token
│   ├── agent-tools.mjs  Agent 注册实现；CLI 执行它生成发布能力目录
│   └── network-boundary.ts  浏览器请求边界
├── tests/               默认单元测试和可选浏览器回归
├── docs/                架构、交互、状态和资产库说明
├── agent/               Agent 使用指南和示例
├── scripts/              Agent 契约和独立校验工具；CLI 由公共 npm 包提供
├── manifest.json        Proxy App 元数据
└── package.json         独立开发脚本与依赖
```

`src/shared/` 中的文件是 Canvas 对共享 UI 纯函数的本地副本。这样独立检出不需要访问仓库外路径或未发布的共享包；修改这些 helper 时应同步记录来源和行为变化。

## 平台边界

Canvas 的业务请求通过 App Session Gateway 的 `/v1` 路径发送。浏览器端不应调用宿主管理接口，也不应把令牌写入画布文档。`src/network-boundary.ts` 对原生媒体请求执行额外检查：只允许当前 Gateway 路径、内联/Blob 资源或带已知对象签名的外部媒体，并拒绝管理路径、回环地址和私有网络地址。生产宿主仍需同时配置自己的 CSP 和网络策略。

Canvas 不在本目录保存平台密钥。开发授权由本地 CLI/Relay 转交平台处理，运行用户授权由 App Session 负责；本地 fixture 使用临时账户范围和固定测试数据。

云端画布文档会避开通用 KV 的单值限制：240 KiB 以内沿用单值保存，超过后自动使用不可变分块和小型清单；清单在所有分块确认后才与同步标记一起提交。分块按内容指纹复用，普通局部编辑只增加变化部分；读取会校验总字节数和 SHA-256，旧版本在两分钟宽限期内保留，之后由成功的大画布保存或列表读取触发孤儿分块回收。画布文档自身上限为 16 MiB，平台通用 KV 的 256 KiB 单值和 1 MiB 批量限制不变。账户总 KV 额度仍按平台方案执行，分块不会绕过该额度。

## 测试与验证

默认 `npm test` 只运行无需浏览器和宿主的 TypeScript 单元测试。端到端回归单独执行，避免把浏览器、网络夹具和宿主集成误当成轻量构建的必要条件。测试产物写入已忽略的 `tests/artifacts/`。

类型检查和构建不代表真实模型、额度、供应商结果或线上部署已经验收。发布前应执行 `npm run validate` 和 `npm run pack`，并检查生成的 `dist/manifest.json` 与 `manifest.json` 版本一致。

## 文档

- [架构审查](docs/ARCHITECTURE.md)：模块边界、存储和后续拆分方向。
- [测试指南](docs/TESTING.md)：本地 fixture 与回归范围。
- [创作流程](docs/CREATOR_FLOW.md)：提示词、任务和结果生命周期。
- [手势说明](docs/GESTURES.md)：平移、缩放、连线和触控约定。
- [交互设计](docs/INTERACTION_DESIGN.md)：交互原则和恢复边界。
- [媒体资产库](docs/MEDIA_ASSET_LIBRARY.md)：资产保存、复用和权限边界。
- [偏好设置](docs/CANVAS_PREFERENCES.md)：画布偏好配置和本地保存。
- [画布交互](docs/CANVAS_INTERACTIONS.md)：结果浏览、来源定位和窄屏行为。
- [Agent 指南](agent/guide.md)：能力调用和恢复语义。

## 参与贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交改动前至少运行 `npm run typecheck`、`npm run build` 和 `npm test`；改变网络边界、存储格式或 Agent 输出时，也应补充对应测试和迁移说明。

## 许可和安全

本项目以 MIT 许可发布，第三方依赖的许可信息见 [NOTICE.md](NOTICE.md)。安全问题请按照 [SECURITY.md](SECURITY.md) 报告，不要在公开 Issue 中粘贴令牌、签名 URL、真实账户数据或浏览器录制。
