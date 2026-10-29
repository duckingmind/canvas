import assert from "node:assert/strict";
import test from "node:test";
import { announceVideoPlayback, coordinateVideoPlayback, videoBufferedAheadSeconds } from "../src/video-playback-coordinator.ts";

test("starting another video pauses the previous canvas or gallery player", () => {
  const originalDocument = globalThis.document;
  const eventTarget = new EventTarget();
  Object.defineProperty(globalThis, "document", { configurable: true, value: eventTarget });
  try {
    let paused = false;
    let pauseCount = 0;
    const media = { get paused() { return paused; }, pause() { paused = true; pauseCount += 1; } };
    const cleanup = coordinateVideoPlayback("canvas-player", media);

    announceVideoPlayback("gallery-player");
    assert.equal(pauseCount, 1);
    assert.equal(paused, true);

    paused = false;
    announceVideoPlayback("canvas-player");
    assert.equal(pauseCount, 1, "the active player must not pause itself");
    cleanup();
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});

test("buffer diagnostics report the remaining range containing the playhead", () => {
  const video = {
    currentTime: 4,
    buffered: {
      length: 2,
      start: (index: number) => index === 0 ? 0 : 8,
      end: (index: number) => index === 0 ? 3 : 10,
    },
  };
  assert.equal(videoBufferedAheadSeconds(video), 0);
  assert.equal(videoBufferedAheadSeconds({ ...video, currentTime: 9 }), 1);
});
