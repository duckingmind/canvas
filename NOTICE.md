# Third-party notices

Canvas 直接依赖的 React、React DOM、Vite、TypeScript、Lucide React、Proxy App SDK、Proxy App CLI 和 Playwright 各自保留上游许可证与版权声明。安装后可在 `node_modules/<package>/LICENSE*` 查看对应文本；本项目没有复制或修改这些第三方源码。

开发、应用校验、打包和 Agent 契约由公共 npm 包 `@ducking-mind/proxy-app-cli` 提供；Canvas 不维护 CLI 的本地副本。

`src/shared/` 中的 helper 是共享 UI 项目 `@ducking-mind/proxy-app-ui` 0.1.0（MIT）所用状态、诊断和 CSS token 的本地副本，保留原项目的版权和许可证范围；副本的许可证文本见 [`src/shared/LICENSE`](src/shared/LICENSE)。为适配 Canvas 独立工作区，错误展示文案有本地调整。
