const whitespace = /\s+/g;

export function noteTextSummary(text: string, limit = 220): string {
  const normalized = text.replace(whitespace, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function noteTextStats(text: string) {
  const normalized = text.replace(whitespace, "").trim();
  const lines = text.trim() ? text.trim().split(/\n+/).length : 0;
  return {
    chars: normalized.length,
    lines,
  };
}
