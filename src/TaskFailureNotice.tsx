import { CircleAlert } from "lucide-react";

/** A single failure summary; provider details stay in the diagnostic record. */
export default function TaskFailureNotice({ mediaLabel, title, advice }: {
  mediaLabel: string;
  title: string;
  advice: string;
}) {
  return <div className="creation-placeholder is-failed">
    <div className="creation-failure-summary" role="status" aria-live="polite" aria-atomic="true">
      <CircleAlert size={30} aria-hidden="true" />
      <span>{mediaLabel}生成失败</span>
      {title !== "生成失败" && title !== "生成任务未完成" && <small>{title}</small>}
    </div>
    <p className="creation-failure-help">{advice}</p>
  </div>;
}
