import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogMusicModels,
  compatibleMusicModels,
  musicModels,
  musicModelUnavailableReason,
  musicOptions,
  preferredMusicModel,
  resolveMusicSettings,
  type MusicModel,
} from "../src/music-models.ts";

test("catalog shows cover models with a reason while filtering the separate voice workflow", () => {
  const catalog = catalogMusicModels({ data: [
    { id: "minimax-music-3.0", audio_modes: ["song", "instrumental"], supported_input_modes: ["text", "lyrics"], is_default: true },
    { id: "minimax-voice-design", supported_input_modes: ["text"], supported_parameters: { preview_text: { type: "string" } } },
    { id: "minimax-music-cover", supported_input_modes: ["reference_audio"], audio_modes: ["song"] },
    { id: "supplier-voice-design-v2", name: "Voice Design", audio_modes: ["song"] },
    { id: "supplier-cover", name: "Music Cover", supported_input_modes: ["reference_audio"] },
    null,
  ] });

  assert.deepEqual(musicModels(catalog).map(model => model.id), ["minimax-music-3.0", "minimax-music-cover", "supplier-cover"]);
  assert.deepEqual(compatibleMusicModels(catalog).map(model => model.id), ["minimax-music-3.0"]);
  assert.equal(preferredMusicModel(catalog)?.id, "minimax-music-3.0");
  assert.equal(musicModelUnavailableReason(catalog.find(model => model.id === "minimax-music-cover")!), "请先添加参考音频");
  assert.deepEqual(musicModels([{ id: "video", type: "video" }]), []);
});

test("music catalog accepts flat and nested capability contracts", () => {
  const flat: MusicModel = {
    id: "flat", type: "audio", supported_operations: ["generation"],
    supported_input_modes: ["text", "lyrics"], audio_modes: ["song"], output_formats: ["mp3"],
  };
  const nested: MusicModel = {
    id: "nested", type: "audio", platform_capabilities: {
      supported_operations: ["generation"], supported_input_modes: ["text"], audio_modes: ["instrumental"], output_formats: ["wav"],
    },
  };
  const referenceOnly: MusicModel = { id: "reference-only", type: "audio", supported_input_modes: ["reference_audio"] };

  assert.deepEqual(compatibleMusicModels([flat, nested, referenceOnly]), [flat, nested]);
  assert.equal(musicModelUnavailableReason(referenceOnly), "请先添加参考音频");
});

test("speech models cannot become music fallbacks in a mixed audio catalog", () => {
  const song: MusicModel = { id: "minimax-music-3.0", type: "audio", supported_input_modes: ["text"] };
  const speech: MusicModel[] = [
    { id: "minimax-speech-2.8-hd", type: "audio", is_default: true },
    { id: "supplier-tts", type: "audio", supported_input_modes: ["text"] },
    { id: "supplier-audio", type: "audio", platform_capabilities: { supported_parameters: { text: {}, voice_setting: {} } } },
  ];
  assert.deepEqual(musicModels([...speech, song]), [song]);
  assert.deepEqual(compatibleMusicModels(speech), []);
  assert.equal(preferredMusicModel([...speech, song]), song);
});

test("declared durations, defaults, and modes stay within the model contract", () => {
  const model: MusicModel = {
    id: "bounded", type: "audio", audio_modes: ["song", "instrumental"], output_formats: ["mp3", "wav"],
    duration_constraints: { min_seconds: 10, max_seconds: 14, step_seconds: 2 },
    default_parameters: { audio_mode: "instrumental", output_format: "wav", duration: 12 },
  };
  assert.deepEqual(musicOptions(model).durations, ["10", "12", "14"]);
  assert.deepEqual(resolveMusicSettings(model, { audio_mode: "unsupported", output_format: "ogg", duration: 99 }), {
    audio_mode: "instrumental", output_format: "wav", duration: 12,
  });

  const miniMax = { id: "minimax-music-3.0", type: "audio", audio_modes: ["song", "instrumental"], output_formats: ["mp3"], default_parameters: { output_format: "mp3" } };
  assert.deepEqual(musicOptions(miniMax).durations, []);
  assert.deepEqual(resolveMusicSettings(miniMax, {}), { output_format: "mp3", audio_mode: "song" });
});

test("explicit text-only capability is required to expose a model-specific input workflow", () => {
  const model = { id: "audio-input-missing", type: "audio", supported_input_modes: ["reference_audio"], audio_modes: ["song"] };
  assert.equal(musicModelUnavailableReason(model), "请先添加参考音频");
  assert.deepEqual(compatibleMusicModels([model]), []);
});


test("cover models become selectable only when a reference is attached", () => {
  const cover: MusicModel = { id: "minimax-music-cover", type: "audio", supported_operations: ["generation"], supported_input_modes: ["reference_audio"] };
  const text: MusicModel = { id: "text", type: "audio", supported_input_modes: ["text"] };
  assert.deepEqual(compatibleMusicModels([cover, text], "reference_audio"), [cover]);
  assert.equal(musicModelUnavailableReason(cover, "reference_audio"), "");
  assert.equal(musicModelUnavailableReason(text, "reference_audio"), "不支持参考音频");
});
