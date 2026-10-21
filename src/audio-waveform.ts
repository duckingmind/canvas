export const DEFAULT_AUDIO_WAVEFORM_BINS = 72;
export const MAX_AUDIO_WAVEFORM_BINS = 512;

/** Returns normalized peak magnitudes for a fixed number of waveform bins. */
export function computeAudioWaveformPeaks(
  channels: readonly Float32Array[],
  requestedBins = DEFAULT_AUDIO_WAVEFORM_BINS,
): number[] {
  let frameCount = 0;
  for (const channel of channels) frameCount = Math.max(frameCount, channel.length);
  if (frameCount === 0) return [];

  const finiteBinCount = Number.isFinite(requestedBins) ? Math.floor(requestedBins) : DEFAULT_AUDIO_WAVEFORM_BINS;
  const binCount = Math.min(MAX_AUDIO_WAVEFORM_BINS, Math.max(1, finiteBinCount));
  const peaks = new Array<number>(binCount).fill(0);
  let maximumPeak = 0;

  for (let bin = 0; bin < binCount; bin++) {
    const start = Math.floor(bin * frameCount / binCount);
    const end = Math.max(start + 1, Math.floor((bin + 1) * frameCount / binCount));
    let peak = 0;

    for (let frame = start; frame < Math.min(end, frameCount); frame++) {
      for (const channel of channels) {
        if (frame >= channel.length) continue;
        const sample = channel[frame];
        if (Number.isFinite(sample)) peak = Math.max(peak, Math.min(1, Math.abs(sample)));
      }
    }

    peaks[bin] = peak;
    maximumPeak = Math.max(maximumPeak, peak);
  }

  if (maximumPeak === 0) return peaks;
  return peaks.map(peak => peak / maximumPeak);
}
