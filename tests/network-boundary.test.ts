import assert from "node:assert/strict";
import test from "node:test";
import { canvasNetworkURL, fetchCanvasResource, setCanvasGatewayURL, CANVAS_NETWORK_BOUNDARY_ERROR } from "../src/network-boundary.ts";

const gateway = "https://api.example.test/v1";

test("Canvas keeps inline and Gateway data-plane resources usable", () => {
  setCanvasGatewayURL(gateway);
  assert.equal(canvasNetworkURL("data:image/png;base64,QQ=="), "data:image/png;base64,QQ==");
  assert.equal(canvasNetworkURL("blob:https://canvas.example.test/id"), "blob:https://canvas.example.test/id");
  assert.equal(canvasNetworkURL("https://api.example.test/v1/models"), "https://api.example.test/v1/models");
  assert.equal(canvasNetworkURL("https://api.example.test/v1/storage/items?key=canvas"), "https://api.example.test/v1/storage/items?key=canvas");
});

test("Canvas reads data URLs in memory without invoking fetch", async () => {
  setCanvasGatewayURL(gateway);
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("unexpected");
  };
  try {
    const response = await fetchCanvasResource("data:image/png;base64,QQ==");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [65]);
    const text = await fetchCanvasResource("data:text/plain,hello%20canvas");
    assert.equal(await text.text(), "hello canvas");
    const binary = await fetchCanvasResource("data:application/octet-stream,%FF");
    assert.deepEqual(Array.from(new Uint8Array(await binary.arrayBuffer())), [255]);
    const largeText = await fetchCanvasResource("data:text/plain," + "a".repeat(250_000));
    assert.equal((await largeText.text()).length, 250_000);
    const defaultType = await fetchCanvasResource("data:;base64,QQ==");
    assert.equal(defaultType.headers.get("content-type"), "text/plain;charset=US-ASCII");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previous;
    setCanvasGatewayURL(undefined);
  }
});

test("Canvas rejects the Admin server runtime Gateway path", async () => {
  const serverGateway = "https://canvas.example.test/api/app-runtime/v1/gateway";
  setCanvasGatewayURL(serverGateway);
  assert.throws(() => canvasNetworkURL("https://canvas.example.test/api/app-runtime/v1/gateway/images/tasks/task-1/content"), (error: any) => error?.code === CANVAS_NETWORK_BOUNDARY_ERROR);
  setCanvasGatewayURL(undefined);
});

test("Canvas rejects Admin, Portal and legacy bridge/runtime URLs before fetch", () => {
  setCanvasGatewayURL(gateway);
  for (const value of [
    "https://api.example.test/api/app-runtime/v1/session",
    "https://api.example.test/bridge",
    "https://www.platform.example/api/portal/user/apps",
    "https://admin.platform.example/api/admin/users",
    "https://admin-go.platform.example/v1/models",
    "https://admin-go.example.test/v1/storage/items?key=canvas",
    "https://api.example.test/v1/../api/app-runtime/v1",
  ]) {
    assert.throws(() => canvasNetworkURL(value), (error: any) => error?.code === CANVAS_NETWORK_BOUNDARY_ERROR);
  }
});

test("Canvas only accepts an external media URL when it has a known object signature", () => {
  setCanvasGatewayURL(gateway);
  assert.equal(canvasNetworkURL("https://media.example.test/object.png?q-signature=abc"), "https://media.example.test/object.png?q-signature=abc");
  for (const value of [
    "https://media.example.test/object.png",
    "https://media.example.test/object.png?token=abc",
    "https://evil.example.test/object.png?signatureless=true",
  ]) {
    assert.throws(() => canvasNetworkURL(value), (error: any) => error?.code === CANVAS_NETWORK_BOUNDARY_ERROR);
  }
  for (const value of [
    "http://127.0.0.1:5391/private.png?q-signature=abc",
    "http://localhost/private.png?q-signature=abc",
    "http://192.168.1.10/private.png?signature=abc",
    "http://10.0.0.2/private.png?x-amz-signature=abc",
  ]) {
    assert.throws(() => canvasNetworkURL(value), error => error?.code === CANVAS_NETWORK_BOUNDARY_ERROR);
  }
});

test("fetchCanvasResource validates before invoking the browser transport", async () => {
  setCanvasGatewayURL(gateway);
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("ok");
  };
  try {
    await assert.rejects(fetchCanvasResource("https://www.platform.example/api/app-runtime/v1/session"), (error: any) => error?.code === CANVAS_NETWORK_BOUNDARY_ERROR);
    assert.equal(calls, 0);
    await fetchCanvasResource("https://api.example.test/v1/models");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous;
    setCanvasGatewayURL(undefined);
  }
});
