import assert from "node:assert/strict";
import test from "node:test";
import {
  base64PayloadFromDataUrl,
  MUSIC_REFERENCE_AUDIO_MAX_BYTES,
  MUSIC_REFERENCE_AUDIO_MAX_SECONDS,
  MUSIC_REFERENCE_AUDIO_MIN_SECONDS,
  MusicReferenceAudioError,
  validateMusicReferenceAudio,
} from "../src/music-reference-audio.ts";

test("music reference audio accepts the documented duration and byte limits", () => {
  validateMusicReferenceAudio({ size: MUSIC_REFERENCE_AUDIO_MAX_BYTES, type: "audio/mpeg" }, MUSIC_REFERENCE_AUDIO_MIN_SECONDS);
  validateMusicReferenceAudio({ size: 1, name: "reference.wav" }, MUSIC_REFERENCE_AUDIO_MAX_SECONDS);
});

test("music reference audio rejects empty, oversized and out-of-range files", () => {
  for (const [file, duration, code] of [
    [{ size: 0 }, MUSIC_REFERENCE_AUDIO_MIN_SECONDS, "MUSIC_REFERENCE_AUDIO_EMPTY"],
    [{ size: MUSIC_REFERENCE_AUDIO_MAX_BYTES + 1 }, MUSIC_REFERENCE_AUDIO_MIN_SECONDS, "MUSIC_REFERENCE_AUDIO_TOO_LARGE"],
    [{ size: 1 }, MUSIC_REFERENCE_AUDIO_MIN_SECONDS - 0.01, "MUSIC_REFERENCE_AUDIO_DURATION_OUT_OF_RANGE"],
    [{ size: 1 }, MUSIC_REFERENCE_AUDIO_MAX_SECONDS + 0.01, "MUSIC_REFERENCE_AUDIO_DURATION_OUT_OF_RANGE"],
    [{ size: 1 }, Number.NaN, "MUSIC_REFERENCE_AUDIO_DURATION_INVALID"],
  ] as const) {
    assert.throws(() => validateMusicReferenceAudio(file, duration), error =>
      error instanceof MusicReferenceAudioError && error.code === code,
    );
  }
});

test("base64 extraction strips the data URL metadata and rejects malformed input", () => {
  assert.equal(base64PayloadFromDataUrl("data:audio/mpeg;base64,SUQzAA=="), "SUQzAA==");
  assert.throws(() => base64PayloadFromDataUrl("blob:https://example.test/audio"), { code: "MUSIC_REFERENCE_AUDIO_ENCODING_INVALID" });
  assert.throws(() => base64PayloadFromDataUrl("data:audio/mpeg;base64,"), { code: "MUSIC_REFERENCE_AUDIO_ENCODING_INVALID" });
});
