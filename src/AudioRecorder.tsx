import React from "react";
import { Check, Mic, RotateCcw, Square } from "lucide-react";
import "./audio-recorder.css";
import { AudioRecordingSession, defaultRecordingFileName, formatRecordingDuration, type RecordingStatus } from "./audio-recording";

export type AudioRecorderProps = {
  onSave: (file: File) => void;
  onReset?: () => void;
  onCaptureStateChange?: (hasUncommittedCapture: boolean) => void;
  onNotice?: (message: string) => void;
  disabled?: boolean;
};

export default function AudioRecorder({ onSave, onReset, onCaptureStateChange, onNotice, disabled = false }: AudioRecorderProps) {
  const [status, setStatus] = React.useState<RecordingStatus>("idle");
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const noticeRef = React.useRef(onNotice);
  noticeRef.current = onNotice;
  const captureStateChangeRef = React.useRef(onCaptureStateChange);
  captureStateChangeRef.current = onCaptureStateChange;
  const [previewUrl, setPreviewUrl] = React.useState("");
  const [recordingBlob, setRecordingBlob] = React.useState<Blob | null>(null);
  const sessionRef = React.useRef<AudioRecordingSession | null>(null);
  const previewUrlRef = React.useRef("");
  const startingRef = React.useRef(false);
  const updateStatus = React.useCallback((next: RecordingStatus) => {
    setStatus(next);
    captureStateChangeRef.current?.(next === "requesting" || next === "recording" || next === "ready");
  }, []);

  const revokePreview = React.useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreviewUrl("");
  }, []);

  React.useEffect(() => {
    const session = new AudioRecordingSession({
      onStatus: updateStatus,
      onElapsed: setElapsedMs,
      onComplete: blob => {
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setRecordingBlob(blob);
      },
      onError: message => {
        noticeRef.current?.(message);
      },
    });
    sessionRef.current = session;
    return () => {
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    };
  }, [updateStatus]);

  const stopRecording = React.useCallback(() => sessionRef.current?.stop(), []);

  const startRecording = React.useCallback(async () => {
    if (disabled || startingRef.current || status === "requesting" || status === "recording") return;
    startingRef.current = true;
    revokePreview();
    setRecordingBlob(null);
    setElapsedMs(0);
    onReset?.();
    try {
      await sessionRef.current?.start();
    } finally {
      startingRef.current = false;
    }
  }, [disabled, onReset, revokePreview, status]);

  const redoRecording = () => {
    if (disabled) return;
    revokePreview();
    setRecordingBlob(null);
    setElapsedMs(0);
    updateStatus("idle");
    onReset?.();
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

  return (
    <section className={`audio-recorder is-${status}`} aria-label="录音">
      <div className="audio-recorder-head">
        <span className="audio-recorder-icon" aria-hidden="true"><Mic size={17} /></span>
        <div className="audio-recorder-heading">
          <h3>{status === "ready" ? "试听录音" : "录音"}</h3>
          {status === "idle" && <p>最长 1 分钟</p>}
        </div>
      </div>

      {isRecording && <div className="audio-recorder-clock is-recording" role="timer" aria-label={`录音时长 ${formatRecordingDuration(elapsedMs)}`}>
        <span className="audio-recorder-dot" aria-hidden="true" />
        <span>{formatRecordingDuration(elapsedMs)}</span>
        <span className="audio-recorder-limit">/ 01:00</span>
      </div>}

      {status !== "ready" && (
        <p className="audio-recorder-message" aria-live="polite">
          {status === "idle" && "开始录制时，请允许使用麦克风。"}
          {isBusy && "正在连接麦克风，请稍候…"}
          {isRecording && "达到 1 分钟后自动停止。"}
          {status === "error" && "录音暂不可用，请重试。"}
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
