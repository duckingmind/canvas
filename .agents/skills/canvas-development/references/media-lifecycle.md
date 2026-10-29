# Canvas 媒体生命周期

## 身份判定

统一使用 `src/media-identity.ts` 的规则。输出可由 `assetId`、`taskId` 或长期 URL
恢复；输入必须有 `assetId` 或长期 URL，因为输入需要重新读取原始字节。长期 URL
只有在 `isDurableAssetUrl` 判定为不含签名/令牌时才算身份。签名 URL 是配送地址，
必须在展示或读取时通过资产 ID 重新获取。

浏览器缓存键的作用是帮助当前页面快速预览：

- 图片：`localImage` 和 `imageThumbnail`；
- 视频：`localVideo`、`videoPoster`、`videoContentUrlExpiresAt`；
- 音频：`localAudio`；
- 上传事务：`uploadState`、`uploadProgress`、`uploadError`。

这些字段可以留在本地草稿或完整备份中，但不能成为云端文档的恢复依据。

## 入口矩阵

| 入口 | 成功提交前必须具备 | 失败时的处理 |
| --- | --- | --- |
| 图片、视频、音乐、音色生成 | 任务 ID、资产 ID 或长期 URL；每个输出逐项确认 | 生成结果缺身份时进入失败终态，不生成空结果卡 |
| 文件导入、剪贴板、手绘和图片工具 | 平台上传返回资产 ID；图片还应有长期配送地址 | 回滚新占位或清除替换内容，删除临时缓存 |
| 视频截帧、视频/音频提取 | 新文件上传返回资产 ID | 不以本地缓存创建完成节点 |
| 音频裁切、录音保存 | 音频上传返回资产 ID | 删除临时音频缓存并保持原节点 |
| 音乐参考音频绑定 | 参考音频资产 ID | 不保留 local-only 参考；提示重新上传 |
| 画布连线、内嵌参考和 `@` 引用 | 可重新读取的资产 ID 或长期 URL | 不静默忽略引用；提交前给出重新上传/选择提示 |
| 素材库插入 | 本地图片、音视频先提升为平台资产，再把平台资产作为节点来源 | 上传失败时不调用画布插入回调 |
| 复制/粘贴节点 | 原节点身份可恢复；已有 `assetId` 或长期 URL 直接复用 | 不下载或重新上传已有平台资产；本地-only、临时地址或上传中媒体在创建副本前拒绝 |
| Agent `import_image` | 平台上传返回合法 `assetId` 和长期图片 URL | 不提交节点，清理暂存字节 |

## 关键代码位置

- `src/media-identity.ts`：稳定身份和错误码的唯一小规则。
- `src/platform-asset-library.ts`：上传响应校验、资产详情读取和签名地址刷新。
- `src/asset-nodes.ts`：素材库来源转画布节点；不能让 local-only 来源绕过入口。
- `src/useAssetLibrary.ts`：素材库预览、保存和插入；本地音视频插入前要提升为
  平台资产。
- `src/App.tsx`：生成、导入、参考、复制、提取、裁切、录音和同步调度的提交边界。
- `src/cloud-document.ts`：只做云端投影，删除本地键、短期 URL 和运行时字段。
- `src/library-store.ts` / `src/App.tsx`：本地快照和云端 outbox 分离；同步不承担素材上传或身份修复。
- `src/agent-capabilities.ts`：Agent 图片分块导入必须调用平台上传后再创建节点。

## 评审搜索清单

新增媒体入口时搜索以下模式，并确认完成提交位于稳定身份校验之后：

```text
status: "completed"
localImage / localVideo / localAudio
assetId / taskId / videoContentUrl
uploadDurablePlatformAsset
storeLocalAudio / storeLocalVideo
commit(...)
```

复制已有平台资产不得把复制实现成“读取原字节后重新上传”；副本应保留原资产
身份，配送地址过期时沿用现有资产恢复逻辑刷新。只有没有稳定身份的本地/临时
媒体才需要先上传或拒绝复制。

如果一个路径先写入本地键、随后异步上传，必须明确区分“上传中占位”和“完成
节点”。云端同步不检查素材身份、不等待 `uploadState`，也不替代上传事务；上传中
占位的临时媒体值应在本地持久化时剔除，上传成功回调负责清理占位并写入稳定身份。

## 测试重点

每个新媒体入口至少覆盖：稳定身份成功、上传响应缺身份、上传拒绝/超时、画布或
登录会话切换，以及带本机缓存、临时 URL 和上传中占位的快照可直接完成同步投影，
且同步没有素材上传请求。同步测试应验证临时字段被投影剔除，而不是把同步当成生成
链路的校验器。
