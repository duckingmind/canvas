import assert from "node:assert/strict";
import test from "node:test";
import {
  creationInputSignature,
  placeCreatorPanel,
} from "../src/creation-state.ts";

const input = {
  prompt: "柔和的午后光线",
  model: "image-model",
  references: [{ nodeId: "source", image: "https://example.test/image.png" }],
};

test("input fingerprints track text, model, replacement images and ordered references", () => {
  const initial = creationInputSignature(input);
  for (const changed of [
    { ...input, prompt: "柔和的清晨光线" },
    { ...input, model: "another-model" },
    { ...input, references: [{ nodeId: "source", image: "replacement" }] },
    { ...input, references: [{ nodeId: "other", image: input.references[0].image }] },
    { ...input, references: [] },
  ]) {
    assert.notEqual(creationInputSignature(changed), initial);
  }
  const references = [
    ...input.references,
    { nodeId: "second", image: "second image" },
  ];
  assert.notEqual(
    creationInputSignature({ ...input, references }),
    creationInputSignature({ ...input, references: [...references].reverse() }),
  );
  assert.equal(creationInputSignature(structuredClone(input)), initial);
  assert.equal(creationInputSignature({ ...input, prompt: ` ${input.prompt}\n` }), initial);
});

test("input fingerprints include the frozen image output format", () => {
  const png = creationInputSignature({ ...input, settings: { outputFormat: "png" } });
  const webp = creationInputSignature({ ...input, settings: { outputFormat: "webp" } });
  assert.notEqual(png, webp);
  assert.equal(png, creationInputSignature({ ...input, settings: { outputFormat: "png" } }));
});

test("input fingerprints track local video and audio references", () => {
  const localVideo = "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789abc";
  const localAudio = "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789abc";
  const video = creationInputSignature({ ...input, references: [{ nodeId: "video", localVideo }] });
  const audio = creationInputSignature({ ...input, references: [{ nodeId: "audio", localAudio }] });
  assert.notEqual(video, audio);
  assert.notEqual(video, creationInputSignature({ ...input, references: [{ nodeId: "video", localVideo: "replacement" }] }));
});

test("ignored images, layout changes and cached copies do not mark inputs changed", () => {
  const ignored = creationInputSignature({ ...input, ignoreImageRefs: true });
  assert.equal(
    creationInputSignature({
      ...input,
      ignoreImageRefs: true,
      references: [{ nodeId: "replacement", localImage: "cache-2" }],
    }),
    ignored,
  );
  assert.equal(ignored, creationInputSignature({ ...input, references: [] }));
  assert.notEqual(ignored, creationInputSignature(input));
  const moved = {
    ...input,
    x: -240,
    y: 500,
    title: "Renamed node",
    references: [{ ...input.references[0], localImage: "cache", x: 999 }],
  };
  assert.equal(creationInputSignature(moved), creationInputSignature(input));
  assert.notEqual(
    creationInputSignature({ ...input, references: [{ nodeId: "source", localImage: "a" }] }),
    creationInputSignature({ ...input, references: [{ nodeId: "source", localImage: "b" }] }),
  );
});

test("input fingerprints are compact and distinguish field boundaries", () => {
  const image = `data:image/png;base64,${"A".repeat(500_000)}`;
  const signature = creationInputSignature({
    ...input,
    references: [{ nodeId: "large", image }],
  });
  assert.match(signature, /^v1:[0-9a-f]{16}$/);
  assert.notEqual(
    creationInputSignature({ ...input, prompt: "ab", model: "c" }),
    creationInputSignature({ ...input, prompt: "a", model: "bc" }),
  );
});

test("desktop creator follows the selected image and respects its actual screen dimensions", () => {
  const placement = placeCreatorPanel(
    { x: 340, y: 110, width: 360, height: 180 },
    { width: 1200, height: 900 },
  );
  assert.deepEqual(placement, {
    left: 240,
    top: 304,
    width: 560,
  });
});

test("mobile creator stays centered on the selected node", () => {
  const placement = placeCreatorPanel(
    { x: 100, y: 30, width: 240, height: 180 },
    { width: 390, height: 844 },
  );
  assert.deepEqual(placement, {
    left: 37,
    top: 224,
    width: 366,
  });
});

test("panned nodes keep the creator attached instead of viewport clamping", () => {
  for (const width of [390, 700, 901, 1200]) {
    for (const height of [390, 720]) {
      for (const x of [-3000, -100, 200, 3000]) {
        for (const y of [-3000, -100, 200, 3000]) {
          const placement = placeCreatorPanel(
            { x, y, width: 400, height: 230 },
            { width, height },
          );
          const expectedCenter = x + 200;
          assert.equal(placement.left + placement.width / 2, expectedCenter);
          assert.equal(placement.top, y + 230 + 14);
        }
      }
    }
  }
});

test("board height does not compress or reposition the editor", () => {
  const initial = placeCreatorPanel(
    { x: 700, y: 500, width: 320, height: 180 },
    { width: 901, height: 720 },
    { width: 620 },
  );
  assert.deepEqual(initial, { left: 550, top: 694, width: 620 });
  for (const height of [80, 390, 900, 2000]) {
    assert.deepEqual(placeCreatorPanel(
      { x: 700, y: 500, width: 320, height: 180 },
      { width: 901, height },
      { width: 620 },
    ), initial);
  }
});

test("placement handles tiny boards and invalid dimensions safely", () => {
  for (const board of [
    { width: 390, height: 80 },
    { width: 10, height: 10 },
    { width: NaN, height: Infinity },
  ]) {
    const placement = placeCreatorPanel(
      { x: NaN, y: Infinity, width: -1, height: -1 },
      board,
    );
    for (const field of ["left", "top", "width"] as const) {
      assert.ok(Number.isFinite(placement[field]));
    }
    assert.ok(placement.width >= 0);
  }
});

test("screen-space creator placement uses the zoomed node anchor but keeps a fixed panel size", () => {
  const atZoomOut = placeCreatorPanel({ x: 420, y: 180, width: 160, height: 120 }, { width: 1200, height: 800 }, { width: 540 });
  const atZoomIn = placeCreatorPanel({ x: 840, y: 360, width: 320, height: 240 }, { width: 1200, height: 800 }, { width: 540 });
  assert.deepEqual(atZoomOut, { left: 230, top: 314, width: 540 });
  assert.deepEqual(atZoomIn, { left: 730, top: 614, width: 540 });
});

test("editor position tracks node pan deltas in screen space", () => {
  const before = placeCreatorPanel(
    { x: 180, y: 120, width: 240, height: 100 },
    { width: 1200, height: 900 },
    { width: 500 },
  );
  const after = placeCreatorPanel(
    { x: 245, y: 165, width: 240, height: 100 },
    { width: 1200, height: 900 },
    { width: 500 },
  );
  assert.equal(after.left - before.left, 65);
  assert.equal(after.top - before.top, 45);
});

test("editor remains below the target when the target is near the bottom edge", () => {
  const placement = placeCreatorPanel(
    { x: 300, y: 700, width: 240, height: 120 },
    { width: 1200, height: 900 },
    { width: 500 },
  );
  assert.equal(placement.top, 834);
  assert.deepEqual(placement, { left: 170, top: 834, width: 500 });
});
