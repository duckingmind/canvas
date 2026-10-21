import React from "react";
import { Expand, Gauge, LoaderCircle, Music2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { clampVideoTime, formatVideoTime } from "./video-player";
import { finiteMediaDuration, mediaPlaybackError, nextAudioPlaybackRate } from "./canvas-media-player-state";
import "./canvas-media-player.css";

type MediaElement = HTMLVideoElement | HTMLAudioElement;

const FALLBACK_AUDIO_SHAPE = Array.from({ length: 72 }, (_, index) => {
  const wave = Math.abs(Math.sin(index * 0.62) * 0.62 + Math.sin(index * 0.17 + 0.8) * 0.3);
  return Math.max(0.12, Math.min(1, wave));
});

export type CanvasMediaPlayerProps = {
  src: string;
  kind: "video" | "audio";
  label: string;
  poster?: string;
  className?: string;
  shellClassName?: string;
  showAudioHeading?: boolean;
  audioFormat?: string;
  /** Prevents audio players in one canvas from overlapping without affecting other surfaces. */
  playbackScope?: string;
  autoPlay?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  crossOrigin?: "anonymous" | "use-credentials";
  preload?: "none" | "metadata" | "auto";
  onLoadedMetadata?: (event: React.SyntheticEvent<MediaElement>) => void;
  onTimeUpdate?: (event: React.SyntheticEvent<MediaElement>) => void;
  onLoadedData?: (event: React.SyntheticEvent<MediaElement>) => void;
  onCanPlay?: (event: React.SyntheticEvent<MediaElement>) => void;
  onPlaying?: (event: React.SyntheticEvent<MediaElement>) => void;
  onWaiting?: (event: React.SyntheticEvent<MediaElement>) => void;
  onStalled?: (event: React.SyntheticEvent<MediaElement>) => void;
  onError?: (event: React.SyntheticEvent<MediaElement>) => void;
  onPointerDown?: (event: React.PointerEvent<MediaElement>) => void;
  onEnded?: (event: React.SyntheticEvent<MediaElement>) => void;
  waveform?: readonly number[];
};

/** A small, stable media surface shared by Canvas previews and saved assets. */
export default function CanvasMediaPlayer({
  src, kind, label, poster, className, shellClassName, showAudioHeading = true, audioFormat, playbackScope = "default", autoPlay = false, muted = false, playsInline = true, crossOrigin, preload = "metadata",
  onLoadedMetadata, onTimeUpdate, onLoadedData, onCanPlay, onPlaying, onWaiting, onStalled, onError, onPointerDown, onEnded, waveform,
}: CanvasMediaPlayerProps) {
  const mediaRef = React.useRef<MediaElement | null>(null);
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const sourceRef = React.useRef(src);
  const [state, setState] = React.useState({ paused: true, muted, volume: muted ? 0 : 1, time: 0, duration: 0, metadataReady: false, waiting: kind === "video", rate: 1, error: "" });
  const playerId = React.useId();
  const [fullscreen, setFullscreen] = React.useState(false);
  const sync = React.useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    const duration = finiteMediaDuration(media);
    setState(current => ({ ...current, paused: media.paused, muted: media.muted, volume: media.volume, time: Number.isFinite(media.currentTime) ? media.currentTime : 0, duration, metadataReady: media.readyState >= 1 && duration > 0, waiting: kind === "video" ? media.readyState < 2 : !media.paused && media.readyState < 2, rate: media.playbackRate || 1 }));
  }, [kind]);
  const attachMedia = React.useCallback((element: MediaElement | null) => {
    mediaRef.current = element;
  }, []);
  React.useEffect(() => {
    if (sourceRef.current === src) return;
    sourceRef.current = src;
    const media = mediaRef.current;
    media?.pause();
    if (media) {
      try { media.currentTime = 0; } catch { /* The replacement source may not have metadata yet. */ }
      media.playbackRate = 1;
    }
    setState(current => ({ ...current, paused: true, time: 0, duration: 0, metadataReady: false, waiting: kind === "video", rate: 1, error: "" }));
  }, [src, kind]);
  React.useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);
  React.useEffect(() => {
    if (kind !== "audio") return;
    const pauseOther = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; scope?: string }>).detail;
      if (detail?.scope === playbackScope && detail.id !== playerId) mediaRef.current?.pause();
    };
    document.addEventListener("canvas-audio-play", pauseOther);
    return () => document.removeEventListener("canvas-audio-play", pauseOther);
  }, [kind, playbackScope, playerId]);
  const togglePlay = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused || media.ended) {
      if (media.ended) media.currentTime = 0;
      setState(current => ({ ...current, error: "", waiting: true }));
      void media.play().then(sync).catch(error => {
        if (error instanceof Error && error.name === "AbortError") return;
        setState(current => ({ ...current, paused: true, waiting: false, error: mediaPlaybackError(error, kind) }));
      });
    } else media.pause();
    sync();
  };
  const setTime = (value: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = clampVideoTime(value, finiteMediaDuration(media));
    sync();
  };
  const seekFromWaveform = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !duration) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setTime(duration * ratio);
  };
  const toggleMute = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.muted || media.volume === 0) { media.muted = false; if (media.volume === 0) media.volume = 1; }
    else media.muted = true;
    sync();
  };
  const setVolume = (value: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = value;
    media.muted = value === 0;
    sync();
  };
  const cycleRate = () => {
    const media = mediaRef.current;
    if (!media) return;
    media.playbackRate = nextAudioPlaybackRate(media.playbackRate);
    sync();
  };
  const retryAudio = () => {
    const media = mediaRef.current;
    if (!media) return;
    setState(current => ({ ...current, error: "", waiting: false }));
    media.load();
  };
  const toggleFullscreen = () => {
    if (!shellRef.current) return;
    if (document.fullscreenElement === shellRef.current) void document.exitFullscreen();
    else void shellRef.current.requestFullscreen?.();
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); togglePlay(); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); setTime(state.time - 5); }
    else if (event.key === "ArrowRight") { event.preventDefault(); setTime(state.time + 5); }
    else if (kind === "video" && event.key.toLowerCase() === "m") { event.preventDefault(); toggleMute(); }
  };
  const mediaProps = {
    ref: attachMedia,
    src, poster, autoPlay, muted, playsInline, crossOrigin, preload, controls: false, tabIndex: kind === "video" ? 0 : -1, "aria-label": label,
    onLoadedMetadata: (event: React.SyntheticEvent<MediaElement>) => { sync(); onLoadedMetadata?.(event); },
    onLoadedData: (event: React.SyntheticEvent<MediaElement>) => { sync(); onLoadedData?.(event); },
    onCanPlay: (event: React.SyntheticEvent<MediaElement>) => { sync(); onCanPlay?.(event); },
    onPlaying: (event: React.SyntheticEvent<MediaElement>) => { setState(current => ({ ...current, error: "" })); sync(); onPlaying?.(event); },
    onWaiting: (event: React.SyntheticEvent<MediaElement>) => { setState(value => ({ ...value, waiting: true })); onWaiting?.(event); },
    onStalled: (event: React.SyntheticEvent<MediaElement>) => { setState(value => ({ ...value, waiting: true })); onStalled?.(event); },
    onTimeUpdate: (event: React.SyntheticEvent<MediaElement>) => { sync(); onTimeUpdate?.(event); },
    onDurationChange: sync,
    onEmptied: () => setState({ paused: true, muted, volume: muted ? 0 : 1, time: 0, duration: 0, metadataReady: false, waiting: kind === "video", rate: 1, error: "" }),
    onPlay: () => {
      sync();
      if (kind === "audio") document.dispatchEvent(new CustomEvent("canvas-audio-play", { detail: { id: playerId, scope: playbackScope } }));
    },
    onPause: sync,
    onEnded: (event: React.SyntheticEvent<MediaElement>) => { sync(); onEnded?.(event); },
    onVolumeChange: sync,
    onError: (event: React.SyntheticEvent<MediaElement>) => {
      setState(current => ({ ...current, paused: true, waiting: false, error: kind === "audio" ? "音频解码失败，可重新加载或下载原文件。" : "视频解码失败，请重新加载或替换视频。" }));
      onError?.(event);
    },
    onPointerDown,
    onContextMenu: (event: React.MouseEvent<MediaElement>) => event.preventDefault(),
  };
  const duration = Math.max(0, state.duration);
  const time = clampVideoTime(state.time, duration);
  const mutedState = state.muted || state.volume === 0;
  const audioShape = kind === "audio" ? (waveform?.length ? waveform : FALLBACK_AUDIO_SHAPE) : undefined;
  return <div ref={shellRef} className={`canvas-media-player canvas-media-player--${kind}${shellClassName ? ` ${shellClassName}` : ""}`} data-canvas-media-player data-interactive-media role="group" aria-label={`${label}播放控制`} tabIndex={0} onKeyDown={handleKeyDown} onPointerDown={event => { if ((event.target as Element).closest("button,input,[role='slider']")) event.stopPropagation(); }}>
    {kind === "video" ? <video {...mediaProps} className={className} /> : <>
      <audio {...mediaProps} className={className} />
      {showAudioHeading && <div className="canvas-media-audio-heading"><span className="canvas-media-audio-icon"><Music2 size={16} aria-hidden="true" /></span><span className="canvas-media-audio-copy"><strong title={label}>{label}</strong><small>音频文件</small></span><button className="canvas-media-rate" type="button" aria-label={`播放速度 ${state.rate} 倍`} title="切换播放速度" onClick={cycleRate}><Gauge size={14} /><span>{state.rate}×</span></button></div>}
      {state.error ? <div className="canvas-media-audio-error" role="alert"><span>{state.error}</span><button type="button" onClick={retryAudio}>重试加载</button></div> : audioShape?.length ? <div
        className="canvas-media-audio-waveform"
        role="slider"
        aria-label="音频波形进度"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={time}
        aria-valuetext={state.metadataReady ? `${formatVideoTime(time)} / ${formatVideoTime(duration)}` : `${formatVideoTime(time)} / 时长读取中`}
        tabIndex={duration ? 0 : -1}
        onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); seekFromWaveform(event); }}
        onPointerMove={event => { if (event.buttons === 1) seekFromWaveform(event); }}
        onKeyDown={event => {
          if (event.key === "ArrowLeft") { event.preventDefault(); setTime(time - 5); }
          else if (event.key === "ArrowRight") { event.preventDefault(); setTime(time + 5); }
          else if (event.key === "Home") { event.preventDefault(); setTime(0); }
          else if (event.key === "End") { event.preventDefault(); setTime(duration); }
        }}
      >{audioShape.map((peak, index) => <span key={index} className={duration > 0 && (index + 1) / audioShape.length <= time / duration ? "is-played" : ""} style={{ "--audio-wave-height": `${Math.max(10, Math.min(100, peak * 100))}%` } as React.CSSProperties} />)}</div> : null}
    </>}
    {state.waiting && <span className="canvas-media-player-loading" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" /><span className="sr-only">正在加载媒体</span></span>}
    <div className="canvas-media-player-controls">
      <button type="button" aria-label={state.paused ? "播放" : "暂停"} title={state.paused ? "播放" : "暂停"} onClick={togglePlay}><>{state.paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}</></button>
      {kind === "audio" && audioShape?.length ? <span className="canvas-media-player-progress-description sr-only">使用波形调整播放进度</span> : <input className="canvas-media-player-progress" type="range" aria-label="播放进度" min={0} max={duration || 1} step="0.01" value={time} disabled={!duration} onChange={event => setTime(Number(event.currentTarget.value))} style={{ "--canvas-media-progress": `${duration > 0 ? (time / duration) * 100 : 0}%` } as React.CSSProperties} />}
      <span className="canvas-media-player-time" aria-label={state.metadataReady ? `${formatVideoTime(time)} / ${formatVideoTime(duration)}` : `${formatVideoTime(time)} / 时长读取中`}>{formatVideoTime(time)} / {state.metadataReady ? formatVideoTime(duration) : "--:--"}</span>
      {kind === "audio" && audioFormat ? <span className="canvas-media-audio-format">{audioFormat}</span> : null}
      {kind === "video" && <><button type="button" aria-label={mutedState ? "取消静音" : "静音"} title={mutedState ? "取消静音" : "静音"} onClick={toggleMute}>{mutedState ? <VolumeX size={16} /> : <Volume2 size={16} />}</button><input className="canvas-media-player-volume" type="range" aria-label="音量" min={0} max={1} step="0.05" value={mutedState ? 0 : state.volume} onChange={event => setVolume(Number(event.currentTarget.value))} /></>}
      {kind === "video" && <button type="button" aria-label={fullscreen ? "退出全屏" : "全屏"} title={fullscreen ? "退出全屏" : "全屏"} onClick={toggleFullscreen}><Expand size={16} /></button>}
    </div>
  </div>;
}
