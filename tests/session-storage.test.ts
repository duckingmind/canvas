import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "./draft-store" ? "./draft-store.ts" : specifier,
      context,
    );
  },
});
const drafts = await import("../src/draft-store.ts");
const library = await import("../src/library-store.ts");
const images = await import("../src/image-cache.ts");
hook.deregister();
import type { LibraryDocument } from "../src/library-store.ts";

const document = (id: string): LibraryDocument => ({
  id,
  name: `画布 ${id}`,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  nodes: [],
  edges: [],
});

test("quota failures remain explicit and do not silently switch existing browser storage", async () => {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        throw new DOMException("quota", "QuotaExceededError");
      },
    },
  });
  await assert.rejects(library.listCanvases(), /存储空间不足/);
  assert.equal(drafts.isSessionOnlyStorage(), false);
});

test("opaque iframe permission denial preserves the complete canvas workflow in a page cache", async () => {
  let opens = 0;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        opens++;
        throw new DOMException("IndexedDB access denied", "SecurityError");
      },
    },
  });
  let normalizedLegacy = false;
  await library.migrateLegacy(() => {
    normalizedLegacy = true;
    return document("legacy");
  });
  assert.equal(normalizedLegacy, false);
  assert.equal(drafts.isSessionOnlyStorage(), true);
  assert.deepEqual(await library.listCanvases(), []);

  const first = document("first");
  const save = library.saveCanvas(first);
  first.name = "external mutation";
  await save;
  assert.equal((await library.getCanvas("first"))?.name, "画布 first");
  const read = (await library.getCanvas("first"))!;
  read.name = "read mutation";
  assert.equal((await library.getCanvas("first"))?.name, "画布 first");
  await library.renameCanvas("first", "继续创作");
  await library.setCanvasDeleted("first", true);
  const deleted = (await library.getCanvas("first"))!;
  assert.ok(deleted.deletedAt);
  await library.saveCanvas({ ...deleted, deletedAt: undefined });
  assert.equal(
    (await library.getCanvas("first"))?.deletedAt,
    deleted.deletedAt,
  );
  await library.setCanvasDeleted("first", false);
  assert.equal((await library.listCanvases())[0].deletedAt, undefined);
  assert.equal((await library.listCanvases())[0].name, "继续创作");
  await assert.rejects(library.renameCanvas("missing", "name"), /画布不存在/);

  const restored = (await library.getCanvas("first"))!;
  await drafts.writeDraft("recovery:first", restored);
  restored.name = "later mutation";
  assert.equal(
    (await drafts.readDraft<LibraryDocument>("recovery:first"))?.name,
    "继续创作",
  );
  await drafts.removeDraft("recovery:first");
  assert.equal(await drafts.readDraft("recovery:first"), null);
  assert.equal(opens, 1, "the denied database is not retried by each store");
});

test("cloud acknowledgements never clear later changes or another canvas", async () => {
  const first = (await library.getCanvas("first"))!;
  const originalRevision = JSON.stringify(first);
  drafts.markSessionSynced(first.id, originalRevision);
  assert.equal(drafts.hasPendingSessionChanges(), false);
  await library.saveCanvas(first);
  assert.equal(
    drafts.hasPendingSessionChanges(),
    false,
    "flushing unchanged saved content is not a new unsaved change",
  );

  const changed = { ...first, name: "修改后的画布" };
  await library.saveCanvas(changed);
  await library.saveCanvas(document("second"));
  drafts.markSessionSynced(first.id, originalRevision);
  assert.equal(drafts.hasPendingSessionChanges(), true);
  drafts.markSessionSynced(first.id, JSON.stringify(changed));
  assert.equal(
    drafts.hasPendingSessionChanges(),
    true,
    "the other canvas still needs cloud persistence",
  );
  drafts.markSessionSynced("second", JSON.stringify(document("second")));
  assert.equal(drafts.hasPendingSessionChanges(), false);
});

test("inline images and submission references remain available in the session without stripping image data", async () => {
  const inline = "data:image/png;base64,c2Vzc2lvbi1pbWFnZQ==";
  const source = {
    nodes: [{ image: inline, submission: { images: [{ image: inline }] } }],
  };
  const cached = await images.storeInlineImages(source);
  assert.equal(cached.nodes[0].image, inline);
  assert.equal(cached.nodes[0].submission.images[0].image, inline);
  assert.match(cached.nodes[0].localImage!, /^proxy-canvas:image:sha256:/);
  assert.equal(
    cached.nodes[0].localImage,
    cached.nodes[0].submission.images[0].localImage,
  );
  const recovered = await images.restoreLocalImages({
    nodes: [{ localImage: cached.nodes[0].localImage }],
  });
  assert.equal(recovered.nodes[0].image, inline);
  assert.equal("localImage" in source.nodes[0], false);
});

test("video submission references share the local cache and can be restored", async () => {
  const inline = "data:image/png;base64,dmlkZW8taW5wdXQ=";
  const source = {
    nodes: [{ videoSubmission: { images: [{ image: inline }] } }],
  };
  const cached = await images.storeInlineImages(source);
  assert.equal(cached.nodes[0].videoSubmission.images[0].image, inline);
  assert.match(cached.nodes[0].videoSubmission.images[0].localImage!, /^proxy-canvas:image:sha256:/);
  const restored = await images.restoreLocalImages({
    nodes: [{ videoSubmission: { images: [{ localImage: cached.nodes[0].videoSubmission.images[0].localImage }] } }],
  });
  assert.equal(restored.nodes[0].videoSubmission.images[0].image, inline);
});

test("video posters use the local asset cache without becoming image references", async () => {
  const poster = "data:image/jpeg;base64,cG9zdGVyLWFzc2V0";
  const source = {
    nodes: [
      {
        videoPoster: poster,
        submission: { images: [{ image: "data:image/png;base64,c291cmNl" }] },
      },
    ],
  };
  const cached = await images.storeInlineImages(source);
  assert.equal(cached.nodes[0].videoPoster, poster);
  assert.match(cached.nodes[0].localVideoPoster!, /^proxy-canvas:image:sha256:/);
  assert.equal("localVideoPoster" in source.nodes[0], false);
  assert.equal("localVideoPoster" in source.nodes[0].submission.images[0], false);

  const recovered = await images.restoreLocalImages({
    nodes: [{ localVideoPoster: cached.nodes[0].localVideoPoster }],
  });
  assert.equal(recovered.nodes[0].videoPoster, poster);
  assert.equal(recovered.nodes[0].image, undefined);

  const existing = "data:image/jpeg;base64,ZXhpc3Rpbmc=";
  const preserved = await images.restoreLocalImages({
    nodes: [{ videoPoster: existing, localVideoPoster: cached.nodes[0].localVideoPoster }],
  });
  assert.equal(preserved.nodes[0].videoPoster, existing);
});

test("remote image bytes stay in memory and never become document-local media", async () => {
  const source = "https://cdn.example.test/generated.png?signature=abc";
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string) => {
      assert.equal(url, source);
      fetches++;
      return new Response(new Blob([new Uint8Array([114, 101, 109, 111, 116, 101])], { type: "image/png" }), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    },
  });
  try {
    const localImage = await images.cacheRemoteImage(source);
    assert.match(localImage!, /^proxy-canvas:image:sha256:/);
    assert.equal(await images.cacheRemoteImage(source), localImage);
    assert.equal(fetches, 1, "the same remote image is cached once per page");
    assert.equal(await images.readCachedImage(localImage!), "data:image/png;base64,cmVtb3Rl");
    assert.equal((await images.readCachedRemoteImage(source))?.localImage, localImage);
    const localOnly = await images.restoreLocalImages({ nodes: [{ localImage }] });
    assert.equal(localOnly.nodes[0].image, undefined, "remote bytes must not be promoted to a local document asset");
    const restored = await images.restoreLocalImages({
      nodes: [{ image: source, taskId: "task-1" }],
    });
    assert.equal(restored.nodes[0].image, source);
    assert.equal(restored.nodes[0].localImage, undefined);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: previousFetch,
    });
  }
});

test("a fresh page cannot mistake session contents for a browser-persisted library", async () => {
  const resolve = registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(
        specifier === "./draft-store" ? "./draft-store.ts" : specifier,
        context,
      );
    },
  });
  try {
    const fresh = await import("../src/library-store.ts?fresh-session");
    assert.deepEqual(await fresh.listCanvases(), []);
  } finally {
    resolve.deregister();
  }
});
