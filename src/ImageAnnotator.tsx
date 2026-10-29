import React from "react";
import {
  ArrowUpRight,
  Check,
  Circle,
  Hash,
  Layers3,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  RotateCcw,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import type { ImageToolOutput } from "./ImageTools";

type Point = { x: number; y: number };
type AnnotationKind = "pen" | "line" | "arrow" | "rect" | "ellipse" | "mosaic" | "number" | "text";
type AnnotationTool = "select" | AnnotationKind;
type Annotation = {
  id: number;
  kind: AnnotationKind;
  points: Point[];
  color: string;
  width: number;
  text?: string;
  number?: number;
};

const COLORS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#14b8a6", "#3b82f6", "#a855f7", "#ffffff", "#111111"];
const TOOLBAR: Array<{ id: AnnotationTool; label: string; icon: typeof MousePointer2 }> = [
  { id: "select", label: "选择", icon: MousePointer2 },
  { id: "pen", label: "画笔", icon: Pencil },
  { id: "line", label: "直线", icon: Minus },
  { id: "arrow", label: "箭头", icon: ArrowUpRight },
  { id: "rect", label: "矩形", icon: Square },
  { id: "ellipse", label: "椭圆", icon: Circle },
  { id: "mosaic", label: "马赛克", icon: Layers3 },
  { id: "number", label: "编号", icon: Hash },
  { id: "text", label: "文字", icon: Type },
];

function lineWidth(image: HTMLImageElement, value: number): number {
  return Math.max(1, value * Math.max(image.naturalWidth, image.naturalHeight) / 900);
}

function bounds(points: Point[]) {
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

function drawArrow(context: CanvasRenderingContext2D, from: Point, to: Point, width: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(width * 3, 12);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
  context.stroke();
}

function drawAnnotation(context: CanvasRenderingContext2D, image: HTMLImageElement, item: Annotation) {
  const [start, end = start] = item.points;
  if (!start) return;
  const width = lineWidth(image, item.width);
  context.save();
  context.strokeStyle = item.color;
  context.fillStyle = item.color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (item.kind === "pen") {
    context.beginPath();
    context.moveTo(start.x, start.y);
    for (const point of item.points.slice(1)) context.lineTo(point.x, point.y);
    if (item.points.length === 1) context.lineTo(start.x + 0.01, start.y + 0.01);
    context.stroke();
  } else if (item.kind === "line") {
    context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y); context.stroke();
  } else if (item.kind === "arrow") {
    drawArrow(context, start, end, width);
  } else if (item.kind === "rect" || item.kind === "mosaic") {
    const box = bounds([start, end]);
    if (item.kind === "mosaic") {
      if (box.right - box.left < 1 || box.bottom - box.top < 1) { context.restore(); return; }
      const cell = Math.max(6, Math.round(Math.max(box.right - box.left, box.bottom - box.top) / 12));
      const pixelated = document.createElement("canvas");
      pixelated.width = Math.max(1, Math.ceil((box.right - box.left) / cell));
      pixelated.height = Math.max(1, Math.ceil((box.bottom - box.top) / cell));
      const pixelContext = pixelated.getContext("2d");
      if (pixelContext) {
        pixelContext.imageSmoothingEnabled = true;
        pixelContext.drawImage(image, box.left, box.top, box.right - box.left, box.bottom - box.top, 0, 0, pixelated.width, pixelated.height);
        context.imageSmoothingEnabled = false;
        context.drawImage(pixelated, 0, 0, pixelated.width, pixelated.height, box.left, box.top, box.right - box.left, box.bottom - box.top);
        context.imageSmoothingEnabled = true;
      }
      context.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
      pixelated.width = 0; pixelated.height = 0;
    } else {
      context.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    }
  } else if (item.kind === "ellipse") {
    const box = bounds([start, end]);
    context.beginPath();
    context.ellipse((box.left + box.right) / 2, (box.top + box.bottom) / 2, Math.max(1, (box.right - box.left) / 2), Math.max(1, (box.bottom - box.top) / 2), 0, 0, Math.PI * 2);
    context.stroke();
  } else if (item.kind === "number") {
    const radius = Math.max(width * 2.2, 17);
    context.beginPath(); context.arc(start.x, start.y, radius, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#fff";
    context.font = `700 ${Math.max(12, radius * 1.1)}px system-ui, sans-serif`;
    context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(String(item.number || 1), start.x, start.y + 0.5);
  } else if (item.kind === "text") {
    const fontSize = Math.max(18, Math.round(Math.max(image.naturalWidth, image.naturalHeight) / 34));
    context.font = `600 ${fontSize}px system-ui, sans-serif`;
    context.textBaseline = "top";
    context.shadowColor = "#000c"; context.shadowBlur = fontSize * 0.22;
    context.fillText(item.text || "文字", start.x, start.y);
  }
  context.restore();
}

function drawScene(context: CanvasRenderingContext2D, image: HTMLImageElement, items: Annotation[], draft?: Annotation | null, selectedId?: number | null) {
  context.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
  context.drawImage(image, 0, 0);
  for (const item of items) drawAnnotation(context, image, item);
  if (draft) drawAnnotation(context, image, draft);
  if (selectedId && !draft) {
    const selected = items.find(item => item.id === selectedId);
    if (selected?.points.length) {
      const box = bounds(selected.points);
      const padding = Math.max(8, lineWidth(image, selected.width) * 2);
      context.save();
      context.strokeStyle = "#b9bfff"; context.lineWidth = Math.max(2, image.naturalWidth / 800);
      context.setLineDash([8, 6]);
      context.strokeRect(box.left - padding, box.top - padding, box.right - box.left + padding * 2, box.bottom - box.top + padding * 2);
      context.restore();
    }
  }
}

function annotationOutput(image: HTMLImageElement, items: Annotation[]): ImageToolOutput {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持导出标注图片。");
  context.drawImage(image, 0, 0);
  items.forEach(item => drawAnnotation(context, image, item));
  const firstText = items.find(item => item.kind === "text")?.text || "";
  const color = items.at(-1)?.color || "#ef4444";
  const tools = [...new Set(items.map(item => item.kind))].join(",");
  const output: ImageToolOutput = {
    dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height,
    operationId: "annotate", params: { count: items.length, tools, text: firstText, color }, titleSuffix: "标记",
  };
  canvas.width = 0; canvas.height = 0;
  return output;
}

export default function ImageAnnotator({ source, title, titleId, onApply, onCancel }: {
  source: string;
  title: string;
  titleId: string;
  onApply: (output: ImageToolOutput) => void;
  onCancel: () => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const draftRef = React.useRef<Annotation | null>(null);
  const moveRef = React.useRef<{ id: number; start: Point; source: Annotation; current: Annotation; originalItems: Annotation[] } | null>(null);
  const nextId = React.useRef(0);
  const [image, setImage] = React.useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = React.useState("");
  const [tool, setTool] = React.useState<AnnotationTool>("pen");
  const [color, setColor] = React.useState("#ef4444");
  const [width, setWidth] = React.useState(6);
  const [items, setItems] = React.useState<Annotation[]>([]);
  const [past, setPast] = React.useState<Annotation[][]>([]);
  const [future, setFuture] = React.useState<Annotation[][]>([]);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState<Annotation | null>(null);
  const [showLayers, setShowLayers] = React.useState(true);
  const [preview, setPreview] = React.useState<ImageToolOutput | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    const next = new Image();
    if (/^https?:\/\//i.test(source)) next.crossOrigin = "anonymous";
    next.onload = () => { if (active) { setImage(next); setLoadError(""); } };
    next.onerror = () => { if (active) setLoadError("图片加载失败，请关闭后重试。"); };
    next.src = source;
    return () => { active = false; next.onload = null; next.onerror = null; };
  }, [source]);

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !image) return;
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    drawScene(context, image, items, draft, selectedId);
  }, [draft, image, items, selectedId]);

  const commit = (nextItems: Annotation[]) => {
    setPast(current => [...current.slice(-49), items]);
    setItems(nextItems);
    setFuture([]);
    setPreview(null);
  };

  const undo = () => {
    if (!past.length) return;
    const previous = past[past.length - 1];
    setPast(current => current.slice(0, -1));
    setFuture(current => [items, ...current].slice(0, 50));
    setItems(previous);
    setSelectedId(previous.at(-1)?.id ?? null);
    setPreview(null);
  };

  const redo = () => {
    if (!future.length) return;
    const next = future[0];
    setFuture(current => current.slice(1));
    setPast(current => [...current.slice(-49), items]);
    setItems(next);
    setSelectedId(next.at(-1)?.id ?? null);
    setPreview(null);
  };

  const removeSelected = () => {
    if (selectedId === null) return;
    const next = items.filter(item => item.id !== selectedId);
    if (next.length === items.length) return;
    commit(next); setSelectedId(null);
  };

  const clearAll = () => {
    if (!items.length) return;
    commit([]); setSelectedId(null);
  };

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
    };
  };

  const selectAt = (point: Point) => {
    const target = [...items].reverse().find(item => {
      if (!item.points.length) return false;
      const box = bounds(item.points);
      const pad = Math.max(18, lineWidth(image!, item.width) * 3);
      return point.x >= box.left - pad && point.x <= box.right + pad && point.y >= box.top - pad && point.y <= box.bottom + pad;
    });
    setSelectedId(target?.id ?? null);
    return target;
  };

  const addAt = (point: Point, kind: "number" | "text") => {
    const number = items.filter(item => item.kind === "number").length + 1;
    const item: Annotation = { id: ++nextId.current, kind, points: [point], color, width, ...(kind === "text" ? { text: "文字" } : { number }) };
    commit([...items, item]); setSelectedId(item.id);
    if (kind === "text") setTool("select");
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image || preview || busy || event.button !== 0) return;
    const point = pointAt(event);
    if (tool === "select") {
      const target = selectAt(point);
      if (target) {
        event.currentTarget.setPointerCapture(event.pointerId);
        moveRef.current = { id: target.id, start: point, source: target, current: target, originalItems: items };
      }
      return;
    }
    if (tool === "number" || tool === "text") { addAt(point, tool); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    const item: Annotation = { id: ++nextId.current, kind: tool, points: [point], color, width };
    draftRef.current = item; setDraft(item); setSelectedId(null);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const moving = moveRef.current;
    if (moving) {
      const point = pointAt(event);
      const dx = point.x - moving.start.x, dy = point.y - moving.start.y;
      const moved = { ...moving.source, points: moving.source.points.map(vertex => ({ x: vertex.x + dx, y: vertex.y + dy })) };
      moving.current = moved;
      setItems(moving.originalItems.map(item => item.id === moving.id ? moved : item));
      setPreview(null);
      return;
    }
    const current = draftRef.current;
    if (!current) return;
    const point = pointAt(event);
    const next = current.kind === "pen"
      ? { ...current, points: [...current.points, point] }
      : { ...current, points: [current.points[0], point] };
    draftRef.current = next; setDraft(next);
  };

  const finishDrawing = () => {
    const moving = moveRef.current;
    if (moving) {
      moveRef.current = null;
      const shift = moving.current.points[0] && moving.source.points[0]
        ? Math.hypot(moving.current.points[0].x - moving.source.points[0].x, moving.current.points[0].y - moving.source.points[0].y)
        : 0;
      if (shift > 0.5) {
        setPast(current => [...current.slice(-49), moving.originalItems]);
        setFuture([]);
      }
      return;
    }
    const current = draftRef.current;
    if (!current) return;
    draftRef.current = null; setDraft(null);
    if (current.kind !== "pen" && current.points.length > 1) {
      const [start, end] = current.points;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 3) return;
    }
    commit([...items, current]); setSelectedId(current.id);
  };

  const cancelPointerAction = () => {
    const moving = moveRef.current;
    if (moving) { moveRef.current = null; setItems(moving.originalItems); return; }
    draftRef.current = null; setDraft(null);
  };

  const updateSelectedText = (text: string) => {
    if (selectedId === null) return;
    const next = items.map(item => item.id === selectedId && item.kind === "text" ? { ...item, text } : item);
    if (next.some((item, index) => item !== items[index])) commit(next);
  };

  const createPreview = () => {
    if (!image || !items.length || busy) return;
    setBusy(true);
    setLoadError("");
    window.requestAnimationFrame(() => {
      try { setPreview(annotationOutput(image, items)); }
      catch (cause) { setLoadError(cause instanceof Error ? cause.message : "无法生成标注预览，请重试。"); }
      finally { setBusy(false); }
    });
  };

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault(); event.shiftKey ? redo() : undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); redo();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId !== null && !preview) {
        event.preventDefault(); removeSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const selected = items.find(item => item.id === selectedId);
  const dimensions = image ? `${image.naturalWidth} × ${image.naturalHeight}` : "正在读取图片…";
  const activeTool = TOOLBAR.find(item => item.id === tool);

  return <>
    <div className="image-tool-modal-head image-annotator-head">
      <div><strong id={titleId}>{preview ? "标记预览" : "标记编辑"}</strong><small>{title} · {dimensions}</small></div>
      <button type="button" aria-label="关闭标记编辑" disabled={busy} onClick={onCancel}><X size={17} /></button>
    </div>

    {loadError && <p className="image-tool-error image-annotator-error" role="alert">{loadError}</p>}

    <div className={`image-annotator-workspace${preview ? " is-preview" : ""}`}>
      <div className="image-annotator-stage" aria-label={preview ? "标注结果预览" : "标记画布"}>
        {preview ? <img src={preview.dataUrl} alt={`${title}标记预览`} /> : image ? <canvas
          ref={canvasRef}
          aria-label="图片标注画布"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrawing}
          onPointerCancel={cancelPointerAction}
          style={{ cursor: tool === "select" ? (selectedId ? "move" : "default") : tool === "text" ? "text" : "crosshair" }}
        /> : <div className="image-annotator-loading" role="status">正在读取图片…</div>}
        {preview && <span className="image-annotator-preview-badge" role="status">预览 · {dimensions}</span>}
      </div>

      <aside className="image-annotator-inspector" aria-label="标记属性">
        <div className="image-annotator-inspector-title"><strong>{preview ? "结果信息" : selected?.kind === "text" ? "文字标记" : "标记样式"}</strong><span>{items.length} 个标记</span></div>
        {preview ? <div className="image-annotator-preview-info"><strong>{dimensions}</strong><span>{items.length} 个标记 · 输出 PNG</span><small>原图保持不变；确认后会把标记结果作为新图片添加到画布。</small><button type="button" className="button" onClick={() => setPreview(null)}>继续编辑</button></div> : <>
          <section className="image-annotator-control-group">
            <span className="image-annotator-label">工具</span>
            <div className="image-annotator-selected-tool"><strong>{activeTool?.label || "画笔"}</strong><small>{tool === "select" ? "拖动标记可移动；可删除或编辑文字" : tool === "text" ? "点击画面放置文字" : tool === "number" ? "点击画面添加序号" : "按住并拖动以绘制"}</small></div>
          </section>
          <section className="image-annotator-control-group">
            <span className="image-annotator-label">颜色</span>
            <div className="image-annotator-colors" role="group" aria-label="标记颜色">
              {COLORS.map(value => <button key={value} type="button" aria-label={`颜色 ${value}`} aria-pressed={color === value} className={color === value ? "is-active" : ""} style={{ "--annotation-swatch": value } as React.CSSProperties} onClick={() => setColor(value)} />)}
              <label className="image-annotator-custom-color" title="自定义颜色"><input aria-label="自定义标记颜色" type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
            </div>
          </section>
          <section className="image-annotator-control-group">
            <label className="image-annotator-label" htmlFor="annotation-width">粗细 <output>{width}px</output></label>
            <input id="annotation-width" className="image-annotator-width" aria-label="标记粗细" type="range" min="1" max="20" value={width} onChange={event => setWidth(Number(event.target.value))} />
          </section>
          {selected?.kind === "text" && <section className="image-annotator-control-group">
            <label className="image-annotator-label" htmlFor="annotation-text">标记文字</label>
            <textarea id="annotation-text" aria-label="标记文字" maxLength={120} value={selected.text || ""} onChange={event => updateSelectedText(event.target.value)} />
          </section>}
          {showLayers && <section className="image-annotator-layer-group">
            <div className="image-annotator-layer-heading"><strong>标记图层</strong><span>{items.length}</span></div>
            {items.length ? <div className="image-annotator-layer-list">{[...items].reverse().map((item, index) => <button type="button" key={item.id} className={selectedId === item.id ? "is-active" : ""} aria-pressed={selectedId === item.id} onClick={() => { setSelectedId(item.id); setTool("select"); }}><span className="image-annotator-layer-dot" style={{ "--annotation-swatch": item.color } as React.CSSProperties} /><span>{item.kind === "text" ? (item.text || "文字") : item.kind === "number" ? `编号 ${item.number}` : TOOLBAR.find(entry => entry.id === item.kind)?.label}</span><small>#{items.length - index}</small></button>)}</div> : <p>绘制后可在这里选择和删除标记。</p>}
          </section>}
        </>}
      </aside>
    </div>

    {!preview && <div className="image-annotator-bottom-bar">
      <div className="image-annotator-tool-group" role="toolbar" aria-label="标记工具">
        {TOOLBAR.map(entry => {
          const Icon = entry.icon;
          return <button key={entry.id} type="button" aria-label={entry.label} title={entry.label} aria-pressed={tool === entry.id} className={tool === entry.id ? "is-active" : ""} onClick={() => setTool(entry.id)}><Icon size={16} /></button>;
        })}
      </div>
      <div className="image-annotator-edit-actions">
        <button type="button" aria-label="撤销" title="撤销 (⌘Z / Ctrl+Z)" disabled={!past.length} onClick={undo}><Undo2 size={16} /></button>
        <button type="button" aria-label="重做" title="重做 (⌘⇧Z / Ctrl+Y)" disabled={!future.length} onClick={redo}><Redo2 size={16} /></button>
        <span className="image-annotator-action-divider" />
        <button type="button" aria-label="图层" aria-pressed={showLayers} title="显示或隐藏图层" className={showLayers ? "is-active" : ""} onClick={() => setShowLayers(value => !value)}><Layers3 size={16} /></button>
        <button type="button" aria-label="删除选中标记" title="删除选中标记" disabled={selectedId === null} onClick={removeSelected}><Trash2 size={16} /></button>
        <button type="button" aria-label="重置所有标记" title="重置所有标记" disabled={!items.length} onClick={clearAll}><RotateCcw size={15} /></button>
      </div>
      <div className="image-annotator-footer-actions">
        <button type="button" className="button" onClick={onCancel}>取消</button>
        <button type="button" className="generate-button" disabled={!image || !items.length || busy} onClick={createPreview}>{busy ? "正在生成…" : "生成预览"}</button>
      </div>
    </div>}
    {preview && <div className="image-annotator-preview-footer"><span>预览结果 · {dimensions}</span><div><button type="button" className="button" onClick={onCancel}>取消</button><button type="button" className="generate-button" onClick={() => onApply(preview)}><Check size={15} />添加到画布</button></div></div>}
  </>;
}
