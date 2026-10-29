import { CircleAlert, Copy, RefreshCw } from "lucide-react";

/** Keep the task state and its next safe action visible on the canvas. */
export default function TaskFailureNotice({ mediaLabel, title, advice, onRetry, retryLabel, onCreateNewTask }: {
  mediaLabel: string;
  title?: string;
  advice?: string;
  onRetry?: () => void;
  retryLabel?: string;
  onCreateNewTask?: () => void;
}) {
  return <div className="creation-placeholder is-failed">
    <div className="creation-failure-summary" role="status" aria-live="polite" aria-atomic="true">
      <CircleAlert size={26} aria-hidden="true" />
      <span>{title || `${mediaLabel}任务未完成`}</span>
      <p className="creation-failure-help">{advice || "可修改输入后重新生成。"}</p>
    </div>
    {(onRetry || onCreateNewTask) && <div className="creation-failure-actions">
      {onRetry && <button
        type="button"
        className="creation-failure-retry"
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onRetry(); }}
      ><RefreshCw size={13} aria-hidden="true" />{retryLabel || "重新生成"}</button>}
      {onCreateNewTask && <button
        type="button"
        className="creation-failure-retry is-secondary"
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onCreateNewTask(); }}
      ><Copy size={13} aria-hidden="true" />复制为新任务</button>}
    </div>}
  </div>;
}
