# Canvas Agent 使用指南

Canvas 把文本便签、提示词、图片、视频和音乐结果组织成可保存的画布。所有工具名称使用 `proxy_canvas_` 前缀。主应用发布当前启用版本的能力契约；读取 `api` 主题可获取该版本的参数和返回字段，不必猜测字段。

## 先发现，再操作

1. 通过主应用的应用目录找到 Canvas；需要排查可用性时读取应用状态。应用尚未运行时，业务调用可请求主应用启动它；等待登录须由用户完成登录。
2. 用 `list_documents` 选择已有画布，或用返回的 `activeDocumentId` 调用 `create_document`。无活动画布时该值是空字符串。新建和切换均会先保存当前编辑。
3. 编辑前调用 `read_state`，使用返回的 `documentId` 和不透明 `revision`。列表分页游标为 `null` 表示结束；节点和连线分别分页。跨页版本变化时重新读取，避免拼接不同状态。
4. 每次用户操作生成一个 `idempotency_key`。同一请求重试必须复用原键及全部参数；改了参数就是新操作。写入返回 `savedLocally: true` 只保证本机保存，不保证云端同步已完成。

## 能力范围

- 画布：列出、新建、打开、重命名、保存。
- 内容：读取节点及分页文本；创建便签或图片/视频/音乐提示词；批量更新、删除、排列；连接和断开依赖。
- 生成：读取模型及其支持的参数；配置图片、视频或文字音乐参数；提交、查询、恢复未决任务，并在平台支持时请求取消视频、音乐或音色任务。
- 素材：通过分块上传把本地 PNG/JPEG/WebP 导入画布；通过 `read_media` 分块读取画布媒体和本地录音供 Agent 保存到自己的交付渠道。

删除是生成任务的终止入口：即使节点处于排队、生成或状态未知阶段，也可以调用 `delete_nodes`。编辑器会立即停止该节点的本地观察并丢弃迟到结果；这不会取消已经提交到服务端的任务，也不会影响其他节点。

`read_state` 和 `read_node` 只返回媒体存在标记，不暴露媒体地址或字节。确需传入本地图片时按顺序调用 `upload_image_chunk`，最后调用 `import_image`；确需取出生成结果时按 `read_media` 返回的 `nextOffset` 和 `hash` 续读，合并分块并校验 SHA-256。图片上传上限 8 MiB，媒体读取上限 64 MiB。不要把 URL、文件路径或媒体字节塞进普通节点字段。素材库管理、文档删除/恢复、撤销/重做尚未开放。

`resume_generation` 仅恢复原任务或原冻结提交，保留原 taskId 和生成提交标识；音色设计提交尚未取得 taskId 时也可以恢复。不能用于重新生成已完成或失败任务。`cancel_generation` 对带 taskId、状态已确认的未决视频、音乐或音色任务发出取消请求；状态未知或核对中时先继续查询。必须继续 `read_tasks` 核实状态；取消请求本身不代表服务端已经取消，也不保证退费。

音乐提示词使用 `media_type: audio`，`text` 描述主题、曲风和情绪，`configure_generation.music_settings.lyrics` 单独保存歌词。模式、输出格式和时长须从 `list_models.parameters.music` 选择；`supportsLyricsOptimizer: true` 时才可配置 `lyrics_optimizer`。模型没有公布时长时不要传 `duration`。协作工具支持提交文字歌曲和纯音乐。Canvas 创作面板支持音色设计、参考音频 Cover 和录音；这些入口的参数尚未开放给协作工具，`list_models` 的音频目录仅展示工具可提交的文字音乐模型。

`read_state`、`read_node` 和 `read_tasks` 返回 `audioMode`、`voicePreviewText` 和 `voiceId`，任务列表另有 `audioTaskType`，便于识别 UI 创建的音色任务。`audioMode` 是当前创作模式，`audioTaskType` 是已有结果的任务身份。音乐和音色结果、保存在本机的录音都可用 `read_media` 读取；本地音频缓存键、媒体地址和字节不会出现在节点摘要中。

生成会使用外部模型，可能计费。`submit_generation` 返回接受状态，应用继续负责请求、轮询和恢复。完成情况读取 `read_tasks`，不能把调用成功表述为作品已经生成。

需要组合多个工具时读取 `workflow`；遇到冲突、超时、登录或任务恢复问题时读取 `recovery`；读取 `examples` 可查看已按当前契约校验的调用示例。使用主应用工具分页读取这些指南时，续页除传入 `nextOffset`，还须把第一页的 `hash` 原样传为 `expected_hash`；若返回 `AGENT_GUIDE_CHANGED`，从第一页重新读取。示例仅演示结构；画布、节点和模型 ID 必须替换为本次发现的真实 ID。指南用于理解业务，实际授权与输入校验由主应用和业务处理器执行。

Canvas 暂不提供文本转语音，也不开放相关参数和生成接口。历史记录中的 `audioMode: tts` 或 `audioTaskType: tts` 只用于识别已有数据；可读取已完成的音频素材，不能配置、提交、恢复或取消该类任务。
