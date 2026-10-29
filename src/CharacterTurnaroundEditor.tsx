import React from "react";
import { Check, CircleUserRound, Image as ImageIcon, Info, Sparkles, X } from "lucide-react";
import { buildCharacterTurnaroundPrompt } from "./character-turnaround";

export type CharacterTurnaroundRequest = {
  name: string;
  notes: string;
  preserveStyle: boolean;
  includeAccessories: boolean;
  prompt: string;
  title: string;
};

type CharacterTurnaroundEditorProps = {
  source: string;
  title: string;
  titleId: string;
  busy: boolean;
  onCancel: () => void;
  onGenerate: (request: CharacterTurnaroundRequest) => void;
};

const VIEW_PLAN = [
  { label: "正面", detail: "全身" },
  { label: "侧面", detail: "右侧" },
  { label: "背面", detail: "全身" },
];

export default function CharacterTurnaroundEditor({ source, title, titleId, busy, onCancel, onGenerate }: CharacterTurnaroundEditorProps) {
  const [name, setName] = React.useState(() => title.replace(/\s*[·|｜].*$/, "").trim() || "当前角色");
  const [notes, setNotes] = React.useState("");
  const [preserveStyle, setPreserveStyle] = React.useState(true);
  const [includeAccessories, setIncludeAccessories] = React.useState(true);
  const prompt = React.useMemo(() => buildCharacterTurnaroundPrompt({ name, notes, preserveStyle, includeAccessories }), [name, notes, preserveStyle, includeAccessories]);

  const submit = () => {
    if (busy) return;
    const trimmedName = name.trim() || "当前角色";
    onGenerate({
      name: trimmedName,
      notes: notes.trim(),
      preserveStyle,
      includeAccessories,
      prompt: buildCharacterTurnaroundPrompt({ name: trimmedName, notes, preserveStyle, includeAccessories }),
      title: `${trimmedName} · 角色三视图`,
    });
  };

  return <>
    <header className="image-tool-modal-head character-turnaround-head">
      <div className="character-turnaround-heading">
        <CircleUserRound aria-hidden="true" />
        <div>
          <strong id={titleId}>角色三视图</strong>
          <small>提取角色设计，生成正、侧、背三视图的专业设定稿</small>
        </div>
      </div>
      <button type="button" aria-label="关闭角色三视图" disabled={busy} onClick={onCancel}><X size={17} aria-hidden="true" /></button>
    </header>

    <div className="character-turnaround-workspace">
      <section className="character-turnaround-stage" aria-label="三视图布局预览">
        <div className="character-turnaround-stage-topline">
          <span><ImageIcon size={13} aria-hidden="true" />参考角色</span>
          <small>将使用当前图片作为身份与造型参考</small>
        </div>
        <div className="character-turnaround-source-card">
          <img src={source} alt={`${title}三视图参考图`} draggable={false} />
          <span className="character-turnaround-source-badge">REFERENCE</span>
        </div>
        <div className="character-turnaround-plan" aria-label="输出视角">
          {VIEW_PLAN.map((view, index) => <div className="character-turnaround-plan-card" key={view.label}>
            <span className="character-turnaround-plan-index">{index + 1}</span>
            <div className="character-turnaround-silhouette" aria-hidden="true"><span /></div>
            <strong>{view.label}</strong>
            <small>{view.detail}</small>
          </div>)}
        </div>
        <div className="character-turnaround-stage-footer">
          <span>单张设定表 · 三个等宽视角</span>
          <strong>正面 / 侧面 / 背面</strong>
        </div>
      </section>

      <aside className="character-turnaround-inspector">
        <div className="character-turnaround-inspector-title"><strong>角色设定</strong><span>保持身份一致</span></div>
        <label className="character-turnaround-field">
          <span>角色名称</span>
          <input data-primary-input type="text" value={name} maxLength={80} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="例如：林默" />
        </label>
        <label className="character-turnaround-field character-turnaround-notes">
          <span>补充约束</span>
          <textarea value={notes} maxLength={800} disabled={busy} onChange={(event) => setNotes(event.target.value)} placeholder="补充年龄、身高、服装材质、标志配饰或需要固定的细节……" />
          <small>{notes.length}/800</small>
        </label>
        <fieldset className="character-turnaround-rules" disabled={busy}>
          <legend>一致性规则</legend>
          <label><input type="checkbox" checked={preserveStyle} onChange={(event) => setPreserveStyle(event.target.checked)} /><span>保留参考图画风与角色气质</span></label>
          <label><input type="checkbox" checked={includeAccessories} onChange={(event) => setIncludeAccessories(event.target.checked)} /><span>保留服装、配饰与身份道具</span></label>
          <label><input type="checkbox" checked readOnly /><span>站立中性姿势、完整显示全身</span></label>
        </fieldset>
        <div className="character-turnaround-contract">
          <div><Check size={13} aria-hidden="true" /><strong>输出契约</strong></div>
          <p>一张专业设定表，三个等宽竖向区域，视角顺序固定为正面、右侧面、背面。</p>
          <small>不会覆盖当前图片，生成结果会作为新的图片创作节点保留。</small>
        </div>
        <details className="character-turnaround-prompt-preview">
          <summary>查看生成约束</summary>
          <p>{prompt}</p>
        </details>
        <div className="character-turnaround-tip"><Info size={13} aria-hidden="true" /><span>三视图用于后续角色一致性参考，建议先确认发型、服装和标志物。</span></div>
      </aside>
    </div>

    <footer className="character-turnaround-footer">
      <span>将创建图片创作节点并引用当前图片</span>
      <div>
        <button type="button" className="button" disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" className="generate-button" disabled={busy} onClick={submit}><Sparkles size={14} aria-hidden="true" />生成三视图</button>
      </div>
    </footer>
  </>;
}

