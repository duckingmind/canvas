/** Generic Gateway KV values are limited to 256 KiB. Leave headroom for direct saves. */
export const MAX_DIRECT_STORAGE_BYTES = 240 * 1024;

/** Canvas-specific guard within the default account KV quota. */
export const MAX_CANVAS_DOCUMENT_BYTES = 16 * 1024 * 1024;

export class CanvasDocumentTooLargeError extends Error {
  readonly code = "CANVAS_STORAGE_DOCUMENT_TOO_LARGE";
  readonly bytes: number;
  readonly limit: number;

  constructor(bytes: number, limit = MAX_CANVAS_DOCUMENT_BYTES) {
    super(`画布内容约 ${(bytes / 1024 / 1024).toFixed(1)} MiB，超过云端画布上限 ${(limit / 1024 / 1024).toFixed(0)} MiB，请导出备份后精简画布内容。`);
    this.name = "CanvasDocumentTooLargeError";
    this.bytes = bytes;
    this.limit = limit;
  }
}
