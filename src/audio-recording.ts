export const MAX_RECORDING_MS = 60_000;

export type RecordingStatus = "idle" | "requesting" | "recording" | "ready" | "error";

/** Formats a non-negative millisecond duration as a compact recording clock. */
export function formatRecordingDuration(milliseconds: number): string {
  const totalSeconds = Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 1000)) : 0;
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/** Creates the stable, user-friendly filename used when the recording is confirmed. */
export function defaultRecordingFileName(date = new Date(), mimeType = "audio/webm"): string {
  const two = (value: number) => String(value).padStart(2, "0");
  const timestamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}_${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  const subtype = mimeType.split(";")[0]?.split("/")[1]?.toLowerCase() || "webm";
  const extension = subtype === "mpeg" ? "mp3" : subtype === "mp4" ? "m4a" : subtype === "x-wav" ? "wav" : subtype;
  return `录音_${timestamp}.${extension}`;
}

export function recordingErrorMessage(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError")
    return "无法访问麦克风。请在浏览器设置中允许麦克风权限后重试。";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "没有检测到可用的麦克风，请连接设备后重试。";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "麦克风当前无法使用，请检查设备是否被其他应用占用。";
  if (name === "NotSupportedError") return "当前浏览器不支持录音功能。";
  return "录音未能完成，请检查麦克风后重试。";
}

export type RecordingStream = { getTracks: () => { stop: () => void }[] };
export type RecordingDevice = {
  state: string;
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: { error?: unknown }) => void) | null;
  start: (timeslice: number) => void;
  stop: () => void;
};
export type RecordingEnvironment = {
  getUserMedia: () => Promise<RecordingStream>;
  createRecorder: (stream: RecordingStream, mimeType?: string) => RecordingDevice;
  supportsMimeType: (type: string) => boolean;
  now: () => number;
  setInterval: (callback: () => void, delay: number) => unknown;
  clearInterval: (handle: unknown) => void;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};
export type RecordingCallbacks = {
  onStatus: (status: RecordingStatus) => void;
  onElapsed: (milliseconds: number) => void;
  onComplete: (blob: Blob) => void;
  onError: (message: string) => void;
};

function browserEnvironment(): RecordingEnvironment {
  return {
    getUserMedia: async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
        throw Object.assign(new Error("Media recording is unavailable"), { name: "NotSupportedError" });
      return navigator.mediaDevices.getUserMedia({ audio: true });
    },
    createRecorder: (stream, mimeType) => (mimeType ? new MediaRecorder(stream as MediaStream, { mimeType }) : new MediaRecorder(stream as MediaStream)) as unknown as RecordingDevice,
    supportsMimeType: type => typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type),
    now: () => Date.now(),
    setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
    clearInterval: handle => globalThis.clearInterval(handle as number),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: handle => globalThis.clearTimeout(handle as number),
  };
}

/** Owns microphone access and its timers, including late permission responses. */
export class AudioRecordingSession {
  private readonly environment: RecordingEnvironment;
  private readonly callbacks: RecordingCallbacks;
  private stream: RecordingStream | null = null;
  private recorder: RecordingDevice | null = null;
  private chunks: Blob[] = [];
  private elapsedTimer: unknown = null;
  private deadlineTimer: unknown = null;
  private startedAt = 0;
  private starting = false;
  private stopping = false;
  private disposed = false;

  constructor(callbacks: RecordingCallbacks, environment: RecordingEnvironment = browserEnvironment()) {
    this.callbacks = callbacks;
    this.environment = environment;
  }

  async start(): Promise<void> {
    if (this.disposed || this.starting || this.recorder) return;
    this.starting = true;
    this.stopping = false;
    this.callbacks.onElapsed(0);
    this.callbacks.onStatus("requesting");
    try {
      const stream = await this.environment.getUserMedia();
      if (this.disposed) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
        .find(type => this.environment.supportsMimeType(type));
      const recorder = this.environment.createRecorder(stream, mimeType);
      this.recorder = recorder;
      this.chunks = [];
      recorder.ondataavailable = event => {
        if (!this.disposed && this.recorder === recorder && event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onerror = event => this.fail(event.error);
      recorder.onstop = () => {
        if (this.disposed || this.recorder !== recorder) return;
        this.clearTimers();
        this.updateElapsed();
        this.releaseStream();
        this.detachRecorder();
        const blob = new Blob(this.chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        this.chunks = [];
        if (!blob.size) {
          this.callbacks.onError("录音内容为空，请重新录制。请确认麦克风正常工作。");
          this.callbacks.onStatus("error");
          return;
        }
        this.callbacks.onComplete(blob);
        this.callbacks.onStatus("ready");
      };
      this.startedAt = this.environment.now();
      recorder.start(250);
      this.callbacks.onStatus("recording");
      this.elapsedTimer = this.environment.setInterval(() => {
        this.updateElapsed();
        if (this.environment.now() - this.startedAt >= MAX_RECORDING_MS) this.stop();
      }, 200);
      this.deadlineTimer = this.environment.setTimeout(() => this.stop(), MAX_RECORDING_MS);
    } catch (error) {
      this.fail(error);
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    const recorder = this.recorder;
    if (this.disposed || !recorder || recorder.state === "inactive" || this.stopping) return;
    this.stopping = true;
    this.clearTimers();
    this.updateElapsed();
    try {
      recorder.stop();
    } catch (error) {
      this.fail(error);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    const recorder = this.recorder;
    this.detachRecorder();
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* Device may already have stopped. */ }
    }
    this.releaseStream();
    this.chunks = [];
  }

  private updateElapsed(): void {
    this.callbacks.onElapsed(Math.max(0, Math.min(MAX_RECORDING_MS, this.environment.now() - this.startedAt)));
  }

  private clearTimers(): void {
    if (this.elapsedTimer !== null) this.environment.clearInterval(this.elapsedTimer);
    if (this.deadlineTimer !== null) this.environment.clearTimeout(this.deadlineTimer);
    this.elapsedTimer = null;
    this.deadlineTimer = null;
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
  }

  private detachRecorder(): void {
    if (!this.recorder) return;
    this.recorder.ondataavailable = null;
    this.recorder.onerror = null;
    this.recorder.onstop = null;
    this.recorder = null;
  }

  private fail(error: unknown): void {
    this.clearTimers();
    const recorder = this.recorder;
    this.detachRecorder();
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* Failure already has a visible recovery path. */ }
    }
    this.releaseStream();
    this.chunks = [];
    if (!this.disposed) {
      this.callbacks.onError(recordingErrorMessage(error));
      this.callbacks.onStatus("error");
    }
  }
}
