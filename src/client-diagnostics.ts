import { localDatabaseName, localStorageScope } from "./local-storage-scope.ts";

export const CANVAS_DIAGNOSTIC_LOG_VERSION = 1;
export const CANVAS_DIAGNOSTIC_LOG_LIMIT = 500;
export const CANVAS_DIAGNOSTIC_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_NAME = "proxy-canvas:diagnostics:v1";
const PRE_AUTH_MIGRATABLE_EVENTS = new Set([
  "platform.session_check_failed",
  "platform.login_failed",
]);
let sequence = 0;

export type CanvasDiagnosticLevel = "info" | "warn" | "error";
export type CanvasDiagnosticFields = {
  component?: string;
  operation?: string;
  phase?: string;
  trigger?: "waiting" | "stalled";
  result?: string;
  error_name?: string;
  error_code?: string;
  error_message?: string;
  request_id?: string;
  http_status?: number;
  media_error_code?: number;
  media_error_name?: string;
  network_state?: number;
  ready_state?: number;
  source_origin?: string;
  cors_mode?: "anonymous" | "none";
  attempt?: number;
  duration_ms?: number;
  buffered_ahead_ms?: number;
  current_time_ms?: number;
};

export type CanvasDiagnosticEvent = {
  version: typeof CANVAS_DIAGNOSTIC_LOG_VERSION;
  id: string;
  timestamp: string;
  level: CanvasDiagnosticLevel;
  event: string;
  fields: CanvasDiagnosticFields;
};

type DiagnosticScope = { scope: string; events: CanvasDiagnosticEvent[]; persistent: boolean };
const memoryScopes = new Map<string, DiagnosticScope>();

function currentMemoryScope(): DiagnosticScope {
  const scope = localStorageScope();
  let current = memoryScopes.get(scope);
  if (!current) {
    current = { scope, events: [], persistent: false };
    memoryScopes.set(scope, current);
  } else {
    memoryScopes.delete(scope);
    memoryScopes.set(scope, current);
  }
  while (memoryScopes.size > 4) memoryScopes.delete(memoryScopes.keys().next().value as string);
  return current;
}

function isLevel(value: unknown): value is CanvasDiagnosticLevel {
  return value === "info" || value === "warn" || value === "error";
}

function compactString(value: unknown, max = 80): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || text.length > max || !/^[A-Za-z0-9._:-]+$/.test(text)) return undefined;
  return text;
}

function safeOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

function safeFields(input: Record<string, unknown>): CanvasDiagnosticFields {
  const result: CanvasDiagnosticFields = {};
  for (const key of ["component", "operation", "phase", "result", "error_name", "error_code", "media_error_name"] as const) {
    const value = compactString(input[key]);
    if (value) result[key] = value;
  }
  if (input.trigger === "waiting" || input.trigger === "stalled") result.trigger = input.trigger;
  const requestID = compactString(input.request_id, 128);
  if (requestID) result.request_id = requestID;
  const origin = safeOrigin(input.source_origin);
  if (origin) result.source_origin = origin;
  if (input.cors_mode === "anonymous" || input.cors_mode === "none") result.cors_mode = input.cors_mode;
  for (const key of ["http_status", "media_error_code", "network_state", "ready_state", "attempt", "duration_ms", "buffered_ahead_ms", "current_time_ms"] as const) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 1_000_000_000) {
      result[key] = value;
    }
  }
  return result;
}

function storageKey(): string | undefined {
  if (!localStorageScope()) return undefined;
  return localDatabaseName(STORAGE_NAME);
}

function validEvent(value: unknown): value is CanvasDiagnosticEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.version === CANVAS_DIAGNOSTIC_LOG_VERSION &&
    typeof item.id === "string" && item.id.length <= 100 &&
    typeof item.timestamp === "string" && Number.isFinite(Date.parse(item.timestamp)) &&
    isLevel(item.level) && typeof item.event === "string" && /^[a-z][a-z0-9_.-]{0,79}$/.test(item.event) &&
    Boolean(item.fields && typeof item.fields === "object" && !Array.isArray(item.fields));
}

function retained(events: CanvasDiagnosticEvent[], now = Date.now()): CanvasDiagnosticEvent[] {
  return events
    .filter(event => now - Date.parse(event.timestamp) <= CANVAS_DIAGNOSTIC_LOG_RETENTION_MS && Date.parse(event.timestamp) <= now + 60_000)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-CANVAS_DIAGNOSTIC_LOG_LIMIT);
}

function readPersistent(): CanvasDiagnosticEvent[] {
  const key = storageKey();
  if (!key || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return retained(parsed.filter(validEvent).map(event => ({ ...event, fields: safeFields(event.fields as Record<string, unknown>) })));
  } catch {
    return [];
  }
}

function persist(events: CanvasDiagnosticEvent[]): boolean {
  const key = storageKey();
  if (!key || typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(key, JSON.stringify(retained(events)));
    return true;
  } catch {
    return false;
  }
}

function mergeEvents(...groups: CanvasDiagnosticEvent[][]): CanvasDiagnosticEvent[] {
  const unique = new Map<string, CanvasDiagnosticEvent>();
  for (const event of groups.flat()) unique.set(event.id, event);
  return retained([...unique.values()]);
}

export function recordCanvasDiagnostic(level: CanvasDiagnosticLevel, event: string, fields: CanvasDiagnosticFields = {}): void {
  if (!isLevel(level) || !/^[a-z][a-z0-9_.-]{0,79}$/.test(event)) return;
  const scope = currentMemoryScope();
  const now = new Date();
  const entry: CanvasDiagnosticEvent = {
    version: CANVAS_DIAGNOSTIC_LOG_VERSION,
    id: `canvas-${now.getTime().toString(36)}-${(++sequence).toString(36)}`,
    timestamp: now.toISOString(),
    level,
    event,
    fields: safeFields(fields as Record<string, unknown>),
  };
  scope.events = retained([...scope.events, entry]);
  scope.persistent = persist(mergeEvents(readPersistent(), scope.events));
}

export function diagnosticErrorFields(error: unknown): CanvasDiagnosticFields {
  const body = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const details = body.details && typeof body.details === "object" ? body.details as Record<string, unknown> : {};
  const nested = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
  const cause = body.cause && typeof body.cause === "object" ? body.cause as Record<string, unknown> : {};
  const causeDetails = cause.details && typeof cause.details === "object" ? cause.details as Record<string, unknown> : {};
  const requestID = [body.requestId, body.request_id, details.request_id, details.requestId, nested.request_id, cause.requestId, cause.request_id, causeDetails.request_id]
    .find(value => typeof value === "string");
  const code = [body.code, body.error_code, details.code, details.error_code, nested.code, cause.code, cause.error_code, causeDetails.code]
    .find(value => typeof value === "string");
  const statusValue = [body.httpStatus, body.statusCode, body.status_code, body.status, details.status, cause.httpStatus, cause.statusCode, cause.status, causeDetails.status]
    .find(value => typeof value === "number" || typeof value === "string");
  const status = typeof statusValue === "number" ? statusValue : typeof statusValue === "string" && /^\d{3}$/.test(statusValue) ? Number(statusValue) : undefined;
  const message = [body.message, body.error_message, details.message, nested.message, cause.message, causeDetails.message]
    .find(value => typeof value === "string");
  return safeFields({
    error_name: error instanceof Error ? error.name : compactString(body.name) || typeof error,
    error_message: error instanceof Error ? error.message : typeof error === "string" ? error : message,
    error_code: code,
    request_id: requestID,
    http_status: status,
  });
}

export function readCanvasDiagnostics(): CanvasDiagnosticEvent[] {
  const scope = currentMemoryScope();
  return mergeEvents(readPersistent(), scope.events);
}

/**
 * Move the small, account-neutral part of the anonymous login timeline into
 * the account namespace after platform admission. The anonymous namespace is
 * memory-only, so this preserves useful login diagnostics without ever
 * copying a previous account's application events into the next account.
 */
export function migratePreAuthCanvasDiagnostics(): number {
  if (!localStorageScope()) return 0;
  const anonymous = memoryScopes.get("");
  if (!anonymous || anonymous.events.length === 0) return 0;
  const migratable = anonymous.events.filter(event => PRE_AUTH_MIGRATABLE_EVENTS.has(event.event));
  anonymous.events = anonymous.events.filter(event => !PRE_AUTH_MIGRATABLE_EVENTS.has(event.event));
  if (migratable.length === 0) return 0;

  const account = currentMemoryScope();
  account.events = mergeEvents(account.events, migratable);
  account.persistent = persist(mergeEvents(readPersistent(), account.events));
  return migratable.length;
}

export function clearCanvasDiagnostics(): void {
  const scope = currentMemoryScope();
  scope.events = [];
  scope.persistent = persist([]);
}

export function canvasDiagnosticsPersistenceAvailable(): boolean {
  const key = storageKey();
  if (!key || typeof localStorage === "undefined") return false;
  try {
    localStorage.getItem(key);
    return true;
  } catch {
    return false;
  }
}

export function exportCanvasDiagnostics() {
  return {
    schema_version: CANVAS_DIAGNOSTIC_LOG_VERSION,
    generated_at: new Date().toISOString(),
    retention_days: 7,
    events: readCanvasDiagnostics(),
  };
}

let globalHandlers: (() => void) | undefined;

export function installCanvasDiagnosticHandlers(): () => void {
  if (typeof window === "undefined") return () => {};
  if (globalHandlers) return globalHandlers;
  const onError = (event: ErrorEvent) => {
    recordCanvasDiagnostic("error", "client.window_error", {
      component: "window",
      error_name: event.error instanceof Error ? event.error.name : "ErrorEvent",
      error_message: event.message,
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    recordCanvasDiagnostic("error", "client.unhandled_rejection", {
      component: "window",
      ...diagnosticErrorFields(event.reason),
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  globalHandlers = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    globalHandlers = undefined;
  };
  return globalHandlers;
}
