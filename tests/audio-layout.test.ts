import assert from "node:assert/strict";
import test from "node:test";
import { compactAudioPromptSize, DEFAULT_AUDIO_NODE_SIZE, isLegacyAudioNodeSize } from "../src/audio-layout.ts";

test("legacy audio creator dimensions migrate to the compact card", () => {
  assert.equal(isLegacyAudioNodeSize(300, 180), true);
  assert.equal(isLegacyAudioNodeSize(480, 270), true);
  assert.equal(isLegacyAudioNodeSize(360, 360), true);
  assert.deepEqual(compactAudioPromptSize(480, 270, true), DEFAULT_AUDIO_NODE_SIZE);
  assert.deepEqual(compactAudioPromptSize(360, 360, true), DEFAULT_AUDIO_NODE_SIZE);
});

test("custom audio dimensions and unfinished tasks are preserved", () => {
  assert.equal(compactAudioPromptSize(420, 220, true), undefined);
  assert.equal(compactAudioPromptSize(480, 270, false), undefined);
});
