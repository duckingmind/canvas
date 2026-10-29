import React from "react";
import {
  ArrowUp,
  Brush,
  Check,
  ChevronDown,
  Film,
  ImagePlus,
  Library,
  Link2,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Music2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  SlidersHorizontal,
  Type,
  Upload,
  X,
} from "lucide-react";
import {
  compatibleModels,
  modelsForType,
  modelUnavailableReason,
  isMediaModelRecovering,
  preferredModel,
  selectedModelIdForNode,
  resolveVideoSettings,
  videoOptions,
  type MediaModel,
  type VideoSettings,
} from "./video-models";
import { compatibleMusicModels, musicModelUnavailableReason, musicModels, musicOptions, preferredMusicModel, resolveMusicSettings, type MusicModel } from "./music-models";
import { compatibleVoiceDesignModels, isVoiceDesignModel, preferredVoiceDesignModel, voiceDesignModelUnavailableReason, type VoiceDesignModel } from "./voice-design-models";
import { isTTSNode } from "./audio-creation";
import { hasPendingNodeTask } from "./node-interaction";
import { canCreateNewCanvasTask, canRetryMissedSubmission, canvasTaskRetryPolicy, canvasTaskState, isVideoResultUnconfirmed, pendingTaskLabel } from "./video-task-state";
import { creationInputSignature } from "./creation-state";
import { isComposingKey, isGenerateShortcut } from "./keyboard";
import { imageOptions, imageAspectRatios, imageQualityLabel, imageSettingsSummary, resolveImageSettings } from "./image-models";
import ParameterPopover from "./ParameterPopover";
import { ParameterChoices, RatioMark } from "./ParameterChoices";
import { estimatedCostLabel, mediaEstimateRequest } from "./cost-estimate";
import { useCostEstimate } from "./use-cost-estimate";
import { imagePreviewURL } from "./image-variants";
import AudioRecorder from "./AudioRecorder";
import PromptMentionInput, { type MentionCandidate } from "./PromptMentionInput";
import type { PromptMentionAssetCandidate } from "./usePromptMentionAssets";
import { normalizePromptSegments, promptReferenceDisplayLabel, promptSegmentsHaveReferences, promptSegmentsText } from "./prompt-segments.ts";
import type { PromptSegment } from "./canvas-types";
import "./creator.css";

type Node = {
  id: string;
  title: string;
  text: string;
  type: "note" | "prompt" | "image" | "video" | "audio";
  image?: string;
  imageThumbnail?: string;
  localImage?: string;
  video?: string;
  audio?: string;
  localAudio?: string;
  videoContentUrl?: string;
  assetId?: string;
  taskId?: string;
  status?: string;
  error?: string;
  modelId?: string;
  modelSelection?: "user" | "default";
  ignoreImageRefs?: boolean;
  embeddedReferences?: { id: string; title: string; image?: string; imageThumbnail?: string; localImage?: string; video?: string; localVideo?: string; audio?: string; localAudio?: string; videoContentUrl?: string; assetId?: string }[];
  taskPrompt?: string;
  inputSignature?: string;
  submission?: { key: string };
  musicSubmission?: { key: string };
  voiceDesignSubmission?: { key: string };
  ttsSubmission?: { key: string };
  mediaType?: "image" | "video" | "audio";
  videoSettings?: VideoSettings;
  musicSettings?: { audio_mode?: string; output_format?: string; duration?: number; lyrics_optimizer?: boolean };
  musicLyrics?: string;
  audioMode?: "music" | "voice_design" | "tts" | "recording";
  audioTaskType?: "music" | "voice_design" | "tts";
  voicePreviewText?: string;
  voiceId?: string;
  musicReference?: { localAudio?: string; assetId?: string; title: string; duration: number; size: number; nodeId?: string };
  videoDuration?: number;
  videoSize?: string;
  videoResolution?: string;
  videoAspectRatio?: string;
  videoAudio?: boolean;
  videoTaskId?: string;
  imageSettings?: { quality?: string; resolution?: string; size?: string; aspectRatio?: string; count?: number; outputFormat?: string };
  videoSubmission?: { key: string };
  videoPollingPaused?: boolean;
  videoPollingReason?: "user" | "reconciliation";
  taskDiagnostic?: { status?: string; code?: string; phase?: string; assetStatus?: string; requestId?: string; supplierConfirmation?: { state?: string }; summary?: { model?: string; reference_count?: number; duration?: number; resolution?: string; aspect_ratio?: string } };
  taskStage?: string;
  cancelRequested?: boolean;
  /** Optional asset metadata supplied by the platform. */
  assetCategory?: string;
  category?: string;
  promptSegments?: PromptSegment[];
};
type Model = {
  id?: string;
  name?: string;
  type?: string;
  model_type?: string;
  is_default?: boolean;
  supported_operations?: string[];
  supported_input_modes?: string[];
  supported_parameters?: Record<string, unknown>;
  platform_capabilities?: Record<string, unknown>;
  max_input_images?: number;
  max_reference_images?: number;
  quality_modes?: string[]; resolution_tiers?: string[]; supported_sizes?: string[]; supported_aspect_ratios?: string[]; output_formats?: string[]; max_output_count?: number;
};
type Reference = { nodeId: string; title: string; image?: string; imageThumbnail?: string; localImage?: string; video?: string; localVideo?: string; audio?: string; localAudio?: string; videoContentUrl?: string; assetId?: string; embedded?: boolean };
export type CreatorPanelProps = {
  node: Node;
  models: (Model & Partial<MediaModel>)[];
  textReferences: { nodeId: string; title: string; text: string }[];
  references: Reference[];
  videoReferences?: Reference[];
  referenceCandidates: Node[];
  mentionCandidates: Node[];
  /** Library candidates are owned by the app shell and loaded lazily. */
  mentionAssetCandidates?: PromptMentionAssetCandidate[];
  mentionAssetsLoading?: boolean;
  mentionAssetsError?: string;
  mentionAssetsHasMore?: boolean;
  onLoadMentionAssets?: () => void;
  onLoadMoreMentionAssets?: () => void;
  onRetryMentionAssets?: () => void;
  onSelectMentionCandidate?: (id: string) => Promise<PromptMentionAssetCandidate | false>;
  referenceNaming: "name" | "number";
  referenceRequest?: number;
  /** Increment to move keyboard focus back to the prompt after a canvas shortcut. */
  focusRequest?: number;
  onFocusHandled: () => void;
  onNotice: (text: string, action?: { label: string; run: () => void }) => void;
  sources: Node[];
  inputChanged: boolean;
  style?: React.CSSProperties;
  active: boolean;
  connecting: boolean;
  connectionError: string;
  validationError?: string;
  needsLogin: boolean;
  connectionActionLabel: string;
  modelPlaceholder: string;
  onChange: (patch: Partial<Node>) => void;
  onGenerate: (inputChanged?: boolean) => void;
  /** Create an editable copy without replaying the unresolved submission. */
  onCancel?: () => void;
  canceling?: boolean;
  onRefresh: () => void;
  results?: Node[];
  onLocate: (id: string) => void;
  onDisconnect: (id: string) => void;
  onAddReference: (id: string) => boolean | void;
  onPickCanvasReference: () => void;
  onPickCanvasTextReference: () => void;
  onUploadReference: () => void;
  onOpenAssetLibrary?: () => void;
  onDrawReference: () => void;
  onSaveRecording?: (file: File) => Promise<void> | void;
  onUploadMusicReference?: (file: File) => Promise<void> | void;
  onSelectMusicReference?: (nodeId: string) => Promise<void> | void;
  onGenerateLyrics?: (prompt: string) => Promise<string>;
  audioReferenceCandidates?: Node[];
  onClose: () => void;
};

export default function CreatorPanel(p: CreatorPanelProps) {
  const isVideo = p.node.mediaType === "video";
  const isMusic = p.node.mediaType === "audio";
  const audioMode = isMusic ? p.node.audioMode || "music" : "music";
  const isVoiceDesign = isMusic && audioMode === "voice_design";
  const retiredTTS = isMusic && (audioMode === "tts" || isTTSNode(p.node));
  const isRecording = isMusic && audioMode === "recording";
  const voiceModels = p.models.filter(model => isVoiceDesignModel(model as VoiceDesignModel)) as (Model & Partial<MediaModel> & MusicModel)[];
  // Keep the origin explicit so the picker can treat canvas nodes and
  // paginated library assets as one list without losing their identity.
  const mentionCandidates: MentionCandidate[] = [
    ...p.mentionCandidates.map(candidate => ({ ...candidate, source: "canvas" as const })),
    ...(p.mentionAssetCandidates || []).map(candidate => ({ ...candidate, source: "library" as const })),
  ];
  const visibleReferences = isVideo ? [...p.references, ...(p.videoReferences || [])] : isMusic ? [] : p.references;
  const initialMaxLength = p.node.audioMode === "tts" ? 50000 : 20000;
  const [promptSegments, setPromptSegments] = React.useState<PromptSegment[]>(() => normalizePromptSegments(p.node.promptSegments, p.node.text, initialMaxLength));
  const [draft, setDraft] = React.useState(() => promptSegmentsText(normalizePromptSegments(p.node.promptSegments, p.node.text, initialMaxLength)));
  const [expanded, setExpanded] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [musicReferenceOpen, setMusicReferenceOpen] = React.useState(false);
  // Keep the composer compact when reopening a music node. Existing lyrics
  // remain attached and are surfaced by the toolbar status until requested.
  const [lyricsExpanded, setLyricsExpanded] = React.useState(false);
  const [voicePreviewOpen, setVoicePreviewOpen] = React.useState(false);
  const [lyricsGenerating, setLyricsGenerating] = React.useState(false);
  const [lyricsReady, setLyricsReady] = React.useState(false);
  const [referenceBusy, setReferenceBusy] = React.useState(false);
  const [recordingSaving, setRecordingSaving] = React.useState(false);
  const [recordingSaved, setRecordingSaved] = React.useState(false);
  const [recordingRedo, setRecordingRedo] = React.useState(false);
  const [recordingSaveFailed, setRecordingSaveFailed] = React.useState(false);
  const [recordingHasUncommittedCapture, setRecordingHasUncommittedCapture] = React.useState(false);
  const [recorderCycle, setRecorderCycle] = React.useState(0);
  const audioScope = `${p.node.id}:${audioMode}`;
  const currentAudioScope = React.useRef({ identity: audioScope });
  if (currentAudioScope.current.identity !== audioScope) currentAudioScope.current = { identity: audioScope };
  const mounted = React.useRef(true);
  const saveInFlight = React.useRef(false);
  const referenceInFlight = React.useRef(false);
  const lyricsInFlight = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const lastErrorNotice = React.useRef("");
  React.useEffect(() => {
    const message = p.validationError || p.connectionError;
    if (!message) {
      lastErrorNotice.current = "";
      return;
    }
    if (message === lastErrorNotice.current) return;
    lastErrorNotice.current = message;
    p.onNotice(message, p.connectionError && !p.validationError ? { label: "重新加载模型", run: p.onRefresh } : undefined);
  }, [p.connectionError, p.onNotice, p.onRefresh, p.validationError]);
  const musicReferenceInput = React.useRef<HTMLInputElement>(null);
  const audioReferenceCandidates = (p.audioReferenceCandidates || []).filter(candidate => candidate.id !== p.node.id);
  const [modelOpen, setModelOpen] = React.useState(false);
  const modelSelect = React.useRef<HTMLDivElement>(null);
  const modelTrigger = React.useRef<HTMLButtonElement>(null);
  const [pickingReference, setPickingReference] = React.useState(false);
  const [referencePickerMode, setReferencePickerMode] = React.useState<"menu" | "assets">("menu");
  const [referenceSearch, setReferenceSearch] = React.useState("");
  const [assetCategory, setAssetCategory] = React.useState<"character" | "scene" | "prop" | "collection">("character");
  const [assetLibraryTab, setAssetLibraryTab] = React.useState<"assets" | "actors">("assets");
  const picker = React.useRef<HTMLDivElement>(null);
  const pickerDismissTimer = React.useRef<number | null>(null);
  const settingsButton = React.useRef<HTMLButtonElement>(null);
  const settingsId = React.useId();
  const musicReferenceId = React.useId();
  const musicLyricsId = React.useId();
  const voicePreviewId = React.useId();
  const musicReferenceTrigger = React.useRef<HTMLButtonElement>(null);
  const musicLyricsTrigger = React.useRef<HTMLButtonElement>(null);
  const voicePreviewTrigger = React.useRef<HTMLButtonElement>(null);
  const referenceButton = React.useRef<HTMLButtonElement>(null);
  const promptInput = React.useRef<HTMLElement | null>(null);
  const promptHintId = React.useId();
  const pickerId = React.useId();
  React.useEffect(() => {
    const nextSegments = normalizePromptSegments(p.node.promptSegments, p.node.text, p.node.audioMode === "tts" ? 50000 : 20000);
    setPromptSegments(nextSegments);
    setDraft(promptSegmentsText(nextSegments));
  }, [p.node.id, p.node.text, p.node.promptSegments]);
  React.useEffect(() => {
    setPickingReference(false);
    setReferencePickerMode("menu");
    setReferenceSearch("");
    setExpanded(false);
    setSettingsOpen(false);
    setModelOpen(false);
    setMusicReferenceOpen(false);
    setLyricsExpanded(false);
  }, [p.node.id]);
  React.useEffect(() => {
    setLyricsReady(false);
    setLyricsGenerating(false);
    setLyricsExpanded(false);
    setMusicReferenceOpen(false);
    setVoicePreviewOpen(false);
    setReferenceBusy(false);
    setRecordingSaving(false);
    setRecordingSaved(false);
    setRecordingRedo(false);
    setRecordingSaveFailed(false);
    setRecordingHasUncommittedCapture(false);
    saveInFlight.current = false;
    referenceInFlight.current = false;
    lyricsInFlight.current = false;
  }, [audioScope]);
  React.useEffect(() => {
    setReferenceSearch("");
  }, [assetLibraryTab, assetCategory]);
  React.useEffect(() => {
    if (p.referenceRequest) setPickingReference(true);
  }, [p.referenceRequest]);
  React.useLayoutEffect(() => {
    if (!p.focusRequest) return;
    promptInput.current?.focus({ preventScroll: true });
    p.onFocusHandled();
  }, [p.focusRequest, p.onFocusHandled]);
  React.useEffect(() => {
    if (!pickingReference) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof globalThis.Node &&
        !picker.current?.contains(event.target) &&
        !referenceButton.current?.contains(event.target)
      )
        setPickingReference(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [pickingReference]);
  React.useEffect(() => () => {
    if (pickerDismissTimer.current !== null) window.clearTimeout(pickerDismissTimer.current);
  }, []);
  React.useEffect(() => {
    if (!modelOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof globalThis.Node && !modelSelect.current?.contains(event.target))
        setModelOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isComposingKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setModelOpen(false);
      modelTrigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [modelOpen]);
  const pending = hasPendingNodeTask(p.node);
  const resultUnconfirmed = isVideoResultUnconfirmed(p.node);
  const taskState = canvasTaskState(p.node, p.active);
  const retryPolicy = canvasTaskRetryPolicy(p.node);
  const canRetryOriginalSubmission = canRetryMissedSubmission(p.node);
  const needsRecovery = pending || resultUnconfirmed || ["unknown", "reconciliation", "no_task_id"].includes(taskState);
  // Task submission and prompt editing are separate concerns. Once a request
  // has been frozen, the model/references/parameter controls must stay stable
  // so the in-flight request cannot be changed. The prompt itself remains
  // editable while that request runs, which lets the user prepare the next
  // generation without mutating the captured `taskPrompt`.
  const controlsLocked = pending || p.active || needsRecovery || recordingSaving || recordingHasUncommittedCapture || referenceBusy || lyricsGenerating || retiredTTS && Boolean(p.node.taskId || p.node.ttsSubmission || p.node.audioTaskType);
  const promptReadOnly = canRetryOriginalSubmission || recordingSaving || recordingHasUncommittedCapture || referenceBusy || lyricsGenerating || retiredTTS && Boolean(p.node.taskId || p.node.ttsSubmission || p.node.audioTaskType);
  const draftChanged = draft !== p.node.text || JSON.stringify(promptSegmentsHaveReferences(promptSegments) ? promptSegments : undefined) !== JSON.stringify(p.node.promptSegments);
  // Upstream text is shown as source chips above the editor. Keep the textarea
  // scoped to the creator's own description so long source text cannot be
  // silently duplicated into the editable prompt or clipped in the panel.
  const fullPrompt = [...p.textReferences.map(reference => reference.text.trim()), draft.trim()].filter(Boolean).join("\n\n");
  const usesImages = visibleReferences.length > 0 && !p.node.ignoreImageRefs;
  const kind = isVideo ? "video" : "image";
  const referenceCount = usesImages ? new Set(visibleReferences.map(ref => ref.image || ref.video || ref.videoContentUrl || ref.assetId || ref.nodeId)).size : 0;
  const musicHasReference = Boolean(p.node.musicReference);
  const typeModels = (retiredTTS ? [] : isMusic
    ? isVoiceDesign ? voiceModels : musicModels(p.models as MusicModel[])
    : modelsForType(p.models, kind)) as (MediaModel & MusicModel)[];
  const compatible = isMusic
    ? isVoiceDesign ? compatibleVoiceDesignModels(typeModels as VoiceDesignModel[]) : compatibleMusicModels(typeModels as MusicModel[], musicHasReference ? "reference_audio" : "text")
    : compatibleModels(p.models as MediaModel[], isVideo ? "video" : "image", referenceCount);
  const preferred = selectedModelIdForNode(p.node);
  const chosen = compatible.find((m) => m.id === preferred) || (isMusic
    ? isVoiceDesign ? preferredVoiceDesignModel(voiceModels as VoiceDesignModel[]) as (MediaModel & MusicModel) | undefined : preferredMusicModel(typeModels as MusicModel[], musicHasReference ? "reference_audio" : "text")
    : preferredModel(p.models as MediaModel[], kind, referenceCount));
  const videoConfig = isVideo
    ? videoOptions(chosen as MediaModel | undefined)
    : undefined;
  const imageConfig = !isVideo && !isMusic ? imageOptions(chosen as MediaModel | undefined) : undefined;
  const musicConfig = isMusic && !isVoiceDesign ? musicOptions(chosen as MusicModel | undefined) : undefined;
  const imageSettings = resolveImageSettings(chosen, p.node.imageSettings);
  const imageRatios = imageAspectRatios(chosen, imageSettings.resolution);
  const imageSizes = imageConfig?.resolutionSizes[imageSettings.resolution || ""] || imageConfig?.sizes || [];
  const hasImageSettings = Boolean(imageConfig && (imageConfig.qualities.length || imageConfig.resolutions.length || imageSizes.length || imageConfig.ratios.length || imageConfig.maxCount > 1));
  const changeImageSetting = (patch: NonNullable<Node["imageSettings"]>) => {
    if (controlsLocked) return;
    p.onChange({ imageSettings: resolveImageSettings(chosen, { ...imageSettings, ...patch }) });
  };
  const resolvedVideo = isVideo
    ? resolveVideoSettings(chosen as MediaModel | undefined, {
        duration: p.node.videoSettings?.duration ?? p.node.videoDuration,
        size: p.node.videoSettings?.size ?? p.node.videoSize,
        resolution: p.node.videoSettings?.resolution ?? p.node.videoResolution,
        aspect_ratio: p.node.videoSettings?.aspect_ratio ?? p.node.videoAspectRatio,
        generate_audio: p.node.videoSettings?.generate_audio ?? p.node.videoAudio,
      })
    : undefined;
  const resolvedMusic = isMusic && !isVoiceDesign ? resolveMusicSettings(chosen as MusicModel | undefined, p.node.musicSettings) : undefined;
  const musicIsInstrumental = /instrumental|pure|纯音乐/i.test(resolvedMusic?.audio_mode || "");
  const lyricsEditorOpen = lyricsExpanded && !musicIsInstrumental;
  const missing = usesImages && (isVideo
    ? visibleReferences.some((ref) => !ref.image && !ref.video && !ref.audio && !ref.videoContentUrl && !ref.assetId)
    : p.references.some((ref) => !ref.image));
  const voicePreviewText = p.node.voicePreviewText || "";
  const blocked = retiredTTS
    ? "画布暂不支持文本转语音。"
    : missing
    ? isVideo ? "有参考素材尚未恢复，请重新上传或重新选择。" : "有参考图片尚未恢复，请重新上传或改为仅使用文字。"
    : !chosen
        ? `请选择支持当前输入的${isVideo ? "视频" : isVoiceDesign ? "音色" : isMusic ? "音乐" : "图片"}模型。`
        : isVoiceDesign && !voicePreviewText.trim()
          ? "请填写音色试听文本。"
        : isVoiceDesign && [...voicePreviewText].length > 500
          ? "试听文本最多 500 个字符。"
        : !fullPrompt.trim()
          ? isVoiceDesign ? "先描述你希望生成的音色。" : isMusic ? "先描述你希望生成的音乐。" : "先描述你希望生成的画面。"
        : "";
  const generateLabel = isVideo ? "生成视频" : isVoiceDesign ? "生成音色" : isMusic ? "生成音乐" : "生成图片";
  const submitLabel = canRetryOriginalSubmission ? "重试原提交" : p.active || needsRecovery ? pendingTaskLabel(p.node, p.active) : generateLabel;
  const submitIcon = canRetryOriginalSubmission
    ? <RefreshCw size={17} />
    : p.active || needsRecovery
    ? <LoaderCircle className="spin" size={18} />
    : <ArrowUp size={19} />;
  const costEstimate = useCostEstimate(p.node.id, chosen?.id && !p.needsLogin && !p.connecting && !isMusic
    ? mediaEstimateRequest(isVideo
        ? { model: chosen.id, kind: "video", settings: resolvedVideo || {}, referenceCount }
        : { model: chosen.id, kind: "image", settings: imageSettings, referenceCount })
    : null);
  const costLabel = costEstimate ? estimatedCostLabel(costEstimate) : "";
  const persistDraft = () => {
    if (retiredTTS) return;
    const text = promptSegmentsText(promptSegments);
    const savedSegments = promptSegmentsHaveReferences(promptSegments) ? promptSegments : undefined;
    if (text !== p.node.text || JSON.stringify(savedSegments) !== JSON.stringify(p.node.promptSegments)) {
      p.onChange({ text, promptSegments: savedSegments });
    }
  };
  const submit = () => {
    if (submitDisabled) return;
    if (canRetryOriginalSubmission) {
      p.onGenerate(false);
      return;
    }
    persistDraft();
    p.onGenerate(inputChanged);
  };
  const close = () => {
    if (recordingSaving) {
      p.onNotice("录音正在保存，请稍候再关闭。");
      return;
    }
    if (isRecording && recordingHasUncommittedCapture && !window.confirm("录音尚未保存，关闭后会丢弃这段录音。确定关闭吗？")) return;
    persistDraft();
    p.onClose();
  };
  const openReferencePicker = () => {
    if (controlsLocked) return;
    if (pickerDismissTimer.current !== null) {
      window.clearTimeout(pickerDismissTimer.current);
      pickerDismissTimer.current = null;
    }
    setSettingsOpen(false);
    setModelOpen(false);
    setReferencePickerMode("menu");
    setPickingReference(true);
  };
  const scheduleReferencePickerDismiss = () => {
    if (pickerDismissTimer.current !== null) window.clearTimeout(pickerDismissTimer.current);
    pickerDismissTimer.current = window.setTimeout(() => {
      pickerDismissTimer.current = null;
      setPickingReference(false);
    }, 120);
  };
  const keepReferencePickerOpen = () => {
    if (pickerDismissTimer.current !== null) {
      window.clearTimeout(pickerDismissTimer.current);
      pickerDismissTimer.current = null;
    }
  };
  const focusPrompt = () =>
    requestAnimationFrame(() => promptInput.current?.focus());
  const connectedIds = new Set(
    visibleReferences.map((reference) => reference.nodeId),
  );
  // A generated image may exist as more than one canvas node (for example
  // after continuing a task). Treat the image itself as the identity so the
  // picker does not show the same reference again above the selected strip.
  const connectedImages = new Set(
    visibleReferences.map((reference) => reference.image || reference.video || reference.audio || reference.videoContentUrl || reference.assetId).filter(Boolean),
  );
  // Asset mode uses the same server-provided canvas assets, but keeps selected
  // items visible so the user can see which references are already attached.
  // Category metadata is optional; when it is absent the platform has not
  // classified the asset yet, so tabs remain a visual filter without hiding it.
  const assetCandidates = p.referenceCandidates.filter(
    (candidate) => candidate.id !== p.node.id && (Boolean(candidate.image) || (isVideo && Boolean(candidate.video || candidate.audio || candidate.videoContentUrl || candidate.assetId))),
  );
  const assetCategoryValue = (candidate: Node) => {
    const value = candidate.assetCategory || candidate.category;
    if (value === "character" || value === "scene" || value === "prop" || value === "collection") return value;
    return undefined;
  };
  const hasAssetCategories = assetCandidates.some((candidate) => Boolean(assetCategoryValue(candidate)));
  const assetVisibleCandidates = assetCandidates.filter((candidate) => {
    const matchesSearch = candidate.title.toLocaleLowerCase().includes(referenceSearch.trim().toLocaleLowerCase());
    const category = assetCategoryValue(candidate);
    return matchesSearch && (!hasAssetCategories || !category || category === assetCategory);
  });
  const assetCategoryCounts = {
    character: assetCandidates.filter((candidate) => assetCategoryValue(candidate) === "character").length,
    scene: assetCandidates.filter((candidate) => assetCategoryValue(candidate) === "scene").length,
    prop: assetCandidates.filter((candidate) => assetCategoryValue(candidate) === "prop").length,
    collection: assetCandidates.filter((candidate) => assetCategoryValue(candidate) === "collection").length,
  };
  const assetTabs: Array<{ key: typeof assetCategory; label: string }> = [
    { key: "character", label: "角色" },
    { key: "scene", label: "场景" },
    { key: "prop", label: "道具" },
    { key: "collection", label: "合集" },
  ];
  const updatePromptSegments = (segments: PromptSegment[]) => {
    const normalized = normalizePromptSegments(segments, "", 20000);
    setPromptSegments(normalized);
    setDraft(promptSegmentsText(normalized));
  };
  const inputChanged =
    p.inputChanged || Boolean(p.node.inputSignature && draft !== p.node.text);
  const canCreateNewTask = canCreateNewCanvasTask(p.node, inputChanged);
  const submitDisabled = p.active || needsRecovery && !canRetryOriginalSubmission || !canCreateNewTask || p.needsLogin || p.connecting || Boolean(blocked) && !canRetryOriginalSubmission || referenceBusy || lyricsGenerating;
  const musicObservedStatus = String(p.node.taskDiagnostic?.status || p.node.status || "").trim().toLowerCase();
  const musicCancellationPending = ["cancel_requested", "cancel_pending", "canceling"].includes(musicObservedStatus);
  const canCancelAudio = isMusic && !isRecording && Boolean(p.node.taskId) && taskState === "queued" && !["completed", "succeeded", "success", "failed", "cancelled", "canceled"].includes(musicObservedStatus);
  const modelPlaceholder = p.connecting ? "正在加载模型…" : p.needsLogin ? "请先登录"
    : !typeModels.length ? `暂无${isVideo ? "视频" : isVoiceDesign ? "音色" : isMusic ? "音乐" : "图片"}模型` : `选择${isVideo ? "视频" : isVoiceDesign ? "音色" : isMusic ? "音乐" : "图片"}模型`;
  const changeVideoSetting = (patch: VideoSettings) => {
    if (controlsLocked) return;
    p.onChange({ videoSettings: { ...(p.node.videoSettings || {}), ...patch } });
  };
  const changeMusicSetting = (patch: NonNullable<Node["musicSettings"]>) => {
    if (controlsLocked) return;
    p.onChange({ musicSettings: { ...(p.node.musicSettings || {}), ...patch } });
  };
  const videoSettingsSummary = resolvedVideo
    ? [
        resolvedVideo.aspect_ratio,
        resolvedVideo.resolution || resolvedVideo.size,
        Number.isFinite(resolvedVideo.duration) ? `${resolvedVideo.duration} 秒` : "",
      ].filter(Boolean).join(" · ") || "视频参数"
    : "视频参数";
  const musicSettingsSummary = resolvedMusic
    ? [
        resolvedMusic.output_format?.toUpperCase(),
        Number.isFinite(resolvedMusic.duration) ? `${resolvedMusic.duration} 秒` : "",
      ].filter(Boolean).join(" · ") || "音乐参数"
    : "音乐参数";
  const selectModel = (id: string) => {
    if (controlsLocked) return;
    p.onChange({ modelId: id, modelSelection: "user" });
    setModelOpen(false);
    modelTrigger.current?.focus({ preventScroll: true });
  };
  const chosenRecovering = !isMusic && isMediaModelRecovering(chosen as MediaModel | undefined);
  const modelLabel = `${chosen?.name || chosen?.id || modelPlaceholder}${chosenRecovering ? " · 恢复试流中" : ""}`;
  const modelReason = (model: MediaModel & MusicModel) => isMusic
    ? isVoiceDesign ? voiceDesignModelUnavailableReason(model as VoiceDesignModel) : musicModelUnavailableReason(model, musicHasReference ? "reference_audio" : "text")
    : modelUnavailableReason(model, kind, referenceCount);
  const changeAudioMode = (mode: "music" | "voice_design" | "recording") => {
    if (controlsLocked || mode === audioMode) return;
    setPickingReference(false);
    setSettingsOpen(false);
    setModelOpen(false);
    setMusicReferenceOpen(false);
    setLyricsExpanded(false);
    setVoicePreviewOpen(false);
    p.onChange({ audioMode: mode });
    if (mode === "recording") {
      setRecordingSaved(false);
      setRecordingRedo(false);
      setRecorderCycle(value => value + 1);
    }
  };
  const audioScopeIsCurrent = (scope: { identity: string }) => mounted.current && currentAudioScope.current === scope;
  const saveRecording = async (file: File) => {
    if (!p.onSaveRecording || saveInFlight.current) return;
    const scope = currentAudioScope.current;
    saveInFlight.current = true;
    setRecordingSaving(true);
    try {
      await p.onSaveRecording(file);
      if (audioScopeIsCurrent(scope)) {
        setRecordingRedo(false);
        setRecordingSaved(true);
        setRecordingSaveFailed(false);
        setRecordingHasUncommittedCapture(false);
      }
    } catch (error) {
      if (audioScopeIsCurrent(scope)) {
        setRecordingSaveFailed(true);
        p.onNotice(error instanceof Error ? error.message : "录音保存失败，请重试。");
      }
    } finally {
      if (audioScopeIsCurrent(scope)) {
        saveInFlight.current = false;
        setRecordingSaving(false);
      }
    }
  };
  const recordingHasSavedNode = isRecording && p.node.status === "completed" && Boolean(p.node.audio || p.node.localAudio || p.node.assetId);
  const recordingIsSaved = recordingSaved || (recordingHasSavedNode && !recordingRedo);
  const startAnotherRecording = () => {
    setRecordingSaved(false);
    setRecordingRedo(true);
    setRecordingSaveFailed(false);
    setRecorderCycle(value => value + 1);
  };
  const uploadMusicReference = async (file?: File) => {
    if (!file || !p.onUploadMusicReference || referenceInFlight.current) return;
    const scope = currentAudioScope.current;
    referenceInFlight.current = true;
    setReferenceBusy(true);
    try {
      if (!audioScopeIsCurrent(scope)) return;
      await p.onUploadMusicReference(file);
      if (audioScopeIsCurrent(scope)) setMusicReferenceOpen(false);
    } catch (cause) {
      if (audioScopeIsCurrent(scope)) p.onNotice(cause instanceof Error ? cause.message : "参考音频上传失败，请重试。");
    } finally {
      if (audioScopeIsCurrent(scope)) {
        referenceInFlight.current = false;
        setReferenceBusy(false);
      }
    }
  };
  const selectMusicReference = async (nodeId: string) => {
    if (!nodeId || !p.onSelectMusicReference || referenceInFlight.current) return;
    const scope = currentAudioScope.current;
    referenceInFlight.current = true;
    setReferenceBusy(true);
    try {
      await p.onSelectMusicReference(nodeId);
      if (audioScopeIsCurrent(scope)) setMusicReferenceOpen(false);
    } catch (error) {
      if (audioScopeIsCurrent(scope)) p.onNotice(error instanceof Error ? error.message : "选择画布音频失败，请重试。");
    } finally {
      if (audioScopeIsCurrent(scope)) {
        referenceInFlight.current = false;
        setReferenceBusy(false);
      }
    }
  };
  const generateLyrics = async () => {
    if (!p.onGenerateLyrics || lyricsInFlight.current || !fullPrompt.trim()) return;
    const scope = currentAudioScope.current;
    setLyricsExpanded(true);
    lyricsInFlight.current = true;
    setLyricsGenerating(true);
    setLyricsReady(false);
    try {
      const lyrics = await p.onGenerateLyrics(fullPrompt);
      if (!audioScopeIsCurrent(scope)) return;
      if (!lyrics.trim()) throw new Error("未生成歌词，请重试或手动填写。");
      p.onChange({ musicLyrics: lyrics });
      setLyricsReady(true);
    } catch (error) {
      if (audioScopeIsCurrent(scope)) p.onNotice(error instanceof Error ? error.message : "歌词生成失败，请重试。");
    } finally {
      if (audioScopeIsCurrent(scope)) {
        lyricsInFlight.current = false;
        setLyricsGenerating(false);
      }
    }
  };
  return (
    <aside
      className={`creator-panel context-creator${isMusic ? " is-audio-composer" : ""}${expanded ? " is-expanded" : ""}`}
      aria-label={retiredTTS ? "音频创作" : isVideo ? "视频创作" : isMusic ? isVoiceDesign ? "音色生成" : isRecording ? "录音" : "音乐创作" : "图片创作"}
      style={p.style}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.defaultPrevented || isComposingKey(event.nativeEvent) || event.key !== "Escape") return;
        event.preventDefault();
        if (pickingReference) {
          setPickingReference(false);
          setReferencePickerMode("menu");
          referenceButton.current?.focus();
        } else if (musicReferenceOpen) {
          setMusicReferenceOpen(false);
          musicReferenceTrigger.current?.focus({ preventScroll: true });
        } else if (voicePreviewOpen) {
          setVoicePreviewOpen(false);
          voicePreviewTrigger.current?.focus({ preventScroll: true });
        } else if (isMusic && !isVoiceDesign && lyricsEditorOpen) {
          setLyricsExpanded(false);
          musicLyricsTrigger.current?.focus({ preventScroll: true });
        } else close();
      }}
    >
      <div className="context-creator-scroll">
        <div className="context-creator-head">
          {isMusic && <div className="context-audio-mode-tabs" role="tablist" aria-label="音频创作模式">
            {([
              ["voice_design", "音色生成"],
              ["music", "音乐生成"],
              ["recording", "录音"],
            ] as const).map(([mode, label]) => <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={audioMode === mode}
              tabIndex={audioMode === mode || retiredTTS && mode === "music" ? 0 : -1}
              className={audioMode === mode ? "is-active" : ""}
              disabled={controlsLocked}
              onClick={() => changeAudioMode(mode)}
              onKeyDown={event => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') || []);
                const current = tabs.indexOf(event.currentTarget);
                const direction = event.key === "ArrowLeft" ? -1 : 1;
                const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + direction + tabs.length) % tabs.length;
                tabs[index]?.focus({ preventScroll: true });
                tabs[index]?.click();
              }}
            >{label}</button>)}
          </div>}
          {(visibleReferences.length > 0 || p.textReferences.length > 0) && (
            <div className="context-reference-summary">
              {visibleReferences.length > 0 ? <ImagePlus size={12} aria-hidden="true" /> : <Type size={12} aria-hidden="true" />}
              <span>{[
                p.node.ignoreImageRefs && visibleReferences.length ? "参考素材已停用" : visibleReferences.length ? `${visibleReferences.length} 个参考素材` : "",
                p.textReferences.length ? `${p.textReferences.length} 条文本引用` : "",
              ].filter(Boolean).join(" · ")}</span>
            </div>
          )}
          {!isMusic && visibleReferences.length === 0 && (
            <button
              ref={referenceButton}
              className={`context-reference-add${pickingReference ? " is-active" : ""}`}
              aria-label="添加输入引用"
              aria-expanded={pickingReference}
              aria-controls={pickerId}
              disabled={controlsLocked}
              onMouseEnter={openReferencePicker}
              onMouseLeave={scheduleReferencePickerDismiss}
              onFocus={openReferencePicker}
              onClick={() => {
                setSettingsOpen(false);
                setModelOpen(false);
                setReferencePickerMode("menu");
                setPickingReference(true);
              }}
            >
              <Plus size={19} aria-hidden="true" />
            </button>
          )}
          <div className="context-head-actions">
            {!isRecording && !retiredTTS && <button
              className="icon-button"
              aria-label={expanded ? isMusic ? "收起创作描述" : "收起画面描述" : isMusic ? "展开创作描述" : "展开画面描述"}
              aria-pressed={expanded}
              title={expanded ? isMusic ? "收起创作描述" : "收起画面描述" : isMusic ? "展开创作描述" : "展开画面描述"}
              onClick={() => {
                // Keep the editor focused on one transient surface at a time.
                // Expanding the prompt should never leave a picker or settings
                // card floating over the enlarged input area.
                setPickingReference(false);
                setSettingsOpen(false);
                setModelOpen(false);
                setMusicReferenceOpen(false);
                setLyricsExpanded(false);
                setVoicePreviewOpen(false);
                setExpanded((value) => !value);
              }}
            >
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>}
            <button
              className="icon-button"
              aria-label={`关闭${isVideo ? "视频" : isVoiceDesign ? "音色" : isRecording ? "录音" : isMusic ? "音乐" : "图片"}创作`}
              title={`关闭${isVideo ? "视频" : isVoiceDesign ? "音色" : isRecording ? "录音" : isMusic ? "音乐" : "图片"}创作`}
              onClick={close}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        {retiredTTS ? (
          <div className="context-feedback" role="status">
            <p>画布暂不支持文本转语音。</p>
            <p>{p.node.taskId || p.node.ttsSubmission || p.node.audioTaskType
              ? "历史任务信息已保留，已有音频仍可通过资产使用。请新建音频创作使用音色生成、音乐生成或录音。"
              : "原有文本已保留，请选择上方模式继续创作。"}</p>
          </div>
        ) : isRecording ? (
          <div className="context-recording-content">
            {!recordingIsSaved && <AudioRecorder
              key={`${p.node.id}:${recorderCycle}`}
              onSave={file => void saveRecording(file)}
              onReset={() => setRecordingSaveFailed(false)}
              onCaptureStateChange={setRecordingHasUncommittedCapture}
              onNotice={message => p.onNotice(message)}
              disabled={recordingSaving || !p.onSaveRecording}
            />}
            {recordingSaving && <p className="context-audio-status" role="status">正在保存录音…</p>}
            {recordingSaveFailed && <div className="context-recording-error" role="status"><p>录音仍保留，可重新确认使用。</p></div>}
            {recordingIsSaved && <div className="context-recording-saved" role="status"><div className="context-recording-saved-copy"><Check size={14} aria-hidden="true" /><p>录音已保存到画布</p><small>可在节点中试听或下载；重新录制并确认后会替换此音频</small></div><button type="button" aria-label="重新录制并替换当前节点音频" title="确认新录音后会替换当前节点音频" onClick={startAnotherRecording}><RotateCcw size={13} aria-hidden="true" />重新录制</button></div>}
          </div>
        ) : <>
        {pickingReference && (
          <div
            ref={picker}
            id={pickerId}
            className="context-reference-picker"
            role="dialog"
            aria-label="选择输入引用"
            onMouseEnter={keepReferencePickerOpen}
            onMouseLeave={scheduleReferencePickerDismiss}
          >
            {referencePickerMode === "menu" ? (
              <div className="reference-action-menu" role="menu" aria-label="添加输入引用方式">
                <button role="menuitem" disabled={controlsLocked} onClick={() => { setPickingReference(false); p.onUploadReference(); focusPrompt(); }}><Upload size={15} /><span>从本地上传</span></button>
                <button role="menuitem" disabled={controlsLocked} onClick={() => { if (p.onOpenAssetLibrary) { setPickingReference(false); p.onOpenAssetLibrary(); } else { setAssetLibraryTab("assets"); setReferencePickerMode("assets"); } }}><ImagePlus size={15} /><span>从资产库选择</span></button>
                <button role="menuitem" disabled={controlsLocked} onClick={() => { setPickingReference(false); p.onPickCanvasReference(); }}><Link2 size={15} /><span>从画布选择</span></button>
                <button role="menuitem" disabled={controlsLocked} onClick={() => { setPickingReference(false); p.onPickCanvasTextReference(); }}><Type size={15} /><span>从画布引用文本</span></button>
                <button role="menuitem" disabled={controlsLocked} onClick={() => { setPickingReference(false); p.onDrawReference(); }}><Brush size={15} /><span>手绘参考图</span></button>
              </div>
            ) : referencePickerMode === "assets" ? (
              <div className="asset-picker-panel">
                <div className="asset-picker-head">
                  <button className="context-picker-back" disabled={controlsLocked} onClick={() => setReferencePickerMode("menu")}><ChevronDown size={13} />添加参考图片</button>
                  <div className="asset-picker-tabs-main" role="tablist" aria-label="资产类型">
                    <button className={assetLibraryTab === "assets" ? "is-active" : ""} role="tab" aria-selected={assetLibraryTab === "assets"} onClick={() => setAssetLibraryTab("assets")}>资产</button>
                    <button className={assetLibraryTab === "actors" ? "is-active" : ""} role="tab" aria-selected={assetLibraryTab === "actors"} onClick={() => setAssetLibraryTab("actors")}>演员库</button>
                  </div>
                  <label className="asset-picker-search">
                    <span className="sr-only">搜索资产</span>
                    <input aria-label="搜索资产" placeholder={assetLibraryTab === "actors" ? "搜索演员" : "搜索资产"} value={referenceSearch} onChange={(event) => setReferenceSearch(event.target.value)} autoFocus />
                    <Search size={15} aria-hidden="true" />
                  </label>
                </div>
                {assetLibraryTab === "assets" && <div className="asset-picker-categories" role="tablist" aria-label="资产分类">
                  {assetTabs.map((tab) => (
                    <button
                      key={tab.key}
                      role="tab"
                      aria-selected={assetCategory === tab.key}
                      className={assetCategory === tab.key ? "is-active" : ""}
                      onClick={() => setAssetCategory(tab.key)}
                    >{tab.label}{(hasAssetCategories || assetCandidates.length === 0) && <span> ({assetCategoryCounts[tab.key]})</span>}</button>
                  ))}
                  <button className="asset-picker-favorite" aria-label="收藏资产" title="收藏资产" disabled>☆</button>
                </div>}
                <div className="asset-picker-grid" role="list" aria-label="资产列表">
                  {assetLibraryTab === "assets" && <button className="asset-create-card" disabled={controlsLocked} onClick={() => { setPickingReference(false); p.onUploadReference(); }}>
                    <Plus size={20} />
                    <span>创建</span>
                  </button>}
                  {assetLibraryTab === "assets" && assetVisibleCandidates.map((candidate) => {
                    const candidateImage = candidate.image;
                    const candidatePreview = imagePreviewURL(candidate.image, candidate.imageThumbnail);
    const candidateMedia = candidateImage || candidate.video || candidate.audio || candidate.videoContentUrl || candidate.assetId;
                    const selected = connectedIds.has(candidate.id) || Boolean(candidateMedia && connectedImages.has(candidateMedia));
    const usable = Boolean(candidate.image || (isVideo && (candidate.video || candidate.audio || candidate.videoContentUrl || candidate.assetId)));
                    return (
                      <div key={candidate.id} className={`asset-picker-card${selected ? " is-selected" : ""}`} role="listitem">
                        <button
                          className="asset-picker-card-main"
                          disabled={controlsLocked || selected || !usable}
                          aria-label={`${selected ? "已添加参考" : usable ? "添加参考" : "素材待恢复"} ${candidate.title}`}
                          onClick={() => {
                            if (selected || !usable) return;
                            const added = p.onAddReference(candidate.id);
                            if (added === false) return;
                            setPickingReference(false);
                            setReferenceSearch("");
                            focusPrompt();
                          }}
                        >
                          {candidatePreview ? <img src={candidatePreview} alt="" draggable={false} /> : candidate.image ? <span className="asset-picker-card-missing">正在获取缩略图</span> : candidate.video ? <video src={candidate.video} muted playsInline preload="metadata" controls={false} tabIndex={-1} aria-hidden="true" /> : candidate.audio ? <div className="asset-picker-card-missing">音频</div> : <span className="asset-picker-card-missing">待恢复</span>}
                          <span title={candidate.title}>{candidate.title}</span>
                        </button>
                        <button
                          className="asset-picker-card-action"
                          disabled={controlsLocked || selected || !usable}
                          aria-label={`${selected ? "已添加" : usable ? "添加" : "素材待恢复"} ${candidate.title}`}
                          onClick={() => {
                            if (selected || !usable) return;
                            const added = p.onAddReference(candidate.id);
                            if (added === false) return;
                            setPickingReference(false);
                            setReferenceSearch("");
                            focusPrompt();
                          }}
                        >{selected ? <Check size={15} /> : <Plus size={15} />}</button>
                      </div>
                    );
                  })}
                </div>
                {(assetLibraryTab === "actors" || assetVisibleCandidates.length === 0) && <div className="asset-picker-empty">没有找到可用资产</div>}
              </div>
            ) : null}
          </div>
        )}
        {(visibleReferences.length > 0 || p.textReferences.length > 0) && (
          <div className="context-input-sources-wrap">
            {visibleReferences.length > 0 && <div className={`context-reference-strip${p.node.ignoreImageRefs ? " is-ignored" : ""}`} aria-label={isVideo ? "参考素材" : "参考图片"}>
            <button
              ref={referenceButton}
              className={`context-reference-add${pickingReference ? " is-active" : ""}`}
              aria-label={isVideo ? "添加视频参考图片" : "添加参考图片"}
              aria-expanded={pickingReference}
              aria-controls={pickerId}
              disabled={controlsLocked}
              onMouseEnter={openReferencePicker}
              onMouseLeave={scheduleReferencePickerDismiss}
              onFocus={openReferencePicker}
              onClick={() => {
                setSettingsOpen(false);
                setModelOpen(false);
                setReferencePickerMode("menu");
                // Hover/focus can already have opened the menu before the
                // click event arrives. Always keep it open here so the trigger
                // cannot close its own menu during pointer activation.
                setPickingReference(true);
              }}
            ><Plus size={19} /></button>
            {visibleReferences.map((reference, index) => {
              const direct = Boolean(reference.embedded) || p.sources.some(
                (source) => source.id === reference.nodeId,
              );
              const referenceLabel = promptReferenceDisplayLabel(reference.title, reference.nodeId, index + 1, reference.assetId);
              const referenceImage = imagePreviewURL(reference.image, reference.imageThumbnail);
              return (
                <div key={reference.nodeId} className="context-reference">
                  <button
                    className="context-reference-preview"
                    title={`${referenceLabel}${direct ? "" : " · 来自上游节点，可在输入来源中管理"}`}
                    aria-label={`预览参考 ${referenceLabel}`}
                    onClick={() => !reference.embedded && p.onLocate(reference.nodeId)}
                  >
                    {referenceImage ? (
                      <img src={referenceImage} alt={referenceLabel} draggable={false} />
                    ) : reference.image ? (
                      <span className="context-missing-reference">正在获取缩略图</span>
                    ) : reference.video ? (
                      <video src={reference.video} muted playsInline preload="metadata" controls={false} tabIndex={-1} aria-label={reference.title} />
                    ) : reference.localVideo ? (
                      <span className="context-missing-reference"><Film size={14} /> 视频</span>
                    ) : reference.audio || reference.localAudio ? (
                      <span className="context-missing-reference">音频</span>
                    ) : (
                      <span className="context-missing-reference">
                        "图片待恢复"
                      </span>
                    )}
                    {!direct && (
                      <span className="context-reference-inherited">
                        <Link2 size={11} />
                      </span>
                    )}
                  </button>
                  {direct && (
                    <button
                      type="button"
                      className="context-reference-remove"
                      aria-label={`移除参考 ${referenceLabel}`}
                      title={`移除参考 ${referenceLabel}`}
                      disabled={controlsLocked}
                      onClick={() => reference.embedded
                        ? p.onChange({ embeddedReferences: p.node.embeddedReferences?.filter((item) => item.id !== reference.nodeId) })
                        : p.onDisconnect(reference.nodeId)}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              );
            })}
            </div>}
            {p.textReferences.length > 0 && (
              <div className="context-input-sources" aria-label="上游文本输入">
            {p.textReferences.map((reference) => (
              <div className="context-text-reference" key={reference.nodeId}>
                <button
                  type="button"
                  className="context-text-reference-main"
                  aria-label={`定位文本来源 ${reference.title || "文本节点"}：${reference.text}`}
                  onClick={() => p.onLocate(reference.nodeId)}
                >
                  <Type size={12} aria-hidden="true" />
                  <span className="context-text-reference-title">文本</span>
                  <span className="context-text-reference-summary">{reference.text}</span>
                </button>
                  {p.sources.some((source) => source.id === reference.nodeId) && (
                  <button
                    type="button"
                    className="context-text-reference-remove"
                    aria-label={`移除文本来源 ${reference.title || "文本节点"}`}
                    title={`移除文本来源 ${reference.title || "文本节点"}`}
                    disabled={controlsLocked}
                    onClick={() => p.onDisconnect(reference.nodeId)}
                  ><X size={11} /></button>
                )}
              </div>
            ))}
              </div>
            )}
          </div>
        )}
        <PromptMentionInput
          inputRef={promptInput}
          initialSegments={promptSegments}
          candidates={mentionCandidates}
          onLoadAssets={p.onLoadMentionAssets}
          assetsLoading={p.mentionAssetsLoading}
          assetsError={p.mentionAssetsError}
          assetsHasMore={p.mentionAssetsHasMore}
          onLoadMoreAssets={p.onLoadMoreMentionAssets}
          onRetryAssets={p.onRetryMentionAssets}
          onOpenAssetLibrary={p.onOpenAssetLibrary}
          embeddedCandidates={visibleReferences.filter(reference => Boolean(reference.image || reference.imageThumbnail)).map((reference) => ({
            id: reference.nodeId,
            title: reference.title,
            type: "image" as const,
            image: reference.image,
            imageThumbnail: reference.imageThumbnail,
            assetId: reference.assetId,
            assetCategory: undefined,
            category: undefined,
          }))}
          referenceNaming={p.referenceNaming}
          expanded={expanded}
          label={isVideo ? "视频创作描述" : isVoiceDesign ? "音色描述" : isMusic ? "音乐创作描述" : "创作画面描述"}
          describedBy={promptHintId}
          maxLength={20000}
          readOnly={promptReadOnly}
          placeholder={
            isVoiceDesign
              ? "描述音色的音域、音质、年龄感、情绪和说话方式…"
              : isMusic
              ? "描述主题、曲风和情绪…"
              : isVideo
              ? usesImages
                ? "描述视频动作、镜头和节奏，例如：镜头缓慢推进…"
                : "描述你想生成的视频画面、动作和镜头…"
              : usesImages
                ? "描述如何编辑参考图，例如：保留主体，将背景改为雪夜…"
                : "描述你想创作的画面，或添加图片进行编辑…"
          }
          onChange={updatePromptSegments}
          onSelectCandidate={(id) => {
            // The editor remains writable while a task is running, but adding
            // or resolving a mention changes the frozen media inputs. Keep
            // reference selection behind the same control lock as the other
            // model and reference controls.
            if (controlsLocked) return false;
            if (p.onSelectMentionCandidate) return p.onSelectMentionCandidate(id);
            // References that are already attached to the creator can be
            // ordered inline without creating a duplicate edge. New canvas
            // references still use the normal graph connection path.
            if (visibleReferences.some((reference) => reference.nodeId === id)) return true;
            return p.onAddReference(id);
          }}
          onNotice={p.onNotice}
          onGenerateShortcut={submit}
          onBlur={persistDraft}
        />
        <div className="context-prompt-meta">
          <p className="context-keyboard-hint" id={promptHintId}>
            {p.textReferences.length > 0 ? "文本引用会参与生成 · " : ""}Enter 换行 · ⌘ / Ctrl + Enter 生成 · {isMusic ? "Esc 收起详情或返回画布" : "Esc 返回画布"}
          </p>
          <span className="context-character-count" aria-label={`已输入 ${draft.length} 个字符，共 ${20000} 个字符`}>
            {draft.length}/{20000}
          </span>
          {inputChanged && (
            <span className="context-input-changed" role="status" title="输入内容已修改，再次生成会使用新内容">
              输入已更新
            </span>
          )}
        </div>
        {isMusic && !isVoiceDesign && <input
          ref={musicReferenceInput}
          type="file"
          accept="audio/*"
          hidden
          aria-label="选择参考音频"
          disabled={referenceBusy || controlsLocked}
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            void uploadMusicReference(file);
          }}
        />}
        {isVoiceDesign && voicePreviewOpen && <ParameterPopover
          anchor={voicePreviewTrigger}
          id={voicePreviewId}
          label="音色试听文本"
          onClose={() => setVoicePreviewOpen(false)}
        >
          <label className="context-voice-preview-field">
            <span><strong>试听文本</strong><small>生成后用来试听音色，最多 500 字</small></span>
            <textarea data-popover-autofocus aria-label="音色试听文本" rows={4} maxLength={1000} value={voicePreviewText} disabled={controlsLocked} onChange={event => { if (!controlsLocked) p.onChange({ voicePreviewText: [...event.target.value].slice(0, 500).join("") }); }} placeholder="输入用于试听音色的文字…" />
            <small className={[...voicePreviewText].length > 500 ? "is-error" : ""}>{[...voicePreviewText].length}/500</small>
          </label>
        </ParameterPopover>}
        {isMusic && !isVoiceDesign && musicReferenceOpen && <ParameterPopover
          anchor={musicReferenceTrigger}
          id={musicReferenceId}
          label="参考音频"
          onClose={() => setMusicReferenceOpen(false)}
        >
          <section className="context-music-reference" aria-label="音乐参考音频">
            <div className="context-video-settings-head"><Music2 size={13} aria-hidden="true" /><span>参考音频</span><span className="context-video-hint">仅兼容模型会使用</span><button className="context-settings-close" aria-label="关闭参考音频" onClick={() => { setMusicReferenceOpen(false); musicReferenceTrigger.current?.focus({ preventScroll: true }); }}><X size={14} /></button></div>
            {!p.node.musicReference ? <div className="context-music-reference-empty">
            <button type="button" className="context-music-reference-add" data-popover-autofocus aria-label="上传音乐参考音频" disabled={referenceBusy || controlsLocked || !p.onUploadMusicReference} onClick={() => musicReferenceInput.current?.click()}>
                {referenceBusy ? <LoaderCircle size={16} className="spin" /> : <Plus size={18} />}
              </button>
              <div className="context-music-reference-copy"><strong>{referenceBusy ? "正在读取参考音频…" : "添加参考音频"}</strong><span>选择画布、资产库或本地音频（6 秒–6 分钟，≤50 MB）</span></div>
              <div className="context-music-reference-actions">
                {p.onOpenAssetLibrary && <button type="button" className="context-music-reference-action" aria-label="从资产库选择参考音频" disabled={referenceBusy || controlsLocked} onClick={() => { setMusicReferenceOpen(false); p.onOpenAssetLibrary?.(); }}><Library size={13} />资产库</button>}
                {p.onUploadMusicReference && <button type="button" className="context-music-reference-action" disabled={referenceBusy || controlsLocked} onClick={() => musicReferenceInput.current?.click()}><Upload size={13} />上传</button>}
              </div>
            </div> : <div className="context-music-reference-chip">
              <Music2 size={14} aria-hidden="true" />
              <span title={p.node.musicReference.title}>{p.node.musicReference.title}</span>
              <small>{Math.round(p.node.musicReference.duration)} 秒 · {(p.node.musicReference.size / (1024 * 1024)).toFixed(1)} MB</small>
              <button type="button" className="context-music-reference-action" disabled={controlsLocked} onClick={() => p.onChange({ musicReference: undefined })}>更换</button>
              <button type="button" aria-label="移除参考音频" title="移除参考音频" disabled={controlsLocked} onClick={() => p.onChange({ musicReference: undefined })}><X size={13} /></button>
            </div>}
            {!p.node.musicReference && audioReferenceCandidates.length > 0 && (
              <label className="context-music-reference-select"><span>从画布选择</span><select data-popover-autofocus aria-label="选择画布中的参考音频" disabled={referenceBusy || controlsLocked || !p.onSelectMusicReference} value="" onChange={event => void selectMusicReference(event.target.value)}><option value="">选择音频节点…</option>{audioReferenceCandidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title || "音频"}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></label>
            )}
          </section>
        </ParameterPopover>}
        {isMusic && !isVoiceDesign && lyricsEditorOpen && <ParameterPopover
          anchor={musicLyricsTrigger}
          id={musicLyricsId}
          label="歌曲歌词"
          onClose={() => setLyricsExpanded(false)}
        >
          <section className="context-music-lyrics" aria-label="歌曲歌词">
            <div className="context-music-lyrics-head"><label htmlFor={`${settingsId}-lyrics`}>歌词</label><div className="context-music-lyrics-actions"><button type="button" disabled={!p.onGenerateLyrics || lyricsGenerating || !fullPrompt.trim() || controlsLocked} onClick={() => void generateLyrics()}>{lyricsGenerating ? <LoaderCircle size={12} className="spin" /> : <Sparkles size={12} />}{lyricsGenerating ? "正在生成歌词…" : "AI 生成歌词"}</button><button type="button" aria-label="关闭歌词" onClick={() => { setLyricsExpanded(false); musicLyricsTrigger.current?.focus({ preventScroll: true }); }}><X size={13} /></button></div></div>
            <textarea data-popover-autofocus id={`${settingsId}-lyrics`} aria-label="歌词内容" value={p.node.musicLyrics || ""} onChange={event => { setLyricsReady(false); p.onChange({ musicLyrics: event.target.value }); }} placeholder="歌词内容，可手动编辑；也可使用 AI 生成歌词。支持 [Verse]、[Chorus] 等标记分段" rows={4} disabled={controlsLocked} />
            {lyricsReady && <p className="context-audio-status is-success" role="status">歌词已生成，可继续编辑。</p>}
          </section>
        </ParameterPopover>}
        {isMusic && musicConfig && chosen && settingsOpen && (
          <ParameterPopover anchor={settingsButton} id={settingsId} label="音乐参数" onClose={() => setSettingsOpen(false)}>
          <div className="context-video-settings">
            <div className="context-video-settings-head"><Music2 size={13} /><span>音乐参数</span><span className="context-video-hint">修改后下次生成生效</span><button className="context-settings-close" aria-label="关闭音乐参数" onClick={() => setSettingsOpen(false)}><X size={14} /></button></div>
            {musicConfig.formats.length > 0 && <ParameterChoices label="格式" values={musicConfig.formats} value={resolvedMusic?.output_format} onChange={output_format => changeMusicSetting({ output_format })} render={value => value.toUpperCase()} disabled={controlsLocked} />}
            {musicConfig.durations.length > 0 && <label className="context-parameter-section context-parameter-count context-video-duration"><span className="context-choice-label">时长</span><span className="context-parameter-select"><select aria-label="音乐时长" value={resolvedMusic?.duration === undefined ? "" : String(resolvedMusic.duration)} disabled={controlsLocked} onChange={event => changeMusicSetting({ duration: Number(event.target.value) })}>{musicConfig.durations.map(value => <option key={value} value={value}>{value} 秒</option>)}</select><ChevronDown size={13} aria-hidden="true" /></span></label>}
          </div>
          </ParameterPopover>
        )}
        {isVideo && videoConfig && chosen && settingsOpen && (
          <ParameterPopover anchor={settingsButton} id={settingsId} label="视频参数" onClose={() => setSettingsOpen(false)}>
          <div className="context-video-settings">
            <div className="context-video-settings-head"><Film size={13} /><span>视频参数</span><span className="context-video-hint">修改后下次生成生效</span><button className="context-settings-close" aria-label="关闭视频参数" onClick={() => setSettingsOpen(false)}><X size={14} /></button></div>
            {videoConfig.resolutions.length > 0 && <ParameterChoices label="分辨率" values={videoConfig.resolutions} value={resolvedVideo?.resolution}
              onChange={resolution => changeVideoSetting({ resolution, size: undefined })} render={value => value.toUpperCase()} disabled={controlsLocked} />}
            {videoConfig.sizes.length > 0 && videoConfig.resolutions.length === 0 && <ParameterChoices label="尺寸" values={videoConfig.sizes} value={resolvedVideo?.size}
              onChange={size => changeVideoSetting({ size, resolution: undefined })} disabled={controlsLocked} />}
            {videoConfig.aspectRatios.length > 0 && <ParameterChoices label="比例" values={videoConfig.aspectRatios} value={resolvedVideo?.aspect_ratio}
              onChange={aspect_ratio => changeVideoSetting({ aspect_ratio })} ratios disabled={controlsLocked} />}
            {videoConfig.durations.length > 0 && <label className="context-parameter-section context-parameter-count context-video-duration">
              <span className="context-choice-label">时长</span>
              <span className="context-parameter-select">
                <select aria-label="视频时长" value={resolvedVideo?.duration === undefined ? "" : String(resolvedVideo.duration)} disabled={controlsLocked} onChange={event => changeVideoSetting({ duration: Number(event.target.value) })}>
                  {videoConfig.durations.map(value => <option key={value} value={value}>{value} 秒</option>)}
                </select>
                <ChevronDown size={13} aria-hidden="true" />
              </span>
            </label>}
          </div>
          </ParameterPopover>
        )}
        {!isVideo && !isMusic && imageConfig && chosen && settingsOpen && hasImageSettings && (
          <ParameterPopover anchor={settingsButton} id={settingsId} label="图片参数" onClose={() => setSettingsOpen(false)}>
            <ParameterChoices label="画质" values={imageConfig.qualities} value={imageSettings.quality}
              onChange={quality => changeImageSetting({ quality })}
              render={value => imageConfig.qualityLabels[value] || imageQualityLabel(value)} disabled={controlsLocked} />
            <ParameterChoices label="清晰度" values={imageConfig.resolutions} value={imageSettings.resolution}
              onChange={resolution => changeImageSetting({ resolution })} render={value => value.toUpperCase()} disabled={controlsLocked} />
            <ParameterChoices label="比例" values={imageRatios} value={imageSettings.aspectRatio} ratios
              onChange={aspectRatio => changeImageSetting({ aspectRatio })} disabled={controlsLocked} />
            {(!imageSettings.resolution || !imageRatios.length) && <ParameterChoices label="图片尺寸"
              values={imageSizes} value={imageSettings.size} onChange={size => changeImageSetting({ size })} disabled={controlsLocked} />}
            {imageConfig.maxCount > 1 && <label className="context-parameter-section context-parameter-count">
              <span className="context-choice-label">生成数量</span>
              <span className="context-parameter-select">
                <select value={imageSettings.count || 1} disabled={controlsLocked} onChange={event => changeImageSetting({ count: Number(event.target.value) })}>
                  {imageConfig.countOptions.map(count => <option key={count} value={count}>{count} 张</option>)}
                </select>
                <ChevronDown size={13} aria-hidden="true" />
              </span>
            </label>}
            {pending && <p className="context-parameter-hint">修改用于下一次生成</p>}
          </ParameterPopover>
        )}
        </>}
      </div>
      {!isRecording && !retiredTTS && <div className="context-creator-footer">
        <div className="context-footer-controls">
          <div
            ref={modelSelect}
            className={`context-model-select${modelOpen ? " is-open" : ""}`}
            title={modelLabel}
          >
            <Sparkles size={15} aria-hidden="true" />
            <select
              className="context-model-native"
              aria-label={`创作${isVideo ? "视频" : isVoiceDesign ? "音色" : isMusic ? "音乐" : "图片"}模型`}
              value={chosen?.id || ""}
              disabled={controlsLocked || p.connecting || typeModels.length === 0}
              tabIndex={-1}
              onChange={(event) => selectModel(event.target.value)}
            >
              <option value="" disabled>{modelPlaceholder}</option>
              {typeModels.map((model) => {
                const reason = modelReason(model);
                const recovering = !isMusic && !reason && isMediaModelRecovering(model);
                return <option key={model.id} value={model.id} disabled={Boolean(reason)}>
                  {model.name || model.id}{reason ? ` · ${reason}` : recovering ? " · 恢复试流中" : ""}
                </option>;
              })}
            </select>
            <button
              ref={modelTrigger}
              type="button"
              className={`context-model-trigger${modelOpen ? " is-open" : ""}`}
              aria-label={`${modelLabel}，打开${isVideo ? "视频" : isVoiceDesign ? "音色" : isMusic ? "音乐" : "图片"}模型选择`}
              aria-haspopup="listbox"
              aria-expanded={modelOpen}
              disabled={controlsLocked || p.connecting || typeModels.length === 0}
              onClick={() => {
                setSettingsOpen(false);
                setMusicReferenceOpen(false);
                setLyricsExpanded(false);
                setVoicePreviewOpen(false);
                setModelOpen(open => !open);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSettingsOpen(false);
                  setMusicReferenceOpen(false);
                  setLyricsExpanded(false);
                  setVoicePreviewOpen(false);
                  setModelOpen(true);
                  requestAnimationFrame(() => modelSelect.current?.querySelector<HTMLButtonElement>(".context-model-option:not(:disabled)")?.focus({ preventScroll: true }));
                }
              }}
            >
              <span>{modelLabel}</span>
              <ChevronDown className="context-model-chevron" size={12} aria-hidden="true" />
            </button>
            {modelOpen && typeModels.length > 0 && (
              <div className="context-model-menu" role="listbox" aria-label={`${isVideo ? "视频" : isVoiceDesign ? "音色" : isMusic ? "音乐" : "图片"}模型列表`}>
                <div className="context-model-menu-title">选择{isVideo ? "视频" : isVoiceDesign ? "音色" : isMusic ? "音乐" : "图片"}模型</div>
                {typeModels.map((model) => {
                  const reason = modelReason(model);
                  const recovering = !isMusic && !reason && isMediaModelRecovering(model);
                  const id = model.id || "";
                  return <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={chosen?.id === id}
                    disabled={controlsLocked || Boolean(reason) || !id}
                    className={`context-model-option${chosen?.id === id ? " is-selected" : ""}`}
                    onClick={() => !reason && id && selectModel(id)}
                    onKeyDown={(event) => {
                      const options = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".context-model-option:not(:disabled)") || []);
                      const current = options.indexOf(event.currentTarget);
                      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        const direction = event.key === "ArrowUp" ? -1 : 1;
                        const index = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + direction + options.length) % options.length;
                        options[index]?.focus({ preventScroll: true });
                      } else if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (!reason && id) selectModel(id);
                      }
                    }}
                  >
                    <span className="context-model-option-name">{model.name || id}</span>
                    {reason || recovering ? <span className="context-model-option-reason">{reason || "恢复试流中"}</span> : chosen?.id === id ? <Check size={13} aria-hidden="true" /> : null}
                  </button>;
                })}
              </div>
            )}
          </div>
          {isVoiceDesign && <button
            ref={voicePreviewTrigger}
            type="button"
            className={`context-music-quick-button context-voice-preview-toggle${voicePreviewOpen ? " is-active" : ""}${voicePreviewText.trim() ? " has-lyrics" : ""}`}
            aria-label={voicePreviewOpen ? "收起音色试听文本" : "设置音色试听文本"}
            aria-expanded={voicePreviewOpen}
            aria-controls={voicePreviewOpen ? voicePreviewId : undefined}
            title={voicePreviewText.trim() ? `试听文本：${voicePreviewText}` : "设置用于试听音色的文本"}
            disabled={controlsLocked}
            onClick={() => {
              setPickingReference(false);
              setModelOpen(false);
              setSettingsOpen(false);
              setMusicReferenceOpen(false);
              setLyricsExpanded(false);
              setVoicePreviewOpen(value => !value);
            }}
          ><Type size={14} aria-hidden="true" /><span>试听文本</span>{voicePreviewText.trim() && <span className="context-music-quick-status">已填写</span>}<ChevronDown className="context-music-quick-chevron" size={12} aria-hidden="true" /></button>}
          {isMusic && !isVoiceDesign && musicConfig?.modes.length ? <div className="context-music-mode-pills" role="group" aria-label="歌曲类型">
            {musicConfig.modes.map(mode => {
              const instrumental = /instrumental|pure|纯音乐/i.test(mode);
              const selected = resolvedMusic?.audio_mode === mode;
              return <button key={mode} type="button" className={selected ? "is-active" : ""} aria-pressed={selected} disabled={controlsLocked} onClick={() => changeMusicSetting({ audio_mode: mode })}>{instrumental ? "纯音乐" : /song|auto|adaptive|lyric|text/i.test(mode) ? "自适应" : mode}</button>;
            })}
          </div> : null}
          {isMusic && !isVoiceDesign && <button
            ref={musicReferenceTrigger}
            type="button"
            className={`context-music-quick-button context-music-reference-toggle${musicReferenceOpen ? " is-active" : ""}${p.node.musicReference ? " has-reference" : ""}`}
            aria-label={musicReferenceOpen ? "收起参考音频选项" : p.node.musicReference ? `编辑参考音频：${p.node.musicReference.title}` : "添加参考音频"}
            aria-expanded={musicReferenceOpen}
            aria-controls={musicReferenceOpen ? musicReferenceId : undefined}
            title={p.node.musicReference ? `编辑参考音频：${p.node.musicReference.title}` : "添加参考音频"}
            disabled={controlsLocked}
            onClick={() => {
              setPickingReference(false);
              setModelOpen(false);
              setSettingsOpen(false);
              setVoicePreviewOpen(false);
              setLyricsExpanded(false);
              setMusicReferenceOpen(value => !value);
            }}
          ><Link2 size={14} aria-hidden="true" /><span>{p.node.musicReference?.title || "参考音频"}</span><ChevronDown className="context-music-quick-chevron" size={12} aria-hidden="true" /></button>}
          {isMusic && !isVoiceDesign && <button
            ref={musicLyricsTrigger}
            type="button"
            className={`context-music-quick-button context-music-lyrics-toggle${lyricsEditorOpen ? " is-active" : ""}${p.node.musicLyrics?.trim() ? " has-lyrics" : ""}`}
            aria-label={musicIsInstrumental ? "纯音乐无需歌词" : lyricsEditorOpen ? "收起歌词编辑" : "展开歌词编辑"}
            aria-expanded={lyricsEditorOpen}
            aria-controls={lyricsEditorOpen ? musicLyricsId : undefined}
            title={musicIsInstrumental ? "纯音乐无需歌词" : p.node.musicLyrics?.trim() ? "编辑已有歌词" : "编辑歌词或使用 AI 生成"}
            disabled={controlsLocked || musicIsInstrumental}
            onClick={() => {
              setMusicReferenceOpen(false);
              setSettingsOpen(false);
              setModelOpen(false);
              setVoicePreviewOpen(false);
              setLyricsExpanded(value => !value);
            }}
          ><Type size={14} aria-hidden="true" /><span>歌词</span>{p.node.musicLyrics?.trim() && <span className="context-music-quick-status">已填写</span>}</button>}
          {(p.connectionError || !compatible.length) && <button className="icon-button context-model-refresh" aria-label={p.connectionActionLabel}
            title={p.connectionActionLabel} disabled={p.connecting} onClick={p.onRefresh}>
            <RefreshCw size={13} className={p.connecting ? "spin" : ""} />
          </button>}
          {((isVideo && videoConfig && chosen) || (isMusic && musicConfig && chosen) || (!isVideo && !isMusic && chosen && hasImageSettings)) && (
            <button
              ref={settingsButton}
              aria-haspopup="dialog"
              aria-controls={settingsOpen ? settingsId : undefined}
              className={`context-settings-toggle${settingsOpen ? " is-active" : ""}`}
              aria-label={settingsOpen ? "收起生成参数" : "展开生成参数"}
              aria-expanded={settingsOpen}
              title={settingsOpen ? "收起生成参数" : "调整生成参数"}
              disabled={controlsLocked}
              onClick={() => {
                setPickingReference(false);
                setModelOpen(false);
                setMusicReferenceOpen(false);
                setLyricsExpanded(false);
                setVoicePreviewOpen(false);
                setSettingsOpen(value => !value);
              }}
            >
              {isVideo || isMusic ? <SlidersHorizontal size={14} aria-hidden="true" /> : <RatioMark value={imageSettings.aspectRatio || imageSettings.size} />}
              <span>{isVideo ? videoSettingsSummary : isMusic ? musicSettingsSummary : imageSettingsSummary(imageSettings, chosen)}</span>
              <ChevronDown className="context-settings-chevron" size={12} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="context-submit-actions">
          {costEstimate && <span
            className={`context-cost-estimate is-${costEstimate.status}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            title={`${costLabel}。根据当前模型与参数估算，最终以实际费用为准。`}
          >{costLabel}</span>}
          {canCancelAudio && p.onCancel && <button
            className="context-cancel-generation"
            aria-label={musicCancellationPending || p.canceling ? `正在停止${isVoiceDesign ? "音色" : "音乐"}生成` : `停止${isVoiceDesign ? "音色" : "音乐"}生成`}
            title={musicCancellationPending ? "已请求停止；等待平台确认" : `停止${isVoiceDesign ? "音色" : "音乐"}生成`}
            disabled={Boolean(p.canceling || musicCancellationPending)}
            onClick={p.onCancel}
          >{p.canceling || musicCancellationPending ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <X size={13} aria-hidden="true" />}{p.canceling || musicCancellationPending ? "正在停止" : "停止"}</button>}
          <button
            className="context-generate"
            aria-label={submitLabel}
            aria-busy={p.active}
            title={
              p.active
                ? "当前任务尚未结束，请先完成其他编辑。"
                : canRetryOriginalSubmission
                  ? "将先核查原提交，再使用原参数和同一个请求编号继续；不会自动重复提交。"
                : needsRecovery
                  ? "任务仍在处理中，完成后会自动更新结果。"
                  : retryPolicy.requiresConfirmation && !canCreateNewTask
                    ? retryPolicy.reason === "reconciliation_expired"
                      ? "原任务结果未确认，原样重试已关闭。修改提示词、参考图或参数后可创建新的生成任务。"
                      : "原任务结果仍在核对中，暂不能提交新的任务。"
                  : blocked
                    ? blocked
                    : `${generateLabel} · ⌘ / Ctrl + Enter`
            }
            disabled={submitDisabled}
            onClick={submit}
          >
            {submitIcon}
          </button>
        </div>
      </div>}
    </aside>
  );
}
