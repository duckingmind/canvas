import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "./local-storage-scope.ts" ? "./local-storage-scope.ts" : specifier, context);
  },
});
const scope = await import("../src/local-storage-scope.ts");
const diagnostics = await import("../src/client-diagnostics.ts");
hook.deregister();

function withStorage(t: { after: (fn: () => void) => void }) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  });
  scope.setLocalStorageScope("diagnostics-test-account");
  diagnostics.clearCanvasDiagnostics();
  t.after(() => {
    diagnostics.clearCanvasDiagnostics();
    scope.setLocalStorageScope("diagnostics-test-account");
    diagnostics.clearCanvasDiagnostics();
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  return values;
}

test("pre-auth session failures migrate only into the admitted account scope", t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  });
  diagnostics.recordCanvasDiagnostic("error", "platform.login_failed", {
    component: "platform_gate", operation: "login", error_code: "APP_LOGIN_REQUIRED",
  });
  diagnostics.recordCanvasDiagnostic("error", "video.playback.failed", {
    component: "video", media_error_code: 4,
  });
  scope.setLocalStorageScope("diagnostics-migration-account");
  assert.equal(diagnostics.migratePreAuthCanvasDiagnostics(), 1);
  const events = diagnostics.readCanvasDiagnostics();
  assert.deepEqual(events.map(event => event.event), ["platform.login_failed"]);
  assert.ok([...values.keys()][0]?.includes("diagnostics-migration-account"));
  diagnostics.clearCanvasDiagnostics();
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
});

test("diagnostic records retain a safe field allowlist and strip signed URL secrets", t => {
  const values = withStorage(t);
  diagnostics.recordCanvasDiagnostic("error", "video.playback.failed", {
    component: "video",
    operation: "playback",
    media_error_code: 4,
    source_origin: "https://cdn.example.test/video.mp4?signature=private&token=private",
    request_id: "req-123",
    prompt: "never persist this prompt",
  } as never);
  const [entry] = diagnostics.readCanvasDiagnostics();
  assert.equal(entry.event, "video.playback.failed");
  assert.equal(entry.fields.media_error_code, 4);
  assert.equal(entry.fields.source_origin, "https://cdn.example.test");
  assert.equal(entry.fields.request_id, "req-123");
  assert.doesNotMatch(JSON.stringify(entry), /signature=private|token=private|secret|never persist this prompt|prompt/);
  assert.equal(values.size, 1);
  assert.ok([...values.keys()][0].includes("diagnostics-test-account"));
});

test("diagnostics are bounded to 500 newest entries and capped fields", t => {
  withStorage(t);
  for (let index = 0; index < 520; index += 1) {
    diagnostics.recordCanvasDiagnostic("info", "canvas.test_event", { attempt: index });
  }
  const events = diagnostics.readCanvasDiagnostics();
  assert.equal(events.length, 500);
  assert.equal(events.at(-1)?.fields.attempt, 519);
  assert.equal(JSON.stringify(diagnostics.exportCanvasDiagnostics()).length < 256 * 1024, true);
});

test("malformed errors retain only safe code, status and request identifiers", () => {
  const result = diagnostics.diagnosticErrorFields({
    name: "GatewayError",
    code: "MEDIA_EXPIRED",
    status: 403,
    request_id: "req-safe",
    details: { prompt: "secret prompt" },
  });
  assert.equal(result.error_code, "MEDIA_EXPIRED");
  assert.equal(result.http_status, 403);
  assert.equal(result.request_id, "req-safe");
  assert.doesNotMatch(JSON.stringify(result), /secret|prompt|cdn\.example/);
});

test("account-scoped logs do not cross to a different account scope", t => {
  withStorage(t);
  diagnostics.recordCanvasDiagnostic("warn", "platform.session_ended", { error_code: "APP_SESSION_EXPIRED" });
  scope.setLocalStorageScope("another-account");
  assert.deepEqual(diagnostics.readCanvasDiagnostics(), []);
  scope.setLocalStorageScope("diagnostics-test-account");
});

test("expired records are pruned when loaded", t => {
  const values = withStorage(t);
  const key = [...values.keys()][0] || "proxy-canvas:diagnostics:v1:account:diagnostics-test-account";
  values.set(key, JSON.stringify([{
    version: 1, id: "old", timestamp: "2020-01-01T00:00:00.000Z", level: "error",
    event: "client.window_error", fields: { component: "window" },
  }]));
  assert.deepEqual(diagnostics.readCanvasDiagnostics(), []);
});

