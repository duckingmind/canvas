import type { CanvasNode, StoredAsset } from "./canvas-types.ts";
import type { CanvasAsset, AssetKind } from "./asset-library.ts";
import { mediaUrlIdentity } from "./image-recovery.ts";

export function reusableNodeKind(node: CanvasNode): AssetKind | null {
  if (node.audio || node.localAudio || (node.type === "audio" || node.mediaType === "audio") && (node.assetId || node.taskId && node.status === "completed")) return "audio";
  if (node.localVideo || node.video || node.videoContentUrl || ((node.type === "video" || node.mediaType === "video") && (node.assetId || node.taskId && node.status === "completed"))) return "video";
  if (node.image || ((node.type === "image" || node.mediaType === "image") && node.assetId)) return "image";
  if ((node.type === "note" || node.type === "prompt") && node.text.trim()) return "prompt";
  return null;
}

/** Never use list order as a result index: one task can produce many files. */
export function matchNodeMediaAsset(node: CanvasNode, assets: readonly StoredAsset[], completeResultSet = true): StoredAsset | undefined {
  const kind = reusableNodeKind(node);
  const candidates = assets.filter(asset => asset.type.split("/")[0] === kind && (!node.taskId || asset.task_id === node.taskId));
  if (node.assetId) return candidates.find(asset => asset.id === node.assetId);
  const identity = mediaUrlIdentity(node.image || node.video || node.videoContentUrl || node.audio);
  if (identity) {
    const matches = candidates.filter(asset => mediaUrlIdentity(asset.url) === identity);
    if (matches.length === 1) return matches[0];
  }
  // A singleton result is unambiguous; multiple results need an explicit URL/ID.
  if (completeResultSet && node.taskId && candidates.length === 1 && (node.resultIndex === undefined || node.resultIndex === 0)) return candidates[0];
  return undefined;
}

export function nodeFromLibraryAsset(asset: CanvasAsset, mediaURL?: string, urlExpiresAt?: string, thumbnailURL?: string): Pick<CanvasNode, "type" | "title" | "text"> & Partial<CanvasNode> {
  if (asset.source.type === "local") {
    throw new Error("本机素材必须先上传为平台资产，才能插入画布节点。");
  }
  if (asset.kind !== "prompt" && !mediaURL) throw new Error("素材内容暂不可用，请刷新后重试。");
  const source = asset.source;
  return {
    type: asset.kind === "prompt" ? "note" : asset.kind,
    title: asset.name,
    text: source.type === "text" ? source.text : asset.prompt || "",
    ...(asset.kind === "image" ? { image: mediaURL, ...(thumbnailURL ? { imageThumbnail: thumbnailURL } : {}) } : asset.kind === "video" ? { video: mediaURL } : asset.kind === "audio" && source.type !== "task" ? { audio: mediaURL } : {}),
    ...(asset.kind === "video" && urlExpiresAt ? { videoContentUrlExpiresAt: urlExpiresAt } : {}),
    ...(source.type === "platform" ? { assetId: source.assetId, taskId: source.taskId, resultIndex: source.resultIndex, ...(source.audioTaskType ? { audioTaskType: source.audioTaskType } : {}), ...(source.voiceId ? { voiceId: source.voiceId } : {}) } : {}),
    ...(source.type === "task" ? { taskId: source.taskId, resultIndex: source.resultIndex, status: "completed" as const, ...(source.audioTaskType ? { audioTaskType: source.audioTaskType } : {}), ...(source.voiceId ? { voiceId: source.voiceId } : {}), ...(source.audioTaskType === "tts" && source.voiceId ? { ttsSettings: { voice_id: source.voiceId } } : {}) } : {}),
    modelId: asset.modelId,
  };
}
