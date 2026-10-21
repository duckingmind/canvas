import React from "react";
import { createPortal } from "react-dom";
import { AudioLines, RotateCcw, Scissors, X } from "lucide-react";
import MediaToolMenu, { dismissMediaToolMenus } from "./MediaToolMenu";
import { audioEditRange, MAX_AUDIO_EDIT_RANGE_SECONDS, MIN_AUDIO_EDIT_RANGE_SECONDS } from "./audio-editing";
import "./image-tools.css";
import "./audio-tools.css";

export type AudioToolsProps = {
  duration: number;
  currentTime: number;
  busy: boolean;
  error?: string;
  onProcess: (range: { startTime: number; endTime: number }) => void;
  onCancel: () => void;
  onClearError: () => void;
  onNotice?: (text: string) => void;
};

type AudioRange = { startTime: number; endTime: number };

function formatTime(value: number): string {
  const seconds = Math.max(0, Number.isFinite(value) ? value : 0);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.${String(Math.floor((seconds % 1) * 10))}`;
}

function initialRange(duration: number, currentTime: number): AudioRange {
  const endTime = Math.min(duration, MAX_AUDIO_EDIT_RANGE_SECONDS);
  if (duration > MAX_AUDIO_EDIT_RANGE_SECONDS && Number.isFinite(currentTime) && currentTime > 0) {
    const startTime = Math.min(currentTime, duration - MIN_AUDIO_EDIT_RANGE_SECONDS);
    return { startTime, endTime: Math.min(duration, startTime + MAX_AUDIO_EDIT_RANGE_SECONDS) };
  }
  return { startTime: 0, endTime };
}

export default function AudioTools({ duration, currentTime, busy, error, onProcess, onCancel, onClearError, onNotice }: AudioToolsProps) {
  const [open, setOpen] = React.useState(false);
  const [range, setRange] = React.useState<AudioRange>({ startTime: 0, endTime: 0 });
  const trigger = React.useRef<HTMLButtonElement>(null);
  const dialog = React.useRef<HTMLDivElement>(null);
  const wasBusy = React.useRef(false);
  const titleId = React.useId();
  const validDuration = Number.isFinite(duration) && duration >= MIN_AUDIO_EDIT_RANGE_SECONDS;
  const safeDuration = validDuration ? duration : 0;
  const selectionDuration = range.endTime - range.startTime;
  const canProcess = validDuration && !busy && Number.isFinite(selectionDuration)
    && selectionDuration >= MIN_AUDIO_EDIT_RANGE_SECONDS
    && selectionDuration <= MAX_AUDIO_EDIT_RANGE_SECONDS;

  const closeDialog = React.useCallback((restoreFocus = true) => {
    if (busy) return;
    setOpen(false);
    onClearError();
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }, [busy, onClearError]);

  const begin = () => {
    if (busy || !validDuration) return;
    dismissMediaToolMenus();
    setRange(initialRange(duration, currentTime));
    onClearError();
    setOpen(true);
  };

  const updateStart = (value: number) => {
    if (!Number.isFinite(value)) return;
    setRange(current => ({
      startTime: Math.min(Math.max(0, value), Math.max(0, current.endTime - MIN_AUDIO_EDIT_RANGE_SECONDS)),
      endTime: current.endTime,
    }));
  };

  const updateEnd = (value: number) => {
    if (!Number.isFinite(value)) return;
    setRange(current => ({
      startTime: current.startTime,
      endTime: Math.max(Math.min(safeDuration, value), Math.min(safeDuration, current.startTime + MIN_AUDIO_EDIT_RANGE_SECONDS)),
    }));
  };

  const submit = () => {
    if (!canProcess) return;
    try {
      const normalized = audioEditRange(duration, range.startTime, range.endTime);
      onClearError();
      onProcess({ startTime: normalized.start, endTime: normalized.end });
    } catch (cause) {
      onNotice?.(cause instanceof Error ? cause.message : "音频处理失败，请重试。");
    }
  };

  React.useEffect(() => {
    if (busy) wasBusy.current = true;
    else if (wasBusy.current) {
      wasBusy.current = false;
      if (error) onNotice?.(error);
      else closeDialog();
    }
  }, [busy, error, closeDialog, onNotice]);

  React.useLayoutEffect(() => {
    if (!open || !dialog.current) return;
    (dialog.current.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)") || dialog.current)
      .focus({ preventScroll: true });
  }, [open, busy]);

  React.useEffect(() => {
    if (!open) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busy) closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)")];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [open, busy, closeDialog]);

  return <div className="image-tools audio-tools" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <MediaToolMenu
      label="音频工具"
      triggerLabel="工具"
      icon={AudioLines}
      disabled={busy}
      className="audio-tools-control"
      triggerRef={trigger}
      groups={[{ items: [{
        id: "trim-wav",
        label: "裁切并导出 WAV",
        detail: "选择音频片段并导出为 WAV",
        icon: Scissors,
        disabledReason: !validDuration ? "音频加载完成后可使用" : undefined,
        onSelect: begin,
      }] }]}
    />
    {open && typeof document !== "undefined" ? createPortal(
      <div className="image-tool-modal-backdrop audio-tool-backdrop" role="presentation" onMouseDown={() => closeDialog()}>
        <div ref={dialog} className="image-tool-modal audio-tool-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} onMouseDown={event => event.stopPropagation()}>
          <div className="image-tool-modal-head">
            <div><strong id={titleId}>裁切音频</strong><small>导出所选片段为 16-bit PCM WAV</small></div>
            <button type="button" aria-label="关闭音频工具" disabled={busy} onClick={() => closeDialog()}><X size={17} /></button>
          </div>
          <div className="image-tool-form audio-tool-form">
            <div className="audio-tool-range-heading">
              <strong>处理区间</strong>
              <span>{formatTime(range.startTime)} - {formatTime(range.endTime)}</span>
            </div>
            <label className="audio-tool-time-input">
              <span>开始</span>
              <input aria-label="开始时间" type="number" min="0" max={Math.max(0, range.endTime - MIN_AUDIO_EDIT_RANGE_SECONDS)} step="0.1" value={range.startTime} disabled={busy} onChange={event => updateStart(Number(event.target.value))} />
              <button type="button" disabled={busy || !Number.isFinite(currentTime)} onClick={() => updateStart(currentTime)}>设为播放位置</button>
            </label>
            <input className="audio-tool-slider" aria-label="开始时间滑块" type="range" min="0" max={Math.max(0, range.endTime - MIN_AUDIO_EDIT_RANGE_SECONDS)} step="0.1" value={range.startTime} disabled={busy} onChange={event => updateStart(Number(event.target.value))} />
            <label className="audio-tool-time-input">
              <span>结束</span>
              <input aria-label="结束时间" type="number" min={range.startTime + MIN_AUDIO_EDIT_RANGE_SECONDS} max={safeDuration} step="0.1" value={range.endTime} disabled={busy} onChange={event => updateEnd(Number(event.target.value))} />
              <button type="button" disabled={busy || !Number.isFinite(currentTime)} onClick={() => updateEnd(currentTime)}>设为播放位置</button>
            </label>
            <input className="audio-tool-slider" aria-label="结束时间滑块" type="range" min={range.startTime + MIN_AUDIO_EDIT_RANGE_SECONDS} max={safeDuration} step="0.1" value={range.endTime} disabled={busy} onChange={event => updateEnd(Number(event.target.value))} />
            <div className="audio-tool-scale"><span>00:00.0</span><span>{formatTime(safeDuration)}</span></div>
            <p className="audio-tool-note">至少选择 0.05 秒，单次最多 {MAX_AUDIO_EDIT_RANGE_SECONDS / 60} 分钟。</p>
            {busy && <div className="audio-tool-progress" role="status" aria-live="polite"><span aria-hidden="true" /><small>正在解码并导出 WAV…</small></div>}
          </div>
          <div className="image-tool-actions">
            {busy ? <button type="button" className="button" onClick={onCancel}>取消处理</button> : <>
              <button type="button" className="image-tool-reset" onClick={() => { setRange(initialRange(duration, currentTime)); onClearError(); }}><RotateCcw size={13} />重置</button>
              <button type="button" className="button" onClick={() => closeDialog()}>{error ? "关闭" : "取消"}</button>
              <button type="button" className="generate-button" disabled={!canProcess} title={!canProcess ? "请选择不超过 10 分钟的有效区间" : undefined} onClick={submit}>{error ? "重试导出" : "导出 WAV"}</button>
            </>}
          </div>
        </div>
      </div>, document.body,
    ) : null}
  </div>;
}
