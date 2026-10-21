import type { VideoSubmission } from "./task-lifecycle";
import type { MediaInputSummary } from "./shared/media-diagnostics.ts";

/** Persisted canvas domain types shared by the editor, workspace and stores. */
export type MediaType = "image" | "video" | "audio";
export type NodeType = "note" | "prompt" | "image" | "video" | "audio";
export type Tool = "select" | "hand";
export type Point = { x: number; y: number };
export type Viewport = { x: number; y: number; zoom: number };

export type ImageSettings = {
  quality?: string;
  resolution?: string;
  size?: string;
  aspectRatio?: string;
  count?: number;
  outputFormat?: string;
};

/** How a prompt node acquired its model. Legacy documents omit this field. */
export type ModelSelectionSource = "user" | "default";

export type VideoSettings = {
  duration?: number;
  size?: string;
  resolution?: string;
  aspect_ratio?: string;
  generate_audio?: boolean;
};

export type MusicSettings = {
  audio_mode?: string;
  output_format?: string;
  duration?: number;
  lyrics_optimizer?: boolean;
};

/** Read-only compatibility with documents created before TTS was removed. */
export type TTSSettings = {
  voice_id?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  emotion?: string;
  output_format?: string;
  sample_rate?: number;
  bitrate?: number;
  language_boost?: string;
  pronunciation_rules?: string;
};

export type MusicSubmission = {
  key: string;
  model: string;
  prompt: string;
  lyrics?: string;
  audio_mode?: string;
  output_format?: string;
  duration?: number;
  lyrics_optimizer?: boolean;
  /** Local IndexedDB key; never contains media bytes or a transient URL. */
  referenceLocalAudio?: string;
  /** Stable platform identity allows a frozen submission to recover after a device change. */
  referenceAssetId?: string;
  referenceNodeId?: string;
  referenceTitle?: string;
  referenceDuration?: number;
  referenceSize?: number;
};

export type VoiceDesignSubmission = {
  key: string;
  model: string;
  prompt: string;
  previewText: string;
};

/** Historical submission identity; Canvas no longer submits or polls TTS. */
export type TTSSubmission = {
  key: string;
  model: string;
  text: string;
  settings: TTSSettings;
};

export type MusicReference = {
  localAudio?: string;
  assetId?: string;
  title: string;
  duration: number;
  size: number;
  nodeId?: string;
};

export type ImageSubmission = {
  key: string;
  model: string;
  prompt: string;
  images: { image?: string; localImage?: string; assetId?: string }[];
  count?: number;
  size?: string;
  resolution?: string;
  quality?: string;
  aspectRatio?: string;
  resultBatchId?: string;
  responseFormat?: "url" | "b64_json";
  /** Frozen encoded artifact format; omitted when the model does not declare one. */
  outputFormat?: string;
};
export type EmbeddedImageReference = {
  id: string;
  title: string;
  image?: string;
  /** Short-lived server-signed image preview; never the canonical media identity. */
  imageThumbnail?: string;
  localImage?: string;
  /** Local IndexedDB key for an extracted video embedded in a prompt reference. */
  localVideo?: string;
  /** Local IndexedDB key for an extracted audio embedded in a prompt reference. */
  localAudio?: string;
  video?: string;
  audio?: string;
  videoContentUrl?: string;
  videoContentUrlExpiresAt?: string;
  mediaType?: MediaType;
  assetId?: string;
};

/** A durable prompt fragment used by the creator's inline @ references. */
export type PromptSegment =
  | { type: "text"; text: string }
  | { type: "reference"; referenceId: string; label: string };

export type CanvasNode = {
  id: string;
  type: NodeType;
  title: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image?: string;
  /** Small server-signed image preview used by cards; never the canonical media bytes. */
  imageThumbnail?: string;
  video?: string;
  /** Scoped browser-local bytes for derived video files. */
  localVideo?: string;
  audio?: string;
  videoContentUrl?: string;
  /** Expiration of the current signed URL, not the lifetime of the media asset. */
  videoContentUrlExpiresAt?: string;
  /** Small persisted first-frame preview for videos; never the video bytes. */
  videoPoster?: string;
  localVideoPoster?: string;
  localImage?: string;
  /** Local reference images uploaded from the creator, without canvas nodes. */
  embeddedReferences?: EmbeddedImageReference[];
  /** Optional structured prompt fragments. `text` remains the readable fallback. */
  promptSegments?: PromptSegment[];
  color: string;
  taskId?: string;
  /** Stable media asset identity used by the reusable asset library. */
  assetId?: string;
  error?: string;
  taskPrompt?: string;
  taskDiagnostic?: {
    code?: string;
    requestId?: string;
    status?: string;
    phase?: string;
    assetStatus?: string;
    createdAt?: string;
    summary?: MediaInputSummary;
    supplierConfirmation?: { state?: string; status?: string; source?: string; reason?: string };
  };
  generationBatchId?: string;
  inputSignature?: string;
  modelId?: string;
  /** Preserve explicit choices while allowing idle legacy defaults to refresh. */
  modelSelection?: ModelSelectionSource;
  mediaType?: MediaType;
  imageSettings?: ImageSettings;
  videoDuration?: number;
  videoSize?: string;
  videoResolution?: string;
  videoAspectRatio?: string;
  videoAudio?: boolean;
  videoSettings?: VideoSettings;
  ignoreImageRefs?: boolean;
  submission?: ImageSubmission;
  videoSubmission?: VideoSubmission;
  musicSettings?: MusicSettings;
  ttsSettings?: TTSSettings;
  musicSubmission?: MusicSubmission;
  ttsSubmission?: TTSSubmission;
  musicLyrics?: string;
  /** Audio creator subtype; absent on legacy nodes means music. */
  audioMode?: "music" | "voice_design" | "tts" | "recording";
  audioTaskType?: "music" | "voice_design" | "tts";
  localAudio?: string;
  musicReference?: MusicReference;
  voicePreviewText?: string;
  voiceId?: string;
  voiceTrialAudioAvailable?: boolean;
  voiceDesignSubmission?: VoiceDesignSubmission;
  videoPollingPaused?: boolean;
  /** Why polling stopped; reconciliation can be resumed automatically, user pause cannot. */
  videoPollingReason?: "user" | "reconciliation";
  resultOf?: string;
  resultIndex?: number;
  resultBatchId?: string;
  /** Image editing lineage for locally derived or model-produced outputs. */
  operationId?: string;
  operationParams?: Record<string, string | number | boolean>;
  continuationOf?: string;
  groupId?: string;
  status?: "idle" | "queued" | "running" | "completed" | "failed";
};

export type GroupFrame = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Edge = { id: string; from: string; to: string };

export type Document = {
  id: string;
  name: string;
  createdAt: string;
  deletedAt?: string;
  nodes: CanvasNode[];
  edges: Edge[];
  groups?: GroupFrame[];
  viewport: Viewport;
  updatedAt: string;
};

/** Model catalog records are deliberately permissive: the platform owns the schema. */
export type Model = {
  id?: string;
  name?: string;
  type?: string;
  model_type?: string;
  supported_operations?: string[];
  available?: boolean;
  max_input_images?: number;
  max_reference_images?: number;
  supported_input_modes?: string[];
  supported_durations?: (number | string)[];
  supported_sizes?: string[];
  supported_resolutions?: string[];
  supported_aspect_ratios?: string[];
  supports_audio_generation?: boolean;
  quality_modes?: string[];
  resolution_tiers?: string[];
  output_formats?: string[];
  resolution_sizes?: Record<string, string[]>;
  default_parameters?: Record<string, unknown>;
  platform_capabilities?: Record<string, unknown>;
  max_output_count?: number;
};

export type StorageUsage = {
  used_bytes: number;
  reserved_bytes: number;
  quota_bytes: number;
  available_bytes: number;
  status: string;
  upgrade_url?: string;
  storage_pack_url?: string;
};

export type StoredAsset = {
  id: string;
  task_id: string;
  type: string;
  model?: string;
  size_bytes: number;
  url?: string;
  thumbnail_url?: string;
  url_expires_at?: string;
  content_type?: string;
  status?: string;
  expires_at?: string;
  created_at: string;
  /** Optional for reading older media API responses; asset-library writes require the new metadata contract. */
  name?: string;
  category?: "person" | "scene" | "object" | "style" | "sound" | "other";
  tags?: string[];
  folder?: string;
  saved_to_library?: boolean;
  metadata_revision?: number;
  source_app_id?: string;
  system_tags?: string[];
  updated_at?: string;
};
