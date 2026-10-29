import assert from "node:assert/strict";
import test from "node:test";
import {
  ImageRecoveryGuard,
  mapTaskImageResults,
  matchStoredImageAsset,
  mediaUrlIdentity,
  taskImageResults,
} from "../src/image-recovery.ts";

test("signed media URLs keep a stable identity across signatures and CDN hosts", () => {
  const first = "https://bucket.cos.example/tenant/media/image/user/2026/09/13/task-0-0123456789abcdef.png?q-signature=old#preview";
  const renewed = "https://cdn.example/media/image/user/2026/09/13/task-0-0123456789abcdef.png?X-Amz-Signature=new";
  assert.equal(
    mediaUrlIdentity(first),
    "object:media/image/user/2026/09/13/task-0-0123456789abcdef.png",
  );
  assert.equal(mediaUrlIdentity(first), mediaUrlIdentity(renewed));
  assert.equal(
    mediaUrlIdentity("https://one.example/unrelated/a.png?token=old"),
    "one.example/unrelated/a.png?token=old",
  );
  assert.notEqual(
    mediaUrlIdentity("https://one.example/unrelated/a.png"),
    mediaUrlIdentity("https://two.example/unrelated/a.png"),
  );
  assert.equal(mediaUrlIdentity("data:image/png;base64,YQ=="), undefined);
  assert.equal(mediaUrlIdentity("not a URL"), undefined);
  assert.notEqual(
    mediaUrlIdentity("https://one.example/download?asset=A&q-signature=old"),
    mediaUrlIdentity("https://one.example/download?asset=B&q-signature=new"),
    "semantic query parameters must survive signature removal",
  );
  assert.notEqual(
    mediaUrlIdentity("https://one.example:8443/unrelated/a.png"),
    mediaUrlIdentity("https://one.example/unrelated/a.png"),
    "fallback identities retain the port",
  );
  assert.notEqual(
    mediaUrlIdentity("https://one.example/media/not-a-platform-object.png"),
    mediaUrlIdentity("https://two.example/media/not-a-platform-object.png"),
    "arbitrary media paths cannot opt into cross-host matching",
  );
});

test("an expired no-taskId URL is matched to its refreshed stored asset", () => {
  const expired = "https://old.cos/tenant/media/image/user/2026/09/13/task-a-0-0123456789abcdef.png?q-signature=expired";
  const refreshed = "https://new.cdn/media/image/user/2026/09/13/task-a-0-0123456789abcdef.png?q-signature=fresh";
  assert.deepEqual(
    matchStoredImageAsset(expired, [
      {
        id: "asset-video",
        task_id: "video-task",
        type: "video",
        url: refreshed,
      },
      {
        id: "asset-image",
        task_id: "image-task",
        type: "image",
        url: refreshed,
      },
    ]),
    {
      assetId: "asset-image",
      taskId: "image-task",
      image: refreshed,
    },
  );
});

test("legacy COS image URLs receive the server-signed thumbnail during recovery", () => {
  const original = "https://fixture-private.cos.ap-shanghai.myqcloud.com/tenant/media/image/20260430154541aa66-0-7e4721ef5ceb7da8.png?q-sign-algorithm=sha1&q-ak=AKID&q-sign-time=1791627986%3B1791714386&q-key-time=1791627986%3B1791714386&q-header-list=host&q-url-param-list=&q-signature=old";
  const renewed = original.replace("q-signature=old", "q-signature=fresh");
  const thumbnail = `${renewed}&q-url-param-list=imagemogr2%2Fcrop%2F480x480%2Fgravity%2Fcenter`;
  assert.deepEqual(
    matchStoredImageAsset(original, [{
      id: "asset-image",
      task_id: "image-task",
      type: "image",
      url: renewed,
      thumbnail_url: thumbnail,
    }]),
    { assetId: "asset-image", taskId: "image-task", image: renewed, thumbnail },
  );
});

test("compact COS media paths match across bucket/CDN hosts", () => {
  const oldURL = "https://fixture-private.cos.ap-shanghai.myqcloud.com/tenant/media/image/20260430154541aa66-0-7e4721ef5ceb7da8.png?q-signature=old";
  const refreshedURL = "https://cdn.example/media/image/20260430154541aa66-0-7e4721ef5ceb7da8.png?q-signature=fresh";
  assert.equal(mediaUrlIdentity(oldURL), mediaUrlIdentity(refreshedURL));
});

test("stored asset matching rejects malformed and ambiguous ownership", () => {
  const image = "https://cdn/media/image/user/day/same.png?old=1";
  assert.equal(
    matchStoredImageAsset(image, [{
      id: "unsafe",
      task_id: "../task",
      type: "image",
      url: "https://cdn/media/image/user/day/same.png?new=1",
    }]),
    undefined,
  );
  assert.equal(
    matchStoredImageAsset(image, [
      {
        id: "first",
        task_id: "task-a",
        type: "image",
        url: "https://cdn/media/image/user/day/same.png?new=1",
      },
      {
        id: "second",
        task_id: "task-b",
        type: "image/png",
        url: "https://cdn/media/image/user/day/same.png?new=2",
      },
    ]),
    undefined,
  );
  assert.equal(
    matchStoredImageAsset("data:image/png;base64,YQ==", []),
    undefined,
  );
});

test("task image results preserve slots and reject inline Base64 outputs", () => {
  assert.deepEqual(
    taskImageResults({
      data: [
        { url: "https://cdn.example/first.png" },
        { url: "javascript:alert(1)" },
        { b64_json: "dGhpcmQ=" },
        null,
        { url: "/api/media/fifth" },
      ],
    }),
    [
      "https://cdn.example/first.png",
      undefined,
      undefined,
      undefined,
      "/api/media/fifth",
    ],
  );
});

test("task recovery keeps each result's signed thumbnail aligned with its image", () => {
  assert.deepEqual(
    mapTaskImageResults(
      "task-with-thumbnails",
      [
        { id: "second", taskId: "task-with-thumbnails", resultIndex: 1 },
        { id: "first", taskId: "task-with-thumbnails", resultIndex: 0 },
      ],
      {
        data: [
          { url: "https://cdn.example/first.png", thumbnail_url: "https://cdn.example/first-thumb.png" },
          { url: "https://cdn.example/second.png", thumbnailUrl: "https://cdn.example/second-thumb.png" },
        ],
      },
    ),
    [
      {
        id: "second",
        taskId: "task-with-thumbnails",
        image: "https://cdn.example/second.png",
        thumbnail: "https://cdn.example/second-thumb.png",
      },
      {
        id: "first",
        taskId: "task-with-thumbnails",
        image: "https://cdn.example/first.png",
        thumbnail: "https://cdn.example/first-thumb.png",
      },
    ],
  );
});

test("multi-output recovery uses resultIndex instead of document order", () => {
  const updates = mapTaskImageResults(
    "task-1",
    [
      { id: "third-card", taskId: "task-1", resultIndex: 2 },
      { id: "first-card", taskId: "task-1", resultIndex: 0 },
      { id: "missing-card", taskId: "task-1", resultIndex: 1 },
    ],
    {
      data: [
        { url: "https://cdn.example/first.png" },
        {},
        { b64_json: "dGhpcmQ=" },
      ],
    },
  );
  assert.deepEqual(updates, [
    {
      id: "first-card",
      taskId: "task-1",
      image: "https://cdn.example/first.png",
    },
  ]);
});

test("recovery only uses positional mapping for an unambiguous legacy batch", () => {
  const legacy = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(
    mapTaskImageResults("legacy-task", legacy, {
      data: [{ url: "https://cdn/a.png" }, { url: "https://cdn/b.png" }],
    }),
    [
      { id: "a", taskId: "legacy-task", image: "https://cdn/a.png" },
      { id: "b", taskId: "legacy-task", image: "https://cdn/b.png" },
    ],
  );
  assert.deepEqual(
    mapTaskImageResults("legacy-task", legacy, {
      data: [{ url: "https://cdn/a.png" }],
    }),
    [],
    "a partial response must not put the first image onto an arbitrary card",
  );
  assert.deepEqual(
    mapTaskImageResults(
      "mixed-task",
      [{ id: "indexed", resultIndex: 0 }, { id: "unknown" }],
      { data: [{ url: "https://cdn/a.png" }, { url: "https://cdn/b.png" }] },
    ),
    [{ id: "indexed", taskId: "mixed-task", image: "https://cdn/a.png" }],
    "missing metadata in a current batch is not guessed",
  );
});

test("single-output recovery honors an explicit index and rejects a missing slot", () => {
  assert.deepEqual(
    mapTaskImageResults(
      "task-single",
      [{ id: "only", resultIndex: 1 }],
      { data: [{ url: "https://cdn/zero.png" }, { b64_json: "b25l" }] },
    ),
    [],
  );
  assert.deepEqual(
    mapTaskImageResults(
      "task-single",
      [{ id: "only", resultIndex: 3 }],
      { data: [{ url: "https://cdn/zero.png" }] },
    ),
    [],
  );
  assert.deepEqual(
    mapTaskImageResults(
      "task-single",
      [{ id: "only" }],
      { data: [{ url: "https://cdn/zero.png" }, { url: "https://cdn/one.png" }] },
    ),
    [],
    "an unindexed node cannot guess which output it owns",
  );
  for (const resultIndex of [-1, Number.NaN, 1.5]) {
    assert.deepEqual(
      mapTaskImageResults(
        "task-single",
        [{ id: "only", resultIndex }],
        { data: [{ url: "https://cdn/zero.png" }] },
      ),
      [],
      `invalid explicit index ${String(resultIndex)} must not become index zero`,
    );
  }
});

test("automatic recovery is deduplicated, bounded and reset by a changed source", () => {
  const guard = new ImageRecoveryGuard();
  const expired = guard.begin("node", "task-1\0expired-url");
  assert.ok(expired);
  assert.equal(
    guard.begin("node", "task-1\0expired-url"),
    undefined,
    "a concurrent image error must share the in-flight recovery",
  );
  guard.finish("node", expired);
  assert.equal(
    guard.begin("node", "task-1\0expired-url"),
    undefined,
    "the same broken URL must not cause an infinite request loop",
  );
  const renewed = guard.begin("node", "task-1\0renewed-url");
  assert.ok(renewed, "a newly issued URL gets its own recovery attempt");
  guard.finish("node", expired);
  assert.equal(
    guard.begin("node", "task-1\0renewed-url"),
    undefined,
    "a stale completion cannot unlock the new in-flight request",
  );
  guard.finish("node", renewed);
  assert.equal(
    guard.begin("node", "task-1\0another-broken-url"),
    undefined,
    "new signed URLs cannot bypass the per-node recovery limit",
  );
  guard.reset("node");
  assert.ok(guard.begin("node", "task-1\0renewed-url"));
});

test("retry guard can allow a finite number of transient retries", () => {
  const guard = new ImageRecoveryGuard(2);
  const first = guard.begin("node", "task\0url-1");
  assert.ok(first);
  guard.finish("node", first);
  const second = guard.begin("node", "task\0url-2");
  assert.ok(second);
  guard.finish("node", second);
  assert.equal(guard.begin("node", "task\0url-3"), undefined);
});

test("a completion from before reset cannot unlock the replacement attempt", () => {
  const guard = new ImageRecoveryGuard();
  const stale = guard.begin("node", "same-source")!;
  guard.reset("node");
  const current = guard.begin("node", "same-source")!;
  guard.finish("node", stale);
  assert.equal(guard.begin("node", "new-source"), undefined);
  guard.finish("node", current);
  assert.ok(guard.begin("node", "new-source"));
});

test("a completion from before a global reset cannot unlock a new platform cycle", () => {
  const guard = new ImageRecoveryGuard();
  const stale = guard.begin("node", "same-source")!;
  guard.resetAll();
  const current = guard.begin("node", "same-source")!;
  guard.finish("node", stale);
  assert.equal(guard.begin("node", "new-source"), undefined);
  guard.finish("node", current);
  assert.ok(guard.begin("node", "new-source"));
});
