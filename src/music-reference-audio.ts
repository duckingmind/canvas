export const MUSIC_REFERENCE_AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const MUSIC_REFERENCE_AUDIO_MIN_SECONDS = 6;
export const MUSIC_REFERENCE_AUDIO_MAX_SECONDS = 6 * 60;

export type MusicReferenceAudioFile = Pick<Blob, "size"> & Partial<Pick<File, "name" | "type">>;

export class MusicReferenceAudioError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "MusicReferenceAudioError";
    this.code = code;
  }
}

/** Validate the provider's local Cover upload limits before reading file bytes. */
export function validateMusicReferenceAudio(file: MusicReferenceAudioFile, durationSeconds: number): void {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new MusicReferenceAudioError("请选择有效的参考音频", "MUSIC_REFERENCE_AUDIO_EMPTY");
  }
  if (file.size > MUSIC_REFERENCE_AUDIO_MAX_BYTES) {
    throw new MusicReferenceAudioError("参考音频不能超过 50 MB", "MUSIC_REFERENCE_AUDIO_TOO_LARGE");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new MusicReferenceAudioError("无法读取参考音频时长，请更换文件", "MUSIC_REFERENCE_AUDIO_DURATION_INVALID");
  }
  if (durationSeconds < MUSIC_REFERENCE_AUDIO_MIN_SECONDS || durationSeconds > MUSIC_REFERENCE_AUDIO_MAX_SECONDS) {
    throw new MusicReferenceAudioError("参考音频时长需在 6 秒至 6 分钟之间", "MUSIC_REFERENCE_AUDIO_DURATION_OUT_OF_RANGE");
  }
}

/** Read duration without uploading the file, and always release the temporary URL. */
export async function readMusicReferenceAudioDuration(file: Blob, timeoutMs = 15_000): Promise<number> {
  validateMusicReferenceAudio(file, MUSIC_REFERENCE_AUDIO_MIN_SECONDS);
  if (typeof Audio === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new MusicReferenceAudioError("当前环境无法读取音频文件", "MUSIC_REFERENCE_AUDIO_METADATA_UNAVAILABLE");
  }

  let objectUrl: string;
  try {
    objectUrl = URL.createObjectURL(file);
  } catch (cause) {
    throw new MusicReferenceAudioError(cause instanceof Error ? cause.message : "无法读取音频文件", "MUSIC_REFERENCE_AUDIO_METADATA_UNAVAILABLE");
  }

  const audio = new Audio();
  audio.preload = "metadata";
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const cleanup = () => {
        globalThis.clearTimeout(timer);
        audio.removeEventListener("loadedmetadata", onMetadata);
        audio.removeEventListener("durationchange", onDuration);
        audio.removeEventListener("timeupdate", onDuration);
        audio.removeEventListener("error", onError);
      };
      const onMetadata = () => {
        // MediaRecorder WebM files often omit the duration header. Seeking
        // to their end lets the browser discover the actual duration.
        if (audio.duration === Infinity) { audio.currentTime = 1e10; return; }
        cleanup();
        resolve(audio.duration);
      };
      const onDuration = () => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
        cleanup();
        resolve(audio.duration);
      };
      const onError = () => {
        cleanup();
        reject(new MusicReferenceAudioError("无法读取参考音频，请更换文件", "MUSIC_REFERENCE_AUDIO_METADATA_INVALID"));
      };
      const timer = globalThis.setTimeout(() => {
        cleanup();
        reject(new MusicReferenceAudioError("读取音频时长超时，请重试", "MUSIC_REFERENCE_AUDIO_METADATA_TIMEOUT"));
      }, timeoutMs);
      audio.addEventListener("loadedmetadata", onMetadata, { once: true });
      audio.addEventListener("durationchange", onDuration);
      audio.addEventListener("timeupdate", onDuration);
      audio.addEventListener("error", onError, { once: true });
      audio.src = objectUrl;
    });
    validateMusicReferenceAudio(file, duration);
    return duration;
  } finally {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(objectUrl);
  }
}

/** Extract only the base64 payload from a FileReader data URL. */
export function base64PayloadFromDataUrl(value: string): string {
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || !match[1]) {
    throw new MusicReferenceAudioError("参考音频编码失败，请重试", "MUSIC_REFERENCE_AUDIO_ENCODING_INVALID");
  }
  return match[1];
}

/** Convert a validated audio file to the raw base64 string expected by Music Cover. */
export async function readMusicReferenceAudioBase64(file: Blob): Promise<string> {
  if (typeof FileReader === "undefined") {
    throw new MusicReferenceAudioError("当前环境无法读取音频文件", "MUSIC_REFERENCE_AUDIO_READER_UNAVAILABLE");
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new MusicReferenceAudioError("读取参考音频失败，请重试", "MUSIC_REFERENCE_AUDIO_READ_FAILED"));
    reader.onabort = () => reject(new MusicReferenceAudioError("读取参考音频已取消", "MUSIC_REFERENCE_AUDIO_READ_CANCELLED"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new MusicReferenceAudioError("参考音频编码失败，请重试", "MUSIC_REFERENCE_AUDIO_ENCODING_INVALID"));
        return;
      }
      try { resolve(base64PayloadFromDataUrl(reader.result)); }
      catch (error) { reject(error); }
    };
    reader.readAsDataURL(file);
  });
}
