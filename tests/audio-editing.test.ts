import test from "node:test";
import assert from "node:assert/strict";
import {
  audioEditRange,
  encodePcmWav,
  MAX_AUDIO_EDIT_OUTPUT_BYTES,
} from "../src/audio-editing.ts";

test("audio edit ranges clamp to the source and reject invalid or excessive ranges", () => {
  assert.deepEqual(audioEditRange(10, -2, 12), { start: 0, end: 10 });
  assert.throws(() => audioEditRange(10, 5, 5.04), /至少需要/);
  assert.throws(() => audioEditRange(10, Number.NaN, 5), /有效的音频范围/);
  assert.throws(() => audioEditRange(0, 0, 1), /无法读取/);
  assert.throws(() => audioEditRange(900, 0, 601), /最多 10 分钟/);
  assert.deepEqual(audioEditRange(900, 20, 620), { start: 20, end: 620 });
});

test("PCM WAV encoder writes a standard mono header and signed little-endian samples", () => {
  const wav = encodePcmWav([new Float32Array([-1, -0.5, 0, 0.5, 1])], 16_000);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const readAscii = (offset: number, length: number) => String.fromCharCode(...wav.subarray(offset, offset + length));

  assert.equal(wav.byteLength, 54);
  assert.equal(readAscii(0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), 46);
  assert.equal(readAscii(8, 4), "WAVE");
  assert.equal(readAscii(12, 4), "fmt ");
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(readAscii(36, 4), "data");
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual(Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true)), [-32768, -16384, 0, 16384, 32767]);
  assert.equal(MAX_AUDIO_EDIT_OUTPUT_BYTES, 50 * 1024 * 1024);
});

test("PCM WAV encoder interleaves stereo and crops by explicit sample frames", () => {
  const left = new Float32Array([0, 0.25, 0.5, 0.75]);
  const right = new Float32Array([0, -0.25, -0.5, -0.75]);
  const wav = encodePcmWav([left, right], 48_000, { startFrame: 1, endFrame: 3 });
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(28, true), 192_000);
  assert.equal(view.getUint16(32, true), 4);
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => view.getInt16(44 + index * 2, true)), [8192, -8192, 16384, -16384]);
});

test("PCM WAV encoder sanitizes non-finite samples and clips out-of-range values", () => {
  const wav = encodePcmWav([new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, -2, 2])], 44_100);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  assert.deepEqual(Array.from({ length: 4 }, (_, index) => view.getInt16(44 + index * 2, true)), [0, 0, -32768, 32767]);
});

test("PCM WAV encoder rejects oversized output and malformed channel data", () => {
  assert.throws(() => encodePcmWav([new Float32Array(100)], 16_000, { maxOutputBytes: 100 }), /输出大小上限/);
  assert.throws(() => encodePcmWav([new Float32Array([0]), new Float32Array(0)], 16_000), /长度不一致/);
  assert.throws(() => encodePcmWav([new Float32Array([0]), new Float32Array([0]), new Float32Array([0])], 16_000), /仅支持单声道或双声道/);
  assert.throws(() => encodePcmWav([new Float32Array([0])], 7_999), /采样率/);
  assert.throws(() => encodePcmWav([new Float32Array([0])], 16_000, { startFrame: 0, endFrame: 2 }), /采样范围无效/);
});
