import React from "react";
import { Check, Layers3, MessageSquareText, MousePointer2, ScanSearch, Sparkles, Trash2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ImageToolOutput } from "./ImageTools";

type SplitMode = "smart" | "prompt" | "region";
type Resolution = "1K" | "2K";
type Region = { id: number; left: number; top: number; width: number; height: number; label: string };
type Point = { x: number; y: number };
type Draft = Point & { endX: number; endY: number };

const MODES: Array<{ id: SplitMode; label: string; hint: string; icon: LucideIcon }> = [
  { id: "smart", label: "智能识别", hint: "人物、主体、文字", icon: Sparkles },
  { id: "prompt", label: "自然语言", hint: "描述要拆出的内容", icon: MessageSquareText },
  { id: "region", label: "区域框选", hint: "手动框选多个区域", icon: ScanSearch },
];

const EXAMPLES = [
  "需分离的文字坐标为 □",
  "文字坐标为 □；主体坐标为 □",
  "每个框选区域单独成层",
  "标题 □；人物 □；背景整层",
];

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const rectFromPoints = (start: Point, end: Point) => ({
  left: Math.min(start.x, end.x),
  top: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(source)) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法读取，请检查资源权限或稍后重试。"));
    image.src = source;
  });
}

function outputSize(width: number, height: number, resolution: Resolution) {
  const maxSide = resolution === "1K" ? 1024 : 2048;
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持图层拆分。");
  return { canvas, context };
}

export default function ImageLayerSplitter({ source, title, titleId, onApply, onCancel, onBusyChange }: {
  source: string;
  title: string;
  titleId: string;
  onApply: (outputs: ImageToolOutput[]) => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const frameRef = React.useRef<HTMLDivElement>(null);
  const nextId = React.useRef(1);
  const [mode, setMode] = React.useState<SplitMode>("region");
  const [imageSize, setImageSize] = React.useState({ width: 0, height: 0 });
  const [regions, setRegions] = React.useState<Region[]>([]);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [resolution, setResolution] = React.useState<Resolution>("2K");
  const [includeBackground, setIncludeBackground] = React.useState(false);
  const [previewOutputs, setPreviewOutputs] = React.useState<ImageToolOutput[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const selectedRegion = regions.find(region => region.id === selectedId);
  const canSplit = mode === "region" && regions.length > 0 && imageSize.width > 0 && !busy;
  const modeInfo = MODES.find(item => item.id === mode) || MODES[2];

  const setProcessing = (value: boolean) => {
    setBusy(value);
    onBusyChange?.(value);
  };

  const imagePoint = (event: React.PointerEvent<HTMLDivElement>): Point | null => {
    const frame = frameRef.current;
    if (!frame) return null;
    const bounds = frame.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };

  const startRegion = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== "region" || busy || previewOutputs || regions.length >= 12) return;
    const point = imagePoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraft({ ...point, endX: point.x, endY: point.y });
  };

  const moveRegion = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const point = imagePoint(event);
    if (!point) return;
    setDraft(current => current ? { ...current, endX: point.x, endY: point.y } : null);
  };

  const finishRegion = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const point = imagePoint(event) || { x: draft.endX, y: draft.endY };
    const rect = rectFromPoints({ x: draft.x, y: draft.y }, point);
    setDraft(null);
    if (rect.width < 0.025 || rect.height < 0.025) return;
    const id = nextId.current++;
    const region: Region = { ...rect, id, label: `区域 ${id}` };
    setRegions(current => [...current, region]);
    setSelectedId(id);
  };

  const removeSelected = () => {
    if (selectedId === null || busy || previewOutputs) return;
    setRegions(current => current.filter(region => region.id !== selectedId));
    setSelectedId(null);
  };

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (busy || previewOutputs || mode !== "region" || selectedId === null) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input,textarea,select")) return;
      event.preventDefault();
      removeSelected();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, mode, previewOutputs, selectedId]);

  const updateRegion = (id: number, patch: Partial<Region>) => {
    setRegions(current => current.map(region => region.id === id ? { ...region, ...patch } : region));
  };

  const reset = () => {
    if (busy) return;
    setRegions([]);
    setSelectedId(null);
    setDraft(null);
    setPrompt("");
    setIncludeBackground(false);
    setPreviewOutputs(null);
    setError(null);
  };

  const renderLayers = async () => {
    if (!canSplit) return;
    setProcessing(true);
    setError(null);
    try {
      const image = await loadImage(source);
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const outputs: ImageToolOutput[] = [];
      const commonParams = { mode, resolution, includeBackground, prompt: prompt.trim().slice(0, 400) };

      if (includeBackground) {
        const size = outputSize(width, height, resolution);
        const { canvas, context } = createCanvas(size.width, size.height);
        context.drawImage(image, 0, 0, size.width, size.height);
        context.globalCompositeOperation = "destination-out";
        regions.forEach(region => context.clearRect(region.left * size.width, region.top * size.height, region.width * size.width, region.height * size.height));
        context.globalCompositeOperation = "source-over";
        outputs.push({
          dataUrl: canvas.toDataURL("image/png"), width: size.width, height: size.height,
          operationId: "layer-split", params: { ...commonParams, layer: "背景", regionCount: regions.length }, titleSuffix: "图层拆分 · 背景",
        });
      }

      regions.forEach((region, index) => {
        const cropWidth = Math.max(1, Math.round(region.width * width));
        const cropHeight = Math.max(1, Math.round(region.height * height));
        const size = outputSize(cropWidth, cropHeight, resolution);
        const { canvas, context } = createCanvas(size.width, size.height);
        context.drawImage(image, Math.round(region.left * width), Math.round(region.top * height), cropWidth, cropHeight, 0, 0, size.width, size.height);
        const label = region.label.trim() || `区域 ${index + 1}`;
        outputs.push({
          dataUrl: canvas.toDataURL("image/png"), width: size.width, height: size.height,
          operationId: "layer-split", params: { ...commonParams, layer: label, index, left: region.left, top: region.top, width: region.width, height: region.height }, titleSuffix: `图层拆分 · ${label}`,
        });
      });
      setPreviewOutputs(outputs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图层拆分失败，请重试。");
    } finally {
      setProcessing(false);
    }
  };

  const submit = () => {
    if (previewOutputs) {
      onApply(previewOutputs);
      return;
    }
    void renderLayers();
  };

  return <>
    <div className="image-tool-modal-head image-layer-split-head">
      <div className="image-layer-split-title"><Layers3 size={17} aria-hidden="true" /><div><strong id={titleId}>{previewOutputs ? "图层拆分预览" : "图层拆分"}</strong><small>{title} · {imageSize.width ? `${imageSize.width} × ${imageSize.height}` : "正在读取图片…"}</small></div></div>
      <button type="button" aria-label="关闭图层拆分" disabled={busy} onClick={onCancel}><X size={17} /></button>
    </div>

    <div className={`layer-split-workspace${previewOutputs ? " is-preview" : ""}`}>
      <section className="layer-split-stage" aria-label="图层拆分预览区域">
        {previewOutputs ? <div className="layer-split-preview-grid">{previewOutputs.map((output, index) => <article key={`${output.titleSuffix}-${index}`} className="layer-split-preview-card"><div><strong>{String(output.params.layer || output.titleSuffix)}</strong><span>{output.width} × {output.height}px</span></div><img src={output.dataUrl} alt={`${String(output.params.layer || "图层")}预览`} /></article>)}</div> : <div ref={frameRef} className={`layer-split-image-frame${mode === "region" ? " is-drawable" : ""}`} onPointerDown={startRegion} onPointerMove={moveRegion} onPointerUp={finishRegion} onPointerCancel={() => setDraft(null)}>
          <img src={source} alt={title} onLoad={event => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
          {regions.map((region, index) => <button key={region.id} type="button" className={`layer-split-region${selectedId === region.id ? " is-selected" : ""}`} style={{ left: `${region.left * 100}%`, top: `${region.top * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} aria-label={`选择${region.label || `区域 ${index + 1}`}`} onPointerDown={event => event.stopPropagation()} onClick={() => setSelectedId(region.id)}><span>{index + 1} · {region.label}</span></button>)}
          {draft && <div className="layer-split-region is-draft" style={{ left: `${Math.min(draft.x, draft.endX) * 100}%`, top: `${Math.min(draft.y, draft.endY) * 100}%`, width: `${Math.abs(draft.endX - draft.x) * 100}%`, height: `${Math.abs(draft.endY - draft.y) * 100}%` }}><span>新图层</span></div>}
          {!regions.length && !draft && <div className="layer-split-canvas-hint"><MousePointer2 size={16} aria-hidden="true" /><span>在图片上拖拽，框出要单独成层的区域</span></div>}
        </div>}
        <div className="layer-split-stage-footer"><span>{previewOutputs ? `${previewOutputs.length} 个图层已生成预览` : mode === "region" ? "区域框选：可连续拖出多个区域" : modeInfo.hint}</span>{imageSize.width > 0 && <strong>{imageSize.width} × {imageSize.height}px</strong>}</div>
      </section>

      <aside className="layer-split-inspector" aria-label="图层拆分设置">
        <div className="layer-split-inspector-title"><strong>图层拆分</strong><span>{previewOutputs ? "预览结果" : "选择拆分方式"}</span></div>
        {!previewOutputs && <div className="layer-split-tabs" role="tablist" aria-label="图层拆分方式">{MODES.map(item => { const Icon = item.icon; return <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} className={mode === item.id ? "is-active" : ""} onClick={() => { if (!busy) { setMode(item.id); setError(null); } }}><Icon size={14} aria-hidden="true" /><span>{item.label}</span></button>; })}</div>}

        {previewOutputs ? <div className="layer-split-result-info"><strong>{previewOutputs.length} 个独立图层</strong><span>{resolution} 输出 · PNG 透明背景</span><small>确认后会把每个图层作为新的画布节点添加，原图保持不变。</small><button type="button" className="button" onClick={() => setPreviewOutputs(null)}>继续调整</button></div> : mode === "region" ? <>
          <p className="layer-split-description">在图片上框选需要单独成层的区域，可连续添加多个区域。</p>
          <div className="layer-split-region-heading"><strong>已框选区域 {regions.length}</strong><button type="button" disabled={!selectedRegion || busy} onClick={removeSelected}><Trash2 size={13} aria-hidden="true" />删除选中</button></div>
          <div className="layer-split-region-list">{regions.length ? regions.map((region, index) => <div key={region.id} className={`layer-split-region-row${selectedId === region.id ? " is-selected" : ""}`}><div className="layer-split-region-select" role="button" tabIndex={0} onClick={() => setSelectedId(region.id)} onKeyDown={event => { if ((event.target as HTMLElement).matches("input,textarea,select")) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(region.id); } }}><span className="layer-split-region-number">{index + 1}</span><input aria-label={`图层 ${index + 1} 名称`} value={region.label} onChange={event => updateRegion(region.id, { label: event.target.value })} onClick={event => event.stopPropagation()} /><small>{Math.round(region.width * imageSize.width)} × {Math.round(region.height * imageSize.height)}px</small></div></div>) : <div className="layer-split-empty">还没有区域，去左侧图片上拖拽框选</div>}</div>
          <label className="layer-split-checkbox"><input type="checkbox" checked={includeBackground} disabled={busy} onChange={event => setIncludeBackground(event.target.checked)} />同时保留背景层</label>
        </> : mode === "prompt" ? <>
          <p className="layer-split-description">用自然语言描述要拆出的内容，接入视觉模型后会自动识别并生成独立图层。</p>
          <textarea aria-label="图层拆分描述" value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)} placeholder="例如：标题、人物和服装细节分别成层，背景保留一层" />
          <div className="layer-split-examples"><strong>示例</strong>{EXAMPLES.map(example => <button key={example} type="button" onClick={() => setPrompt(example)}>{example}</button>)}</div>
          <div className="layer-split-unavailable"><MessageSquareText size={15} aria-hidden="true" /><span>自然语言拆分需要平台视觉模型，当前可切换到“区域框选”完成本地拆分。</span></div>
        </> : <>
          <p className="layer-split-description">自动识别人物、主体、文字和背景，并分别生成可编辑图层。</p>
          <div className="layer-split-smart-list"><span>人物 / 主体</span><span>文字 / 标题</span><span>背景 / 细节</span></div>
          <div className="layer-split-unavailable"><Sparkles size={15} aria-hidden="true" /><span>智能识别需要平台视觉模型，当前可切换到“区域框选”完成本地拆分。</span></div>
        </>}

        {!previewOutputs && <label className="layer-split-resolution">输出分辨率<select aria-label="图层输出分辨率" value={resolution} disabled={busy} onChange={event => setResolution(event.target.value as Resolution)}><option value="1K">1K · 更快</option><option value="2K">2K · 更清晰</option></select></label>}
      </aside>
    </div>

    {error && <p className="image-tool-error layer-split-error" role="alert">{error}</p>}
    <div className="layer-split-footer image-tool-actions"><button type="button" className="image-tool-reset" onClick={reset} disabled={busy || Boolean(previewOutputs)}>重置</button><span className="layer-split-footer-summary">{previewOutputs ? `预览 ${previewOutputs.length} 个图层` : mode === "region" ? `${regions.length} 个区域 · ${resolution}` : modeInfo.label}</span><div><button type="button" className="button" onClick={onCancel} disabled={busy}>取消</button><button type="button" className="generate-button" disabled={!canSplit && !previewOutputs} onClick={submit}>{busy ? "处理中…" : previewOutputs ? "添加到画布" : "拆分"}{previewOutputs && <Check size={14} />}</button></div></div>
  </>;
}
