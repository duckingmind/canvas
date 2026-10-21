import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogVoiceDesignModels,
  compatibleVoiceDesignModels,
  isVoiceDesignModel,
  preferredVoiceDesignModel,
  voiceDesignModelUnavailableReason,
} from "../src/voice-design-models.ts";

test("voice design catalog accepts public shapes and excludes music models", () => {
  const catalog = catalogVoiceDesignModels({ object: "list", data: [
    { id: "minimax-voice-design", type: "audio", supported_operations: ["generation"], supported_input_modes: ["text"], supported_parameters: { prompt: { type: "string" }, preview_text: { type: "string", maxLength: 500 } }, is_default: true },
    { id: "minimax-music-3.0", type: "audio", audio_modes: ["song"] },
    { id: "voice-design-off", type: "audio", available: false, supported_parameters: { preview_text: { type: "string" } } },
    { id: "voice-design-video", type: "video", supported_parameters: { prompt: {}, preview_text: {} } },
    null, {},
  ] });

  assert.deepEqual(catalog.map(model => model.id), ["minimax-voice-design", "minimax-music-3.0", "voice-design-off", "voice-design-video"]);
  assert.deepEqual(compatibleVoiceDesignModels(catalog).map(model => model.id), ["minimax-voice-design"]);
  assert.equal(preferredVoiceDesignModel(catalog)?.id, "minimax-voice-design");
  assert.equal(isVoiceDesignModel(catalog[0]), true);
  assert.equal(voiceDesignModelUnavailableReason(catalog[2]), "暂不可用");
});

test("catalog parser handles direct and items lists plus nested capabilities", () => {
  const direct = catalogVoiceDesignModels([
    { id: "custom-voice", platform_capabilities: { supported_operations: ["generation"], supported_input_modes: ["text"], supported_parameters: { prompt: {}, preview_text: {} } } },
    { id: "song", supported_parameters: { lyrics: {} } },
  ]);
  const items = catalogVoiceDesignModels({ items: [{ id: "voice-design-v2", supported_operations: ["generation"], supported_parameters: { prompt: {}, preview_text: {} } }] });
  assert.equal(compatibleVoiceDesignModels(direct)[0].id, "custom-voice");
  assert.equal(compatibleVoiceDesignModels(items)[0].id, "voice-design-v2");
  assert.equal(voiceDesignModelUnavailableReason({ id: "text-voice", type: "audio", supported_operations: ["generation"], supported_input_modes: ["reference_audio"], supported_parameters: { prompt: {}, preview_text: {} } }), "不支持文字描述");
});
