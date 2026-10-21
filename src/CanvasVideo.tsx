import React from "react";
import { Camera, LoaderCircle, Pause, Play, RotateCcw, Upload, Volume2, VolumeX, X } from "lucide-react";
import { createVideoHoverPreview } from "./video-hover-preview";
import { captureVideoFrame, clampVideoTime, formatVideoTime, isVideoPlayerGlobalShortcut, videoPlaybackErrorMessage, type CapturedVideoFrame } from "./video-player";
import { exportVideoEdit, type VideoEditOptions } from "./video-editing";
import { LOCAL_AUDIO_MAX_BYTES } from "./audio-cache";
import type { VideoNodeSourceToken } from "./video-node-media";
import { diagnosticErrorFields, recordCanvasDiagnostic } from "./client-diagnostics.ts";
import "./canvas-video.css";

export type VideoProcessRequest = { id: number; options: VideoEditOptions; source: VideoNodeSourceToken };

export type CanvasVideoProps = {
  src: string;
  poster?: string;
  label: string;
  hoverPreview: boolean;
  /** Play the canvas clip while its node is selected. */
  selected?: boolean;
  interactive?: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onCaptureFrame: (frame: CapturedVideoFrame) => void | Promise<void>;
  captureRequest?: number;
  onCaptureRequestHandled?: (request: number) => void;
  onCaptureReadyChange?: (ready: boolean) => void;
  processRequest?: VideoProcessRequest;
  onProcessRequestHandled?: (id: number) => void;
  onProcessProgress?: (progress: number, request: VideoProcessRequest) => void;
  onProcessResult?: (blob: Blob, request: VideoProcessRequest, signal: AbortSignal) => void | Promise<void>;
  onProcessError?: (error: unknown, request: VideoProcessRequest) => void;
  onPlaybackStateChange?: (state: { duration: number; time: number; ready: boolean; processing: boolean }) => void;
  processCancelRequest?: number;
  onReplace?: () => void;
  onLoadedData?: (width: number, height: number) => void;
  onRetry?: () => boolean | void | Promise<boolean | void>;
  onAutoRetry?: () => boolean | void | Promise<boolean | void>;
  /** Surface transient playback/capture failures through the workbench toast. */
  onNotice?: (text: string, action?: { label: string; run: () => void }) => void;
  /** A logical asset change, not a renewed signature, resets auto recovery. */
  recoveryKey?: string;
  sourceDiagnostic?: string;
};

/** Reset transient playback/capture state when the actual media source changes. */
export default function CanvasVideo(props: CanvasVideoProps) {
  // Keep the retry budget outside the source-keyed player. A renewed URL
  // remounts its decoder, but must not start an endless metadata refresh loop.
  const recovered = React.useRef(false);
  React.useEffect(() => { recovered.current = false; }, [props.recoveryKey]);
  const automaticRetry = props.onAutoRetry || props.onRetry;
  const recoverSource = automaticRetry ? () => {
    if (recovered.current) return undefined;
    recovered.current = true;
    return Promise.resolve().then(() => automaticRetry());
  } : undefined;
  return <VideoPlayer key={props.src} {...props} recoverSource={recoverSource} />;
}

function VideoPlayer({ src, poster, label, hoverPreview, selected = false, interactive = true, onSelect, onPreview, onCaptureFrame, onReplace, onLoadedData, onRetry, onNotice, sourceDiagnostic, recoverSource, captureRequest, onCaptureRequestHandled, onCaptureReadyChange, processRequest, onProcessRequestHandled, onProcessProgress, onProcessResult, onProcessError, onPlaybackStateChange, processCancelRequest }: CanvasVideoProps & { recoverSource?: () => Promise<boolean | void> | undefined }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const controller = React.useRef<ReturnType<typeof createVideoHoverPreview> | null>(null);
  const mounted = React.useRef(true);
  const capturePending = React.useRef(false);
  const [playback, setPlayback] = React.useState({ paused: true, muted: false, volume: 1, time: 0, duration: 0, ready: false, seeking: false, ended: false });
  const [waiting, setWaiting] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);
  const processingRef = React.useRef(false);
  const processRequestRef = React.useRef(processRequest);
  processRequestRef.current = processRequest;
  const processHandledRef = React.useRef(onProcessRequestHandled);
  processHandledRef.current = onProcessRequestHandled;
  const processProgressRef = React.useRef(onProcessProgress);
  processProgressRef.current = onProcessProgress;
  const processResultRef = React.useRef(onProcessResult);
  processResultRef.current = onProcessResult;
  const processErrorRef = React.useRef(onProcessError);
  processErrorRef.current = onProcessError;
  const processAbortRef = React.useRef<AbortController | null>(null);
  const [error, setError] = React.useState("");
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [corsFallback, setCorsFallback] = React.useState(false);
  const notify = (message: string, action?: { label: string; run: () => void }) => {
    setError(message);
    onNotice?.(message, action);
  };

  const syncPlayback = React.useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setPlayback({
      paused: video.paused, muted: video.muted, volume: video.volume,
      time: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      ready: video.readyState >= 2, seeking: video.seeking, ended: video.ended,
    });
  }, []);

  const attachVideo = React.useCallback((video: HTMLVideoElement | null) => {
    controller.current?.stop();
    videoRef.current = video;
    controller.current = video ? createVideoHoverPreview(video) : null;
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") controller.current?.stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mounted.current = false;
      processAbortRef.current?.abort();
      controller.current?.stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
  React.useLayoutEffect(() => {
    if (!hoverPreview || !interactive) controller.current?.stop();
  }, [hoverPreview, interactive]);

  // A selected video is the active canvas preview. Keep it looping and start
  // it as soon as the source is mounted. Selection can also happen from the
  // keyboard or a marquee, so retry muted when browser autoplay policy rejects
  // the current volume. Once the user pauses it, no effect dependency changes
  // and the manual pause is respected until the node is selected again.
  React.useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    const shouldPlay = selected && interactive && !loadFailed;
    if (!video) return () => { cancelled = true; };
    video.loop = shouldPlay;
    if (!shouldPlay) {
      controller.current?.takeManualControl();
      if (!video.paused) video.pause();
      return () => { cancelled = true; };
    }
    controller.current?.takeManualControl();
    setWaiting(true);
    void video.play().catch(() => {
      if (cancelled || !mounted.current || videoRef.current !== video || !video.loop) return;
      if (!video.muted) {
        video.muted = true;
        void video.play().catch(() => {
          if (cancelled || !mounted.current || videoRef.current !== video || !video.loop) return;
          setWaiting(false);
          syncPlayback();
        });
        return;
      }
      setWaiting(false);
      syncPlayback();
    });
    return () => { cancelled = true; };
  }, [interactive, loadFailed, selected, syncPlayback]);

  const takeControl = () => {
    controller.current?.takeManualControl();
  };
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || loadFailed) return;
    takeControl();
    setError("");
    if (!video.paused) { video.pause(); return; }
    if (video.ended) video.currentTime = 0;
    setWaiting(true);
    void video.play().catch(() => {
      if (!mounted.current || videoRef.current !== video) return;
      setWaiting(false);
      notify("视频暂时无法播放，请重试或替换视频。");
    });
  };
  const seek = (time: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    takeControl();
    video.currentTime = clampVideoTime(time, video.duration);
    syncPlayback();
  };
  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const shouldMute = !(video.muted || video.volume === 0);
    takeControl();
    if (!shouldMute && video.volume === 0) video.volume = 1;
    video.muted = shouldMute;
    syncPlayback();
  };
  const capture = async () => {
    const video = videoRef.current;
    if (!video || capturePending.current) return;
    // Stop hover playback before capture. A manually started clip is not
    // owned by the hover controller and keeps playing.
    controller.current?.stop();
    takeControl();
    capturePending.current = true;
    setCapturing(true);
    setError("");
    try {
      // Capture synchronously before persistence/navigation can change the frame.
      await onCaptureFrame(captureVideoFrame(video));
    } catch (cause) {
      if (mounted.current) notify(cause instanceof Error ? cause.message : "截帧失败，请稍后重试。");
    } finally {
      capturePending.current = false;
      if (mounted.current) setCapturing(false);
    }
  };
  const captureReady = playback.ready && !playback.seeking && !loadFailed && !capturing;
  const handledCaptureRequest = React.useRef(0);
  const captureReadyChangeRef = React.useRef(onCaptureReadyChange);
  captureReadyChangeRef.current = onCaptureReadyChange;
  const captureRequestHandledRef = React.useRef(onCaptureRequestHandled);
  captureRequestHandledRef.current = onCaptureRequestHandled;
  React.useEffect(() => {
    captureReadyChangeRef.current?.(captureReady);
  }, [captureReady]);
  React.useEffect(() => () => captureReadyChangeRef.current?.(false), []);
  React.useEffect(() => {
    const request = captureRequest || 0;
    if (request <= handledCaptureRequest.current || !captureReady) return;
    handledCaptureRequest.current = request;
    captureRequestHandledRef.current?.(request);
    void capture();
  }, [captureRequest, captureReady]);
  React.useEffect(() => {
    const request = processRequestRef.current;
    const video = videoRef.current;
    if (!request || !captureReady || !video || processingRef.current) return;
    controller.current?.stop();
    controller.current?.takeManualControl();
    processingRef.current = true;
    const abort = new AbortController();
    processAbortRef.current = abort;
    processHandledRef.current?.(request.id);
    processProgressRef.current?.(0, request);
    void exportVideoEdit(video, request.options, progress => processProgressRef.current?.(progress, request), abort.signal,
      request.options.operation === "extract-audio" ? LOCAL_AUDIO_MAX_BYTES : Number.POSITIVE_INFINITY)
      .then(result => { abort.signal.throwIfAborted(); return processResultRef.current?.(result, request, abort.signal); })
      .catch(error => processErrorRef.current?.(error, request))
      .finally(() => {
        processingRef.current = false;
        processAbortRef.current = null;
        processProgressRef.current?.(0, request);
      });
  }, [processRequest?.id, captureReady]);
  React.useEffect(() => {
    onPlaybackStateChange?.({ duration: playback.duration, time: playback.time, ready: captureReady, processing: processingRef.current });
  }, [playback.duration, playback.time, captureReady, onPlaybackStateChange]);
  React.useEffect(() => { if (processCancelRequest) processAbortRef.current?.abort(); }, [processCancelRequest]);
  const retry = () => {
    if (!interactive) return;
    setLoadFailed(false);
    setError("");
    setWaiting(true);
    if (onRetry) {
      void (async () => {
        try {
          const previousVideo = videoRef.current;
          recordCanvasDiagnostic("info", "video.source.manual_refresh_started", { component: "video", operation: "source_refresh" });
          const recovered = await onRetry();
          if (!mounted.current) return;
          if (recovered !== false) {
            recordCanvasDiagnostic("info", "video.source.manual_refresh_finished", { component: "video", operation: "source_refresh", result: "succeeded" });
            if (videoRef.current === previousVideo) previousVideo?.load();
            return;
          }
          recordCanvasDiagnostic("warn", "video.source.manual_refresh_finished", { component: "video", operation: "source_refresh", result: "failed" });
          setWaiting(false);
          setLoadFailed(true);
          notify("视频内容暂时无法重新获取，请检查网络或任务状态后重试。", { label: "重新获取", run: retry });
        } catch (cause) {
          recordCanvasDiagnostic("error", "video.source.manual_refresh_failed", {
            component: "video", operation: "source_refresh", ...diagnosticErrorFields(cause),
          });
          if (!mounted.current) return;
          setWaiting(false);
          setLoadFailed(true);
          notify(cause instanceof Error ? cause.message : "重新获取视频失败，请稍后重试。", { label: "重新获取", run: retry });
        }
      })();
      return;
    }
    videoRef.current?.load();
  };
  const muted = playback.muted || playback.volume === 0;
  const duration = Math.max(0, playback.duration);
  const time = clampVideoTime(playback.time, duration);
  const progressStyle = { "--video-progress": `${duration > 0 ? time / duration * 100 : 0}%` } as React.CSSProperties;

  return <div className={`canvas-video ${playback.paused ? "is-paused" : "is-playing"}`} data-canvas-video-player data-interactive={interactive}
    role="group" aria-label={label}
    onPointerEnter={event => {
      if (interactive && hoverPreview && !loadFailed && event.pointerType !== "touch" && document.visibilityState !== "hidden") controller.current?.start();
    }}
    onPointerLeave={() => controller.current?.stop()}
    onPointerDown={event => {
      if (!interactive) return;
      const target = event.target as Element;
      if (target.closest(".canvas-video-controls,.canvas-video-replace,.canvas-video-error")) {
        event.stopPropagation();
        if (event.button === 0) onSelect();
      }
    }}
    onFocusCapture={() => { if (interactive) onSelect(); }}
    onDoubleClick={event => {
      if (!interactive) return;
      event.preventDefault(); event.stopPropagation();
      if (!(event.target as Element).closest("button,input")) {
        controller.current?.stop();
        takeControl();
        videoRef.current?.pause();
        onPreview();
      }
    }}
    onKeyDown={event => {
      if (!interactive || isVideoPlayerGlobalShortcut(event)) return;
      // Keep the board's Space, Delete and arrow shortcuts out of the controls.
      event.stopPropagation();
      if ((event.target as Element).closest("button,input")) return;
      if (event.key === " " || event.key === "Enter") { event.preventDefault(); togglePlay(); }
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); seek(playback.time + (event.key === "ArrowLeft" ? -5 : 5)); }
      else if (event.key.toLowerCase() === "m") { event.preventDefault(); toggleMute(); }
    }}
  >
    <video key={String(corsFallback)} ref={attachVideo} className="node-video" src={src} poster={poster}
      autoPlay={selected && interactive && !loadFailed} loop={selected && interactive && !loadFailed}
      playsInline preload="metadata" controls={false} crossOrigin={corsFallback ? undefined : "anonymous"}
      tabIndex={interactive ? 0 : -1} aria-label={`${label}，空格播放或暂停，双击进入画廊`}
      onLoadedMetadata={syncPlayback} onDurationChange={syncPlayback} onTimeUpdate={syncPlayback}
      onLoadedData={() => { syncPlayback(); setWaiting(false); onLoadedData?.(videoRef.current?.videoWidth || 0, videoRef.current?.videoHeight || 0); }}
      onCanPlay={() => { syncPlayback(); setWaiting(false); }}
      onPlay={syncPlayback} onPlaying={() => { syncPlayback(); setWaiting(false); }}
      onPause={() => { syncPlayback(); setWaiting(false); }} onEnded={syncPlayback} onVolumeChange={syncPlayback}
      onSeeking={() => { syncPlayback(); setWaiting(true); }} onSeeked={() => { syncPlayback(); setWaiting(false); }}
      onWaiting={() => setWaiting(true)}
      onError={() => {
        const media = videoRef.current;
        const mediaErrorCode = media?.error?.code;
        let sourceOrigin: string | undefined;
        try {
          const sourceURL = new URL(src);
          if (sourceURL.protocol === "http:" || sourceURL.protocol === "https:") sourceOrigin = sourceURL.origin;
        } catch { /* Local blob/data media has no remote origin to diagnose. */ }
        const mediaErrorName = mediaErrorCode === 1 ? "aborted" : mediaErrorCode === 2 ? "network" : mediaErrorCode === 3 ? "decode" : mediaErrorCode === 4 ? "source_not_supported" : undefined;
        recordCanvasDiagnostic("error", "video.playback.failed", {
          component: "video",
          operation: "playback",
          media_error_code: mediaErrorCode,
          media_error_name: mediaErrorName,
          network_state: media?.networkState,
          ready_state: media?.readyState,
          source_origin: sourceOrigin,
          cors_mode: corsFallback ? "none" : "anonymous",
        });
        // Re-signing cannot repair a confirmed decoder error. Other errors,
        // including a 403 reported as code 4, get one automatic refresh.
        const refresh = videoRef.current?.error?.code === 3 ? undefined : recoverSource?.();
        if (refresh) {
          recordCanvasDiagnostic("info", "video.source.automatic_refresh_started", { component: "video", operation: "automatic_refresh" });
          setWaiting(true);
          void refresh.then(ok => {
            if (!mounted.current) return;
            if (ok !== false) {
              recordCanvasDiagnostic("info", "video.source.automatic_refresh_finished", { component: "video", operation: "automatic_refresh", result: "succeeded" });
              videoRef.current?.load(); return;
            }
            recordCanvasDiagnostic("warn", "video.source.automatic_refresh_finished", { component: "video", operation: "automatic_refresh", result: "failed" });
            setWaiting(false); setLoadFailed(true); notify("视频资产暂时无法读取，请重新获取后重试。", { label: onRetry ? "重新获取" : "重新加载", run: retry });
          }).catch(cause => {
            recordCanvasDiagnostic("error", "video.source.automatic_refresh_failed", {
              component: "video", operation: "automatic_refresh", ...diagnosticErrorFields(cause),
            });
            if (!mounted.current) return;
            setWaiting(false); setLoadFailed(true); notify("视频地址更新失败，请稍后重试。", { label: onRetry ? "重新获取" : "重新加载", run: retry });
          });
          return;
        }
        // A cross-origin media element can still play without CORS permission,
        // although canvas capture/editing will remain restricted. Try that
        // playback-only path after a refreshed source still reports code 4.
        let crossOriginHttpSource = false;
        try {
          const sourceURL = new URL(src);
          crossOriginHttpSource = (sourceURL.protocol === "http:" || sourceURL.protocol === "https:") && sourceURL.origin !== window.location.origin;
        } catch { /* Local blob/data media does not need a CORS fallback. */ }
        if (mediaErrorCode === 4 && crossOriginHttpSource && !corsFallback) {
          recordCanvasDiagnostic("info", "video.playback.cors_fallback_started", { component: "video", operation: "playback", result: "fallback" });
          setCorsFallback(true);
          return;
        }
        setWaiting(false); setLoadFailed(true);
        notify(videoPlaybackErrorMessage(videoRef.current?.error?.code), { label: onRetry ? "重新获取" : "重新加载", run: retry });
      }}
    />
    {onReplace && <button className="canvas-video-replace" type="button" aria-label="替换视频" title="替换视频" disabled={!interactive}
      onClick={() => { controller.current?.stop(); takeControl(); videoRef.current?.pause(); onReplace(); }}><Upload size={18} aria-hidden="true" /></button>}
    {waiting && !error && <span className="canvas-video-loading" role="status"><LoaderCircle className="spin" size={22} aria-hidden="true" /><span className="sr-only">正在加载视频</span></span>}
    {error && !onNotice && <div className="canvas-video-error" role="alert">
      <span>{error}</span>
      {loadFailed && sourceDiagnostic && <small className="canvas-video-diagnostic">接口内容：{sourceDiagnostic}</small>}
      {loadFailed && <button type="button" onClick={retry} disabled={!interactive}><RotateCcw size={14} aria-hidden="true" />{onRetry ? "重新获取" : "重新加载"}</button>}
      {!loadFailed && <button type="button" aria-label="关闭视频提示" disabled={!interactive} onClick={() => setError("")}><X size={14} aria-hidden="true" /></button>}
    </div>}
    <div className="canvas-video-controls" aria-label="视频播放控制">
      <button className="canvas-video-play" type="button" aria-label={playback.paused ? "播放视频" : "暂停视频"}
        title={playback.ended ? "重新播放" : playback.paused ? "播放视频" : "暂停视频"} disabled={!interactive || loadFailed} onClick={togglePlay}>
        {playback.paused ? <Play size={18} fill="currentColor" aria-hidden="true" /> : <Pause size={18} fill="currentColor" aria-hidden="true" />}
      </button>
      <input className="canvas-video-progress" type="range" aria-label="播放进度" min="0" max={duration || 1} step="0.01" value={time}
        aria-valuetext={`${formatVideoTime(time)} / ${formatVideoTime(duration)}`} style={progressStyle}
        disabled={!interactive || loadFailed || duration <= 0} onChange={event => seek(Number(event.currentTarget.value))} />
      <span className="canvas-video-time" aria-hidden="true">{formatVideoTime(time)}<span> / </span>{formatVideoTime(duration)}</span>
      <div className="canvas-video-volume">
        <button type="button" aria-label={muted ? "取消静音" : "静音"} title={muted ? "取消静音" : "静音"} aria-pressed={muted}
          disabled={!interactive || loadFailed} onClick={toggleMute}>{muted ? <VolumeX size={19} aria-hidden="true" /> : <Volume2 size={19} aria-hidden="true" />}</button>
        <div className="canvas-video-volume-popup"><input type="range" aria-label="音量" min="0" max="1" step="0.05"
          value={muted ? 0 : playback.volume} disabled={!interactive || loadFailed}
          aria-valuetext={`${Math.round((muted ? 0 : playback.volume) * 100)}%`}
          onChange={event => {
            const video = videoRef.current;
            if (!video) return;
            takeControl(); video.volume = Number(event.currentTarget.value); video.muted = video.volume === 0; syncPlayback();
          }} /></div>
      </div>
      <button className="canvas-video-capture" type="button" aria-label="截取当前帧" title="截取当前帧到画布"
        disabled={!interactive || loadFailed || !playback.ready || playback.seeking || capturing} onClick={() => void capture()}>
        {capturing ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}<span>{capturing ? "截取中…" : "截取当前帧"}</span>
      </button>
    </div>
  </div>;
}
