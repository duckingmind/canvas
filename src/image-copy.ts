import type { CanvasNode } from "./canvas-types.ts";
import { imageOriginalURL, isCosImageURL } from "./image-variants.ts";

function httpURL(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

/**
 * Return the only image URL that may participate in a durable copy.
 *
 * A platform asset ID is an authoritative server-side identity, so its
 * short-lived delivery URL may use a deployment-specific host. Without that
 * identity the source must be a COS object URL; browser-local keys, data URLs,
 * blob URLs and arbitrary public URLs are never copy sources.
 */
export function imageCopySource(node: Pick<CanvasNode, "image" | "imageThumbnail" | "assetId">): string | undefined {
  const trustedAsset = typeof node.assetId === "string" && node.assetId.trim().length > 0;
  // An existing original that is not a platform resource is an invalid
  // source. Do not silently downgrade it to a thumbnail or local copy.
  if (node.image !== undefined) {
    if (!httpURL(node.image)) return undefined;
    const value = node.image.trim();
    return trustedAsset || isCosImageURL(value) ? imageOriginalURL(value) || value : undefined;
  }
  if (httpURL(node.imageThumbnail)) {
    const value = node.imageThumbnail.trim();
    if (trustedAsset || isCosImageURL(value)) return imageOriginalURL(value) || value;
  }
  return undefined;
}

/** A signed or public COS URL is suitable without an asset lookup. */
export function isImageCopySource(value: unknown): value is string {
  return httpURL(value) && isCosImageURL(value.trim());
}

