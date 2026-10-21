const cosSigningParameters = new Set([
  "q-sign-algorithm", "q-ak", "q-sign-time", "q-key-time",
  "q-header-list", "q-url-param-list", "q-signature", "x-cos-security-token",
]);

function remoteUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return undefined;
  try { return new URL(value); } catch { return undefined; }
}

/** Only generated, content-versioned objects may share bytes across signatures.
 * Keep the origin, full path and all transformation/version parameters. A
 * thumbnail, another bucket or a mutable external URL is a different image.
 */
export function immutableImageUrlIdentity(value: string): string | undefined {
  const url = remoteUrl(value);
  if (!url || !/\/media\/image\/[^/]+\/\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9._:-]+-\d+-[a-f0-9]{16}\.(?:png|jpg|jpeg|webp|bin)$/.test(url.pathname)) return undefined;
  for (const key of [...url.searchParams.keys()]) {
    if (cosSigningParameters.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.hash = "";
  return url.href;
}

export function isTemporaryMediaUrl(value: unknown): boolean {
  const url = remoteUrl(value);
  return Boolean(url && [...url.searchParams.keys()].some(key =>
    /^(?:q-signature|q-sign-time|signkey|signature|x-cos-security-token|x-amz-signature|x-goog-signature)$/i.test(key),
  ));
}

/** Unknown signing schemes keep the existing repair behavior. COS URLs from
 * Gateway carry an absolute interval, so a fresh URL can be reused on reload.
 */
export function mediaUrlNeedsRefresh(value: unknown, now = Date.now()): boolean {
  if (!value) return true;
  if (!isTemporaryMediaUrl(value)) return false;
  const url = remoteUrl(value)!;
  const interval = url.searchParams.get("q-sign-time")?.match(/^(\d+);(\d+)$/);
  if (!interval) return true;
  const start = Number(interval[1]) * 1000, end = Number(interval[2]) * 1000;
  return !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
    start > now || end <= start || end <= now + 60_000;
}
