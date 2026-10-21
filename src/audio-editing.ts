export const MAX_AUDIO_EDIT_INPUT_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_EDIT_OUTPUT_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_EDIT_DECODED_BYTES = 256 * 1024 * 1024;
export const MAX_AUDIO_EDIT_RANGE_SECONDS = 10 * 60;
export const MIN_AUDIO_EDIT_RANGE_SECONDS = 0.05;

export type AudioEditRange = { start: number; end: number };

export type AudioEditOptions = {
  startTime: number;
  endTime: number;
  signal?: AbortSignal;
  maxInputBytes?: number;
  maxOutputBytes?: number;
};

export type PcmWavOptions = {
  startFrame?: number;
  endFrame?: number;
  maxOutputBytes?: number;
};

function abortError(): DOMException {
  return new DOMException("音频处理已取消。", "AbortError");
}

export function audioEditRange(
  duration: number,
  start: number,
  end: number,
  maxDuration = MAX_AUDIO_EDIT_RANGE_SECONDS,
): AudioEditRange {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取音频时长。");
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("请选择有效的音频范围。");
  if (!Number.isFinite(maxDuration) || maxDuration <= 0) throw new Error("音频处理时长上限无效。");

  const from = Math.max(0, Math.min(duration, start));
  const to = Math.max(0, Math.min(duration, end));
  if (to - from < MIN_AUDIO_EDIT_RANGE_SECONDS) throw new Error("截取范围至少需要 0.05 秒。");
  if (to - from > maxDuration) throw new Error(`单次音频处理最多 ${Math.floor(maxDuration / 60)} 分钟，请缩短截取范围。`);
  return { start: from, end: to };
}

function checkedOutputSize(frameCount: number, channelCount: number, maxOutputBytes: number): number {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) throw new Error("音频采样范围无效。");
  if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 2) throw new Error("WAV 导出仅支持单声道或双声道音频。");
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 44) throw new Error("WAV 输出大小上限无效。");
  const dataBytes = frameCount * channelCount * 2;
  const outputBytes = dataBytes + 44;
  if (!Number.isSafeInteger(outputBytes) || outputBytes > 0xffffffff + 8) throw new Error("音频过大，无法导出为 WAV。");
  if (outputBytes > maxOutputBytes) throw new Error("WAV 文件超过允许的输出大小上限，请缩短截取范围。");
  return outputBytes;
}

/** Encode mono or stereo floating-point PCM samples as a little-endian 16-bit WAV. */
export function encodePcmWav(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: PcmWavOptions = {},
): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error("WAV 采样率必须介于 8 kHz 和 192 kHz 之间。");
  }
  if (channels.length < 1 || channels.length > 2) throw new Error("WAV 导出仅支持单声道或双声道音频。");
  const sourceFrames = channels[0]?.length ?? 0;
  if (sourceFrames <= 0 || channels.some(channel => channel.length !== sourceFrames)) throw new Error("音频声道采样长度不一致。");

  const startFrame = options.startFrame ?? 0;
  const endFrame = options.endFrame ?? sourceFrames;
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0 || endFrame > sourceFrames || endFrame <= startFrame) {
    throw new Error("音频采样范围无效。");
  }

  const frameCount = endFrame - startFrame;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_AUDIO_EDIT_OUTPUT_BYTES;
  const byteLength = checkedOutputSize(frameCount, channels.length, maxOutputBytes);
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  const channelCount = channels.length;
  const blockAlign = channelCount * 2;
  const dataBytes = frameCount * blockAlign;
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, byteLength - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = channels[channel]![frame]!;
      const finiteSample = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
      const pcm = finiteSample < 0 ? Math.round(finiteSample * 0x8000) : Math.round(finiteSample * 0x7fff);
      view.setInt16(offset, pcm, true);
      offset += 2;
    }
  }
  return bytes;
}

function createAudioContext(): AudioContext {
  if (typeof globalThis.AudioContext !== "function") throw new Error("当前浏览器不支持本地音频处理。");
  return new globalThis.AudioContext();
}

/** Decode a bounded audio Blob and export its selected range as 16-bit PCM WAV. */
export async function exportAudioEdit(blob: Blob, options: AudioEditOptions): Promise<Blob> {
  const maxInputBytes = options.maxInputBytes ?? MAX_AUDIO_EDIT_INPUT_BYTES;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_AUDIO_EDIT_OUTPUT_BYTES;
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes <= 0) throw new Error("音频输入大小上限无效。");
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 44) throw new Error("WAV 输出大小上限无效。");
  if (options.signal?.aborted) throw abortError();
  if (!(blob instanceof Blob) || blob.size <= 0) throw new Error("音频文件为空或无法读取。");
  if (blob.size > maxInputBytes) throw new Error("音频文件超过允许的输入大小上限。");

  const context = createAudioContext();
  try {
    const encoded = await blob.arrayBuffer();
    if (options.signal?.aborted) throw abortError();
    const decoded = await context.decodeAudioData(encoded);
    if (options.signal?.aborted) throw abortError();

    const decodedBytes = decoded.length * decoded.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_AUDIO_EDIT_DECODED_BYTES) {
      throw new Error("解码后的音频超过本机内存处理上限 256 MiB。");
    }
    const range = audioEditRange(decoded.duration, options.startTime, options.endTime);
    const startFrame = Math.max(0, Math.floor(range.start * decoded.sampleRate));
    const endFrame = Math.min(decoded.length, Math.ceil(range.end * decoded.sampleRate));
    const channelData = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    const wav = encodePcmWav(channelData, decoded.sampleRate, { startFrame, endFrame, maxOutputBytes });
    if (options.signal?.aborted) throw abortError();
    return new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
  } finally {
    if (context.state !== "closed") await context.close().catch(() => {});
  }
}
