import React from "react";
import { Download, Trash2 } from "lucide-react";
import {
  canvasDiagnosticsPersistenceAvailable,
  clearCanvasDiagnostics,
  exportCanvasDiagnostics,
  readCanvasDiagnostics,
} from "./client-diagnostics.ts";

function downloadDiagnostics() {
  const blob = new Blob([JSON.stringify(exportCanvasDiagnostics(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `canvas-diagnostics-${new Date().toISOString().replaceAll(":", "-")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function ClientDiagnosticsPanel() {
  const [count, setCount] = React.useState(() => readCanvasDiagnostics().length);
  const [message, setMessage] = React.useState("");
  const persistent = canvasDiagnosticsPersistenceAvailable();

  const refreshCount = () => setCount(readCanvasDiagnostics().length);
  const clear = () => {
    if (!window.confirm("清除当前账户保留的本地诊断日志？")) return;
    clearCanvasDiagnostics();
    refreshCount();
    setMessage("本地诊断日志已清除。");
  };
  const exportLogs = () => {
    downloadDiagnostics();
    setMessage("诊断日志已导出。");
  };

  React.useEffect(() => {
    const timer = window.setInterval(refreshCount, 3000);
    return () => window.clearInterval(timer);
  }, []);

  return <section className="save-details canvas-diagnostics">
    <h3>本地诊断日志</h3>
    <p>当前账户保留 {count} 条，最多 500 条并保留 7 天。仅存于此浏览器，不会自动上传；导出后可附在问题反馈中。</p>
    <p>{persistent ? "本地存储可用。" : "当前浏览器存储不可用，日志仅暂存于页面内存，关闭页面后会丢失。"}</p>
    <div className="panel-action-row">
      <button className="button" type="button" onClick={exportLogs}><Download size={14} aria-hidden="true" />导出 JSON</button>
      <button className="button" type="button" onClick={clear} disabled={count === 0}><Trash2 size={14} aria-hidden="true" />清除日志</button>
    </div>
    <span className="sr-only" role="status">{message}</span>
  </section>;
}
