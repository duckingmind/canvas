import React from "react";
import { createPortal } from "react-dom";
import { CircleUserRound, Crop, Expand, Grid2X2, Layers3, Rotate3d, SlidersHorizontal, SunMedium, Type, WandSparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import MediaToolMenu, { dismissMediaToolMenus } from "./MediaToolMenu";
import ImageAnnotator from "./ImageAnnotator";
import ImageCropEditor from "./ImageCropEditor";
import ImageLayerSplitter from "./ImageLayerSplitter";
import CharacterTurnaroundEditor, { type CharacterTurnaroundRequest } from "./CharacterTurnaroundEditor";
import type { NoticeAction } from "./useTransientNotice";
import "./image-tools.css";

export type ImageToolId =
  | "basic-edit"
  | "grid"
  | "adjust"
  | "annotate"
  | "layer-split"
  | "remove-background"
  | "relight"
  | "depth"
  | "outpaint"
  | "angle"
  | "character-turnaround";

export type ImageToolOutput = {
  dataUrl: string;
  width: number;
  height: number;
  operationId: ImageToolId;
  params: Record<string, string | number | boolean>;
  titleSuffix: string;
};

type ImageToolsProps = {
  source: string;
  title: string;
  onApply: (outputs: ImageToolOutput[]) => void;
  /** Create a prompt node that uses the current image as the character reference. */
  onCreatePrompt?: (request: CharacterTurnaroundRequest) => void;
  /** Resolve a cached, editable source before the canvas operation starts. */
  resolveSource?: () => Promise<string | undefined>;
  /** Surface transient operation failures through the workbench toast. */
  onNotice?: (text: string, action?: NoticeAction) => void;
};

type ToolDefinition = {
  id: ImageToolId;
  label: string;
  detail: string;
  icon: LucideIcon;
  group: "basic" | "smart";
  available: boolean;
};

const TOOLS: ToolDefinition[] = [
  { id: "basic-edit", label: "图片基础编辑", detail: "裁剪、翻转并设置输出格式与质量", icon: Crop, group: "basic", available: true },
  { id: "grid", label: "宫格裁剪", detail: "切分为多张图片", icon: Grid2X2, group: "basic", available: true },
  { id: "adjust", label: "图片调整", detail: "亮度、对比度与饱和度", icon: SlidersHorizontal, group: "basic", available: true },
  { id: "annotate", label: "标记修图", detail: "画笔、箭头、形状、文字与马赛克", icon: Type, group: "basic", available: true },
  { id: "layer-split", label: "图层拆分", detail: "框选区域并拆分为独立图层", icon: Layers3, group: "smart", available: true },
  { id: "remove-background", label: "智能抠图", detail: "需要平台分割模型", icon: WandSparkles, group: "smart", available: false },
  { id: "relight", label: "智能打光", detail: "需要平台重光照模型", icon: SunMedium, group: "smart", available: false },
  { id: "depth", label: "转深度图", detail: "需要平台深度模型", icon: Layers3, group: "smart", available: false },
  { id: "outpaint", label: "扩图", detail: "需要平台扩图模型", icon: Expand, group: "smart", available: false },
  { id: "angle", label: "角度", detail: "需要平台视角模型", icon: Rotate3d, group: "smart", available: false },
  { id: "character-turnaround", label: "角色三视图", detail: "基于当前角色图生成正、侧、背三视图", icon: CircleUserRound, group: "smart", available: true },
];

type ImageSize = { width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeCropPair = (first: number, second: number): [number, number] => {
  const a = clamp(first, 0, 94);
  const b = clamp(second, 0, 94);
  if (a + b <= 94) return [a, b];
  const scale = 94 / (a + b || 1);
  return [a * scale, b * scale];
};

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Image operations export a canvas, so remote COS media must be decoded
    // with CORS enabled before it is drawn. Inline/cache-backed sources are
    // unaffected and remain the fast path for local uploads.
    if (/^https?:\/\//i.test(source)) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法读取，请检查资源权限或稍后重试。"));
    image.src = source;
  });
}

function canvasDataUrl(canvas: HTMLCanvasElement, format = "image/png", quality?: number) {
  return canvas.toDataURL(format, quality);
}

function dataUrlSize(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function drawBase(image: HTMLImageElement, width = image.naturalWidth, height = image.naturalHeight) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持图片编辑。");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function adjustPixels(canvas: HTMLCanvasElement, brightness: number, contrast: number, saturation: number, exposure: number) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持图片调整。");
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const exposureFactor = 2 ** (exposure / 100);
  const saturationFactor = 1 + saturation / 100;
  for (let index = 0; index < image.data.length; index += 4) {
    let r = image.data[index] * exposureFactor + brightness;
    let g = image.data[index + 1] * exposureFactor + brightness;
    let b = image.data[index + 2] * exposureFactor + brightness;
    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    image.data[index] = clamp(luminance + (r - luminance) * saturationFactor, 0, 255);
    image.data[index + 1] = clamp(luminance + (g - luminance) * saturationFactor, 0, 255);
    image.data[index + 2] = clamp(luminance + (b - luminance) * saturationFactor, 0, 255);
  }
  context.putImageData(image, 0, 0);
}

async function renderOperation(source: string, operation: ImageToolId, params: Record<string, string | number | boolean>): Promise<ImageToolOutput[]> {
  const image = await loadImage(source);
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  if (!originalWidth || !originalHeight) throw new Error("无法读取图片尺寸。");
  if (["remove-background", "relight", "depth", "outpaint", "angle"].includes(operation)) {
    throw new Error("该操作需要平台图片模型，当前暂未接入模型接口。");
  }

  if (operation === "basic-edit") {
    const [left, right] = normalizeCropPair(Number(params.left) || 0, Number(params.right) || 0);
    const [top, bottom] = normalizeCropPair(Number(params.top) || 0, Number(params.bottom) || 0);
    const scale = clamp(Number(params.scale) || 1, 0.25, 1);
    const x = Math.floor(originalWidth * left / 100);
    const y = Math.floor(originalHeight * top / 100);
    const width = Math.max(1, Math.floor(originalWidth * (1 - (left + right) / 100)));
    const height = Math.max(1, Math.floor(originalHeight * (1 - (top + bottom) / 100)));
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    const horizontal = params.horizontal === true;
    const vertical = params.vertical === true;
    const requestedFormat = String(params.format || "image/png");
    const format = requestedFormat === "image/jpeg" || requestedFormat === "image/webp" ? requestedFormat : "image/png";
    const quality = clamp(Number(params.quality) || 90, 10, 100);
    const { canvas, context } = drawBase(image, outputWidth, outputHeight);
    context.clearRect(0, 0, outputWidth, outputHeight);
    if (format === "image/jpeg") {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, outputWidth, outputHeight);
    }
    context.save();
    context.translate(horizontal ? outputWidth : 0, vertical ? outputHeight : 0);
    context.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
    context.drawImage(image, x, y, width, height, 0, 0, outputWidth, outputHeight);
    context.restore();
    const dataUrl = canvasDataUrl(canvas, format, format === "image/png" ? undefined : quality / 100);
    const actualFormat = dataUrl.slice(0, dataUrl.indexOf(";"));
    const operations = [
      left || right || top || bottom || scale !== 1 ? "裁剪" : "",
      horizontal || vertical ? "翻转" : "",
      actualFormat !== "data:image/png" ? "压缩" : "",
    ].filter(Boolean);
    return [{
      dataUrl,
      width: outputWidth,
      height: outputHeight,
      operationId: operation,
      params: { left, right, top, bottom, scale, horizontal, vertical, quality: actualFormat === "data:image/png" ? 100 : quality, format: actualFormat.replace("data:", ""), operations: operations.join(",") },
      titleSuffix: operations.length ? `基础编辑 · ${operations.join("、")}` : "基础编辑",
    }];
  }

  if (operation === "grid") {
    const rows = clamp(Number(params.rows) || 2, 1, 6);
    const columns = clamp(Number(params.columns) || 2, 1, 6);
    const outputs: ImageToolOutput[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = Math.floor(column * originalWidth / columns);
        const y = Math.floor(row * originalHeight / rows);
        const width = Math.max(1, Math.floor((column + 1) * originalWidth / columns) - x);
        const height = Math.max(1, Math.floor((row + 1) * originalHeight / rows) - y);
        const { canvas, context } = drawBase(image, width, height);
        context.clearRect(0, 0, width, height);
        context.drawImage(image, x, y, width, height, 0, 0, width, height);
        outputs.push({
          dataUrl: canvasDataUrl(canvas), width, height, operationId: operation,
          params: { rows, columns, row, column }, titleSuffix: `宫格 ${row + 1}-${column + 1}`,
        });
      }
    }
    return outputs;
  }

  const { canvas } = drawBase(image);
  if (operation === "adjust") {
    const brightness = clamp(Number(params.brightness) || 0, -100, 100);
    const contrast = clamp(Number(params.contrast) || 0, -100, 100);
    const saturation = clamp(Number(params.saturation) || 0, -100, 100);
    const exposure = clamp(Number(params.exposure) || 0, -100, 100);
    adjustPixels(canvas, brightness, contrast, saturation, exposure);
    return [{ dataUrl: canvasDataUrl(canvas), width: canvas.width, height: canvas.height, operationId: operation, params: { brightness, contrast, saturation, exposure }, titleSuffix: "图片调整" }];
  }
  if (operation === "annotate") {
    const text = String(params.text || "").trim().slice(0, 200);
    const color = String(params.color || "#ffdb5c");
    if (!text) throw new Error("请输入标记文字。");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持标记修图。");
    const size = Math.max(12, Math.round(canvas.width / 28));
    context.font = `600 ${size}px sans-serif`;
    const padding = Math.round(size * 0.6);
    const textWidth = context.measureText(text).width;
    context.fillStyle = "#0009";
    context.fillRect(padding, canvas.height - size - padding * 2, textWidth + padding * 2, size + padding);
    context.fillStyle = color;
    context.textBaseline = "middle";
    context.fillText(text, padding * 2, canvas.height - size / 2 - padding);
    return [{ dataUrl: canvasDataUrl(canvas), width: canvas.width, height: canvas.height, operationId: operation, params: { text, color }, titleSuffix: "标记" }];
  }
  throw new Error("暂不支持该图片操作。");
}

function initialParams(operation: ImageToolId): Record<string, string | number | boolean> {
  if (operation === "basic-edit") return { left: 0, right: 0, top: 0, bottom: 0, ratio: "free", lockRatio: false, scale: 1, horizontal: false, vertical: false, quality: 90, format: "image/png" };
  if (operation === "grid") return { rows: 2, columns: 2 };
  if (operation === "adjust") return { brightness: 0, contrast: 0, saturation: 0, exposure: 0 };
  return { text: "标记", color: "#ffdb5c" };
}

export default function ImageTools({ source, title, onApply, onCreatePrompt, resolveSource, onNotice }: ImageToolsProps) {
  const [operation, setOperation] = React.useState<ImageToolId | null>(null);
  const [params, setParams] = React.useState<Record<string, string | number | boolean>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [previewSource, setPreviewSource] = React.useState<string | null>(null);
  const [previewOutputs, setPreviewOutputs] = React.useState<ImageToolOutput[] | null>(null);
  const [sourceState, setSourceState] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const trigger = React.useRef<HTMLButtonElement>(null);
  const dialog = React.useRef<HTMLDivElement>(null);
  const restoreTriggerFocus = React.useRef(false);
  const mounted = React.useRef(true);
  const requestId = React.useRef(0);
  const resolver = React.useRef(resolveSource);
  resolver.current = resolveSource;
  const titleId = React.useId();
  const active = TOOLS.find((tool) => tool.id === operation);
  const dialogOpen = operation !== null;

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestId.current += 1; };
  }, []);

  const loadEditableSource = React.useCallback(() => {
    const id = ++requestId.current;
    setBusy(false);
    setPreviewSource(null);
    setError(null);
    const resolve = resolver.current;
    setSourceState("loading");
    Promise.resolve().then(async () => {
      const resolved = await resolve?.();
      if (!mounted.current || id !== requestId.current) return;
      const editableSource = resolved || source;
      await loadImage(editableSource);
      return editableSource;
    }).then((resolved) => {
      if (!resolved || !mounted.current || id !== requestId.current) return;
      setPreviewSource(resolved);
      setSourceState("ready");
    }).catch((cause) => {
      if (!mounted.current || id !== requestId.current) return;
      setSourceState("error");
      setError(cause instanceof Error ? cause.message : "原图加载失败，请重试。");
    });
  }, [source]);

  const openOperation = React.useCallback((next: ImageToolId) => {
    const selectedTool = TOOLS.find((tool) => tool.id === next);
    if (!selectedTool?.available || busy || next === "character-turnaround" && !onCreatePrompt) return;
    dismissMediaToolMenus();
    setParams(initialParams(next));
    setError(null);
    setPreviewOutputs(null);
    setOperation(next);
  }, [busy, onCreatePrompt]);

  React.useLayoutEffect(() => {
    if (!dialogOpen) return;
    loadEditableSource();
    return () => { requestId.current += 1; };
  }, [dialogOpen, loadEditableSource]);

  const lastSourceErrorNotice = React.useRef("");
  React.useEffect(() => {
    if (sourceState !== "error" || !error) {
      lastSourceErrorNotice.current = "";
      return;
    }
    if (lastSourceErrorNotice.current === error) return;
    lastSourceErrorNotice.current = error;
    onNotice?.(error, { label: "重试加载", run: loadEditableSource });
  }, [error, loadEditableSource, onNotice, sourceState]);

  const closeOperation = React.useCallback(() => {
    if (busy) return;
    requestId.current += 1;
    restoreTriggerFocus.current = true;
    setOperation(null);
    setError(null);
    setSourceState("idle");
    setPreviewSource(null);
    setPreviewOutputs(null);
  }, [busy]);

  const apply = async () => {
    if (!operation || busy) return;
    if (previewOutputs) {
      onApply(previewOutputs);
      restoreTriggerFocus.current = true;
      setOperation(null);
      setPreviewSource(null);
      setPreviewOutputs(null);
      setSourceState("idle");
      return;
    }
    if (sourceState === "error") return;
    if (sourceState === "loading") return;
    const editableSource = previewSource || source;
    setBusy(true);
    setError(null);
    const runId = requestId.current;
    try {
      const outputs = await renderOperation(editableSource, operation, params);
      if (!mounted.current || runId !== requestId.current) return;
      setPreviewOutputs(outputs);
      setBusy(false);
    } catch (cause) {
      if (!mounted.current || runId !== requestId.current) return;
      const message = cause instanceof Error ? cause.message : "图片处理失败，请重试。";
      setError(message);
      onNotice?.(message);
    } finally {
      if (mounted.current && runId === requestId.current) setBusy(false);
    }
  };

  const applyAnnotation = (output: ImageToolOutput) => {
    onApply([output]);
    restoreTriggerFocus.current = true;
    setOperation(null);
    setPreviewSource(null);
    setPreviewOutputs(null);
    setSourceState("idle");
  };

  const applyCharacterTurnaround = (request: CharacterTurnaroundRequest) => {
    if (!onCreatePrompt || busy) return;
    onCreatePrompt(request);
    restoreTriggerFocus.current = true;
    setOperation(null);
    setPreviewSource(null);
    setPreviewOutputs(null);
    setSourceState("idle");
  };

  const setParam = (key: string, value: string | number | boolean) => {
    setPreviewOutputs(null);
    setParams((current) => ({ ...current, [key]: value }));
  };
  const setParamsPatch = (patch: Record<string, string | number | boolean>) => {
    setPreviewOutputs(null);
    if (Object.keys(patch).length) setParams((current) => ({ ...current, ...patch }));
  };

  React.useLayoutEffect(() => {
    // Restore only after the dialog is removed and its trigger is enabled.
    if (dialogOpen || busy || !restoreTriggerFocus.current) return;
    restoreTriggerFocus.current = false;
    trigger.current?.focus({ preventScroll: true });
  }, [dialogOpen, busy]);

  React.useLayoutEffect(() => {
    if (!dialogOpen) return;
    const frame = requestAnimationFrame(() => {
      const target = dialog.current?.querySelector<HTMLElement>("[data-primary-input]:not(:disabled)")
        || dialog.current?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")
        || dialog.current?.querySelector<HTMLElement>("button:not(:disabled)");
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [dialogOpen, sourceState]);

  React.useLayoutEffect(() => {
    if (dialogOpen && busy) dialog.current?.focus({ preventScroll: true });
  }, [dialogOpen, busy]);

  React.useEffect(() => {
    if (!operation) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busy) closeOperation();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")].filter(item => !item.matches(":disabled"));
      if (!focusable.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dialog.current.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [operation, busy, closeOperation]);

  const modal = operation && typeof document !== "undefined" ? createPortal(
    <div className={`image-tool-modal-backdrop${operation === "annotate" ? " image-annotator-backdrop" : operation === "basic-edit" ? " image-crop-backdrop" : operation === "layer-split" ? " image-layer-split-backdrop" : operation === "character-turnaround" ? " character-turnaround-backdrop" : ""}`} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) closeOperation(); }}>
      <div ref={dialog} className={`image-tool-modal${operation === "annotate" ? " image-annotator-modal" : operation === "basic-edit" ? " image-crop-modal" : operation === "layer-split" ? " image-layer-split-modal" : operation === "character-turnaround" ? " character-turnaround-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || sourceState === "loading"} tabIndex={-1} onPointerDown={(event) => event.stopPropagation()}>
        {operation === "basic-edit" ? sourceState === "loading" ? <>
          <div className="image-tool-modal-head"><div><strong id={titleId}>图片基础编辑</strong><small>{title}</small></div><button type="button" aria-label="关闭图片工具" disabled={busy} onClick={closeOperation}><X size={16} aria-hidden="true" /></button></div>
          <div className="image-annotator-loading" role="status">正在读取图片…</div>
        </> : sourceState === "error" ? <>
          <div className="image-tool-modal-head"><div><strong id={titleId}>图片基础编辑</strong><small>{title}</small></div><button type="button" aria-label="关闭图片工具" disabled={busy} onClick={closeOperation}><X size={16} aria-hidden="true" /></button></div>
          <div className="image-annotator-error-state"><p className="image-tool-error" role="alert">{error || "图片加载失败，请重试。"}</p><button type="button" className="generate-button" onClick={loadEditableSource}>重试加载</button></div>
        </> : <ImageCropEditor source={previewSource || source} title={title} titleId={titleId} params={params} previewOutput={previewOutputs?.[0]} busy={busy} error={error} onChange={setParamsPatch} onReset={() => { setParams(initialParams("basic-edit")); setPreviewOutputs(null); setError(null); }} onCancel={closeOperation} onGenerate={apply} /> : operation === "character-turnaround" ? sourceState === "loading" ? <>
          <div className="image-tool-modal-head"><div><strong id={titleId}>角色三视图</strong><small>{title}</small></div><button type="button" aria-label="关闭角色三视图" disabled={busy} onClick={closeOperation}><X size={16} aria-hidden="true" /></button></div>
          <div className="image-annotator-loading" role="status">正在读取图片…</div>
        </> : sourceState === "error" ? <>
          <div className="image-tool-modal-head"><div><strong id={titleId}>角色三视图</strong><small>{title}</small></div><button type="button" aria-label="关闭角色三视图" disabled={busy} onClick={closeOperation}><X size={16} aria-hidden="true" /></button></div>
          <div className="image-annotator-error-state"><p className="image-tool-error" role="alert">{error || "图片加载失败，请重试。"}</p><button type="button" className="generate-button" onClick={loadEditableSource}>重试加载</button></div>
        </> : <CharacterTurnaroundEditor source={previewSource || source} title={title} titleId={titleId} busy={busy} onCancel={closeOperation} onGenerate={applyCharacterTurnaround} /> : operation === "layer-split" ? sourceState === "loading" ? <>
          <div className="image-tool-modal-head"><div><strong id={titleId}>图层拆分</strong><small>{title}</small></div><button type="button" aria-label="关闭图层拆分" disabled={busy} onClick={closeOperation}><X size={16} aria-hidden="true" /></button></div>
          <div className="image-annotator-loading" role="status">正在读取图片…</div>
        </> : sourceState === "error" ? <>
          <div className="image-tool-modal-head"><div><strong id={titleId}>图层拆分</strong><small>{title}</small></div><button type="button" aria-label="关闭图层拆分" disabled={busy} onClick={closeOperation}><X size={16} aria-hidden="true" /></button></div>
          <div className="image-annotator-error-state"><p className="image-tool-error" role="alert">{error || "图片加载失败，请重试。"}</p><button type="button" className="generate-button" onClick={loadEditableSource}>重试加载</button></div>
        </> : <ImageLayerSplitter source={previewSource || source} title={title} titleId={titleId} onApply={outputs => { onApply(outputs); restoreTriggerFocus.current = true; setOperation(null); setPreviewSource(null); setPreviewOutputs(null); setSourceState("idle"); }} onCancel={closeOperation} onBusyChange={setBusy} /> : operation === "annotate" ? sourceState === "loading" ? <>
          <div className="image-tool-modal-head"><div><strong id={titleId}>标记编辑</strong><small>{title}</small></div><button type="button" aria-label="关闭标记编辑" disabled={busy} onClick={closeOperation}><X size={16} aria-hidden="true" /></button></div>
          <div className="image-annotator-loading" role="status">正在读取图片…</div>
        </> : sourceState === "error" ? <>
          <div className="image-tool-modal-head"><div><strong id={titleId}>标记编辑</strong><small>{title}</small></div><button type="button" aria-label="关闭标记编辑" disabled={busy} onClick={closeOperation}><X size={16} aria-hidden="true" /></button></div>
          <div className="image-annotator-error-state"><p className="image-tool-error" role="alert">{error || "图片加载失败，请重试。"}</p><button type="button" className="generate-button" onClick={loadEditableSource}>重试加载</button></div>
        </> : <ImageAnnotator source={previewSource || source} title={title} titleId={titleId} onApply={applyAnnotation} onCancel={closeOperation} /> : <>
        <div className="image-tool-modal-head"><div><strong id={titleId}>{active?.label || "图片工具"}</strong><small>{title}</small></div><button type="button" aria-label="关闭图片工具" disabled={busy} onClick={closeOperation}><X size={16} aria-hidden="true" /></button></div>
        <div className="image-tool-workspace">
          <div className="image-tool-preview">{sourceState === "loading" ? <div className="video-tool-note" role="status" aria-live="polite">正在加载原图…</div> : sourceState === "error" ? <div className="video-tool-note" role="alert">{error || "预览暂不可用"}</div> : <><img className="image-tool-source" src={previewOutputs?.[0]?.dataUrl || previewSource || source} alt={previewOutputs ? `${title}处理预览` : title} />{previewOutputs && <div className="image-tool-preview-output-info" role="status"><strong>处理预览{previewOutputs.length > 1 ? ` · ${previewOutputs.length} 张` : ""}</strong><span>{previewOutputs[0].width} × {previewOutputs[0].height} · 输出 {formatBytes(previewOutputs.reduce((total, output) => total + dataUrlSize(output.dataUrl), 0))}</span><small>原图不会被覆盖；确认后会创建新的画布节点。</small></div>}</>}</div>
          <div className="image-tool-settings image-tool-form">
            {operation === "grid" && <div className="image-tool-grid two"><label>行数<input data-primary-input type="number" min="1" max="6" value={Number(params.rows)} disabled={busy} onChange={(event) => setParam("rows", Number(event.target.value))} /></label><label>列数<input type="number" min="1" max="6" value={Number(params.columns)} disabled={busy} onChange={(event) => setParam("columns", Number(event.target.value))} /></label></div>}
            {operation === "adjust" && <>{["brightness", "contrast", "saturation", "exposure"].map((key) => <label key={key}>{key === "brightness" ? "亮度" : key === "contrast" ? "对比度" : key === "saturation" ? "饱和度" : "曝光"}<input data-primary-input={key === "brightness" ? true : undefined} type="range" min="-100" max="100" value={Number(params[key])} disabled={busy} onChange={(event) => setParam(key, Number(event.target.value))} /><output>{Number(params[key])}</output></label>)}</>}
          </div>
        </div>
        <div className="image-tool-actions"><button type="button" className="image-tool-reset" onClick={() => { if (!operation || busy) return; setParams(initialParams(operation)); setPreviewOutputs(null); setError(null); }} disabled={busy}>重置</button><button type="button" className="button" onClick={closeOperation} disabled={busy}>取消</button><button type="button" className="generate-button" onClick={() => sourceState === "error" ? loadEditableSource() : void apply()} disabled={busy || sourceState === "loading"}>{busy ? "处理中…" : sourceState === "error" ? "重试加载" : error ? "重试处理" : previewOutputs ? `添加${previewOutputs.length > 1 ? ` ${previewOutputs.length} 张` : ""}到画布` : "生成预览"}</button></div>
        </>}
      </div>
    </div>, document.body,
  ) : null;

  const menuGroups = [
    {
      label: "图片编辑",
      items: [
        { id: "basic-edit", label: "图片基础编辑", detail: "裁剪、翻转并设置输出格式与质量", icon: Crop, onSelect: () => openOperation("basic-edit") },
        { id: "annotate", label: "标记修图", detail: "画笔、箭头、形状、文字与马赛克", icon: Type, onSelect: () => openOperation("annotate") },
        { id: "layer-split", label: "图层拆分", detail: "框选区域并拆分为独立图层", icon: Layers3, onSelect: () => openOperation("layer-split") },
        { id: "grid", label: "宫格裁剪", detail: "切分为多张图片", icon: Grid2X2, onSelect: () => openOperation("grid") },
        { id: "adjust", label: "图片调整", detail: "亮度、对比度与饱和度", icon: SlidersHorizontal, onSelect: () => openOperation("adjust") },
      ],
    },
    ...(onCreatePrompt ? [{
      label: "角色设定",
      items: [
        { id: "character-turnaround", label: "角色三视图", detail: "基于当前角色图生成正、侧、背三视图", icon: CircleUserRound, onSelect: () => openOperation("character-turnaround") },
      ],
    }] : []),
  ];
  return <div className="image-tools" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <MediaToolMenu label="图片工具" triggerLabel="工具" groups={menuGroups} disabled={busy} triggerRef={trigger} />
    {modal}
  </div>;
}
