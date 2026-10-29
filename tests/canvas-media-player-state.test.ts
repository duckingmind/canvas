import assert from "node:assert/strict";
import test from "node:test";
import { displayedMediaTime, finiteMediaDuration, mediaPlaybackError, mediaPlayButtonLabel, nextAudioPlaybackRate } from "../src/canvas-media-player-state.ts";

test("uses a finite duration and falls back to the last seekable end for unknown-length audio", () => {
  assert.equal(finiteMediaDuration({ duration: 18.75, seekable: { length: 0, end: () => 0 } }), 18.75);
  assert.equal(finiteMediaDuration({ duration: Infinity, seekable: { length: 2, end: index => [8, 24.5][index] } }), 24.5);
  assert.equal(finiteMediaDuration({ duration: Infinity, seekable: { length: 0, end: () => 0 } }), 0);
  assert.equal(finiteMediaDuration({ duration: Infinity, seekable: { length: 1, end: () => { throw new RangeError(); } } }), 0);
});

test("keeps elapsed playback time visible while total duration is unknown", () => {
  assert.equal(displayedMediaTime(12.8, 0), 12.8);
  assert.equal(displayedMediaTime(12.8, Number.NaN), 12.8);
  assert.equal(displayedMediaTime(12.8, 8), 8);
  assert.equal(displayedMediaTime(-2, 0), 0);
  assert.equal(displayedMediaTime(Number.NaN, 0), 0);
});

test("cycles through supported audio playback rates", () => {
  assert.deepEqual([1, 1.25, 1.5, 2, 0.75].map(nextAudioPlaybackRate), [1.25, 1.5, 2, 0.75, 1]);
  assert.equal(nextAudioPlaybackRate(1.1), 0.75);
});

test("labels the audio control as replay after playback ends", () => {
  assert.equal(mediaPlayButtonLabel(true, false), "播放");
  assert.equal(mediaPlayButtonLabel(false, false), "暂停");
  assert.equal(mediaPlayButtonLabel(true, true), "重新播放");
});

test("turns common browser playback failures into actionable messages", () => {
  assert.match(mediaPlaybackError({ name: "NotAllowedError" }), /点击播放/);
  assert.match(mediaPlaybackError({ name: "NotSupportedError" }), /不支持此音频格式/);
  assert.match(mediaPlaybackError({ name: "NotSupportedError" }, "video"), /不支持此视频格式/);
  assert.match(mediaPlaybackError(), /重新加载/);
});
