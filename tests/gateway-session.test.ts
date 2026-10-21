import assert from "node:assert/strict";
import test from "node:test";
import { readGatewaySession, GATEWAY_SESSION_STORAGE_PREFIX } from "../src/gateway-session.ts";

const session = {
  access_token: "ast_user_1",
  token_type: "Bearer",
  expires_in: 3600,
  gateway_url: "https://api.example.test/v1",
  app_id: "app_stable_canvas",
  app_slug: "canvas",
  app_aliases: ["canvas-old"],
  app_version: "0.2.3",
  account_scope: "acs_" + "a".repeat(64),
  scopes: ["storage.user"],
};

function withStorage(run: () => void) {
  const previous = globalThis.sessionStorage;
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] || null; },
    getItem(key: string) { return values.get(key) || null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
    clear() { values.clear(); },
  } as Storage;
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  try { run(); } finally {
    if (previous === undefined) delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    else Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: previous });
  }
  return values;
}

test("Canvas reads the Portal Gateway session by stable id or approved slug", () => {
  withStorage(() => {
    sessionStorage.setItem(`${GATEWAY_SESSION_STORAGE_PREFIX}canvas`, JSON.stringify(session));
    assert.deepEqual(readGatewaySession("canvas"), session);
    assert.deepEqual(readGatewaySession("canvas-old"), session);
    assert.equal(readGatewaySession("other-app"), undefined);
  });
});

test("Canvas ignores malformed or non-Gateway session handoffs", () => {
  withStorage(() => {
    sessionStorage.setItem(`${GATEWAY_SESSION_STORAGE_PREFIX}canvas`, JSON.stringify({ ...session, access_token: "portal-token" }));
    assert.equal(readGatewaySession("canvas"), undefined);
    sessionStorage.setItem(`${GATEWAY_SESSION_STORAGE_PREFIX}canvas`, "not-json");
    assert.equal(readGatewaySession("canvas"), undefined);
  });
});

