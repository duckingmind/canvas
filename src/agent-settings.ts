import type { CanvasNode, Model } from './canvas-types.ts'
import { imageOptions, resolveImageSettings } from './image-models.ts'
import { videoOptions, resolveVideoSettings } from './video-models.ts'
import { compatibleMusicModels, musicOptions, resolveMusicSettings, type MusicModel, type MusicSettings } from './music-models.ts'
import { mediaFailure } from './agent-media.ts'
export type AgentImageSettings = { quality?: string; resolution?: string; aspect_ratio?: string; size?: string; count?: number; output_format?: string }
export type AgentVideoSettings = { duration?: number; resolution?: string; aspect_ratio?: string; size?: string }
export type AgentMusicSettings = MusicSettings & { lyrics?: string }
const defined = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
const musicParameter = (model: Model, key: string): Record<string, unknown> | undefined => {
  const source = model as Model & { supported_parameters?: Record<string, unknown> }
  const parameters = source.supported_parameters ?? source.platform_capabilities?.supported_parameters
  const parameter = parameters && typeof parameters === 'object' ? (parameters as Record<string, unknown>)[key] : undefined
  return parameter && typeof parameter === 'object' && !Array.isArray(parameter) ? parameter as Record<string, unknown> : undefined
}
const musicSettings = (model: Model, settings: MusicSettings = {}): MusicSettings => {
  const resolved = resolveMusicSettings(model as Model & MusicModel, settings)
  const optimizer = settings.lyrics_optimizer ?? musicOptions(model as Model & MusicModel).defaults.lyrics_optimizer
  return { ...resolved, ...(musicParameter(model, 'lyrics_optimizer') && typeof optimizer === 'boolean' ? { lyrics_optimizer: optimizer } : {}) }
}
export function generationParameters(model: Model) {
  const kind = model.type || model.model_type
  if (kind === 'video') {
    const options = videoOptions(model)
    return { image: null, video: { durations: options.durations.map(Number).filter(Number.isFinite), resolutions: options.resolutions, sizes: options.sizes, aspectRatios: options.aspectRatios, defaults: defined(resolveVideoSettings(model, {})) }, music: null }
  }
  if (kind === 'image') {
    const options = imageOptions(model)
    return { image: { qualities: options.qualities, resolutions: options.resolutions, sizes: options.sizes, aspectRatios: options.ratios, outputFormats: options.outputFormats, resolutionSizes: options.resolutionSizes, maxCount: options.maxCount, defaults: defined(resolveImageSettings(model)) }, video: null, music: null }
  }
  if (kind === 'audio' || kind === 'music') {
    const music = model as Model & MusicModel
    if (!compatibleMusicModels([music]).length) return { image: null, video: null, music: null }
    const options = musicOptions(music)
    return { image: null, video: null, music: { audioModes: options.modes, outputFormats: options.formats, durations: options.durations.map(Number).filter(Number.isFinite), supportsLyricsOptimizer: musicParameter(model, 'lyrics_optimizer')?.type === 'boolean', defaults: defined(musicSettings(music)) } }
  }
  return { image: null, video: null, music: null }
}
export function configureGeneration(node: CanvasNode, model: Model, input: { image_settings?: AgentImageSettings; video_settings?: AgentVideoSettings; music_settings?: AgentMusicSettings }): CanvasNode {
  const kind = node.mediaType || 'image'
  if (model.available === false || (model.type || model.model_type) !== kind) mediaFailure('CANVAS_MODEL_UNAVAILABLE', 'Select a model matching the node media type')
  if (kind === 'image') {
    if (input.video_settings || input.music_settings) mediaFailure('CANVAS_INVALID_ARGUMENT', 'Video or music settings cannot be applied to an image prompt')
    const { aspect_ratio, output_format, ...rest } = input.image_settings || {}
    const requested = { ...rest, ...(aspect_ratio === undefined ? {} : { aspectRatio: aspect_ratio }), ...(output_format === undefined ? {} : { outputFormat: typeof output_format === 'string' ? output_format.trim().toLowerCase() : output_format }) }
    const resolved = resolveImageSettings(model, { ...(node.modelId === model.id ? node.imageSettings : {}), ...requested })
    for (const [key, value] of Object.entries(requested)) if (resolved[key as keyof typeof resolved] !== value) mediaFailure('CANVAS_MODEL_PARAMETER_UNSUPPORTED', `Unsupported image setting ${key}; inspect list_models parameter options`)
    return { ...node, modelId: model.id, modelSelection: 'user', imageSettings: resolved }
  }
  if (kind === 'video') {
    if (input.image_settings || input.music_settings) mediaFailure('CANVAS_INVALID_ARGUMENT', 'Image or music settings cannot be applied to a video prompt')
    const requested = input.video_settings || {}
    const resolved = resolveVideoSettings(model, { ...(node.modelId === model.id ? node.videoSettings : {}), ...requested })
    for (const [key, value] of Object.entries(requested)) if (resolved[key as keyof typeof resolved] !== value) mediaFailure('CANVAS_MODEL_PARAMETER_UNSUPPORTED', `Unsupported video setting ${key}; inspect list_models parameter options`)
    return { ...node, modelId: model.id, modelSelection: 'user', videoSettings: resolved }
  }
  if (input.image_settings || input.video_settings) mediaFailure('CANVAS_INVALID_ARGUMENT', 'Image or video settings cannot be applied to a music prompt')
  if (!compatibleMusicModels([model as Model & MusicModel]).length) mediaFailure('CANVAS_MODEL_UNAVAILABLE', 'Select a text music-generation model; voice design and reference-audio models use a separate workflow')
  const requested = input.music_settings || {}
  const { lyrics, ...requestedSettings } = requested
  const resolved = musicSettings(model, { ...(node.modelId === model.id ? node.musicSettings : {}), ...requestedSettings })
  for (const [key, value] of Object.entries(requestedSettings)) {
    if (resolved[key as keyof MusicSettings] !== value) mediaFailure('CANVAS_MODEL_PARAMETER_UNSUPPORTED', `Unsupported music setting ${key}; inspect list_models parameter options`)
  }
  if (requested.lyrics_optimizer !== undefined && (typeof requested.lyrics_optimizer !== 'boolean' || musicParameter(model, 'lyrics_optimizer')?.type !== 'boolean')) mediaFailure('CANVAS_MODEL_PARAMETER_UNSUPPORTED', 'Lyrics optimization is not declared by this music model; inspect list_models parameter options')
  if (lyrics !== undefined) {
    if (typeof lyrics !== 'string' || lyrics.length > 20000) mediaFailure('CANVAS_INVALID_ARGUMENT', 'Music lyrics must contain at most 20000 characters')
    const constraints = musicParameter(model, 'lyrics')
    const length = [...lyrics].length
    if (constraints && (typeof constraints.minLength === 'number' && length < constraints.minLength || typeof constraints.maxLength === 'number' && length > constraints.maxLength)) mediaFailure('CANVAS_MODEL_PARAMETER_UNSUPPORTED', 'Lyrics length does not match the current music model contract')
  }
  return { ...node, modelId: model.id, modelSelection: 'user', musicSettings: resolved, ...(lyrics === undefined ? {} : { musicLyrics: lyrics }) }
}
