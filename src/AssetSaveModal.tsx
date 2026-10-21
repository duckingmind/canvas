import React from "react";
import { createPortal } from "react-dom";
import { Check, Folder, LoaderCircle, LockKeyhole, Plus, Tag, X } from "lucide-react";
import { AssetKindIcon, type AssetPreview } from "./AssetLibraryPanel";
import CanvasMediaPlayer from "./CanvasMediaPlayer";
import { categoryLabels, kindLabels, normalizeAssetTags, type AssetCategory, type CanvasAsset } from "./asset-library";
import { imagePreviewURL } from "./image-variants";
import "./asset-save.css";

export type AssetSaveModalProps = {
  value: CanvasAsset;
  editing?: boolean;
  busy: boolean;
  error?: string;
  preview?: AssetPreview;
  knownTags?: string[];
  knownFolders?: string[];
  onNotice?: (text: string, action?: { label: string; run: () => void }) => void;
  onSave: (asset: CanvasAsset) => void;
  onClose: () => void;
};

const categories: AssetCategory[] = ["person", "scene", "object", "style", "sound", "other", "prompt"];

/** Keep the editable draft mounted until the parent confirms the save. */
export default function AssetSaveModal({ value, editing = false, busy, error, preview, knownTags = [], knownFolders = [], onNotice, onSave, onClose }: AssetSaveModalProps) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const nameInput = React.useRef<HTMLInputElement>(null);
  const [name, setName] = React.useState(value.name);
  const [folder, setFolder] = React.useState(value.folder || "");
  const [category, setCategory] = React.useState<AssetCategory>(value.kind !== "prompt" && value.category === "prompt" ? "other" : value.category);
  const [tags, setTags] = React.useState(value.tags);
  const [tagInput, setTagInput] = React.useState("");
  const [validationError, setValidationError] = React.useState("");
  const [previewFailed, setPreviewFailed] = React.useState(false);
  const id = React.useId();
  const titleId = `${id}-title`, nameId = `${id}-name`, folderId = `${id}-folder`, tagId = `${id}-tag`, errorId = `${id}-error`;
  const tagSuggestions = [...new Set(knownTags)].filter(tag => !tags.some(selected => selected.toLocaleLowerCase() === tag.toLocaleLowerCase()) && Array.from(tag).length <= 40 && !/^(app|type|source):/i.test(tag) && tag.toLocaleLowerCase().includes(tagInput.trim().toLocaleLowerCase())).slice(0, 10);
  const folderSuggestions = [...new Set(knownFolders)].filter(Boolean).sort();
  const image = value.kind === "image" ? imagePreviewURL(preview?.url, preview?.thumbnailUrl) : value.kind === "video" ? preview?.poster : undefined;
  const promptText = value.source.type === "text" ? value.source.text : value.prompt;
  const isLocal = value.source.type === "local";

  React.useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    nameInput.current?.focus();
    nameInput.current?.select();
    return () => {
      element?.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  React.useEffect(() => { setPreviewFailed(false); }, [preview?.url, preview?.poster]);
  React.useEffect(() => () => preview?.release?.(), [preview?.release]);
  const lastNotifiedError = React.useRef("");
  React.useEffect(() => {
    if (!error) {
      lastNotifiedError.current = "";
      return;
    }
    if (error === lastNotifiedError.current) return;
    lastNotifiedError.current = error;
    onNotice?.(error);
  }, [error, onNotice]);

  function withTag(input: string, current = tags): string[] | null {
    const tag = input.trim();
    try { return normalizeAssetTags(tag ? [...current, tag] : current); }
    catch (error) { setValidationError(error instanceof Error ? error.message : "标签格式无效。"); return null; }
  }
  function addTag(input: string) {
    setValidationError("");
    const next = withTag(input);
    if (!next) return;
    setTags(next);
    setTagInput("");
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setValidationError("");
    if (!name.trim()) { setValidationError("请填写资产名称。"); nameInput.current?.focus(); return; }
    if (Array.from(name.trim()).length > 100) { setValidationError("资产名称最多 100 个字符。"); nameInput.current?.focus(); return; }
    if (Array.from(folder.trim()).length > 100) { setValidationError("文件夹名称最多 100 个字符。"); return; }
    const next = withTag(tagInput);
    if (!next) return;
    setTags(next);
    setTagInput("");
    onSave({ ...value, name: name.trim(), folder: folder.trim(), category, tags: next });
  }

  return createPortal(<dialog
    ref={dialog}
    className="asset-save-modal"
    aria-labelledby={titleId}
    aria-describedby={validationError ? errorId : undefined}
    aria-busy={busy || undefined}
    data-canvas-management
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || busy) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}
    onKeyDown={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()}
  >
    <form onSubmit={submit}>
      <header className="asset-save-header"><h2 id={titleId}>{editing ? "编辑资产" : "保存资产"}</h2><button type="button" className="asset-save-close" aria-label="关闭资产弹窗" disabled={busy} onClick={onClose}><X size={20} /></button></header>
      <div className="asset-save-body">
        <aside className="asset-save-preview">
          <div className={`asset-save-preview-media is-${value.kind}`}>
            {image && !previewFailed ? <img src={image} alt={value.name} draggable={false} onError={() => setPreviewFailed(true)} />
              : value.kind === "prompt" ? <p>{promptText || value.name}</p>
                : <AssetKindIcon kind={value.kind} size={40} />}
            <span className="asset-save-media-kind"><AssetKindIcon kind={value.kind} size={12} />{kindLabels[value.kind]}</span>
          </div>
          <strong title={name}>{name || "未命名资产"}</strong>
          {value.kind === "audio" && preview?.url && !previewFailed && <CanvasMediaPlayer kind="audio" src={preview.url} label="资产音频预览" preload="none" onError={() => setPreviewFailed(true)} />}
          {preview?.availability === "local-missing" ? <p className="asset-save-preview-note">本机素材当前不可用，请在保存它的设备打开。</p>
            : previewFailed || preview?.availability === "unavailable" ? <p className="asset-save-preview-note">{preview?.message || "预览暂不可用，仍可保存资产信息。"}</p>
              : isLocal && <p className="asset-save-preview-note">本机素材，原文件仅保存在当前设备。</p>}
        </aside>
        <fieldset className="asset-save-fields" disabled={busy}>
          <div className="asset-save-field">
            <label htmlFor={nameId}>资产名称 <span aria-hidden="true">*</span></label>
            <div className="asset-save-input-wrap"><input ref={nameInput} id={nameId} required maxLength={100} value={name} onChange={event => { setName(Array.from(event.target.value).slice(0, 100).join("")); setValidationError(""); }} placeholder="为资产取个名字" aria-invalid={validationError && !name.trim() ? true : undefined} aria-describedby={`${nameId}-count`} /><span id={`${nameId}-count`} aria-live="polite">{Array.from(name).length}/100</span></div>
          </div>
          <div className="asset-save-field">
            <label htmlFor={folderId}>保存位置</label>
            <div className="asset-save-input-wrap"><Folder size={15} /><input id={folderId} maxLength={100} list={`${id}-folders`} value={folder} onChange={event => { setFolder(Array.from(event.target.value).slice(0, 100).join("")); setValidationError(""); }} placeholder="默认文件夹" aria-describedby={`${folderId}-hint`} /><datalist id={`${id}-folders`}>{folderSuggestions.map(value => <option key={value} value={value} />)}</datalist></div>
            <p className="asset-save-hint" id={`${folderId}-hint`}>选择已有文件夹，或输入新文件夹名称。</p>
          </div>
          <div className="asset-save-field">
            <span className="asset-save-label" id={`${id}-category`}>资产分类</span>
            <div className="asset-save-categories" role="group" aria-labelledby={`${id}-category`}>
              {categories.filter(item => item !== "prompt" || value.kind === "prompt").map(item => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{category === item && <Check size={12} />}{categoryLabels[item]}</button>)}
            </div>
          </div>
          <div className="asset-save-field">
            <label htmlFor={tagId}>自定义标签 <small aria-live="polite">{tags.length}/20</small></label>
            {!!tags.length && <div className="asset-save-selected-tags">{tags.map(tag => <span key={tag}><Tag size={11} /><span>{tag}</span><button type="button" aria-label={`移除标签 ${tag}`} onClick={() => { setTags(tags.filter(value => value !== tag)); setValidationError(""); }}><X size={12} /></button></span>)}</div>}
            <div className="asset-save-tag-entry"><input id={tagId} maxLength={40} value={tagInput} placeholder="输入标签，按回车添加" onChange={event => { setTagInput(Array.from(event.target.value).slice(0, 40).join("")); setValidationError(""); }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); addTag(tagInput); } }} /><button type="button" aria-label="添加自定义标签" disabled={!tagInput.trim() || tags.length >= 20} onClick={() => addTag(tagInput)}><Plus size={16} /></button></div>
            {!!tagSuggestions.length && <div className="asset-save-tag-suggestions" aria-label="已有标签">{tagSuggestions.map(tag => <button key={tag} type="button" disabled={tags.length >= 20} onClick={() => addTag(tag)}><Plus size={11} />{tag}</button>)}</div>}
          </div>
          <div className="asset-save-source">
            <span><LockKeyhole size={12} />系统来源</span>
            <div><span>Canvas</span><span>{kindLabels[value.kind]}</span>{isLocal ? <span>本机素材</span> : value.systemTags?.includes("source:generated") || value.source.type === "task" ? <span>生成内容</span> : null}</div>
            <p>来源由系统记录，自定义标签不会改变资产归属。</p>
          </div>
        </fieldset>
      </div>
      {validationError && <div className="asset-save-error" role="alert" id={errorId}>{validationError}</div>}
      <footer className="asset-save-footer"><span>保存后可在 Canvas 的其他画布中使用</span><div><button type="button" className="asset-save-cancel" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="asset-save-submit" disabled={busy}>{busy ? <><LoaderCircle size={14} className="spin" />保存中…</> : editing ? "保存修改" : "保存资产"}</button></div></footer>
    </form>
  </dialog>, document.body);
}
