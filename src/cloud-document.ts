import type { Document } from "./canvas-types.ts";
import type { MediaReference } from "./task-lifecycle.ts";
import { isDurableAssetUrl } from "./asset-library.ts";
import { isLocalAudioKey, normalizeMusicReference, normalizeMusicSubmission, normalizeTTSSettings, normalizeTTSSubmission, normalizeVoiceDesignSubmission } from "./audio-creation.ts";
import { isLocalVideoKey } from "./video-cache.ts";

const MAX_STORAGE_BYTES = 180_000;
const LOCAL_IMAGE_KEY = /^proxy-canvas:image:sha256:[a-f0-9]{64}$/;
export class TemporaryCanvasMediaError extends Error {
  readonly code = "CANVAS_TEMPORARY_MEDIA";
  constructor() {
    super("画布含尚未托管的本地或临时素材，不能完整同步到云端。原素材仍保留在当前浏览器；关闭页面或切换账户前请导出完整备份。可改用平台资产或长期有效的素材地址后重试。");
  }
}

/** Cloud KV contains stable identities and small metadata, never media bytes. */
export function storageDocument(value: Document): Document {
  /**
   * Keep only stable media identities in a cloud document.  A URL that is
   * useful for the current page (data:, blob:, signed COS/OSS/S3 links, or a
   * task content proxy) is deliberately not a cloud identity.  If a stable
   * assetId is present, the URL can be dropped and regenerated on recovery;
   * otherwise refusing the save is safer than silently making a frozen task
   * unrecoverable.
   */
  const referenceOnly = (
    reference: MediaReference,
    allowEphemeral = false,
    allowLocalAudioVideo = allowEphemeral,
  ): MediaReference => {
    const durableImage = reference.image && isDurableAssetUrl(reference.image) ? reference.image : undefined;
    const durableVideo = reference.video && isDurableAssetUrl(reference.video) ? reference.video : undefined;
    const durableAudio = reference.audio && isDurableAssetUrl(reference.audio) ? reference.audio : undefined;
    const durableContent = reference.videoContentUrl && isDurableAssetUrl(reference.videoContentUrl)
      ? reference.videoContentUrl
      : undefined;
    const hasEphemeralUrl = Boolean(
      (reference.image && !durableImage) ||
      (reference.video && !durableVideo) ||
      (reference.audio && !durableAudio) ||
      (reference.videoContentUrl && !durableContent),
    );
    const localImage = reference.localImage;
    const localVideo = reference.localVideo;
    const localAudio = reference.localAudio;
    const hasInvalidLocalKey = Boolean(
      (localImage && !LOCAL_IMAGE_KEY.test(localImage)) ||
      (localVideo && !isLocalVideoKey(localVideo)) ||
      (localAudio && !isLocalAudioKey(localAudio)),
    );
    if (hasInvalidLocalKey) throw new TemporaryCanvasMediaError();
    // A local key is meaningful only in the current browser. It may accompany
    // a recoverable task/asset identity, but a standalone local reference must
    // stop cloud sync instead of being silently stripped from the document.
    const hasLocalImageOnly = Boolean(localImage && !durableImage && !reference.assetId);
    // A browser-local key is safe to keep only as a fast path for a stable
    // task/asset reference. A submission/idempotency key alone is not enough:
    // it may never have been accepted by the platform, and another browser
    // cannot resolve the local bytes behind it.
    const hasLocalMediaOnly = Boolean(
      (localVideo && !durableVideo && !durableContent || localAudio && !durableAudio && !durableContent) &&
      !reference.assetId && !allowLocalAudioVideo,
    );
    const hasLocalOnly = hasLocalImageOnly || hasLocalMediaOnly;
    if ((hasEphemeralUrl && !reference.assetId || hasLocalOnly) && !allowEphemeral)
      throw new TemporaryCanvasMediaError();
    // Keep a valid local key when a task or asset identity makes the reference
    // recoverable. The key is an optional same-browser fast path; another
    // browser can ignore it and resolve the stable identity instead.
    return {
      // localImage remains a browser cache hint and is intentionally omitted
      // from cloud references. Images are restored from the durable URL or
      // the task/asset identity; unlike audio/video references, the existing
      // image submission contract already treats this key as local-only.
      ...(durableImage ? { image: durableImage } : {}),
      ...(durableVideo ? { video: durableVideo } : {}),
      ...((localVideo && (allowLocalAudioVideo || reference.assetId) && !durableVideo && !durableContent) ? { localVideo } : {}),
      ...(durableAudio ? { audio: durableAudio } : {}),
      ...((localAudio && (allowLocalAudioVideo || reference.assetId) && !durableAudio && !durableContent) ? { localAudio } : {}),
      ...(durableContent ? { videoContentUrl: durableContent } : {}),
      ...(reference.assetId ? { assetId: reference.assetId } : {}),
    };
  };
  const videoReferencesOnly = (
    references: unknown,
    allowEphemeral: boolean,
  ): { type: "image_url" | "audio_url" | "video_url"; url?: string; assetId?: string; mediaType?: "image" | "video" | "audio" }[] | undefined => {
    if (!Array.isArray(references)) return undefined;
    const safe: { type: "image_url" | "audio_url" | "video_url"; url?: string; assetId?: string; mediaType?: "image" | "video" | "audio" }[] = [];
    for (const value of references) {
      if (!value || typeof value !== "object") continue;
      const reference = value as Record<string, unknown>;
      const type = reference.type;
      const url = reference.url;
      if (type !== "image_url" && type !== "audio_url" && type !== "video_url") continue;
      const assetId = typeof reference.assetId === "string" && reference.assetId.trim() ? reference.assetId : undefined;
      const mediaType = reference.mediaType === "image" || reference.mediaType === "video" || reference.mediaType === "audio" ? reference.mediaType : undefined;
      if ((reference.localImage !== undefined && (typeof reference.localImage !== "string" || !LOCAL_IMAGE_KEY.test(reference.localImage))) ||
        (reference.localVideo !== undefined && (typeof reference.localVideo !== "string" || !isLocalVideoKey(reference.localVideo))) ||
        (reference.localAudio !== undefined && (typeof reference.localAudio !== "string" || !isLocalAudioKey(reference.localAudio)))) throw new TemporaryCanvasMediaError();
      const hasLocalSource = [reference.localImage, reference.localVideo, reference.localAudio].some(source => typeof source === "string" && source.length > 0);
      if (typeof url === "string" && url && isDurableAssetUrl(url)) {
        safe.push({ type, url, ...(assetId ? { assetId } : {}), ...(mediaType ? { mediaType } : {}) });
        continue;
      }
      // A signed URL is a delivery address, not a durable canvas identity.
      // Preserve the uploaded asset ID so the URL can be refreshed before a
      // frozen video task is replayed on another device.
      if (assetId) {
        safe.push({ type, assetId, ...(mediaType ? { mediaType } : {}) });
        continue;
      }
      if (hasLocalSource && !allowEphemeral) throw new TemporaryCanvasMediaError();
      if (typeof url === "string" && url && !allowEphemeral) throw new TemporaryCanvasMediaError();
    }
    return safe.length ? safe : undefined;
  };
  const safe = structuredClone(value);
  safe.nodes = safe.nodes.map(node => {
    const musicReference = node.musicReference && typeof node.musicReference === "object" ? node.musicReference as { assetId?: unknown } : undefined;
    const musicSubmission = node.musicSubmission && typeof node.musicSubmission === "object" ? node.musicSubmission as { referenceAssetId?: unknown } : undefined;
    const recoverable = Boolean(node.assetId || node.taskId || musicReference?.assetId || musicSubmission?.referenceAssetId);
    for (const key of ["image", "video", "audio", "videoContentUrl"] as const) {
      const media = node[key];
      if (!media) continue;
      // Legacy proxy paths are not durable identities either. Recovery reads
      // the existing task/asset detail and receives a fresh signed URL there.
      if (recoverable && /(?:^|\/)(?:videos\/[^/?]+|(?:music|voice-design|tts)\/tasks\/[^/?]+)\/content(?:[?#]|$)/.test(media)) { delete node[key]; continue; }
      if (recoverable && node.videoContentUrlExpiresAt && (key === "video" || key === "videoContentUrl")) { delete node[key]; continue; }
      if (isDurableAssetUrl(media)) continue;
      if (!recoverable) throw new TemporaryCanvasMediaError();
      delete node[key];
    }
    // URL expiration is ephemeral and must not outlive the URL it describes.
    delete node.videoContentUrlExpiresAt;
    const localImage = node.localImage;
    const localVideo = node.localVideo;
    const localAudio = node.localAudio;
    const musicReferenceAudio = node.musicReference && typeof node.musicReference === "object"
      ? (node.musicReference as { localAudio?: unknown }).localAudio
      : undefined;
    const musicSubmissionAudio = node.musicSubmission && typeof node.musicSubmission === "object"
      ? (node.musicSubmission as { referenceLocalAudio?: unknown }).referenceLocalAudio
      : undefined;
    if ((localImage && !LOCAL_IMAGE_KEY.test(localImage)) ||
      (localVideo && !isLocalVideoKey(localVideo)) ||
      (localAudio && !isLocalAudioKey(localAudio)) ||
      (musicReferenceAudio !== undefined && !isLocalAudioKey(musicReferenceAudio)) ||
      (musicSubmissionAudio !== undefined && !isLocalAudioKey(musicSubmissionAudio))) {
      throw new TemporaryCanvasMediaError();
    }
    // Local byte-cache keys are optional same-browser fast paths. A node that
    // has no stable task/asset identity is a browser-only source and must be
    // exported or uploaded before it can be synchronized.
    if ((localImage || localVideo || localAudio || musicReferenceAudio || musicSubmissionAudio) && !recoverable)
      throw new TemporaryCanvasMediaError();
    // Image cache keys have historically never been cloud identities. Keep
    // that behavior while audio/video keys remain available as same-browser
    // fast paths for locally created media nodes.
    delete node.localImage;
    delete node.localVideoPoster;
    node.musicReference = normalizeMusicReference(node.musicReference);
    node.musicSubmission = normalizeMusicSubmission(node.musicSubmission);
    node.voiceDesignSubmission = normalizeVoiceDesignSubmission(node.voiceDesignSubmission);
    node.ttsSubmission = normalizeTTSSubmission(node.ttsSubmission);
    node.ttsSettings = normalizeTTSSettings(node.ttsSettings);
    // Thumbnail delivery URLs are signed display accelerators, never durable
    // media identities. A fresh one is returned with the asset/task details.
    delete node.imageThumbnail;
    // Posters are an optional display cache. The underlying stable video
    // identity, validated above, is used to create a fresh poster on demand.
    if (node.videoPoster && !isDurableAssetUrl(node.videoPoster)) delete node.videoPoster;
    if (node.submission) node.submission.images = node.submission.images.map((reference) => referenceOnly(reference, recoverable));
    if (node.videoSubmission?.images) {
      node.videoSubmission.images = node.videoSubmission.images
        .map((reference) => referenceOnly(reference, recoverable, recoverable));
    }
    if (node.videoSubmission?.references) {
      const references = videoReferencesOnly(node.videoSubmission.references, recoverable);
      if (references) node.videoSubmission.references = references;
      else delete node.videoSubmission.references;
    }
    if (node.embeddedReferences) {
      node.embeddedReferences = node.embeddedReferences.map((reference) => {
        // Keep same-browser cache keys for embedded media when the containing
        // node has a stable task identity, while still requiring each media
        // URL to have its own durable asset identity before cloud storage.
        const safeReference = referenceOnly(
          reference,
          Boolean(reference.assetId),
          Boolean(reference.assetId || node.assetId || node.taskId),
        );
        return {
          id: reference.id,
          title: reference.title,
          ...(safeReference.image ? { image: safeReference.image } : {}),
          ...(safeReference.localImage ? { localImage: safeReference.localImage } : {}),
          ...(safeReference.video ? { video: safeReference.video } : {}),
          ...(safeReference.localVideo ? { localVideo: safeReference.localVideo } : {}),
          ...(safeReference.audio ? { audio: safeReference.audio } : {}),
          ...(safeReference.localAudio ? { localAudio: safeReference.localAudio } : {}),
          ...(safeReference.videoContentUrl ? { videoContentUrl: safeReference.videoContentUrl } : {}),
          ...(reference.mediaType ? { mediaType: reference.mediaType } : {}),
          ...(safeReference.assetId ? { assetId: safeReference.assetId } : {}),
        };
      });
    }
    if (node.promptSegments) {
      node.promptSegments = node.promptSegments
        .filter((segment): segment is { type: "text"; text: string } | { type: "reference"; referenceId: string; label: string } => Boolean(
          segment && typeof segment === "object" &&
          ((segment.type === "text" && typeof segment.text === "string") ||
            (segment.type === "reference" && typeof segment.referenceId === "string" && typeof segment.label === "string")),
        ))
        .map((segment) => segment.type === "text"
          ? { type: "text" as const, text: segment.text.slice(0, 20_000) }
          : { type: "reference" as const, referenceId: segment.referenceId.slice(0, 120), label: segment.label.slice(0, 160) });
      if (!node.promptSegments.length) delete node.promptSegments;
    }
    return node;
  });
  if (new TextEncoder().encode(JSON.stringify(safe)).byteLength > MAX_STORAGE_BYTES)
    throw new Error("画布内容超过云端保存限额，请导出完整备份后精简文字或图片。");
  return safe;
}
