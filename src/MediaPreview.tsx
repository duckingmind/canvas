import React from "react";
import { ChevronLeft, ChevronRight, Film, Image as ImageIcon, Info, LoaderCircle, LocateFixed, RefreshCw, Music2, Minus, Plus, Scan } from "lucide-react";
import { videoPlaybackErrorMessage } from "./video-player";
import { videoSourceNeedsRefresh } from "./video-source";
import { videoAspectRatio } from "./video-layout";
import { adjacentImagePreloadSource } from "./media-preview-preload";
import { imagePreviewURL, isCosImageURL, isThumbnailURL } from "./image-variants";
import CanvasMediaPlayer from "./CanvasMediaPlayer";
import "./media-preview.css";

type Media = { id: string; title: string; type?: string; mediaType?: string; assetId?: string; taskId?: string; text?: string; image?: string; imageThumbnail?: string; video?: string; videoContentUrl?: string; videoContentUrlExpiresAt?: string; videoAspectRatio?: string; audio?: string; videoPoster?: string };

export default function MediaPreview<T extends Media>({ node, items, index, sources, error, videoContentLoading, videoContentError, audioContentLoading, audioContentError, onAudioRetry, shouldRefreshImageOriginal = false, onSelect, onLocate, onVideoRetry, onImageRetry, onImageOriginalRequest, onImageLoaded, onNotice, resolveImageSource, resolveImageThumbnail }: {
  node: T;
  items: T[];
  index: number;
  sources: T[];
  error: string;
  /** Loading state while resolving the existing task/asset's signed delivery URL. */
  videoContentLoading?: boolean;
  /** Error from the existing task/asset metadata request. */
  videoContentError?: string;
  audioContentLoading?: boolean;
  audioContentError?: string;
  onAudioRetry?: () => boolean | void | Promise<boolean | void>;
  /** Whether the current canonical image URL is close to expiring. */
  shouldRefreshImageOriginal?: boolean;
  onSelect: (node: T) => void;
  onLocate: (id: string) => void;
  onVideoRetry?: () => boolean | void | Promise<boolean | void>;
  onImageRetry?: () => void | Promise<void>;
  /** Surface preview failures through the workbench notice. */
  onNotice?: (text: string, action?: { label: string; run: () => void }) => void;
  /** Resolve a fresh, full-resolution source for the selected detail view. */
  onImageOriginalRequest?: () => string | undefined | Promise<string | undefined>;
  onImageLoaded?: (source: string) => void;
  resolveImageSource?: (source?: string) => string | undefined;
  resolveImageThumbnail?: (source?: string, explicitThumbnail?: string) => string | undefined;
}) {
  const isVideo = Boolean(node.type === "video" || node.mediaType === "video" || node.video || node.videoContentUrl);
  // The refresh helper renews links proactively; a newly delivered short-TTL
  // URL remains playable until its actual deadline, even below that margin.
  const videoSource = [node.video, node.videoContentUrl].find(url => url && !videoSourceNeedsRefresh({ url, urlExpiresAt: node.videoContentUrlExpiresAt }, Date.now(), 0));
  const videoSourceAvailable = Boolean(videoSource);
  const videoContentMessage = videoContentError || (isVideo ? error : "");
  const isAudio = Boolean(node.audio || node.type === "audio" || node.mediaType === "audio");
  const hasImage = Boolean(node.image || node.imageThumbnail);
  const imageOriginalSource = resolveImageSource?.(node.image) || node.image;
  const resolvedImageThumbnail = resolveImageThumbnail?.(node.image, node.imageThumbnail);
  const explicitImageThumbnail = resolvedImageThumbnail || node.imageThumbnail;
  const relativeImageThumbnail = explicitImageThumbnail && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(explicitImageThumbnail)
    ? explicitImageThumbnail
    : undefined;
  const imageThumbnailSource = relativeImageThumbnail || imagePreviewURL(node.image, explicitImageThumbnail);
  // A signed thumbnail can look like an "original" URL because its transform
  // is covered by the signature and cannot be stripped in the browser. Treat
  // it as thumbnail-only until the parent resolves a fresh canonical source.
  // Opaque CDN URLs need their explicit thumbnail provenance as well. A
  // successful load cannot prove that the same URL contains original bytes.
  // Local uploads already contain the bytes and need no metadata lookup.
  const imageOriginalIsThumbnail = Boolean(imageOriginalSource && (
    isThumbnailURL(imageOriginalSource) ||
    ((node.imageThumbnail === imageOriginalSource || node.image === node.imageThumbnail) &&
      !/^(?:data|blob):/i.test(imageOriginalSource) &&
      (node.assetId || node.taskId) && onImageOriginalRequest)
  ));
  const progressiveImage = Boolean(
    imageOriginalSource && imageThumbnailSource && imageOriginalSource !== imageThumbnailSource && !imageOriginalIsThumbnail,
  );
  const [videoFailed, setVideoFailed] = React.useState(false);
  const [videoErrorMessage, setVideoErrorMessage] = React.useState("");
  const [audioFailed, setAudioFailed] = React.useState(false);
  const [audioAttempt, setAudioAttempt] = React.useState(0);
  const [videoAttempt, setVideoAttempt] = React.useState(0);
  const [imageAttempt, setImageAttempt] = React.useState(0);
  const [imageFailed, setImageFailed] = React.useState(false);
  const [mediaSwitching, setMediaSwitching] = React.useState(false);
  const initialImageFullResolution = Boolean(
    imageOriginalSource && (
      (!imageThumbnailSource && !isCosImageURL(node.image)) ||
      (imageThumbnailSource && !progressiveImage && !imageOriginalIsThumbnail)
    ) && !shouldRefreshImageOriginal,
  );
  const [imageOriginalSourceOverride, setImageOriginalSourceOverride] = React.useState<string>();
  const [imageOriginalPending, setImageOriginalPending] = React.useState(false);
  const [imageOriginalError, setImageOriginalError] = React.useState(false);
  const [imageOriginalNeedsAutoRecovery, setImageOriginalNeedsAutoRecovery] = React.useState(false);
  const [imageOriginalRefreshing, setImageOriginalRefreshing] = React.useState(false);
  // Cards require bounded thumbnails, but the selected detail view can load
  // its original directly when a thumbnail is unavailable.
  const [imageFullResolution, setImageFullResolution] = React.useState(initialImageFullResolution);
  const [imageLoading, setImageLoading] = React.useState(Boolean(imageThumbnailSource || imageOriginalSource));
  const [imageDimensions, setImageDimensions] = React.useState<{ width: number; height: number }>();
  const [imageInfoOpen, setImageInfoOpen] = React.useState(false);
  const [videoReady, setVideoReady] = React.useState(false);
  const [videoBuffering, setVideoBuffering] = React.useState(false);
  const [videoCorsFallback, setVideoCorsFallback] = React.useState(false);
  const [videoRatio, setVideoRatio] = React.useState(() => videoAspectRatio(node.videoAspectRatio));
  const videoRecoveryUsed = React.useRef(false);
  const videoRecoveryRequest = React.useRef<object | null>(null);
  const currentVideo = React.useRef({ id: node.id, source: videoSource });
  currentVideo.current = { id: node.id, source: videoSource };
  const [imageZoom, setImageZoom] = React.useState(1);
  const [zoomReadoutVisible, setZoomReadoutVisible] = React.useState(false);
  const zoomReadoutTimer = React.useRef<number | null>(null);
  const mediaSwitchTimer = React.useRef<number | null>(null);
  const zoomSliderPointerActive = React.useRef(false);
  const zoomSliderKeyboardActive = React.useRef(false);
  const [imageFitSize, setImageFitSize] = React.useState({ width: 0, height: 0 });
  const [imagePan, setImagePan] = React.useState({ x: 0, y: 0 });
  const imageViewport = React.useRef<HTMLDivElement>(null);
  const imageDrag = React.useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const imageOriginalRequest = React.useRef<Promise<string | undefined> | null>(null);
  const imageOriginalRequestVersion = React.useRef(0);
  const imageOriginalAddressLookup = React.useRef("");
  const imageOriginalAutoRecovery = React.useRef("");
  const imageOriginalReadySource = React.useRef<string>();
  const previousNodeId = React.useRef(node.id);
  const revealZoomReadout = React.useCallback(() => {
    setZoomReadoutVisible(true);
    if (zoomReadoutTimer.current !== null) window.clearTimeout(zoomReadoutTimer.current);
    zoomReadoutTimer.current = window.setTimeout(() => {
      zoomReadoutTimer.current = null;
      if (!zoomSliderPointerActive.current && !zoomSliderKeyboardActive.current) setZoomReadoutVisible(false);
    }, 1600);
  }, []);
  const stopZoomSliderPointer = React.useCallback(() => {
    zoomSliderPointerActive.current = false;
    revealZoomReadout();
  }, [revealZoomReadout]);
  React.useEffect(() => () => {
    if (zoomReadoutTimer.current !== null) window.clearTimeout(zoomReadoutTimer.current);
    if (mediaSwitchTimer.current !== null) window.clearTimeout(mediaSwitchTimer.current);
  }, []);
  const imageSourceKey = `${node.id}\0${node.image || ""}\0${node.imageThumbnail || ""}`;
  const imageIdentityKey = `${node.id}\0${node.assetId || ""}\0${node.taskId || ""}`;
  const imageRequestKey = `${imageSourceKey}\0${imageIdentityKey}\0${imageOriginalSource || ""}\0${imageOriginalIsThumbnail}`;
  const currentImageSourceKey = React.useRef(imageRequestKey);
  currentImageSourceKey.current = imageRequestKey;
  const videoLoading = !videoReady || videoBuffering;
  // This is a detail surface, so an available original is a better first
  // frame than an empty placeholder when the server has no signed thumbnail.
  const imageThumbnailDisplaySource = imageThumbnailSource || imageOriginalSourceOverride || imageOriginalSource;
  const imageSource = imageThumbnailDisplaySource;
  const imageOriginalPreloadSource = imageOriginalSourceOverride || (
    !imageOriginalRefreshing && !imageOriginalIsThumbnail && imageOriginalSource !== imageThumbnailDisplaySource ? imageOriginalSource : undefined
  );
  const imageOriginalVisible = Boolean(imageOriginalPreloadSource && (imageOriginalPending || imageFullResolution));
  const imagePreviewAvailable = Boolean(imageSource || imageOriginalVisible);
  const remoteVideoLoading = isVideo && !videoSourceAvailable && !videoContentMessage && videoContentLoading !== false;
  const mediaLoading = isVideo ? videoSourceAvailable ? videoLoading : remoteVideoLoading : Boolean(hasImage && (imageLoading || imageOriginalPending));
  const strip = React.useRef<HTMLDivElement>(null);
  const preloadTimer = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    videoRecoveryUsed.current = false;
    videoRecoveryRequest.current = null;
    return () => { videoRecoveryRequest.current = null; };
  }, [node.id, node.assetId, node.taskId]);
  const retryVideo = async () => {
    if (videoRecoveryRequest.current) return;
    const token = {};
    const previous = currentVideo.current;
    videoRecoveryRequest.current = token;
    videoRecoveryUsed.current = true;
    setVideoFailed(false);
    setVideoErrorMessage("");
    setVideoReady(false);
    setVideoBuffering(true);
    try {
      const result = await onVideoRetry?.();
      if (videoRecoveryRequest.current !== token || currentVideo.current.id !== previous.id) return;
      if (result === false) throw new Error("视频资产暂时无法读取，请重新获取后重试。");
      // A changed signed URL already remounts the decoder. The same URL also
      // needs a new decoder after a transient network failure.
      if (currentVideo.current.source === previous.source) setVideoAttempt(attempt => attempt + 1);
    } catch {
      if (videoRecoveryRequest.current !== token || currentVideo.current.id !== previous.id || currentVideo.current.source !== previous.source) return;
      setVideoBuffering(false);
      setVideoFailed(true);
      setVideoErrorMessage("视频资产暂时无法读取，请检查资产是否可用后重试。");
    } finally {
      if (videoRecoveryRequest.current === token) videoRecoveryRequest.current = null;
    }
  };
  const handleVideoError = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    setVideoReady(false);
    setVideoBuffering(false);
    setVideoRatio(videoAspectRatio(node.videoAspectRatio));
    const media = event.currentTarget;
    let crossOriginHttpSource = false;
    try {
      const source = new URL(videoSource || "");
      crossOriginHttpSource =
        (source.protocol === "http:" || source.protocol === "https:") &&
        source.origin !== window.location.origin;
    } catch { /* Local blob/data media has no cross-origin playback mode. */ }
    if (
      media.error?.code === 4 &&
      media.crossOrigin === "anonymous" &&
      crossOriginHttpSource &&
      !videoCorsFallback
    ) {
      // Cross-origin playback itself does not require CORS. Drop CORS mode
      // before refreshing the signed URL, which also supports buckets without
      // Access-Control-Allow-Origin when the browser can still stream media.
      setVideoCorsFallback(true);
      setVideoBuffering(true);
      setVideoErrorMessage("");
      return;
    }
    if (!videoRecoveryRequest.current && event.currentTarget.error?.code !== 3 && !videoRecoveryUsed.current && onVideoRetry && (node.assetId || node.taskId) && /^https?:/i.test(videoSource || "")) {
      void retryVideo();
      return;
    }
    setVideoErrorMessage(videoPlaybackErrorMessage(event.currentTarget.error?.code));
    setVideoFailed(true);
  };
  const previousRequestKey = React.useRef(imageRequestKey);
  const previousThumbnailSource = React.useRef(imageSource);
  const previousOriginalSource = React.useRef(imageOriginalSource);
  const previousOriginalIsThumbnail = React.useRef(imageOriginalIsThumbnail);
  React.useEffect(() => () => {
    imageOriginalRequestVersion.current += 1;
    imageOriginalRequest.current = null;
  }, []);
  React.useLayoutEffect(() => {
    const nodeChanged = previousNodeId.current !== node.id;
    const sourceChanged = previousRequestKey.current !== imageRequestKey;
    const thumbnailChanged = previousThumbnailSource.current !== imageSource;
    const originalChanged = previousOriginalSource.current !== imageOriginalSource || previousOriginalIsThumbnail.current !== imageOriginalIsThumbnail;
    previousNodeId.current = node.id;
    previousRequestKey.current = imageRequestKey;
    previousThumbnailSource.current = imageSource;
    previousOriginalSource.current = imageOriginalSource;
    previousOriginalIsThumbnail.current = imageOriginalIsThumbnail;
    if (nodeChanged) {
      setMediaSwitching(true);
      if (mediaSwitchTimer.current !== null) window.clearTimeout(mediaSwitchTimer.current);
      mediaSwitchTimer.current = window.setTimeout(() => {
        mediaSwitchTimer.current = null;
        setMediaSwitching(false);
      }, 120);
      setVideoFailed(false);
      setVideoErrorMessage("");
      setVideoCorsFallback(false);
      setAudioFailed(false);
      setAudioAttempt(0);
      setVideoAttempt(0);
      setImageAttempt(0);
      setImageFailed(false);
      setImageOriginalSourceOverride(undefined);
      setImageOriginalPending(false);
      setImageOriginalError(false);
      setImageOriginalNeedsAutoRecovery(false);
      setImageOriginalRefreshing(false);
      setImageDimensions(undefined);
      setImageInfoOpen(false);
      imageOriginalRequestVersion.current += 1;
      imageOriginalAddressLookup.current = "";
      imageOriginalRequest.current = null;
      imageOriginalAutoRecovery.current = "";
      imageOriginalReadySource.current = undefined;
      setImageFullResolution(initialImageFullResolution);
      setImageZoom(1);
      setImageFitSize({ width: 0, height: 0 });
      setImagePan({ x: 0, y: 0 });
      setVideoReady(false);
      setVideoBuffering(false);
      setImageLoading(Boolean(imageSource));
      setZoomReadoutVisible(false);
      zoomSliderPointerActive.current = false;
      zoomSliderKeyboardActive.current = false;
      if (zoomReadoutTimer.current !== null) {
        window.clearTimeout(zoomReadoutTimer.current);
        zoomReadoutTimer.current = null;
      }
    } else if (sourceChanged) {
      // A renewed URL belongs to the same preview. Preserve zoom and the
      // current thumbnail while clearing only errors tied to the old URL.
      // Parent metadata can adopt the URL we already started decoding. Keep
      // that layer mounted instead of cancelling and downloading it again.
      const adoptedOriginalReady = Boolean(!imageOriginalIsThumbnail && imageOriginalSource && imageOriginalReadySource.current === imageOriginalSource);
      const adoptedOriginalPending = imageOriginalPending && !imageOriginalIsThumbnail && (
        imageOriginalSourceOverride === imageOriginalSource ||
        (!originalChanged && !imageOriginalRefreshing && imageOriginalPreloadSource === imageOriginalSource)
      );
      setImageOriginalSourceOverride((current) => current && current !== imageOriginalSource ? undefined : current);
      setImageFailed(false);
      setImageOriginalError(false);
      setImageFullResolution((current) => originalChanged ? adoptedOriginalReady || initialImageFullResolution : current);
      if (thumbnailChanged) setImageLoading(Boolean(imageSource));
      if (originalChanged && !adoptedOriginalReady) {
        imageOriginalReadySource.current = undefined;
        setImageDimensions(undefined);
      }
      imageOriginalRequestVersion.current += 1;
      imageOriginalRequest.current = null;
      setImageOriginalPending(adoptedOriginalPending && !adoptedOriginalReady);
      setImageOriginalRefreshing(false);
      setImageOriginalNeedsAutoRecovery(false);
    }
  }, [imageOriginalIsThumbnail, imageOriginalPending, imageOriginalPreloadSource, imageOriginalRefreshing, imageOriginalSourceOverride, imageRequestKey, imageSourceKey, imageOriginalSource, imageSource, imageZoom, initialImageFullResolution, node.audio, node.video, node.videoContentUrl, shouldRefreshImageOriginal]);
  const clampPanToSize = React.useCallback((pan: { x: number; y: number }, zoom: number, fitSize: { width: number; height: number }) => {
    const viewport = imageViewport.current;
    if (!viewport || !fitSize.width || !fitSize.height) return { x: 0, y: 0 };
    const maxX = Math.max(0, (fitSize.width * zoom - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (fitSize.height * zoom - viewport.clientHeight) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, pan.x)), y: Math.max(-maxY, Math.min(maxY, pan.y)) };
  }, []);
  const completeOriginalImage = React.useCallback((image: HTMLImageElement, source: string) => {
    imageOriginalReadySource.current = source;
    const viewport = imageViewport.current;
    if (viewport && image.naturalWidth && image.naturalHeight) {
      const fit = Math.min(viewport.clientWidth / image.naturalWidth, viewport.clientHeight / image.naturalHeight);
      const size = { width: image.naturalWidth * fit, height: image.naturalHeight * fit };
      setImageDimensions({ width: image.naturalWidth, height: image.naturalHeight });
      setImageFitSize(size);
      setImagePan((current) => clampPanToSize(current, imageZoom, size));
    }
    setImageOriginalPending(false);
    setImageOriginalError(false);
    setImageOriginalNeedsAutoRecovery(false);
    setImageOriginalRefreshing(false);
    setImageFullResolution(true);
    setImageLoading(false);
    onImageLoaded?.(source);
  }, [clampPanToSize, imageZoom, onImageLoaded]);
  const handleImageLoad = React.useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    if (currentImageSourceKey.current !== imageRequestKey || event.currentTarget.getAttribute("src") !== imageSource) return;
    setImageLoading(false);
    // A late thumbnail must not replace the original's dimensions or fit.
    if (imageOriginalPreloadSource && (imageFullResolution || imageOriginalReadySource.current === imageOriginalPreloadSource)) return;
    const image = event.currentTarget;
    if (imageSource && imageSource === imageOriginalSource && !imageOriginalIsThumbnail) {
      completeOriginalImage(image, imageSource);
      return;
    }
    const viewport = imageViewport.current;
    if (viewport && image.naturalWidth && image.naturalHeight) {
      const fit = Math.min(viewport.clientWidth / image.naturalWidth, viewport.clientHeight / image.naturalHeight);
      const size = { width: image.naturalWidth * fit, height: image.naturalHeight * fit };
      setImageFitSize(size);
      setImagePan((current) => clampPanToSize(current, imageZoom, size));
    }
  }, [clampPanToSize, completeOriginalImage, imageFullResolution, imageOriginalIsThumbnail, imageOriginalPreloadSource, imageOriginalSource, imageRequestKey, imageSource, imageZoom]);
  const requestFullResolution = React.useCallback((forceRefresh = false) => {
    if ((!forceRefresh && imageFullResolution) || imageOriginalPending || !hasImage || imageOriginalRequest.current) return;
    const requestVersion = ++imageOriginalRequestVersion.current;
    const requestSourceKey = imageRequestKey;
    const isCurrentRequest = () => requestVersion === imageOriginalRequestVersion.current && requestSourceKey === currentImageSourceKey.current;
    const currentSource = imageOriginalSource;
    const hasUsableCurrentOriginal = Boolean(currentSource && !imageOriginalIsThumbnail);
    const refreshAddress = Boolean(
      onImageOriginalRequest && (forceRefresh || shouldRefreshImageOriginal || !hasUsableCurrentOriginal),
    ) && (forceRefresh || imageOriginalAddressLookup.current !== imageIdentityKey);
    // Parent recovery may renew both URLs before this promise completes.
    // Bound automatic lookups by stable identity, even if the replacement is
    // another thumbnail or a short-lived signed URL.
    if (!hasUsableCurrentOriginal && !refreshAddress) {
      setImageOriginalError(true);
      setImageLoading(false);
      return;
    }
    if (refreshAddress) imageOriginalAddressLookup.current = imageIdentityKey;
    setImageOriginalError(false);
    setImageOriginalNeedsAutoRecovery(false);
    if (forceRefresh && imageFullResolution) {
      imageOriginalReadySource.current = undefined;
      setImageFullResolution(false);
      setImageAttempt((attempt) => attempt + 1);
    }
    if (refreshAddress) setImageOriginalSourceOverride(undefined);
    setImageOriginalRefreshing(refreshAddress);
    setImageOriginalPending(true);
    // A valid canonical original can be decoded immediately. Ask the parent
    // for a fresh signed URL only when the current address is actually a
    // thumbnail (or otherwise cannot be used as the original).
    const resolve = refreshAddress
      ? Promise.resolve().then(() => onImageOriginalRequest!())
      : Promise.resolve(hasUsableCurrentOriginal ? currentSource : undefined);
    const request = resolve.then((source) => {
      if (!isCurrentRequest()) return undefined;
      if (!source || isThumbnailURL(source) || (source === node.imageThumbnail && !/^(?:data|blob):/i.test(source))) {
        setImageOriginalPending(false);
        setImageOriginalError(true);
        setImageOriginalRefreshing(false);
        setImageLoading(false);
        return undefined;
      }
      setImageOriginalSourceOverride(source);
      setImageOriginalRefreshing(false);
      // A refreshed address can be the same full-resolution source already
      // displayed (including local images). No second load event will fire.
      const displayed = imageViewport.current?.querySelector<HTMLImageElement>(".media-preview-image");
      if (source === imageSource && displayed?.getAttribute("src") === source && displayed.complete && displayed.naturalWidth) {
        completeOriginalImage(displayed, source);
      }
      return source;
    }).catch(() => {
      if (!isCurrentRequest()) return undefined;
      setImageOriginalPending(false);
      setImageOriginalError(true);
      setImageOriginalRefreshing(false);
      setImageLoading(false);
      return undefined;
    }).finally(() => {
      if (requestVersion === imageOriginalRequestVersion.current && imageOriginalRequest.current === request) imageOriginalRequest.current = null;
    });
    imageOriginalRequest.current = request;
  }, [completeOriginalImage, hasImage, imageFullResolution, imageIdentityKey, imageOriginalIsThumbnail, imageOriginalPending, imageOriginalSource, imageRequestKey, imageSource, node.imageThumbnail, onImageOriginalRequest, shouldRefreshImageOriginal]);

  const handleOriginalPreloadLoad = React.useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    if (currentImageSourceKey.current !== imageRequestKey || event.currentTarget.getAttribute("src") !== imageOriginalPreloadSource) return;
    if (imageOriginalPreloadSource) completeOriginalImage(event.currentTarget, imageOriginalPreloadSource);
  }, [completeOriginalImage, imageOriginalPreloadSource, imageRequestKey]);
  const handleOriginalPreloadError = React.useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    if (currentImageSourceKey.current !== imageRequestKey || event.currentTarget.getAttribute("src") !== imageOriginalPreloadSource) return;
    imageOriginalReadySource.current = undefined;
    setImageOriginalPending(false);
    setImageOriginalError(true);
    setImageOriginalNeedsAutoRecovery(true);
    setImageOriginalSourceOverride(undefined);
    setImageOriginalRefreshing(false);
    setImageLoading(false);
  }, [imageOriginalPreloadSource, imageRequestKey]);
  React.useEffect(() => {
    // A stale signed original can fail after the thumbnail has already been
    // shown. Retry its stable asset/task lookup once automatically, then leave
    // the thumbnail and an explicit retry action available to the user.
    if (!imageOriginalNeedsAutoRecovery || !imageOriginalError || !onImageOriginalRequest || imageFullResolution || !(node.assetId || node.taskId)) return;
    if (imageOriginalAutoRecovery.current === imageIdentityKey) return;
    imageOriginalAutoRecovery.current = imageIdentityKey;
    setImageOriginalNeedsAutoRecovery(false);
    requestFullResolution(true);
  }, [imageFullResolution, imageIdentityKey, imageOriginalError, imageOriginalNeedsAutoRecovery, node.assetId, node.taskId, onImageOriginalRequest, requestFullResolution]);
  React.useEffect(() => {
    if (isVideo || isAudio || !hasImage || imageFullResolution || imageOriginalPending || imageOriginalError) return;
    // Let the thumbnail paint first and cancel the upgrade if the user
    // quickly switches away. Only the selected image loads full-size bytes.
    const timer = window.setTimeout(() => requestFullResolution(), 120);
    return () => window.clearTimeout(timer);
  }, [hasImage, imageFullResolution, imageOriginalError, imageOriginalPending, imageRequestKey, isAudio, isVideo, requestFullResolution]);
  const handleImageError = React.useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    if (currentImageSourceKey.current !== imageRequestKey || event.currentTarget.getAttribute("src") !== imageSource) return;
    // The thumbnail is only a fallback once the original is decoded. A late
    // thumbnail failure must not discard a working original or refresh it.
    if (imageOriginalPreloadSource && imageOriginalReadySource.current === imageOriginalPreloadSource) {
      setImageLoading(false);
      return;
    }
    // A transformed COS URL can fail independently of the signed original.
    // Promote the detail view to the original before showing a hard failure.
    if (!imageFullResolution && imageOriginalSource && progressiveImage) {
      requestFullResolution();
      return;
    }
    if (imageFullResolution && imageThumbnailSource) {
      // Never replace a usable thumbnail with a blank error state. Keep the
      // thumbnail visible and let the user retry the original explicitly.
      setImageFullResolution(false);
      setImageOriginalSourceOverride(undefined);
      setImageOriginalPending(false);
      setImageOriginalError(true);
      setImageOriginalNeedsAutoRecovery(true);
      setImageLoading(false);
      setImageAttempt(attempt => attempt + 1);
      return;
    }
    if (!imageFullResolution && (!imageOriginalSource || imageOriginalIsThumbnail) && onImageOriginalRequest && imageThumbnailSource) {
      setImageFailed(false);
      setImageOriginalError(true);
      setImageOriginalNeedsAutoRecovery(true);
      setImageLoading(false);
      return;
    }
    setImageLoading(false);
    setImageFailed(true);
  }, [imageFullResolution, imageOriginalIsThumbnail, imageOriginalPreloadSource, imageOriginalSource, imageRequestKey, imageSource, imageThumbnailSource, onImageOriginalRequest, progressiveImage, requestFullResolution]);
  const clampPan = React.useCallback((pan: { x: number; y: number }, zoom: number) => clampPanToSize(pan, zoom, imageFitSize), [clampPanToSize, imageFitSize]);
  const setZoom = React.useCallback((nextZoom: number, focus?: { x: number; y: number }) => {
    const zoom = Math.max(1, Math.min(4, Number(nextZoom.toFixed(2))));
    const previousZoom = imageZoom;
    if (zoom !== previousZoom) revealZoomReadout();
    const viewport = imageViewport.current;
    let nextPan = imagePan;
    if (zoom <= 1) nextPan = { x: 0, y: 0 };
    else if (focus && viewport) {
      const rect = viewport.getBoundingClientRect();
      const focusX = focus.x - (rect.left + rect.width / 2);
      const focusY = focus.y - (rect.top + rect.height / 2);
      const ratio = zoom / previousZoom;
      nextPan = { x: focusX - (focusX - imagePan.x) * ratio, y: focusY - (focusY - imagePan.y) * ratio };
    }
    setImageZoom(zoom);
    setImagePan(clampPan(nextPan, zoom));
    if (zoom > 1 && !imageOriginalError) requestFullResolution();
  }, [clampPan, imageOriginalError, imagePan, imageZoom, requestFullResolution, revealZoomReadout]);
  const changeZoom = React.useCallback((delta: number, focus?: { x: number; y: number }) => setZoom(imageZoom + delta, focus), [imageZoom, setZoom]);
  const handleImageWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!imagePreviewAvailable || isVideo || isAudio) return;
    event.preventDefault();
    const viewport = imageViewport.current;
    if (!viewport) return;
    changeZoom(event.deltaY < 0 ? 0.25 : -0.25, { x: event.clientX, y: event.clientY });
  }, [changeZoom, imagePreviewAvailable, isAudio, isVideo]);
  const handleImagePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (imageZoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    imageDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: imagePan.x, panY: imagePan.y };
  }, [imagePan.x, imagePan.y, imageZoom]);
  const handleImagePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = imageDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setImagePan(clampPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y }, imageZoom));
  }, [clampPan, imageZoom]);
  const stopImageDrag = React.useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    const drag = imageDrag.current;
    if (drag && event && event.currentTarget.hasPointerCapture(drag.pointerId)) event.currentTarget.releasePointerCapture(drag.pointerId);
    imageDrag.current = null;
  }, []);
  const refreshPreview = React.useCallback(async () => {
    if (isVideo) {
      await retryVideo();
      return;
    }
    if (isAudio) {
      setAudioFailed(false);
      try { if (await onAudioRetry?.() === false) setAudioFailed(true); } catch { setAudioFailed(true); }
      setAudioAttempt((attempt) => attempt + 1);
      return;
    }
    if (!hasImage) return;
    setImageFailed(false);
    setImageOriginalError(false);
    setImageOriginalNeedsAutoRecovery(false);
    requestFullResolution(true);
  }, [hasImage, isAudio, isVideo, requestFullResolution, onAudioRetry]);
  const lastNotifiedError = React.useRef("");
  React.useEffect(() => {
    const message = error || videoContentError || audioContentError ||
      (videoFailed ? videoErrorMessage || "视频预览暂时不可用。" : "") ||
      (audioFailed ? "音频预览暂时不可用。" : "") ||
      (imageOriginalError ? imageThumbnailSource ? "原图暂时无法获取，当前保留缩略图。" : "原图暂时无法获取。" : "") ||
      (imageFailed ? "图片预览暂时不可用。" : "");
    if (!message) {
      lastNotifiedError.current = "";
      return;
    }
    if (message === lastNotifiedError.current) return;
    lastNotifiedError.current = message;
    onNotice?.(message, { label: "重试", run: () => void refreshPreview() });
  }, [audioContentError, audioFailed, error, imageFailed, imageOriginalError, imageThumbnailSource, onNotice, refreshPreview, videoContentError, videoErrorMessage, videoFailed]);
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (isVideo || isAudio || !imagePreviewAvailable || event.altKey || event.ctrlKey || event.metaKey || !target?.closest(".image-modal") || target.closest("input,textarea,select,[contenteditable=\"true\"]")) return;
      if (event.key === "+" || event.key === "=") { event.preventDefault(); changeZoom(.25); }
      else if (event.key === "-") { event.preventDefault(); changeZoom(-.25); }
      else if (event.key === "0") { event.preventDefault(); setZoom(1); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changeZoom, imagePreviewAvailable, isAudio, isVideo, setZoom]);
  const selectRelative = React.useCallback((direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    onSelect(items[nextIndex]);
  }, [index, items, onSelect]);
  React.useLayoutEffect(() => {
    const element = strip.current;
    const button = element?.querySelector<HTMLButtonElement>('[aria-current="true"]');
    if (!button || !element) return;
    // Keep the active result visible without scrolling the modal or the page.
    const target = button.offsetLeft - (element.clientWidth - button.offsetWidth) / 2;
    const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
    element.scrollTo({
      left: Math.max(0, Math.min(maxScroll, target)),
      behavior: "smooth",
    });
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== button && element.contains(active)) {
      button.focus({ preventScroll: true });
    }
  }, [index, node.id, items.length]);
  React.useEffect(() => {
    // Warm adjacent thumbnails during idle time so arrow navigation does not
    // flash an empty stage. Only the selected detail loads original bytes.
    const adjacent = [items[index - 1], items[index + 1]];
    const urls = adjacent
      .map(item => (item?.image || item?.imageThumbnail)
        ? adjacentImagePreloadSource(item.image || item.imageThumbnail, resolveImageSource, (source) => resolveImageThumbnail?.(source, item.imageThumbnail))
        : item?.videoPoster
          ? adjacentImagePreloadSource(item.videoPoster)
          : undefined)
      .filter((url): url is string => Boolean(url));
    if (!urls.length || typeof window === "undefined") return;
    const warm = () => urls.forEach(url => {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    });
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const idle = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(warm, { timeout: 700 })
      : window.setTimeout(warm, 180);
    preloadTimer.current = idle;
    return () => {
      if (preloadTimer.current === null) return;
      if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(preloadTimer.current);
      else window.clearTimeout(preloadTimer.current);
      preloadTimer.current = null;
    };
  }, [index, items, resolveImageSource, resolveImageThumbnail]);
  return <>
    <div className="media-preview-stage" aria-busy={mediaLoading ? "true" : "false"}>
      <div className="media-preview-stage-tools media-preview-stage-tools-left" onPointerDown={event => event.stopPropagation()}>
        <button type="button" className="icon-button" aria-label="查看媒体信息" title="媒体信息" aria-expanded={imageInfoOpen} onClick={() => setImageInfoOpen(open => !open)}><Info size={16} /></button>
        <button type="button" className="icon-button" aria-label="刷新预览" title="刷新预览" disabled={isVideo ? !onVideoRetry : isAudio ? audioContentLoading || !node.audio && !onAudioRetry : !hasImage || imageOriginalPending} onClick={() => { void refreshPreview(); }}><RefreshCw size={16} /></button>
        {imageInfoOpen && <div className="media-preview-info" role="dialog" aria-label="媒体信息">
          <strong>{node.title || "未命名结果"}</strong>
          <span>{isVideo ? "视频" : isAudio ? "音频" : "图片"}</span>
          {!isVideo && !isAudio && hasImage && <span>{imageDimensions ? `原图 ${imageDimensions.width} × ${imageDimensions.height}px` : imageOriginalError ? "原图尺寸暂不可用" : "原图尺寸获取中"}</span>}
          {node.assetId && <span>资产 {node.assetId}</span>}
          {node.taskId && <span>任务 {node.taskId}</span>}
        </div>}
      </div>
      {isAudio && node.audio && !audioFailed ? <CanvasMediaPlayer key={`${node.id}:${node.audio}:${audioAttempt}`} kind="audio" className="preview-audio" shellClassName={mediaSwitching ? "is-switching" : undefined} src={node.audio} label={node.title} autoPlay onNotice={onNotice} onError={() => setAudioFailed(true)} /> : isAudio ? <div className="media-preview-loading" role="status"><Music2 size={22} /><span>{audioContentLoading ? "正在加载音频…" : "音频预览暂不可用"}</span></div> : videoSourceAvailable && !videoFailed ? <div key={node.id} className={`media-preview-media-wrap media-preview-video-wrap${mediaSwitching ? " is-switching" : ""}`} style={{ "--preview-video-ratio": String(videoRatio) } as React.CSSProperties}>{node.videoPoster && <img className="media-preview-video-backdrop" src={node.videoPoster} alt="" aria-hidden="true" />}{node.videoPoster && <img className={`media-preview-poster ${videoReady ? "is-hidden" : "is-visible"}`} src={node.videoPoster} alt={`${node.title} · 首帧`} />}<CanvasMediaPlayer key={`${node.id}:${videoSource || ""}:${videoAttempt}:${videoCorsFallback ? "no-cors" : "cors"}`} kind="video" className={`preview-video ${videoLoading ? "is-loading" : "is-ready"}`} src={videoSource!} poster={node.videoPoster} label={node.title} crossOrigin={node.assetId || node.taskId ? videoCorsFallback ? undefined : "anonymous" : undefined} autoPlay playsInline preload="auto" onNotice={onNotice} onLoadedMetadata={event => { const video = event.currentTarget as HTMLVideoElement; if (video.videoWidth > 0 && video.videoHeight > 0) setVideoRatio(video.videoWidth / video.videoHeight); }} onLoadedData={() => { setVideoReady(true); setVideoBuffering(false); }} onCanPlay={() => { setVideoReady(true); setVideoBuffering(false); }} onPlaying={() => { setVideoReady(true); setVideoBuffering(false); }} onWaiting={() => { if (videoReady) setVideoBuffering(true); }} onStalled={() => { if (videoReady) setVideoBuffering(true); }} onError={event => handleVideoError(event as React.SyntheticEvent<HTMLVideoElement>)} /><span className={`media-preview-load-indicator ${videoLoading ? "is-visible" : ""}`} role="status" aria-live="polite"><LoaderCircle className="spin" size={15} />正在加载</span></div>
        : imagePreviewAvailable && !imageFailed ? <div key={node.id} ref={imageViewport} className={`media-preview-media-wrap media-preview-image-viewport${mediaSwitching ? " is-switching" : ""} ${imageZoom > 1 ? "is-zoomed" : ""}`} onWheel={handleImageWheel} onPointerDown={handleImagePointerDown} onPointerMove={handleImagePointerMove} onPointerUp={stopImageDrag} onPointerCancel={stopImageDrag} onLostPointerCapture={stopImageDrag}>
          {imageSource && <img key={`${node.id}:${imageSource}:${imageAttempt}`} className={`media-preview-image ${imageLoading ? "is-loading" : "is-ready"}`} style={imageFitSize.width ? { width: imageFitSize.width, height: imageFitSize.height, transform: `translate3d(${imagePan.x}px, ${imagePan.y}px, 0) scale(${imageZoom})` } : undefined} src={imageSource} alt={node.title} draggable={false} onLoad={handleImageLoad} onError={handleImageError} />}
          {imageOriginalPreloadSource && imageOriginalPreloadSource !== imageSource && (imageOriginalPending || imageFullResolution) && <img key={`${node.id}:original:${imageOriginalPreloadSource}:${imageAttempt}`} className={`media-preview-image media-preview-image-detail ${imageFullResolution ? "is-ready" : "is-pending"}`} style={{ ...(imageFitSize.width ? { width: imageFitSize.width, height: imageFitSize.height } : {}), transform: `translate3d(-50%, -50%, 0) translate3d(${imagePan.x}px, ${imagePan.y}px, 0) scale(${imageZoom})` }} src={imageOriginalPreloadSource} alt={imageSource ? "" : node.title} aria-hidden={imageSource ? true : undefined} draggable={false} onLoad={handleOriginalPreloadLoad} onError={handleOriginalPreloadError} />}
          <span className={`media-preview-load-indicator ${imageLoading || imageOriginalPending ? "is-visible" : ""}`} role="status" aria-live="polite"><LoaderCircle className="spin" size={15} />{imageOriginalPending ? "正在获取原图" : "正在加载"}</span>
          {imageOriginalError && imageThumbnailSource && <div className="media-preview-original-state" role="status" aria-live="polite" onPointerDown={event => event.stopPropagation()}><span>当前显示缩略图</span><button type="button" className="icon-button" aria-label="重试加载原图" title="重试加载原图" onClick={() => requestFullResolution(true)}><RefreshCw size={14} /></button></div>}
        </div>
          : hasImage && !imageThumbnailSource ? <div className="media-preview-loading" role="status">{imageOriginalError ? <ImageIcon size={22} /> : <LoaderCircle className="spin" size={22} />}<span>{imageOriginalError ? "预览暂不可用" : "正在获取原图"}</span></div>
          : hasImage && imageFailed ? <div className="media-preview-loading" role="status"><ImageIcon size={22} /><span>预览暂不可用</span><button type="button" className="button" onClick={() => { setImageFailed(false); setImageLoading(true); setImageAttempt(attempt => attempt + 1); onImageRetry?.(); }}><RefreshCw size={14} />重试</button></div>
          : node.videoPoster && videoFailed ? <div className="media-preview-failed" role="status"><img src={node.videoPoster} alt={`${node.title} · 首帧`} /><span>预览暂不可用</span><button type="button" className="button" onClick={() => { void retryVideo(); }}><RefreshCw size={14} />重试</button></div>
          : isVideo && videoContentMessage ? <div className="media-preview-failed" role="status">{node.videoPoster && <img src={node.videoPoster} alt={`${node.title} · 首帧`} />}<span>预览暂不可用</span><button type="button" className="button" onClick={() => { void retryVideo(); }}><RefreshCw size={14} />重试</button></div>
          : node.videoPoster && isVideo ? <div key={node.id} className={`media-preview-media-wrap media-preview-video-wrap${mediaSwitching ? " is-switching" : ""}`} style={{ "--preview-video-ratio": String(videoRatio) } as React.CSSProperties}><img className="media-preview-video-backdrop" src={node.videoPoster} alt="" aria-hidden="true" /><img className="media-preview-poster is-visible" src={node.videoPoster} alt={`${node.title} · 首帧`} /><span className={`media-preview-load-indicator ${remoteVideoLoading ? "is-visible" : ""}`} role="status" aria-live="polite"><LoaderCircle className="spin" size={15} />正在加载视频…</span></div>
          : node.videoPoster ? <img className="media-preview-poster" src={node.videoPoster} alt={`${node.title} · 首帧`} />
          : <div className="media-preview-loading" role="status">{videoContentMessage || videoFailed ? <Film size={22} /> : <LoaderCircle className="spin" size={22} />}<span>{videoContentMessage || videoFailed ? "预览暂不可用" : "正在加载视频…"}</span>{(videoContentMessage || videoFailed) && <button type="button" className="button" onClick={() => { void retryVideo(); }}><RefreshCw size={14} />重试</button>}</div>}
      {items.length > 0 && <>
        <button type="button" className="icon-button media-preview-stage-navigation media-preview-stage-navigation-left" aria-label="上一个结果（主图）" title="上一个结果" disabled={index === 0} onPointerDown={event => event.stopPropagation()} onClick={() => selectRelative(-1)}><ChevronLeft size={22} /></button>
        <button type="button" className="icon-button media-preview-stage-navigation media-preview-stage-navigation-right" aria-label="下一个结果（主图）" title="下一个结果" disabled={index === items.length - 1} onPointerDown={event => event.stopPropagation()} onClick={() => selectRelative(1)}><ChevronRight size={22} /></button>
      </>}
      {((!isVideo && !isAudio && imagePreviewAvailable && !imageFailed) || sources.length > 0) && <div className={`media-preview-zoom-controls${zoomReadoutVisible ? " is-zoom-readout-visible" : ""}`} role="toolbar" aria-label="媒体工具" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
        {!isVideo && !isAudio && imagePreviewAvailable && !imageFailed && <>
          <button type="button" className="icon-button" aria-label="放大图片" title="放大" onClick={() => changeZoom(.25)} disabled={imageZoom >= 4}><Plus size={15} /></button>
          <button type="button" className="icon-button" aria-label="缩小图片" title="缩小" onClick={() => changeZoom(-.25)} disabled={imageZoom <= 1}><Minus size={15} /></button>
          <div className="media-preview-zoom-readout">
            <span aria-live="polite" title="以适配窗口为 100%">{Math.round(imageZoom * 100)}%</span>
            <input type="range" aria-label="图片缩放比例" min="100" max="400" step="5" value={Math.round(imageZoom * 100)}
              onPointerDown={event => {
                zoomSliderPointerActive.current = true;
                zoomSliderKeyboardActive.current = false;
                event.currentTarget.setPointerCapture(event.pointerId);
                revealZoomReadout();
              }}
              onPointerUp={stopZoomSliderPointer} onPointerCancel={stopZoomSliderPointer} onLostPointerCapture={stopZoomSliderPointer}
              onFocus={() => { zoomSliderKeyboardActive.current = !zoomSliderPointerActive.current; revealZoomReadout(); }}
              onBlur={() => { zoomSliderKeyboardActive.current = false; zoomSliderPointerActive.current = false; revealZoomReadout(); }}
              onKeyDown={() => { zoomSliderKeyboardActive.current = true; revealZoomReadout(); }}
              onChange={event => setZoom(Number(event.currentTarget.value) / 100)} />
          </div>
          <button type="button" className="icon-button" aria-label="适配图片" title="适配窗口（100%）" onClick={() => setZoom(1)} disabled={imageZoom === 1}><Scan size={15} /></button>
        </>}
        {sources.length > 0 && <>
          {!isVideo && !isAudio && imagePreviewAvailable && !imageFailed && <span className="media-preview-toolbar-divider" aria-hidden="true" />}
          <button type="button" className="icon-button media-preview-locate" aria-label="定位到来源节点" title="定位到来源节点" onClick={() => onLocate(sources[0].id)}><LocateFixed size={15} /><span>定位到节点</span></button>
        </>}
      </div>}
    </div>
    {items.length > 0 && <div className="media-preview-gallery" role="group" aria-label={`画廊结果，第 ${index + 1} 个，共 ${items.length} 个`}>
      <div className="media-preview-gallery-head">
        <span>画廊 <strong aria-live="polite">{index + 1} / {items.length}</strong></span>
      </div>
      <div className="media-preview-thumbnails-row" onPointerDown={event => event.stopPropagation()}>
        <button type="button" className="icon-button media-preview-result-nav" aria-label="上一个结果" title="上一个结果" disabled={index === 0} onClick={() => selectRelative(-1)}><ChevronLeft size={17} /></button>
        <div ref={strip} className="media-preview-thumbnails" role="listbox" aria-label="画廊缩略图">
          {items.map((item, itemIndex) => {
            // A gallery strip must not turn every result into a full-resolution
            // image request. Only local media or an explicitly signed bounded
            // thumbnail is eligible; the selected result still loads its
            // original in the stage when the user opens it.
            const thumbnailInput = item.image || item.imageThumbnail;
            const thumbnailSource = thumbnailInput
              ? adjacentImagePreloadSource(thumbnailInput, resolveImageSource, (source) => resolveImageThumbnail?.(source, item.imageThumbnail))
              : undefined;
            // The selected detail is already decoded. Reuse that visible layer
            // for a single-item strip when the service did not return a
            // separate bounded thumbnail, without warming originals for peers.
            const displayThumbnailSource = thumbnailSource || (item.id === node.id ? imageSource : undefined);
            const posterSource = item.videoPoster
              ? adjacentImagePreloadSource(item.videoPoster)
              : undefined;
            const isThumbnailVideo = Boolean(item.type === "video" || item.mediaType === "video" || item.video || item.videoContentUrl || item.videoPoster);
            const thumbnailPlaceholder = isThumbnailVideo
              ? <Film size={18} aria-hidden="true" />
              : item.audio
                ? <Music2 size={18} aria-hidden="true" />
                : <ImageIcon size={18} aria-hidden="true" />;
            return <button key={item.id} type="button" className={isThumbnailVideo ? "media-preview-thumbnail--video" : item.audio ? "media-preview-thumbnail--audio" : "media-preview-thumbnail--image"} role="option" aria-label={`查看第 ${itemIndex + 1} 个结果`} aria-current={node.id === item.id ? "true" : undefined} aria-selected={node.id === item.id} onClick={() => onSelect(item)}>
              {displayThumbnailSource ? <img src={displayThumbnailSource} alt="" loading="lazy" decoding="async" onError={(event) => {
                const fallback = resolveImageSource?.(thumbnailInput) || thumbnailInput;
                if (displayThumbnailSource !== fallback) {
                  event.currentTarget.hidden = true;
                  return;
                }
                event.currentTarget.hidden = true;
              }} /> : thumbnailInput ? <div className="media-preview-thumbnail-placeholder" aria-hidden="true">{thumbnailPlaceholder}</div> : posterSource ? <img src={posterSource} alt="" loading="lazy" decoding="async" /> : <div className="media-preview-thumbnail-placeholder" aria-hidden="true">{thumbnailPlaceholder}</div>}<span className="media-preview-thumbnail-index">{itemIndex + 1}</span>
            </button>;
          })}
        </div>
        <button type="button" className="icon-button media-preview-result-nav" aria-label="下一个结果" title="下一个结果" disabled={index === items.length - 1} onClick={() => selectRelative(1)}><ChevronRight size={17} /></button>
      </div>
    </div>}
    {items.length === 0 && sources.length > 0 && <div className="preview-actions">
      {items.length === 0 && sources.length > 0 && <button className="button secondary" title="定位到画布节点" aria-label="定位到画布节点" onClick={() => onLocate(sources[0].id)}><LocateFixed size={15} />定位到节点</button>}
    </div>}
  </>;
}
