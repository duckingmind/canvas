import assert from "node:assert/strict";
import test from "node:test";
import { createVideoHoverPreview, HOVER_PLAYBACK_RATE } from "../src/video-hover-preview.ts";

function fixture() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  let pauses = 0;
  let plays = 0;
  let playbackRate = 1;
  const media = {
    paused: true,
    muted: false,
    volume: 1,
    get playbackRate() { return playbackRate; },
    set playbackRate(value: number) { playbackRate = value; },
    play() {
      plays++;
      media.paused = false;
      return new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
    },
    pause() { pauses++; media.paused = true; },
  };
  return {
    media,
    controller: createVideoHoverPreview(media),
    get plays() { return plays; },
    get pauses() { return pauses; },
    get resolve() { return resolve; },
    get reject() { return reject; },
  };
}

test("hover plays with sound by default and preserves the user's mute and volume settings", () => {
  for (const [muted, volume] of [[false, 1], [false, 0.35], [true, 0.5], [false, 0]] as const) {
    const f = fixture();
    f.media.muted = muted;
    f.media.volume = volume;
    f.controller.start();
    assert.equal(f.media.muted, muted);
    assert.equal(f.media.volume, volume);
    assert.equal(f.media.playbackRate, HOVER_PLAYBACK_RATE);
    assert.equal(f.plays, 1);
    f.controller.stop();
    assert.equal(f.media.paused, true);
    assert.equal(f.media.muted, muted);
    assert.equal(f.media.volume, volume);
    assert.equal(f.media.playbackRate, 1);
    f.controller.stop();
    assert.equal(f.pauses, 1);
  }
});

test("an already playing video remains entirely under user control", () => {
  const f = fixture();
  f.media.paused = false;
  f.controller.start();
  f.controller.stop();
  assert.equal(f.plays, 0);
  assert.equal(f.pauses, 0);
  assert.equal(f.media.muted, false);
  assert.equal(f.media.playbackRate, 1);
});

test("hover preview restores a user's custom playback speed", () => {
  const f = fixture();
  f.media.playbackRate = 0.75;
  f.controller.start();
  assert.equal(f.media.playbackRate, HOVER_PLAYBACK_RATE);
  f.controller.stop();
  assert.equal(f.media.playbackRate, 0.75);
});

test("manual mute and volume changes survive takeover and departure", async () => {
  const f = fixture();
  f.controller.start();
  f.media.muted = true;
  f.media.volume = 0.3;
  f.controller.takeManualControl();
  assert.equal(f.media.muted, true);
  assert.equal(f.media.volume, 0.3);
  f.controller.stop();
  f.resolve();
  await Promise.resolve();
  assert.equal(f.pauses, 0);
  assert.equal(f.media.paused, false);
  assert.equal(f.media.muted, true);
  assert.equal(f.media.volume, 0.3);
});

test("a late play resolution after departure cannot restart hover playback", async () => {
  const f = fixture();
  f.controller.start();
  f.controller.stop();
  // Model delayed platform playback starting after pointerleave.
  f.media.paused = false;
  f.resolve();
  await Promise.resolve();
  assert.equal(f.media.paused, true);
  assert.equal(f.media.muted, false);
});

test("a stale resolution does not pause a newer hover", async () => {
  const f = fixture();
  f.controller.start();
  const oldResolve = f.resolve;
  f.controller.stop();
  f.controller.start();
  oldResolve();
  await Promise.resolve();
  assert.equal(f.media.paused, false);
  assert.equal(f.media.muted, false);
  assert.equal(f.pauses, 1);
});

test("manual playback after departing is not paused by a pending hover promise", async () => {
  const f = fixture();
  f.controller.start();
  f.controller.stop();
  f.controller.takeManualControl();
  f.media.paused = false;
  f.resolve();
  await Promise.resolve();
  assert.equal(f.media.paused, false);
  assert.equal(f.pauses, 1);
});

test("audible autoplay rejection pauses without retrying silently or changing audio settings", async () => {
  const f = fixture();
  f.controller.start();
  f.reject(new Error("NotAllowedError"));
  await Promise.resolve();
  assert.equal(f.media.paused, true);
  assert.equal(f.media.muted, false);
  assert.equal(f.media.volume, 1);
  assert.equal(f.plays, 1);
  f.controller.start();
  assert.equal(f.plays, 2);
});

test("rejection from an old request cannot stop a newer preview", async () => {
  const f = fixture();
  f.controller.start();
  const oldReject = f.reject;
  f.controller.stop();
  f.controller.start();
  oldReject(new Error("old request cancelled"));
  await Promise.resolve();
  assert.equal(f.media.paused, false);
  assert.equal(f.media.muted, false);
});
