import { isDurableAssetUrl } from "./asset-library.ts";

export type MediaIdentityInput = {
  assetId?: unknown;
  taskId?: unknown;
  url?: unknown;
};

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A generated result may be recovered by its platform asset, its task, or a
 * URL that is safe to persist without a signing token. Browser cache keys and
 * page-scoped URLs deliberately do not count as identities.
 */
export function hasStableMediaIdentity(value: MediaIdentityInput): boolean {
  return hasText(value.assetId) || hasText(value.taskId) || isDurableAssetUrl(value.url);
}

/** Inputs are replayed bytes, so a task ID alone cannot identify them. */
export function hasStableMediaInput(value: MediaIdentityInput): boolean {
  return hasText(value.assetId) || isDurableAssetUrl(value.url);
}

export function stableMediaError(label: string): Error {
  return Object.assign(
    new Error(`${label}没有返回可恢复的素材身份，请稍后重试。`),
    { code: "CANVAS_MEDIA_IDENTITY_MISSING" },
  );
}

export function requireStableMediaIdentity(value: MediaIdentityInput, label: string): void {
  if (!hasStableMediaIdentity(value)) throw stableMediaError(label);
}

export function requireStableMediaInput(value: MediaIdentityInput, label: string): void {
  if (!hasStableMediaInput(value)) throw stableMediaError(label);
}

export function requireStableAssetId(assetId: unknown, label: string): asserts assetId is string {
  if (!hasText(assetId)) throw stableMediaError(label);
}
