import assert from "node:assert/strict";
import test from "node:test";
import { estimatedCostLabel, estimatedCostReason, mediaEstimateRequest, readCostEstimate, readCostEstimateError } from "../src/cost-estimate.ts";
import { resolveImageSettings } from "../src/image-models.ts";
import { resolveVideoSettings } from "../src/video-models.ts";
import { generateImage } from "../src/generation.ts";
import { generateVideo } from "../src/video-generation.ts";

test("image estimation matches both generation JSON and edit multipart pricing parameters", async () => {
  const model = {
    id: "image-model", quality_modes: ["high"], resolution_tiers: ["2k"],
    supported_aspect_ratios: ["16:9"], output_formats: ["webp"], max_output_count: 4,
    default_parameters: { quality_mode: "high", resolution_tier: "2k", aspect_ratio: "16:9", n: 3 },
  };
  const settings = resolveImageSettings(model, { size: "1024x1024" });
  for (const referenceCount of [0, 2]) {
    const estimate = mediaEstimateRequest({ model: model.id, kind: "image", settings, referenceCount });
    assert.deepEqual(estimate, {
      model: model.id, model_type: "image", operation: referenceCount ? "edit" : "generation",
      parameters: { n: 3, quality_mode: "high", resolution_tier: "2k", aspect_ratio: "16:9", output_format: "webp", input_image_count: referenceCount },
    });
    await generateImage(async (path, init) => {
      assert.equal(path, referenceCount ? "/images/edits" : "/images/generations");
      const body = init?.body instanceof FormData
        ? Object.fromEntries([...init.body.entries()].filter(([, value]) => typeof value === "string"))
        : JSON.parse(String(init?.body));
      const { input_image_count, ...parameters } = estimate.parameters;
      assert.equal(input_image_count, referenceCount);
      for (const [key, value] of Object.entries(parameters)) assert.equal(String(body[key]), String(value));
      assert.equal(body.size, undefined, "obsolete explicit size must not override tier + ratio");
      assert.equal(body.response_format, "url", "generation still requests URL delivery");
      return { data: [{ url: "https://cdn.example/image.webp" }] };
    }, {
      model: model.id, prompt: "提交用提示词", count: settings.count, size: settings.size,
      qualityMode: settings.quality, resolutionTier: settings.resolution, aspectRatio: settings.aspectRatio,
      outputFormat: settings.outputFormat,
      images: referenceCount ? ["https://cdn.example/ref1.png", "https://cdn.example/ref2.png"] : [],
    }, undefined, { loadReference: async () => new Blob(["test-image"], { type: "image/png" }) });
  }
});

test("video estimation matches resolved audio, duration and image references without sending URLs", async () => {
  const model = {
    id: "video-model", supported_operations: ["generation"], supported_resolutions: ["720p", "1080p"],
    supported_aspect_ratios: ["16:9", "9:16"], supports_audio_generation: true,
    duration_constraints: { min_seconds: 4, max_seconds: 8, step_seconds: 2 },
    default_parameters: { duration: 6, resolution: "1080p", aspect_ratio: "9:16", generate_audio: false },
  };
  const settings = resolveVideoSettings(model, {});
  const estimate = mediaEstimateRequest({ model: model.id, kind: "video", settings, referenceCount: 1 });
  assert.deepEqual(estimate, {
    model: model.id, model_type: "video", operation: "generation",
    parameters: { generate_audio: true, duration: 6, resolution: "1080p", aspect_ratio: "9:16", input_image_count: 1 },
  });
  await generateVideo(async (path, init) => {
    assert.equal(path, "/videos");
    const { model: submittedModel, prompt, input_references, ...parameters } = JSON.parse(String(init?.body));
    assert.equal(submittedModel, model.id);
    assert.equal(prompt, "视频提示词");
    assert.deepEqual({ ...parameters, input_image_count: input_references.length }, estimate.parameters);
    return { id: "video-test", status: "completed" };
  }, { model: model.id, prompt: "视频提示词", ...settings, images: ["https://cdn.example/ref.png"] });
});

test("video estimation preserves an explicit audio false rather than dropping it", () => {
  assert.equal(mediaEstimateRequest({ model: "video", kind: "video", settings: { generate_audio: false }, referenceCount: 0 }).parameters.generate_audio, false);
});

test("default images can be estimated before a prompt, without inventing unsupported dimensions", () => {
  assert.deepEqual(mediaEstimateRequest({ model: "minimal", kind: "image", settings: resolveImageSettings({}), referenceCount: 0 }), {
    model: "minimal", model_type: "image", operation: "generation", parameters: { n: 1, input_image_count: 0 },
  });
});

test("unknown and malformed prices stay unavailable, while an explicitly known free request is valid", () => {
  for (const value of [null, {}, { known: false, amount: 0, currency: "USD" }, { known: true, amount: null, currency: "USD" },
    { known: true, amount: NaN, currency: "USD" }, { known: true, amount: -1, currency: "USD" },
    { known: true, amount: 0.12 }, { known: true, amount: 0.12, currency: "invalid" }]) {
    assert.deepEqual(readCostEstimate(value), { status: "unavailable" });
  }
  assert.deepEqual(readCostEstimate({ known: true, amount: 0, currency: "USD" }), { status: "ready", amount: 0, currency: "USD" });
});

test("unavailable estimates preserve the server reason and show an actionable label", () => {
  const estimate = readCostEstimate({
    estimated: true,
    known: false,
    amount: null,
    pricing_source: "unavailable",
    reason_code: "no_eligible_provider",
  });
  assert.deepEqual(estimate, { status: "unavailable", reasonCode: "no_eligible_provider" });
  assert.equal(estimatedCostReason(estimate), "暂无匹配的供应商");
  assert.equal(estimatedCostLabel(estimate), "暂无匹配的供应商");
});

test("SDK failures keep their code instead of becoming an indistinguishable empty quote", () => {
  const estimate = readCostEstimateError({
    code: "CREDENTIAL_INVALID",
    status: 401,
    details: { error: { code: "CREDENTIAL_INVALID" } },
  });
  assert.deepEqual(estimate, { status: "error", reasonCode: "credential_invalid" });
  assert.equal(estimatedCostLabel(estimate), "平台授权已失效，请重新连接账户");
  assert.equal(readCostEstimateError({ status: 503 }).reasonCode, "service_unavailable");
});

test("currency formatting retains small costs, genuine zero and the returned currency", () => {
  assert.equal(estimatedCostLabel({ status: "ready", amount: 0.00001, currency: "USD" }), "参考 US$0.00001");
  assert.equal(estimatedCostLabel({ status: "ready", amount: 0.0000001, currency: "USD" }), "参考 <US$0.000001");
  assert.equal(estimatedCostLabel({ status: "ready", amount: 0, currency: "USD" }), "参考 US$0.00");
  assert.equal(estimatedCostLabel({ status: "ready", amount: 1.2, currency: "CNY" }), "参考 ¥1.20");
  assert.equal(estimatedCostLabel({ status: "loading" }), "估算中…");
  assert.equal(estimatedCostLabel({ status: "unavailable" }), "暂无法估价");
});
