import type { PromptSegment } from "./canvas-types";

const MAX_PROMPT_LENGTH = 20_000;
const UUID_LABEL = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const INTERNAL_KEY_LABEL = /^(?:node|asset|task|reference|ref)[_:#-][a-z\d][a-z\d_-]{7,}$/i;
const GENERIC_IMAGE_FILENAME = /^(?:image|img|picture|photo)(?:[\s_-]?\d+)?\.(?:png|jpe?g|webp|gif|avif)$/i;

/** A filename that adds no context beyond the thumbnail itself. */
export function isGenericImageFilename(label: string): boolean {
  const filename = label.trim().split(/[\\/]/).at(-1) || "";
  return GENERIC_IMAGE_FILENAME.test(filename);
}

export function isOpaqueReferenceLabel(label: string, ...identifiers: Array<string | undefined>): boolean {
  const normalized = label.trim();
  if (!normalized) return true;
  const key = normalized.toLocaleLowerCase();
  return identifiers.some((identifier) => identifier?.trim().toLocaleLowerCase() === key)
    || UUID_LABEL.test(normalized)
    || INTERNAL_KEY_LABEL.test(normalized);
}

export function promptReferenceDisplayLabel(label: string, referenceId: string, referenceNumber: number, assetId?: string): string {
  return isOpaqueReferenceLabel(label, referenceId, assetId) ? `参考图 ${referenceNumber}` : label;
}

export function normalizePromptSegments(value: unknown, fallbackText = "", maxLength = MAX_PROMPT_LENGTH): PromptSegment[] {
  const limit = Math.max(0, Math.floor(maxLength));
  if (!Array.isArray(value)) return fallbackText ? [{ type: "text", text: fallbackText.slice(0, limit) }] : [];
  const result: PromptSegment[] = [];
  let length = 0;
  let referenceNumber = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const segment = item as Record<string, unknown>;
    if (segment.type === "text" && typeof segment.text === "string") {
      const text = segment.text.slice(0, Math.max(0, limit - length));
      if (text) result.push({ type: "text", text });
      length += text.length;
    } else if (segment.type === "reference" && typeof segment.referenceId === "string" && typeof segment.label === "string") {
      const referenceId = segment.referenceId.trim().slice(0, 120);
      const rawLabel = segment.label.trim().slice(0, 160);
      const label = isOpaqueReferenceLabel(rawLabel, referenceId)
        ? `参考图 ${referenceNumber + 1}`
        : rawLabel;
      const segmentLength = label.length + 1;
      if (!referenceId || !label || length + segmentLength > limit) continue;
      result.push({ type: "reference", referenceId, label });
      length += segmentLength;
      referenceNumber++;
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

/** Rebuild the readable prompt when a compact cloud snapshot omits its duplicate text field. */
export function readablePromptText(text: unknown, segments: unknown, maxLength = MAX_PROMPT_LENGTH): string {
  if (typeof text === "string" && text.length) return text.slice(0, Math.max(0, maxLength));
  return promptSegmentsText(normalizePromptSegments(segments, "", maxLength));
}

export function promptSegmentsHaveReferences(segments: readonly PromptSegment[]): boolean {
  return segments.some((segment) => segment.type === "reference");
}

