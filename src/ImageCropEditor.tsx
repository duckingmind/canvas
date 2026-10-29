import React from "react";
import { Check, Crop, FlipHorizontal, FlipVertical, Lock, RotateCcw, Unlock, X, ZoomIn, ZoomOut } from "lucide-react";
import type { ImageToolOutput } from "./ImageTools";

type CropParams = Record<string, string | number | boolean>;
type CropMargins = { left: number; right: number; top: number; bottom: number };
type DragKind = "move" | "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
type DragState = CropMargins & { kind: DragKind; clientX: number; clientY: number };

const RATIO_OPTIONS = [
  { value: "free", label: "自由" },
  { value: "1:1", label: "1:1 方形" },
  { value: "4:3", label: "4:3 横图" },
  { value: "3:4", label: "3:4 竖图" },
  { value: "16:9", label: "16:9 横屏" },
  { value: "9:16", label: "9:16 竖屏" },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const numberParam = (params: CropParams, key: string, fallback: number) => {
  const value = Number(params[key]);
  return Number.isFinite(value) ? value : fallback;
};
const marginsFrom = (params: CropParams): CropMargins => ({
  left: clamp(numberParam(params, "left", 0), 0, 95),
  right: clamp(numberParam(params, "right", 0), 0, 95),
  top: clamp(numberParam(params, "top", 0), 0, 95),
  bottom: clamp(numberParam(params, "bottom", 0), 0, 95),
});
const normalizedMargins = (value: CropMargins): CropMargins => {
  const left = clamp(value.left, 0, 94), right = clamp(value.right, 0, 94);
  const top = clamp(value.top, 0, 94), bottom = clamp(value.bottom, 0, 94);
  const horizontal = left + right > 94 ? (94 / (left + right || 1)) : 1;
  const vertical = top + bottom > 94 ? (94 / (top + bottom || 1)) : 1;
  return { left: left * horizontal, right: right * horizontal, top: top * vertical, bottom: bottom * vertical };
};
const ratioValue = (value: string) => {
  const [width, height] = value.split(":").map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && height > 0 ? width / height : undefined;
};
const ratioLabel = (width: number, height: number) => {
  if (!width || !height) return "读取中";
  const value = width / height;
  const match = RATIO_OPTIONS.find(option => option.value !== "free" && Math.abs((ratioValue(option.value) || 0) - value) < 0.015);
  return match?.value || `${value.toFixed(2)}:1`;
};

function cropMarginsForRatio(margins: CropMargins, sourceRatio: number, targetRatio: number): CropMargins {
  const currentWidth = 1 - (margins.left + margins.right) / 100;
  const currentHeight = 1 - (margins.top + margins.bottom) / 100;
  let width = currentWidth;
  let height = currentHeight;
  const currentRatio = sourceRatio * currentWidth / Math.max(currentHeight, 0.001);
  if (currentRatio > targetRatio) width = currentHeight * targetRatio / sourceRatio;
  else height = currentWidth / targetRatio * sourceRatio;
  width = clamp(width, 0.06, 0.98);
  height = clamp(height, 0.06, 0.98);
  const centerX = (margins.left + 50 - margins.right) / 100;
  const centerY = (margins.top + 50 - margins.bottom) / 100;
  return normalizedMargins({
    left: (centerX - width / 2) * 100,
    right: (1 - centerX - width / 2) * 100,
    top: (centerY - height / 2) * 100,
    bottom: (1 - centerY - height / 2) * 100,
  });
}

function selectionDimensions(margins: CropMargins, width: number, height: number, scale: number) {
  const cropWidth = Math.max(1, Math.round(width * (100 - margins.left - margins.right) / 100));
  const cropHeight = Math.max(1, Math.round(height * (100 - margins.top - margins.bottom) / 100));
  return { cropWidth, cropHeight, outputWidth: Math.max(1, Math.round(cropWidth * scale)), outputHeight: Math.max(1, Math.round(cropHeight * scale)) };
}

function flippedDragKind(kind: DragKind, horizontal: boolean, vertical: boolean): DragKind {
  let next = kind;
  if (horizontal) next = next.replace(/left|right/g, side => side === "left" ? "__right__" : "__left__").replace(/__left__|__right__/g, side => side === "__left__" ? "left" : "right") as DragKind;
  if (vertical) next = next.replace(/top|bottom/g, side => side === "top" ? "__bottom__" : "__top__").replace(/__top__|__bottom__/g, side => side === "__top__" ? "top" : "bottom") as DragKind;
  return next;
}

function formatLabel(format: string) {
  return format === "image/jpeg" ? "JPEG" : format === "image/webp" ? "WEBP" : "PNG";
}

function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ImageCropEditor({ source, title, titleId, params, previewOutput, busy, error, onChange, onReset, onCancel, onGenerate }: {
  source: string;
  title: string;
  titleId: string;
  params: CropParams;
  previewOutput?: ImageToolOutput;
  busy: boolean;
  error?: string | null;
  onChange: (patch: CropParams) => void;
  onReset: () => void;
  onCancel: () => void;
  onGenerate: () => void;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [imageSize, setImageSize] = React.useState({ width: 0, height: 0 });
  const [imageStatus, setImageStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [imageRetry, setImageRetry] = React.useState(0);
  const [zoom, setZoom] = React.useState(1);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [dimensionDraft, setDimensionDraft] = React.useState<{ axis: "width" | "height"; value: string } | null>(null);
  const [marginDrafts, setMarginDrafts] = React.useState<Partial<Record<keyof CropMargins, string>>>({});
  const cropHintId = React.useId();
  const margins = marginsFrom(params);
  const ratio = String(params.ratio || "free");
  const lockRatio = Boolean(params.lockRatio) && ratio !== "free";
  const scale = clamp(numberParam(params, "scale", 1), 0.25, 1);
  const horizontal = params.horizontal === true;
  const vertical = params.vertical === true;
  const format = String(params.format || "image/png");
  const previewFormat = String(previewOutput?.params.format || format);
  const quality = clamp(numberParam(params, "quality", 90), 10, 100);
  const dimensions = selectionDimensions(margins, imageSize.width, imageSize.height, scale);
  const displayDimensions = previewOutput
    ? { cropWidth: previewOutput.width, cropHeight: previewOutput.height, outputWidth: previewOutput.width, outputHeight: previewOutput.height }
    : dimensions;
  const selectedRatio = imageSize.width && imageSize.height ? ratioLabel(displayDimensions.cropWidth, displayDimensions.cropHeight) : "读取中";
  const displaySource = previewOutput?.dataUrl || source;
  const imageReady = imageStatus === "ready" && imageSize.width > 0 && imageSize.height > 0;

  React.useLayoutEffect(() => {
    setImageStatus("loading");
    setImageSize({ width: 0, height: 0 });
    setDrag(null);
  }, [displaySource, imageRetry]);

  const updateMargins = (next: CropMargins, axis?: "horizontal" | "vertical") => {
    let normalized = normalizedMargins(next);
    const targetRatio = ratioValue(ratio);
    if (lockRatio && targetRatio && imageSize.width && imageSize.height) {
      const currentWidth = (100 - normalized.left - normalized.right) / 100;
      const currentHeight = (100 - normalized.top - normalized.bottom) / 100;
      if (axis === "horizontal") {
        const desiredHeight = currentWidth / targetRatio * (imageSize.width / imageSize.height);
        const height = clamp(desiredHeight, 0.06, 0.98);
        const centerY = (normalized.top + 50 - normalized.bottom) / 100;
        normalized = normalizedMargins({ ...normalized, top: (centerY - height / 2) * 100, bottom: (1 - centerY - height / 2) * 100 });
      } else if (axis === "vertical") {
        const desiredWidth = currentHeight * targetRatio * (imageSize.height / imageSize.width);
        const width = clamp(desiredWidth, 0.06, 0.98);
        const centerX = (normalized.left + 50 - normalized.right) / 100;
        normalized = normalizedMargins({ ...normalized, left: (centerX - width / 2) * 100, right: (1 - centerX - width / 2) * 100 });
      }
    }
    onChange(normalized);
  };

  const setMargin = (key: keyof CropMargins, value: number) => {
    const next = { ...margins, [key]: value };
    updateMargins(next, key === "left" || key === "right" ? "horizontal" : "vertical");
  };

  const commitMarginDraft = (key: keyof CropMargins) => {
    const value = marginDrafts[key];
    if (value !== undefined) setMargin(key, Number(value));
    setMarginDrafts(current => { const next = { ...current }; delete next[key]; return next; });
  };

  const setRatio = (nextRatio: string) => {
    const targetRatio = ratioValue(nextRatio);
    const next = targetRatio && imageSize.width && imageSize.height
      ? cropMarginsForRatio(margins, imageSize.width / imageSize.height, targetRatio)
      : margins;
    onChange({ ...next, ratio: nextRatio, lockRatio: nextRatio !== "free" });
  };

  const setDimension = (axis: "width" | "height", raw: string) => {
    const value = Number(raw);
    if (!imageSize.width || !Number.isFinite(value)) return;
    if (axis === "width") {
      const width = clamp(value, 1, imageSize.width * (100 - margins.top - margins.bottom) / 100);
      const available = 100 - width / imageSize.width * 100;
      const center = (margins.left + 100 - margins.right) / 2;
      updateMargins({ ...margins, left: center - available / 2, right: 100 - center - available / 2 }, "horizontal");
    } else {
      const height = clamp(value, 1, imageSize.height * (100 - margins.left - margins.right) / 100);
      const available = 100 - height / imageSize.height * 100;
      const center = (margins.top + 100 - margins.bottom) / 2;
      updateMargins({ ...margins, top: center - available / 2, bottom: 100 - center - available / 2 }, "vertical");
    }
  };

  const startDrag = (kind: DragKind, event: React.PointerEvent<HTMLElement>) => {
    if (Boolean(previewOutput) || busy) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ ...margins, kind: flippedDragKind(kind, horizontal, vertical), clientX: event.clientX, clientY: event.clientY });
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !viewportRef.current) return;
    const width = viewportRef.current.offsetWidth;
    const height = viewportRef.current.offsetHeight;
    const dx = (event.clientX - drag.clientX) / Math.max(width * zoom, 1) * 100 * (horizontal ? -1 : 1);
    const dy = (event.clientY - drag.clientY) / Math.max(height * zoom, 1) * 100 * (vertical ? -1 : 1);
    const next = { left: drag.left, right: drag.right, top: drag.top, bottom: drag.bottom };
    if (drag.kind === "move") {
      const width = 100 - drag.left - drag.right, height = 100 - drag.top - drag.bottom;
      next.left = clamp(drag.left + dx, 0, 100 - width); next.right = 100 - width - next.left;
      next.top = clamp(drag.top + dy, 0, 100 - height); next.bottom = 100 - height - next.top;
    } else {
      if (drag.kind.includes("left")) next.left = drag.left + dx;
      if (drag.kind.includes("right")) next.right = drag.right - dx;
      if (drag.kind.includes("top")) next.top = drag.top + dy;
      if (drag.kind.includes("bottom")) next.bottom = drag.bottom - dy;
    }
    updateMargins(next, drag.kind.includes("left") || drag.kind.includes("right") ? "horizontal" : "vertical");
  };
  const finishDrag = () => setDrag(null);

  const nudgeSelection = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (previewOutput || busy) return;
    const direction = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 2 : 0.5;
    const width = 100 - margins.left - margins.right;
    const height = 100 - margins.top - margins.bottom;
    const left = clamp(margins.left + direction.x * step * (horizontal ? -1 : 1), 0, 100 - width);
    const top = clamp(margins.top + direction.y * step * (vertical ? -1 : 1), 0, 100 - height);
    updateMargins({ left, right: 100 - width - left, top, bottom: 100 - height - top });
  };

  const zoomStep = (delta: number) => setZoom(value => clamp(Math.round((value + delta) * 10) / 10, 0.5, 2));
  const retryImage = () => {
    setImageStatus("loading");
    setImageRetry(value => value + 1);
  };

  return <>
    <div className="image-tool-modal-head image-crop-head">
      <div className="image-crop-heading"><Crop size={17} aria-hidden="true" /><div><strong id={titleId}>{previewOutput ? "编辑预览" : "图片基础编辑"}</strong><small>{title} · {imageSize.width ? `${imageSize.width} × ${imageSize.height}` : "正在读取图片…"}</small></div></div>
      <button type="button" aria-label="关闭图片工具" disabled={busy} onClick={onCancel}><X size={17} /></button>
    </div>

    <div className={`image-crop-workspace image-tool-workspace${previewOutput ? " is-preview" : ""}`}>
      <div className="image-crop-stage">
        <div className="image-crop-viewport-shell">
          <div ref={viewportRef} className={`image-crop-viewport${drag ? " is-dragging" : ""}`} style={{ transform: `scale(${zoom})` }} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            <img key={`${displaySource}-${imageRetry}`} className="image-tool-source" src={displaySource} alt={previewOutput ? `${title}编辑预览` : title} decoding="async" style={previewOutput ? undefined : { transform: `scale(${horizontal ? -1 : 1}, ${vertical ? -1 : 1})` }} onLoad={event => { setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setImageStatus("ready"); }} onError={() => { setImageSize({ width: 0, height: 0 }); setImageStatus("error"); }} />
            {!previewOutput && imageReady && <div className={`image-crop-selection${drag ? " is-dragging" : ""}`} role="group" aria-label="裁剪选区" aria-describedby={cropHintId} tabIndex={0} style={{ left: `${horizontal ? margins.right : margins.left}%`, right: `${horizontal ? margins.left : margins.right}%`, top: `${vertical ? margins.bottom : margins.top}%`, bottom: `${vertical ? margins.top : margins.bottom}%` }} onPointerDown={event => startDrag("move", event)} onKeyDown={nudgeSelection}>
              <span className="image-crop-selection-label" aria-hidden="true">{dimensions.cropWidth} × {dimensions.cropHeight}</span>
              <button type="button" tabIndex={-1} className="image-crop-handle is-top-left" aria-label="调整左上裁剪边界" onPointerDown={event => startDrag("top-left", event)} />
              <button type="button" tabIndex={-1} className="image-crop-handle is-top-right" aria-label="调整右上裁剪边界" onPointerDown={event => startDrag("top-right", event)} />
              <button type="button" tabIndex={-1} className="image-crop-handle is-bottom-left" aria-label="调整左下裁剪边界" onPointerDown={event => startDrag("bottom-left", event)} />
              <button type="button" tabIndex={-1} className="image-crop-handle is-bottom-right" aria-label="调整右下裁剪边界" onPointerDown={event => startDrag("bottom-right", event)} />
              <button type="button" tabIndex={-1} className="image-crop-edge is-left" aria-label="调整左裁剪边界" onPointerDown={event => startDrag("left", event)} />
              <button type="button" tabIndex={-1} className="image-crop-edge is-right" aria-label="调整右裁剪边界" onPointerDown={event => startDrag("right", event)} />
              <button type="button" tabIndex={-1} className="image-crop-edge is-top" aria-label="调整上裁剪边界" onPointerDown={event => startDrag("top", event)} />
              <button type="button" tabIndex={-1} className="image-crop-edge is-bottom" aria-label="调整下裁剪边界" onPointerDown={event => startDrag("bottom", event)} />
            </div>}
          </div>
          {imageStatus === "loading" && <div className="image-crop-image-status" role="status" aria-live="polite"><span className="image-crop-status-spinner" aria-hidden="true" />正在加载图片…</div>}
          {imageStatus === "error" && <div className="image-crop-image-status is-error" role="alert"><strong>预览加载失败</strong><span>图片暂时无法显示</span><button type="button" onClick={retryImage}>重新加载</button></div>}
        </div>
        <div className="image-crop-stage-footer" role="status" aria-live="polite"><span>{previewOutput ? "预览结果" : imageReady ? "拖动选区调整范围 · 方向键微调" : imageStatus === "error" ? "请重新加载图片后继续" : "正在准备编辑区域…"}</span><strong>{imageReady || previewOutput ? `${displayDimensions.outputWidth} × ${displayDimensions.outputHeight} px` : "—"}</strong><span>比例 {selectedRatio}</span></div>
        <div className="image-crop-zoom-controls" role="toolbar" aria-label="预览缩放"><button type="button" title="缩小预览" aria-label="缩小预览" disabled={Boolean(previewOutput) || !imageReady || zoom <= 0.5} onClick={() => zoomStep(-0.1)}><ZoomOut size={15} /></button><output aria-live="polite">{Math.round(zoom * 100)}%</output><button type="button" title="放大预览" aria-label="放大预览" disabled={Boolean(previewOutput) || !imageReady || zoom >= 2} onClick={() => zoomStep(0.1)}><ZoomIn size={15} /></button><button type="button" title="重置预览缩放" aria-label="重置预览缩放" disabled={Boolean(previewOutput) || !imageReady || zoom === 1} onClick={() => setZoom(1)}><RotateCcw size={14} /></button></div>
      </div>

      <aside className="image-crop-inspector" aria-label="基础图片编辑设置">
        <div className="image-crop-inspector-heading"><strong>{previewOutput ? "输出预览" : "编辑设置"}</strong><span>{imageSize.width ? `${imageSize.width} × ${imageSize.height}` : "读取中"}</span></div>
        {previewOutput ? <div className="image-crop-result-info"><strong>{previewOutput.width} × {previewOutput.height} px</strong><span>{formatLabel(previewFormat)} · {formatBytes(dataUrlBytes(previewOutput.dataUrl))}</span><small>原图保持不变，确认后会作为新的图片节点添加。</small><button type="button" className="button" onClick={() => onChange({})}>继续调整</button></div> : <>
          <div className="image-crop-ratio-section"><div className="image-crop-margin-heading"><strong>裁剪比例</strong><span>{lockRatio ? "比例已锁定" : "自由调整"}</span></div><div className="image-crop-ratio-shortcuts" role="group" aria-label="裁剪比例">{RATIO_OPTIONS.map(option => <button key={option.value} type="button" aria-label={`裁剪比例 ${option.label}`} aria-pressed={ratio === option.value} title={`设置裁剪比例 ${option.label}`} disabled={busy || !imageReady} onClick={() => setRatio(option.value)}>{option.value === "free" ? "自由" : option.value}</button>)}</div></div>
          <div className="image-crop-dimensions"><label>宽度<input aria-label="裁剪宽度" type="number" min="1" value={dimensionDraft?.axis === "width" ? dimensionDraft.value : dimensions.cropWidth} disabled={busy || !imageSize.width} onFocus={() => setDimensionDraft({ axis: "width", value: String(dimensions.cropWidth) })} onChange={event => setDimensionDraft({ axis: "width", value: event.target.value })} onBlur={event => { if (dimensionDraft?.axis === "width") setDimension("width", event.currentTarget.value); setDimensionDraft(null); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /><span>px</span></label><label>高度<input aria-label="裁剪高度" type="number" min="1" value={dimensionDraft?.axis === "height" ? dimensionDraft.value : dimensions.cropHeight} disabled={busy || !imageSize.height} onFocus={() => setDimensionDraft({ axis: "height", value: String(dimensions.cropHeight) })} onChange={event => setDimensionDraft({ axis: "height", value: event.target.value })} onBlur={event => { if (dimensionDraft?.axis === "height") setDimension("height", event.currentTarget.value); setDimensionDraft(null); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /><span>px</span></label></div>
          <label className="image-crop-lock"><input aria-label="固定比例" type="checkbox" checked={lockRatio} disabled={busy || ratio === "free"} onChange={event => onChange({ lockRatio: event.target.checked })} />{lockRatio ? <Lock size={14} /> : <Unlock size={14} />}固定比例</label>
          <div className="image-crop-margin-heading"><strong>边距</strong><span>百分比</span></div>
          <div className="image-crop-margins">{(["left", "right", "top", "bottom"] as const).map((key, index) => <label key={key}><span>{["左", "右", "上", "下"][index]}</span><div className="image-crop-unit-input"><input data-primary-input={key === "left" ? true : undefined} aria-label={["左", "右", "上", "下"][index]} type="number" min="0" max="94" step="0.1" value={marginDrafts[key] ?? Number(margins[key].toFixed(1))} disabled={busy} onFocus={event => { const value = event.currentTarget.value; setMarginDrafts(current => ({ ...current, [key]: value })); }} onChange={event => { const value = event.target.value; setMarginDrafts(current => ({ ...current, [key]: value })); }} onBlur={() => commitMarginDraft(key)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /><em>%</em></div></label>)}</div>
          <label className="image-crop-field">输出分辨率<select aria-label="输出分辨率" value={String(scale)} disabled={busy} onChange={event => onChange({ scale: Number(event.target.value) })}><option value="1">原图</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label>
          <p className="image-tool-note" id={cropHintId}>可拖动选区或用方向键微调。翻转会实时显示在预览中，原图不会被覆盖。</p>
          <div className="image-crop-section-heading"><strong>翻转</strong><span>可同时使用</span></div>
          <div className="image-basic-flips" role="group" aria-label="翻转设置">
            <button type="button" className={horizontal ? "is-active" : ""} aria-pressed={horizontal} disabled={busy || Boolean(previewOutput)} onClick={() => onChange({ horizontal: !horizontal })}><FlipHorizontal size={15} aria-hidden="true" />水平镜像</button>
            <button type="button" className={vertical ? "is-active" : ""} aria-pressed={vertical} disabled={busy || Boolean(previewOutput)} onClick={() => onChange({ vertical: !vertical })}><FlipVertical size={15} aria-hidden="true" />垂直翻转</button>
          </div>
          <div className="image-crop-section-heading"><strong>导出</strong><span>不覆盖原图</span></div>
          <label className="image-crop-field">输出格式<select aria-label="输出格式" value={format} disabled={busy || Boolean(previewOutput)} onChange={event => onChange({ format: event.target.value })}><option value="image/png">PNG · 保留透明</option><option value="image/webp">WEBP · 体积更小</option><option value="image/jpeg">JPEG · 通用兼容</option></select></label>
          {format !== "image/png" && <label className="image-basic-quality">质量<input aria-label="输出质量" type="range" min="10" max="100" value={quality} disabled={busy || Boolean(previewOutput)} onChange={event => onChange({ quality: Number(event.target.value) })} /><output>{quality}%</output></label>}
          {format === "image/jpeg" && <p className="image-tool-note">JPEG 不支持透明背景，透明区域会填充为白色。</p>}
        </>}
      </aside>
    </div>
    {error && !busy && <p className="image-tool-error image-crop-error" role="alert">{error}</p>}
    <div className="image-crop-footer image-tool-actions"><button type="button" className="image-tool-reset" onClick={onReset} disabled={busy || Boolean(previewOutput)}>重置</button><span className="image-crop-footer-summary">{previewOutput ? `预览结果 · ${previewOutput.width} × ${previewOutput.height}` : imageReady ? `选区 ${dimensions.outputWidth} × ${dimensions.outputHeight} px` : "等待图片加载"}</span><div><button type="button" className="button image-crop-cancel" onClick={onCancel} disabled={busy}>取消</button><button type="button" className="generate-button" disabled={busy || !imageReady} onClick={onGenerate}>{busy ? "处理中…" : previewOutput ? "添加到画布" : "生成预览"}{previewOutput && <Check size={14} />}</button></div></div>
  </>;
}
