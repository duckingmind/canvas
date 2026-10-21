import assert from "node:assert/strict";
import test from "node:test";
import {
  AudioRecordingSession,
  MAX_RECORDING_MS,
  defaultRecordingFileName,
  formatRecordingDuration,
  recordingErrorMessage,
  type RecordingCallbacks,
  type RecordingDevice,
  type RecordingEnvironment,
  type RecordingStream,
} from "../src/audio-recording.ts";

function createHarness() {
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  const track = { stops: 0, stop() { this.stops += 1; } };
  const stream: RecordingStream = { getTracks: () => [track] };
  const events: string[] = [];
  const recorder: RecordingDevice = {
    state: "inactive",
    mimeType: "audio/webm;codecs=opus",
    ondataavailable: null,
    onstop: null,
    onerror: null,
    start(timeslice) { assert.equal(timeslice, 250); this.state = "recording"; },
    stop() { this.state = "inactive"; this.onstop?.(); },
  };
  let now = 10_000;
  let nextTimerId = 1;
  const environment: RecordingEnvironment = {
    getUserMedia: async () => stream,
    createRecorder: () => recorder,
    supportsMimeType: type => type === "audio/webm;codecs=opus",
    now: () => now,
    setInterval: callback => { const id = nextTimerId++; intervals.set(id, callback); return id; },
    clearInterval: handle => { intervals.delete(handle as number); },
    setTimeout: callback => { const id = nextTimerId++; timeouts.set(id, callback); return id; },
    clearTimeout: handle => { timeouts.delete(handle as number); },
  };
  const callbacks: RecordingCallbacks = {
    onStatus: status => events.push(`status:${status}`),
    onElapsed: elapsed => events.push(`elapsed:${elapsed}`),
    onComplete: blob => events.push(`complete:${blob.type}:${blob.size}`),
    onError: message => events.push(`error:${message}`),
  };
  return {
    session: new AudioRecordingSession(callbacks, environment),
    recorder,
    stream,
    track,
    events,
    intervals,
    timeouts,
    advance(milliseconds: number) { now += milliseconds; },
  };
}

test("recording captures audio, reports elapsed time, and stops the microphone on completion", async () => {
  const harness = createHarness();
  await harness.session.start();
  assert.deepEqual(harness.events.slice(0, 3), ["elapsed:0", "status:requesting", "status:recording"]);
  harness.recorder.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
  harness.advance(2_450);
  [...harness.intervals.values()][0]();
  assert.ok(harness.events.includes("elapsed:2450"));
  harness.session.stop();
  assert.equal(harness.track.stops, 1);
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.timeouts.size, 0);
  assert.ok(harness.events.includes("complete:audio/webm;codecs=opus:5"));
  assert.ok(harness.events.includes("status:ready"));
  harness.session.dispose();
  assert.equal(harness.track.stops, 1);
});

test("the 60 second deadline stops recording and clamps the reported duration", async () => {
  const harness = createHarness();
  await harness.session.start();
  harness.advance(MAX_RECORDING_MS + 1200);
  [...harness.timeouts.values()][0]();
  assert.equal(harness.recorder.state, "inactive");
  assert.ok(harness.events.includes(`elapsed:${MAX_RECORDING_MS}`));
  assert.ok(harness.events.includes("error:录音内容为空，请重新录制。请确认麦克风正常工作。"));
  assert.ok(harness.events.includes("status:error"));
  assert.equal(harness.track.stops, 1);
});

test("permission denial becomes an actionable error without retaining recording timers", async () => {
  const harness = createHarness();
  const deniedEnvironment: RecordingEnvironment = {
    getUserMedia: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); },
    createRecorder: () => assert.fail("permission denial cannot create a recorder"),
    supportsMimeType: () => false,
    now: () => 0,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 2,
    clearTimeout: () => {},
  };
  const session = new AudioRecordingSession({
    onStatus: status => harness.events.push(`status:${status}`),
    onElapsed: () => {},
    onComplete: () => assert.fail("permission denial cannot produce audio"),
    onError: message => harness.events.push(`error:${message}`),
  }, deniedEnvironment);
  await session.start();
  assert.ok(harness.events.includes("status:error"));
  assert.ok(harness.events.some(event => event.includes("请在浏览器设置中允许麦克风权限")));
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.timeouts.size, 0);
  session.dispose();
});

test("disposing during a pending permission prompt stops a late stream without starting a recorder", async () => {
  const harness = createHarness();
  let resolveStream!: (stream: RecordingStream) => void;
  const environment = {
    getUserMedia: () => new Promise<RecordingStream>(resolve => { resolveStream = resolve; }),
    createRecorder: () => assert.fail("a disposed session must not start recording"),
    supportsMimeType: () => false,
    now: () => 0,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 2,
    clearTimeout: () => {},
  } satisfies RecordingEnvironment;
  const events: string[] = [];
  const session = new AudioRecordingSession({ onStatus: value => events.push(value), onElapsed: () => {}, onComplete: () => {}, onError: () => {} }, environment);
  const starting = session.start();
  session.dispose();
  resolveStream(harness.stream);
  await starting;
  assert.equal(harness.track.stops, 1);
  assert.deepEqual(events, ["requesting"]);
});

test("audio recording helpers format durations, choose extensions, and explain permissions", () => {
  assert.equal(formatRecordingDuration(-50), "00:00");
  assert.equal(formatRecordingDuration(61_999), "01:01");
  assert.equal(formatRecordingDuration(Number.NaN), "00:00");
  assert.equal(defaultRecordingFileName(new Date(2026, 0, 2, 3, 4, 5), "audio/mp4;codecs=mp4a.40.2"), "录音_20260102_030405.m4a");
  assert.match(recordingErrorMessage({ name: "NotAllowedError" }), /麦克风权限/);
});
