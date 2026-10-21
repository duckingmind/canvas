import assert from "node:assert/strict";
import test from "node:test";
import {
  generateImage,
  ImageGenerationError,
  type ImageRequest,
} from "../src/generation.ts";

const input = { model: "image-public", prompt: "一座安静的图书馆" };
const noWait = { delay: async () => {} };

test("a create error with an accepted image task preserves identity and continues reading", async () => {
  const events: string[] = [];
  const result = await generateImage(async path => {
    events.push(path);
    if (path === "/images/generations") throw { status: 503, code: "media_config_snapshot_unavailable", details: { task_id: "image-accepted-error", status: "queued" } };
    return { id: "image-accepted-error", status: "completed", data: [{ url: "https://cdn.example/result.png" }] };
  }, { ...input, idempotencyKey: "original-key" }, id => { events.push(`saved:${id}`); }, noWait);
  assert.equal(result.taskId, "image-accepted-error");
  assert.deepEqual(events, ["/images/generations", "saved:image-accepted-error", "/images/tasks/image-accepted-error"]);
});

test("a frozen image submission is looked up before replaying its creation request", async () => {
  const paths: string[] = [];
  const result = await generateImage(async (path) => {
    paths.push(path);
    assert.equal(path, "/images/by-idempotency-key/frozen-image");
    return { id: "existing-image", status: "completed", data: [{ url: "https://cdn.example/recovered.png" }] };
  }, { ...input, idempotencyKey: "frozen-image" }, undefined, {
    recovery: { inputReferencesAvailable: true },
  });
  assert.equal(result.taskId, "existing-image");
  assert.equal(result.image, "https://cdn.example/recovered.png");
  assert.deepEqual(paths, ["/images/by-idempotency-key/frozen-image"]);
});

test("an unknown frozen image submission is observed without another POST", async () => {
  const paths: string[] = [];
  const result = await generateImage(async (path) => {
    paths.push(path);
    if (path === "/images/by-idempotency-key/frozen-image")
      return { id: "existing-image", status: "unknown" };
    assert.equal(path, "/images/tasks/existing-image");
    return { id: "existing-image", status: "completed", data: [{ url: "https://cdn.example/recovered.png" }] };
  }, { ...input, idempotencyKey: "frozen-image" }, undefined, {
    recovery: { inputReferencesAvailable: true },
  });
  assert.equal(result.taskId, "existing-image");
  assert.deepEqual(paths, [
    "/images/by-idempotency-key/frozen-image",
    "/images/tasks/existing-image",
  ]);
});

test("an unavailable image submission lookup never replays the creation request", async () => {
  const paths: string[] = [];
  await assert.rejects(
    generateImage(async (path) => {
      paths.push(path);
      throw { status: 503, code: "media_submission_lookup_failed" };
    }, { ...input, idempotencyKey: "frozen-image" }, undefined, {
      recovery: { inputReferencesAvailable: true },
    }),
    { code: "media_submission_lookup_failed", pending: true, terminalTask: false },
  );
  assert.deepEqual(paths, ["/images/by-idempotency-key/frozen-image"]);
});

test("a confirmed missing image submission may replay the frozen request", async () => {
  const paths: string[] = [];
  const result = await generateImage(async (path) => {
    paths.push(path);
    if (path === "/images/by-idempotency-key/frozen-image")
      throw { status: 404, code: "image_task_not_found" };
    assert.equal(path, "/images/generations");
    return { data: [{ url: "https://cdn.example/replayed.png" }] };
  }, { ...input, idempotencyKey: "frozen-image" }, undefined, {
    recovery: { inputReferencesAvailable: true },
  });
  assert.equal(result.image, "https://cdn.example/replayed.png");
  assert.deepEqual(paths, [
    "/images/by-idempotency-key/frozen-image",
    "/images/generations",
  ]);
});

test("saved application submissions explicitly request URLs for generation and edits", async () => {
  for (const responseFormat of ["url", "b64_json"] as const) {
    for (const images of [undefined, ["https://cdn.example/reference.png"]]) {
      await generateImage(async (path, init) => {
        if (images) {
          assert.equal(path, "/images/edits");
          assert.ok(init?.body instanceof FormData);
          assert.equal(init.body.get("response_format"), responseFormat);
        } else {
          assert.equal(path, "/images/generations");
          assert.equal(JSON.parse(String(init?.body)).response_format, responseFormat);
        }
        return { data: [{ url: "https://cdn.example/result.png" }] };
      }, { ...input, images, responseFormat }, undefined, {
        loadReference: async () => new Blob(["reference"], { type: "image/png" }),
      });
    }
  }
});

test("frozen output formats are forwarded for both generation and edit requests", async () => {
  await generateImage(async (path, init) => {
    assert.equal(path, "/images/generations");
    assert.equal(JSON.parse(String(init?.body)).output_format, "webp");
    return { data: [{ url: "https://cdn.example/result.webp" }] };
  }, { ...input, outputFormat: "webp", responseFormat: "url" });

  await generateImage(async (path, init) => {
    assert.equal(path, "/images/edits");
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("output_format"), "webp");
    return { data: [{ url: "https://cdn.example/result.webp" }] };
  }, { ...input, images: ["https://cdn.example/reference.png"], outputFormat: "webp", responseFormat: "url" }, undefined, {
    loadReference: async () => new Blob(["reference"], { type: "image/png" }),
  });
});

test("synchronous images support public URLs and base64 without polling or a hardcoded size", async () => {
  for (const [data, expected] of [
    [{ url: "https://cdn.example/image.png" }, "https://cdn.example/image.png"],
    [{ b64_json: "cG5nLWJ5dGVz" }, "data:image/png;base64,cG5nLWJ5dGVz"],
  ] as const) {
    const calls: string[] = [];
    const result = await generateImage(async (path, init) => {
      calls.push(path);
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body || "{}")), {
        ...input,
        n: 1,
      });
      return { created: 1780000000, data: [data] };
    }, input);
    assert.deepEqual(result, { image: expected });
    assert.deepEqual(calls, ["/images/generations"]);
  }
});

test("SDK media_task_timeout switches to the existing task without another generation request", async () => {
  const calls: string[] = [],
    savedTasks: string[] = [],
    waits: number[] = [];
  const request: ImageRequest = async (path) => {
    calls.push(path);
    if (path === "/images/generations") {
      throw Object.assign(new Error("media task continues in the background"), {
        code: "media_task_timeout",
        status: 504,
        details: {
          error: { code: "media_task_timeout" },
          task_id: "imgtask_01",
          status: "in_progress",
          polling_url: "/v1/images/tasks/imgtask_01",
        },
      });
    }
    return calls.length === 2
      ? { id: "imgtask_01", status: "queued" }
      : {
          id: "imgtask_01",
          status: "completed",
          data: [{ url: "https://cdn.example/completed.png" }],
        };
  };
  assert.deepEqual(
    await generateImage(request, input, (id) => savedTasks.push(id), {
      delay: async (milliseconds) => {
        waits.push(milliseconds);
      },
    }),
    {
      image: "https://cdn.example/completed.png",
      taskId: "imgtask_01",
    },
  );
  assert.deepEqual(savedTasks, ["imgtask_01"]);
  assert.deepEqual(calls, [
    "/images/generations",
    "/images/tasks/imgtask_01",
    "/images/tasks/imgtask_01",
  ]);
  assert.deepEqual(waits, [1500]);
});

test("resume only queries the persisted ID, including the SDK-supported colon character", async () => {
  const calls: string[] = [];
  const result = await generateImage(
    async (path, init) => {
      calls.push(path);
      assert.equal(init, undefined);
      return {
        id: "image:original",
        status: "completed",
        data: [{ b64_json: "YQ==" }],
      };
    },
    { model: "", prompt: "", taskId: "image:original" },
  );
  assert.deepEqual(calls, ["/images/tasks/image:original"]);
  assert.equal(result.taskId, "image:original");
});

test("successful async task responses and task terminal failures use the public data/error shape", async () => {
  for (const status of ["failed", "cancelled", "canceled"]) {
    let calls = 0;
    await assert.rejects(
      generateImage(
        async () => {
          calls++;
          return calls === 1
            ? { id: "async-task", status: "in_progress" }
            : {
                id: "async-task",
                status,
                error: { code: "task_stopped", message: "任务已停止" },
              };
        },
        input,
        undefined,
        noWait,
      ),
      (error) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.message, "任务已停止");
        assert.equal(error.taskId, "async-task");
        assert.equal(error.pending, false);
        assert.equal(error.code, "task_stopped");
        assert.equal(error.terminalTask, true);
        return true;
      },
    );
    assert.equal(calls, 2);
  }
});

test("polling exhaustion retains the task ID and marks it pending for a later resume", async () => {
  let calls = 0,
    waits = 0;
  await assert.rejects(
    generateImage(
      async () => {
        calls++;
        return { id: "slow-task", status: "in_progress" };
      },
      { ...input, taskId: "slow-task" },
      undefined,
      {
        attempts: 3,
        delay: async () => {
          waits++;
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof ImageGenerationError);
      assert.equal(error.taskId, "slow-task");
      assert.equal(error.pending, true);
      assert.equal(error.code, "IMAGE_TASK_PENDING");
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.equal(waits, 2);
});

test("polling exhaustion preserves an unknown observation for reconciliation UI", async () => {
  await assert.rejects(
    generateImage(
      async () => ({ id: "unknown-task", status: "unknown", request_id: "req-unknown" }),
      { ...input, taskId: "unknown-task" },
      undefined,
      { attempts: 1, delay: async () => {} },
    ),
    (error) => {
      assert.ok(error instanceof ImageGenerationError);
      assert.equal(error.taskId, "unknown-task");
      assert.equal(error.status, "unknown");
      assert.equal(error.requestId, "req-unknown");
      assert.equal(error.pending, true);
      assert.equal(error.code, "IMAGE_TASK_PENDING");
      return true;
    },
  );
});

test("supplier confirmation prevents an expired platform task from being shown as provider failure", async () => {
  await assert.rejects(
    generateImage(
      async () => ({
        task: {
          status: "failed",
          error_code: "unknown_resolution_expired",
          supplier_confirmation: {
            state: "unconfirmed_after_timeout",
            status: "unknown",
            source: "platform",
            reason: "供应商结果尚未确认",
          },
        },
      }),
      { ...input, taskId: "expired-unknown-task" },
      undefined,
      { attempts: 1, delay: async () => {} },
    ),
    (error) => {
      assert.ok(error instanceof ImageGenerationError);
      assert.equal(error.taskId, "expired-unknown-task");
      assert.equal(error.pending, true);
      assert.equal(error.code, "IMAGE_RESULT_UNCONFIRMED");
      return true;
    },
  );
});

test("polling connection failures preserve the resumable task instead of submitting again", async () => {
  await assert.rejects(
    generateImage(
      async () => {
        throw new Error("Network offline");
      },
      { ...input, taskId: "existing-task" },
      undefined,
      noWait,
    ),
    (error) => {
      assert.ok(error instanceof ImageGenerationError);
      assert.equal(error.taskId, "existing-task");
      assert.equal(error.pending, true);
      assert.match(error.message, /Network offline/);
      return true;
    },
  );
});

test("image task reads recover from a temporary local relay outage without another POST", async () => {
  const paths: string[] = [];
  const waits: number[] = [];
  let reads = 0;
  const result = await generateImage(async (path, init) => {
    paths.push(path);
    if (path === "/images/generations") {
      assert.equal(init?.method, "POST");
      return { id: "relay-recovery", status: "queued" };
    }
    assert.equal(init, undefined);
    reads += 1;
    if (reads <= 2) throw { status: 502, code: "APP_GATEWAY_UNAVAILABLE", error: "fetch failed" };
    return { id: "relay-recovery", status: "completed", data: [{ url: "https://cdn.example/recovered.png" }] };
  }, input, undefined, { delay: async milliseconds => { waits.push(milliseconds); } });
  assert.equal(result.taskId, "relay-recovery");
  assert.equal(result.image, "https://cdn.example/recovered.png");
  assert.deepEqual(paths, ["/images/generations", ...Array(3).fill("/images/tasks/relay-recovery")]);
  assert.deepEqual(waits, [1500, 3000]);
});

test("persistent relay outages stop after bounded reads and preserve the original image task", async () => {
  let reads = 0;
  const waits: number[] = [];
  await assert.rejects(generateImage(async path => {
    assert.equal(path, "/images/tasks/existing-relay-task");
    reads += 1;
    throw { status: 502, code: "LOCAL_DEV_RELAY_ERROR", error: "fetch failed" };
  }, { ...input, taskId: "existing-relay-task" }, undefined, { delay: async milliseconds => { waits.push(milliseconds); } }), error => {
    assert.ok(error instanceof ImageGenerationError);
    assert.equal(error.taskId, "existing-relay-task");
    assert.equal(error.pending, true);
    assert.equal(error.terminalTask, false);
    assert.match(error.message, /继续查询原任务.*本地转发/);
    assert.doesNotMatch(error.message, /fetch failed/);
    return true;
  });
  assert.equal(reads, 5);
  assert.deepEqual(waits, [1500, 3000, 6000, 8000]);
});

test("image task authentication failures stop immediately and remain resumable", async () => {
  let reads = 0;
  await assert.rejects(generateImage(async () => {
    reads += 1;
    throw { code: "APP_SESSION_EXPIRED", message: "expired" };
  }, { ...input, taskId: "existing-auth-task" }, undefined, noWait), error => {
    assert.ok(error instanceof ImageGenerationError);
    assert.equal(error.code, "APP_SESSION_EXPIRED");
    assert.equal(error.pending, true);
    assert.equal(error.terminalTask, false);
    assert.match(error.message, /重新连接账户/);
    return true;
  });
  assert.equal(reads, 1);
});

test("a successful image task read resets the transient failure backoff", async () => {
  const waits: number[] = [];
  let reads = 0;
  await generateImage(async () => {
    reads += 1;
    if ([1, 2, 4].includes(reads)) throw { status: 503, code: "APP_GATEWAY_UNAVAILABLE" };
    return reads === 3 ? { id: "reset-retry", status: "in_progress" }
      : { id: "reset-retry", status: "completed", data: [{ url: "https://cdn.example/recovered.png" }] };
  }, { ...input, taskId: "reset-retry" }, undefined, { delay: async milliseconds => { waits.push(milliseconds); } });
  assert.deepEqual(waits, [1500, 3000, 1500, 1500]);
});

test("a confirmed terminal image task response is never retried as a relay outage", async () => {
  let reads = 0;
  await assert.rejects(generateImage(async () => {
    reads += 1;
    throw { status: 503, code: "provider_failed", message: "任务失败", details: { status: "failed" } };
  }, { ...input, taskId: "terminal-task" }, undefined, noWait), error => {
    assert.ok(error instanceof ImageGenerationError);
    assert.equal(error.pending, false);
    assert.equal(error.terminalTask, true);
    assert.equal(error.taskId, "terminal-task");
    assert.equal(error.message, "任务失败");
    return true;
  });
  assert.equal(reads, 1);
});

test("pausing during relay retry backoff prevents the next image task read", async () => {
  const controller = new AbortController();
  let reads = 0;
  await assert.rejects(generateImage(async () => {
    reads += 1;
    throw { status: 502, code: "APP_GATEWAY_UNAVAILABLE" };
  }, { ...input, taskId: "paused-relay-task" }, undefined, {
    signal: controller.signal,
    delay: async () => { controller.abort(); },
  }), error => {
    assert.ok(error instanceof ImageGenerationError);
    assert.equal(error.code, "IMAGE_TASK_PAUSED");
    assert.equal(error.pending, true);
    assert.equal(error.terminalTask, false);
    assert.equal(error.taskId, "paused-relay-task");
    return true;
  });
  assert.equal(reads, 1);
});

test("an explicitly missing image task is terminal so the UI can offer a fresh generation", async () => {
  const calls: string[] = [];
  await assert.rejects(
    generateImage(
      async (path) => {
        calls.push(path);
        throw {
          status: 404,
          details: {
            error: {
              code: "image_task_not_found",
              message: "image task not found",
            },
          },
        };
      },
      { ...input, taskId: "expired-task" },
    ),
    (error) => {
      assert.ok(error instanceof ImageGenerationError);
      assert.equal(error.pending, false);
      assert.equal(error.code, "image_task_not_found");
      assert.equal(error.terminalTask, true);
      assert.equal(error.taskId, "expired-task");
      assert.equal(error.message, "原图片任务已不存在，请重新生成。");
      return true;
    },
  );
  assert.deepEqual(calls, ["/images/tasks/expired-task"]);
});

test("ordinary creation failures with a task ID are not mistaken for a running timeout task", async () => {
  let calls = 0;
  await assert.rejects(
    generateImage(async () => {
      calls++;
      throw {
        code: "no_eligible_provider",
        details: {
          task_id: "failed-task",
          status: "failed",
          error: { code: "no_eligible_provider", message: "没有可用供应商" },
        },
      };
    }, input),
    (error) => {
      assert.ok(error instanceof ImageGenerationError);
      assert.equal(error.pending, false);
      assert.equal(error.taskId, "failed-task");
      assert.equal(error.terminalTask, true);
      assert.equal(error.message, "没有可用供应商");
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("completed tasks without image data fail explicitly and never create a replacement task", async () => {
  let calls = 0;
  await assert.rejects(
    generateImage(
      async () => {
        calls++;
        return { status: "completed" };
      },
      { ...input, taskId: "empty-task" },
    ),
    {
      code: "IMAGE_TASK_EMPTY_RESULT",
      taskId: "empty-task",
      pending: false,
      terminalTask: true,
    },
  );
  assert.equal(calls, 1);
});

test("reference images use the public multipart edit route with distinct image files and no JSON header", async () => {
  const sources = [
    "https://cdn.example/one.png",
    "https://cdn.example/two.png",
  ];
  const reads: string[] = [];
  const result = await generateImage(
    async (path, init) => {
      assert.equal(path, "/images/edits");
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers, undefined);
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("model"), input.model);
      assert.equal(init.body.get("prompt"), input.prompt);
      assert.equal(init.body.get("n"), "1");
      assert.equal(init.body.has("size"), false);
      const files = init.body.getAll("image[]");
      assert.equal(files.length, 2);
      assert.ok(files[0] instanceof Blob);
      assert.ok(files[1] instanceof Blob);
      assert.equal(await files[0].text(), sources[0]);
      assert.equal(await files[1].text(), sources[1]);
      return { data: [{ url: "https://cdn.example/result.png" }] };
    },
    { ...input, images: [sources[0], sources[1], sources[0]] },
    undefined,
    {
      loadReference: async (url) => {
        reads.push(url);
        return new Blob([url], { type: "image/png" });
      },
    },
  );
  assert.equal(result.image, "https://cdn.example/result.png");
  assert.deepEqual(reads, sources);
});

test("an unreadable reference is an actionable error and never falls back to text generation", async () => {
  let submissions = 0;
  for (const loadReference of [
    async () => {
      throw new Error("CORS blocked");
    },
    async () => new Blob(["not an image"], { type: "text/html" }),
    async () => new Blob([], { type: "image/png" }),
  ]) {
    await assert.rejects(
      generateImage(
        async () => {
          submissions++;
          return {};
        },
        { ...input, images: ["https://cdn.example/unavailable.png"] },
        undefined,
        { loadReference },
      ),
      (error) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "IMAGE_REFERENCE_UNAVAILABLE");
        assert.equal(error.pending, false);
        assert.equal(error.terminalTask, false);
        assert.match(error.message, /第 1 张参考图无法读取/);
        return true;
      },
    );
  }
  assert.equal(submissions, 0);
});

test("a timed out edit resumes the existing task and does not reload references", async () => {
  const paths: string[] = [];
  let imageReads = 0;
  const result = await generateImage(
    async (path) => {
      paths.push(path);
      if (path === "/images/edits")
        throw {
          code: "media_task_timeout",
          details: { task_id: "edit-task" },
        };
      return {
        status: "completed",
        data: [{ url: "https://cdn.example/edit.png" }],
      };
    },
    { ...input, images: ["https://cdn.example/reference.png"] },
    undefined,
    {
      loadReference: async () => {
        imageReads++;
        return new Blob(["reference"], { type: "image/png" });
      },
    },
  );
  assert.equal(result.taskId, "edit-task");
  assert.equal(imageReads, 1);
  assert.deepEqual(paths, ["/images/edits", "/images/tasks/edit-task"]);
  const resumePaths: string[] = [];
  await generateImage(
    async (path) => {
      resumePaths.push(path);
      return { status: "completed", data: [{ url: result.image }] };
    },
    { ...input, images: ["unavailable"], taskId: "edit-task" },
    undefined,
    {
      loadReference: async () => {
        throw new Error("must not read images on resume");
      },
    },
  );
  assert.deepEqual(resumePaths, ["/images/tasks/edit-task"]);
});

test("pausing observation preserves the submitted task and resume only reads that task", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  await assert.rejects(
    generateImage(
      async (path) => {
        calls.push(path);
        return { id: "paused-task", status: "queued" };
      },
      input,
      undefined,
      {
        signal: controller.signal,
        delay: async () => {
          controller.abort();
          return new Promise<void>(() => {});
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof ImageGenerationError);
      assert.equal(error.taskId, "paused-task");
      assert.equal(error.pending, true);
      assert.equal(error.code, "IMAGE_TASK_PAUSED");
      assert.equal(error.message, "已暂停查询，任务仍在后台运行");
      return true;
    },
  );
  await generateImage(
    async (path) => {
      calls.push(path);
      return {
        status: "completed",
        data: [{ url: "https://cdn.example/done.png" }],
      };
    },
    { model: "", prompt: "", taskId: "paused-task" },
  );
  assert.deepEqual(calls, [
    "/images/generations",
    "/images/tasks/paused-task",
    "/images/tasks/paused-task",
  ]);
});

test("an uncertain submission can be recovered with the same persisted idempotency key and request", async () => {
  const snapshot = { ...input, idempotencyKey: "submission-persisted" };
  const submissions: { key?: string; body?: BodyInit }[] = [];
  const request: ImageRequest = async (path, init) => {
    assert.equal(path, "/images/generations");
    submissions.push({
      key: init?.headers?.["Idempotency-Key"],
      body: init?.body,
    });
    if (submissions.length === 1)
      throw new TypeError("Network connection lost");
    return { data: [{ url: "https://cdn.example/original-task-result.png" }] };
  };
  await assert.rejects(generateImage(request, snapshot), (error) => {
    assert.ok(error instanceof ImageGenerationError);
    assert.equal(error.pending, true);
    assert.equal(error.taskId, undefined);
    assert.equal(error.terminalTask, false);
    assert.match(error.message, /提交结果尚未确认，可恢复原提交/);
    return true;
  });
  const result = await generateImage(request, snapshot);
  assert.equal(result.image, "https://cdn.example/original-task-result.png");
  assert.deepEqual(submissions, [
    { key: snapshot.idempotencyKey, body: JSON.stringify({ ...input, n: 1 }) },
    { key: snapshot.idempotencyKey, body: JSON.stringify({ ...input, n: 1 }) },
  ]);
});

test("multipart submissions forward a persisted idempotency key without overriding the form boundary", async () => {
  await generateImage(
    async (path, init) => {
      assert.equal(path, "/images/edits");
      assert.deepEqual(init?.headers, { "Idempotency-Key": "edit-submission" });
      assert.ok(init?.body instanceof FormData);
      return { data: [{ b64_json: "YQ==" }] };
    },
    {
      ...input,
      images: ["https://cdn.example/reference.png"],
      idempotencyKey: "edit-submission",
    },
    undefined,
    {
      loadReference: async () => new Blob(["reference"], { type: "image/png" }),
    },
  );
});

test("input rejections end submissions while access and local failures do not settle old requests", async () => {
  const snapshot = { ...input, idempotencyKey: "same-request" };
  for (const [error, pending, terminalTask] of [
    [{ status: 400, message: "invalid prompt" }, false, true],
    [{ status: 401, message: "unauthorized" }, false, false],
    [{ status: 403, message: "access denied" }, false, false],
    [{ status: 409, message: "idempotency conflict" }, false, true],
    [{ status: 429, message: "quota exceeded" }, false, true],
    [{ status: 408, message: "request timeout" }, true, false],
    [{ status: 499, message: "client closed connection" }, true, false],
    [{ status: 500, message: "server error" }, true, false],
    [{ status: 502, message: "gateway error" }, true, false],
    [{ status: 504, message: "gateway timeout" }, true, false],
    [{ code: "APP_SESSION_UNAVAILABLE" }, false, false],
    [{ code: "APP_SESSION_EXPIRED" }, false, false],
    [{ code: "APP_API_PATH_NOT_ALLOWED" }, false, false],
    [{ code: "LOCAL_DEV_RUNTIME_NOT_CONFIGURED" }, false, false],
    [{ code: "APP_LOGIN_CANCELLED" }, false, false],
    [{ details: { task_id: "failed", status: "failed" } }, false, true],
  ] as const) {
    await assert.rejects(
      generateImage(async () => {
        throw error;
      }, snapshot),
      (actual) => {
        assert.ok(actual instanceof ImageGenerationError);
        assert.equal(actual.pending, pending, JSON.stringify(error));
        assert.equal(
          actual.terminalTask,
          terminalTask,
          JSON.stringify(error),
        );
        return true;
      },
    );
  }
  await assert.rejects(
    generateImage(async () => ({}), snapshot),
    {
      code: "IMAGE_RESPONSE_INVALID",
      pending: true,
      terminalTask: false,
    },
  );
  await assert.rejects(
    generateImage(async () => ({ status: "unknown", request_id: "req-no-task" }), { ...input, idempotencyKey: "same-request" }),
    (actual) => {
      assert.ok(actual instanceof ImageGenerationError);
      assert.equal(actual.code, "IMAGE_RESPONSE_INVALID");
      assert.equal(actual.status, "unknown");
      assert.equal(actual.requestId, "req-no-task");
      assert.equal(actual.pending, true);
      return true;
    },
  );
  await assert.rejects(
    generateImage(async () => ({ status: "completed", data: [] }), snapshot),
    {
      code: "IMAGE_TASK_EMPTY_RESULT",
      pending: false,
      terminalTask: true,
    },
  );
});

test("authorization failures while replaying an image submission preserve its original request for recovery", async () => {
  for (const failure of [
    { status: 401, code: "APP_SESSION_EXPIRED" },
    { status: 403, code: "media_task_access_denied" },
    { code: "APP_LOGIN_REQUIRED" },
  ]) {
    const snapshot = { ...input, idempotencyKey: "original-image-key" };
    const submissions: Array<{ key?: string; body?: BodyInit }> = [];
    const request: ImageRequest = async (path, init) => {
      assert.equal(path, "/images/generations");
      submissions.push({ key: init?.headers?.["Idempotency-Key"], body: init?.body });
      if (submissions.length === 1) throw failure;
      return { task_id: "image-original", data: [{ url: "https://cdn.example/recovered.png" }] };
    };
    await assert.rejects(generateImage(request, snapshot), actual => {
      assert.ok(actual instanceof ImageGenerationError);
      assert.equal(actual.terminalTask, false, "access failures never settle a previous uncertain task");
      assert.equal(actual.code, failure.code);
      return true;
    });
    const result = await generateImage(request, snapshot);
    assert.equal(result.taskId, "image-original");
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[0], submissions[1]);
    assert.equal(submissions[0].key, "original-image-key");
  }
});

test("synchronous app image responses preserve durable task and per-result asset identities", async () => {
  const result = await generateImage(async () => ({ task_id: "sync-task", data: [
    { b64_json: "QQ==", asset_id: "asset-one" },
    { url: "https://cdn.example.test/two.png", asset_id: "asset-two" },
  ] }), { model: "image", prompt: "test" });
  assert.equal(result.taskId, "sync-task");
  assert.deepEqual(result.assetIds, ["asset-one", "asset-two"]);
  assert.equal(result.images?.length, 2);
});

test("synchronous image results keep asset identities aligned after malformed provider slots", async () => {
  const result = await generateImage(async () => ({ data: [
    { url: "javascript:invalid", asset_id: "discarded" },
    { url: "https://cdn.example.test/one.png", asset_id: "asset-one" },
    { b64_json: "Qg==", asset_id: "asset-two" },
  ] }), { model: "image", prompt: "test" });
  assert.deepEqual(result.assetIds, ["asset-one", "asset-two"]);
  assert.deepEqual(result.images, ["https://cdn.example.test/one.png", "data:image/png;base64,Qg=="]);
});

test("an image create accepted during abort preserves its id before observation stops", async () => {
  for (const timedOut of [false, true]) {
    const controller = new AbortController();
    const order: string[] = [];
    await assert.rejects(generateImage(async path => {
      order.push(path);
      controller.abort("auth-lost");
      if (timedOut) throw { code: "media_task_timeout", task_id: "image-accepted", status: "in_progress" };
      return { id: "image-accepted", status: "queued" };
    }, { ...input, idempotencyKey: "frozen-image" }, async id => {
      await Promise.resolve();
      order.push(`saved:${id}`);
    }, { signal: controller.signal }), {
      code: "IMAGE_TASK_PAUSED", taskId: "image-accepted", pending: true, terminalTask: false,
    });
    await generateImage(async path => {
      order.push(path);
      return { id: "image-accepted", status: "completed", data: [{ url: "https://cdn.example/original.png" }] };
    }, { model: "", prompt: "", taskId: "image-accepted" });
    assert.deepEqual(order, ["/images/generations", "saved:image-accepted", "/images/tasks/image-accepted"]);
  }
});

test("uncertain image create after abort remains recoverable with the frozen request", async () => {
  const controller = new AbortController();
  const snapshot = { ...input, idempotencyKey: "image-original" };
  const submissions: Array<{ key?: string; body?: BodyInit }> = [];
  const request: ImageRequest = async (path, init) => {
    assert.equal(path, "/images/generations");
    submissions.push({ key: init?.headers?.["Idempotency-Key"], body: init?.body });
    if (submissions.length === 1) {
      controller.abort();
      throw new TypeError("response lost");
    }
    return { data: [{ url: "https://cdn.example/original.png" }] };
  };
  await assert.rejects(generateImage(request, snapshot, undefined, { signal: controller.signal }), actual => {
    assert.ok(actual instanceof ImageGenerationError);
    assert.equal(actual.pending, true);
    assert.equal(actual.terminalTask, false);
    assert.equal(actual.taskId, undefined);
    return true;
  });
  await generateImage(request, snapshot);
  assert.deepEqual(submissions[0], submissions[1]);
  assert.equal(submissions[0].key, snapshot.idempotencyKey);
});

test("image status HTTP authorization failures preserve the task and stop querying immediately", async () => {
  for (const status of [401, 403]) {
    const paths: string[] = [];
    await assert.rejects(generateImage(async path => {
      paths.push(path);
      throw { status, code: "APP_SESSION_EXPIRED" };
    }, { model: "", prompt: "", taskId: "image-auth" }, undefined, noWait), {
      code: "APP_SESSION_EXPIRED", taskId: "image-auth", pending: true, terminalTask: false,
    });
    assert.deepEqual(paths, ["/images/tasks/image-auth"]);
  }
});

test("image task persistence failures retain the accepted task identity", async () => {
  const paths: string[] = [];
  await assert.rejects(generateImage(async path => {
    paths.push(path);
    return { id: "image-not-saved", status: "queued" };
  }, input, async () => { throw new Error("disk unavailable"); }), {
    code: "IMAGE_TASK_PERSIST_FAILED", taskId: "image-not-saved", pending: true, terminalTask: false,
  });
  assert.deepEqual(paths, ["/images/generations"]);
});

test("a confirmed terminal image read stays terminal when observation is aborted", async () => {
  const controller = new AbortController();
  await assert.rejects(generateImage(async () => {
    controller.abort();
    throw { status: 503, code: "provider_failed", details: { status: "failed" } };
  }, { model: "", prompt: "", taskId: "image-ended" }, undefined, { signal: controller.signal }), {
    code: "provider_failed", taskId: "image-ended", pending: false, terminalTask: true,
  });
});

test("an uncertain image submission with a returned task id can recover without an idempotency key", async () => {
  await assert.rejects(generateImage(async () => {
    throw { status: 502, code: "provider_response_unknown", task_id: "image-uncertain" };
  }, input), { taskId: "image-uncertain", pending: true, terminalTask: false });
  const paths: string[] = [];
  await generateImage(async path => {
    paths.push(path);
    return { status: "completed", data: [{ url: "https://cdn.example/original.png" }] };
  }, { model: "", prompt: "", taskId: "image-uncertain" });
  assert.deepEqual(paths, ["/images/tasks/image-uncertain"]);
});
