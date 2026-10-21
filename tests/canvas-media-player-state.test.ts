import assert from "node:assert/strict";
import test from "node:test";
import { finiteMediaDuration, mediaPlaybackError, nextAudioPlaybackRate } from "../src/canvas-media-player-state.ts";

test("uses a finite duration and falls back to the last seekable end for unknown-length audio", () => {
  assert.equal(finiteMediaDuration({ duration: 18.75, seekable: { length: 0, end: () => 0 } }), 18.75);
  assert.equal(finiteMediaDuration({ duration: Infinity, seekable: { length: 2, end: index => [8, 24.5][index] } }), 24.5);
  assert.equal(finiteMediaDuration({ duration: Infinity, seekable: { length: 0, end: () => 0 } }), 0);
  assert.equal(finiteMediaDuration({ duration: Infinity, seekable: { length: 1, end: () => { throw new RangeError(); } } }), 0);
});

test("cycles through supported audio playback rates", () => {
  assert.deepEqual([1, 1.25, 1.5, 2, 0.75].map(nextAudioPlaybackRate), [1.25, 1.5, 2, 0.75, 1]);
  assert.equal(nextAudioPlaybackRate(1.1), 0.75);
});

test("turns common browser playback failures into actionable messages", () => {
  assert.match(mediaPlaybackError({ name: "NotAllowedError" }), /点击播放/);
  assert.match(mediaPlaybackError({ name: "NotSupportedError" }), /不支持此音频格式/);
  assert.match(mediaPlaybackError({ name: "NotSupportedError" }, "video"), /不支持此视频格式/);
  assert.match(mediaPlaybackError(), /重新加载/);
});
