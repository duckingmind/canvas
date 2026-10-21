import assert from "node:assert/strict";
import test from "node:test";
import { computeAudioWaveformPeaks, DEFAULT_AUDIO_WAVEFORM_BINS, MAX_AUDIO_WAVEFORM_BINS } from "../src/audio-waveform.ts";

test("bins samples into deterministic normalized absolute peaks", () => {
  const channels = [
    new Float32Array([0, 0.2, -0.4, 0.1]),
    new Float32Array([-1, 0.1, 0.2, -0.5]),
  ];
  assert.deepEqual(computeAudioWaveformPeaks(channels, 2), [1, 0.5]);
  assert.deepEqual(computeAudioWaveformPeaks(channels, 2), [1, 0.5]);
});

test("combines channels by magnitude without cancelling opposite phases", () => {
  const peaks = computeAudioWaveformPeaks([
    new Float32Array([0.25, 0.1]),
    new Float32Array([-0.25, -0.05]),
  ], 2);
  assert.equal(peaks[0], 1);
  assert.ok(Math.abs(peaks[1] - 0.4) < 1e-6);
});

test("returns the requested bin count for short audio and clamps it to the maximum", () => {
  const peaks = computeAudioWaveformPeaks([new Float32Array([-0.5])], MAX_AUDIO_WAVEFORM_BINS + 100);
  assert.equal(peaks.length, MAX_AUDIO_WAVEFORM_BINS);
  assert.ok(peaks.every(peak => peak === 1));
  assert.equal(computeAudioWaveformPeaks([new Float32Array([0.2, -0.1])], 0).length, 1);
});

test("handles empty channels, silence, non-finite samples, and mismatched channel lengths", () => {
  assert.deepEqual(computeAudioWaveformPeaks([]), []);
  assert.deepEqual(computeAudioWaveformPeaks([new Float32Array()], 4), []);
  assert.deepEqual(computeAudioWaveformPeaks([new Float32Array(8)], 4), [0, 0, 0, 0]);
  const peaks = computeAudioWaveformPeaks([
    new Float32Array([Number.NaN, 0.25, Number.POSITIVE_INFINITY]),
    new Float32Array([0.1]),
  ], 3);
  assert.ok(Math.abs(peaks[0] - 0.4) < 1e-6);
  assert.deepEqual(peaks.slice(1), [1, 0]);
});

test("uses a default bounded bin count and caps out-of-range amplitudes", () => {
  const samples = new Float32Array(DEFAULT_AUDIO_WAVEFORM_BINS * 2).fill(2);
  const peaks = computeAudioWaveformPeaks([samples]);
  assert.equal(peaks.length, DEFAULT_AUDIO_WAVEFORM_BINS);
  assert.ok(peaks.every(peak => peak === 1));
});
