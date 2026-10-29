import assert from "node:assert/strict";
import test from "node:test";
import { imageAspectRatios, imageOptions, imageQualityLabel, imageSettingsSummary, resolveImageSettings, type ImageModel } from "../src/image-models.ts";

const model: ImageModel = {
  quality_modes: ["auto", "low", "medium", "high"],
  resolution_tiers: ["1k", "2k", "4k"],
  supported_aspect_ratios: ["1:1", "3:2", "16:9"],
  output_formats: ["png", "webp"],
  supported_sizes: ["1024x1024", "1536x1024", "2048x2048", "2048x1152", "3840x2160"],
  resolution_sizes: {
    "1k": ["1024x1024", "1536x1024"],
    "2k": ["2048x2048", "2048x1152"],
    "4k": ["3840x2160"],
  },
  max_output_count: 4,
  default_parameters: { quality_mode: "medium", resolution_tier: "2k", aspect_ratio: "16:9", size: "2048x1152", output_format: "webp", n: 2 },
};

test("image parameters prefer high quality and leave size derivation to the platform", () => {
  assert.deepEqual(imageOptions(model).qualities, ["high", "medium", "low"]);
  assert.deepEqual(resolveImageSettings(model), { quality: "high", resolution: "2k", aspectRatio: "16:9", outputFormat: "webp", count: 2 });
  assert.equal(imageSettingsSummary(resolveImageSettings(model)), "16:9 · 高画质 · 2K · 2 张");
});

test("known quality modes use Chinese labels while custom modes keep their published names", () => {
  assert.equal(imageQualityLabel("high"), "高画质");
  assert.equal(imageQualityLabel("MEDIUM"), "标准画质");
  assert.equal(imageQualityLabel("low"), "低画质");
  assert.equal(imageQualityLabel("studio-v3"), "studio-v3");
});

test("unsupported quality, tier, ratio and count are reconciled on model change", () => {
  assert.deepEqual(resolveImageSettings(model, { quality: "extreme", resolution: "8k", aspectRatio: "9:21", size: "1024x1024", count: 20 }), { quality: "high", resolution: "2k", aspectRatio: "16:9", outputFormat: "webp", count: 4 });
  assert.deepEqual(resolveImageSettings({ quality_modes: [], max_output_count: 1 }, { quality: "high", resolution: "4k", count: 4 }), { count: 1 });
});

test("ratios follow the published resolution-size mapping", () => {
  assert.deepEqual(imageAspectRatios(model, "1k"), ["1:1", "3:2"]);
  assert.deepEqual(resolveImageSettings(model, { resolution: "1k", aspectRatio: "16:9" }), { quality: "high", resolution: "1k", aspectRatio: "1:1", outputFormat: "webp", count: 2 });
  assert.deepEqual(imageAspectRatios(model, "4k"), ["16:9"]);
});

test("nested capability catalogs and size-only models remain usable", () => {
  assert.equal(imageOptions({ platform_capabilities: { ...model } }).maxCount, 4);
  assert.deepEqual(resolveImageSettings({ supported_sizes: ["512x512", "1024x1024"], default_parameters: { size: "1024x1024" } }), { size: "1024x1024", count: 1 });
  assert.deepEqual(resolveImageSettings(undefined), { count: 1 });
});

test("model-level capability fields override nested snapshots, including explicit empty lists", () => {
  const modelWithOverride: ImageModel = {
    quality_modes: [],
    platform_capabilities: { quality_modes: ["legacy"], supported_aspect_ratios: ["1:1"], max_output_count: 8 },
    max_output_count: 8,
  };
  const options = imageOptions(modelWithOverride);
  assert.deepEqual(options.qualities, []);
  assert.equal(options.maxCount, 8);
  assert.deepEqual(options.countOptions, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("supplier tier projection narrows explicitly but null retains platform tiers", () => {
  assert.deepEqual(imageOptions({ ...model, available_resolution_tiers: ["1k"] }).resolutions, ["1k"]);
  assert.deepEqual(imageOptions({ ...model, available_resolution_tiers: [] }).resolutions, []);
  assert.deepEqual(imageOptions({ ...model, available_resolution_tiers: null }).resolutions, model.resolution_tiers);
});

test("output format follows a declared capability and never invents one", () => {
  assert.deepEqual(
    resolveImageSettings({ output_formats: ["png"], default_parameters: { output_format: "png" } }, { outputFormat: "webp" }),
    { outputFormat: "png", count: 1 },
  );
  assert.deepEqual(
    resolveImageSettings({ output_formats: ["png", "webp"], default_parameters: { output_format: "WEBP" } }, { outputFormat: "PNG" }),
    { outputFormat: "png", count: 1 },
  );
  assert.deepEqual(
    resolveImageSettings({ default_parameters: { output_format: "png" } }),
    { count: 1 },
  );
  assert.deepEqual(
    imageOptions({ platform_capabilities: { output_formats: ["PNG", "webp"] } }).outputFormats,
    ["png", "webp"],
  );
});

test("backend-provided quality labels are exposed without inventing frontend labels", () => {
  const options = imageOptions({
    quality_modes: ["standard", "pro"],
    parameter_options: {
      image_qualities: [
        { value: "standard", label: "标准画质" },
        { value: "pro", label: "极致画质" },
      ],
    },
  });
  assert.deepEqual(options.qualityLabels, { standard: "标准画质", pro: "极致画质" });
});

test("quality modes hide auto, sort standard tiers, and retain custom modes after them", () => {
  const options = imageOptions({
    quality_modes: ["studio-v3", "low", "auto", "medium", "high", "ultra"],
    default_parameters: { quality_mode: "studio-v3" },
  });
  assert.deepEqual(options.qualities, ["high", "medium", "low", "studio-v3", "ultra"]);
  assert.equal(resolveImageSettings({
    quality_modes: ["auto", "low", "medium", "high"],
    default_parameters: { quality_mode: "medium" },
  }).quality, "high");
  assert.equal(resolveImageSettings({
    quality_modes: ["auto", "medium", "low"],
    default_parameters: { quality_mode: "medium" },
  }).quality, "medium");
  assert.equal(resolveImageSettings({
    quality_modes: ["auto"],
    default_parameters: { quality_mode: "auto" },
  }).quality, undefined);
  assert.equal(resolveImageSettings({ quality_modes: ["auto", "low", "high"] }, { quality: "auto" }).quality, "high");
});
