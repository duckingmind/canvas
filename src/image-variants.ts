// COS has used both `thumbnail` and `crop` imageMogr2 operations in links
// emitted by older and newer services. Treat either signed operation as a
// bounded preview while preserving the full original URL separately.
const THUMBNAIL_PARAMETER = /^imagemogr2\/(?:thumbnail|crop)(?:\/|$)/i;
const COS_HOST = /(?:\.myqcloud\.com|\.tencentcos\.cn|\.baogaodashi\.com)$/i;

function parseRemoteImage(value: unknown): URL | undefined {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isCosHost(hostname: string): boolean {
  return COS_HOST.test(hostname.replace(/\.$/, ""));
}

/** True when the source is a COS object URL whose preview must be signed by the server. */
export function isCosImageURL(source?: string): boolean {
  const url = parseRemoteImage(source);
  return Boolean(url && isCosHost(url.hostname));
}

function decodeQueryValue(value: string): string {
  let decoded = value;
  // COS may encode q-url-param-list once more than URLSearchParams does.
  // Decode boundedly so malformed input cannot turn this helper into a loop.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function signedThumbnailParameter(url: URL): boolean {
  const listed = url.searchParams.getAll("q-url-param-list")
    .map(value => decodeQueryValue(value))
    .join("&");
  return /imagemogr2\/(?:thumbnail|crop)(?:\/|$)/i.test(listed);
}

function removeThumbnailParameters(url: URL): boolean {
  let removed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (!THUMBNAIL_PARAMETER.test(key)) continue;
    url.searchParams.delete(key);
    removed = true;
  }
  return removed;
}

/** Return the canonical full-resolution object URL for a COS image. */
export function imageOriginalURL(source?: string): string | undefined {
  if (!source) return source;
  const url = parseRemoteImage(source);
  if (!url || !isCosHost(url.hostname)) return source;
  // A server-generated thumbnail may include the processing parameter in
  // q-url-param-list. Removing it would invalidate that signed URL; keep it
  // intact until the platform supplies a separately signed original.
  if (signedThumbnailParameter(url)) return source;
  removeThumbnailParameters(url);
  return url.toString();
}

/**
 * Build the bounded COS image variant used by canvas surfaces and gallery
 * thumbnails. The source remains the canonical object URL; the processing
 * parameter is only added to this display URL and is never persisted.
 */
export function imageThumbnailURL(source?: string, maxEdge = 640): string | undefined {
  if (!source) return source;
  const url = parseRemoteImage(source);
  if (!url || !isCosHost(url.hostname)) return source;
  // A COS signature covers the query parameter list. Appending an image
  // processing parameter in the browser therefore invalidates otherwise
  // valid signed URLs unless the server signed that exact variant. The
  // media API is the authority for thumbnail variants; absent an explicit
  // server-signed thumbnail, use the original URL and let the card sizing
  // provide the visual reduction.
  if (signedThumbnailParameter(url)) return source;
  return source;
}

export function isThumbnailURL(source?: string): boolean {
  const url = parseRemoteImage(source);
  return Boolean(url && (
    signedThumbnailParameter(url) ||
    [...url.searchParams.keys()].some(key => THUMBNAIL_PARAMETER.test(key))
  ));
}

/**
 * Return the URL allowed on a bounded image surface (cards, strips and
 * reference pickers). A COS object URL without an independently signed
 * transform is deliberately not returned: using it here downloads the full
 * object before the media service has supplied its thumbnail.
 */
export function imagePreviewURL(source?: string, explicitThumbnail?: string): string | undefined {
  const candidate = typeof explicitThumbnail === "string" && /^https?:\/\//i.test(explicitThumbnail)
    ? explicitThumbnail
    : undefined;
  if (candidate && (!isCosImageURL(candidate) || isThumbnailURL(candidate))) return candidate;
  if (!source) return undefined;
  if (isCosImageURL(source)) return isThumbnailURL(source) ? source : undefined;
  return source;
}
