import assert from "node:assert/strict";
import test from "node:test";
import {
  recoverImageDelivery,
  recoveredImageOriginal,
} from "../src/image-delivery.ts";

const thumbnail =
  "https://bucket.cos.example/media/image/task/2026/10/12/image.png?q-url-param-list=imagemogr2%2Fthumbnail%2F640x640";
const original =
  "https://bucket.cos.example/media/image/task/2026/10/12/image.png?q-signature=original";

function node(
  overrides: Partial<{
    id: string;
    assetId: string;
    taskId: string;
    resultIndex: number;
    image: string;
    imageThumbnail: string;
  }> = {},
) {
  return {
    id: "image-1",
    image: "https://expired.example/image.png",
    ...overrides,
  };
}

test("fresh asset original returns immediately without reading the task", async () => {
  const calls: string[] = [];
  const result = await recoverImageDelivery(
    node({ assetId: "asset-1" }),
    [],
    {
      readAsset: async (assetId) => {
        calls.push(`asset:${assetId}`);
        return {
          url: original,
          thumbnail_url: thumbnail,
          task_id: "task-asset-1",
        };
      },
      readTask: async (taskId) => {
        calls.push(`task:${taskId}`);
        throw new Error("asset recovery should not read the task");
      },
    },
  );

  assert.deepEqual(calls, ["asset:asset-1"]);
  assert.deepEqual(result, {
    image: original,
    taskId: "task-asset-1",
    updates: [{
      id: "image-1",
      taskId: "task-asset-1",
      image: original,
      thumbnail,
    }],
  });
});

test("asset-only thumbnail nodes can resolve their original without a stale image source", async () => {
  const result = await recoverImageDelivery(
    node({
      image: undefined,
      imageThumbnail: thumbnail,
      assetId: "asset-only",
    }),
    [],
    {
      readAsset: async () => ({
        url: original,
        thumbnail_url: thumbnail,
        task_id: "task-asset-only",
      }),
      readTask: async () => {
        throw new Error("asset recovery should not read the task");
      },
    },
  );

  assert.equal(result?.image, original);
  assert.equal(result?.taskId, "task-asset-only");
});

test("asset thumbnail falls through to the task's original output", async () => {
  const calls: string[] = [];
  const result = await recoverImageDelivery(
    node({ assetId: "asset-thumb", taskId: "task-thumb", resultIndex: 0 }),
    [],
    {
      readAsset: async () => {
        calls.push("asset");
        return {
          url: thumbnail,
          thumbnail_url: thumbnail,
          task_id: "task-thumb",
        };
      },
      readTask: async (taskId) => {
        calls.push(`task:${taskId}`);
        return { data: [{ url: original, thumbnail_url: thumbnail }] };
      },
    },
  );

  assert.deepEqual(calls, ["asset", "task:task-thumb"]);
  assert.deepEqual(result, {
    image: original,
    taskId: "task-thumb",
    updates: [{
      id: "image-1",
      taskId: "task-thumb",
      image: original,
      thumbnail,
    }],
  });
});

test("asset read errors fall through to task recovery and preserve batch updates", async () => {
  const first = node({
    id: "image-1",
    taskId: "task-batch",
    resultIndex: 0,
  });
  const current = node({
    id: "image-2",
    assetId: "asset-missing",
    taskId: "task-batch",
    resultIndex: 1,
  });
  const result = await recoverImageDelivery(
    current,
    [first, current],
    {
      readAsset: async () => {
        throw new Error("asset index unavailable");
      },
      readTask: async (taskId) => {
        assert.equal(taskId, "task-batch");
        return {
          data: [
            { url: "https://cdn.example/first.png" },
            { url: "https://cdn.example/current.png" },
          ],
        };
      },
    },
  );

  assert.deepEqual(result, {
    image: "https://cdn.example/current.png",
    taskId: "task-batch",
    updates: [
      {
        id: "image-1",
        taskId: "task-batch",
        image: "https://cdn.example/first.png",
      },
      {
        id: "image-2",
        taskId: "task-batch",
        image: "https://cdn.example/current.png",
      },
    ],
  });
});

test("task recovery rejects a thumbnail-only response", async () => {
  const result = await recoverImageDelivery(
    node({ taskId: "task-thumbnail", resultIndex: 0 }),
    [],
    {
      readAsset: async () => {
        throw new Error("no asset");
      },
      readTask: async () => ({ data: [{ url: thumbnail }] }),
    },
  );

  assert.equal(result, undefined);
});

test("ordinary image sources are accepted as recovered originals", () => {
  const source = "https://cdn.example/images/original.png";
  assert.equal(recoveredImageOriginal(source), source);
  assert.equal(
    recoveredImageOriginal(source, "https://cdn.example/images/thumb.png"),
    source,
  );
});
