import test from "node:test";
import assert from "node:assert/strict";
import { gradeFilter, initialVideoEditRange, MAX_VIDEO_EDIT_DURATION_SECONDS, raceWithAbort, recorderMimeType, supportedVideoOutputFormats, videoCanvasSize, videoEditOperationParams, videoEditOutputDuration, videoEditRange, videoExportBitrate, videoOutputExtension, videoTransformDimensions, watermarkPlacement } from "../src/video-editing.ts";

test("video edit ranges clamp to the source and reject unusable durations", () => {
  assert.deepEqual(videoEditRange(10, -2, 12), { start: 0, end: 10 });
  assert.throws(() => videoEditRange(10, 5, 5.1), /至少需要/);
  assert.throws(() => videoEditRange(0, 0, 1), /无法读取/);
  assert.throws(() => videoEditRange(600, 0, 301), /最多 5 分钟/);
  assert.deepEqual(videoEditRange(600, 0, 600, Number.POSITIVE_INFINITY), { start: 0, end: 600 });
});

test("long-video ranges start at the playhead for extracts and remain explicit for full-video tools", () => {
  assert.deepEqual(initialVideoEditRange(900, 420, true), { startTime: 420, endTime: 720 });
  assert.deepEqual(initialVideoEditRange(900, 420, false), { startTime: 0, endTime: 900 });
  assert.equal(MAX_VIDEO_EDIT_DURATION_SECONDS, 300);
});

test("video output sizing preserves even dimensions and requested crop ratio", () => {
  assert.deepEqual(videoCanvasSize(1920, 1080, 720, "original"), { width: 720, height: 404 });
  assert.deepEqual(videoCanvasSize(3840, 2160, 3840, "original"), { width: 3840, height: 2160 });
  assert.deepEqual(videoCanvasSize(1920, 1080, 720, "1:1"), { width: 720, height: 720 });
  assert.deepEqual(videoCanvasSize(1080, 1920, 720, "16:9"), { width: 720, height: 404 });
});

test("basic grade presets map to browser filters", () => {
  assert.equal(gradeFilter("natural"), "none");
  assert.match(gradeFilter("warm"), /sepia/);
  assert.match(gradeFilter("mono"), /grayscale/);
});

test("video transforms expose stable dimensions for quarter turns", () => {
  assert.deepEqual(videoTransformDimensions(1920, 1080, 0), { width: 1920, height: 1080 });
  assert.deepEqual(videoTransformDimensions(1920, 1080, 90), { width: 1080, height: 1920 });
  assert.deepEqual(videoTransformDimensions(1920, 1080, 270), { width: 1080, height: 1920 });
});

test("processed video results retain edit parameters and derive speed-adjusted duration", () => {
  const options = { operation: "speed" as const, startTime: 1, endTime: 7, playbackRate: 1.5 as const, flipHorizontal: false };
  assert.deepEqual(videoEditOperationParams("source-video", options, "video/webm", 1024), {
    sourceNodeId: "source-video", startTime: 1, endTime: 7, mimeType: "video/webm", size: 1024,
    playbackRate: 1.5, flipHorizontal: false,
  });
  assert.equal(videoEditOutputDuration(options), 4);
  assert.equal(videoEditOutputDuration({ operation: "trim", startTime: 1, endTime: 4 }), 3);
  assert.equal(videoEditOutputDuration({ operation: "trim", startTime: 1, endTime: 1.1 }), 0.25);
});

test("watermark placement respects all corners and keeps text inside the output frame", () => {
  assert.deepEqual(watermarkPlacement(640, 360, "top-left", 16), { x: 16, y: 16, align: "left" });
  assert.deepEqual(watermarkPlacement(640, 360, "top-right", 16), { x: 624, y: 16, align: "right" });
  assert.deepEqual(watermarkPlacement(640, 360, "bottom-left", 16), { x: 16, y: 344, align: "left" });
  assert.deepEqual(watermarkPlacement(640, 360, "bottom-right", 16), { x: 624, y: 344, align: "right" });
});

test("editing bitrate follows output dimensions while compression follows its quality setting", () => {
  assert.equal(videoExportBitrate({ operation: "grade", startTime: 0, endTime: 5 }, { width: 1920, height: 1080 }), 5_000_000);
  assert.equal(videoExportBitrate({ operation: "rotate", startTime: 0, endTime: 5 }, { width: 3840, height: 2160 }), 20_000_000);
  assert.equal(videoExportBitrate({ operation: "compress", startTime: 0, endTime: 5, quality: "high" }, { width: 3840, height: 2160 }), 3_000_000);
});

test("video export waits stop immediately when cancelled", async () => {
  const controller = new AbortController();
  const waiting = raceWithAbort(new Promise<never>(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(waiting, error => error instanceof DOMException && error.name === "AbortError");
});

test("recorder mime selection prefers supported browser codecs", () => {
  assert.equal(recorderMimeType("extract-video", value => value === "video/webm"), "video/webm");
  assert.equal(recorderMimeType("extract-audio", value => value.includes("audio/ogg")), "audio/ogg;codecs=opus");
  assert.throws(() => recorderMimeType("extract-audio", () => false), /不支持导出音频/);
  assert.equal(recorderMimeType("convert", value => value.startsWith("video/mp4"), "mp4"), "video/mp4;codecs=avc1.42E01E,mp4a.40.2");
  assert.deepEqual(supportedVideoOutputFormats(value => value.startsWith("video/webm")), ["webm"]);
  assert.deepEqual(supportedVideoOutputFormats(value => value.startsWith("video/mp4")), ["mp4"]);
  assert.deepEqual(supportedVideoOutputFormats(() => false), []);
  assert.throws(() => recorderMimeType("convert", () => false, "mp4"), /不支持导出 MP4 格式/);
});

test("download extensions match recorder output MIME types", () => {
  assert.equal(videoOutputExtension("audio/ogg;codecs=opus"), "ogg");
  assert.equal(videoOutputExtension("audio/mp4;codecs=mp4a.40.2"), "m4a");
  assert.equal(videoOutputExtension("video/mp4"), "mp4");
  assert.equal(videoOutputExtension("video/webm;codecs=vp9,opus"), "webm");
});
