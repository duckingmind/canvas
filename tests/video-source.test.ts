import assert from "node:assert/strict";
import test from "node:test";
import { readVideoSourceBlob, resolveVideoSource, videoSourceNeedsRefresh, type VideoSourceApi } from "../src/video-source.ts";

const now = Date.parse("2026-10-08T00:00:00Z");
const expiry = "2026-10-08T01:00:00Z";
const url = "https://cos.example.test/media/video.mp4?q-signature=secret";
const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 97, 118, 99, 49]);
const unavailable: VideoSourceApi = { request: async () => { assert.fail("a usable delivered URL must not trigger metadata requests"); } };
const result = (patch: Record<string, unknown> = {}) => ({ id: "asset-1", type: "video", url, url_expires_at: expiry, ...patch });

test("valid URLs are directly reusable without signing or byte requests", async () => {
  assert.deepEqual(await resolveVideoSource(unavailable, { assetId: "asset-1", videoContentUrl: url, videoContentUrlExpiresAt: expiry }, { now }), { url, assetId: "asset-1", urlExpiresAt: expiry });
  assert.deepEqual(await resolveVideoSource(unavailable, { video: "https://cdn.test/public.mp4" }, { now, forceRefresh: true }), { url: "https://cdn.test/public.mp4" });
  assert.equal((await resolveVideoSource(unavailable, { video: "https://cdn.test/stale.mp4?signature=old", videoContentUrl: url, videoContentUrlExpiresAt: expiry }, { now })).url, url);
  for (const local of ["blob:canvas-file", "data:video/mp4;base64,AAAA"]) {
    assert.deepEqual(await resolveVideoSource(unavailable, { video: local, taskId: "unrelated-old-task", assetId: "unrelated-old-asset" }, { forceRefresh: true }), { url: local });
  }
});

test("signed source freshness understands explicit expiry, COS and S3 clocks", () => {
  assert.equal(videoSourceNeedsRefresh({ url, urlExpiresAt: expiry }, now), false);
  assert.equal(videoSourceNeedsRefresh({ url, urlExpiresAt: new Date(now + 20_000).toISOString() }, now), true);
  assert.equal(videoSourceNeedsRefresh({ url, urlExpiresAt: "invalid" }, now), true);
  assert.equal(videoSourceNeedsRefresh({ url: `${url}&q-sign-time=${now / 1000 - 100};${now / 1000 - 1}` }, now), true);
  assert.equal(videoSourceNeedsRefresh({ url: `${url}&q-key-time=${now / 1000};${now / 1000 + 3600}` }, now), false);
  assert.equal(videoSourceNeedsRefresh({ url: `${url}&X-Amz-Date=20261007T230000Z&X-Amz-Expires=3600` }, now), true);
  assert.equal(videoSourceNeedsRefresh({ url: `${url}&Expires=${now / 1000 + 3600}` }, now), false);
  assert.equal(videoSourceNeedsRefresh({ url: "/videos/task-1/content" }, now), true);
  assert.equal(videoSourceNeedsRefresh({ url: "blob:local", urlExpiresAt: "2000-01-01T00:00:00Z" }, now), false);
});

test("expired sources refresh only existing asset details while keeping cancellation local", async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  const api: VideoSourceApi = { request: async (path, init) => {
    calls.push(path); assert.equal(init, undefined); assert.notEqual(init?.method, "POST"); return result();
  } };
  const source = await resolveVideoSource(api, { assetId: "asset-1", taskId: "task-1", videoContentUrl: url, videoContentUrlExpiresAt: "2026-10-07T00:00:00Z" }, { now, signal: controller.signal });
  assert.deepEqual(source, { url, assetId: "asset-1", urlExpiresAt: expiry });
  assert.deepEqual(calls, ["/media/assets/asset-1"]);
});

test("legacy proxy nodes recover via task metadata and never request content bytes", async () => {
  const calls: string[] = [];
  const api: VideoSourceApi = { request: async (path, init) => {
    calls.push(path); assert.notEqual(init?.responseType, "blob"); assert.notEqual(init?.method, "POST");
    return { id: "task-1", status: "completed", assets: [result()] };
  } };
  for (const proxy of ["/videos/task-1/content", "https://app.test/api/app-runtime/v1/gateway/videos/task-1/content"]) {
    assert.deepEqual(await resolveVideoSource(api, { videoContentUrl: proxy }, { now }), { url, assetId: "asset-1", urlExpiresAt: expiry });
  }
  assert.deepEqual(calls, ["/videos/task-1"]);
});

test("task-only and asset-only restored nodes recover delivered URLs", async () => {
  assert.equal((await resolveVideoSource({ request: async () => result() }, { assetId: "asset-1" }, { now })).url, url);
  assert.deepEqual(await resolveVideoSource({ request: async () => ({ id: "task-1", status: "completed", asset_id: "asset-1", content_url: url, content_url_expires_at: expiry }) }, { taskId: "task-1" }, { now }), { url, assetId: "asset-1", urlExpiresAt: expiry });
});

test("missing browser-local video cache falls back to its stable task identity", async () => {
  const localVideo = "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789012";
  let metadataReads = 0;
  const api: VideoSourceApi = { request: async path => {
    metadataReads++;
    assert.equal(path, "/videos/task-1");
    return { id: "task-1", status: "completed", asset_id: "asset-1", content_url: url, content_url_expires_at: expiry };
  } };
  assert.deepEqual(await resolveVideoSource(api, { localVideo, taskId: "task-1" }, { now }), { url, assetId: "asset-1", urlExpiresAt: expiry });
  assert.equal(metadataReads, 1);

  let fetched: unknown;
  const blob = await readVideoSourceBlob(api, { localVideo, taskId: "task-1" }, {
    now,
    fetchResource: async (input, init) => {
      fetched = input;
      assert.equal(init?.credentials, "omit");
      return new Response(mp4, { headers: { "content-type": "video/mp4" } });
    },
  });
  assert.equal(blob.type, "video/mp4");
  assert.equal(fetched, url);
});

test("shares concurrent task metadata reads across canvas consumers", async () => {
  let requests = 0;
  let release!: (value: unknown) => void;
  const pending = new Promise<unknown>(resolve => { release = resolve; });
  const api: VideoSourceApi = { request: async () => {
    requests += 1;
    return pending;
  } };
  const first = resolveVideoSource(api, { taskId: "task-shared" }, { now });
  const second = resolveVideoSource(api, { taskId: "task-shared" }, { now });
  await Promise.resolve();
  assert.equal(requests, 1);
  release({ id: "task-shared", status: "completed", content_url: url, content_url_expires_at: expiry });
  assert.deepEqual(await Promise.all([first, second]), [
    { url, urlExpiresAt: expiry },
    { url, urlExpiresAt: expiry },
  ]);
});

test("reuses a fresh asset delivery across nodes in the same API session", async () => {
  let requests = 0;
  const api: VideoSourceApi = { request: async () => { requests += 1; return result(); } };
  const first = await resolveVideoSource(api, { assetId: "asset-1" }, { now });
  const second = await resolveVideoSource(api, { assetId: "asset-1", videoContentUrl: "https://old.example/video.mp4", videoContentUrlExpiresAt: "2026-10-07T00:00:00Z" }, { now });
  assert.deepEqual(second, first);
  assert.equal(requests, 1);
});

test("deleted assets never fall back to a different task result", async () => {
  const calls: string[] = [];
  await assert.rejects(resolveVideoSource({ request: async path => { calls.push(path); throw { status: 404, code: "media_asset_not_found" }; } }, { assetId: "asset-1", taskId: "task-1" }, { now }), { code: "VIDEO_ASSET_NOT_FOUND" });
  assert.deepEqual(calls, ["/media/assets/asset-1"]);
});

test("metadata rejects wrong identities, unavailable assets and unsigned legacy responses", async () => {
  for (const [patch, code] of [
    [{ id: "other-asset" }, "VIDEO_ASSET_INVALID_RESPONSE"],
    [{ type: "image" }, "VIDEO_ASSET_INVALID_TYPE"],
    [{ status: "collecting" }, "VIDEO_ASSET_NOT_READY"],
    [{ status: "deleted" }, "VIDEO_ASSET_NOT_FOUND"],
    [{ url: "/videos/task-1/content" }, "VIDEO_SOURCE_UNAVAILABLE"],
    [{ url_expires_at: "2020-01-01T00:00:00Z" }, "VIDEO_SOURCE_EXPIRED"],
  ] as const) {
    await assert.rejects(resolveVideoSource({ request: async () => result(patch) }, { assetId: "asset-1" }, { now }), { code });
  }
  for (const status of ["queued", "collecting", "failed"]) {
    await assert.rejects(resolveVideoSource({ request: async () => ({ id: "task-1", status, content_url: url }) }, { taskId: "task-1" }, { now }), { code: status === "failed" ? "VIDEO_TASK_FAILED" : "VIDEO_ASSET_NOT_READY" });
  }
  await assert.rejects(resolveVideoSource({ request: async () => ({ id: "another-task", status: "completed", content_url: url }) }, { taskId: "task-1" }, { now }), { code: "VIDEO_TASK_INVALID_RESPONSE" });
});

test("direct downloads never forward application authorization or cookies to COS", async () => {
  let fetched = 0;
  const blob = await readVideoSourceBlob(unavailable, { videoContentUrl: url, videoContentUrlExpiresAt: expiry }, { now, fetchResource: async (input, init) => {
    fetched++; assert.equal(input, url); assert.equal(init?.credentials, "omit"); assert.equal(init?.referrerPolicy, "no-referrer"); assert.equal(init?.headers, undefined);
    return new Response(mp4, { headers: { "content-type": "application/octet-stream", "content-length": String(mp4.length) } });
  } });
  assert.equal(blob.type, "video/mp4"); assert.equal(blob.size, mp4.length); assert.equal(fetched, 1);
});

test("a failed direct URL is refreshed once through details, never through POST or content", async () => {
  let fetched = 0; const calls: string[] = [];
  const blob = await readVideoSourceBlob({ request: async (path, init) => { calls.push(path); assert.notEqual(init?.method, "POST"); return result({ url: `${url}&fresh=1` }); } }, { assetId: "asset-1", video: url }, { now, fetchResource: async input => {
    fetched++;
    if (fetched === 1) return new Response("<Error>expired</Error>", { status: 403 });
    assert.equal(input, `${url}&fresh=1`); return new Response(mp4);
  } });
  assert.equal(blob.size, mp4.length); assert.equal(fetched, 2); assert.deepEqual(calls, ["/media/assets/asset-1"]);
});

test("failed download and malformed success responses have a bounded single refresh", async () => {
  for (const response of [() => new Response("denied", { status: 403 }), () => new Response('{"error":"unavailable"}', { headers: { "content-type": "video/mp4" } }), () => new Response("<?xml version='1.0'?><Error>Denied</Error>"), () => new Response("<html>login</html>")]) {
    let fetched = 0, requests = 0;
    await assert.rejects(readVideoSourceBlob({ request: async () => { requests++; return result(); } }, { video: url, assetId: "asset-1" }, { now, fetchResource: async () => { fetched++; return response(); } }));
    assert.equal(fetched, 2); assert.equal(requests, 1);
  }
});

test("size limits reject Content-Length before consuming or refreshing", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(readVideoSourceBlob(unavailable, { video: url, assetId: "asset-1" }, { now, maxBytes: 10, fetchResource: async () => new Response(stream, { headers: { "content-length": "100" } }) }), { code: "VIDEO_CONTENT_TOO_LARGE" });
  assert.equal(cancelled, true);
});

test("downloads have a 500 MiB streaming ceiling even when no caller limit is supplied", async () => {
  await assert.rejects(readVideoSourceBlob(unavailable, { video: url }, { now, fetchResource: async () => new Response(null, { headers: { "content-length": String(500 * 1024 * 1024 + 1) } }) }), { code: "VIDEO_CONTENT_TOO_LARGE" });
});

test("size limits stop and cancel chunked streams before downloading the full body", async () => {
  let cancelled = false, pulls = 0;
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(mp4); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await assert.rejects(readVideoSourceBlob(unavailable, { video: url, assetId: "asset-1" }, { now, maxBytes: 25, fetchResource: async () => new Response(stream) }), { code: "VIDEO_CONTENT_TOO_LARGE" });
  assert.equal(cancelled, true); assert.equal(pulls, 2);
});

test("truncated responses cannot be exported as apparently successful mp4 files", async () => {
  await assert.rejects(readVideoSourceBlob(unavailable, { video: url }, { now, fetchResource: async () => new Response(mp4, { headers: { "content-length": "100" } }) }), { code: "VIDEO_CONTENT_TRUNCATED" });
});

test("cancellation during metadata reads prevents byte fetching and further metadata refresh", async () => {
  const controller = new AbortController(); let requests = 0;
  await assert.rejects(readVideoSourceBlob({ request: async (_path, init) => {
    requests++; assert.equal(init, undefined); controller.abort(); return result();
  } }, { assetId: "asset-1" }, { now, signal: controller.signal, fetchResource: async () => { assert.fail("aborted metadata must not fetch bytes"); } }), { name: "AbortError" });
  assert.equal(requests, 1);
});

test("cancellation during a streamed download cancels the reader without a metadata retry", async () => {
  const controller = new AbortController(); let cancelled = false;
  const stream = new ReadableStream({ pull(streamController) { streamController.enqueue(mp4); controller.abort(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await assert.rejects(readVideoSourceBlob(unavailable, { video: url, assetId: "asset-1" }, { now, signal: controller.signal, fetchResource: async () => new Response(stream) }), { name: "AbortError" });
  assert.equal(cancelled, true);
});
