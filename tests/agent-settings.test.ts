import assert from "node:assert/strict";
import test from "node:test";
import { configureGeneration, generationParameters } from "../src/agent-settings.ts";

const node = {
  id: "agent-music", type: "prompt" as const, mediaType: "audio" as const,
  title: "", text: "A song", x: 0, y: 0, width: 320, height: 240, color: "",
  modelId: "agent-music",
};

test("voice design is not exposed as a generic music capability", () => {
  const model = {
    id: "minimax-voice-design", type: "audio", available: true,
    supported_input_modes: ["text"], supported_parameters: { preview_text: { type: "string" } },
  };
  assert.equal(generationParameters(model).music, null);
  assert.throws(
    () => configureGeneration(node, model, { music_settings: { audio_mode: "song" } }),
    { code: "CANVAS_MODEL_UNAVAILABLE" },
  );
});

test("reference-audio cover models stay outside the text music agent workflow", () => {
  const model = {
    id: "minimax-music-cover", type: "audio", available: true,
    supported_input_modes: ["reference_audio"], audio_modes: ["song"], output_formats: ["mp3"],
  };
  assert.equal(generationParameters(model).music, null);
  assert.throws(
    () => configureGeneration(node, model, { music_settings: { audio_mode: "song" } }),
    { code: "CANVAS_MODEL_UNAVAILABLE" },
  );
});
