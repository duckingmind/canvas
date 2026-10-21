import React from "react";
import { Check, CircleAlert, Clock3, Film, Image, LoaderCircle, LocateFixed, Pause, RefreshCw, X } from "lucide-react";
import "./task-details.css";
import { isComposingKey } from "./keyboard";
import { mediaTaskUserFailure, type MediaInputSummary } from "./shared/media-diagnostics.ts";
import { mediaTaskPublicLabel, mediaTaskPublicState, mediaTaskState } from "./shared/media-task-state.ts";
import { videoTaskControls } from "./video-task-state";
import { isCosImageURL, isThumbnailURL } from "./image-variants";

type Task = {
  id: string;
  title: string;
  mediaType?: "image" | "video" | "audio";
  status?: string;
  taskId?: string;
  taskPrompt?: string;
  error?: string;
  taskDiagnostic?: { code?: string; requestId?: string; status?: string; phase?: string; assetStatus?: string; createdAt?: string; summary?: MediaInputSummary; supplierConfirmation?: { state?: string } };
  videoPollingPaused?: boolean;
  videoPollingReason?: "user" | "reconciliation";
  cancelRequested?: boolean;
};
type Result = { id: string; title: string; image?: string; imageThumbnail?: string; video?: string; videoContentUrl?: string; resultBatchId?: string };

function taskResultThumbnail(result: Result): string | undefined {
  if (result.imageThumbnail) return result.imageThumbnail;
  // Do not make the task panel a hidden full-resolution fetch for a legacy
  // COS result that has not yet received its server-signed preview.
  if (result.image && (!isCosImageURL(result.image) || isThumbnailURL(result.image))) return result.image;
  return undefined;
}

export default function TaskDetails({ node, active, pending, canceling, unavailable, results, onClose, onEdit, onResume, onPause, onCancel, onPreview, onLocate }: {
  node: Task;
  active: boolean;
  pending: boolean;
  canceling: boolean;
  unavailable: boolean;
  results: Result[];
  onClose: () => void;
  onEdit: () => void;
  onResume: () => void;
  onPause: () => void;
  onCancel: () => void;
  onPreview: (id: string) => void;
  onLocate: (id: string) => void;
}) {
  const panel = React.useRef<HTMLElement>(null);
  React.useEffect(() => { panel.current?.focus({ preventScroll: true }); }, [node.id]);
  const video = node.mediaType === "video";
  const publicState = mediaTaskPublicState({
    status: node.taskDiagnostic?.status || node.status,
    code: node.taskDiagnostic?.code,
    phase: node.taskDiagnostic?.phase || (node.videoPollingReason === "reconciliation" ? "reconciling" : undefined),
    assetStatus: node.taskDiagnostic?.assetStatus || (node.status === "completed" ? "ready" : undefined),
    supplierConfirmationState: node.taskDiagnostic?.supplierConfirmation?.state,
  });
  const completed = publicState === "succeeded";
  const taskState = mediaTaskState({ status: node.taskDiagnostic?.status || node.status, code: node.taskDiagnostic?.code, phase: node.taskDiagnostic?.phase || (node.videoPollingReason === "reconciliation" ? "reconciling" : undefined), assetStatus: node.taskDiagnostic?.assetStatus, message: node.error, supplierConfirmationState: node.taskDiagnostic?.supplierConfirmation?.state });
  const observedStatus = (taskState.status || "").toLowerCase();
  const cancelled = ["cancelled", "canceled"].includes(observedStatus);
  const failed = publicState === "failed" && !cancelled;
  const cancellationPending = !completed && !taskState.isTerminal && (canceling || node.cancelRequested || ["cancel_requested", "cancel_pending", "canceling"].includes(observedStatus));
  const supplierUnconfirmed = ["unconfirmed", "unconfirmed_after_timeout"].includes(node.taskDiagnostic?.supplierConfirmation?.state?.trim().toLowerCase() || "");
  const resultUnknown = !taskState.isTerminal && (taskState.requiresReconciliation || node.videoPollingReason === "reconciliation" || supplierUnconfirmed);
  const reconciliationExpired = taskState.requiresReconciliation && taskState.isTerminal;
  const videoControls = videoTaskControls(node, active);
  const diagnosis = mediaTaskUserFailure({ code: node.taskDiagnostic?.code, message: node.error, status: node.taskDiagnostic?.status || node.status, phase: node.taskDiagnostic?.phase, assetStatus: node.taskDiagnostic?.assetStatus, supplierConfirmationState: node.taskDiagnostic?.supplierConfirmation?.state, referenceCount: node.taskDiagnostic?.summary?.reference_count });
  const latestBatchId = [...results].reverse().find(result => result.resultBatchId)?.resultBatchId;
  const latestResults = latestBatchId ? results.filter(result => result.resultBatchId === latestBatchId) : results;
  const historyResults = latestBatchId ? results.filter(result => result.resultBatchId !== latestBatchId) : [];
  const resumeLabel = "继续查看";
  const resumeAdvice = "点击“继续查看”更新进度。";
  const status = mediaTaskPublicLabel(publicState);
  const hint = cancelled ? "平台已确认任务取消，可以继续编辑或重新生成。"
    : completed ? "结果已保存在画布中，可预览或定位。"
      : reconciliationExpired ? diagnosis.advice
        : failed ? diagnosis.advice
          : cancellationPending ? (active ? "正在停止生成。" : `正在停止生成，进度暂未更新。${resumeAdvice}`)
          : pending && !active ? `任务仍在处理中。${resumeAdvice}`
            : resultUnknown ? (active ? "任务仍在处理中，完成后会自动更新结果。" : `进度暂未更新。${resumeAdvice}`)
              : active ? "系统正在处理这次生成，你可以继续编辑画布。" : "查看失败原因，修改输入后重试。";
  return <aside ref={panel} tabIndex={-1} className="inspector generation-task-panel" aria-label="生成状态"
    onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (!isComposingKey(event.nativeEvent) && event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <div className="panel-head"><strong>{node.mediaType === "video" ? <Film size={16} /> : <Image size={16} />}生成状态</strong><button className="icon-button" aria-label="关闭生成状态" onClick={onClose}><X size={16} /></button></div>
    <div className="generation-task-body">
      <h3>{node.title}</h3>
      <div className={`generation-task-state ${completed ? "is-completed" : publicState === "failed" ? "is-failed" : ""}`} role="status">
        <div>{cancelled ? <X size={16} /> : completed ? <Check size={16} /> : publicState === "failed" ? <CircleAlert size={16} /> : publicState === "running" ? <LoaderCircle size={16} className="spin" /> : <Clock3 size={16} />}<strong>{status}</strong></div>
        <p>{hint}</p>
      </div>
      {node.error && pending && !active && !taskState.isTerminal && <section className="generation-task-notice" role="status">
        <p>{node.videoPollingReason === "user" ? "已暂停进度更新，后台任务不受影响。" : "暂时未能更新进度，连接恢复后可继续查看。"}</p><p>{resumeAdvice}</p>
      </section>}
      {node.error && !cancelled && !resultUnknown && !reconciliationExpired && !pending && <section className="generation-task-error" role="alert">
        <strong>{diagnosis.title}</strong><p>{diagnosis.advice}</p>
      </section>}
      {pending && !completed && !taskState.isTerminal && <div className="generation-task-controls">
        {!active && <button className="button secondary" disabled={unavailable || canceling} onClick={onResume}><RefreshCw size={14} />{resumeLabel}</button>}
        {videoControls.canPause && <button className="button secondary" onClick={onPause}><Pause size={14} />暂停更新</button>}
        {videoControls.canCancel && <button className="button secondary" disabled={unavailable || Boolean(cancellationPending)} onClick={onCancel}>{cancellationPending ? "正在取消…" : "停止生成"}</button>}
      </div>}
      {node.taskPrompt && <details className="generation-task-input"><summary>本次提交的画面描述</summary><p>{node.taskPrompt}</p></details>}
      {results.length > 0 && <section className="generation-task-results" aria-label="生成结果">
        <h4>{completed ? (latestBatchId ? "最新批次" : "生成结果") : "历史结果"}<span>{latestResults.length}</span></h4>
        {latestResults.map(result => <div className="generation-task-result" key={result.id}>
          <button className="generation-task-preview" onClick={() => onPreview(result.id)} aria-label={`预览结果 · ${result.title}`}>
            {taskResultThumbnail(result) ? <img src={taskResultThumbnail(result)} alt="" /> : result.image ? <span className="generation-task-video"><LoaderCircle size={20} className="spin" /></span> : <span className="generation-task-video"><Film size={20} /></span>}
            <span>{result.title}</span>
          </button>
          <button className="icon-button" aria-label={`定位结果 · ${result.title}`} onClick={() => onLocate(result.id)}><LocateFixed size={15} /></button>
        </div>)}
        {historyResults.length > 0 && <details className="generation-task-history">
          <summary>历史批次 <span>{historyResults.length}</span></summary>
          {historyResults.map(result => <div className="generation-task-result" key={result.id}>
            <button className="generation-task-preview" onClick={() => onPreview(result.id)} aria-label={`预览结果 · ${result.title}`}>
              {taskResultThumbnail(result) ? <img src={taskResultThumbnail(result)} alt="" /> : result.image ? <span className="generation-task-video"><LoaderCircle size={20} className="spin" /></span> : <span className="generation-task-video"><Film size={20} /></span>}
              <span>{result.title}</span>
            </button>
            <button className="icon-button" aria-label={`定位结果 · ${result.title}`} onClick={() => onLocate(result.id)}><LocateFixed size={15} /></button>
          </div>)}
        </details>}
      </section>}
    </div>
    <div className="generation-task-footer"><button className="button secondary" onClick={onEdit}>{pending || active || resultUnknown ? "编辑下次输入" : completed || cancelled || reconciliationExpired ? "继续编辑" : "修改内容"}</button></div>
  </aside>;
}
