import { isThumbnailURL } from "./image-variants.ts";

type ImageResolver = (source?: string) => string | undefined;

/**
 * Return an adjacent gallery image only when the resolver can prove it is a
 * bounded variant. Do not warm the full-resolution URL as a fallback: that
 * request is only needed after the user selects the image (or zooms it).
 */
export function adjacentImagePreloadSource(
  source: string | undefined,
  resolveImageSource?: ImageResolver,
  resolveImageThumbnail?: ImageResolver,
): string | undefined {
  if (!source) return undefined;
  const original = resolveImageSource?.(source) || source;
  const resolvedThumbnail = resolveImageThumbnail?.(source);
  // Local data/blob images are already bounded by the local asset pipeline
  // and remain useful to warm for keyboard navigation. Opaque cache keys or
  // other non-renderable identifiers must not become <img> requests.
  if (!/^https?:\/\//i.test(original)) {
    return /^(?:data|blob):/i.test(original) ? resolvedThumbnail || source : undefined;
  }
  // If the source itself is a server-signed thumbnail it is safe to warm even
  // without a resolver. Otherwise an absent resolver must never fall back to
  // the canonical full-resolution URL.
  const thumbnail = resolvedThumbnail || (isThumbnailURL(source) ? source : undefined);
  if (!thumbnail) return undefined;
  if (thumbnail === original && !isThumbnailURL(thumbnail)) return undefined;
  return thumbnail;
}
