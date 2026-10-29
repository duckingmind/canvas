import type { Document } from "./canvas-types.ts";
import type { MediaReference } from "./task-lifecycle.ts";
import { isDurableAssetUrl } from "./asset-library.ts";
import { normalizeMusicReference, normalizeMusicSubmission, normalizeTTSSettings, normalizeTTSSubmission, normalizeVoiceDesignSubmission } from "./audio-creation.ts";
import { normalizePromptSegments, promptSegmentsText } from "./prompt-segments.ts";
import { CanvasDocumentTooLargeError, MAX_CANVAS_DOCUMENT_BYTES } from "./cloud-document-limits.ts";

/** Cloud KV contains stable identities and small metadata, never media bytes. */
export function storageDocument(value: Document): Document {
  /**
   * Keep only stable media identities in a cloud document. URLs useful only
   * for the current page (data:, blob:, signed COS/OSS/S3 links, or task
   * content proxies) are omitted. Generation/import paths own the user-facing
   * identity check; this function is only a cloud-storage projection.
   */
  const referenceOnly = (
    reference: MediaReference,
  ): MediaReference => {
    const durableImage = reference.image && isDurableAssetUrl(reference.image) ? reference.image : undefined;
    const durableVideo = reference.video && isDurableAssetUrl(reference.video) ? reference.video : undefined;
    const durableAudio = reference.audio && isDurableAssetUrl(reference.audio) ? reference.audio : undefined;
    const durableContent = reference.videoContentUrl && isDurableAssetUrl(reference.videoContentUrl)
      ? reference.videoContentUrl
      : undefined;
    // Cloud projection is intentionally best-effort. Generation/import paths
    // must reject incomplete media before committing a completed node; sync
    // only drops browser-local keys and short-lived URLs from the DTO.
    return {
      ...(durableImage ? { image: durableImage } : {}),
      ...(durableVideo ? { video: durableVideo } : {}),
      ...(durableAudio ? { audio: durableAudio } : {}),
      ...(durableContent ? { videoContentUrl: durableContent } : {}),
      ...(reference.mediaType ? { mediaType: reference.mediaType } : {}),
      ...(reference.assetId ? { assetId: reference.assetId } : {}),
    };
  };
  const videoReferencesOnly = (
    references: unknown,
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
      // A temporary/local-only reference has no cloud representation. It is
      // deliberately omitted; the generation path owns the user-facing error.
    }
    return safe.length ? safe : undefined;
  };
  const safe = structuredClone(value);
  // Group frames are derived from node.groupId and geometry. Keep membership
  // in the cloud document, then rebuild frames when the document is hydrated.
  delete safe.groups;
  safe.nodes = safe.nodes.map(node => {
    // Upload progress is browser runtime state. It must never become part of
    // the shared cloud document or make a stale upload look recoverable.
    delete node.uploadState;
    delete node.uploadProgress;
    delete node.uploadError;
    for (const key of ["image", "video", "audio", "videoContentUrl"] as const) {
      const media = node[key];
      if (!media) continue;
      // Legacy proxy paths are not durable identities either. Recovery reads
      // the existing task/asset detail and receives a fresh signed URL there.
      if (/(?:^|\/)(?:videos\/[^/?]+|(?:music|voice-design|tts)\/tasks\/[^/?]+)\/content(?:[?#]|$)/.test(media)) { delete node[key]; continue; }
      if (node.videoContentUrlExpiresAt && (key === "video" || key === "videoContentUrl")) { delete node[key]; continue; }
      if (isDurableAssetUrl(media)) continue;
      delete node[key];
    }
    // URL expiration is ephemeral and must not outlive the URL it describes.
    delete node.videoContentUrlExpiresAt;
    // Local byte-cache keys are browser-only hints. They stay in the local
    // draft, but never become part of the cloud DTO.
    delete node.localImage;
    delete node.localVideo;
    delete node.localAudio;
    delete node.localVideoPoster;
    node.musicReference = normalizeMusicReference(node.musicReference);
    node.musicSubmission = normalizeMusicSubmission(node.musicSubmission);
    if (node.musicReference) {
      delete node.musicReference.localAudio;
      // A reference with neither a local cache key nor an asset identity is
      // not recoverable on another device. Keep the task/submission itself,
      // but do not leave an invalid empty reference in the cloud document.
      if (!node.musicReference.assetId) delete node.musicReference;
    }
    if (node.musicSubmission) {
      delete node.musicSubmission.referenceLocalAudio;
      if (!node.musicSubmission.referenceAssetId) {
        delete node.musicSubmission.referenceTitle;
        delete node.musicSubmission.referenceDuration;
        delete node.musicSubmission.referenceSize;
      }
    }
    node.voiceDesignSubmission = normalizeVoiceDesignSubmission(node.voiceDesignSubmission);
    node.ttsSubmission = normalizeTTSSubmission(node.ttsSubmission);
    node.ttsSettings = normalizeTTSSettings(node.ttsSettings);
    // Thumbnail delivery URLs are signed display accelerators, never durable
    // media identities. A fresh one is returned with the asset/task details.
    delete node.imageThumbnail;
    // Posters are an optional display cache. The underlying stable video
    // identity, validated above, is used to create a fresh poster on demand.
    if (node.videoPoster && !isDurableAssetUrl(node.videoPoster)) delete node.videoPoster;
    if (node.submission) node.submission.images = node.submission.images.map((reference) => referenceOnly(reference));
    if (node.videoSubmission?.images) {
      node.videoSubmission.images = node.videoSubmission.images
        .map((reference) => referenceOnly(reference));
    }
    if (node.videoSubmission?.references) {
      const references = videoReferencesOnly(node.videoSubmission.references);
      if (references) node.videoSubmission.references = references;
      else delete node.videoSubmission.references;
    }
    if (node.embeddedReferences) {
      node.embeddedReferences = node.embeddedReferences.map((reference) => {
        // Embedded media follows the same rule as node media: stable asset
        // identities are cloud data; browser-local keys are local-only.
        const safeReference = referenceOnly(reference);
        return {
          id: reference.id,
          title: reference.title,
          ...(safeReference.image ? { image: safeReference.image } : {}),
          ...(safeReference.video ? { video: safeReference.video } : {}),
          ...(safeReference.audio ? { audio: safeReference.audio } : {}),
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
    // Prompt text is the flattened display fallback for these structured
    // mentions. Store the segment representation once; normalize() rebuilds
    // the readable text field on cloud hydration.
    const normalizedPromptSegments = normalizePromptSegments(node.promptSegments, "", 20_000);
    if (node.type === "prompt" && normalizedPromptSegments.some(segment => segment.type === "reference") &&
      node.text === promptSegmentsText(normalizedPromptSegments))
      node.text = "";
    return node;
  });
  const bytes = new TextEncoder().encode(JSON.stringify(safe)).byteLength;
  if (bytes > MAX_CANVAS_DOCUMENT_BYTES) throw new CanvasDocumentTooLargeError(bytes);
  return safe;
}
