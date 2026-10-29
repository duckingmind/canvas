import { Layers2 } from "lucide-react";
import "./canvas-loading.css";

export default function CanvasLoadingIndicator({
  message = "正在准备你的画布",
}: {
  message?: string;
}) {
  return (
    <div
      className="canvas-loading-indicator"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="canvas-loading-brand">
        <span className="canvas-loading-mark" aria-hidden="true">
          <span className="canvas-loading-orbit canvas-loading-orbit-a" />
          <span className="canvas-loading-orbit canvas-loading-orbit-b" />
          <Layers2 size={23} />
        </span>
        <span className="canvas-loading-copy">
          <strong>Canvas</strong>
          <span>{message}</span>
        </span>
      </div>
      <span className="canvas-loading-track" aria-hidden="true"><span /></span>
    </div>
  );
}
