---
name: canvas-development
description: 维护 apps/canvas 的节点、媒体生命周期和云同步边界；用于新增或修改生成、导入、提取、裁切、录音、素材库、复制、参考素材和 Agent 写入，避免临时地址或本地缓存泄漏到完成节点。
---

# Canvas development

这个 skill 适用于 `apps/canvas` 的功能开发和问题排查。先读
[references/media-lifecycle.md](references/media-lifecycle.md)；如果改动涉及云端
同步，再同时检查 `src/cloud-document.ts` 和 `src/App.tsx` 的同步入口。

## 核心不变量

- 完成态媒体节点和可提交的媒体参考必须有稳定身份：`assetId`、可恢复的
  `taskId`，或不带签名参数的长期 URL。
- `localImage`、`localAudio`、`localVideo`、`data:`、`blob:`、短期签名 URL、
  页面内 content 代理地址只能用于当前浏览器的预览、编辑或备份辅助，不能作为
  跨设备恢复身份。
- 上传、生成或处理未确认成功时，不创建完成节点；应保留明确的进行中状态，或
  回滚新占位节点并提示重试。上传失败不能以本地缓存“补成功”。
- 同步只做云端 DTO 投影：移除浏览器缓存键、过期地址和运行时字段后保存。同步
  不负责上传素材、发现资产、修复生成结果，也不应因为历史草稿含临时字段而拒绝
  保存；上传中的占位也只能由上传事务本身推进到完成态。

## 修改流程

1. 找到产生节点或参考对象的最早提交点，而不是在同步层添加拦截。先确认上传
   返回了资产身份，再设置 `status: "completed"` 或清理提交态。
2. 对图片、视频、音乐、音色、录音、文件导入、截帧、提取、裁切、复制、素材库
   插入和参考素材绑定分别检查成功、失败、超时和画布切换路径。
3. 生成结果按输出逐项验证身份；批量结果不能因为同一个任务 ID 而掩盖缺失的
   单项资产身份。
4. 复制/粘贴已有媒体节点时，优先复用原 `assetId` 或长期 URL；复制只创建新节点
   身份和布局，不下载原字节、不上传新资产。完成任务媒体保留可恢复的任务身份，
   临时配送 URL 和本地缓存键不作为副本身份。媒体仍在上传，或只有本地缓存/临时
   地址且没有稳定身份时，在创建副本前拒绝操作并提示用户先完成上传或恢复资产。
5. 参考素材进入创作提交前必须可跨设备恢复。已有本地旧数据应提示重新上传，
   或在绑定入口完成平台资产上传，而不是把本地键写入新的完成结果。
6. Agent 的图片导入必须经过平台媒体上传并把 `assetId` 和长期地址写入节点；
   Agent 只能通过现有提交/生成入口改变媒体生命周期。

## 验证

运行与改动相称的检查，至少包括：

```text
npm run typecheck
npm test
python /Users/dingxiaohua/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  apps/canvas/.agents/skills/canvas-development
```

涉及 Agent 契约或构建产物时，再运行 `npm run build`、`npm run validate` 和相应
的 agent 测试；涉及浏览器上传、云同步或媒体播放器时，再运行对应的 e2e 测试。
