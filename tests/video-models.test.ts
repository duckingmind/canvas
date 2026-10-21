import assert from "node:assert/strict";
import test from "node:test";
import { catalogModels, compatibleModels, mediaReferenceLimit, modelUnavailableReason, normalizeVideoModel, preferredModel, preferredModelForNode, resolveVideoSettings, selectedModelIdForNode, videoOptions, type MediaModel } from "../src/video-models.ts";

test("preferred model honors the platform default marker", () => {
  const models: MediaModel[] = [
    { id: "first", type: "image", supported_operations: ["generation"], supported_input_modes: ["text"] },
    { id: "default", type: "image", is_default: true, supported_operations: ["generation"], supported_input_modes: ["text"] },
  ];
  assert.equal(preferredModel(models, "image")?.id, "default");
});

test("catalog parsing keeps the platform default marker for image models", () => {
  const models = catalogModels({ data: [
    { id: "gpt-image-2", type: "image" },
    { id: "gpt-image-2.5", type: "image", is_default: true },
  ] }, "image");
  assert.equal(preferredModel(models, "image")?.id, "gpt-image-2.5");
});

test("idle legacy nodes follow the current platform default", () => {
  const models: MediaModel[] = [
    { id: "gpt-image-2", type: "image", supported_operations: ["generation"], supported_input_modes: ["text"] },
    { id: "gpt-image-2.5", type: "image", is_default: true, supported_operations: ["generation"], supported_input_modes: ["text"] },
  ];
  const legacy = { modelId: "gpt-image-2", type: "prompt", status: "idle" };
  assert.equal(selectedModelIdForNode(legacy), undefined);
  assert.equal(preferredModelForNode(models, "image", 0, legacy)?.id, "gpt-image-2.5");
});

test("explicit choices and durable tasks keep their model", () => {
  const explicit = { modelId: "gpt-image-2", modelSelection: "user" as const, status: "idle" };
  const task = { modelId: "gpt-image-2", taskId: "task-1", status: "queued" };
  assert.equal(selectedModelIdForNode(explicit), "gpt-image-2");
  assert.equal(selectedModelIdForNode(task), "gpt-image-2");
});

const capabilities = {
  supported_operations: ["generation"], supported_input_modes: ["text", "reference_image"],
  max_input_images: 2, duration_constraints: { min_seconds: 4, max_seconds: 8, step_seconds: 2 },
  supported_resolutions: ["720p", "1080p"], supported_aspect_ratios: ["16:9", "9:16"],
  supports_audio_generation: true,
  default_parameters: { duration: 6, resolution: "1080p", aspect_ratio: "9:16", generate_audio: false },
};
const nested: MediaModel = { id: "nested", type: "video", platform_capabilities: capabilities };
const flat: MediaModel = { id: "flat", type: "video", ...capabilities };

test("video catalog assigns endpoint type and preserves unavailable models for display", () => {
  const models = catalogModels({ object: "list", data: [{ id: "video", available: false }, null, {}, { id: "" }] }, "video");
  assert.deepEqual(models, [{ id: "video", type: "video", available: false }]);
  assert.deepEqual(compatibleModels(models, "video"), []);
  assert.equal(modelUnavailableReason(models[0], "video"), "暂不可用");
  assert.deepEqual(catalogModels({ items: [{ id: "image" }] }, "image"), [{ id: "image", type: "image" }]);
});

test("both public and nested video capabilities allow two references without mixing image models", () => {
  const image = { id: "image", type: "image", supported_operations: ["generation", "edit"], max_input_images: 3 };
  assert.deepEqual(compatibleModels([nested, flat, image], "video", 2), [nested, flat]);
  assert.deepEqual(compatibleModels([nested, flat, image], "image", 2), [image]);
  assert.equal(mediaReferenceLimit(nested), 2);
  assert.deepEqual(compatibleModels([nested, flat], "video", 3), []);
  assert.equal(modelUnavailableReason(nested, "video", 3), "最多 2 张参考图");
});

test("image edit operation implies reference support when the catalog omits input modes", () => {
  const model = { id: "gpt-image-2", type: "image", supported_operations: ["generation", "edit"] };
  assert.equal(modelUnavailableReason(model, "image", 1), "");
  assert.deepEqual(compatibleModels([model], "image", 1), [model]);
});

test("an omitted reference limit serialized as zero falls back to max input images", () => {
  const model = {
    id: "gpt-image-2",
    type: "image",
    supported_operations: ["generation", "edit"],
    supported_input_modes: ["text", "reference_image"],
    max_reference_images: 0,
    max_input_images: 16,
  };
  assert.equal(mediaReferenceLimit(model), 16);
  assert.equal(modelUnavailableReason(model, "image", 1), "");
});

test("an explicit text-only input mode still overrides the edit operation", () => {
  const model = { id: "image-text-only", type: "image", supported_operations: ["generation", "edit"], supported_input_modes: ["text"] };
  assert.equal(modelUnavailableReason(model, "image", 1), "不支持参考图");
});

test("edit inference is limited to image models when input modes are omitted", () => {
  const model = { id: "video-edit", type: "video", supported_operations: ["generation", "edit"] };
  assert.equal(modelUnavailableReason(model, "video", 1), "不支持参考图");
});

test("explicit text-only and withdrawn reference capability overrides older positive limits", () => {
  const textOnly = { ...nested, supported_input_modes: ["text"] };
  const withdrawn = { ...nested, max_input_images: 0 };
  assert.deepEqual(compatibleModels([textOnly, withdrawn], "video", 1), []);
  assert.deepEqual(compatibleModels([textOnly], "video", 0), [textOnly]);
  assert.equal(mediaReferenceLimit(withdrawn), 0);
  assert.equal(modelUnavailableReason({ ...nested, supported_input_modes: [] }, "video", 1), "不支持参考图");
  assert.equal(modelUnavailableReason({ ...flat, supported_input_modes: ["reference_image"] }, "video", 0), "需要参考图");
});

test("a declared reference input mode works when an older catalog omitted the count limit", () => {
  const model = { id: "legacy-video", type: "video", supported_input_modes: ["text", "reference_image"] };
  assert.deepEqual(compatibleModels([model], "video", 1), [model]);
  assert.equal(mediaReferenceLimit(model), undefined);
});

test("video defaults and parameters agree across nested and public catalog shapes", () => {
  assert.deepEqual(videoOptions(nested), videoOptions(flat));
  assert.deepEqual(videoOptions(nested).durations, ["4", "6", "8"]);
  for (const model of [nested, flat]) {
    assert.deepEqual(resolveVideoSettings(model, {}), { duration: 6, resolution: "1080p", aspect_ratio: "9:16", generate_audio: true });
    assert.deepEqual(resolveVideoSettings(model, { duration: 100, resolution: "4k", size: "1024x1024", aspect_ratio: "4:3" }),
      { duration: 6, resolution: "1080p", aspect_ratio: "9:16", generate_audio: true });
  }
});

test("model changes remove unsupported audio and preserve authoritative empty options", () => {
  const model = { ...nested, supported_resolutions: [], supports_audio_generation: false, duration_constraints: { min_seconds: 4, max_seconds: 8, step_seconds: 0 } };
  assert.deepEqual(videoOptions(model).resolutions, []);
  assert.deepEqual(videoOptions(model).durations, []);
  assert.equal(resolveVideoSettings(model, { generate_audio: true }).generate_audio, undefined);
});

test("catalog values remain authoritative for MiniMax H3", () => {
  const stale: MediaModel = {
    id: "minimax-h3", name: "MiniMax H3", type: "video",
    supported_resolutions: ["480p", "768p", "1080p", "2k"],
    supported_aspect_ratios: ["16:9", "9:16", "1:1"],
    default_parameters: { resolution: "1080p", aspect_ratio: "9:16" },
  };
  const normalized = normalizeVideoModel(stale)!;
  assert.deepEqual(videoOptions(stale).resolutions, ["480p", "768p", "1080p", "2k"]);
  assert.deepEqual(videoOptions(stale).aspectRatios, ["16:9", "9:16", "1:1"]);
  assert.deepEqual(resolveVideoSettings(stale, { resolution: "1080p", aspect_ratio: "2:1" }), {
    resolution: "1080p", aspect_ratio: "9:16",
  });
  assert.deepEqual(catalogModels({ data: [stale] }, "video")[0].supported_resolutions, ["480p", "768p", "1080p", "2k"]);
  assert.deepEqual(normalized.supported_aspect_ratios, ["16:9", "9:16", "1:1"]);
});
