import { Sparkles, Workflow } from "lucide-react";
import { noteTextStats, noteTextSummary } from "./note-node";

export { noteTextStats, noteTextSummary } from "./note-node";

export type NoteNodePreviewProps = {
  text: string;
  incomingCount: number;
  outgoingCount: number;
  onEdit: () => void;
  onCreate: () => void;
};

export default function NoteNodePreview({
  text,
  incomingCount,
  outgoingCount,
  onEdit,
  onCreate,
}: NoteNodePreviewProps) {
  const summary = noteTextSummary(text);
  const stats = noteTextStats(text);
  const linked = incomingCount + outgoingCount > 0;
  return (
    <div className={`note-card${summary ? "" : " is-empty"}`}>
      <div className="note-card-head">
        <span className="note-card-flow">
          <Workflow size={12} />
          {linked ? `${incomingCount} 入 · ${outgoingCount} 出` : "可连接到创作"}
        </span>
      </div>
      <div className="note-card-body">
        <p>{summary || "双击记录想法、分镜、角色设定或提示词片段。"}</p>
      </div>
      <div className="note-card-foot">
        <span>{stats.chars ? `${stats.chars} 字 · ${stats.lines || 1} 行` : "空文本"}</span>
        <div>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onEdit(); }}
          >
            编辑
          </button>
          <button
            type="button"
            className="primary"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onCreate(); }}
          >
            <Sparkles size={12} />
            创作
          </button>
        </div>
      </div>
    </div>
  );
}
