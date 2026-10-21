/**
 * Disposable, loopback-only platform fixture. No platform account or API key is used.
 *
 * Start UI + API: node tests/platform-fixture.mjs
 * Verify routes: node tests/platform-fixture.mjs --self-check
 * UI http://127.0.0.1:5191, fixture API http://127.0.0.1:5192
 * Optional: --port=5191 --api-port=5192 --api-only
 *
 * Models: fixture-sync, fixture-slow (504 with resumable task), fixture-retry (fails once).
 * GET /__fixture/state exposes only this process's disposable requests/storage/tasks.
 * POST /__fixture/control accepts { reset:true, slowPolls:6, failuresRemaining:1,
 *   storageFailuresRemaining:0, imageMode:"url"|"base64", videoCatalogStatus:200|403|503,
 *   storage:{key:document}, assets:[{id,task_id,type,...metadata}], videoTasks:[{id,key,body}],
 *   videoMode:"in_progress"|"cancel_pending"|"completed"|"failed"|"read-failure"|"unauthorized",
 *   videoReadFailuresRemaining:0, videoLostResponsesRemaining:0, videoCreateError:false }.
 * The video catalog covers public/nested capabilities, text-only and unavailable models.
 * Optional videoDataURL serves browser-recorded bytes as a disposable signed COS fixture.
 * Request logs are NDJSON on stdout; bodies omit image bytes and all auth headers.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createPlatformDevProxy } from '@ducking-mind/proxy-app-sdk/vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const image = await readFile(new URL('./fixtures/aspect-ratio.png', import.meta.url));
const fixtureAppId = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8')).id;
const args = process.argv.slice(2);
const portOption = (name, fallback) => {
  const value = Number(args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1) || fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`${name} 必须为 1024–65535 端口`);
  return value;
};
const uiPort = portOption('--port', 5191);
const apiPort = portOption('--api-port', 5192);
const apiOnly = args.includes('--api-only');
const uiOrigin = `http://127.0.0.1:${apiOnly ? apiPort : uiPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const defaults = () => ({ slowPolls: 6, failuresRemaining: 1, storageFailuresRemaining: 0, imageMode: 'url', videoCatalogStatus: 200,
  videoMode: 'in_progress', videoReadFailuresRemaining: 0, videoLostResponsesRemaining: 0, videoCreateError: false, videoCorsEnabled: true });
let settings = defaults();
const storage = new Map(), tasks = new Map(), assets = new Map(), requests = [];
const videoTasks = new Map();
const storageRevisions = new Map();
let storageClock = 0;
let taskSequence = 0;
let videoArtifact;
const models = [
  { id: 'fixture-sync', name: '测试 · 同步成功' },
  { id: 'fixture-slow', name: '测试 · 慢任务可恢复' },
  { id: 'fixture-retry', name: '测试 · 首次失败后重试' },
].map(model => ({ ...model, available: true, supported_operations: ['generation', 'edit'], supported_input_modes: ['text', 'image'], max_input_images: 4 }));
const videoCapabilities = { supported_operations: ['generation'], supported_input_modes: ['text', 'reference_image'], max_input_images: 2, duration_constraints: { min_seconds: 4, max_seconds: 8, step_seconds: 2 }, supported_resolutions: ['720p', '1080p'], supported_aspect_ratios: ['16:9', '9:16'], supports_audio_generation: true, default_parameters: { duration: 6, resolution: '1080p', aspect_ratio: '9:16', generate_audio: false } };
const videoModels = [
  { id: 'fixture-video-public', name: '测试视频 · 标准能力', available: true, ...videoCapabilities },
  { id: 'fixture-video-nested', name: '测试视频 · 嵌套能力', available: true, platform_capabilities: videoCapabilities },
  { id: 'fixture-video-text', name: '测试视频 · 仅文字', available: true, supported_input_modes: ['text'], max_input_images: 0 },
  { id: 'fixture-video-unavailable', name: '测试视频 · 暂不可用', available: false, ...videoCapabilities },
];

function log(entry) {
  const record = { sequence: requests.length + 1, time: new Date().toISOString(), ...entry };
  requests.push(record);
  process.stdout.write(JSON.stringify({ event: 'request', ...record }) + '\n');
}
function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Canvas-Fixture': '1' });
  response.end(JSON.stringify(value));
}
function error(response, status, code, message, extra = {}) {
  send(response, status, { error: { code, message }, ...extra });
}
async function bodyFor(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error('验证请求超过 16 MiB 限制');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (!bytes.length) return {};
  if ((request.headers['content-type'] || '').includes('multipart/form-data')) {
    const form = await new Request(apiOrigin, { method: 'POST', headers: { 'Content-Type': request.headers['content-type'] }, body: bytes }).formData();
    const files = [];
    for (const [field, value] of form) {
      if (typeof value !== 'string') files.push({ field, name: value.name, type: value.type, bytes: value.size, sha256: createHash('sha256').update(Buffer.from(await value.arrayBuffer())).digest('hex') });
    }
    return { model: form.get('model'), prompt: form.get('prompt'), n: Number(form.get('n')), files };
  }
  return JSON.parse(bytes.toString('utf8'));
}
function resultImage() {
  return settings.imageMode === 'base64' ? { b64_json: image.toString('base64') } : { url: `${uiOrigin}/v1/fixture-image.png` };
}
function assetDTO(asset) {
  const videoDelivery = asset.type === 'video' && videoArtifact ? signedVideoDelivery(asset.id) : null;
  return {
    ...asset,
    ...(videoDelivery ? { content_type: videoArtifact.type, size_bytes: videoArtifact.bytes.length, ...videoDelivery } : { url: asset.url || `${uiOrigin}/v1/fixture-image.png?asset=${encodeURIComponent(asset.id)}&revision=${asset.metadata_revision}` }),
    system_tags: [`app:${asset.source_app_id}`, `type:${asset.type}`, 'source:generated'],
  };
}
function signedVideoDelivery(assetId) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const signature = createHash('sha256').update(`disposable-video:${assetId}:${expires}`).digest('hex');
  return { url: `${apiOrigin}/__fixture/cos/videos/${encodeURIComponent(assetId)}?expires=${expires}&signature=${signature}`, url_expires_at: new Date(expires * 1000).toISOString() };
}
function videoDTO(task, status = settings.videoMode) {
  const asset = [...assets.values()].find(asset => asset.id === task.assetId || asset.task_id === task.id && asset.type === 'video');
  const delivered = asset && status === 'completed' && videoArtifact ? assetDTO(asset) : null;
  return { id: task.id, status,
    ...(delivered ? { asset_id: delivered.id, content_url: delivered.url, content_url_expires_at: delivered.url_expires_at, assets: [delivered], asset_status: 'ready' } : {}),
    ...(status === 'failed' ? { error: { code: 'provider_failed', message: '视频生成失败，请稍后重试。' } } : {}),
  };
}
function control(body) {
  if (body.reset) { settings = defaults(); videoArtifact = undefined; storage.clear(); storageRevisions.clear(); tasks.clear(); videoTasks.clear(); assets.clear(); requests.length = 0; taskSequence = 0; }
  if (body.videoDataURL !== undefined) {
    const match = typeof body.videoDataURL === 'string' && /^data:(video\/(?:webm|mp4))(?:;[^,]*)?;base64,(.+)$/.exec(body.videoDataURL);
    if (!match) throw new Error('videoDataURL 必须为本机录制的WebM或MP4');
    videoArtifact = { type: match[1], bytes: Buffer.from(match[2], 'base64') };
  }
  for (const field of ['slowPolls', 'failuresRemaining', 'storageFailuresRemaining', 'videoReadFailuresRemaining', 'videoLostResponsesRemaining']) {
    if (body[field] !== undefined) {
      if (!Number.isInteger(body[field]) || body[field] < 0 || body[field] > 10000) throw new Error(`${field} 必须是 0–10000 的整数`);
      settings[field] = body[field];
    }
  }
  if (body.imageMode !== undefined) {
    if (!['url', 'base64'].includes(body.imageMode)) throw new Error('imageMode 必须为 url 或 base64');
    settings.imageMode = body.imageMode;
  }
  if (body.videoCatalogStatus !== undefined) {
    if (![200, 403, 503].includes(body.videoCatalogStatus)) throw new Error('videoCatalogStatus 必须为 200、403 或 503');
    settings.videoCatalogStatus = body.videoCatalogStatus;
  }
  if (body.videoMode !== undefined) {
    if (!['in_progress', 'cancel_pending', 'completed', 'failed', 'read-failure', 'unauthorized'].includes(body.videoMode)) throw new Error('videoMode 无效');
    settings.videoMode = body.videoMode;
  }
  if (typeof body.videoCreateError === 'boolean') settings.videoCreateError = body.videoCreateError;
  if (typeof body.videoCorsEnabled === 'boolean') settings.videoCorsEnabled = body.videoCorsEnabled;
  if (body.videoTasks !== undefined) {
    if (!Array.isArray(body.videoTasks)) throw new Error('videoTasks 必须为数组');
    for (const task of body.videoTasks) {
      if (!task || typeof task.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(task.id)) throw new Error('videoTasks.id 无效');
      videoTasks.set(task.id, { ...structuredClone(task), polls: 0 });
    }
  }
  if (body.storage && typeof body.storage === 'object') for (const [key, value] of Object.entries(body.storage)) { storage.set(key, structuredClone(value)); storageRevisions.set(key, ++storageClock); }
  if (body.assets !== undefined) {
    if (!Array.isArray(body.assets)) throw new Error('assets 必须为数组');
    for (const value of body.assets) {
      if (!value || typeof value.id !== 'string' || !value.id) throw new Error('asset.id 必须非空');
      const now = new Date().toISOString();
      assets.set(value.id, { task_id: `task:${value.id}`, type: 'image', model: 'fixture-sync', size_bytes: image.length,
        created_at: now, updated_at: now, name: '', category: 'other', tags: [], folder: '', saved_to_library: false,
        metadata_revision: 0, source_app_id: fixtureAppId, ...structuredClone(value) });
    }
  }
}

const server = http.createServer(async (request, response) => {
  // The server binds loopback. Reject unexpected Host headers as an additional fixture boundary.
  const host = request.headers.host || '';
  if (host !== `127.0.0.1:${apiPort}`) return error(response, 400, 'fixture_host_required', '验证服务仅接受本机访问');
  const url = new URL(request.url || '/', apiOrigin), route = url.pathname, method = request.method || 'GET';
  try {
    if (route === '/__fixture/state' && method === 'GET') return send(response, 200, { settings, models, storage: Object.fromEntries(storage), tasks: Object.fromEntries(tasks), videoTasks: Object.fromEntries(videoTasks), assets: Object.fromEntries([...assets].map(([id, asset]) => [id, assetDTO(asset)])), requests });
    if (route === '/__fixture/control' && method === 'POST') { control(await bodyFor(request)); return send(response, 200, { success: true, settings }); }
    if (route === '/__fixture/health') return send(response, 200, { fixture: true, apiOrigin, uiOrigin });
    const cosMatch = route.match(/^\/__fixture\/cos\/videos\/([^/]+)$/);
    if (cosMatch && ['GET', 'HEAD'].includes(method)) {
      const id = decodeURIComponent(cosMatch[1]), expires = Number(url.searchParams.get('expires'));
      const signature = createHash('sha256').update(`disposable-video:${id}:${expires}`).digest('hex');
      log({ method, path: route, storage: 'cos', assetId: id, range: request.headers.range || null, hasAuthorization: Boolean(request.headers.authorization), hasCookie: Boolean(request.headers.cookie) });
      if (settings.videoCorsEnabled) {
        response.setHeader('Access-Control-Allow-Origin', uiOrigin);
        response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Content-Range, Accept-Ranges');
      }
      if (!Number.isFinite(expires) || expires <= Date.now() / 1000 || url.searchParams.get('signature') !== signature) return error(response, 403, 'fixture_signature_expired', '验证签名已过期');
      if (!videoArtifact || !assets.has(id)) return error(response, 404, 'fixture_video_not_found', '找不到验证视频');
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
      const size = videoArtifact.bytes.length;
      let start = 0, end = size - 1;
      if (range) {
        start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
        if (start >= size || end < start) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); return response.end(); }
      }
      response.writeHead(range ? 206 : 200, { 'Content-Type': videoArtifact.type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
      return response.end(method === 'HEAD' ? undefined : videoArtifact.bytes.subarray(start, end + 1));
    }
    if (route === '/v1/fixture-image.png' && method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return response.end(image);
    }
    const body = method === 'GET' ? {} : await bodyFor(request);
    const entry = { method, path: route + url.search, requestId: request.headers['x-request-id'] || null, idempotencyKey: request.headers['idempotency-key'] || null };
    if (route.startsWith('/__fixture/auth/')) {
      log(entry);
      if (route === '/__fixture/auth/profile' && method === 'GET') {
        return send(response, 200, { data: { id: 'fixture-user', email: 'canvas@example.test', username: 'Canvas 测试账户' } });
      }
      // A local development client has an in-memory session; these endpoints never issue credentials.
      return send(response, 200, route.endsWith('/logout') ? { success: true } : { authenticated: true, account_scope: "acs_" + "f".repeat(64) });
    }
    if (route === '/v1/storage/keys' && method === 'GET') {
      const prefix = url.searchParams.get('prefix') || '', cursor = url.searchParams.get('cursor') || '';
      const limit = Math.min(100, Number(url.searchParams.get('limit') || 100));
      const keys = [...storage.keys()].filter(k => k.startsWith(prefix) && k > cursor).sort();
      log(entry);
      return send(response, 200, { data: { keys: keys.slice(0, limit), next_cursor: keys.length > limit ? keys[limit - 1] : '' } });
    }
    if (route === '/v1/storage/batch' && method === 'POST') {
      const next = new Map(storage), revisions = new Map(storageRevisions), results = [];
      for (const op of body.operations || []) {
        if (op.expected_revision !== undefined && op.expected_revision !== (revisions.get(op.key) || 0))
          return error(response, 409, 'APP_STORAGE_CONFLICT', '存储版本冲突');
        if (op.op === 'delete') { next.delete(op.key); revisions.delete(op.key); results.push({ key: op.key, success: true }); }
        else { const revision = ++storageClock; next.set(op.key, structuredClone(op.value)); revisions.set(op.key, revision); results.push({ key: op.key, success: true, revision }); }
      }
      storage.clear(); storageRevisions.clear();
      for (const [key, value] of next) storage.set(key, value);
      for (const [key, revision] of revisions) storageRevisions.set(key, revision);
      log(entry);
      return send(response, 200, { data: { results } });
    }
    if (route === '/v1/storage/items') {
      const keys = url.searchParams.getAll('keys');
      if (method === 'GET' && keys.length) {
        const metadata = url.searchParams.get('include_metadata') === 'true';
        const data = Object.fromEntries(keys.map(key => [key, !storage.has(key) ? null : metadata
          ? { key, value: storage.get(key), revision: storageRevisions.get(key) }
          : storage.get(key)]));
        log(entry);
        return send(response, 200, { data });
      }
      const key = url.searchParams.get('key');
      if (!key) return error(response, 400, 'storage_key_required', '缺少测试存储 key');
      if (method === 'PUT' && settings.storageFailuresRemaining > 0) {
        settings.storageFailuresRemaining--;
        log({ ...entry, outcome: 'retryable-storage-failure' });
        return error(response, 503, 'fixture_storage_unavailable', '云端存储暂不可用，请重试（本机验证）');
      }
      if (method !== 'GET' && body.expected_revision !== undefined && body.expected_revision !== (storageRevisions.get(key) || 0))
        return error(response, 409, 'APP_STORAGE_CONFLICT', '存储版本冲突');
      if (method === 'PUT') {
        if (!Object.hasOwn(body, 'value')) return error(response, 400, 'storage_value_required', '缺少测试存储 value');
        storage.set(key, structuredClone(body.value)); storageRevisions.set(key, ++storageClock);
      } else if (method === 'DELETE') { storage.delete(key); storageRevisions.delete(key); }
      else if (method !== 'GET') return error(response, 405, 'method_not_allowed', '不支持此存储方法');
      log({ ...entry, ...(method === 'PUT' ? { document: { name: body.value?.name, nodeCount: body.value?.nodes?.length, edgeCount: body.value?.edges?.length } } : {}) });
      const value = storage.get(key) ?? null;
      const data = method === 'GET'
        ? (url.searchParams.get('include_metadata') === 'true' && storage.has(key) ? { key, value, revision: storageRevisions.get(key) } : value)
        : { success: true, revision: storageRevisions.get(key) };
      return send(response, 200, { data });
    }
    if (route === '/v1/images/models' && method === 'GET') { log(entry); return send(response, 200, { data: models }); }
    if (route === '/v1/videos/models' && method === 'GET') {
      log(entry);
      if (settings.videoCatalogStatus !== 200) return error(response, settings.videoCatalogStatus, 'fixture_video_catalog_unavailable', '视频模型目录暂不可用（本机验证）');
      return send(response, 200, { object: 'list', data: videoModels });
    }
    if (route === '/v1/videos' && method === 'POST') {
      let task = [...videoTasks.values()].find(task => task.key && task.key === entry.idempotencyKey);
      if (task && JSON.stringify(task.body) !== JSON.stringify(body)) return error(response, 409, 'idempotency_conflict', '原任务参数不一致');
      if (!task) {
        task = { id: `fixture-video-${++taskSequence}`, key: entry.idempotencyKey, body: structuredClone(body), polls: 0 };
        videoTasks.set(task.id, task);
      }
      log({ ...entry, body, taskId: task.id });
      if (settings.videoLostResponsesRemaining > 0) {
        settings.videoLostResponsesRemaining--;
        return error(response, 503, 'fixture_response_lost', '提交响应丢失（本机验证）');
      }
      if (settings.videoCreateError) return error(response, 503, 'media_config_snapshot_unavailable', '调度暂不可用（本机验证）', { task_id: task.id, status: 'queued' });
      return send(response, 202, { id: task.id, status: 'queued' });
    }
    const videoLookup = route.match(/^\/v1\/videos\/by-idempotency-key\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/);
    if (videoLookup && method === 'GET') {
      log(entry);
      if (settings.videoMode === 'unauthorized') return error(response, 401, 'APP_SESSION_EXPIRED', '测试会话已过期');
      const task = [...videoTasks.values()].find(task => task.key === videoLookup[1]);
      if (!task) return error(response, 404, 'video_task_not_found', '找不到原视频任务');
      return send(response, 200, videoDTO(task, settings.videoMode === 'read-failure' ? 'in_progress' : settings.videoMode));
    }
    const videoMatch = route.match(/^\/v1\/videos\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})(\/content)?$/);
    if (videoMatch && method === 'GET') {
      const task = videoTasks.get(videoMatch[1]);
      log({ ...entry, taskId: videoMatch[1] });
      if (!task) return error(response, 404, 'video_task_not_found', '找不到原视频任务');
      if (videoMatch[2]) return error(response, 404, 'fixture_content_unavailable', '状态验证不提供视频字节');
      task.polls++;
      if (settings.videoMode === 'unauthorized') return error(response, 401, 'APP_SESSION_EXPIRED', '测试会话已过期');
      if (settings.videoMode === 'read-failure' || settings.videoReadFailuresRemaining > 0) {
        settings.videoReadFailuresRemaining = Math.max(0, settings.videoReadFailuresRemaining - 1);
        return error(response, 503, 'fixture_read_unavailable', '任务查询暂不可用（本机验证）');
      }
      return send(response, 200, videoDTO(task));
    }
    if (route === '/v1/media/storage/usage' && method === 'GET') {
      log(entry);
      const used = [...assets.values()].reduce((sum, asset) => sum + asset.size_bytes, 0);
      return send(response, 200, { used_bytes: used, reserved_bytes: 0, quota_bytes: 1024 * 1024 * 1024, available_bytes: 1024 * 1024 * 1024 - used, status: 'active' });
    }
    if (route === '/v1/media/assets' && method === 'GET') {
      log(entry);
      const page = Math.max(1, Number(url.searchParams.get('page') || 1)), limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 12)));
      const query = (url.searchParams.get('query') || '').toLocaleLowerCase();
      const tag = (url.searchParams.get('tag') || '').toLocaleLowerCase();
      const items = [...assets.values()].filter(asset => asset.source_app_id === fixtureAppId)
        .filter(asset => !url.searchParams.has('saved_to_library') || asset.saved_to_library === (url.searchParams.get('saved_to_library') === 'true'))
        .filter(asset => !url.searchParams.has('folder') || asset.folder === url.searchParams.get('folder'))
        .filter(asset => !url.searchParams.has('type') || asset.type === url.searchParams.get('type'))
        .filter(asset => !url.searchParams.has('category') || asset.category === url.searchParams.get('category'))
        .filter(asset => !url.searchParams.has('task_id') || asset.task_id === url.searchParams.get('task_id'))
        .filter(asset => !tag || asset.tags.some(value => value.toLocaleLowerCase() === tag))
        .filter(asset => !query || [asset.name, asset.folder, ...asset.tags].join(' ').toLocaleLowerCase().includes(query));
      return send(response, 200, { items: items.slice((page - 1) * limit, page * limit).map(assetDTO), total: items.length, page, limit });
    }
    const assetMatch = route.match(/^\/v1\/media\/assets\/([^/]+)$/);
    if (assetMatch) {
      const asset = assets.get(decodeURIComponent(assetMatch[1]));
      log({ ...entry, ...(method === 'PATCH' ? { metadata: body } : {}) });
      if (!asset || asset.source_app_id !== fixtureAppId) return error(response, 404, 'media_asset_not_found', '找不到该应用的媒体资产');
      if (method === 'GET') return send(response, 200, assetDTO(asset));
      if (method === 'DELETE') { assets.delete(asset.id); return send(response, 200, { deleted: true }); }
      if (method !== 'PATCH') return error(response, 405, 'method_not_allowed', '不支持此媒体资产方法');
      if (Object.keys(body).some(key => !['expected_revision', 'name', 'category', 'tags', 'folder', 'saved_to_library'].includes(key))) return error(response, 400, 'media_asset_invalid_metadata', '来源与系统标签只读');
      if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) return error(response, 400, 'media_asset_invalid_metadata', '缺少资产版本');
      if (body.expected_revision !== asset.metadata_revision) return error(response, 409, 'media_asset_revision_conflict', '资产已被更新，请刷新后重试');
      const next = { ...asset };
      for (const key of ['name', 'folder']) if (body[key] !== undefined) {
        if (typeof body[key] !== 'string' || [...body[key].trim()].length > 100) return error(response, 400, 'media_asset_invalid_metadata', `${key} 最多100个字符`);
        next[key] = body[key].trim();
      }
      if (body.category !== undefined) {
        if (!['person', 'scene', 'object', 'style', 'sound', 'other'].includes(body.category)) return error(response, 400, 'media_asset_invalid_metadata', '资产分类无效');
        next.category = body.category;
      }
      if (body.tags !== undefined) {
        if (!Array.isArray(body.tags)) return error(response, 400, 'media_asset_invalid_metadata', '标签格式无效');
        const tags = [], seen = new Set();
        for (const value of body.tags) {
          if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 40 || /^(app|type|source):/i.test(value.trim())) return error(response, 400, 'media_asset_invalid_metadata', '标签格式无效');
          if (!seen.has(value.trim().toLocaleLowerCase())) { tags.push(value.trim()); seen.add(value.trim().toLocaleLowerCase()); }
        }
        if (tags.length > 20) return error(response, 400, 'media_asset_invalid_metadata', '最多20个标签');
        next.tags = tags;
      }
      if (body.saved_to_library !== undefined) {
        if (typeof body.saved_to_library !== 'boolean') return error(response, 400, 'media_asset_invalid_metadata', '资产库状态无效');
        next.saved_to_library = body.saved_to_library;
      }
      if (next.saved_to_library && !next.name) return error(response, 400, 'media_asset_invalid_metadata', '资产名称不能为空');
      next.metadata_revision++; next.updated_at = new Date().toISOString(); assets.set(asset.id, next);
      return send(response, 200, assetDTO(next));
    }
    if (['/v1/images/generations', '/v1/images/edits'].includes(route) && method === 'POST') {
      const details = { ...entry, model: body.model, prompt: body.prompt, n: body.n, files: body.files || [] };
      if (!models.some(model => model.id === body.model) || typeof body.prompt !== 'string' || !body.prompt.trim()) {
        log({ ...details, outcome: 'invalid-input' });
        return error(response, 400, 'fixture_invalid_input', '请选择测试模型并提供提示词');
      }
      if (route.endsWith('/edits') && !body.files?.length) {
        log({ ...details, outcome: 'missing-reference' });
        return error(response, 400, 'fixture_image_required', '参考图创作必须发送真实 multipart 图片文件');
      }
      if (body.model === 'fixture-retry' && settings.failuresRemaining > 0) {
        settings.failuresRemaining--;
        log({ ...details, outcome: 'retryable-failure' });
        return error(response, 503, 'fixture_temporary_failure', '图片服务暂时繁忙，请点击重新生成（本机验证）');
      }
      if (body.model === 'fixture-slow') {
        const id = `fixture:task-${++taskSequence}`;
        tasks.set(id, { id, model: body.model, prompt: body.prompt, polls: 0, remaining: settings.slowPolls, status: 'in_progress' });
        log({ ...details, outcome: 'media_task_timeout', taskId: id });
        return error(response, 504, 'media_task_timeout', '任务仍在后台运行，请查询原任务（本机验证）', { task_id: id, status: 'in_progress', polling_url: `/v1/images/tasks/${id}` });
      }
      log({ ...details, outcome: 'completed' });
      return send(response, 200, { created: Math.floor(Date.now() / 1000), data: [resultImage()] });
    }
    const match = route.match(/^\/v1\/images\/(?:edits\/)?tasks\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/);
    if (match && method === 'GET') {
      const task = tasks.get(match[1]);
      if (!task) { log({ ...entry, outcome: 'not-found' }); return error(response, 404, 'fixture_task_missing', '找不到该测试任务'); }
      task.polls++;
      if (task.remaining > 0) task.remaining--;
      else task.status = 'completed';
      log({ ...entry, taskId: task.id, outcome: task.status, polls: task.polls });
      return send(response, 200, { id: task.id, status: task.status, ...(task.status === 'completed' ? { data: [resultImage()] } : {}) });
    }
    log({ ...entry, outcome: 'not-found' });
    return error(response, 404, 'fixture_route_not_found', '此路由未在本机验证服务中实现');
  } catch (cause) {
    error(response, 400, 'fixture_request_invalid', cause instanceof Error ? cause.message : '无效验证请求');
  }
});

// Override only this disposable process. The public helper must never inherit an online relay.
for (const name of ['PROXY_PLATFORM_GATEWAY_URL', 'PROXY_PLATFORM_AUTH_URL', 'PROXY_PLATFORM_RELAY_SECRET']) process.env[name] = '';
let vite;
async function close() {
  if (vite) await vite.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(apiPort, '127.0.0.1', resolve); });
  if (!apiOnly) {
    vite = await createViteServer({
      configFile: false, envDir: false, root, base: './', cacheDir: path.join(root, 'node_modules/.vite-platform-fixture'), plugins: [react()],
      define: { 'import.meta.env.VITE_CANVAS_FIXTURE_AUTH': JSON.stringify('1') },
      server: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: {
        ...createPlatformDevProxy({ gatewayURL: `${apiOrigin}/v1` }),
        // The fixture uses disposable auth endpoints instead of the normal
        // CLI relay. Keep the SDK's standard local profile path working so
        // Canvas can exercise the same account-card flow as development.
        '/__platform/auth': {
          target: apiOrigin,
          changeOrigin: true,
          rewrite: requestPath => requestPath.replace(/^\/__platform\/auth/, '/__fixture/auth'),
        },
        '/__fixture': { target: apiOrigin, changeOrigin: true },
      } },
    });
    await vite.listen();
  }
  process.stdout.write(JSON.stringify({ event: 'ready', fixture: true, uiOrigin, apiOrigin, models: models.map(model => model.id) }) + '\n');
  if (args.includes('--self-check')) {
    const request = async (route, init) => {
      const response = await fetch(uiOrigin + route, init), value = await response.json();
      if (!response.ok) throw Object.assign(new Error(value.error?.message || 'request failed'), { code: value.error?.code, details: value, status: response.status });
      return value;
    };
    assert.equal((await request('/__fixture/auth/status')).authenticated, true);
    assert.deepEqual((await request('/__platform/auth/profile')).data, {
      id: 'fixture-user', email: 'canvas@example.test', username: 'Canvas 测试账户',
    });
    assert.equal((await request('/v1/storage/items?key=fixture-test')).data, null);
    await request('/v1/storage/items?key=fixture-test', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: { name: '验证云端', nodes: [] } }) });
    assert.equal((await request('/v1/storage/items?key=fixture-test')).data.name, '验证云端');
    assert.deepEqual((await request('/v1/storage/items?keys=fixture-test&keys=missing')).data,
      { 'fixture-test': { name: '验证云端', nodes: [] }, missing: null });
    const entries = (await request('/v1/storage/items?keys=fixture-test&keys=missing&include_metadata=true')).data;
    assert.equal(entries['fixture-test'].revision, storageRevisions.get('fixture-test'));
    assert.equal(entries.missing, null);
    assert.equal((await request('/v1/images/models')).data.length, 3);
    const { generateImage } = await import('../src/generation.ts');
    const call = (route, init) => request('/v1' + route, init);
    const sync = await generateImage(call, { model: 'fixture-sync', prompt: '同步测试' });
    assert.equal((await fetch(sync.image)).headers.get('content-type'), 'image/png');
    const slow = await generateImage(call, { model: 'fixture-slow', prompt: '慢任务测试' }, undefined, { delay: async () => {} });
    assert.match(slow.taskId, /^fixture:task-/);
    assert.equal(requests.filter(entry => entry.model === 'fixture-slow' && entry.method === 'POST').length, 1);
    await assert.rejects(generateImage(call, { model: 'fixture-retry', prompt: '重试测试' }), /暂时繁忙/);
    assert.ok((await generateImage(call, { model: 'fixture-retry', prompt: '重试测试' })).image);
    const edit = await generateImage(call, { model: 'fixture-sync', prompt: '参考图测试', images: [sync.image] });
    assert.ok(edit.image);
    const editRequest = requests.find(entry => entry.path === '/v1/images/edits');
    assert.equal(editRequest.files[0].sha256, createHash('sha256').update(image).digest('hex'));
    control({ assets: [{ id: 'fixture-media' }, { id: 'foreign-media', source_app_id: 'another-app' }] });
    assert.equal((await request('/v1/media/assets?saved_to_library=true')).items.length, 0);
    assert.equal((await request('/v1/media/assets')).items.length, 1);
    const patchAsset = payload => request('/v1/media/assets/fixture-media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const savedAsset = await patchAsset({ expected_revision: 0, name: '测试角色', category: 'person', tags: [' Hero ', 'hero'], folder: '角色', saved_to_library: true });
    assert.equal(savedAsset.metadata_revision, 1);
    assert.deepEqual(savedAsset.tags, ['Hero']);
    assert.equal((await request('/v1/media/assets?saved_to_library=true&folder=%E8%A7%92%E8%89%B2&tag=Hero')).items.length, 1);
    await assert.rejects(patchAsset({ expected_revision: 0, name: '过期编辑' }), { code: 'media_asset_revision_conflict' });
    await assert.rejects(patchAsset({ expected_revision: 1, source_app_id: 'another-app' }), { status: 400 });
    await assert.rejects(request('/v1/media/assets/foreign-media'), { status: 404 });
    await patchAsset({ expected_revision: 1, saved_to_library: false });
    assert.equal((await request('/v1/media/assets/fixture-media')).saved_to_library, false);
    if (!apiOnly) assert.match(await (await fetch(uiOrigin)).text(), /src\/main.tsx/);
    process.stdout.write(JSON.stringify({ event: 'self-check', result: 'PASS', checks: ['gateway storage', 'local auth fixture', 'platform profile', 'models', 'sync image', '504 task resumes without resubmit', 'retry', 'multipart reference bytes', 'media metadata CAS and app isolation', 'vite root'] }) + '\n');
    await close();
  } else {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().then(() => process.exit(0)); });
  }
} catch (cause) {
  await close();
  process.stderr.write((cause instanceof Error ? cause.stack : String(cause)) + '\n');
  process.exitCode = 1;
}
