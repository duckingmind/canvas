import React from "react";
import { Brush, Eraser, Undo2, Redo2, Trash2, Type, X, Save, Info } from "lucide-react";
import { isComposingKey } from "./keyboard";
import "./hand-draw.css";

type HandDrawModalProps = { onCancel: () => void; onSave: (dataUrl: string) => void };
type DrawingTool = "brush" | "eraser" | "text";
type Point = { x: number; y: number };
type PointerLike = { clientX: number; clientY: number };
type TextLayer = Point & { id: number; text: string; color: string; size: number };
type HistoryEntry = { image: ImageData; textLayers: TextLayer[] };
type TextEditor = Point & { id: number; layerId?: number; left: number; top: number; scale: number; value: string; color: string; size: number };
const RATIOS = [
  { label: "16:9", w: 16, h: 9 }, { label: "9:16", w: 9, h: 16 },
  { label: "1:1", w: 1, h: 1 }, { label: "4:3", w: 4, h: 3 },
];
const COLORS = ["#111111", "#e53935", "#f57c00", "#2e7d32", "#1976d2", "#7b1fa2", "#ffffff"];
const canvasFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const textLineHeight = (size: number) => size * 1.25;
const drawTextLayer = (ctx: CanvasRenderingContext2D, layer: TextLayer) => {
  ctx.fillStyle = layer.color;
  ctx.font = `${layer.size}px ${canvasFont}`;
  ctx.textBaseline = "top";
  layer.text.split(/\r?\n/).forEach((line, index) => {
    ctx.fillText(line, layer.x, layer.y + index * textLineHeight(layer.size));
  });
};
const textLayerBounds = (ctx: CanvasRenderingContext2D, layer: TextLayer) => {
  ctx.font = `${layer.size}px ${canvasFont}`;
  const lines = layer.text.split(/\r?\n/);
  return {
    width: Math.max(1, ...lines.map((line) => ctx.measureText(line).width)),
    height: Math.max(layer.size, lines.length * textLineHeight(layer.size)),
  };
};

export default function HandDrawModal({ onCancel, onSave }: HandDrawModalProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const baseCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const textInputRef = React.useRef<HTMLTextAreaElement>(null);
  const nextTextId = React.useRef(0);
  const finalizedTextIds = React.useRef(new Set<number>());
  const textLayersRef = React.useRef<TextLayer[]>([]);
  const activeTextIdRef = React.useRef<number | null>(null);
  const historyIndexRef = React.useRef(-1);
  const historyRef = React.useRef<HistoryEntry[]>([]);
  const [ratio, setRatio] = React.useState(RATIOS[0]);
  const [color, setColor] = React.useState(COLORS[0]);
  const [size, setSize] = React.useState(12);
  const [textSize, setTextSize] = React.useState(36);
  const [tool, setTool] = React.useState<DrawingTool>("brush");
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const [textLayers, setTextLayers] = React.useState<TextLayer[]>([]);
  const [activeTextId, setActiveTextId] = React.useState<number | null>(null);
  const [textEditor, setTextEditor] = React.useState<TextEditor | null>(null);
  const [textDrag, setTextDrag] = React.useState<{ id: number; start: Point; origin: Point; moved: boolean } | null>(null);
  const [pendingRatio, setPendingRatio] = React.useState<typeof RATIOS[number] | null>(null);
  const drawing = React.useRef(false);
  const last = React.useRef<Point | null>(null);
  const dimensions = React.useMemo(() => ratio.w >= ratio.h ? { w: 1200, h: Math.round(1200 * ratio.h / ratio.w) } : { h: 1200, w: Math.round(1200 * ratio.w / ratio.h) }, [ratio]);
  const renderCanvas = React.useCallback((layers = textLayersRef.current, selectedId = activeTextIdRef.current, includeSelection = true) => {
    const c = canvasRef.current; const base = baseCanvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !base || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(base, 0, 0);
    ctx.save();
    ctx.textAlign = "left";
    layers.forEach((layer) => drawTextLayer(ctx, layer));
    if (includeSelection && selectedId !== null) {
      const selected = layers.find((layer) => layer.id === selectedId);
      if (selected) {
        const bounds = textLayerBounds(ctx, selected);
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#4d7cff";
        ctx.lineWidth = Math.max(1, 2 / (c.width / Math.max(1, c.getBoundingClientRect().width)));
        ctx.strokeRect(selected.x - 6, selected.y - 6, bounds.width + 12, bounds.height + 12);
      }
    }
    ctx.restore();
  }, []);
  const snapshot = React.useCallback((layers = textLayersRef.current) => {
    const base = baseCanvasRef.current;
    if (!base) return;
    const ctx = base.getContext("2d"); if (!ctx) return;
    const next: HistoryEntry = {
      image: ctx.getImageData(0, 0, base.width, base.height),
      textLayers: layers.map((layer) => ({ ...layer })),
    };
    const nextHistory = [...historyRef.current.slice(0, historyIndexRef.current + 1), next].slice(-30);
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    setHistory(nextHistory);
    setHistoryIndex(historyIndexRef.current);
  }, []);
  const initialize = React.useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const base = baseCanvasRef.current || document.createElement("canvas");
    baseCanvasRef.current = base;
    c.width = dimensions.w; c.height = dimensions.h;
    base.width = dimensions.w; base.height = dimensions.h;
    const ctx = base.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    finalizedTextIds.current.clear();
    setPendingRatio(null);
    setTextEditor((current) => {
      if (current) finalizedTextIds.current.add(current.id);
      return null;
    });
    textLayersRef.current = [];
    activeTextIdRef.current = null;
    setTextLayers([]);
    setActiveTextId(null);
    renderCanvas([], null, false);
    const initialHistory = [{ image: ctx.getImageData(0, 0, base.width, base.height), textLayers: [] }];
    historyRef.current = initialHistory;
    historyIndexRef.current = 0;
    setHistory(initialHistory); setHistoryIndex(0);
  }, [dimensions, renderCanvas]);
  React.useEffect(() => { initialize(); }, [initialize]);
  const point = (event: PointerLike) => {
    const c = canvasRef.current; if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: (event.clientX - r.left) * c.width / r.width, y: (event.clientY - r.top) * c.height / r.height };
  };

  const findTextLayer = (target: Point) => {
    const c = canvasRef.current; if (!c) return null;
    const ctx = c.getContext("2d"); if (!ctx) return null;
    for (let index = textLayersRef.current.length - 1; index >= 0; index -= 1) {
      const layer = textLayersRef.current[index];
      const bounds = textLayerBounds(ctx, layer);
      if (target.x >= layer.x - 8 && target.x <= layer.x + bounds.width + 8 && target.y >= layer.y - 8 && target.y <= layer.y + bounds.height + 8)
        return layer;
    }
    return null;
  };

  const clampTextLayer = (layer: TextLayer) => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return layer;
    const bounds = textLayerBounds(ctx, layer);
    return {
      ...layer,
      x: Math.min(Math.max(0, layer.x), Math.max(0, c.width - bounds.width)),
      y: Math.min(Math.max(0, layer.y), Math.max(0, c.height - bounds.height)),
    };
  };

  const openTextEditor = (event: PointerLike, layer?: TextLayer | null) => {
    const c = canvasRef.current; const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const canvasRect = c.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const nextPoint = layer ? { x: layer.x, y: layer.y } : point(event);
    const scale = canvasRect.width / c.width || 1;
    const rawLeft = canvasRect.left - wrapRect.left + nextPoint.x * scale;
    const rawTop = canvasRect.top - wrapRect.top + nextPoint.y * scale;
    const left = Math.min(Math.max(0, rawLeft), Math.max(0, wrap.clientWidth - 244));
    const top = Math.min(Math.max(0, rawTop), Math.max(0, wrap.clientHeight - 48));
    if (layer) {
      setColor(layer.color);
      setTextSize(layer.size);
    }
    setTextEditor({ ...nextPoint, id: nextTextId.current++, layerId: layer?.id, left, top, scale, value: layer?.text || "", color: layer?.color || color, size: layer?.size || textSize });
    requestAnimationFrame(() => { textInputRef.current?.focus(); if (layer) textInputRef.current?.select(); });
  };

  const commitText = React.useCallback(() => {
    const editor = textEditor; const c = canvasRef.current;
    if (!editor || !c) return;
    if (finalizedTextIds.current.has(editor.id)) return;
    const shouldRestoreCanvasFocus = document.activeElement === textInputRef.current;
    finalizedTextIds.current.add(editor.id);
    setTextEditor(null);
    const value = editor.value.replace(/\s+$/, "");
    const currentLayers = textLayersRef.current;
    const nextLayers = value.trim()
      ? editor.layerId
        ? currentLayers.map((layer) => layer.id === editor.layerId ? clampTextLayer({ ...layer, x: editor.x, y: editor.y, text: value, color: editor.color, size: editor.size }) : layer)
        : [...currentLayers, clampTextLayer({ id: nextTextId.current++, x: editor.x, y: editor.y, text: value, color: editor.color, size: editor.size })]
      : editor.layerId
        ? currentLayers.filter((layer) => layer.id !== editor.layerId)
        : currentLayers;
    textLayersRef.current = nextLayers;
    setTextLayers(nextLayers);
    const nextActiveId = editor.layerId !== undefined
      ? (nextLayers.some((layer) => layer.id === editor.layerId) ? editor.layerId : null)
      : (nextLayers.length ? nextLayers[nextLayers.length - 1].id : null);
    activeTextIdRef.current = nextActiveId;
    setActiveTextId(nextActiveId);
    renderCanvas(nextLayers, nextActiveId);
    if (nextLayers !== currentLayers || editor.layerId !== undefined) snapshot(nextLayers);
    if (shouldRestoreCanvasFocus) requestAnimationFrame(() => canvasRef.current?.focus({ preventScroll: true }));
  }, [renderCanvas, snapshot, textEditor]);

  const cancelText = React.useCallback(() => {
    if (!textEditor) return;
    const shouldRestoreCanvasFocus = document.activeElement === textInputRef.current;
    finalizedTextIds.current.add(textEditor.id);
    setTextEditor(null);
    if (shouldRestoreCanvasFocus) requestAnimationFrame(() => canvasRef.current?.focus({ preventScroll: true }));
  }, [textEditor]);
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isComposingKey(event)) return;
      if (textEditor) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelText();
        return;
      }
      if (pendingRatio) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPendingRatio(null);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [cancelText, onCancel, pendingRatio, textEditor]);
  React.useLayoutEffect(() => {
    const input = textInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(150, Math.max(34, input.scrollHeight))}px`;
  }, [textEditor?.value, textEditor?.size]);
  React.useEffect(() => {
    if (!textEditor) return;
    const reposition = () => {
      const c = canvasRef.current;
      const wrap = wrapRef.current;
      if (!c || !wrap) return;
      const canvasRect = c.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const scale = canvasRect.width / c.width || 1;
      const rawLeft = canvasRect.left - wrapRect.left + textEditor.x * scale;
      const rawTop = canvasRect.top - wrapRect.top + textEditor.y * scale;
      const left = Math.min(Math.max(0, rawLeft), Math.max(0, wrap.clientWidth - 244));
      const top = Math.min(Math.max(0, rawTop), Math.max(0, wrap.clientHeight - 48));
      setTextEditor(current => current ? { ...current, left, top, scale } : current);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [textEditor?.id]);

  const requestRatio = (next: typeof RATIOS[number]) => {
    if (next.label === ratio.label) return;
    if (historyIndexRef.current > 0 || textLayersRef.current.length > 0 || Boolean(textEditor?.value.trim())) {
      setPendingRatio(next);
      return;
    }
    setRatio(next);
  };

  const confirmRatio = () => {
    if (!pendingRatio) return;
    cancelText();
    setPendingRatio(null);
    setRatio(pendingRatio);
  };

  const begin = (event: React.PointerEvent) => {
    event.preventDefault();
    canvasRef.current?.focus({ preventScroll: true });
    if (tool === "text") {
      if (textEditor) commitText();
      const target = point(event);
      const layer = findTextLayer(target);
      if (layer) {
        activeTextIdRef.current = layer.id;
        setActiveTextId(layer.id);
        setColor(layer.color);
        setTextSize(layer.size);
        setTextDrag({ id: layer.id, start: target, origin: { x: layer.x, y: layer.y }, moved: false });
        canvasRef.current?.setPointerCapture(event.pointerId);
        renderCanvas(textLayersRef.current, layer.id);
      } else {
        activeTextIdRef.current = null;
        setActiveTextId(null);
        renderCanvas(textLayersRef.current, null);
        openTextEditor(event);
      }
      return;
    }
    activeTextIdRef.current = null;
    setActiveTextId(null);
    renderCanvas(textLayersRef.current, null);
    canvasRef.current?.setPointerCapture(event.pointerId); drawing.current = true; last.current = point(event);
  };
  const move = (event: React.PointerEvent) => {
    if (textDrag) {
      const current = point(event);
      const dx = current.x - textDrag.start.x;
      const dy = current.y - textDrag.start.y;
      const nextLayers = textLayersRef.current.map((layer) => layer.id === textDrag.id ? clampTextLayer({ ...layer, x: textDrag.origin.x + dx, y: textDrag.origin.y + dy }) : layer);
      textLayersRef.current = nextLayers;
      setTextLayers(nextLayers);
      setTextDrag({ ...textDrag, moved: textDrag.moved || Math.abs(dx) + Math.abs(dy) > 1 });
      renderCanvas(nextLayers, textDrag.id);
      return;
    }
    if (!drawing.current || !last.current || tool === "text") return;
    const base = baseCanvasRef.current; const ctx = base?.getContext("2d"); if (!base || !ctx) return;
    const next = point(event); ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = size;
    // The reference is exported as JPEG, so erasing must restore the white
    // paper instead of creating transparent pixels that would turn black.
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(next.x, next.y); ctx.stroke(); ctx.restore(); last.current = next;
    renderCanvas(textLayersRef.current, activeTextIdRef.current);
  };
  const end = () => {
    if (textDrag) {
      if (textDrag.moved) snapshot(textLayersRef.current);
      setTextDrag(null);
      return;
    }
    if (!drawing.current) return;
    drawing.current = false; last.current = null; snapshot(textLayersRef.current);
  };
  const doubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== "text") return;
    event.preventDefault();
    if (textEditor) commitText();
    const target = point(event);
    const layer = findTextLayer(target);
    if (!layer) return;
    activeTextIdRef.current = layer.id;
    setActiveTextId(layer.id);
    setColor(layer.color);
    setTextSize(layer.size);
    openTextEditor(event, layer);
  };
  const restore = (index: number) => { const base = baseCanvasRef.current; const entry = history[index]; if (!base || !entry) return; cancelText(); const ctx = base.getContext("2d"); if (!ctx) return; ctx.putImageData(entry.image, 0, 0); const nextLayers = entry.textLayers.map((layer) => ({ ...layer })); textLayersRef.current = nextLayers; setTextLayers(nextLayers); activeTextIdRef.current = null; setActiveTextId(null); renderCanvas(nextLayers, null); historyIndexRef.current = index; setHistoryIndex(index); };
  const clear = () => { const base = baseCanvasRef.current; const ctx = base?.getContext("2d"); if (!base || !ctx) return; cancelText(); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, base.width, base.height); textLayersRef.current = []; setTextLayers([]); activeTextIdRef.current = null; setActiveTextId(null); renderCanvas([], null, false); snapshot([]); };
  const save = () => { const c = canvasRef.current; if (!c) return; if (textEditor) commitText(); renderCanvas(textLayersRef.current, null, false); onSave(c.toDataURL("image/jpeg", 0.9)); };
  const textTool = tool === "text";
  const removeActiveText = React.useCallback(() => {
    const id = activeTextIdRef.current;
    if (id === null) return;
    const nextLayers = textLayersRef.current.filter((layer) => layer.id !== id);
    textLayersRef.current = nextLayers;
    setTextLayers(nextLayers);
    activeTextIdRef.current = null;
    setActiveTextId(null);
    renderCanvas(nextLayers, null);
    snapshot(nextLayers);
  }, [renderCanvas, snapshot]);
  const switchTool = (nextTool: DrawingTool) => {
    if (nextTool === tool) return;
    if (textEditor) commitText();
    setTool(nextTool);
    if (nextTool !== "text") {
      activeTextIdRef.current = null;
      setActiveTextId(null);
      setTextDrag(null);
      renderCanvas(textLayersRef.current, null, false);
    }
  };
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (textEditor || target?.isContentEditable || target?.tagName === "TEXTAREA" || target?.tagName === "INPUT" || target?.closest("[data-handdraw-editor-control]")) return;
      if (tool === "text" && (event.key === "Backspace" || event.key === "Delete") && activeTextIdRef.current !== null) {
        event.preventDefault();
        removeActiveText();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [removeActiveText, textEditor, tool]);
  const chooseColor = (nextColor: string) => {
    setColor(nextColor);
    switchTool(textTool ? "text" : "brush");
    if (textEditor) {
      setTextEditor((current) => current ? { ...current, color: nextColor } : current);
      return;
    }
    const id = activeTextIdRef.current;
    if (!textTool || id === null) return;
    const nextLayers = textLayersRef.current.map((layer) => layer.id === id ? { ...layer, color: nextColor } : layer);
    textLayersRef.current = nextLayers;
    setTextLayers(nextLayers);
    renderCanvas(nextLayers, id);
    snapshot(nextLayers);
  };
  const changeTextSize = (value: number) => {
    setTextSize(value);
    if (textEditor) {
      setTextEditor((current) => current ? { ...current, size: value } : current);
      return;
    }
    const id = activeTextIdRef.current;
    if (!textTool || id === null) return;
    const nextLayers = textLayersRef.current.map((layer) => layer.id === id ? { ...layer, size: value } : layer);
    textLayersRef.current = nextLayers;
    setTextLayers(nextLayers);
    renderCanvas(nextLayers, id);
  };
  return <div className="handdraw-backdrop" role="dialog" aria-modal="true" aria-label="自由画板" data-canvas-management="">
    <section className="handdraw-modal" data-canvas-management="">
      <header><h2>自由画板</h2><button className="icon-button" aria-label="关闭" onClick={onCancel}><X size={18}/></button></header>
      <div className="handdraw-toolbar">
        <div className="handdraw-toolgroup"><button aria-pressed={tool === "brush"} className={tool === "brush" ? "active" : ""} onClick={() => switchTool("brush")}><Brush size={15}/>画笔</button><button aria-pressed={tool === "eraser"} className={tool === "eraser" ? "active" : ""} onClick={() => switchTool("eraser")}><Eraser size={15}/>橡皮擦</button><button aria-pressed={textTool} className={textTool ? "active" : ""} onClick={() => switchTool("text")}><Type size={15}/>文字</button></div>
        <div className="handdraw-colors" data-handdraw-editor-control="">{COLORS.map(c => <button key={c} aria-label={`颜色 ${c}`} className={color === c ? "active" : ""} style={{ background: c }} onClick={() => chooseColor(c)}/>)}</div>
        <label className="handdraw-size" data-handdraw-editor-control="">{textTool ? "字号" : "粗细"} <input type="range" min={textTool ? 12 : 2} max={textTool ? 96 : 48} value={textTool ? textSize : size} onChange={e => textTool ? changeTextSize(Number(e.target.value)) : setSize(Number(e.target.value))} onPointerUp={() => textTool && activeTextIdRef.current !== null && snapshot(textLayersRef.current)} onKeyUp={event => { if (textTool && activeTextIdRef.current !== null && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) snapshot(textLayersRef.current); }}/><span>{textTool ? textSize : size}</span></label>
        <div className="handdraw-ratios">{RATIOS.map(item => <button key={item.label} className={ratio.label === item.label ? "active" : ""} onClick={() => requestRatio(item)}>{item.label}</button>)}</div>
        <div className="handdraw-history"><button disabled={historyIndex <= 0} aria-label="撤销" title="撤销" onClick={() => restore(historyIndex - 1)}><Undo2 size={15}/></button><button disabled={historyIndex >= history.length - 1} aria-label="重做" title="重做" onClick={() => restore(historyIndex + 1)}><Redo2 size={15}/></button><button aria-label="清空" title="清空画布" onClick={clear}><Trash2 size={15}/></button></div>
      </div>
      {pendingRatio && <div className="handdraw-ratio-confirm" role="alert"><span>切换到 {pendingRatio.label} 会清空当前画布内容。</span><div><button onClick={confirmRatio}>继续切换</button><button onClick={() => setPendingRatio(null)}>取消</button></div></div>}
      <div className="handdraw-tip"><Info size={14}/>{textTool ? "点击空白处新增；单击文字拖动，双击编辑；Enter 完成，Shift+Enter 换行，Esc 取消，Delete 删除。" : "在画布上绘制参考图，保存后将自动添加到当前创作节点。"}</div>
      <div className={`handdraw-canvas-wrap${textTool ? " is-text-tool" : ""}`} ref={wrapRef}>
        <canvas ref={canvasRef} tabIndex={0} aria-label="手绘画布" onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={doubleClick}/>
        {textEditor && <textarea ref={textInputRef} rows={1} wrap="off" className={`handdraw-text-editor${textEditor.color === "#ffffff" ? " is-light" : ""}`} aria-label={textEditor.layerId ? "编辑画布文字" : "输入画布文字"} placeholder="输入文字" spellCheck={false} value={textEditor.value} onChange={e => setTextEditor(current => current ? { ...current, value: e.target.value } : current)} onBlur={event => { const nextFocus = event.relatedTarget as HTMLElement | null; if (nextFocus?.closest("[data-handdraw-editor-control]")) return; commitText(); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); cancelText(); } else if (event.key === "Enter" && !event.shiftKey && !isComposingKey(event.nativeEvent)) { event.preventDefault(); commitText(); } }} style={{ left: textEditor.left, top: textEditor.top, color: textEditor.color, fontFamily: canvasFont, fontSize: `${Math.max(12, Math.round(textEditor.size * textEditor.scale))}px`, lineHeight: 1.25 }} />}
      </div>
      <footer><span>关闭后将丢弃本次未保存的修改</span><div><button className="button" onClick={onCancel}>取消</button><button className="button primary" onClick={save}><Save size={14}/>保存</button></div></footer>
    </section>
  </div>;
}
