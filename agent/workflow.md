# 生成工作流

## 从目标建立可执行画布

1. `list_documents` 获取当前画布与可选画布。需要新画布时，传当前 `activeDocumentId` 调用 `create_document`；复用画布时调用 `open_document`。只需修改当前画布可直接读取状态。
2. `list_models` 查找 `available: true` 且媒体类型匹配的模型。目录为空可能仍在加载。不要编造模型 ID；目录可用也不保证支持任意参考图组合。
3. 需要把本地图片作为参考素材时，用 `upload_image_chunk` 按 192 KiB 或更小的 Base64 分块上传，逐次使用返回的 `nextOffset`，再用 `import_image` 创建图片节点。上传与导入均绑定当前文档和 revision；图片只接受 PNG、JPEG、WebP，最大 8 MiB。
4. `read_state` 获取最新画布 ID 与 revision。通过 `create_nodes` 创建便签或提示词。图片提示词选择 `media_type: image`，视频提示词选择 `video`，音乐提示词选择 `audio`；提交前须显式选择 `model_id`。如需控制画质、尺寸、比例、张数、视频时长或音乐模式/格式/时长/歌词，按 `list_models.parameters` 支持值调用 `configure_generation`，随后用 `read_node` 核对。歌词单独写入 `music_settings.lyrics`，模型明确声明 `supportsLyricsOptimizer: true` 时可配置歌词优化。创建节点本身不会执行模型生成。
5. 若要复用文字或已有图片/视频结果，用 `connect_nodes` 建立来源到目标的依赖。来源可以是便签、提示词或含媒体内容的图片/视频节点；目标须为便签或尚未含生成结果的提示词节点。重复和循环依赖会被拒绝。不要尝试把媒体 URL 填入节点属性来上传文件。
6. 可用 `update_nodes` 调整提示词，`arrange_nodes` 排列节点。已有分组会作为一个布局单元整体移动，组内成员保持相对位置；需要只调整组内部分成员时，明确传入这些成员。每次写入前重新读取 `read_state`。同一批更新先完成全量校验，再修改状态；运行中节点禁止修改，可以通过 `delete_nodes` 丢弃并停止本地观察。
7. 明确用户已要求生成后，再次读取状态，调用 `submit_generation`，保留幂等键、节点 ID 和返回值。返回 `accepted: true, completed: false` 表示已交由应用执行，可能产生模型费用。
8. 通过 `read_tasks` 查询源节点；排队或运行中时适度等待后再次查询。`completed` 且存在 `resultNodeIds` 时，用 `read_node` 检查这些节点的 `hasMedia`。需要交付媒体字节时用 `read_media` 分块读取，并验证完整文件 SHA-256。单个结果可能直接保存在源提示词节点，不能假定总会新增节点。

## 一致性与进度报告

`read_state` 的节点和连线独立分页；文本超过摘要长度时用 `read_node` 的 `nextTextOffset` 继续读取。不要根据截断文本覆盖原文。

写入完成后 `appliedRevision` 表示本次提交的版本，`revision` 表示返回时看到的版本。保存期间用户或生成任务可能继续编辑，因此下一次写入仍应重新读取状态。

将“已创建画布”“已提交生成”“已生成完成”分开报告。`savedLocally` 不能用作云同步或外部生成完成的证明。
