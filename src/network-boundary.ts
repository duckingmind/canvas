/**
 * Browser-side network policy for a Gateway-only Canvas application.
 *
 * The SDK already validates API paths before sending an App Session bearer.
 * Canvas also has a small number of media workflows that use native fetch
 * directly (copy, download, reference uploads and the IndexedDB image cache).
 * Keep those paths behind the same boundary so a value restored from a cloud
 * document cannot turn the app into a request proxy for Admin.
 */

// Keep this in step with the session issuer's control-plane host policy. The
// deployed Admin service is commonly named `admin-go`, so matching only the
// exact `admin` label would let a canonical-looking `/v1` URL bypass this
// browser-side boundary.
const ADMIN_HOST_PATTERN = /(?:^|[.-])(?:admin|admin-api|admin-go|codex-admin-api|portal|www)(?:[.-]|$)/i;
const ADMIN_PATH_PATTERN = /(?:^|\/)api\/(?:app-runtime|portal|market|admin)(?:\/|$)|(?:^|\/)bridge(?:\/|$)/i;
const SIGNATURE_PARAMETER_PATTERN = /^(?:q-signature|q-sign-time|x-cos-security-token|x-amz-signature|x-amz-credential|x-amz-date|x-goog-signature|signature|signkey)$/i;

export const CANVAS_NETWORK_BOUNDARY_ERROR = "CANVAS_NETWORK_BOUNDARY";

export type CanvasNetworkPolicy = {
  /** Canonical App Session Gateway URL, including its `/v1` prefix. */
  gatewayURL?: string;
  /** Override the browser origin in tests and local runtimes. */
  locationOrigin?: string;
};

let configuredGatewayURL: string | undefined;
let localDevelopmentEnabled = false;

/** Update the strict browser policy when the SDK receives or refreshes a session. */
export function setCanvasGatewayURL(value: string | undefined): void {
  configuredGatewayURL = typeof value === "string" && value.trim() ? value : undefined;
}

/** Loopback resources are accepted only by an explicitly local development runtime. */
export function setCanvasLocalDevelopmentEnabled(value: boolean): void {
  localDevelopmentEnabled = value;
}

function error(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: CANVAS_NETWORK_BOUNDARY_ERROR });
}

function absoluteURL(value: string, locationOrigin?: string): URL | undefined {
  try {
    const base = locationOrigin || (typeof location !== "undefined" ? location.origin : "https://canvas.invalid");
    return new URL(value, `${base.replace(/\/$/, "")}/`);
  } catch {
    return undefined;
  }
}

function gatewayPrefix(value: string | undefined): { origin: string; path: string } | undefined {
  if (!value) return undefined;
  const parsed = absoluteURL(value);
  if (!parsed || !/^https?:$/i.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
  const path = parsed.pathname;
  if (path !== "/v1") return undefined;
  return { origin: parsed.origin, path };
}

function isPathWithin(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function hasMediaSignature(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (SIGNATURE_PARAMETER_PATTERN.test(key)) return true;
  }
  return false;
}

function isBlockedAdminURL(url: URL): boolean {
  return ADMIN_HOST_PATTERN.test(url.hostname) || ADMIN_PATH_PATTERN.test(url.pathname);
}

function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".")) return true;
  const ipv4 = host.split(".").map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b, c] = ipv4;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) ||
      (a === 203 && b === 0 && c === 113);
  }
  if (host.includes(":")) {
    const firstHextet = Number.parseInt(host.split(":", 1)[0] || "0", 16);
    return firstHextet < 0x2000 || firstHextet > 0x3fff || host.startsWith("2001:db8:");
  }
  return false;
}

function isDataURL(value: string): boolean {
  return /^data:/i.test(value);
}

/**
 * Decode the payload of a data URL without handing it to the browser's
 * network stack. `fetch(data:...)` is subject to `connect-src` in Chromium,
 * even though the bytes are already in the document and never leave it.
 */
function dataURLBytes(value: string): { bytes: Uint8Array; contentType: string } {
  const comma = value.indexOf(",");
  if (comma < 0) throw error("Canvas data URL is malformed");
  const metadata = value.slice(5, comma);
  const payload = value.slice(comma + 1);
  const metadataParts = metadata.split(";");
  const declaredMediaType = metadataParts.shift() || "";
  const mediaType = declaredMediaType || "text/plain";
  const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");
  const parameters = metadataParts.filter((part) => part.toLowerCase() !== "base64");
  const contentType = [mediaType, ...parameters].join(";") +
    (!declaredMediaType && !parameters.some((part) => /^charset=/i.test(part))
      ? ";charset=US-ASCII"
      : "");
  if (declaredMediaType && !/^[^\s/;]+\/[^\s;]+$/i.test(declaredMediaType)) {
    throw error("Canvas data URL has an invalid content type");
  }

  // Decode percent escapes into bytes directly. `decodeURIComponent` cannot
  // represent arbitrary binary bytes such as `%FF`, which are valid in a
  // non-base64 data URL.
  const percentDecoded = (input: string): Uint8Array => {
    const bytes: number[] = [];
    let literalStart = 0;
    for (let index = 0; index < input.length; index++) {
      if (input[index] !== "%") continue;
      if (index > literalStart) {
        for (const byte of new TextEncoder().encode(input.slice(literalStart, index))) bytes.push(byte);
      }
      const hex = input.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/i.test(hex)) throw error("Canvas data URL has an invalid escape");
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
      literalStart = index + 1;
    }
    if (literalStart < input.length) {
      for (const byte of new TextEncoder().encode(input.slice(literalStart))) bytes.push(byte);
    }
    return new Uint8Array(bytes);
  };

  if (!isBase64) return { bytes: percentDecoded(payload), contentType };
  try {
    const binary = atob(decodeURIComponent(payload));
    return {
      bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      contentType,
    };
  } catch {
    throw error("Canvas data URL has invalid base64 content");
  }
}

function responseForDataURL(value: string): Response {
  const { bytes, contentType } = dataURLBytes(value);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Response(buffer, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

/**
 * Validate a URL before a Canvas-owned browser request.
 *
 * Inline/blob values never leave the document. HTTP(S) URLs must either be a
 * path on the current App Session Gateway, or be a signed object URL returned
 * by the Gateway. When no session is available (unit tests and pre-auth
 * startup), we still reject the known Admin surfaces but do not reject a
 * caller's public reference URL before the platform session is established.
 */
export function canvasNetworkURL(value: string, policy: CanvasNetworkPolicy = {}): string {
  if (typeof value !== "string" || !value.trim()) throw error("Canvas resource URL is empty");
  const raw = value.trim();
  if (/^(?:data|blob):/i.test(raw)) return raw;
  const parsed = absoluteURL(raw, policy.locationOrigin);
  if (!parsed || !/^https?:$/i.test(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw error("Canvas resource URL is not allowed");
  }
  const gatewayURL = policy.gatewayURL || configuredGatewayURL;
  const gateway = gatewayPrefix(gatewayURL);
  if (gatewayURL && !gateway) throw error("Canvas Gateway URL must use the canonical /v1 path");
  const isConfiguredGatewayPath = gateway && parsed.origin === gateway.origin && isPathWithin(parsed.pathname, gateway.path);
  if (isPrivateNetworkHost(parsed.hostname) && !isConfiguredGatewayPath && !localDevelopmentEnabled) {
    throw error("Canvas cannot access loopback or private network resources");
  }
  if (isBlockedAdminURL(parsed) && !isConfiguredGatewayPath) throw error("Canvas cannot access the Admin API");
  if (gateway) {
    if (isConfiguredGatewayPath) return parsed.href;
    // Signed media is intentionally fetched without the App Session bearer.
    // It may be hosted on the private object CDN used by the Gateway, while
    // the Admin host and all Admin control-plane paths remain blocked above.
    if (hasMediaSignature(parsed)) return parsed.href;
    throw error("Canvas resource must come from the App Session Gateway");
  }

  // Before the host has delivered a session, preserve the existing public
  // reference-image behavior while still blocking accidental Admin access.
  return parsed.href;
}

export async function fetchCanvasResource(
  value: string,
  init: RequestInit | undefined,
  policy: CanvasNetworkPolicy = {},
): Promise<Response> {
  const url = canvasNetworkURL(value, policy);
  if (isDataURL(url)) return responseForDataURL(url);
  return fetch(url, init);
}
