import assert from "node:assert/strict";
import test from "node:test";
import { cloudSyncFeedback, initialCloudSyncFeedback } from "../src/cloud-sync-feedback.ts";

test("a retry clears the prior failure while showing its active revision", () => {
  const start = cloudSyncFeedback(initialCloudSyncFeedback, { type: "start", attempt: 1, revision: "canvas-a:1" });
  const failed = cloudSyncFeedback(start, { type: "failure", attempt: 1, revision: "canvas-a:1", error: "network unavailable" });
  const retry = cloudSyncFeedback(failed, { type: "start", attempt: 2, revision: "canvas-a:1" });
  assert.equal(retry.error, "");
  assert.equal(retry.syncing, true);
  assert.deepEqual(cloudSyncFeedback(retry, { type: "success", attempt: 2 }), {
    attempt: 2,
    syncing: false,
    error: "",
    syncingRevision: "",
    errorRevision: "",
  });
});

test("an older acknowledgement cannot erase the latest failure", () => {
  const state = { attempt: 2, syncing: false, error: "latest save failed", syncingRevision: "", errorRevision: "canvas-a:2" };
  assert.equal(cloudSyncFeedback(state, { type: "success", attempt: 1 }), state);
});

test("an older failure cannot replace a newer successful save or stop its pending retry", () => {
  for (const syncing of [true, false]) {
    const state = { attempt: 3, syncing, error: "", syncingRevision: syncing ? "canvas-a:3" : "", errorRevision: "" };
    assert.equal(cloudSyncFeedback(state, { type: "failure", attempt: 2, revision: "canvas-a:2", error: "outdated failure" }), state);
  }
});

test("duplicate or outdated starts do not reset the current feedback", () => {
  const state = { attempt: 3, syncing: false, error: "retry needed", syncingRevision: "", errorRevision: "canvas-a:3" };
  for (const attempt of [1, 3]) assert.equal(cloudSyncFeedback(state, { type: "start", attempt, revision: "canvas-a:4" }), state);
});
