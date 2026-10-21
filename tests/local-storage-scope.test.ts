import assert from "node:assert/strict";
import test from "node:test";
import { scopedMemory, setLocalStorageScope } from "../src/local-storage-scope.ts";

test("scopedMemory keeps a bounded least-recently-used account partition set", () => {
  const memory = scopedMemory<string, string>({ maxPartitions: 2 });

  setLocalStorageScope("memory-lru-A");
  memory().set("value", "A");
  setLocalStorageScope("memory-lru-B");
  memory().set("value", "B");

  // Revisit A before introducing C: A should be retained and B should be the
  // oldest partition when the limit is reached.
  setLocalStorageScope("memory-lru-A");
  assert.equal(memory().get("value"), "A");
  setLocalStorageScope("memory-lru-C");
  memory().set("value", "C");

  setLocalStorageScope("memory-lru-A");
  assert.equal(memory().get("value"), "A");
  setLocalStorageScope("memory-lru-B");
  assert.equal(memory().get("value"), undefined);
});

test("scopedMemory rejects invalid partition limits", () => {
  assert.throws(() => scopedMemory({ maxPartitions: 0 }), /正整数/);
  assert.throws(() => scopedMemory({ maxPartitions: 1.5 }), /正整数/);
});
