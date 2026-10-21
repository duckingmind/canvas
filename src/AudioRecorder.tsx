import React from "react";
import { Check, Mic, RotateCcw, Square } from "lucide-react";
import "./audio-recorder.css";
import { AudioRecordingSession, MAX_RECORDING_MS, defaultRecordingFileName, formatRecordingDuration, type RecordingStatus } from "./audio-recording";

export type AudioRecorderProps = {
  onSave: (file: File) => void;
  disabled?: boolean;
};

export default function AudioRecorder({ onSave, disabled = false }: AudioRecorderProps) {
  const [status, setStatus] = React.useState<RecordingStatus>("idle");
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [previewUrl, setPreviewUrl] = React.useState("");
  const [recordingBlob, setRecordingBlob] = React.useState<Blob | null>(null);
  const sessionRef = React.useRef<AudioRecordingSession | null>(null);
  const previewUrlRef = React.useRef("");
  const startingRef = React.useRef(false);

  const revokePreview = React.useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreviewUrl("");
  }, []);

  React.useEffect(() => {
    const session = new AudioRecordingSession({
      onStatus: setStatus,
      onElapsed: setElapsedMs,
      onComplete: blob => {
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setRecordingBlob(blob);
      },
      onError: setErrorMessage,
    });
    sessionRef.current = session;
    return () => {
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    };
  }, []);

  const stopRecording = React.useCallback(() => sessionRef.current?.stop(), []);

  const startRecording = React.useCallback(async () => {
    if (disabled || startingRef.current || status === "requesting" || status === "recording") return;
    startingRef.current = true;
    revokePreview();
    setRecordingBlob(null);
    setElapsedMs(0);
    setErrorMessage("");
    try {
      await sessionRef.current?.start();
    } finally {
      startingRef.current = false;
    }
  }, [disabled, revokePreview, status]);

  const redoRecording = () => {
    if (disabled) return;
    revokePreview();
    setRecordingBlob(null);
    setElapsedMs(0);
    setErrorMessage("");
    setStatus("idle");
  };

  const confirmRecording = () => {
    if (disabled || !recordingBlob) return;
    const file = new File([recordingBlob], defaultRecordingFileName(new Date(), recordingBlob.type), {
      type: recordingBlob.type || "audio/webm",
      lastModified: Date.now(),
    });
    onSave(file);
  };

  const isRecording = status === "recording";
  const isBusy = status === "requesting";
  const progress = Math.min(100, elapsedMs / MAX_RECORDING_MS * 100);

  return (
    <section className={`audio-recorder${status === "ready" ? " is-ready" : ""}`} aria-label="录音">
      <div className="audio-recorder-head">
        <span className="audio-recorder-icon" aria-hidden="true"><Mic size={17} /></span>
        <div className="audio-recorder-heading">
          <h3>{status === "ready" ? "试听录音" : "录音"}</h3>
          {status !== "ready" && <p>录制一段声音，最长 1 分钟</p>}
        </div>
        {status !== "ready" && (
          <span className={`audio-recorder-badge${isRecording ? " is-recording" : ""}`} aria-live="polite">
            {isBusy ? "正在请求权限" : isRecording ? "录制中" : status === "error" ? "需要处理" : "未开始"}
          </span>
        )}
      </div>

      {status !== "ready" && (
        <>
          <div className={`audio-recorder-clock${isRecording ? " is-recording" : ""}`} role="timer" aria-label={`录音时长 ${formatRecordingDuration(elapsedMs)}`}>
            <span className="audio-recorder-dot" aria-hidden="true" />
            <span>{formatRecordingDuration(elapsedMs)}</span>
            <span className="audio-recorder-limit">/ 01:00</span>
          </div>
          <div className="audio-recorder-progress" role="progressbar" aria-label="录音进度" aria-valuemin={0} aria-valuemax={60} aria-valuenow={Math.floor(elapsedMs / 1000)}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </>
      )}

      {status !== "ready" && (
        <p className="audio-recorder-message" aria-live="polite">
          {status === "idle" && "点击开始后，请在浏览器提示中允许使用麦克风。"}
          {isBusy && "正在连接麦克风，请稍候…"}
          {isRecording && "正在录制，达到 1 分钟后会自动停止。"}
          {status === "error" && errorMessage}
        </p>
      )}

      {status === "ready" && previewUrl && (
        <audio className="audio-recorder-preview" controls preload="metadata" src={previewUrl} aria-label="试听录音" />
      )}

      <div className="audio-recorder-actions">
        {isRecording ? (
          <button type="button" className="audio-recorder-button is-stop" onClick={stopRecording} aria-label="停止录音">
            <Square size={14} fill="currentColor" />停止录音
          </button>
        ) : status === "ready" ? (
          <>
            <button type="button" className="audio-recorder-button" onClick={redoRecording} disabled={disabled}>
              <RotateCcw size={14} />重新录制
            </button>
            <button type="button" className="audio-recorder-button is-primary" onClick={confirmRecording} disabled={disabled || !recordingBlob}>
              <Check size={15} />确认使用
            </button>
          </>
        ) : (
          <button type="button" className="audio-recorder-button is-primary" onClick={() => void startRecording()} disabled={disabled || isBusy}>
            <Mic size={15} />{isBusy ? "正在连接…" : status === "error" ? "重试录音" : "开始录音"}
          </button>
        )}
      </div>
    </section>
  );
}
