import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasAgent } from '../src/agent-capabilities.ts'
import { agentMetadata, capabilities, capability } from '../src/agent-tools.mjs'
import type { Document } from '../src/canvas-types.ts'
import { configureGeneration, generationParameters } from '../src/agent-settings.ts'

const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../manifest.json', import.meta.url), 'utf8'))
const validateValue = (schema: any, value: any, path = '$'): void => {
  const fail = (message: string): never => { throw new Error(`${path}: ${message}`) }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const type = value === null && types.includes('null') ? 'null' : types.find((item: string) => item !== 'null') || 'null'
  const valid = type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value)
      : type === 'null' ? value === null
        : type === 'integer' ? Number.isInteger(value)
          : typeof value === type
  if (!valid || (typeof value === 'number' && !Number.isFinite(value))) fail(`expected ${type}`)
  if (schema.enum && !schema.enum.some((item: unknown) => JSON.stringify(item) === JSON.stringify(value))) fail('value is not in enum')
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`)
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties || {}, key)) validateValue(schema.properties[key], item, `${path}.${key}`)
      else if (schema.additionalProperties === false) fail(`unknown field ${key}`)
    }
  }
  if (type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) fail('array length out of range')
    value.forEach((item: unknown, index: number) => validateValue(schema.items, item, `${path}[${index}]`))
  }
  if (type === 'string' && (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength)) fail('string length out of range')
  if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) fail('number out of range')
}
const validateResult = (name: string, result: unknown) => {
  const declaration = capability(name)
  validateValue(declaration.output_schema, result)
  return result
}

test('agent writes share editor undo and persistence; stale revisions never overwrite user edits', async () => {
  let doc: Document = { id: 'doc-1', name: 'Original', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 'now', updatedAt: 'now' }
  const undo: Document[] = [], saved: Document[] = []
  const agent = createCanvasAgent({ getDocument: () => doc, canWrite: () => true, beforeWrite() {}, commit: change => { undo.push(doc); doc = change(doc) }, persist: async value => { saved.push(structuredClone(value)) } })
  const state = agent.read_state()
  const args = { document_id: doc.id, expected_revision: state.revision, idempotency_key: '1' }
  const context = { signal: new AbortController().signal }
  await agent.rename_document({ ...args, name: 'Renamed' }, context)
  assert.equal(doc.name, 'Renamed'); assert.equal(undo[0].name, 'Original'); assert.equal(saved[0].name, 'Renamed')
  await assert.rejects(agent.rename_document({ ...args, name: 'stale' }, context), { code: 'CANVAS_REVISION_CONFLICT' })
  const current = agent.read_state()
  const created = await agent.create_note({ ...args, expected_revision: current.revision, title: 'Note', text: 'Hello' }, context)
  assert.equal(doc.nodes[0].id, created.nodeId); assert.equal(saved.at(-1)?.nodes[0].text, 'Hello')
  const beforeEdit = agent.read_state()
  doc = { ...doc, name: 'Human edit' }
  await assert.rejects(agent.rename_document({ ...args, expected_revision: beforeEdit.revision, name: 'Agent overwrite' }, context), { code: 'CANVAS_REVISION_CONFLICT' })
  assert.equal(doc.name, 'Human edit')
  doc = undo.pop()!; assert.equal(doc.nodes.length, 0)
})
test('document switch and cancellation block writes, media bytes never leave read_state', async () => {
  let doc: Document = { id: 'one', name: 'Original', nodes: [{ id: 'n', type: 'image', title: 'Image', text: '', x: 0, y: 0, width: 1, height: 1, color: '', image: 'secret-media-url' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '' }
  const agent = createCanvasAgent({ getDocument: () => doc, canWrite: () => true, beforeWrite() {}, commit: () => { throw new Error('must not write') }, persist: async () => {} })
  const state = agent.read_state(); assert(!JSON.stringify(state).includes('secret-media-url'))
  const args = { document_id: 'one', expected_revision: state.revision, idempotency_key: '1', name: 'No' }
  await assert.rejects(agent.rename_document(args, { signal: AbortSignal.abort() }))
  doc = { ...doc, id: 'two' }
  await assert.rejects(agent.rename_document(args, { signal: new AbortController().signal }), { code: 'CANVAS_DOCUMENT_CHANGED' })
})

test('agent cancellation keeps an unconfirmed provider result in reconciliation', async () => {
  let cancellationCalls = 0
  let doc: Document = {
    id: 'video-document', name: 'Video',
    nodes: [{
      id: 'video-node', type: 'prompt', mediaType: 'video', title: 'Video', text: 'Prompt',
      x: 0, y: 0, width: 320, height: 240, color: '', status: 'queued', taskId: 'video-task',
      taskDiagnostic: { status: 'unknown', code: 'creation_result_unknown' },
    }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '',
  }
  const agent = createCanvasAgent({
    getDocument: () => doc,
    canWrite: () => true,
    beforeWrite() {},
    commit: change => { doc = change(doc) },
    persist: async () => {},
    cancelGeneration: async () => { cancellationCalls += 1; return { status: 'cancel_pending', cancelled: false } },
  })
  const state = agent.read_state()
  await assert.rejects(agent.cancel_generation({
    document_id: doc.id,
    expected_revision: state.revision,
    idempotency_key: 'cancel-unknown',
    node_id: 'video-node',
  }, { signal: new AbortController().signal }), { code: 'CANVAS_TASK_NOT_CANCELLABLE' })
  assert.equal(cancellationCalls, 0)
})

test('retired TTS records stay readable while every generation action is rejected before side effects', async () => {
  for (const patch of [
    { audioMode: 'tts' as const, status: 'idle' as const },
    { audioMode: 'tts' as const, status: 'queued' as const, ttsSubmission: { key: 'original-speech', model: 'minimax-speech-2.8-hd', text: '原文', settings: { voice_id: 'voice-original' } } },
    { audioMode: 'music' as const, audioTaskType: 'tts' as const, status: 'queued' as const, taskId: 'legacy-task' },
    { audioMode: 'tts' as const, audioTaskType: 'tts' as const, status: 'completed' as const, taskId: 'legacy-task', assetId: 'legacy-asset' },
  ]) {
    const doc: Document = {
      id: 'legacy-audio', name: 'History', createdAt: '', updatedAt: '',
      nodes: [{ id: 'speech', type: 'prompt', mediaType: 'audio', title: '历史音频', text: '原文', x: 0, y: 0, width: 480, height: 270, color: '', ttsSettings: { voice_id: 'voice-original', speed: 1.1 }, ...patch }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    };
    const before = structuredClone(doc);
    const effects: string[] = [];
    const agent = createCanvasAgent({
      getDocument: () => doc, canWrite: () => true, beforeWrite() {},
      commit: () => { effects.push('commit'); }, persist: async () => { effects.push('persist'); },
      getModels: () => [{ id: 'minimax-speech-2.8-hd', type: 'audio' }],
      startGeneration: () => { effects.push('submit'); }, resumeGeneration: () => { effects.push('resume'); },
      cancelGeneration: async () => { effects.push('cancel'); return { status: 'cancelled', cancelled: true }; },
    });
    const args = { document_id: doc.id, expected_revision: agent.read_state().revision, idempotency_key: 'do-not-submit', node_id: 'speech' };
    const context = { signal: new AbortController().signal };
    for (const operation of ['configure_generation', 'submit_generation', 'resume_generation', 'cancel_generation'] as const) {
      await assert.rejects(agent[operation](args, context), { code: 'CANVAS_FEATURE_UNAVAILABLE' });
    }
    assert.deepEqual(effects, []);
    assert.deepEqual(doc, before);
    assert.equal(agent.read_node({ node_id: 'speech' }).node.text, '原文');
    for (const [operation, result] of [
      ['read_state', agent.read_state()],
      ['read_node', agent.read_node({ node_id: 'speech' })],
      ['read_tasks', agent.read_tasks()],
    ] as const) {
      validateResult(operation, result);
      assert(!JSON.stringify(result).includes('ttsSettings'));
    }
    assert.deepEqual(agent.list_models().models, []);
  }
});

test('agent configures, submits, observes, resumes and cancels music tasks', async () => {
  let doc: Document = { id: 'music-document', name: 'Music', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '' }
  let startCalls = 0, resumeCalls = 0, cancelCalls = 0
  const musicModel = { id: 'minimax-music-2.5', type: 'audio', available: true, audio_modes: ['song', 'instrumental'], output_formats: ['mp3', 'wav'], supported_durations: [30, 60], supported_parameters: { lyrics_optimizer: { type: 'boolean' }, lyrics: { type: 'string', maxLength: 3500 } }, default_parameters: { audio_mode: 'song', output_format: 'mp3' } }
  const agent = createCanvasAgent({
    getDocument: () => doc, canWrite: () => true, beforeWrite() {},
    commit: change => { doc = change(doc) }, persist: async () => {}, getModels: () => [musicModel],
    startGeneration: node => { startCalls++; doc = { ...doc, nodes: doc.nodes.map(value => value.id === node.id ? { ...value, status: 'running', taskId: 'music-task', musicSubmission: { key: 'music-submit', model: musicModel.id, prompt: value.text, lyrics: value.musicLyrics } } : value) } },
    resumeGeneration: () => { resumeCalls++ },
    cancelGeneration: async () => { cancelCalls++; return { status: 'cancel_pending', cancelled: false } },
  })
  const context = { signal: new AbortController().signal }
  const args = () => ({ document_id: doc.id, expected_revision: agent.read_state().revision, idempotency_key: crypto.randomUUID() })
  const model = agent.list_models().models[0]
  validateResult('list_models', agent.list_models())
  assert.equal(model.type, 'audio')
  assert.deepEqual(model.parameters.music, { audioModes: ['song', 'instrumental'], outputFormats: ['mp3', 'wav'], durations: [30, 60], supportsLyricsOptimizer: true, defaults: { audio_mode: 'song', output_format: 'mp3' } })
  const created = await agent.create_nodes({ ...args(), nodes: [{ type: 'prompt', title: 'Song', text: 'An upbeat city-pop song', media_type: 'audio', model_id: model.id }] }, context)
  let node = doc.nodes.find(value => value.id === created.nodeIds[0])!
  assert.equal(node.mediaType, 'audio')
  await agent.configure_generation({ ...args(), node_id: node.id, music_settings: { audio_mode: 'instrumental', output_format: 'wav', duration: 60, lyrics: 'Late night lights', lyrics_optimizer: false } }, context)
  node = doc.nodes.find(value => value.id === node.id)!
  assert.deepEqual(node.musicSettings, { audio_mode: 'instrumental', output_format: 'wav', duration: 60, lyrics_optimizer: false })
  assert.equal(node.musicLyrics, 'Late night lights')
  assert.equal(agent.read_node({ node_id: node.id }).node.musicLyrics, 'Late night lights')
  validateResult('read_node', agent.read_node({ node_id: node.id }))
  validateResult('read_state', agent.read_state())
  const accepted = await agent.submit_generation({ ...args(), node_id: node.id }, context)
  assert.equal(accepted.accepted, true); assert.equal(startCalls, 1)
  const task = agent.read_tasks().tasks[0]
  assert.equal(task.mediaType, 'audio'); assert.equal(task.submissionId, 'music-submit')
  assert.deepEqual(task.musicSettings, { audio_mode: 'instrumental', output_format: 'wav', duration: 60, lyrics_optimizer: false })
  assert.equal(task.musicLyrics, 'Late night lights')
  validateResult('read_tasks', agent.read_tasks())
  const resumed = await agent.resume_generation({ ...args(), node_id: node.id }, context)
  assert.equal(resumed.accepted, true); assert.equal(resumeCalls, 1)
  const cancelled = await agent.cancel_generation({ ...args(), node_id: node.id }, context)
  assert.equal(cancelled.cancelled, false); assert.equal(cancelCalls, 1)
})

test('music settings validate optimizer support and parameter constraints from the current model catalog', () => {
  const node = { id: 'music-settings', type: 'prompt' as const, mediaType: 'audio' as const, title: '', text: 'A song', x: 0, y: 0, width: 320, height: 240, color: '', modelId: 'music-settings' }
  const base = { id: 'music-settings', type: 'audio', audio_modes: ['song', 'instrumental'], output_formats: ['mp3'] }
  assert.equal(generationParameters(base).music?.supportsLyricsOptimizer, false)
  assert.throws(() => configureGeneration(node, base, { music_settings: { lyrics_optimizer: true } }), { code: 'CANVAS_MODEL_PARAMETER_UNSUPPORTED' })
  assert.throws(() => configureGeneration(node, base, { music_settings: { duration: 30 } }), { code: 'CANVAS_MODEL_PARAMETER_UNSUPPORTED' })
  assert.throws(() => configureGeneration(node, base, { music_settings: { audio_mode: 'unsupported' } }), { code: 'CANVAS_MODEL_PARAMETER_UNSUPPORTED' })
  assert.throws(() => configureGeneration(node, base, { music_settings: { output_format: 'wav' } }), { code: 'CANVAS_MODEL_PARAMETER_UNSUPPORTED' })
  assert.throws(() => configureGeneration(node, base, { video_settings: { duration: 30 } }), { code: 'CANVAS_INVALID_ARGUMENT' })
  const nested = { ...base, platform_capabilities: { supported_parameters: { lyrics_optimizer: { type: 'boolean' }, lyrics: { maxLength: 4 } }, default_parameters: { lyrics_optimizer: false } } }
  assert.equal(generationParameters(nested).music?.supportsLyricsOptimizer, true)
  assert.deepEqual(generationParameters(nested).music?.defaults, { audio_mode: 'song', output_format: 'mp3', lyrics_optimizer: false })
  const configured = configureGeneration(node, nested, { music_settings: { lyrics_optimizer: true, lyrics: '歌词' } })
  assert.deepEqual(configured.musicSettings, { audio_mode: 'song', output_format: 'mp3', lyrics_optimizer: true })
  assert.equal(configured.musicLyrics, '歌词')
  assert.throws(() => configureGeneration(node, nested, { music_settings: { lyrics: '歌词超过限额' } }), { code: 'CANVAS_MODEL_PARAMETER_UNSUPPORTED' })
})

test('agent music configuration excludes voice design and reference-audio cover models', () => {
  const node = { id: 'music-workflow', type: 'prompt' as const, mediaType: 'audio' as const, title: '', text: 'A song', x: 0, y: 0, width: 320, height: 240, color: '', modelId: 'music-workflow' }
  const voiceDesign = {
    id: 'minimax-voice-design', type: 'audio', available: true,
    supported_input_modes: ['text'], supported_parameters: { preview_text: { type: 'string' } },
  }
  const cover = {
    id: 'minimax-music-cover', type: 'audio', available: true,
    supported_input_modes: ['reference_audio'], audio_modes: ['song'], output_formats: ['mp3'],
  }
  assert.deepEqual(generationParameters(voiceDesign).music, null)
  assert.deepEqual(generationParameters(cover).music, null)
  assert.throws(() => configureGeneration(node, voiceDesign, { music_settings: { audio_mode: 'song' } }), { code: 'CANVAS_MODEL_UNAVAILABLE' })
  assert.throws(() => configureGeneration(node, cover, { music_settings: { audio_mode: 'song' } }), { code: 'CANVAS_MODEL_UNAVAILABLE' })
})

test('unresolved music submissions can resume without a task ID and unknown provider results cannot cancel', async () => {
  let doc: Document = { id: 'music-recovery', name: 'Music recovery', nodes: [{ id: 'music-node', type: 'prompt', mediaType: 'audio', title: 'Song', text: 'Prompt', x: 0, y: 0, width: 320, height: 240, color: '', status: 'queued', musicSubmission: { key: 'frozen-music', model: 'music-model', prompt: 'Frozen prompt' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '' }
  let resumeCalls = 0, cancelCalls = 0
  const agent = createCanvasAgent({ getDocument: () => doc, canWrite: () => true, beforeWrite() {}, commit: change => { doc = change(doc) }, persist: async () => {}, resumeGeneration: node => { assert.equal(node.musicSubmission?.key, 'frozen-music'); resumeCalls++ }, cancelGeneration: async () => { cancelCalls++; return { status: 'cancel_pending', cancelled: false } } })
  const context = { signal: new AbortController().signal }
  const args = () => ({ document_id: doc.id, expected_revision: agent.read_state().revision, idempotency_key: crypto.randomUUID(), node_id: 'music-node' })
  const tasks = agent.read_tasks(); validateResult('read_tasks', tasks)
  assert.equal(tasks.tasks[0].submissionId, 'frozen-music'); assert.equal(tasks.tasks[0].taskId, null)
  await agent.resume_generation(args(), context); assert.equal(resumeCalls, 1)
  await assert.rejects(agent.cancel_generation(args(), context), { code: 'CANVAS_TASK_NOT_CANCELLABLE' })
  doc = { ...doc, nodes: doc.nodes.map(node => ({ ...node, taskId: 'music-task', taskDiagnostic: { status: 'unknown', code: 'creation_result_unknown' } })) }
  await assert.rejects(agent.cancel_generation(args(), context), { code: 'CANVAS_TASK_NOT_CANCELLABLE' })
  assert.equal(cancelCalls, 0)
})

test('voice-design task snapshots and recovery retain the original submission identity', async () => {
  let doc: Document = {
    id: 'voice-recovery', name: 'Voice recovery',
    nodes: [{ id: 'voice-node', type: 'prompt', mediaType: 'audio', title: 'Voice', text: 'Warm voice', x: 0, y: 0, width: 320, height: 240, color: '', status: 'queued', voicePreviewText: 'Hello', voiceDesignSubmission: { key: 'original-voice-key', model: 'minimax-voice-design', prompt: 'Frozen warm voice', previewText: 'Frozen hello' } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '',
  }
  let resumedKey: string | undefined, cancellations = 0
  const agent = createCanvasAgent({
    getDocument: () => doc, canWrite: () => true, beforeWrite() {}, commit: change => { doc = change(doc) }, persist: async () => {},
    resumeGeneration: node => { resumedKey = node.voiceDesignSubmission?.key },
    cancelGeneration: async () => { cancellations++; return { status: 'cancel_pending', cancelled: false } },
  })
  const args = () => ({ document_id: doc.id, expected_revision: agent.read_state().revision, idempotency_key: crypto.randomUUID(), node_id: 'voice-node' })
  const context = { signal: new AbortController().signal }
  const before = agent.read_tasks(); validateResult('read_tasks', before)
  assert.equal(before.tasks[0].submissionId, 'original-voice-key')
  assert.equal(before.tasks[0].audioMode, 'voice_design')
  assert.equal(before.tasks[0].audioTaskType, 'voice_design')
  assert.equal(before.tasks[0].taskId, null)
  await agent.resume_generation(args(), context)
  assert.equal(resumedKey, 'original-voice-key')
  await assert.rejects(agent.cancel_generation(args(), context), { code: 'CANVAS_TASK_NOT_CANCELLABLE' })
  doc = { ...doc, nodes: doc.nodes.map(node => ({ ...node, taskId: 'voice-task', taskDiagnostic: { status: 'running' } })) }
  const cancelled = await agent.cancel_generation(args(), context); validateResult('cancel_generation', cancelled)
  assert.equal(cancellations, 1)
  doc = { ...doc, nodes: doc.nodes.map(node => ({ ...node, status: 'completed', audioTaskType: 'voice_design', voiceId: 'voice-output', voiceDesignSubmission: undefined })) }
  const after = agent.read_tasks(); validateResult('read_tasks', after)
  assert.equal(after.tasks[0].voiceId, 'voice-output')
  assert.deepEqual(after.tasks[0].resultNodeIds, ['voice-node'])
})

test('recorded audio is readable and replacing the local audio key invalidates media continuation', async () => {
  let doc: Document = {
    id: 'local-recording', name: 'Local recording',
    nodes: [{ id: 'recording-node', type: 'audio', mediaType: 'audio', audioMode: 'recording', title: 'Recording', text: '', x: 0, y: 0, width: 320, height: 180, color: '', localAudio: 'proxy-canvas:audio:v1:00000000-0000-0000-0000-000000000001', status: 'completed' }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '',
  }
  let reads = 0
  const agent = createCanvasAgent({
    getDocument: () => doc, canWrite: () => true, beforeWrite() {}, commit: () => {}, persist: async () => {},
    readMedia: async node => { reads++; return new Blob([new Uint8Array(196609).fill(node.localAudio!.endsWith('1') ? 1 : 2)], { type: 'audio/webm' }) },
  })
  const context = { signal: new AbortController().signal }
  const state = agent.read_node({ node_id: 'recording-node' }); validateResult('read_node', state)
  assert.equal(state.node.hasMedia, true)
  assert.equal(state.node.audioMode, 'recording')
  assert(!JSON.stringify(state).includes('proxy-canvas:audio:'))
  const first = await agent.read_media({ node_id: 'recording-node' }, context); validateResult('read_media', first)
  assert.equal(first.nextOffset, 196608)
  doc = { ...doc, nodes: doc.nodes.map(node => ({ ...node, localAudio: 'proxy-canvas:audio:v1:00000000-0000-0000-0000-000000000002' })) }
  await assert.rejects(agent.read_media({ node_id: 'recording-node', byte_offset: first.nextOffset!, expected_hash: first.hash }, context), { code: 'CANVAS_MEDIA_CHANGED' })
  assert.equal(reads, 2)
})

test('agent model catalog and writes exclude speech and unsupported audio workflows', async () => {
  const doc: Document = { id: 'audio-models', name: 'Models', nodes: [{ id: 'music', type: 'prompt', mediaType: 'audio', title: 'Music', text: 'A song', x: 0, y: 0, width: 320, height: 180, color: '', modelId: 'text-music', status: 'idle' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '' }
  const effects: string[] = []
  const excludedModels = [
    { id: 'minimax-voice-design', type: 'audio', supported_input_modes: ['text'] },
    { id: 'minimax-music-cover', type: 'audio', supported_input_modes: ['reference_audio'] },
    { id: 'minimax-speech-2.8-hd', type: 'audio', supported_input_modes: ['text'] },
    { id: 'custom-audio', type: 'audio', supported_parameters: { voice_setting: {} } },
  ]
  const agent = createCanvasAgent({
    getDocument: () => doc, canWrite: () => true, beforeWrite() {}, commit: () => { effects.push('commit') }, persist: async () => { effects.push('persist') },
    getModels: () => [
      { id: 'text-music', type: 'audio', supported_input_modes: ['text'] },
      ...excludedModels,
    ],
  })
  const result = agent.list_models(); validateResult('list_models', result)
  assert.deepEqual(result.models.map(model => model.id), ['text-music'])
  const args = { document_id: doc.id, expected_revision: agent.read_state().revision, idempotency_key: 'reject-unsupported-audio' }
  const context = { signal: new AbortController().signal }
  for (const model of excludedModels) {
    await assert.rejects(agent.create_nodes({ ...args, nodes: [{ type: 'prompt', media_type: 'audio', title: 'Unsupported', text: 'Hello', model_id: model.id }] }, context), { code: 'CANVAS_MODEL_UNAVAILABLE' })
    await assert.rejects(agent.update_nodes({ ...args, patches: [{ node_id: 'music', model_id: model.id }] }, context), { code: 'CANVAS_MODEL_UNAVAILABLE' })
    await assert.rejects(agent.configure_generation({ ...args, node_id: 'music', model_id: model.id }, context), { code: 'CANVAS_MODEL_UNAVAILABLE' })
  }
  assert.deepEqual(effects, [])
  assert.equal(doc.nodes[0].modelId, 'text-music')
})

test('batch editing is atomic; graph operations reject cycles and clean deleted group members', async () => {
  let doc: Document = { id: 'one', name: 'Graph', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '' }
  const context = { signal: new AbortController().signal }
  const agent = createCanvasAgent({ getDocument: () => doc, canWrite: () => true, beforeWrite() {}, commit: change => { doc = change(doc) }, persist: async () => {} })
  const args = () => ({ document_id: doc.id, expected_revision: agent.read_state().revision, idempotency_key: crypto.randomUUID() })
  const { nodeIds: [a, b] } = await agent.create_nodes({ ...args(), nodes: [{ type: 'note', title: 'A', text: 'Text' }, { type: 'prompt', title: 'B', text: 'Prompt' }] }, context)
  const before = structuredClone(doc)
  await assert.rejects(agent.update_nodes({ ...args(), patches: [{ node_id: a, text: 'Would change' }, { node_id: 'missing', text: 'invalid' }] }, context), { code: 'CANVAS_NODE_NOT_FOUND', executionStarted: false })
  assert.deepEqual(doc, before)
  const connection = await agent.connect_nodes({ ...args(), from_node_id: a, to_node_id: b }, context)
  await assert.rejects(agent.connect_nodes({ ...args(), from_node_id: b, to_node_id: a }, context), { code: 'CANVAS_INVALID_CONNECTION' })
  await agent.disconnect_nodes({ ...args(), edge_ids: [connection.edgeId] }, context); assert.equal(doc.edges.length, 0)
  await agent.connect_nodes({ ...args(), from_node_id: a, to_node_id: b }, context)
  doc = { ...doc, nodes: doc.nodes.map(node => ({ ...node, groupId: 'g' })) }
  await agent.arrange_nodes({ ...args(), node_ids: [a, b] }, context)
  assert.equal(doc.groups?.length, 1)
  await agent.delete_nodes({ ...args(), node_ids: [a] }, context)
  assert.equal(doc.edges.length, 0); assert.equal(doc.groups?.length, 0); assert.equal(doc.nodes[0].groupId, undefined)
})

test('model and task APIs keep media private and reject writes to running jobs', async () => {
  let doc: Document = { id: 'one', name: 'Tasks', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '' }
  const context = { signal: new AbortController().signal }
  let calls = 0
  const agent = createCanvasAgent({ getDocument: () => doc, canWrite: () => true, beforeWrite() {}, commit: change => { doc = change(doc) }, persist: async () => {}, getModels: () => [{ id: 'image-test', type: 'image', available: true }], startGeneration: node => { calls++; doc = { ...doc, nodes: doc.nodes.map(value => value.id === node.id ? { ...value, status: 'running', taskId: 'task-1', image: 'private-url' } : value) } } })
  const args = () => ({ document_id: doc.id, expected_revision: agent.read_state().revision, idempotency_key: crypto.randomUUID() })
  const created = await agent.create_nodes({ ...args(), nodes: [
    { type: 'prompt', title: 'Image', text: 'A cat', model_id: agent.list_models().models[0].id },
    { type: 'prompt', title: 'Discard while running', text: 'A dog', model_id: agent.list_models().models[0].id },
  ] }, context)
  const accepted = await agent.submit_generation({ ...args(), node_id: created.nodeIds[0] }, context)
  assert.equal(accepted.accepted, true); assert.equal(accepted.completed, false); assert.equal(calls, 1)
  assert.equal(agent.read_tasks().tasks[0].taskId, 'task-1'); assert(!JSON.stringify(agent.read_tasks()).includes('private-url'))
  await assert.rejects(agent.submit_generation({ ...args(), node_id: created.nodeIds[0] }, context), { code: 'CANVAS_TASK_RUNNING' }); assert.equal(calls, 1)
  const discarded = await agent.submit_generation({ ...args(), node_id: created.nodeIds[1] }, context)
  assert.equal(discarded.accepted, true); assert.equal(calls, 2)
  // A running task can be discarded immediately. The editor commit path is
  // responsible for stopping its observer and ignoring any late result.
  const deleteRunning = await agent.delete_nodes({ ...args(), node_ids: [created.nodeIds[1]] }, context)
  assert.equal(deleteRunning.savedLocally, true)
  assert.equal(doc.nodes.some(node => node.id === created.nodeIds[1]), false)
  // Single-output generations store the media on the prompt itself.
  doc = { ...doc, nodes: doc.nodes.map(node => ({ ...node, status: 'completed' })) }
  assert.deepEqual(agent.read_tasks().tasks[0].resultNodeIds, [created.nodeIds[0]])
  assert.equal(agent.read_node({ node_id: created.nodeIds[0] }).node.hasMedia, true)
  assert(!JSON.stringify(agent.read_node({ node_id: created.nodeIds[0] })).includes('private-url'))
})

test('delete_nodes keeps validation and revision guards while allowing active nodes', async () => {
  let doc: Document = { id: 'delete-guards', name: 'Delete guards', nodes: [{ id: 'running', type: 'prompt', title: 'Running', text: 'Prompt', x: 0, y: 0, width: 320, height: 240, color: '', status: 'running', taskId: 'task-running' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '' }
  const context = { signal: new AbortController().signal }
  const agent = createCanvasAgent({ getDocument: () => doc, canWrite: () => true, beforeWrite() {}, commit: change => { doc = change(doc) }, persist: async () => {} })
  const state = agent.read_state()
  const beforeMissing = structuredClone(doc)
  await assert.rejects(agent.delete_nodes({ document_id: doc.id, expected_revision: state.revision, idempotency_key: 'missing', node_ids: ['missing'] }, context), { code: 'CANVAS_NODE_NOT_FOUND' })
  assert.deepEqual(doc, beforeMissing)
  const stale = agent.read_state()
  doc = { ...doc, name: 'Human edit' }
  const beforeStale = structuredClone(doc)
  await assert.rejects(agent.delete_nodes({ document_id: doc.id, expected_revision: stale.revision, idempotency_key: 'stale', node_ids: ['running'] }, context), { code: 'CANVAS_REVISION_CONFLICT' })
  assert.deepEqual(doc, beforeStale)
})

// Validate the live, pre-serialization return values against the published
// contract: undefined optionals and incorrect pagination nulls must not slip
// through just because JSON serialization would otherwise hide them.
test('all Canvas editor handlers return the published output contract before serialization', async () => {
  assert.equal(Object.hasOwn(manifest, 'agent'), false)
  assert.equal(agentMetadata.namespace, 'canvas')
  assert.equal(new Set(capabilities.map(entry => entry.name)).size, capabilities.length)
  for (const entry of capabilities) {
    assert.equal(entry.input_schema.type, 'object')
    assert.equal(entry.output_schema.type, 'object')
    if (entry.access === 'write') assert(entry.input_schema.required.includes('idempotency_key'))
  }
  let doc: Document = { id: 'contract-document', name: 'Contract', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '' }
  const agent = createCanvasAgent({ getDocument: () => doc, canWrite: () => true, beforeWrite() {}, commit: change => { doc = change(doc) }, persist: async () => {}, getModels: () => [{ id: 'image-contract', type: 'image', available: true }, { id: 'video-contract', type: 'video' }, { name: 'Unusable record without ID' }], startGeneration: node => { doc = { ...doc, nodes: doc.nodes.map(value => value.id === node.id ? { ...value, status: 'queued' } : value) } } })
  const workspaceTools = new Set(['read_metadata', 'list_documents', 'open_document', 'create_document'])
  assert.deepEqual(Object.keys(agent).sort(), capabilities.filter(entry => !workspaceTools.has(entry.name)).map(entry => entry.name).sort())
  const context = { signal: new AbortController().signal }
  const args = () => ({ document_id: doc.id, expected_revision: agent.read_state().revision, idempotency_key: crypto.randomUUID() })
  const checked = async (name: string, result: unknown) => validateResult(name, await result)
  validateResult('read_state', agent.read_state())
  assert.equal(agent.read_state().nextOffset, null)
  const models = agent.list_models({ limit: 1 }); validateResult('list_models', models)
  assert.equal(models.nextOffset, 1)
  assert.deepEqual(models.models[0], {
    id: 'image-contract', name: null, type: 'image', available: true, supportedInputModes: [], supportedOperations: [], maxInputImages: null,
    parameters: { image: { qualities: [], resolutions: [], sizes: [], aspectRatios: [], outputFormats: [], resolutionSizes: {}, maxCount: 1, defaults: { count: 1 } }, video: null, music: null },
  })
  assert.equal(agent.list_models({ offset: 1, limit: 1 }).nextOffset, null)
  assert.equal(agent.list_models().models.length, 2)
  validateResult('list_models', agent.list_models({ offset: 1, limit: 1 }))
  await checked('rename_document', agent.rename_document({ ...args(), name: 'Renamed' }, context))
  const first = await agent.create_note({ ...args(), title: 'A', text: 'a'.repeat(20000) }, context); validateResult('create_note', first)
  const created = await agent.create_nodes({ ...args(), nodes: [{ type: 'note', title: 'B', text: 'b' }, { type: 'prompt', title: 'Generate', text: 'Prompt', model_id: 'image-contract' }] }, context); validateResult('create_nodes', created)
  const state = agent.read_state({ limit: 1 }); validateResult('read_state', state)
  assert.equal(state.nextOffset, 1)
  assert.equal(state.nodes[0].textTruncated, true)
  assert.equal(state.nodes[0].modelId, null)
  validateResult('read_state', agent.read_state({ offset: 3 }))
  assert.equal(agent.read_state({ offset: 3 }).nextOffset, null)
  await checked('update_nodes', agent.update_nodes({ ...args(), patches: [{ node_id: first.nodeId, title: 'Changed', width: 400 }] }, context))
  const edge = await agent.connect_nodes({ ...args(), from_node_id: first.nodeId, to_node_id: created.nodeIds[1] }, context); validateResult('connect_nodes', edge)
  const secondEdge = await agent.connect_nodes({ ...args(), from_node_id: created.nodeIds[0], to_node_id: created.nodeIds[1] }, context); validateResult('connect_nodes', secondEdge)
  const edgePage = agent.read_state({ limit: 1 }); validateResult('read_state', edgePage)
  assert.equal(edgePage.nextEdgeOffset, 1)
  const edgeEnd = agent.read_state({ limit: 1, edge_offset: edgePage.nextEdgeOffset! }); validateResult('read_state', edgeEnd)
  assert.equal(edgeEnd.nextEdgeOffset, null); assert.equal(edgeEnd.edges[0].id, secondEdge.edgeId)
  await checked('arrange_nodes', agent.arrange_nodes({ ...args(), node_ids: [first.nodeId, ...created.nodeIds] }, context))
  await checked('disconnect_nodes', agent.disconnect_nodes({ ...args(), edge_ids: [edge.edgeId, secondEdge.edgeId] }, context))
  await checked('delete_nodes', agent.delete_nodes({ ...args(), node_ids: [created.nodeIds[0]] }, context))
  await checked('save_document', agent.save_document(args(), context))
  const accepted = await agent.submit_generation({ ...args(), node_id: created.nodeIds[1] }, context); validateResult('submit_generation', accepted)
  assert.equal(accepted.accepted, true); assert.equal(accepted.completed, false)
  validateResult('read_tasks', agent.read_tasks())
  assert.equal(agent.read_tasks().tasks[0].taskId, null)
  // Imported documents may contain more text than the editor API creates.
  doc = { ...doc, nodes: doc.nodes.map(node => node.id === first.nodeId ? { ...node, text: 'z'.repeat(20001) } : node) }
  const firstText = agent.read_node({ node_id: first.nodeId }); validateResult('read_node', firstText)
  assert.equal(firstText.nextTextOffset, 20000)
  const lastText = agent.read_node({ node_id: first.nodeId, text_offset: firstText.nextTextOffset! }); validateResult('read_node', lastText)
  assert.equal(lastText.nextTextOffset, null); assert.equal(lastText.node.text, 'z')
  doc = { ...doc, nodes: doc.nodes.map(node => node.id === created.nodeIds[1] ? { ...node, status: 'completed', image: 'https://private.example/result?signature=secret' } : node) }
  const finished = agent.read_tasks(); validateResult('read_tasks', finished)
  assert.equal(finished.tasks[0].status, 'completed')
  assert.deepEqual(finished.tasks[0].resultNodeIds, [created.nodeIds[1]])
  assert(!JSON.stringify(finished).includes('private.example'))
  validateResult('read_node', agent.read_node({ node_id: created.nodeIds[1] }))
})

test('task error summaries omit provider media URLs and optional values satisfy the contract', () => {
  const doc: Document = { id: 'private-document', name: 'Private', nodes: [{ id: 'private-node', type: 'prompt', title: 'Video', text: '', x: 0, y: 0, width: 320, height: 240, color: '', status: 'failed', mediaType: 'video', video: 'secret-video', videoContentUrl: 'secret-url', localImage: 'secret-local', audio: 'secret-audio', error: 'Download failed: https://private.example/movie.mp4?token=secret data:video/mp4;base64,private' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '' }
  const agent = createCanvasAgent({ getDocument: () => doc, canWrite: () => true, beforeWrite() {}, commit: () => {}, persist: async () => {} })
  const tasks = agent.read_tasks(); validateResult('read_tasks', tasks)
  assert.equal(tasks.tasks[0].error, 'Download failed: [URL omitted] [URL omitted]')
  for (const [name, value] of [['read_tasks', tasks], ['read_state', agent.read_state()], ['read_node', agent.read_node({ node_id: 'private-node' })]] as const) {
    validateResult(name, value)
    const serialized = JSON.stringify(value)
    for (const secret of ['secret-video', 'secret-url', 'secret-local', 'secret-audio', 'private.example', 'base64,private']) assert(!serialized.includes(secret))
  }
})

test('Canvas guide examples use declared tools and validate against input and output contracts', async () => {
  const fs = await import('node:fs/promises')
  const root = new URL('../', import.meta.url)
  const examples = JSON.parse(await fs.readFile(new URL(agentMetadata.examples, root), 'utf8'))
  assert.equal(agentMetadata.contract_version, '1.3.0')
  assert.equal(new Set(capabilities.map(item => item.name)).size, 24)
  for (const example of examples) {
    const declaration = capability(example.capability)
    validateValue(declaration.input_schema, example.input)
    if (example.output) validateValue(declaration.output_schema, example.output)
  }
  for (const entry of [agentMetadata.guide.entry, ...agentMetadata.guide.topics.map((topic: { entry: string }) => topic.entry)]) assert((await fs.readFile(new URL(entry, root), 'utf8')).trim().length > 0)
  const generate = capability('submit_generation')
  assert.equal(generate.completion, 'accepted'); assert.equal(generate.billable, true); assert.equal(generate.open_world, true)
  assert.equal(capability('create_note').destructive, false)
  assert.equal(capability('delete_nodes').destructive, true)
})
