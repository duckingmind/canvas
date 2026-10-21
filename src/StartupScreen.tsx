import type { ReactNode } from "react";
import {
  ArrowRight,
  ChevronDown,
  CircleAlert,
  Cloud,
  History,
  Layers2,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import "./platform-gate.css";

type StartupAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
};

export type StartupScreenProps = {
  title: string;
  description: string;
  status?: string;
  busy?: boolean;
  message?: string;
  credentialFields?: ReactNode;
  showBenefits?: boolean;
  action?: StartupAction;
  secondaryAction?: StartupAction;
  hint?: string;
  technicalDetails?: string;
  compact?: boolean;
  className?: string;
};

export default function StartupScreen({
  title,
  description,
  status,
  busy = false,
  message,
  credentialFields,
  showBenefits = false,
  action,
  secondaryAction,
  hint,
  technicalDetails,
  compact = false,
  className = "",
}: StartupScreenProps) {
  return (
    <div className={`platform-gate-card${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`} tabIndex={-1}>
      <div className="platform-gate-brand">
        <Layers2 size={20} aria-hidden="true" />
        <span>
          Canvas <span className="platform-gate-brand-divider">/</span>{" "}
          无限画布
        </span>
      </div>
      <div className="platform-gate-heading">
        <h1>{title}</h1>
        <p id="platform-gate-description">{description}</p>
      </div>
      {showBenefits && (
        <ul className="platform-gate-benefits" aria-label="启动后可使用的功能">
          <li>
            <Sparkles size={17} aria-hidden="true" />
            <span>模型创作</span>
          </li>
          <li>
            <History size={17} aria-hidden="true" />
            <span>创作历史</span>
          </li>
          <li>
            <Cloud size={17} aria-hidden="true" />
            <span>云端画布</span>
          </li>
        </ul>
      )}
      {message && (
        <div className="platform-gate-error" role="alert">
          <CircleAlert size={17} aria-hidden="true" />
          <p>{message}</p>
        </div>
      )}
      {status && (
        <div className="platform-gate-progress" role="status">
          {busy && (
            <LoaderCircle
              className="platform-gate-spinner"
              size={18}
              aria-hidden="true"
            />
          )}
          <span>{status}</span>
        </div>
      )}
      {credentialFields}
      {action && (
        <button
          className="platform-gate-primary"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.icon}
          {action.label}
          {action.trailing ?? (!action.icon ? <ArrowRight size={18} aria-hidden="true" /> : null)}
        </button>
      )}
      {secondaryAction && (
        <button
          className="platform-gate-secondary"
          onClick={secondaryAction.onClick}
          disabled={secondaryAction.disabled}
        >
          {secondaryAction.icon}
          {secondaryAction.label}
        </button>
      )}
      {hint && (
        <p className="platform-gate-hint" role="status">
          {hint}
        </p>
      )}
      {technicalDetails && (
        <details className="platform-gate-details">
          <summary>
            查看技术详情
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <p>{technicalDetails}</p>
        </details>
      )}
    </div>
  );
}
