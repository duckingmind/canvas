import assert from "node:assert/strict";
import test from "node:test";
import {
  createMediaNavigationContext,
  mediaNavigation,
  mediaNavigationFromContext,
  removeMediaNavigationSnapshots,
} from "../src/media-navigation.ts";

test("result browsing follows the incoming creator, not the next creative step or its references", () => {
  const source = { id: "source", type: "prompt" }, next = { id: "next", type: "prompt" };
  const ref = { id: "ref", type: "image", image: "reference.png" };
  const a = { id: "a", type: "image", image: "a.png" }, b = { id: "b", type: "image", image: "b.png" };
  const nodes = [source, ref, a, next, b, { id: "unrelated", type: "image", image: "other.png" }];
  const edges = [{ from: "ref", to: "source" }, { from: "source", to: "a" }, { from: "source", to: "b" }, { from: "source", to: "b" }, { from: "a", to: "next" }];
  const result = mediaNavigation(nodes, edges, b);
  assert.deepEqual(result.sources, [source]);
  assert.deepEqual(result.items, [a, b]);
  assert.equal(result.index, 1);
});

test("missing or ambiguous sources do not silently combine unrelated results", () => {
  const current = { id: "result", type: "image", image: "a.png" };
  const sources = [{ id: "a", type: "prompt" }, { id: "b", type: "prompt" }];
  assert.deepEqual(mediaNavigation([current], [{ from: "deleted", to: current.id }], current), { sources: [], items: [current], index: 0 });
  assert.deepEqual(mediaNavigation([...sources, current], sources.map(source => ({ from: source.id, to: current.id })), current), { sources, items: [current], index: 0 });
});

test("unloaded videos remain navigable while empty image placeholders are excluded", () => {
  const source = { id: "source", type: "prompt" };
  const video = { id: "video", type: "video", videoContentUrl: "/content" };
  const image = { id: "image", type: "image", image: "a.png" };
  const empty = { id: "empty", type: "image" };
  const nodes = [source, video, image, empty];
  const edges = [video, image, empty].map(node => ({ from: source.id, to: node.id }));
  assert.deepEqual(mediaNavigation(nodes, edges, video).items, [video, image]);
});

test("repeated image generations stay inside the selected result batch", () => {
  const source = { id: "source", type: "prompt" };
  const first = { id: "first", type: "image", image: "first.png", resultBatchId: "batch-a" };
  const second = { id: "second", type: "image", image: "second.png", resultBatchId: "batch-b" };
  const third = { id: "third", type: "image", image: "third.png", resultBatchId: "batch-b" };
  const result = mediaNavigation(
    [source, first, second, third],
    [first, second, third].map(node => ({ from: source.id, to: node.id })),
    third,
  );
  assert.deepEqual(result.items, [second, third]);
  assert.equal(result.index, 1);
});

test("audio uploads participate in media result navigation", () => {
  const source = { id: "source", type: "prompt" };
  const audio = { id: "audio", type: "audio", audio: "clip.mp3" };
  const image = { id: "image", type: "image", image: "still.png" };
  const result = mediaNavigation(
    [source, audio, image],
    [{ from: source.id, to: audio.id }, { from: source.id, to: image.id }],
    audio,
  );
  assert.deepEqual(result.items, [audio, image]);
  assert.equal(result.index, 0);
});

test("resultOf wins over stale incoming edges and keeps the gallery on its creator", () => {
  const source = { id: "source", type: "prompt" };
  const unrelated = { id: "unrelated", type: "prompt" };
  const current = { id: "current", type: "image", image: "current.png", resultOf: source.id, resultBatchId: "new" };
  const sibling = { id: "sibling", type: "image", image: "sibling.png", resultOf: source.id, resultBatchId: "new" };
  const wrong = { id: "wrong", type: "image", image: "wrong.png", resultBatchId: "new" };
  const result = mediaNavigation(
    [source, unrelated, wrong, sibling, current],
    [
      { from: unrelated.id, to: current.id },
      { from: source.id, to: current.id },
      { from: source.id, to: sibling.id },
      { from: unrelated.id, to: wrong.id },
    ],
    current,
  );
  assert.deepEqual(result.sources, [source]);
  assert.deepEqual(result.items, [sibling, current]);
  assert.equal(result.index, 1);
});

test("the creator batch filters historical direct-edge results", () => {
  const source = { id: "source", type: "prompt", submission: { resultBatchId: "latest" } };
  const current = { id: "current", type: "image", image: "current.png", resultBatchId: "latest" };
  const sibling = { id: "sibling", type: "image", image: "sibling.png", resultBatchId: "latest" };
  const old = { id: "old", type: "image", image: "old.png", resultBatchId: "old" };
  const result = mediaNavigation(
    [source, old, sibling, current],
    [old, sibling, current].map((node) => ({ from: source.id, to: node.id })),
    current,
  );
  assert.deepEqual(result.items, [sibling, current]);
});

test("source generation batch is used when the selected result has no batch", () => {
  const source = { id: "source", type: "prompt", generationBatchId: "latest" };
  const current = { id: "current", type: "image", image: "current.png", resultOf: source.id, resultBatchId: "latest" };
  const sibling = { id: "sibling", type: "image", image: "sibling.png", resultOf: source.id, resultBatchId: "latest" };
  const old = { id: "old", type: "image", image: "old.png", resultOf: source.id, resultBatchId: "old" };
  const result = mediaNavigation([source, old, current, sibling], [], current);
  assert.deepEqual(result.items, [current, sibling]);
});

test("result indexes define gallery order and duplicate edges do not duplicate items", () => {
  const source = { id: "source", type: "prompt" };
  const first = { id: "first", type: "image", image: "first.png", resultOf: source.id, resultIndex: 0 };
  const second = { id: "second", type: "image", image: "second.png", resultOf: source.id, resultIndex: 1 };
  const third = { id: "third", type: "image", image: "third.png", resultOf: source.id };
  const result = mediaNavigation(
    [source, third, second, first],
    [
      { from: source.id, to: third.id },
      { from: source.id, to: first.id },
      { from: source.id, to: first.id },
      { from: source.id, to: second.id },
    ],
    first,
  );
  assert.deepEqual(result.items, [first, second, third]);
  assert.equal(result.index, 0);
});

test("a continuation prompt is not treated as a generated gallery result", () => {
  const source = { id: "source", type: "prompt" };
  const continuation = { id: "continuation", type: "prompt", image: "next.png" };
  const result = mediaNavigation(
    [source, continuation],
    [{ from: source.id, to: continuation.id }],
    continuation,
  );
  assert.deepEqual(result.items, [continuation]);
});

test("image tool outputs can browse siblings through a non-prompt source", () => {
  const source = { id: "source", type: "image", image: "source.png" };
  const current = { id: "current", type: "image", image: "current.png", resultOf: source.id, resultIndex: 1 };
  const sibling = { id: "sibling", type: "image", image: "sibling.png", resultOf: source.id, resultIndex: 0 };
  const result = mediaNavigation([source, current, sibling], [], current);
  assert.deepEqual(result.sources, [source]);
  assert.deepEqual(result.items, [sibling, current]);
  assert.equal(result.index, 1);
});

test("a missing explicit source does not fall back to stale prompt edges", () => {
  const staleSource = { id: "stale", type: "prompt" };
  const current = { id: "current", type: "image", image: "current.png", resultOf: "deleted-source" };
  const unrelated = { id: "unrelated", type: "image", image: "unrelated.png" };
  const result = mediaNavigation(
    [staleSource, current, unrelated],
    [
      { from: staleSource.id, to: current.id },
      { from: staleSource.id, to: unrelated.id },
    ],
    current,
  );
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.items, [current]);
});

test("a creator media node stays in the gallery with its sibling results", () => {
  const source = {
    id: "source",
    type: "prompt",
    image: "inline.png",
    resultBatchId: "batch-1",
  };
  const sibling = {
    id: "sibling",
    type: "image",
    image: "sibling.png",
    resultOf: source.id,
    resultBatchId: "batch-1",
    resultIndex: 1,
  };
  const result = mediaNavigation(
    [source, sibling],
    [{ from: source.id, to: sibling.id }],
    source,
  );
  assert.deepEqual(result.items, [source, sibling]);
  assert.equal(result.index, 0);
});

test("legacy siblings without batch metadata remain browsable when the source batch is unambiguous", () => {
  const source = { id: "source", type: "prompt", generationBatchId: "batch-1" };
  const first = { id: "first", type: "image", image: "first.png", resultOf: source.id };
  const second = { id: "second", type: "video", videoContentUrl: "/videos/second/content", resultOf: source.id };
  const result = mediaNavigation(
    [source, second, first],
    [],
    second,
  );
  assert.deepEqual(result.items, [second, first]);
  assert.equal(result.index, 0);
});

test("a stable batch can recover siblings after legacy edges are missing", () => {
  const source = { id: "source", type: "prompt", generationBatchId: "batch-1" };
  const first = { id: "first", type: "image", image: "first.png", resultBatchId: "batch-1", resultIndex: 0 };
  const second = { id: "second", type: "image", image: "second.png", resultBatchId: "batch-1", resultIndex: 1 };
  const result = mediaNavigation([source, second, first], [], second);
  assert.deepEqual(result.items, [first, second]);
  assert.equal(result.index, 1);
});

test("explicit lineage recovers unlinked same-batch siblings without importing competing edges", () => {
  const source = { id: "source", type: "prompt" };
  const current = { id: "current", type: "image", image: "current.png", resultOf: source.id, resultBatchId: "batch-1", resultIndex: 1 };
  const sibling = { id: "sibling", type: "image", image: "sibling.png", resultBatchId: "batch-1", resultIndex: 0 };
  const unrelated = { id: "unrelated", type: "prompt" };
  const competing = { id: "competing", type: "image", image: "competing.png", resultBatchId: "batch-1" };
  const result = mediaNavigation(
    [source, current, sibling, unrelated, competing],
    [{ from: unrelated.id, to: competing.id }],
    current,
  );
  assert.deepEqual(result.items, [sibling, current]);
  assert.equal(result.index, 1);
});

test("an explicitly linked legacy result stays navigable beside the active batch", () => {
  const source = { id: "source", type: "prompt", resultBatchId: "batch-current" };
  const old = {
    id: "old",
    type: "image",
    image: "old.png",
    resultOf: source.id,
    resultBatchId: "batch-old",
    resultIndex: 0,
  };
  const current = {
    id: "current",
    type: "image",
    image: "current.png",
    resultOf: source.id,
    // Older saved results did not persist resultBatchId.
    resultIndex: 1,
  };
  const sibling = {
    id: "sibling",
    type: "video",
    videoContentUrl: "/videos/sibling/content",
    resultOf: source.id,
    resultBatchId: "batch-current",
    resultIndex: 0,
  };
  const result = mediaNavigation(
    [source, old, current, sibling],
    [old, current, sibling].map((node) => ({ from: source.id, to: node.id })),
    current,
  );
  assert.deepEqual(result.items, [sibling, current]);
  assert.equal(result.index, 1);
});

test("a gallery can switch between image and video results from one batch", () => {
  const source = { id: "source", type: "prompt", resultBatchId: "batch-1" };
  const image = {
    id: "image",
    type: "image",
    image: "image.png",
    resultOf: source.id,
    resultBatchId: "batch-1",
    resultIndex: 0,
  };
  const video = {
    id: "video",
    type: "video",
    videoContentUrl: "/videos/video/content",
    resultOf: source.id,
    resultBatchId: "batch-1",
    resultIndex: 1,
  };
  const result = mediaNavigation(
    [source, image, video],
    [{ from: source.id, to: image.id }, { from: source.id, to: video.id }],
    video,
  );
  assert.deepEqual(result.items, [image, video]);
  assert.equal(result.index, 1);
});

test("a legacy selected result is retained without mixing an unknown old batch", () => {
  const source = { id: "source", type: "prompt" };
  const old = {
    id: "old",
    type: "image",
    image: "old.png",
    resultOf: source.id,
    resultBatchId: "batch-old",
    resultIndex: 0,
  };
  const current = {
    id: "current",
    type: "image",
    image: "current.png",
    resultOf: source.id,
    resultIndex: 1,
  };
  const result = mediaNavigation(
    [source, old, current],
    [{ from: source.id, to: old.id }, { from: source.id, to: current.id }],
    current,
  );
  assert.deepEqual(result.items, [current]);
  assert.equal(result.index, 0);
});

test("single-output prompt nodes form a canvas gallery when no result siblings exist", () => {
  const first = {
    id: "first",
    type: "prompt",
    image: "first.png",
    mediaType: "image",
    status: "completed",
    resultBatchId: "batch-first",
  };
  const second = {
    id: "second",
    type: "prompt",
    image: "second.png",
    mediaType: "image",
    status: "completed",
    resultBatchId: "batch-second",
  };
  const video = {
    id: "video",
    type: "prompt",
    videoContentUrl: "/videos/video/content",
    mediaType: "video",
    status: "completed",
    resultBatchId: "batch-video",
  };
  const empty = { id: "empty", type: "prompt", mediaType: "image", status: "queued" };
  const result = mediaNavigation([first, second, video, empty], [], second);
  assert.deepEqual(result.sources, [second]);
  assert.deepEqual(result.items, [first, second, video]);
  assert.equal(result.index, 1);
});

test("canvas gallery fallback does not include an empty or pending prompt", () => {
  const current = { id: "current", type: "prompt", image: "current.png", status: "completed" };
  const pending = { id: "pending", type: "prompt", status: "running", resultBatchId: "pending" };
  const result = mediaNavigation([current, pending], [], current);
  assert.deepEqual(result.items, [current]);
});

test("an open gallery keeps all result IDs when switching to another result and back", () => {
  const source = { id: "source", type: "prompt", generationBatchId: "batch-1" };
  const results = Array.from({ length: 22 }, (_, index) => ({
    id: `result-${index + 1}`,
    type: "image",
    image: `https://media.example/${index + 1}.png`,
    resultOf: source.id,
    resultBatchId: "batch-1",
    resultIndex: index,
  }));
  const nodes = [source, ...results];
  const edges = results.map((node) => ({ from: source.id, to: node.id }));
  const opened = mediaNavigation(nodes, edges, results[18]);
  const context = createMediaNavigationContext(opened);

  assert.equal(opened.items.length, 22);
  assert.equal(opened.index, 18);

  // A refreshed preview snapshot can temporarily lack all generation metadata.
  const switchedPreview = { ...results[19], image: "https://media.example/refreshed.png", resultOf: undefined, resultBatchId: undefined };
  const switched = mediaNavigationFromContext(nodes, switchedPreview, context);
  assert.equal(switched.items.length, 22);
  assert.equal(switched.index, 19);

  const switchedBack = mediaNavigationFromContext(nodes, results[18], context);
  assert.equal(switchedBack.items.length, 22);
  assert.equal(switchedBack.index, 18);
  assert.equal(switchedBack.items[18].id, "result-19");
});

test("preview metadata is resolved from the canonical document node", () => {
  const source = { id: "source", type: "prompt", generationBatchId: "batch-1" };
  const first = { id: "first", type: "image", image: "first.png", resultOf: source.id, resultBatchId: "batch-1" };
  const second = { id: "second", type: "image", image: "second.png", resultOf: source.id, resultBatchId: "batch-1" };
  const stalePreview = { ...second, resultOf: undefined, resultBatchId: undefined };

  const result = mediaNavigation([source, first, second], [], stalePreview);

  assert.deepEqual(result.items, [first, second]);
  assert.equal(result.index, 1);
});

test("refreshed URLs do not remove members from an already-open gallery", () => {
  const source = { id: "source", type: "prompt" };
  const results = [0, 1, 2].map((index) => ({
    id: `result-${index}`,
    type: "image",
    image: `https://media.example/${index}.png`,
    resultOf: source.id,
  }));
  const initial = mediaNavigation([source, ...results], [], results[1]);
  const context = createMediaNavigationContext(initial);
  const refreshedNodes = [source, ...results].map((node) =>
    node.type === "image" ? { ...node, image: `https://media.example/refreshed/${node.id}.png` } : node,
  );
  const refreshed = mediaNavigationFromContext(refreshedNodes, refreshedNodes[3], context);

  assert.equal(refreshed.items.length, 3);
  assert.deepEqual(refreshed.items.map((node) => node.id), ["result-0", "result-1", "result-2"]);
  assert.equal(refreshed.index, 2);
});

test("an open gallery survives a document snapshot that temporarily omits its results", () => {
  const source = { id: "source", type: "prompt", generationBatchId: "batch-1" };
  const results = Array.from({ length: 4 }, (_, index) => ({
    id: `result-${index}`,
    type: "image",
    image: `https://media.example/${index}.png`,
    resultOf: source.id,
    resultBatchId: "batch-1",
    resultIndex: index,
  }));
  const opened = mediaNavigation([source, ...results], [], results[2]);
  const context = createMediaNavigationContext(opened);

  // The selected node remains in the live snapshot while peers are briefly
  // absent during a document refresh. The visible gallery should not collapse.
  const partial = mediaNavigationFromContext([source, results[2]], results[2], context);
  assert.deepEqual(partial.items.map((node) => node.id), results.map((node) => node.id));
  assert.equal(partial.index, 2);

  // The active result itself can be absent from a same-canvas snapshot too;
  // the preview snapshot remains navigable until an explicit delete closes it.
  const missingCurrent = mediaNavigationFromContext([source, results[0], results[1], results[3]], results[2], context);
  assert.deepEqual(missingCurrent.items.map((node) => node.id), results.map((node) => node.id));
  assert.equal(missingCurrent.index, 2);

  // A later refresh uses canonical nodes and their latest URLs when available.
  const refreshedNodes = [source, ...results].map((node) => node.type === "image"
    ? { ...node, image: `https://media.example/refreshed/${node.id}.png` }
    : node);
  const refreshed = mediaNavigationFromContext(refreshedNodes, results[2], context);
  assert.equal(refreshed.items[0].image, "https://media.example/refreshed/result-0.png");
});

test("explicitly removed gallery nodes do not reappear from their saved snapshots", () => {
  const source = { id: "source", type: "prompt", generationBatchId: "batch-1" };
  const results = Array.from({ length: 3 }, (_, index) => ({
    id: `result-${index}`,
    type: "image",
    image: `https://media.example/${index}.png`,
    resultOf: source.id,
    resultBatchId: "batch-1",
    resultIndex: index,
  }));
  const opened = mediaNavigation([source, ...results], [], results[1]);
  const context = createMediaNavigationContext(opened);
  const afterRemoval = removeMediaNavigationSnapshots(context, [results[0].id]);
  const remaining = mediaNavigationFromContext([source, results[1], results[2]], results[1], afterRemoval);

  assert.deepEqual(remaining.items.map((node) => node.id), ["result-1", "result-2"]);
  assert.equal(remaining.index, 0);
});
