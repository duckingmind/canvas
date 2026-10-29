import type { AppSession } from "@ducking-mind/proxy-app-sdk";

/**
 * Portal writes the user-bound Gateway session here immediately before it
 * navigates to the published app document.  sessionStorage keeps the
 * credential out of URLs, referrers, localStorage and the app package while
 * still allowing the app bundle to call the public Gateway directly.
 */
export const GATEWAY_SESSION_STORAGE_PREFIX = "proxy-app:gateway-session:";

type SessionRecord = Partial<AppSession> & {
  app_aliases?: unknown;
};

function storageKey(identity: string): string {
  return `${GATEWAY_SESSION_STORAGE_PREFIX}${encodeURIComponent(identity)}`;
}

function isCanonicalGatewayURL(value: string): boolean {
  if (value === "/v1") return true;
  try {
    if (!value || value !== value.trim() || value.endsWith("/")) return false;
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const loopback = hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
    return parsed.pathname === "/v1" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      && !/(?:^|[.-])(?:admin|admin-api|admin-go|codex-admin-api|portal|www)(?:[.-]|$)/i.test(hostname)
      && (parsed.protocol === "https:" || loopback);
  } catch {
    return false;
  }
}

function isSession(value: unknown): value is AppSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as SessionRecord;
  if (typeof record.access_token !== "string" || !record.access_token.startsWith("ast_")) return false;
  if (typeof record.gateway_url !== "string" || !isCanonicalGatewayURL(record.gateway_url)) return false;
  if (typeof record.app_id !== "string" || !record.app_id.trim()) return false;
  if (typeof record.app_version !== "string" || !record.app_version.trim()) return false;
  if (typeof record.expires_in !== "number" || !Number.isFinite(record.expires_in) || record.expires_in <= 0) return false;
  if (!Array.isArray(record.scopes) || record.scopes.some(scope => typeof scope !== "string")) return false;
  if (record.app_aliases !== undefined && (!Array.isArray(record.app_aliases) || record.app_aliases.some(alias => typeof alias !== "string"))) return false;
  return true;
}

function belongsTo(value: AppSession, appID: string): boolean {
  if (value.app_id === appID || value.app_slug === appID) return true;
  return value.app_aliases?.includes(appID) === true;
}

/** Read the session handoff without ever making a control-plane request. */
export function readGatewaySession(appID: string): AppSession | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  const candidates = new Set<string>();
  candidates.add(storageKey(appID));
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(GATEWAY_SESSION_STORAGE_PREFIX)) candidates.add(key);
    }
    for (const key of candidates) {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      let value: unknown;
      try { value = JSON.parse(raw); } catch { continue; }
      if (isSession(value) && belongsTo(value, appID)) return value;
    }
  } catch {
    // A disabled or partitioned sessionStorage is equivalent to a missing
    // handoff. The platform gate will show a reconnect state instead of
    // falling back to an Admin runtime request.
  }
  return undefined;
}

