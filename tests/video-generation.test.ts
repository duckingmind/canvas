import assert from "node:assert/strict";
import test from "node:test";
import { cancelVideo, generateVideo, readVideoContent, readVideoTask, readVideoTaskByIdempotencyKey, videoContentDiagnostic, VideoGenerationError, type VideoRequest } from "../src/video-generation.ts";

test("task results preserve delivered asset identity and signed URL expiry across create, poll and replay", async () => {
  const asset = { id: "video-asset", type: "video", url: "https://cos.test/video.mp4?q-signature=valid", url_expires_at: "2026-10-08T01:00:00Z", content_type: "video/mp4", size_bytes: 50 };
  const response = { id: "video-task", status: "completed", content_url: "/videos/video-task/content", assets: [{ id: "poster", type: "image", url: "https://cos.test/poster.jpg" }, asset] };
  const expected = { taskId: "video-task", contentUrl: asset.url, assetId: asset.id, contentUrlExpiresAt: asset.url_expires_at };
  assert.deepEqual(await generateVideo(async () => response, { model: "m", prompt: "p" }), expected);
  assert.deepEqual(await generateVideo(async () => response, { model: "", prompt: "", taskId: "video-task" }), expected);
  assert.deepEqual(await generateVideo(async () => response, { model: "", prompt: "", idempotencyKey: "existing-key" }, undefined, { recovery: { inputReferencesAvailable: false } }), expected);
  const snapshot = await readVideoTask(async () => ({ task: { ...response, content_url: asset.url, asset_id: asset.id, content_url_expires_at: asset.url_expires_at } }), "video-task");
  assert.equal(snapshot.contentUrl, expected.contentUrl);
  assert.equal(snapshot.assetId, expected.assetId);
  assert.equal(snapshot.contentUrlExpiresAt, expected.contentUrlExpiresAt);
  const legacyAbsolute = await readVideoTask(async () => ({ ...response, content_url: "https://gateway.test/v1/videos/video-task/content" }), "video-task");
  assert.equal(legacyAbsolute.contentUrl, asset.url);
});

test("a frozen submission with missing images resolves and persists its existing identity without a POST", async () => {
  const order: string[] = [];
  const result = await generateVideo(async (path, init) => {
    assert.notEqual(init?.method, "POST");
    order.push(path);
    return { id: "accepted-video", status: path.includes("by-idempotency-key") ? "in_progress" : "completed" };
  }, { model: "old-model", prompt: "original", idempotencyKey: "original-key" }, async id => {
    await Promise.resolve();
    order.push(`saved:${id}`);
  }, { recovery: { inputReferencesAvailable: false }, onStatus: snapshot => { order.push(`status:${snapshot.status}`); } });
  assert.equal(result.taskId, "accepted-video");
  assert.deepEqual(order, ["/videos/by-idempotency-key/original-key", "saved:accepted-video", "status:in_progress", "/videos/accepted-video", "status:completed"]);
});

test("completed or failed frozen tasks are recovered despite missing input images", async () => {
  for (const status of ["completed", "failed"]) {
    const order: string[] = [];
    const result = await generateVideo(async path => {
      order.push(path);
      return { id: "existing-video", status, error: { code: "provider_failed" } };
    }, { model: "", prompt: "", idempotencyKey: "original-key" }, id => { order.push(`saved:${id}`); }, { recovery: { inputReferencesAvailable: false } }).catch(error => error);
    assert.deepEqual(order, ["/videos/by-idempotency-key/original-key", "saved:existing-video"]);
    if (status === "completed") assert.equal(result.taskId, "existing-video");
    else { assert.ok(result instanceof VideoGenerationError); assert.equal(result.terminalTask, true); assert.equal(result.taskId, "existing-video"); }
  }
});

test("missing frozen inputs stop local recovery only after a precise not-found response", async () => {
  let calls = 0;
  const input = { model: "m", prompt: "original", idempotencyKey: "unchanged-key" };
  await assert.rejects(generateVideo(async (path, init) => {
    calls++;
    assert.equal(path, "/videos/by-idempotency-key/unchanged-key");
    assert.notEqual(init?.method, "POST");
    throw { status: 404, code: "video_task_not_found" };
  }, input, undefined, { recovery: { inputReferencesAvailable: false } }), error => {
    assert.ok(error instanceof VideoGenerationError);
    assert.equal(error.code, "VIDEO_SUBMISSION_INPUT_MISSING");
    assert.equal(error.pending, false);
    assert.equal(error.terminalTask, false); // Read absence cannot cancel a concurrently settling POST.
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(input.idempotencyKey, "unchanged-key");
});

test("lookup authorization, outages, and missing routes never become task failure or a replay", async () => {
  for (const failure of [
    { status: 401, code: "APP_SESSION_EXPIRED" },
    { status: 503, code: "APP_GATEWAY_UNAVAILABLE" },
    { status: 404, code: "route_not_found" },
    { status: 503, code: "video_task_not_found" },
    { code: "LOCAL_DEV_RELAY_ERROR" },
  ]) {
    let calls = 0;
    await assert.rejects(generateVideo(async (path, init) => {
      calls++;
      assert.equal(path, "/videos/by-idempotency-key/frozen-key");
      assert.notEqual(init?.method, "POST");
      throw failure;
    }, { model: "m", prompt: "p", idempotencyKey: "frozen-key" }, undefined, { recovery: { inputReferencesAvailable: false } }), error => {
      assert.ok(error instanceof VideoGenerationError);
      assert.equal(error.pending, true);
      assert.equal(error.terminalTask, false);
      assert.equal(error.code, failure.code);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("an absent frozen task with intact inputs replays the exact original key and payload", async () => {
  const requests: Array<{ path: string; key?: string; body?: unknown }> = [];
  const result = await generateVideo(async (path, init) => {
    requests.push({ path, key: init?.headers?.["Idempotency-Key"], body: init?.body && JSON.parse(String(init.body)) });
    if (path.includes("by-idempotency-key")) throw { status: 404, code: "video_task_not_found" };
    return { id: "replayed", status: "completed" };
  }, { model: "old-model", prompt: "original", images: ["https://cdn.test/original.png"], duration: 6, generate_audio: false, idempotencyKey: "original-key" }, undefined,
  { recovery: { inputReferencesAvailable: true } });
  assert.equal(result.taskId, "replayed");
  assert.deepEqual(requests, [
    { path: "/videos/by-idempotency-key/original-key", key: undefined, body: undefined },
    { path: "/videos", key: "original-key", body: { model: "old-model", prompt: "original", generate_audio: false, duration: 6, input_references: [{ type: "image_url", image_url: { url: "https://cdn.test/original.png" } }] } },
  ]);
});

test("asset references resolve only after idempotency lookup confirms the frozen task is absent", async () => {
  const events: string[] = [];
  const result = await generateVideo(async (path, init) => {
    events.push(path);
    if (path.includes("by-idempotency-key")) throw { status: 404, code: "video_task_not_found" };
    assert.equal(path, "/videos");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.input_references, [{ type: "audio_url", audio_url: { url: "https://assets.example/audio.mp3" } }]);
    return { id: "replayed-asset-video", status: "completed" };
  }, {
    model: "video-model", prompt: "animate", idempotencyKey: "frozen-asset-video",
    references: [{ type: "audio_url", assetId: "asset-audio", mediaType: "audio" }],
    resolveReferences: async references => {
      events.push("resolve-assets");
      assert.deepEqual(references, [{ type: "audio_url", assetId: "asset-audio", mediaType: "audio" }]);
      return [{ type: "audio_url", url: "https://assets.example/audio.mp3" }];
    },
  }, undefined, { recovery: { inputReferencesAvailable: true } });
  assert.equal(result.taskId, "replayed-asset-video");
  assert.deepEqual(events, ["/videos/by-idempotency-key/frozen-asset-video", "resolve-assets", "/videos"]);
});

test("lookup validates its identity and refuses malformed successful responses", async () => {
  for (const key of ["", "../bad", "with space", "a".repeat(129)]) {
    await assert.rejects(readVideoTaskByIdempotencyKey(async () => { assert.fail("invalid key must not be sent"); }, key), error => error instanceof VideoGenerationError && error.pending);
  }
  await assert.rejects(readVideoTaskByIdempotencyKey(async () => ({ status: "completed" }), "valid-key"), error => error instanceof VideoGenerationError && error.pending && !error.terminalTask);
  await readVideoTaskByIdempotencyKey(async path => {
    assert.equal(path, "/videos/by-idempotency-key/namespace:key");
    return { id: "original-task", status: "queued" };
  }, "namespace:key");
});

test("task lookup preserves supplier confirmation so a platform timeout stays unresolved", async () => {
  const snapshot = await readVideoTaskByIdempotencyKey(async () => ({
    task: {
      id: "timed-out-task",
      status: "failed",
      error_code: "unknown_resolution_expired",
      supplier_confirmation: {
        state: "unconfirmed_after_timeout",
        status: "unknown",
        source: "platform",
        reason: "supplier result was not confirmed",
      },
    },
  }), "frozen-key");
  assert.equal(snapshot?.status, "failed");
  assert.equal(snapshot?.code, "unknown_resolution_expired");
  assert.equal(snapshot?.supplierConfirmation?.state, "unconfirmed_after_timeout");
  assert.equal(snapshot?.supplierConfirmation?.source, "platform");
});

test("the safe video projection preserves queued phase, raw state and supplier evidence", async () => {
  const snapshot = await readVideoTask(async () => ({
    id: "v-projection", status: "in_progress", task_status: "queued", phase: "queued",
    request_id: "request-projection", asset_status: "pending", asset_count: 0,
    supplier_confirmation: { state: "pending", status: "queued", source: "platform" },
  }), "v-projection");
  assert.equal(snapshot.status, "queued");
  assert.equal(snapshot.phase, "queued");
  assert.equal(snapshot.assetStatus, "pending");
  assert.equal(snapshot.requestId, "request-projection");
  assert.equal(snapshot.supplierConfirmation?.state, "pending");
});

test("video success waits for platform asset collection before returning a content URL", async () => {
  const states: string[] = [];
  let reads = 0;
  const result = await generateVideo(async (path, init) => {
    assert.equal(path, "/videos/v-assets");
    assert.notEqual(init?.method, "POST");
    reads += 1;
    return { id: "v-assets", status: "completed", task_status: "succeeded", phase: reads === 1 ? "collecting" : "completed", asset_status: reads === 1 ? "pending" : "ready" };
  }, { model: "", prompt: "", taskId: "v-assets" }, undefined, {
    intervalMs: 0, delay: async () => {}, onStatus: snapshot => { states.push(snapshot.assetStatus!); },
  });
  assert.equal(reads, 2);
  assert.deepEqual(states, ["pending", "ready"]);
  assert.equal(result.contentUrl, "/videos/v-assets/content");
});

test("failed legacy rows with unresolved lookup evidence keep reading the same task until closure", async () => {
  for (const code of ["creation_result_unknown", "provider_lookup_unsupported", "provider_status_lookup_unsupported"]) {
    let reads = 0;
    await assert.rejects(generateVideo(async (path, init) => {
      assert.equal(path, "/videos/v-unresolved");
      assert.notEqual(init?.method, "POST");
      reads += 1;
      return { id: "v-unresolved", status: "failed", error_code: reads === 1 ? code : "unknown_resolution_expired" };
    }, { model: "", prompt: "", taskId: "v-unresolved" }, undefined, { observeUnknown: true, delay: async () => {} }), error => {
      assert.ok(error instanceof VideoGenerationError);
      assert.equal(error.code, "unknown_resolution_expired");
      assert.equal(error.pending, false);
      assert.equal(error.terminalTask, true);
      return true;
    });
    assert.equal(reads, 2);
  }
});

test("a nested closed reconciliation stops frozen recovery without another POST or poll", async () => {
  let reads = 0;
  await assert.rejects(generateVideo(async (path, init) => {
    assert.equal(path, "/videos/by-idempotency-key/original-key");
    assert.notEqual(init?.method, "POST");
    reads += 1;
    return { task: { id: "v-closed", status: "failed", error_code: "unknown_resolution_expired", error_message: "window closed" } };
  }, { model: "", prompt: "", idempotencyKey: "original-key" }, undefined, { recovery: { inputReferencesAvailable: true }, observeUnknown: true }), error => {
    assert.ok(error instanceof VideoGenerationError);
    assert.equal(error.code, "unknown_resolution_expired");
    assert.equal(error.message, "window closed");
    assert.equal(error.terminalTask, true);
    return true;
  });
  assert.equal(reads, 1);
});

test("aborting an in-flight submission lookup ignores its late result without saving or replaying", async () => {
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  let calls = 0;
  const running = generateVideo(async () => { calls++; return new Promise(resolve => { finish = resolve; }); },
    { model: "m", prompt: "p", idempotencyKey: "frozen-key" }, () => assert.fail("late lookup cannot save into the replaced request"),
    { signal: controller.signal, recovery: { inputReferencesAvailable: true } });
  controller.abort("replaced");
  await assert.rejects(running);
  finish({ id: "late-task", status: "completed" });
  await Promise.resolve();
  assert.equal(calls, 1);
});

test("a rejected create preserves task and request references without polling or resubmitting", async () => {
  let calls = 0;
  await assert.rejects(generateVideo(async () => {
    calls++;
    throw { status: 503, code: "no_eligible_provider", requestId: "request-1", message: "input image count exceeds provider limit of 1", details: { task_id: "failed-task", status: "failed" } };
  }, { model: "h3", prompt: "p", idempotencyKey: "submission-1" }), error => {
    assert.ok(error instanceof VideoGenerationError);
    assert.equal(error.taskId, "failed-task");
    assert.equal(error.requestId, "request-1");
    assert.equal(error.pending, false);
    assert.equal(error.terminalTask, true);
    return true;
  });
  assert.equal(calls, 1);
});

test("video payload uses gateway input_references and returns a URL without downloading bytes", async () => {
  const calls: Array<[string, unknown]> = [];
  const request: VideoRequest = async (path, init) => {
    calls.push([path, init]);
    if (path === "/videos") return { id: "vid-1", status: "queued" };
    return { id: "vid-1", status: "completed" };
  };
const result = await generateVideo(request, { model: "video-model", prompt: "a cat", images: ["https://cdn/a.png"], duration: 5 });
  assert.deepEqual(result, { taskId: "vid-1", contentUrl: "/videos/vid-1/content" });
  const body = JSON.parse(String((calls[0][1] as { body: BodyInit }).body));
  assert.deepEqual(body.input_references, [{ type: "image_url", image_url: { url: "https://cdn/a.png" } }]);
  assert.equal(calls.some(([path]) => path.endsWith("/content")), false);
});

test("video payload preserves video references as video_url inputs", async () => {
  const calls: Array<[string, unknown]> = [];
  const request: VideoRequest = async (path, init) => {
    calls.push([path, init]);
    return path === "/videos" ? { id: "vid-reference", status: "queued" } : { id: "vid-reference", status: "completed" };
  };
  await generateVideo(request, { model: "video-model", prompt: "continue motion", references: [{ type: "video_url", url: "https://cdn/a.mp4" }] });
  const body = JSON.parse(String((calls[0][1] as { body: BodyInit }).body));
  assert.deepEqual(body.input_references, [{ type: "video_url", video_url: { url: "https://cdn/a.mp4" } }]);
});

test("video payload preserves mixed image, audio and video references", async () => {
  const calls: Array<[string, unknown]> = [];
  const request: VideoRequest = async (path, init) => {
    calls.push([path, init]);
    return path === "/videos" ? { id: "vid-mixed", status: "queued" } : { id: "vid-mixed", status: "completed" };
  };
  await generateVideo(request, {
    model: "video-model",
    prompt: "animate with sound",
    references: [
      { type: "image_url", url: "https://cdn/a.png" },
      { type: "audio_url", url: "https://cdn/a.mp3" },
      { type: "video_url", url: "https://cdn/a.mp4" },
    ],
  });
  const body = JSON.parse(String((calls[0][1] as { body: BodyInit }).body));
  assert.deepEqual(body.input_references, [
    { type: "image_url", image_url: { url: "https://cdn/a.png" } },
    { type: "audio_url", audio_url: { url: "https://cdn/a.mp3" } },
    { type: "video_url", video_url: { url: "https://cdn/a.mp4" } },
  ]);
});

test("video payload removes duplicate references without merging media types", async () => {
  const calls: Array<[string, unknown]> = [];
  const request: VideoRequest = async (path, init) => {
    calls.push([path, init]);
    return path === "/videos" ? { id: "vid-deduped", status: "queued" } : { id: "vid-deduped", status: "completed" };
  };
  await generateVideo(request, {
    model: "video-model",
    prompt: "reuse references once",
    references: [
      { type: "image_url", url: "https://cdn/a.png" },
      { type: "image_url", url: "https://cdn/a.png" },
      { type: "audio_url", url: "https://cdn/a.png" },
      { type: "audio_url", url: "https://cdn/a.png" },
    ],
  });
  const body = JSON.parse(String((calls[0][1] as { body: BodyInit }).body));
  assert.deepEqual(body.input_references, [
    { type: "image_url", image_url: { url: "https://cdn/a.png" } },
    { type: "audio_url", audio_url: { url: "https://cdn/a.png" } },
  ]);
});

test("a create error with a durable task id continues observing instead of resubmitting", async () => {
  for (const code of ["media_config_snapshot_unavailable", "media_routing_disabled", "media_task_timeout"]) {
    const events: string[] = [];
    const result = await generateVideo(async path => {
      events.push(path);
      if (path === "/videos") throw { status: 503, code, details: { task_id: "v-accepted-error", status: "queued" } };
      return { id: "v-accepted-error", status: "completed" };
    }, { model: "m", prompt: "p", idempotencyKey: "original-key" }, id => { events.push(`saved:${id}`); });
    assert.equal(result.taskId, "v-accepted-error");
    assert.deepEqual(events, ["/videos", "saved:v-accepted-error", "/videos/v-accepted-error"]);
  }
});

test("video payload preserves an explicit audio flag for a frozen submission", async () => {
  const bodies: Record<string, unknown>[] = [];
  const request: VideoRequest = async (path, init) => {
    if (path === "/videos") bodies.push(JSON.parse(String((init as { body: BodyInit }).body)));
    return path === "/videos" ? { id: "vid-audio", status: "queued" } : { id: "vid-audio", status: "completed" };
  };

  await generateVideo(request, { model: "video-model", prompt: "a city at night", generate_audio: false });

  assert.equal(bodies[0]?.generate_audio, false);
});

test("async task callback is awaited before polling", async () => {
  const order: string[] = [];
  const result = await generateVideo(async path => { order.push(path); return path === "/videos" ? { id: "v2", status: "queued" } : { id: "v2", status: "completed", content_url: "https://cdn/v2.mp4" }; }, { model: "m", prompt: "p" }, async () => { await Promise.resolve(); order.push("saved"); });
  assert.deepEqual(result, { taskId: "v2", contentUrl: "https://cdn/v2.mp4" });
  assert.deepEqual(order, ["/videos", "saved", "/videos/v2"]);
});

test("successful upstream aliases are treated as completed", async () => {
  for (const status of ["succeeded", "success"]) {
    const result = await generateVideo(async path => path === "/videos"
      ? { id: `v-${status}`, status: "queued" }
      : { id: `v-${status}`, status }, { model: "m", prompt: "p" });
    assert.deepEqual(result, { taskId: `v-${status}`, contentUrl: `/videos/v-${status}/content` });
  }
});

test("cancellation-in-progress remains observable until the final terminal state", async () => {
  let reads = 0;
  const result = await generateVideo(async path => {
    if (path === "/videos") return { id: "v-cancel", status: "queued" };
    reads += 1;
    return { id: "v-cancel", status: reads === 1 ? "cancel_pending" : "cancelled", message: "已取消" };
  }, { model: "m", prompt: "p" }, undefined, { intervalMs: 0, delay: async () => {} }).catch(error => error);
  assert.ok(result instanceof VideoGenerationError);
  assert.equal(result.terminalTask, true);
  assert.equal(result.code, "VIDEO_TASK_CANCELLED");
  assert.equal(reads, 2);
});

test("status reads survive a transient gateway failure and stop only on the server terminal state", async () => {
  let reads = 0;
  const result = await generateVideo(async path => {
    if (path === "/videos") return { id: "v-retry", status: "in_progress" };
    reads += 1;
    if (reads === 1) throw { status: 503, message: "gateway unavailable" };
    return { id: "v-retry", status: "completed", content_url: "https://cdn/v-retry.mp4" };
  }, { model: "m", prompt: "p" }, undefined, { intervalMs: 0, delay: async () => {} });
  assert.equal(reads, 2);
  assert.deepEqual(result, { taskId: "v-retry", contentUrl: "https://cdn/v-retry.mp4" });
});

test("persistent status read failures stop after a bounded recovery window", async () => {
  let reads = 0;
  await assert.rejects(
    generateVideo(async path => {
      if (path === "/videos") return { id: "v-read-outage", status: "queued" };
      reads += 1;
      throw { status: 503, message: "gateway unavailable" };
    }, { model: "m", prompt: "p" }, undefined, { intervalMs: 0, delay: async () => {} }),
    (actual) => {
      assert.ok(actual instanceof VideoGenerationError);
      assert.equal(actual.pending, true);
      assert.equal(actual.terminalTask, false);
      assert.equal(actual.taskId, "v-read-outage");
      assert.equal(actual.code, "VIDEO_TASK_READ_UNAVAILABLE");
      return true;
    },
  );
  assert.equal(reads, 5);
});

test("authorization and access read failures stop observation and retain the existing task", async () => {
  for (const failure of [
    { status: 401, code: "APP_SESSION_EXPIRED" },
    { status: 403, code: "media_task_access_denied" },
    { code: "APP_LOGIN_REQUIRED" },
  ]) {
    const paths: string[] = [];
    await assert.rejects(generateVideo(async path => {
      paths.push(path);
      throw failure;
    }, { model: "", prompt: "", taskId: "v-read-error" }, undefined, { delay: async () => {} }), actual => {
      assert.ok(actual instanceof VideoGenerationError);
      assert.equal(actual.pending, true);
      assert.equal(actual.terminalTask, false);
      assert.equal(actual.taskId, "v-read-error");
      assert.equal(actual.code, failure.code);
      return true;
    });
    assert.deepEqual(paths, ["/videos/v-read-error"]);
    await generateVideo(async path => {
      paths.push(path);
      return { id: "v-read-error", status: "completed" };
    }, { model: "", prompt: "", taskId: "v-read-error" });
    assert.deepEqual(paths, ["/videos/v-read-error", "/videos/v-read-error"]);
  }
});

test("aborting an accepted create saves its task id before pausing and resumes without another POST", async () => {
  for (const timedOut of [false, true]) {
    const controller = new AbortController();
    const order: string[] = [];
    await assert.rejects(generateVideo(async path => {
      order.push(path);
      controller.abort("auth-lost");
      if (timedOut) throw { code: "media_task_timeout", details: { task_id: "v-accepted", status: "in_progress" } };
      return { id: "v-accepted", status: "queued" };
    }, { model: "m", prompt: "p", idempotencyKey: "frozen-key" }, async id => {
      await Promise.resolve();
      order.push(`saved:${id}`);
    }, { signal: controller.signal }), actual => {
      assert.ok(actual instanceof VideoGenerationError);
      assert.equal(actual.code, "VIDEO_TASK_PAUSED");
      assert.equal(actual.pending, true);
      assert.equal(actual.terminalTask, false);
      assert.equal(actual.taskId, "v-accepted");
      return true;
    });
    await generateVideo(async path => {
      order.push(path);
      return { id: "v-accepted", status: "completed" };
    }, { model: "", prompt: "", taskId: "v-accepted" });
    assert.deepEqual(order, ["/videos", "saved:v-accepted", "/videos/v-accepted"]);
  }
});

test("aborting an uncertain create preserves the frozen idempotent submission", async () => {
  for (const failedTransport of [false, true]) {
    const controller = new AbortController();
    const snapshot = { model: "m", prompt: "p", idempotencyKey: "same-create" };
    const submissions: Array<{ key?: string; body?: BodyInit }> = [];
    const request: VideoRequest = async (path, init) => {
      assert.equal(path, "/videos");
      submissions.push({ key: init?.headers?.["Idempotency-Key"], body: init?.body });
      if (submissions.length === 1) {
        controller.abort();
        if (failedTransport) throw new TypeError("connection lost");
        return {};
      }
      return { id: "v-original", status: "completed" };
    };
    await assert.rejects(generateVideo(request, snapshot, undefined, { signal: controller.signal }), actual => {
      assert.ok(actual instanceof VideoGenerationError);
      assert.equal(actual.pending, true);
      assert.equal(actual.terminalTask, false);
      assert.equal(actual.taskId, undefined);
      return true;
    });
    await generateVideo(request, snapshot);
    assert.deepEqual(submissions[0], submissions[1]);
    assert.equal(submissions[0].key, "same-create");
  }
});

test("an abort before submission sends no POST and a confirmed terminal response stays terminal", async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(generateVideo(async () => { assert.fail("must not submit"); }, { model: "m", prompt: "p", idempotencyKey: "unused" }, undefined, { signal: before.signal }), {
    code: "VIDEO_SUBMISSION_STOPPED", pending: false, terminalTask: false,
  });
  for (const taskId of [undefined, "v-terminal"]) {
    const controller = new AbortController();
    const paths: string[] = [];
    await assert.rejects(generateVideo(async path => {
      paths.push(path);
      controller.abort();
      return { id: "v-terminal", status: "failed", error: { code: "provider_failed", message: "任务失败" } };
    }, { model: "m", prompt: "p", taskId }, undefined, { signal: controller.signal }), {
      code: "provider_failed", taskId: "v-terminal", pending: false, terminalTask: true, status: "failed",
    });
    assert.deepEqual(paths, [taskId ? "/videos/v-terminal" : "/videos"]);
  }
});

test("a task id survives a rejected persistence callback without polling or creating again", async () => {
  const paths: string[] = [];
  await assert.rejects(generateVideo(async path => {
    paths.push(path);
    return { id: "v-not-saved", status: "queued" };
  }, { model: "m", prompt: "p" }, async () => { throw new Error("disk unavailable"); }), {
    code: "VIDEO_TASK_PERSIST_FAILED", taskId: "v-not-saved", pending: true, terminalTask: false,
  });
  assert.deepEqual(paths, ["/videos"]);
});

test("pausing reconciliation interrupts its wait without a further status request", async () => {
  const controller = new AbortController();
  const paths: string[] = [];
  await assert.rejects(generateVideo(async path => {
    paths.push(path);
    return { id: "v-wait", status: "unknown" };
  }, { model: "m", prompt: "p", taskId: "v-wait" }, undefined, {
    signal: controller.signal, observeUnknown: true,
    delay: async () => { controller.abort(); return new Promise<void>(() => {}); },
  }), { code: "VIDEO_TASK_PAUSED", taskId: "v-wait", pending: true, terminalTask: false });
  assert.deepEqual(paths, ["/videos/v-wait"]);
});

test("pausing an in-flight GET returns immediately and ignores late responses or failures", { timeout: 5000 }, async () => {
  for (const lateFailure of [false, true]) {
    const controller = new AbortController();
    const paths: string[] = [];
    const observed: string[] = [];
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>(resolve => { markReadStarted = resolve; });
    let resolveRead!: (value: unknown) => void;
    let rejectRead!: (error: unknown) => void;
    const pendingRead = new Promise<unknown>((resolve, reject) => {
      resolveRead = resolve;
      rejectRead = reject;
    });
    const observation = generateVideo(async path => {
      paths.push(path);
      markReadStarted();
      return pendingRead;
    }, { model: "", prompt: "", taskId: "v-pending-read" }, undefined, {
      signal: controller.signal,
      onStatus: snapshot => { observed.push(snapshot.status); },
    });
    await readStarted;
    controller.abort();
    await assert.rejects(observation, {
      code: "VIDEO_TASK_PAUSED", taskId: "v-pending-read", pending: true, terminalTask: false,
    });
    if (lateFailure) rejectRead(new TypeError("late connection failure"));
    else resolveRead({ id: "v-pending-read", status: "completed" });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(observed, [], "stopped observers never publish a late task snapshot");
    const result = await generateVideo(async path => {
      paths.push(path);
      return { id: "v-pending-read", status: "completed" };
    }, { model: "", prompt: "", taskId: "v-pending-read" });
    assert.equal(result.taskId, "v-pending-read");
    assert.deepEqual(paths, ["/videos/v-pending-read", "/videos/v-pending-read"]);
  }
});

test("a malformed status response pauses the known task instead of polling forever", async () => {
  let reads = 0;
  await assert.rejects(
    generateVideo(async path => {
      if (path === "/videos") return { id: "v-malformed", status: "queued" };
      reads += 1;
      return {};
    }, { model: "m", prompt: "p" }, undefined, { intervalMs: 0, delay: async () => {} }),
    (actual) => {
      assert.ok(actual instanceof VideoGenerationError);
      assert.equal(actual.pending, true);
      assert.equal(actual.terminalTask, false);
      assert.equal(actual.taskId, "v-malformed");
      assert.equal(actual.code, "VIDEO_TASK_STATUS_MISSING");
      return true;
    },
  );
  assert.equal(reads, 1);
});

test("a response without a video task id preserves its request diagnosis", async () => {
  await assert.rejects(
    generateVideo(async () => ({ status: "unknown", request_id: "req-video-no-task" }), { model: "m", prompt: "p", idempotencyKey: "same-video" }),
    (actual) => {
      assert.ok(actual instanceof VideoGenerationError);
      assert.equal(actual.code, "VIDEO_RESPONSE_INVALID");
      assert.equal(actual.status, "unknown");
      assert.equal(actual.requestId, "req-video-no-task");
      assert.equal(actual.pending, true);
      return true;
    },
  );
});

test("a real unknown server status keeps the task resumable", async () => {
  await assert.rejects(
    generateVideo(async path => path === "/videos"
      ? { id: "v-unknown", status: "queued" }
      : { id: "v-unknown", status: "unknown", error_code: "creation_result_unknown", message: "提交结果待核对" },
      { model: "m", prompt: "p" }, undefined, { intervalMs: 0, delay: async () => {} }),
    (actual) => {
      assert.ok(actual instanceof VideoGenerationError);
      assert.equal(actual.pending, true);
      assert.equal(actual.terminalTask, false);
      assert.equal(actual.taskId, "v-unknown");
      assert.equal(actual.status, "unknown");
      assert.equal(actual.code, "creation_result_unknown");
      return true;
    },
  );
});

test("the editor observes an unknown result through terminal failure without resubmitting or loading content", async () => {
  const calls: string[] = [], states: string[] = [], delays: number[] = [];
  let reads = 0;
  await assert.rejects(generateVideo(async (path) => {
    calls.push(path);
    if (path === "/videos") return { id: "v-observe", status: "queued" };
    reads += 1;
    return reads < 3
      ? { id: "v-observe", status: "unknown", error: { code: "creation_result_unknown", message: "non-JSON response" } }
      : { id: "v-observe", status: "failed", error: { code: "unknown_resolution_expired", message: "deadline reached" } };
  }, { model: "m", prompt: "p" }, undefined, {
    observeUnknown: true,
    delay: async (ms) => { delays.push(ms); },
    onStatus: (snapshot) => { states.push(snapshot.status); },
  }), (error) => {
    assert.ok(error instanceof VideoGenerationError);
    assert.equal(error.terminalTask, true);
    assert.equal(error.code, "unknown_resolution_expired");
    return true;
  });
  assert.deepEqual(states, ["queued", "unknown", "unknown", "failed"]);
  assert.deepEqual(delays, [15000, 15000]);
  assert.deepEqual(calls, ["/videos", "/videos/v-observe", "/videos/v-observe", "/videos/v-observe"]);
});

test("resuming an ambiguous video task observes success using only its original task id", async () => {
  const states: string[] = [], delays: number[] = [];
  const sequence = ["unknown", "in_progress", "completed"];
  const result = await generateVideo(async (path) => {
    assert.equal(path, "/videos/v-resume");
    return { id: "v-resume", status: sequence.shift() };
  }, { model: "", prompt: "", taskId: "v-resume" }, undefined, {
    observeUnknown: true,
    delay: async (ms) => { delays.push(ms); },
    onStatus: (snapshot) => { states.push(snapshot.status); },
  });
  assert.deepEqual(states, ["unknown", "in_progress", "completed"]);
  assert.deepEqual(delays, [15000, 2000]);
  assert.deepEqual(result, { taskId: "v-resume", contentUrl: "/videos/v-resume/content" });
});

test("an unknown create response waits before observation and cancellation prevents the next read", async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(generateVideo(async () => {
    requests += 1;
    return { id: "v-stop", status: "unknown", error: { code: "creation_result_unknown" } };
  }, { model: "m", prompt: "p" }, undefined, {
    observeUnknown: true,
    signal: controller.signal,
    delay: async (ms) => { assert.equal(ms, 15000); controller.abort(); },
  }), (error) => {
    assert.ok(error instanceof VideoGenerationError);
    assert.equal(error.code, "VIDEO_TASK_PAUSED");
    return true;
  });
  assert.equal(requests, 1);
});

test("a terminal task error preserves the server status for the UI", async () => {
  await assert.rejects(
    generateVideo(async path => path === "/videos"
      ? { id: "v-expired", status: "queued" }
      : { id: "v-expired", status: "failed", error_code: "unknown_resolution_expired", message: "核对窗口已结束" },
      { model: "m", prompt: "p" }, undefined, { intervalMs: 0, delay: async () => {} }),
    (actual) => {
      assert.ok(actual instanceof VideoGenerationError);
      assert.equal(actual.terminalTask, true);
      assert.equal(actual.status, "failed");
      assert.equal(actual.code, "unknown_resolution_expired");
      return true;
    },
  );
});

test("an unrecognized provider status remains resumable", async () => {
  await assert.rejects(
    generateVideo(async path => path === "/videos"
      ? { id: "v-provider-status", status: "queued" }
      : { id: "v-provider-status", status: "provider_waiting" },
      { model: "m", prompt: "p" }, undefined, { intervalMs: 0, delay: async () => {} }),
    (actual) => {
      assert.ok(actual instanceof VideoGenerationError);
      assert.equal(actual.pending, true);
      assert.equal(actual.terminalTask, false);
      assert.equal(actual.code, "VIDEO_TASK_UNKNOWN");
      return true;
    },
  );
});

test("explicit 4xx submission rejection is terminal while uncertain responses remain resumable", async () => {
  for (const [error, pending] of [[{ status: 400, message: "invalid" }, false], [{ status: 408, message: "timeout" }, true], [{ status: 499, message: "client closed" }, true], [{ status: 500, message: "gateway" }, true]] as const) {
    await assert.rejects(generateVideo(async () => { throw error; }, { model: "m", prompt: "p", idempotencyKey: "same" }), (actual) => {
      assert.ok(actual instanceof VideoGenerationError); assert.equal(actual.pending, pending); assert.equal(actual.terminalTask, !pending); return true;
    });
  }
});

test("reconciliation create errors preserve the frozen key even through an HTTP rejection wrapper", async () => {
  for (const code of ["creation_result_unknown", "provider_lookup_unsupported", "provider_status_lookup_unsupported"]) {
    let calls = 0;
    await assert.rejects(generateVideo(async (_path, init) => {
      calls += 1;
      assert.equal(init?.headers?.["Idempotency-Key"], "frozen-original");
      throw { status: 409, code, message: "provider lookup not supported", details: { status: "failed" } };
    }, { model: "video", prompt: "original", idempotencyKey: "frozen-original" }), error => {
      assert.ok(error instanceof VideoGenerationError);
      assert.equal(error.pending, true);
      assert.equal(error.terminalTask, false);
      assert.equal(error.code, code);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("deterministic routing failures returned as 503 are terminal", async () => {
  await assert.rejects(
    generateVideo(async () => { throw { status: 503, code: "no_eligible_provider", message: "no eligible media provider" }; }, { model: "m", prompt: "p", idempotencyKey: "same" }),
    (actual) => {
      assert.ok(actual instanceof VideoGenerationError);
      assert.equal(actual.pending, false);
      assert.equal(actual.terminalTask, true);
      assert.equal(actual.code, "no_eligible_provider");
      return true;
    },
  );
});

test("authorization failures while replaying a video submission preserve its original request for recovery", async () => {
  for (const failure of [
    { status: 401, code: "APP_SESSION_EXPIRED" },
    { status: 403, code: "media_task_access_denied" },
    { code: "APP_LOGIN_REQUIRED" },
  ]) {
    const snapshot = { model: "m", prompt: "frozen prompt", idempotencyKey: "original-video-key" };
    const submissions: Array<{ key?: string; body?: BodyInit }> = [];
    const request: VideoRequest = async (path, init) => {
      assert.equal(path, "/videos");
      submissions.push({ key: init?.headers?.["Idempotency-Key"], body: init?.body });
      if (submissions.length === 1) throw failure;
      return { id: "v-original", status: "completed" };
    };
    await assert.rejects(generateVideo(request, snapshot), actual => {
      assert.ok(actual instanceof VideoGenerationError);
      assert.equal(actual.terminalTask, false, "access failures never settle a previous uncertain task");
      assert.equal(actual.code, failure.code);
      return true;
    });
    const result = await generateVideo(request, snapshot);
    assert.equal(result.taskId, "v-original");
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[0], submissions[1]);
    assert.equal(submissions[0].key, "original-video-key");
  }
});

test("read and cancel helpers use independent content and DELETE routes", async () => {
  const calls: Array<[string, unknown]> = [];
  const blob = new Blob(["mp4"], { type: "video/mp4" });
  const request: VideoRequest = async (path, init) => { calls.push([path, init]); return path.endsWith("content") ? blob : { status: "cancelled" }; };
  assert.equal(await readVideoContent(request, "v3"), blob);
  const cancelled = await cancelVideo(request, "v3", "cancel-key");
  assert.equal(cancelled.taskId, "v3");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(calls[0][0], "/videos/v3/content"); assert.equal((calls[1][1] as { method: string }).method, "DELETE");
  assert.equal((calls[1][1] as { headers: Record<string, string> }).headers["Idempotency-Key"], "cancel-key");
});

test("cancellation reports the server snapshot without inventing a terminal state", async () => {
  for (const status of ["cancel_pending", "in_progress", "completed", ""]) {
    const snapshot = await cancelVideo(async () => ({ status, request_id: "cancel-request", error: { code: "cancel_observation", message: "取消请求已接收" } }), "v-cancel", "same-cancel");
    assert.equal(snapshot.taskId, "v-cancel");
    assert.equal(snapshot.status, status);
    assert.equal(snapshot.code, "cancel_observation");
    assert.equal(snapshot.message, "取消请求已接收");
    assert.equal(snapshot.requestId, "cancel-request");
  }
});

test("content reads retry eventual media_asset_not_ready without retrying permanent errors", async () => {
  let reads = 0;
  const blob = new Blob(["mp4"], { type: "video/mp4" });
  const value = await readVideoContent(async (path) => {
    reads += 1;
    if (reads < 3) throw { code: "media_asset_not_ready", message: "media asset is not ready" };
    return blob;
  }, "v-ready", { delay: async () => {} });
  assert.equal(value, blob);
  assert.equal(reads, 3);

  let permanentReads = 0;
  await assert.rejects(
    readVideoContent(async () => {
      permanentReads += 1;
      throw { status: 401, code: "media_task_access_denied", message: "无权读取视频" };
    }, "v-denied", { delay: async () => {} }),
  );
  assert.equal(permanentReads, 1);
});

test("content reads reject a successful non-video response instead of handing it to the decoder", async () => {
  await assert.rejects(
    readVideoContent(async () => new Blob(["<html>login</html>"], { type: "text/html" }), "v-html", { attempts: 1 }),
    /不是视频内容/,
  );
});

test("content reads detect containers, repair a generic MIME type and retain a safe diagnostic", async () => {
  const mp4Bytes = new TextEncoder().encode("\0\0\0\x18ftypisom\0\0\0\0avc1");
  const blob = await readVideoContent(async () => new Blob([mp4Bytes], { type: "application/octet-stream" }), "v-mime", { attempts: 1 });
  assert.equal(blob.type, "video/mp4");
  assert.match(videoContentDiagnostic(blob) || "", /video\/mp4.*MP4.*H\.264\/AVC/);

  const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x84]);
  const webm = await readVideoContent(async () => new Blob([webmBytes], { type: "video/mp4" }), "v-webm", { attempts: 1 });
  assert.equal(webm.type, "video/webm");
  assert.match(videoContentDiagnostic(webm) || "", /WebM\/EBML/);
});

test("content reads identify a successful HTML or JSON gateway response", async () => {
  for (const [body, type] of [["<html>session expired</html>", "text/html"], ['{"error":"unavailable"}', "application/octet-stream"]]) {
    await assert.rejects(
      readVideoContent(async () => new Blob([body], { type }), "v-invalid", { attempts: 1 }),
      /接口返回的不是视频内容/,
    );
  }
});
