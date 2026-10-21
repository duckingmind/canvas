import { computeAudioWaveformPeaks, DEFAULT_AUDIO_WAVEFORM_BINS } from "./audio-waveform.ts";

export const MAX_AUDIO_WAVEFORM_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_WAVEFORM_DURATION_SECONDS = 10 * 60;
export const MAX_AUDIO_WAVEFORM_DECODED_BYTES = 128 * 1024 * 1024;

/** Decode only short, bounded previews; long-form audio keeps the regular scrubber. */
export async function decodeAudioWaveform(
  blob: Blob,
  duration: number,
  options: { signal?: AbortSignal; bins?: number } = {},
): Promise<number[]> {
  if (!(blob instanceof Blob) || blob.size <= 0) throw new Error("音频文件为空或无法读取。");
  if (blob.size > MAX_AUDIO_WAVEFORM_INPUT_BYTES) throw new Error("音频文件过大，暂不生成波形预览。");
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_WAVEFORM_DURATION_SECONDS) {
    throw new Error("音频时长超出波形预览范围。");
  }
  options.signal?.throwIfAborted();
  if (typeof globalThis.AudioContext !== "function") throw new Error("当前浏览器不支持波形预览。");

  const context = new globalThis.AudioContext({ sampleRate: 22_050 });
  try {
    const encoded = await blob.arrayBuffer();
    options.signal?.throwIfAborted();
    const decoded = await context.decodeAudioData(encoded);
    options.signal?.throwIfAborted();
    const decodedBytes = decoded.length * decoded.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_AUDIO_WAVEFORM_DECODED_BYTES) {
      throw new Error("解码后的音频过大，暂不生成波形预览。");
    }
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    return computeAudioWaveformPeaks(channels, options.bins ?? DEFAULT_AUDIO_WAVEFORM_BINS);
  } finally {
    if (context.state !== "closed") await context.close().catch(() => {});
  }
}
