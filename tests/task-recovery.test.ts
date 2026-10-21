import assert from "node:assert/strict";
import test from "node:test";
import { TaskRecoverySchedule } from "../src/task-recovery.ts";

test("automatic recovery survives prolonged outages with capped delays and no manual handoff", () => {
  const schedule = new TaskRecoverySchedule(30_000, 2_000);
  assert.equal(schedule.delay("task-a", 0), 0);
  // Looking at an active task must not consume its recovery opportunity.
  assert.equal(schedule.delay("task-a", 100), 0);
  schedule.started("task-a", 100);
  assert.equal(schedule.delay("task-a", 1_100), 1_000);
  assert.equal(schedule.delay("task-a", 2_100), 0);
  schedule.started("task-a", 2_100);
  assert.equal(schedule.delay("task-a", 2_101), 3_999);
  let now = 6_100;
  for (let retry = 0; retry < 100; retry++) {
    schedule.started("task-a", now);
    // A slow read must not turn the next retry into a tight loop.
    now += 90_000;
    schedule.finished("task-a", now);
    const delay = schedule.delay("task-a", now);
    assert.ok(delay > 0 && delay <= 30_000);
    now += delay;
    assert.equal(schedule.delay("task-a", now), 0);
  }
  assert.equal(schedule.delay("task-b", 999_999), 0);
  schedule.reset("task-a");
  assert.equal(schedule.delay("task-a", 999_999), 0);
});

test("completed tasks are forgotten and renewed platform access resets observation delays", () => {
  const schedule = new TaskRecoverySchedule();
  schedule.started("old-task", 0);
  schedule.started("live-task", 0);
  schedule.retain(new Set(["live-task"]));
  assert.equal(schedule.delay("old-task", 0), 0);
  assert.equal(schedule.delay("live-task", 0), 2_000);
  schedule.clear();
  assert.equal(schedule.delay("live-task", 0), 0);
});
