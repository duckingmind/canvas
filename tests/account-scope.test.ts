import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { setLocalStorageScope, captureLocalStorageScope, localDatabaseName } from "../src/local-storage-scope.ts";
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "./draft-store" ? "./draft-store.ts" : specifier, context); } });
const library = await import("../src/library-store.ts");
const drafts = await import("../src/draft-store.ts");
const images = await import("../src/image-cache.ts");
hooks.deregister();
const document = (id = "same-id") => ({ id, name: "Private A", createdAt: "now", updatedAt: "now", nodes: [], edges: [] });

test("account scope partitions library, recovery drafts, media cache and pending-save markers", async () => {
  setLocalStorageScope("account-A");
  const aDatabase = localDatabaseName("proxy-canvas:library:v1");
  await library.saveCanvas(document());
  await drafts.writeDraft("recovery:same-id", { private: "A" });
  const cached = await images.storeInlineImages({ nodes: [{ image: "data:image/png;base64,QQ==" }] });
  assert.equal(drafts.hasPendingSessionChanges(), true);
  setLocalStorageScope("account-B");
  assert.notEqual(localDatabaseName("proxy-canvas:library:v1"), aDatabase);
  assert.deepEqual(await library.listCanvases(), []);
  assert.equal(await library.getCanvas("same-id"), null);
  assert.equal(await drafts.readDraft("recovery:same-id"), null);
  assert.equal(await images.readCachedImage(cached.nodes[0].localImage!), null);
  assert.equal(drafts.hasPendingSessionChanges(), false);
  await library.saveCanvas({ ...document(), name: "Private B" });
  setLocalStorageScope("account-A");
  assert.equal((await library.getCanvas("same-id"))?.name, "Private A");
  assert.deepEqual(await drafts.readDraft("recovery:same-id"), { private: "A" });
  assert.equal(await images.readCachedImage(cached.nodes[0].localImage!), "data:image/png;base64,QQ==");
});

test("account changes reject queued writes and late image downloads instead of adopting them", async () => {
  setLocalStorageScope("queued-A");
  const old = captureLocalStorageScope();
  const queued = library.saveCanvas(document("late"));
  setLocalStorageScope("queued-B");
  assert.throws(old, /账户已切换/);
  await assert.rejects(queued, /账户已切换/);
  assert.equal(await library.getCanvas("late"), null);
  let complete!: (value: Response) => void;
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Promise(resolve => { complete = resolve; started(); });
  try {
    setLocalStorageScope("download-A");
    const downloading = images.cacheRemoteImage("https://example.test/image.png");
    await requestStarted;
    setLocalStorageScope("download-B");
    complete(new Response(new Blob(["a"], { type: "image/png" })));
    await assert.rejects(downloading, /账户已切换/);
  } finally { globalThis.fetch = previousFetch; }
});

test("same-account refresh keeps its namespace; authenticated accounts never read legacy unscoped stores", async () => {
  setLocalStorageScope("stable-account");
  const check = captureLocalStorageScope();
  assert.equal(setLocalStorageScope("stable-account"), false);
  assert.doesNotThrow(check);
  assert.notEqual(localDatabaseName("proxy-canvas:drafts:v1"), "proxy-canvas:drafts:v1");
  let migrated = false;
  await library.migrateLegacy(() => { migrated = true; return document(); });
  assert.equal(migrated, false);
  assert.throws(() => setLocalStorageScope(""), /有效账户存储范围/);
});

test("the old account draft is flushed before switching and a failed flush leaves the account unchanged", async () => {
  const { beforeLocalAccountChange, prepareLocalStorageScope, localStorageScope } = await import("../src/local-storage-scope.ts");
  setLocalStorageScope("flush-A");
  const off = beforeLocalAccountChange(async () => { await library.saveCanvas(document("last-edit")); });
  await prepareLocalStorageScope("flush-B");
  off();
  assert.equal(localStorageScope(), "flush-A");
  setLocalStorageScope("flush-B");
  assert.equal(await library.getCanvas("last-edit"), null);
  setLocalStorageScope("flush-A");
  assert.equal((await library.getCanvas("last-edit"))?.name, "Private A");
  const fail = beforeLocalAccountChange(async () => { throw new Error("disk unavailable"); });
  await assert.rejects(prepareLocalStorageScope("flush-B"), /disk unavailable/);
  fail();
  assert.equal(localStorageScope(), "flush-A");
});
