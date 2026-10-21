import type { PromptSegment } from "./canvas-types";

const MAX_PROMPT_LENGTH = 20_000;

export function normalizePromptSegments(value: unknown, fallbackText = "", maxLength = MAX_PROMPT_LENGTH): PromptSegment[] {
  const limit = Math.max(0, Math.floor(maxLength));
  if (!Array.isArray(value)) return fallbackText ? [{ type: "text", text: fallbackText.slice(0, limit) }] : [];
  const result: PromptSegment[] = [];
  let length = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const segment = item as Record<string, unknown>;
    if (segment.type === "text" && typeof segment.text === "string") {
      const text = segment.text.slice(0, Math.max(0, limit - length));
      if (text) result.push({ type: "text", text });
      length += text.length;
    } else if (segment.type === "reference" && typeof segment.referenceId === "string" && typeof segment.label === "string") {
      const referenceId = segment.referenceId.trim().slice(0, 120);
      const label = segment.label.trim().slice(0, 160);
      const segmentLength = label.length + 1;
      if (!referenceId || !label || length + segmentLength > limit) continue;
      result.push({ type: "reference", referenceId, label });
      length += segmentLength;
    }
    if (length >= limit) break;
  }
  // Older documents may contain an empty or invalid promptSegments field
  // alongside a valid legacy text value. Preserve that text during recovery.
  return result.length || !fallbackText
    ? result
    : [{ type: "text", text: fallbackText.slice(0, limit) }];
}

export function promptSegmentsText(segments: readonly PromptSegment[]): string {
  return segments.map((segment) => segment.type === "text" ? segment.text : `@${segment.label}`).join("");
}

export function promptSegmentsHaveReferences(segments: readonly PromptSegment[]): boolean {
  return segments.some((segment) => segment.type === "reference");
}

