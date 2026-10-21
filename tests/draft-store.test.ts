import assert from "node:assert/strict";
import test from "node:test";
import {
  isSessionOnlyStorage,
  readDraft,
  removeDraft,
  writeDraft,
} from "../src/draft-store.ts";

/** Minimal transactional double: a successful request is deliberately separate from commit. */
function installDatabase() {
  const records = new Map<string, unknown>();
  const names: string[] = [];
  const commits: (() => void)[] = [];
  let hold = false;
  let nextFailure: DOMException | null = null;
  let storeCreated = false;
  let requestSuccesses = 0;
  const database = {
    onversionchange: null,
    objectStoreNames: { contains: () => storeCreated },
    createObjectStore: () => {
      storeCreated = true;
    },
    close: () => {},
    transaction: () => {
      let canceled = false;
      const transaction = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        error: null as DOMException | null,
        abort() {
          canceled = true;
          queueMicrotask(() => transaction.onabort?.());
        },
        objectStore: () => ({
          get: (key: string) => request(key, "get"),
          put: (value: unknown, key: string) => request(key, "put", value),
          delete: (key: string) => request(key, "delete"),
        }),
      };
      function request(key: string, action: string, value?: unknown) {
        const snapshot = structuredClone(value);
        const operation = {
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
          error: null as DOMException | null,
          result: undefined as unknown,
        };
        queueMicrotask(() => {
          if (canceled) return;
          if (nextFailure) {
            transaction.error = operation.error = nextFailure;
            nextFailure = null;
            operation.onerror?.();
            transaction.onerror?.();
            transaction.abort();
            return;
          }
          operation.result =
            action === "get" ? structuredClone(records.get(key)) : key;
          requestSuccesses++;
          operation.onsuccess?.();
          const commit = () => {
            if (canceled) return;
            if (action === "put") records.set(key, snapshot);
            if (action === "delete") records.delete(key);
            transaction.oncomplete?.();
          };
          if (hold) commits.push(commit);
          else queueMicrotask(commit);
        });
        return operation;
      }
      return transaction;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open(name: string) {
        names.push(name);
        const request = {
          result: database,
          onupgradeneeded: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
          onerror: null,
          onblocked: null,
        };
        queueMicrotask(() => {
          if (!storeCreated) request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    },
  });
  return {
    names,
    records,
    holdCommits: () => {
      hold = true;
    },
    resumeCommits: () => {
      hold = false;
      commits.splice(0).forEach((commit) => commit());
    },
    failNext: (error: DOMException) => {
      nextFailure = error;
    },
    get requestSuccesses() {
      return requestSuccesses;
    },
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("request success alone never reports a draft as saved", async () => {
  const database = installDatabase();
  database.holdCommits();
  let resolved = false;
  const save = writeDraft("commit-test", { title: "尚未提交" }).then(() => {
    resolved = true;
  });
  await tick();
  assert.equal(database.requestSuccesses, 1);
  assert.equal(resolved, false);
  assert.equal(database.records.size, 0);
  database.resumeCommits();
  await save;
  assert.equal(resolved, true);
  assert.deepEqual(await readDraft("commit-test"), { title: "尚未提交" });
});

test("queued saves capture their call-time snapshot and reads wait for the newest save", async () => {
  const database = installDatabase();
  database.holdCommits();
  const document = {
    revision: 1,
    nodes: [{ image: "data:image/png;base64,YQ==" }],
  };
  const first = writeDraft("ordered", document);
  document.revision = 2;
  const second = writeDraft("ordered", document);
  document.revision = 99;
  document.nodes[0].image = "mutated-after-call";
  const read = readDraft<typeof document>("ordered");
  await tick();
  assert.equal(
    database.names.length,
    1,
    "later writes must wait before opening another transaction",
  );
  database.resumeCommits();
  await Promise.all([first, second]);
  assert.deepEqual(await read, {
    revision: 2,
    nodes: [{ image: "data:image/png;base64,YQ==" }],
  });
  assert.deepEqual(
    new Set(database.names),
    new Set(["proxy-canvas:drafts:v1"]),
  );
});

test("failed writes preserve the prior draft and do not poison future retries", async () => {
  const database = installDatabase();
  await writeDraft("retry", { revision: 1 });
  database.failNext(new DOMException("full", "QuotaExceededError"));
  await assert.rejects(
    writeDraft("retry", { revision: 2 }),
    /本机草稿保存失败.*存储空间不足/,
  );
  assert.deepEqual(await readDraft("retry"), { revision: 1 });
  await writeDraft("retry", { revision: 3 });
  assert.deepEqual(await readDraft("retry"), { revision: 3 });
});

test("scope isolation and queued removal prevent discarded drafts from reappearing", async () => {
  installDatabase();
  assert.equal(await readDraft("missing"), null);
  const first = writeDraft("account-a", { title: "A" });
  const second = writeDraft("account-b", { title: "B" });
  const discard = removeDraft("account-a");
  await Promise.all([first, second, discard]);
  assert.equal(await readDraft("account-a"), null);
  assert.deepEqual(await readDraft("account-b"), { title: "B" });
  const value = await readDraft<{ title: string }>("account-b");
  value!.title = "changed outside the store";
  assert.deepEqual(await readDraft("account-b"), { title: "B" });
});

test("invalid drafts still reject while unsupported browser storage uses a page session", async () => {
  const database = installDatabase();
  await assert.rejects(
    writeDraft("invalid", { callback() {} }),
    /画布包含无法存储的数据/,
  );
  await assert.rejects(readDraft(" "), /缺少画布存储范围/);
  assert.equal(database.names.length, 0);
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: undefined,
  });
  await writeDraft("unsupported", { nodes: [] });
  assert.equal(isSessionOnlyStorage(), true);
  assert.deepEqual(await readDraft("unsupported"), { nodes: [] });
});
