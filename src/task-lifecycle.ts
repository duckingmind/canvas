/** Shared normalization for durable media task snapshots. */

export type MediaReference = {
  image?: string;
  localImage?: string;
  video?: string;
  /** Scoped browser-local video bytes. Never a remote delivery URL. */
  localVideo?: string;
  audio?: string;
  /** Scoped browser-local audio bytes. Never a remote delivery URL. */
  localAudio?: string;
  videoContentUrl?: string;
  assetId?: string;
  mediaType?: "image" | "video" | "audio";
};

export type VideoSubmission = {
  key: string;
  model: string;
  prompt: string;
  images?: MediaReference[];
  references?: { type: "image_url" | "audio_url" | "video_url"; url?: string; assetId?: string; mediaType?: "image" | "video" | "audio"; localImage?: string; localVideo?: string; localAudio?: string }[];
  duration?: number;
  size?: string;
  resolution?: string;
  aspect_ratio?: string;
  generate_audio?: boolean;
};

type RecordValue = Record<string, unknown>;

const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" ? value as RecordValue : {};

const string = (value: unknown) => typeof value === "string" ? value : undefined;

export const isValidTaskId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

/** Stable, collision-safe identity for one resumable task in one canvas. */
export function taskRecoveryKey(
  canvasId: string,
  nodeId: string,
  taskId?: string,
  submissionKey?: string,
): string {
  return JSON.stringify([canvasId, nodeId, taskId || submissionKey || "submission"]);
}

/** Read current and legacy task ID fields without persisting duplicate aliases. */
export function resolveTaskId(value: unknown): string | undefined {
  const node = record(value);
  for (const candidate of [node.taskId, node.videoTaskId, node.video_task_id]) {
    if (isValidTaskId(candidate)) return candidate;
  }
  return undefined;
}

function normalizeReference(value: unknown): MediaReference | undefined {
  if (typeof value === "string") return value ? { image: value } : undefined;
  const item = record(value);
  const nested = record(item.image_url);
  const image = string(item.image) || string(item.url) || string(nested.url);
  const video = string(item.video) || string(item.video_url);
  const audio = string(item.audio) || string(item.audio_url);
  const localVideo = string(item.localVideo);
  const localAudio = string(item.localAudio);
  const videoContentUrl = string(item.videoContentUrl) || string(item.video_content_url);
  const assetId = string(item.assetId) || string(item.asset_id);
  const localImage = string(item.localImage);
  const mediaType = item.mediaType === "image" || item.mediaType === "video" || item.mediaType === "audio" ? item.mediaType : undefined;
  return image || localImage || video || localVideo || audio || localAudio || videoContentUrl || assetId ? {
    ...(image ? { image } : {}),
    ...(localImage ? { localImage } : {}),
    ...(video ? { video } : {}),
    ...(localVideo ? { localVideo } : {}),
    ...(audio ? { audio } : {}),
    ...(localAudio ? { localAudio } : {}),
    ...(videoContentUrl ? { videoContentUrl } : {}),
    ...(assetId ? { assetId } : {}),
    ...(mediaType ? { mediaType } : {}),
  } : undefined;
}

/** Accept both the original string[] and the current {image, localImage}[] form. */
export function normalizeMediaReferences(value: unknown): MediaReference[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(normalizeReference).filter((item): item is MediaReference => Boolean(item));
}

export function normalizeVideoSubmission(value: unknown): VideoSubmission | undefined {
  const input = record(value);
  const key = string(input.key);
  const model = string(input.model);
  const prompt = string(input.prompt);
  if (!key || !model || !prompt) return undefined;
  const rawImages = input.images !== undefined ? input.images : input.input_references;
  const images = normalizeMediaReferences(rawImages);
  const references = Array.isArray(input.references)
      ? input.references.filter((item): item is { type: "image_url" | "audio_url" | "video_url"; url?: string; assetId?: string; mediaType?: "image" | "video" | "audio"; localImage?: string; localVideo?: string; localAudio?: string } => {
        const value = record(item);
        return (value.type === "image_url" || value.type === "audio_url" || value.type === "video_url") &&
          (typeof value.url === "string" && Boolean(value.url) || typeof value.assetId === "string" && Boolean(value.assetId) || typeof value.localImage === "string" && Boolean(value.localImage) || typeof value.localVideo === "string" && Boolean(value.localVideo) || typeof value.localAudio === "string" && Boolean(value.localAudio));
      })
    : undefined;
  return {
    key,
    model,
    prompt,
    ...(images !== undefined ? { images } : {}),
    ...(references !== undefined ? { references } : {}),
    ...(typeof input.duration === "number" && Number.isFinite(input.duration) ? { duration: input.duration } : {}),
    ...(typeof input.size === "string" ? { size: input.size } : {}),
    ...(typeof input.resolution === "string" ? { resolution: input.resolution } : {}),
    ...(typeof input.aspect_ratio === "string" ? { aspect_ratio: input.aspect_ratio } : {}),
    ...(typeof input.generate_audio === "boolean" ? { generate_audio: input.generate_audio } : {}),
  };
}
