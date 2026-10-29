export type AudioNodeSize = { width: number; height: number };

/** The compact footprint used by playable audio cards on the canvas. */
export const DEFAULT_AUDIO_NODE_SIZE: Readonly<AudioNodeSize> = {
  width: 360,
  height: 132,
};

/**
 * Audio creators used the generic task-card dimensions before they received a
 * dedicated compact layout. The square value is included because an older
 * loader incorrectly converted the 480×270 audio task into a 360×360 card.
 * Other dimensions may be deliberate user resizes and must remain untouched.
 */
export function isLegacyAudioNodeSize(width: number, height: number): boolean {
  return (width === 300 && height === 180) ||
    (width === 480 && height === 270) ||
    (width === 360 && height === 360);
}

export function compactAudioPromptSize(
  width: number,
  height: number,
  hasStoredMedia: boolean,
): AudioNodeSize | undefined {
  return hasStoredMedia && isLegacyAudioNodeSize(width, height)
    ? { ...DEFAULT_AUDIO_NODE_SIZE }
    : undefined;
}
