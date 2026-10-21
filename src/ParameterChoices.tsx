import React from "react";

export function ParameterChoices({ label, values, value, onChange, render, ratios = false }: {
  label: string;
  values: string[];
  value?: string;
  onChange: (value: string) => void;
  render?: (value: string) => React.ReactNode;
  ratios?: boolean;
}) {
  if (!values.length) return null;
  return <section className={`context-parameter-section${ratios ? " is-ratios" : ""}`}>
    <div className="context-choice-label">{label}</div>
    <div className={ratios ? "context-ratio-grid" : "context-choice-row"} role="radiogroup" aria-label={label}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
        const index = event.key === "Home" ? 0 : event.key === "End" ? values.length - 1
          : (current + direction + values.length) % values.length;
        onChange(values[index]);
        buttons[index]?.focus();
      }}>
      {values.map((option, index) => <button key={option} type="button" role="radio"
        aria-checked={option === value} tabIndex={option === value || (!values.includes(value || "") && index === 0) ? 0 : -1}
        className={option === value ? "is-selected" : ""} onClick={() => onChange(option)}>
        {ratios && <span className="context-ratio-icon"><RatioMark value={option} /></span>}
        <span>{render ? render(option) : option}</span>
      </button>)}
    </div>
  </section>;
}

export function RatioMark({ value }: { value?: string }) {
  const [width, height] = (value || "1:1").split(/[:x]/).map(Number);
  const ratio = width > 0 && height > 0 ? width / height : 1;
  return <span className="context-ratio-mark" aria-hidden="true" style={{
    width: ratio >= 1 ? 16 : 16 * ratio,
    height: ratio >= 1 ? 16 / ratio : 16,
  }} />;
}
