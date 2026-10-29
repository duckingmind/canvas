---
name: canvas-mcp
description: 通过已连接的 MCP 服务读取、编辑和排查无限画布，适用于画布文档、节点、素材及图片/视频/音乐生成任务；不用于一般性的 Canvas 前端代码开发。
---

# Canvas MCP

通过当前可用的 MCP 工具操作 Canvas。工具和参数以运行时实际注册的 MCP 能力为准；不要在本技能中复制工具 schema，也不要猜测未发现的工具。

## 开始前

1. 确认 MCP 工具当前可用。先调用 `proxy_desktop_list_apps` 找到 Canvas，再按需调用 `proxy_desktop_get_app_status` 检查运行状态。
2. 读取当前安装版本的 Canvas 指南：先读 `overview`；涉及多步创作时读 `workflow`，遇到错误、超时或未决任务时读 `recovery`。以 MCP 返回的指南和工具 schema 为准，不用仓库里的旧版本说明覆盖运行时信息。
3. 通过 `proxy_canvas_list_documents` 确认活动画布。读取或修改内容前调用 `proxy_canvas_read_state`；节点和连线分页分别处理，续页期间若 revision 改变就从头重新读取。
4. 如果当前会话没有 Canvas MCP 工具，明确说明尚未连接；不要把源码检查、旧快照或本地文件冒充为当前画布状态。

## 读取与修改

- 读取节点全文时使用 `proxy_canvas_read_node` 的文本分页；读取媒体字节时使用 `proxy_canvas_read_media`，按返回的偏移续读并校验完整 SHA-256。状态摘要中的 `hasMedia` 只是存在标记，不是媒体内容。
- 每次写入前重新读取状态，并使用最新的 `documentId`、`revision` 和新的 `idempotency_key`。同一请求重试时复用完全相同的参数和键；参数改变就使用新键。
- 遇到 revision 或文档冲突，重新读取并根据用户最新画布状态决定后续操作。超时、断连或结果未知时，先读取画布和任务状态核实是否已执行，不要换键盲目重放。
- 不删除或覆盖内容，除非用户明确要求。修改尽量限于用户指定的节点和字段；完成后重新读取相关节点验证结果。

## 生成与异步任务

- 先用 `proxy_canvas_list_models` 查询可用模型和支持参数；按实时 schema 配置，不编造模型或参数。
- 只有用户明确要求生成时才提交可能产生费用的图片、视频或音乐任务。提交后，`accepted` 代表任务已接受，不代表作品已完成；通过 `proxy_canvas_read_tasks` 跟踪状态和结果节点。
- 对失败、暂停、状态未知或取消请求，先按 `recovery` 指南判断。不能把本地暂停说成服务端已取消；取消请求也不等于平台已确认取消。
- 上传本地图片按工具要求分块进行；不要把本地路径、媒体 URL 或大段媒体字节塞进普通节点字段。

## 汇报结果

说明读取的是哪个画布以及实际观察到的节点、连线或任务状态。区分“已保存到本机”“已提交生成”和“已生成完成”；只有读取到完成状态和有效结果后，才报告作品已生成。

## 能力来源（维护 Canvas MCP 时）

- `src/agent-tools.mjs` 是能力注册和契约的代码来源，`src/agent-capabilities.ts` 是业务处理实现，`src/agent-registration.ts` 在应用加载时把实现注册到 SDK。
- `agent/guide.md`、`agent/workflow.md` 和 `agent/recovery.md` 是随应用版本发布的运行时指南；`dist/agent-tools.*`、`dist/manifest.json` 等是构建产物，不要手工维护。
- 修改能力后运行 `npm run build` 重新生成契约，再运行 `npm run validate` 和相关 agent 测试；工具名称、输入输出 schema 以代码注册结果和 MCP `tools/list` 为准。
