import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { setLocalStorageScope } from "../src/local-storage-scope.ts";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "./draft-store" ? "./draft-store.ts" : specifier, context);
} });
const images = await import("../src/image-cache.ts");
hooks.deregister();

const object = "https://bucket.example.test/app/media/image/user/2026/09/22/task-0-0123456789abcdef.png";
const original = `${object}?q-signature=old&q-sign-time=1;2`;
const renewed = `${object}?q-signature=new&q-sign-time=3;4`;

async function withDownloads(scope: string, action: (downloads: string[]) => Promise<void>) {
  setLocalStorageScope(scope);
  const previousFetch = globalThis.fetch, downloads: string[] = [];
  globalThis.fetch = async input => {
    downloads.push(String(input));
    return new Response(new Blob([String(input)], { type: "image/png" }));
  };
  try { await action(downloads); } finally { globalThis.fetch = previousFetch; }
}

test("renewed signatures reuse explicit in-memory media without changing document URLs", async () => {
  await withDownloads("rotated-image", async downloads => {
    const key = await images.cacheRemoteImage(original);
    const cached = await images.readCachedRemoteImage(renewed);
    assert.equal(cached?.localImage, key);
    assert.match(cached?.image || "", /^data:image\/png;base64,/);
    const restored = await images.restoreLocalImages({ nodes: [{ image: renewed, taskId: "task-1" }] });
    assert.equal(restored.nodes[0].image, renewed);
    assert.equal(restored.nodes[0].localImage, undefined);
    assert.equal(await images.cacheRemoteImage(renewed), key);
    assert.deepEqual(downloads, [original]);
  });
});

test("explicit remote caching never opens persistent browser image storage", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: { open() { throw new Error("remote cache must not open IndexedDB"); } },
  });
  try {
    await withDownloads("memory-only-remote", async downloads => {
      const key = await images.cacheRemoteImage(original);
      assert.ok(key);
      assert.equal((await images.readCachedRemoteImage(renewed))?.localImage, key);
      assert.equal(downloads.length, 1);
      const restored = await images.restoreLocalImages({ nodes: [{ image: renewed, assetId: "asset-1" }] });
      assert.equal(restored.nodes[0].image, renewed);
      assert.equal(restored.nodes[0].localImage, undefined);
    });
  } finally {
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test("local uploads restore without replacing remote references or newer inline images", async () => {
  await withDownloads("explicit-image", async downloads => {
    const stored = await images.storeInlineImages({ nodes: [{ image: "data:image/png;base64,QQ==" }] });
    const localImage = stored.nodes[0].localImage;
    const restoredLocal = await images.restoreLocalImages({ nodes: [{ localImage }] });
    assert.equal(restoredLocal.nodes[0].image, "data:image/png;base64,QQ==");
    const restoredRemote = await images.restoreLocalImages({ nodes: [{ image: renewed, localImage }] });
    assert.equal(restoredRemote.nodes[0].image, renewed);
    assert.equal(restoredRemote.nodes[0].localImage, undefined);
    const newer = await images.restoreLocalImages({ nodes: [{ image: "data:image/png;base64,Qg==", localImage }] });
    assert.equal(newer.nodes[0].image, "data:image/png;base64,Qg==");
    const missing = await images.restoreLocalImages({ nodes: [{ localImage: "proxy-canvas:image:sha256:" + "f".repeat(64) }] });
    assert.equal(missing.nodes[0].image, undefined);
    assert.deepEqual(downloads, []);
  });
});

test("thumbnail, content version and another origin require their own image bytes", async () => {
  await withDownloads("image-variants", async downloads => {
    const key = await images.cacheRemoteImage(original);
    for (const url of [renewed + "&imageMogr2/thumbnail/480x480>=", renewed.replace("0123456789abcdef", "fedcba9876543210"), renewed.replace("bucket.example.test", "other.example.test")]) {
      assert.equal(await images.readCachedRemoteImage(url), null);
      assert.notEqual(await images.cacheRemoteImage(url), key);
    }
    assert.equal(downloads.length, 4);
  });
});

test("an identical object URL cannot reuse image bytes from another account", async () => {
  await withDownloads("cache-owner-A", async downloads => {
    const key = await images.cacheRemoteImage(original);
    setLocalStorageScope("cache-owner-B");
    assert.equal(await images.readCachedRemoteImage(renewed), null);
    assert.equal(await images.readCachedImage(key!), null);
    await images.cacheRemoteImage(renewed);
    assert.equal(downloads.length, 2);
    setLocalStorageScope("cache-owner-A");
    assert.equal(await images.readCachedRemoteImage(renewed), null, "switching accounts releases the disposable remote byte cache");
    assert.equal(await images.cacheRemoteImage(original), key);
    assert.equal(downloads.length, 3);
  });
});

test("session-only local image data retains two accounts but evicts older partitions", async () => {
  const image = (value: string) => `data:image/png;base64,${Buffer.from(value).toString("base64")}`;
  setLocalStorageScope("session-images-lru-A");
  const a = await images.storeInlineImages({ nodes: [{ image: image("account-a") }] });
  const aKey = a.nodes[0].localImage!;

  setLocalStorageScope("session-images-lru-B");
  const b = await images.storeInlineImages({ nodes: [{ image: image("account-b") }] });
  const bKey = b.nodes[0].localImage!;

  // The image cache intentionally keeps the two most recently used accounts.
  setLocalStorageScope("session-images-lru-A");
  assert.equal(await images.readCachedImage(aKey), image("account-a"));
  setLocalStorageScope("session-images-lru-C");
  await images.storeInlineImages({ nodes: [{ image: image("account-c") }] });
  setLocalStorageScope("session-images-lru-A");
  assert.equal(await images.readCachedImage(aKey), image("account-a"));

  // B was the least recently used account when C was opened and is recreated
  // empty instead of retaining its previous full-resolution data URL.
  setLocalStorageScope("session-images-lru-B");
  assert.equal(await images.readCachedImage(bKey), null);
});

test("concurrent renewals share one download and a failed download remains retryable", async () => {
  await withDownloads("concurrent-image", async downloads => {
    const [a, b] = await Promise.all([images.cacheRemoteImage(original), images.cacheRemoteImage(renewed)]);
    assert.equal(a, b);
    assert.equal(downloads.length, 1);
    const workingFetch = globalThis.fetch;
    const source = object.replace("task-0", "retry-0");
    globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
    await assert.rejects(images.cacheRemoteImage(source), /network unavailable/);
    globalThis.fetch = workingFetch;
    assert.ok(await images.cacheRemoteImage(source));
    assert.equal(downloads.length, 2);
  });
});

test("cross-origin permission checks use one byte and never cache partial image content", async () => {
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://canvas.example.test/") });
  try {
    await withDownloads("range-probe", async () => {
      const calls: RequestInit[] = [];
      globalThis.fetch = async (_input, options = {}) => {
        calls.push(options);
        return new Response(new Blob([calls.length === 1 ? "x" : "whole-image"], { type: "image/png" }), { status: calls.length === 1 ? 206 : 200 });
      };
      const key = await images.cacheRemoteImage(original);
      assert.equal(calls[0].credentials, "omit");
      assert.equal(calls[1].credentials, "omit");
      assert.equal(new Headers(calls[0].headers).get("range"), "bytes=0-0");
      assert.equal(calls[0].cache, "no-store");
      assert.equal(new Headers(calls[1].headers).has("range"), false);
      assert.equal(await images.readCachedImage(key!), "data:image/png;base64,d2hvbGUtaW1hZ2U=");
    });
    await withDownloads("range-cors-blocked", async () => {
      let requests = 0;
      globalThis.fetch = async (_input, options = {}) => {
        requests++;
        assert.equal(new Headers(options.headers).get("range"), "bytes=0-0");
        throw new TypeError("CORS blocked");
      };
      await assert.rejects(images.cacheRemoteImage(original), /CORS blocked/);
      assert.equal(requests, 1);
      assert.equal(await images.readCachedRemoteImage(original), null);
    });
    await withDownloads("range-ignored", async () => {
      let requests = 0;
      globalThis.fetch = async () => { requests++; return new Response(new Blob(["whole-image"], { type: "image/png" })); };
      const key = await images.cacheRemoteImage(original);
      assert.equal(requests, 1, "a 200 probe already contains the complete image");
      assert.equal(await images.readCachedImage(key!), "data:image/png;base64,d2hvbGUtaW1hZ2U=");
    });
  } finally {
    if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation);
    else Reflect.deleteProperty(globalThis, "location");
  }
});
