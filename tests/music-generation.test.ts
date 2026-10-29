import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelMusic,
  generateMusic,
  MusicGenerationError,
  readMusicContent,
  readMusicTask,
  readMusicTaskByIdempotencyKey,
  validateMusicContentBlob,
  type MusicRequest,
} from "../src/music-generation.ts";

test("submission freezes the exact request and returns the signed object-storage URL", async () => {
  const input = {
    model: " minimax-music-3.0 ", prompt: "  warm ambient  ", lyrics: " first line\nsecond line ", audio_base64: "SUQzAA==",
    audio_mode: "song" as const, lyrics_optimizer: false, duration: 31, output_format: "wav", idempotencyKey: "frozen-key",
  };
  let requestBody: Record<string, unknown> | undefined;
  const result = await generateMusic(async (path, init) => {
    assert.equal(path, "/music/generations");
    assert.equal(init?.method, "POST");
    assert.equal(init?.headers?.["Idempotency-Key"], "frozen-key");
    requestBody = JSON.parse(String(init?.body));
    return {
      id: "music-task-1", status: "completed", asset_id: "music-asset-1",
      data: [{ url: "https://objects.example/music.mp3?signature=temporary", format: "wav" }],
    };
  }, input);

  assert.deepEqual(requestBody, {
    model: input.model, prompt: input.prompt, lyrics: input.lyrics, audio_base64: input.audio_base64, audio_mode: input.audio_mode,
    lyrics_optimizer: false, duration: 31, output_format: "wav",
  });
  assert.deepEqual(result, {
    taskId: "music-task-1", contentUrl: "https://objects.example/music.mp3?signature=temporary", assetId: "music-asset-1",
  });
});

test("music bytes are fetched directly from object storage without a Gateway content request", async () => {
  const audio = new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x04])], { type: "audio/mpeg" });
  const controller = new AbortController();
  const signedUrl = "https://objects.example/music-2.mp3?signature=temporary";
  let fetched = "";
  const result = await readMusicContent(async () => assert.fail("A valid signed URL must not require a Gateway request"), "music-task-2", {
    contentUrl: signedUrl,
    signal: controller.signal,
    fetchResource: async (url, init) => {
      fetched = url;
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.signal, controller.signal);
      return new Response(audio);
    },
  });
  assert.equal(result.size, audio.size);
  assert.equal(fetched, signedUrl);
});

test("task details preserve the Gateway's signed storage URL for direct delivery", async () => {
  const taskId = "gateway-music-task", assetId = "gateway-music-asset";
  const deliveryUrl = "https://objects.example/music.mp3?signature=temporary";
  const result = await generateMusic(async () => ({
    id: taskId, status: "completed", task_status: "succeeded", phase: "completed", asset_status: "ready",
    asset_id: assetId, content_url: deliveryUrl, content_url_expires_at: "2026-10-14T12:00:00Z",
    assets: [{ id: assetId, type: "audio", content_type: "audio/mpeg", url: deliveryUrl, url_expires_at: "2026-10-14T12:00:00Z" }],
    data: [{ asset_id: assetId, url: deliveryUrl, content_type: "audio/mpeg" }],
  }), { model: "minimax-music-3.0", prompt: "summer song" });
  assert.deepEqual(result, { taskId, assetId, contentUrl: deliveryUrl, contentUrlExpiresAt: "2026-10-14T12:00:00Z" });
  const audio = new Blob(["ID3audio"], { type: "audio/mpeg" });
  let fetched = "";
  const downloaded = await readMusicContent(async () => assert.fail("Direct delivery must not call a Gateway byte endpoint"), taskId, {
    contentUrl: result.contentUrl,
    fetchResource: async url => { fetched = url; return new Response(audio); },
  });
  assert.equal(downloaded.size, audio.size);
  assert.equal(fetched, deliveryUrl);
});

test("music task recovery can use its durable route when only delivery URLs remain", async () => {
  const snapshot = await readMusicTask(async () => ({
    id: "delivery-only-task", status: "completed", asset_id: "delivery-only-asset",
    content_url: "https://objects.example/music.mp3?signature=expired",
    assets: [{ id: "delivery-only-asset", type: "audio", url: "https://objects.example/music.mp3?signature=expired" }],
  }), "delivery-only-task");
  assert.equal(snapshot.assetId, "delivery-only-asset");
  assert.equal(snapshot.contentUrl, "https://objects.example/music.mp3?signature=expired");
});

test("a legacy Gateway content URL is discarded and refreshed from the intended task", async () => {
  const apiPaths: string[] = [], objectURLs: string[] = [];
  const audio = new Blob(["audio"], { type: "audio/mpeg" });
  const signedUrl = "https://objects.example/music-3.mp3?signature=temporary";
  const downloaded = await readMusicContent(async path => {
    apiPaths.push(path);
    return { id: "music-task-3", status: "completed", content_url: signedUrl };
  }, "music-task-3", {
    contentUrl: "https://gateway.example/v1/music/tasks/other-task/content",
    fetchResource: async url => { objectURLs.push(url); return new Response(audio); },
  });
  assert.equal(downloaded.size, audio.size);
  assert.deepEqual(apiPaths, ["/music/tasks/music-task-3"]);
  assert.deepEqual(objectURLs, [signedUrl]);
});

test("resume with a durable task id reads it without creating a replacement", async () => {
  const paths: string[] = [];
  let reads = 0;
  const result = await generateMusic(async path => {
    paths.push(path);
    assert.notEqual(path, "/music/generations");
    reads += 1;
    return reads === 1
      ? { id: "music-task-4", status: "in_progress" }
      : { id: "music-task-4", status: "completed", data: [{ url: "https://objects.example/music-task-4.mp3?signature=temporary" }] };
  }, { model: "", prompt: "", taskId: "music-task-4" }, undefined, { intervalMs: 0, delay: async () => {} });
  assert.deepEqual(paths, ["/music/tasks/music-task-4", "/music/tasks/music-task-4"]);
  assert.equal(result.taskId, "music-task-4");
  assert.equal(result.contentUrl, "https://objects.example/music-task-4.mp3?signature=temporary");
});

test("a late create response persists its task id before an Abort becomes a resumable pause", async () => {
  const controller = new AbortController();
  let resolveStarted!: () => void;
  const started = new Promise<void>(resolve => { resolveStarted = resolve; });
  const saved: string[] = [];
  let finishPost!: (value: unknown) => void;
  const post = new Promise<unknown>(resolve => { finishPost = resolve; });
  const result = generateMusic(async path => {
    assert.equal(path, "/music/generations");
    resolveStarted();
    return post;
  }, { model: "m", prompt: "p", idempotencyKey: "same-submit" }, id => { saved.push(id); }, { signal: controller.signal });
  await started;
  controller.abort();
  finishPost({ id: "music-task-5", status: "in_progress" });
  await assert.rejects(result, error => error instanceof MusicGenerationError && error.code === "MUSIC_TASK_PAUSED" && error.taskId === "music-task-5" && error.pending);
  assert.deepEqual(saved, ["music-task-5"]);
});

test("an in-flight status GET can be stopped without converting the task to failure", async () => {
  const controller = new AbortController();
  let resolveRead!: () => void;
  const reading = new Promise<void>(resolve => { resolveRead = resolve; });
  const operation = generateMusic(async (path, init) => {
    if (path === "/music/generations") return { id: "music-task-6", status: "in_progress" };
    assert.equal(path, "/music/tasks/music-task-6");
    assert.equal(init?.signal, controller.signal);
    resolveRead();
    return new Promise<never>(() => {});
  }, { model: "m", prompt: "p", idempotencyKey: "same-submit" }, undefined, { signal: controller.signal });
  await reading;
  controller.abort();
  await assert.rejects(operation, error => error instanceof MusicGenerationError && error.code === "MUSIC_TASK_PAUSED" && error.taskId === "music-task-6" && error.pending);
});

test("only the Gateway's explicit task-not-found code is terminal", async () => {
  const input = { model: "m", prompt: "p", idempotencyKey: "frozen-key" };
  await assert.rejects(generateMusic(async path => {
    if (path === "/music/generations") return { id: "music-task-7", status: "in_progress" };
    throw { status: 404, code: "music_task_not_found" };
  }, input, undefined, { intervalMs: 0 }), error => error instanceof MusicGenerationError && error.terminalTask && !error.pending && error.code === "music_task_not_found");

  await assert.rejects(generateMusic(async path => {
    if (path === "/music/generations") return { id: "music-task-8", status: "in_progress" };
    throw { status: 404, code: "route_not_found" };
  }, input, undefined, { intervalMs: 0 }), error => error instanceof MusicGenerationError && error.pending && !error.terminalTask && error.code === "route_not_found");
});

test("a 4xx reconciliation signal retains the frozen submission", async () => {
  await assert.rejects(generateMusic(async () => {
    throw { status: 409, code: "provider_lookup_unsupported", details: { status: "unknown" } };
  }, { model: "m", prompt: "original", idempotencyKey: "preserve-me" }), error => {
    assert.ok(error instanceof MusicGenerationError);
    assert.equal(error.pending, true);
    assert.equal(error.terminalTask, false);
    assert.equal(error.code, "provider_lookup_unsupported");
    return true;
  });
});

test("content validation rejects empty payloads and gateway error documents", async () => {
  await assert.rejects(validateMusicContentBlob(new Blob()), /为空或不可用/);
  await assert.rejects(validateMusicContentBlob(new Blob(["{\"error\":\"not audio\"}"], { type: "application/json" })), /不是音频内容/);
  const pcm = new Blob([new Uint8Array([0, 64, 128, 255])], { type: "audio/pcm" });
  assert.equal(await validateMusicContentBlob(pcm), pcm);
});

test("task reads and cancellation use the durable Gateway routes", async () => {
  const seen: Array<{ path: string; method?: string; key?: string }> = [];
  const request: MusicRequest = async (path, init) => {
    seen.push({ path, method: init?.method, key: init?.headers?.["Idempotency-Key"] });
    return { id: "music-task-9", status: init?.method === "DELETE" ? "cancel_pending" : "in_progress" };
  };
  const snapshot = await readMusicTask(request, "music-task-9");
  assert.equal(snapshot.status, "in_progress");
  assert.equal((await cancelMusic(request, "music-task-9", "cancel-key")).status, "cancel_pending");
  assert.deepEqual(seen, [
    { path: "/music/tasks/music-task-9", method: undefined, key: undefined },
    { path: "/music/tasks/music-task-9", method: "DELETE", key: "cancel-key" },
  ]);
});

test("recovering a lost create response replays only the unchanged frozen body and key", async () => {
  const input = Object.freeze({
    model: "minimax-music-3.0", prompt: " original prompt ", lyrics: "verse\nchorus", audio_mode: "song" as const,
    audio_base64: "SUQzAA==",
    lyrics_optimizer: false, output_format: "mp3", duration: 60, sample_rate: 44100, bitrate: 256000,
    audio_setting: { format: "mp3" }, metadata: { project: "original" }, stream: false as const, idempotencyKey: "persisted-key",
  });
  const writes: Array<{ key?: string; body: string }> = [];
  const request: MusicRequest = async (path, init) => {
    assert.equal(path, "/music/generations");
    writes.push({ key: init?.headers?.["Idempotency-Key"], body: String(init?.body) });
    if (writes.length === 1) throw { status: 504, code: "gateway_timeout" };
    return { id: "recovered-music", status: "completed" };
  };
  await assert.rejects(generateMusic(request, input), error => error instanceof MusicGenerationError && error.pending && !error.terminalTask);
  assert.equal(writes.length, 1, "failed POST must not cause an automatic resubmission");
  assert.equal((await generateMusic(request, input)).taskId, "recovered-music");
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(input.idempotencyKey, "persisted-key");
});

test("recovery resolves the original task by idempotency key before replaying", async () => {
  const paths: string[] = [];
  const saved: string[] = [];
  const result = await generateMusic(async path => {
    paths.push(path);
    assert.equal(path, "/music/by-idempotency-key/frozen-key");
    return { id: "recovered-by-key", status: "completed", asset_id: "asset-by-key" };
  }, { model: "m", prompt: "p", idempotencyKey: "frozen-key" }, id => { saved.push(id); }, { recovery: true });
  assert.deepEqual(paths, ["/music/by-idempotency-key/frozen-key"]);
  assert.deepEqual(saved, ["recovered-by-key"]);
  assert.deepEqual(result, {
    taskId: "recovered-by-key", contentUrl: "", assetId: "asset-by-key",
  });
});

test("recovery replays the original frozen body only after an explicit not-found lookup", async () => {
  const input = Object.freeze({ model: "music-model", prompt: "original", output_format: "mp3", idempotencyKey: "frozen-key" });
  const paths: string[] = [];
  let body = "";
  const result = await generateMusic(async (path, init) => {
    paths.push(path);
    if (path === "/music/by-idempotency-key/frozen-key") throw { status: 404, code: "music_task_not_found" };
    assert.equal(path, "/music/generations");
    assert.equal(init?.headers?.["Idempotency-Key"], "frozen-key");
    body = String(init?.body);
    return { id: "newly-resolved-task", status: "completed" };
  }, input, undefined, { recovery: true });
  assert.deepEqual(paths, ["/music/by-idempotency-key/frozen-key", "/music/generations"]);
  assert.deepEqual(JSON.parse(body), { model: input.model, prompt: input.prompt, output_format: input.output_format });
  assert.equal(result.taskId, "newly-resolved-task");
});

test("recovery preserves uncertainty on lookup outages and never posts a replacement", async () => {
  const paths: string[] = [];
  const request: MusicRequest = async path => {
    paths.push(path);
    throw { status: 503, code: "database_unavailable" };
  };
  await assert.rejects(generateMusic(request, { model: "m", prompt: "p", idempotencyKey: "frozen-key" }, undefined, { recovery: true }), error => {
    assert.ok(error instanceof MusicGenerationError);
    assert.equal(error.pending, true);
    assert.equal(error.terminalTask, false);
    assert.equal(error.code, "database_unavailable");
    return true;
  });
  assert.deepEqual(paths, ["/music/by-idempotency-key/frozen-key"]);
  assert.equal(await readMusicTaskByIdempotencyKey(async () => {
    throw { status: 404, code: "music_task_not_found" };
  }, "frozen-key"), null);
});

test("an accepted task id in an error response is saved and queried without resubmitting", async () => {
  const actions: string[] = [];
  const result = await generateMusic(async (path, init) => {
    actions.push(path);
    if (init?.method === "POST") throw { status: 504, code: "creation_result_unknown", details: { task_id: "accepted-music", status: "unknown" } };
    return { id: "accepted-music", status: "completed" };
  }, { model: "m", prompt: "original", idempotencyKey: "same-key" }, id => { actions.push(`saved:${id}`); }, {
    observeUnknown: true, delay: async () => {},
  });
  assert.equal(result.taskId, "accepted-music");
  assert.deepEqual(actions, ["/music/generations", "saved:accepted-music", "/music/tasks/accepted-music"]);
});

test("task identity is persisted before the first poll and callback failure retains it", async () => {
  const actions: string[] = [];
  await generateMusic(async path => {
    actions.push(path);
    return { id: "remembered-task", status: path === "/music/generations" ? "pending" : "completed" };
  }, { model: "m", prompt: "p" }, async id => {
    await Promise.resolve(); actions.push(`saved:${id}`);
  }, { onStatus: snapshot => { actions.push(`status:${snapshot.status}`); } });
  assert.deepEqual(actions, ["/music/generations", "saved:remembered-task", "status:pending", "/music/tasks/remembered-task", "status:completed"]);
  await assert.rejects(generateMusic(async () => ({ id: "durable-task", status: "pending" }), { model: "m", prompt: "p" }, () => { throw new Error("disk unavailable"); }), error => {
    assert.ok(error instanceof MusicGenerationError);
    assert.equal(error.taskId, "durable-task");
    assert.equal(error.code, "MUSIC_TASK_PERSIST_FAILED");
    assert.equal(error.pending, true);
    return true;
  });
});

test("reconciliation polls at its slower interval and can resolve to completed", async () => {
  const waits: number[] = [];
  const states: string[] = [];
  let reads = 0;
  const result = await generateMusic(async path => {
    if (path === "/music/generations") return { id: "reconciling-task", task_status: "failed", error: { code: "provider_lookup_unsupported" } };
    reads += 1;
    return { id: "reconciling-task", task_status: reads === 1 ? "unknown" : "succeeded", status: reads === 1 ? "unknown" : "completed" };
  }, { model: "m", prompt: "p" }, undefined, {
    intervalMs: 10, reconciliationIntervalMs: 100, observeUnknown: true,
    delay: async milliseconds => { waits.push(milliseconds); }, onStatus: snapshot => { states.push(snapshot.status); },
  });
  assert.equal(result.taskId, "reconciling-task");
  assert.deepEqual(waits, [100, 100]);
  assert.deepEqual(states, ["failed", "unknown", "succeeded"]);
});

test("reconciliation can be suspended without treating the supplier result as failed", async () => {
  let calls = 0;
  await assert.rejects(generateMusic(async () => { calls++; return { id: "unconfirmed-task", task_status: "failed", error: { code: "creation_result_unknown" } }; }, { model: "m", prompt: "p" }), error => {
    assert.ok(error instanceof MusicGenerationError);
    assert.equal(error.pending, true);
    assert.equal(error.terminalTask, false);
    assert.equal(error.taskId, "unconfirmed-task");
    return true;
  });
  assert.equal(calls, 1);
});

test("reconciliation expiry, cancellation and unavailable completed assets are terminal", async () => {
  for (const response of [
    { task_status: "failed", error: { code: "unknown_resolution_expired" } },
    { task_status: "cancelled", error: { code: "creation_result_unknown" } },
    { task_status: "succeeded", asset_status: "expired" },
    { task_status: "refunded", error: { code: "creation_result_unknown" } },
  ]) {
    let calls = 0;
    await assert.rejects(generateMusic(async () => { calls++; return { id: "terminal-task", request_id: "request-1", ...response }; }, { model: "m", prompt: "p", taskId: "terminal-task" }, undefined, { observeUnknown: true }), error => {
      assert.ok(error instanceof MusicGenerationError);
      assert.equal(error.terminalTask, true);
      assert.equal(error.pending, false);
      assert.equal(error.requestId, "request-1");
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("completion waits for platform asset collection instead of returning content early", async () => {
  let reads = 0;
  const result = await generateMusic(async () => {
    reads++;
    return { id: "collecting-task", task_status: "succeeded", phase: reads === 1 ? "collecting" : "completed", asset_status: reads === 1 ? "pending" : "ready" };
  }, { model: "", prompt: "", taskId: "collecting-task" }, undefined, { intervalMs: 0, delay: async () => {} });
  assert.equal(reads, 2);
  assert.equal(result.taskId, "collecting-task");
});

test("temporary status outages are bounded and keep the existing task resumable", async () => {
  let reads = 0;
  const waits: number[] = [];
  await assert.rejects(generateMusic(async () => { reads++; throw { status: 503, code: "service_unavailable" }; }, { model: "", prompt: "", taskId: "unavailable-task" }, undefined, {
    intervalMs: 10, maxConsecutiveReadFailures: 3, delay: async milliseconds => { waits.push(milliseconds); },
  }), error => error instanceof MusicGenerationError && error.taskId === "unavailable-task" && error.pending && !error.terminalTask && error.code === "MUSIC_TASK_READ_UNAVAILABLE");
  assert.equal(reads, 3);
  assert.deepEqual(waits, [10, 20]);
});

test("task identity mismatches and unknown states keep the original identity", async () => {
  for (const response of [{ id: "different-task", status: "completed" }, { id: "original-task", status: "unexpected_status" }, { id: "original-task" }]) {
    await assert.rejects(generateMusic(async () => response, { model: "", prompt: "", taskId: "original-task" }), error => error instanceof MusicGenerationError && error.pending && !error.terminalTask && error.taskId === "original-task");
  }
  await assert.rejects(readMusicTask(async () => ({ id: "wrong-task", status: "completed" }), "original-task"), error => error instanceof MusicGenerationError && error.code === "MUSIC_TASK_INVALID_RESPONSE");
});

test("content reads refresh an expired signed URL and reject a non-audio successful body", async () => {
  const waits: number[] = [];
  let detailReads = 0, fetches = 0;
  const blob = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], { type: "audio/mpeg" });
  const refreshedUrl = "https://objects.example/current.mp3?signature=renewed";
  const result = await readMusicContent(async path => {
    detailReads++;
    assert.equal(path, "/music/tasks/content-task");
    return { id: "content-task", content_url: refreshedUrl };
  }, "content-task", {
    contentUrl: "https://objects.example/expired.mp3?signature=old",
    attempts: 2,
    delay: async milliseconds => { waits.push(milliseconds); },
    fetchResource: async url => {
      fetches++;
      if (fetches === 1) return new Response("expired", { status: 403 });
      assert.equal(url, refreshedUrl);
      return new Response(blob);
    },
  });
  assert.equal(result.size, blob.size);
  assert.equal(detailReads, 1);
  assert.equal(fetches, 2);
  assert.deepEqual(waits, [400]);
  let invalidCalls = 0;
  await assert.rejects(readMusicContent(async () => { invalidCalls++; return { id: "content-task", content_url: "https://objects.example/invalid.mp3?signature=x" }; }, "content-task", {
    fetchResource: async () => new Response("<html>login</html>", { headers: { "content-type": "audio/mpeg" } }),
  }), /不是音频内容/);
  assert.equal(invalidCalls, 1);
});

test("content Abort interrupts the current GET without retrying or changing task state", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const operation = readMusicContent(async (_path, init) => {
    calls++;
    assert.equal(init?.signal, controller.signal);
    started();
    return new Promise<never>(() => {});
  }, "content-task", { signal: controller.signal });
  await reading;
  controller.abort();
  await assert.rejects(operation, error => error instanceof MusicGenerationError && error.pending && error.code === "MUSIC_CONTENT_READ_STOPPED");
  assert.equal(calls, 1);
});


test("Cover recovery looks up the accepted task without reading local reference bytes", async () => {
  const paths: string[] = [];
  const result = await generateMusic(async path => {
    paths.push(path);
    return { id: "cover-recovered", status: "completed", data: [{ url: "https://objects.example/cover-recovered.mp3?signature=temporary" }] };
  }, { model: "cover", prompt: "frozen", idempotencyKey: "cover-key" }, undefined, {
    recovery: true,
    loadReferenceAudio: async () => assert.fail("Accepted tasks never require the original local file"),
  });
  assert.deepEqual(paths, ["/music/by-idempotency-key/cover-key"]);
  assert.equal(result.taskId, "cover-recovered");
});

test("Cover replay reads original local bytes only after explicit task-not-found", async () => {
  const events: string[] = [];
  await generateMusic(async (path, init) => {
    events.push(path);
    if (path.includes("by-idempotency-key")) throw { status: 404, code: "music_task_not_found" };
    assert.equal(JSON.parse(String(init?.body)).audio_base64, "SUQzAA==");
    return { id: "cover-new", status: "completed" };
  }, { model: "cover", prompt: "frozen", idempotencyKey: "cover-key" }, undefined, {
    recovery: true, loadReferenceAudio: async () => { events.push("read-local"); return "SUQzAA=="; },
  });
  assert.deepEqual(events, ["/music/by-idempotency-key/cover-key", "read-local", "/music/generations"]);
});

test("Cover replay reports a missing local file only after explicit task-not-found and never posts", async () => {
  const calls: string[] = [];
  await assert.rejects(generateMusic(async path => {
    calls.push(path);
    throw Object.assign(new Error("not found"), { status: 404, code: "music_task_not_found" });
  }, { model: "cover", prompt: "original", idempotencyKey: "cover-original" }, undefined, {
    recovery: true,
    loadReferenceAudio: async () => { throw new MusicGenerationError("reference missing", { terminalTask: true, code: "MUSIC_REFERENCE_MISSING" }); },
  }), error => error instanceof MusicGenerationError && error.code === "MUSIC_REFERENCE_MISSING" && error.terminalTask);
  assert.deepEqual(calls, ["/music/by-idempotency-key/cover-original"]);
});

test("automatic recovery never recreates a music task after an idempotency lookup miss", async () => {
  const paths: string[] = [];
  await assert.rejects(generateMusic(async path => {
    paths.push(path);
    if (path === "/music/by-idempotency-key/auto-music") throw { status: 404, code: "music_task_not_found" };
    assert.fail(`automatic recovery must not submit to ${path}`);
  }, { model: "m", prompt: "p", idempotencyKey: "auto-music" }, undefined, {
    recovery: true, allowResubmit: false,
  }), error => error instanceof MusicGenerationError && error.pending && !error.terminalTask && error.code === "MUSIC_SUBMISSION_NOT_FOUND");
  assert.deepEqual(paths, ["/music/by-idempotency-key/auto-music"]);
});
