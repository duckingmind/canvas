import { configureGeneration, generationParameters, type AgentImageSettings, type AgentMusicSettings, type AgentVideoSettings } from './agent-settings.ts'
import { AGENT_MEDIA_CHUNK_BYTES, AGENT_MEDIA_MAX_BYTES, bytesBase64, createImageUploads, sha256 } from './agent-media.ts'
import type { CanvasNode, Document, Model, StoredAsset } from './canvas-types.ts'
import { arrangeSmartNodes } from './geometry.ts'
import { rebuildGroupState } from './group-interaction.ts'
import { canReceiveNodeConnection, canStartNodeConnection } from './node-interaction.ts'
import { canLoadVideoContent, videoTaskControls } from './video-task-state.ts'
import { canLoadAudioContent } from './audio-source.ts'
import { compatibleMusicModels } from './music-models.ts'
import { canEnterMediaScheduler } from './video-models.ts'
import { isTTSNode } from './audio-creation.ts'
import { mediaTaskPublicState, mediaTaskState } from './shared/media-task-state.ts'

export type CanvasAgentAdapter = {
  getDocument(): Document
  beforeWrite(): void
  commit(change: (current: Document) => Document): void
  /** Optional shared transaction boundary used to pause conflicting UI edits. */
  setAgentWriteLock?(locked: boolean): void
  persist(document: Document): Promise<void>
  canWrite(): boolean
  getModels?(): Model[]
  isNodeBusy?(nodeId: string): boolean
  startGeneration?(node: CanvasNode): void
  resumeGeneration?(node: CanvasNode): void
  cancelGeneration?(node: CanvasNode, key: string, signal: AbortSignal): Promise<{ status: string; cancelled: boolean }>
  readMedia?(node: CanvasNode, signal: AbortSignal): Promise<Blob>
  imageSize?(dataUrl: string): Promise<{ width: number; height: number }>
  /** Persist an agent-uploaded image in the platform COS asset store. */
  uploadImage?(file: File, idempotencyKey: string, signal: AbortSignal): Promise<StoredAsset>
}
export type CanvasAgentContext = { signal: AbortSignal }
export type CanvasWriteArgs = { document_id: string; expected_revision: string; idempotency_key: string }
type NodeInput = { type: 'note' | 'prompt'; title: string; text: string; x?: number; y?: number; media_type?: 'image' | 'video' | 'audio'; model_id?: string }
type NodePatch = { node_id: string; title?: string; text?: string; x?: number; y?: number; width?: number; height?: number; model_id?: string }
const fail = (code: string, message: string, details: Record<string, unknown> = {}): never => { throw Object.assign(new Error(message), { code, executionStarted: false, ...details }) }
const page = (input: { offset?: number; limit?: number }) => {
  const offset = input.offset ?? 0, limit = input.limit ?? 50
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) fail('CANVAS_INVALID_ARGUMENT', 'Invalid pagination')
  return { offset, limit }
}
const nodesByIds = (doc: Document, ids: string[]) => {
  if (!ids.length || new Set(ids).size !== ids.length) fail('CANVAS_INVALID_ARGUMENT', 'Node IDs must be nonempty and unique')
  return ids.map(id => doc.nodes.find(node => node.id === id) || fail('CANVAS_NODE_NOT_FOUND', `Node does not exist: ${id}`))
}
const geometry = (input: { x?: number; y?: number; width?: number; height?: number }) => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = input[key]
    if (value !== undefined && (!Number.isFinite(value) || Math.abs(value) > 100000 || (key === 'width' || key === 'height') && (value < 40 || value > 4000))) fail('CANVAS_INVALID_ARGUMENT', `Invalid ${key}`)
  }
}
const hasMedia = (node: CanvasNode) => Boolean(node.image || node.video || node.videoContentUrl || (node.assetId && (node.type === 'image' || node.mediaType === 'image'))) || canLoadVideoContent(node) || canLoadAudioContent(node)
const audioMode = (node: CanvasNode) => node.audioMode ?? (node.mediaType === 'audio' || node.type === 'audio' ? node.audioTaskType === 'tts' || node.ttsSubmission ? 'tts' : node.audioTaskType === 'voice_design' || node.voiceDesignSubmission ? 'voice_design' : 'music' : null)
const requireSupportedGeneration = (node: CanvasNode) => {
  if (node.mediaType === 'audio' && (node.audioMode === 'tts' || isTTSNode(node))) fail('CANVAS_FEATURE_UNAVAILABLE', 'Canvas does not support text-to-speech creation')
}
// Provider errors can embed signed media URLs; retain the message without returning those URLs.
const errorSummary = (value?: string) => value ? value.replace(/(?:https?:\/\/|file:\/\/|blob:|data:)[^\s<>"']+/gi, '[URL omitted]').slice(0, 2000) : null
const nodeSummary = (node: CanvasNode) => ({ id: node.id, type: node.type, title: node.title.slice(0, 200), text: node.text.slice(0, 1024), textTruncated: node.text.length > 1024, x: node.x, y: node.y, width: node.width, height: node.height, groupId: node.groupId ?? null, mediaType: node.mediaType ?? null, audioMode: audioMode(node), modelId: node.modelId ?? null, imageSettings: node.imageSettings ? JSON.parse(JSON.stringify(node.imageSettings)) : null, videoSettings: node.videoSettings ? JSON.parse(JSON.stringify(node.videoSettings)) : null, musicSettings: node.musicSettings ? JSON.parse(JSON.stringify(node.musicSettings)) : null, musicLyrics: node.musicLyrics ?? null, voicePreviewText: node.voicePreviewText ?? null, voiceId: node.voiceId ?? null, status: node.status || 'idle', taskId: node.taskId ?? null, resultOf: node.resultOf ?? null, hasMedia: hasMedia(node) })

// The editor renders a completed creator task through its result cards. Keep
// that same visibility rule when an Agent arranges a selected subset: a
// complete visible-group selection includes hidden logical members, while a
// partial selection temporarily becomes member-level layout input.
const arrangementInput = (doc: Document, requested: CanvasNode[]) => {
  const requestedIDs = new Set(requested.map(node => node.id))
  const groupIDs = [...new Set(requested.map(node => node.groupId).filter((id): id is string => Boolean(id)))]
  const completeGroups = new Set(groupIDs.filter(groupID => {
    const members = doc.nodes.filter(node => node.groupId === groupID)
    const visible = members.filter(node => !(node.type === 'prompt' && members.some(candidate => candidate.resultOf === node.id)))
    return visible.length > 1 && visible.every(node => requestedIDs.has(node.id))
  }))
  const selectedIDs = new Set(requestedIDs)
  doc.nodes.forEach(node => { if (node.groupId && completeGroups.has(node.groupId)) selectedIDs.add(node.id) })
  return doc.nodes
    .filter(node => selectedIDs.has(node.id))
    .map(node => node.groupId && !completeGroups.has(node.groupId) ? { ...node, groupId: undefined } : node)
}

/** All mutations pass through the editor's existing undo/save path. */
export function createCanvasAgent(adapter: CanvasAgentAdapter) {
  const session = crypto.randomUUID()
  let previous: Document | undefined, version = 0
  let writing = false
  const uploads = createImageUploads()
  const exports = new Map<string, { hash: string; bytes: Uint8Array; mime: string; identity: string; touched: number }>()
  const mediaIdentity = (node: CanvasNode) => JSON.stringify([node.image, node.video, node.videoContentUrl, node.audio, node.localAudio, node.audioTaskType, node.assetId, node.taskId, node.resultBatchId])
  const snapshot = () => {
    const doc = adapter.getDocument()
    if (doc !== previous) { previous = doc; version += 1 }
    return { doc, revision: `${session}:${version}` }
  }
  // Model selection and discovery share one catalog so a known retired model
  // ID cannot bypass the supported audio workflows through a write operation.
  const selectableModels = () => (adapter.getModels?.() || []).filter(model => typeof model.id === 'string' && model.id.length > 0 && ((model.type || model.model_type) !== 'audio' && (model.type || model.model_type) !== 'music' || compatibleMusicModels([model]).length > 0))
  const idle = (nodes: CanvasNode[]) => {
    if (nodes.some(node => adapter.isNodeBusy?.(node.id) || ['queued', 'running'].includes(node.status || ''))) fail('CANVAS_TASK_RUNNING', 'Wait for the selected generation tasks to finish')
  }
  const mutate = async (input: CanvasWriteArgs, context: CanvasAgentContext, change: (doc: Document) => Document, afterCommit?: () => void | Promise<void>) => {
    context.signal.throwIfAborted()
    if (writing) fail('CANVAS_BUSY', 'Canvas is navigating or another write is running')
    // Readiness checks live at the document boundary so auth and draft
    // recovery return their own actionable errors before any editor side effect.
    adapter.getDocument()
    if (!adapter.canWrite()) fail('CANVAS_BUSY', 'Canvas is navigating or another write is running')
    adapter.beforeWrite()
    const current = snapshot()
    if (input.document_id !== current.doc.id) fail('CANVAS_DOCUMENT_CHANGED', 'The active document changed; read_state again')
    if (input.expected_revision !== current.revision) fail('CANVAS_REVISION_CONFLICT', 'The canvas changed; read_state before retrying')
    // Validate the complete operation before committing any part of a batch.
    const next = change(current.doc)
    writing = true
    let writeLockHeld = false
    try {
      context.signal.throwIfAborted()
      adapter.commit(() => next)
      // Capture the revision at the exact commit boundary.  An asynchronous
      // side effect (submit/cancel) may legitimately update task diagnostics,
      // and a user edit may arrive while it is running; neither is the
      // revision applied by this operation.
      const applied = snapshot()
      if (adapter.setAgentWriteLock) {
        adapter.setAgentWriteLock(true)
        writeLockHeld = true
      }
      await afterCommit?.()
      // Apply queued editor changes before saving so the acknowledged local
      // snapshot includes both the agent mutation and edits made while its
      // asynchronous side effect was running.
      if (writeLockHeld) {
        adapter.setAgentWriteLock!(false)
        writeLockHeld = false
      }
      const latest = snapshot()
      await adapter.persist(latest.doc)
      return { documentId: applied.doc.id, appliedRevision: applied.revision, revision: latest.revision, savedLocally: true }
    } finally {
      if (writeLockHeld) adapter.setAgentWriteLock!(false)
      writing = false
    }
  }
  const makeNode = (input: NodeInput, index = 0): CanvasNode => {
    if (!['note', 'prompt'].includes(input.type) || typeof input.title !== 'string' || input.title.length > 200 || typeof input.text !== 'string' || input.text.length > 20000) fail('CANVAS_INVALID_ARGUMENT', 'Invalid node type, title or text')
    geometry(input)
    if (input.media_type && !['image', 'video', 'audio'].includes(input.media_type)) fail('CANVAS_INVALID_ARGUMENT', 'Choose image, video or audio for a prompt node')
    if (input.type === 'note' && (input.media_type || input.model_id)) fail('CANVAS_INVALID_ARGUMENT', 'Only prompt nodes accept model settings')
    if (input.model_id && !selectableModels().some(model => model.id === input.model_id && canEnterMediaScheduler(model) && (model.type || model.model_type) === (input.media_type || 'image'))) fail('CANVAS_MODEL_UNAVAILABLE', 'Choose an available model from list_models')
    return { id: crypto.randomUUID(), type: input.type, title: input.title, text: input.text, x: input.x ?? 100 + index * 360, y: input.y ?? 100, width: 320, height: 240, color: '#fff4b8', ...(input.type === 'prompt' ? { mediaType: input.media_type || 'image', modelId: input.model_id, ...(input.model_id ? { modelSelection: 'user' as const } : {}), status: 'idle' as const } : {}) }
  }
  return {
    read_state(input: { offset?: number; limit?: number; edge_offset?: number } = {}) {
      const { doc, revision } = snapshot(), { offset, limit } = page(input)
      const edgeOffset = input.edge_offset ?? 0
      if (!Number.isInteger(edgeOffset) || edgeOffset < 0) fail('CANVAS_INVALID_ARGUMENT', 'Invalid edge_offset')
      return { documentId: doc.id, name: doc.name, revision, nodeCount: doc.nodes.length, edgeCount: doc.edges.length, viewport: doc.viewport,
        offset, nextOffset: offset + limit < doc.nodes.length ? offset + limit : null, nodes: doc.nodes.slice(offset, offset + limit).map(nodeSummary),
        edges: doc.edges.slice(edgeOffset, edgeOffset + limit), nextEdgeOffset: edgeOffset + limit < doc.edges.length ? edgeOffset + limit : null }
    },
    read_node(input: { node_id: string; text_offset?: number }) {
      const { doc, revision } = snapshot(), node = nodesByIds(doc, [input.node_id])[0], offset = input.text_offset ?? 0
      if (!Number.isInteger(offset) || offset < 0) fail('CANVAS_INVALID_ARGUMENT', 'Invalid text_offset')
      return { documentId: doc.id, revision, node: { ...nodeSummary(node), text: node.text.slice(offset, offset + 20000), textTruncated: offset + 20000 < node.text.length }, nextTextOffset: offset + 20000 < node.text.length ? offset + 20000 : null }
    },
    rename_document(input: CanvasWriteArgs & { name: string }, context: CanvasAgentContext) {
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) fail('CANVAS_INVALID_ARGUMENT', 'Name must contain 1–200 characters')
      return mutate(input, context, doc => ({ ...doc, name: input.name.trim() }))
    },
    async create_note(input: CanvasWriteArgs & { title: string; text: string; x?: number; y?: number }, context: CanvasAgentContext) {
      const node = makeNode({ ...input, type: 'note' })
      return { ...await mutate(input, context, doc => ({ ...doc, nodes: [...doc.nodes, node] })), nodeId: node.id }
    },
    async create_nodes(input: CanvasWriteArgs & { nodes: NodeInput[] }, context: CanvasAgentContext) {
      if (!input.nodes.length || input.nodes.length > 50) fail('CANVAS_INVALID_ARGUMENT', 'Create 1–50 nodes per call')
      const nodes = input.nodes.map(makeNode)
      return { ...await mutate(input, context, doc => ({ ...doc, nodes: [...doc.nodes, ...nodes] })), nodeIds: nodes.map(node => node.id) }
    },
    update_nodes(input: CanvasWriteArgs & { patches: NodePatch[] }, context: CanvasAgentContext) {
      return mutate(input, context, doc => {
        const nodes = nodesByIds(doc, input.patches.map(patch => patch.node_id)); idle(nodes)
        const changes = new Map(input.patches.map((patch, index) => {
          geometry(patch)
          const node = nodes[index]
          if (patch.text !== undefined && !['note', 'prompt'].includes(node.type)) fail('CANVAS_INVALID_ARGUMENT', 'Generated media text is immutable')
          if (patch.model_id !== undefined && (node.type !== 'prompt' || !selectableModels().some(model => model.id === patch.model_id && canEnterMediaScheduler(model) && (model.type || model.model_type) === (node.mediaType || 'image')))) fail('CANVAS_MODEL_UNAVAILABLE', 'Choose a compatible model from list_models')
          const { node_id, model_id, ...fields } = patch
          return [node_id, { ...node, ...fields, ...(model_id !== undefined ? { modelId: model_id, modelSelection: 'user' as const } : {}) }] as const
        }))
        return { ...doc, ...rebuildGroupState(doc.nodes.map(node => changes.get(node.id) || node)) }
      })
    },
    delete_nodes(input: CanvasWriteArgs & { node_ids: string[] }, context: CanvasAgentContext) {
      return mutate(input, context, doc => {
        // Deletion is allowed while a generation is running. The editor's
        // commit path invalidates the removed node's observers/controllers;
        // blocking here left users with no way to discard a stuck task.
        const ids = new Set(nodesByIds(doc, input.node_ids).map(node => node.id))
        return { ...doc, ...rebuildGroupState(doc.nodes.filter(node => !ids.has(node.id))), edges: doc.edges.filter(edge => !ids.has(edge.from) && !ids.has(edge.to)) }
      })
    },
    async connect_nodes(input: CanvasWriteArgs & { from_node_id: string; to_node_id: string }, context: CanvasAgentContext) {
      const edgeId = crypto.randomUUID()
      const result = await mutate(input, context, doc => {
        const [source, target] = nodesByIds(doc, [input.from_node_id, input.to_node_id]); idle([target])
        if (!canStartNodeConnection(source) || !canReceiveNodeConnection(target)) fail('CANVAS_INVALID_CONNECTION', 'Connection must join an eligible source and an editable target')
        if (doc.edges.some(edge => edge.from === source.id && edge.to === target.id)) fail('CANVAS_INVALID_CONNECTION', 'Connection already exists')
        const seen = new Set<string>(), queue = [target.id]
        while (queue.length) {
          const id = queue.pop()!
          if (id === source.id) fail('CANVAS_INVALID_CONNECTION', 'Connection would create a cycle')
          if (seen.has(id)) continue
          seen.add(id)
          for (const edge of doc.edges) if (edge.from === id) queue.push(edge.to)
        }
        return { ...doc, edges: [...doc.edges, { id: edgeId, from: source.id, to: target.id }] }
      })
      return { ...result, edgeId }
    },
    disconnect_nodes(input: CanvasWriteArgs & { edge_ids: string[] }, context: CanvasAgentContext) {
      return mutate(input, context, doc => {
        const edges = input.edge_ids.map(id => doc.edges.find(edge => edge.id === id) || fail('CANVAS_EDGE_NOT_FOUND', `Edge does not exist: ${id}`))
        idle(nodesByIds(doc, [...new Set(edges.map(edge => edge.to))]))
        return { ...doc, edges: doc.edges.filter(edge => !input.edge_ids.includes(edge.id)) }
      })
    },
    arrange_nodes(input: CanvasWriteArgs & { node_ids: string[] }, context: CanvasAgentContext) {
      return mutate(input, context, doc => {
        const requested = nodesByIds(doc, input.node_ids)
        const nodes = arrangementInput(doc, requested); idle(nodes)
        const positions = new Map(arrangeSmartNodes(nodes, doc.edges).map(node => [node.id, node]))
        return { ...doc, ...rebuildGroupState(doc.nodes.map(node => {
          const position = positions.get(node.id)
          return position ? { ...node, x: position.x, y: position.y } : node
        })) }
      })
    },
    save_document(input: CanvasWriteArgs, context: CanvasAgentContext) { return mutate(input, context, doc => doc) },
    list_models(input: { offset?: number; limit?: number } = {}) {
      const { offset, limit } = page(input), models = selectableModels()
      return { models: models.slice(offset, offset + limit).map(model => ({ id: model.id!, name: model.name ?? null, type: model.type || model.model_type || null, available: canEnterMediaScheduler(model), supportedInputModes: model.supported_input_modes ?? [], supportedOperations: model.supported_operations ?? [], maxInputImages: model.max_input_images ?? null, parameters: generationParameters(model) })), nextOffset: offset + limit < models.length ? offset + limit : null }
    },
    read_tasks(input: { offset?: number; limit?: number } = {}) {
      const { doc, revision } = snapshot(), { offset, limit } = page(input), tasks = doc.nodes.filter(node => node.type === 'prompt' && (node.status && node.status !== 'idle' || node.taskId || node.submission || node.videoSubmission || node.musicSubmission || node.voiceDesignSubmission || node.ttsSubmission))
      return { documentId: doc.id, revision, tasks: tasks.slice(offset, offset + limit).map(node => {
        const candidates = doc.nodes.filter(result => result.resultOf === node.id && hasMedia(result))
        // A pending or failed attempt must never inherit the previous attempt's outputs.
        const batchId = node.generationBatchId || node.submission?.resultBatchId || node.resultBatchId || null
        const results = node.status !== 'completed' ? [] : hasMedia(node) ? [node] : node.taskId
          ? candidates.filter(result => result.taskId === node.taskId)
          : batchId ? candidates.filter(result => result.resultBatchId === batchId)
          : (() => { const latestBatch = [...candidates].reverse().find(result => result.resultBatchId)?.resultBatchId; return latestBatch ? candidates.filter(result => result.resultBatchId === latestBatch) : [] })()
        return { nodeId: node.id, mediaType: node.mediaType || 'image', audioMode: audioMode(node), audioTaskType: node.audioTaskType ?? (node.ttsSubmission ? 'tts' : node.voiceDesignSubmission ? 'voice_design' : node.musicSubmission ? 'music' : null), modelId: node.modelId ?? null, imageSettings: node.imageSettings ? JSON.parse(JSON.stringify(node.imageSettings)) : null, videoSettings: node.videoSettings ? JSON.parse(JSON.stringify(node.videoSettings)) : null, musicSettings: node.musicSettings ? JSON.parse(JSON.stringify(node.musicSettings)) : null, musicLyrics: node.musicLyrics ?? null, voicePreviewText: node.voicePreviewText ?? null, voiceId: node.voiceId ?? null, status: node.status || 'idle', taskId: node.taskId ?? null, submissionId: node.submission?.key || node.videoSubmission?.key || node.ttsSubmission?.key || node.musicSubmission?.key || node.voiceDesignSubmission?.key || null, batchId: batchId || results[0]?.resultBatchId || null, observedStatus: node.taskDiagnostic?.status || null, paused: node.videoPollingPaused === true, error: errorSummary(node.error), resultNodeIds: results.map(result => result.id) }
      }), nextOffset: offset + limit < tasks.length ? offset + limit : null }
    },
    configure_generation(input: CanvasWriteArgs & { node_id: string; model_id?: string; image_settings?: AgentImageSettings; video_settings?: AgentVideoSettings; music_settings?: AgentMusicSettings }, context: CanvasAgentContext) {
      return mutate(input, context, doc => {
        const node = nodesByIds(doc, [input.node_id])[0]; requireSupportedGeneration(node); idle([node])
        if (node.type !== 'prompt') fail('CANVAS_INVALID_ARGUMENT', 'Configure a prompt node')
        const model = selectableModels().find(model => model.id === (input.model_id || node.modelId))
        if (!model) return fail('CANVAS_MODEL_UNAVAILABLE', 'Select an available model from list_models')
        const configured = configureGeneration(node, model, input)
        return { ...doc, nodes: doc.nodes.map(item => item.id === node.id ? configured : item) }
      })
    },
    async upload_image_chunk(input: CanvasWriteArgs & { upload_id: string; mime_type: string; byte_offset: number; data_base64: string }, context: CanvasAgentContext) {
      context.signal.throwIfAborted()
      const current = snapshot()
      if (writing || !adapter.canWrite()) fail('CANVAS_BUSY', 'Canvas is not ready for image import')
      if (input.document_id !== current.doc.id) fail('CANVAS_DOCUMENT_CHANGED', 'The active document changed')
      if (input.expected_revision !== current.revision) fail('CANVAS_REVISION_CONFLICT', 'Read current state before staging image bytes')
      return uploads.append(input)
    },
    async import_image(input: CanvasWriteArgs & { upload_id: string; title: string; x?: number; y?: number }, context: CanvasAgentContext) {
      context.signal.throwIfAborted()
      if (!adapter.imageSize || !adapter.uploadImage) fail('CANVAS_MEDIA_UNAVAILABLE', 'COS image upload is unavailable')
      const imageSize = adapter.imageSize!
      const uploadImage = adapter.uploadImage!
      const staged = uploads.read(input.upload_id, input.document_id)
      const extension = staged.mime.split('/', 2)[1]?.replace(/[^a-z0-9]+/gi, '') || 'png'
      const file = new File([staged.bytes], `${input.title || 'canvas-image'}.${extension}`, { type: staged.mime })
      const previewURL = URL.createObjectURL(file)
      try {
        const size = await imageSize(previewURL)
        geometry({ ...input, ...size })
        context.signal.throwIfAborted()
        const asset = await uploadImage(file, `canvas-agent-${input.idempotency_key}`.slice(0, 128), context.signal)
        context.signal.throwIfAborted()
        if (!asset || asset.type !== 'image' || typeof asset.id !== 'string' || !asset.id.trim() || typeof asset.url !== 'string' || !/^https?:\/\//i.test(asset.url))
          fail('CANVAS_MEDIA_UNAVAILABLE', 'COS did not return a durable image URL')
        const node: CanvasNode = {
          id: crypto.randomUUID(), type: 'image', title: input.title, text: '',
          x: input.x ?? 100, y: input.y ?? 100, ...size, color: '#fff4b8',
          image: asset.url, assetId: asset.id, status: 'completed',
        }
        const result = await mutate(input, context, doc => ({ ...doc, nodes: [...doc.nodes, node] }))
        return { ...result, nodeId: node.id }
      } finally {
        URL.revokeObjectURL(previewURL)
        uploads.remove(input.upload_id)
      }
    },
    async read_media(input: { node_id: string; byte_offset?: number; expected_hash?: string }, context: CanvasAgentContext) {
      context.signal.throwIfAborted()
      const { doc } = snapshot(), node = nodesByIds(doc, [input.node_id])[0], offset = input.byte_offset ?? 0
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % AGENT_MEDIA_CHUNK_BYTES) fail('CANVAS_MEDIA_OFFSET', 'Use byte_offset 0 or the previous nextOffset')
      if (offset && !input.expected_hash) fail('CANVAS_MEDIA_CHANGED', 'Continuation requires the first page hash')
      if (!hasMedia(node) && !node.assetId) fail('CANVAS_MEDIA_UNAVAILABLE', 'This node has no readable result')
      const key = `${doc.id}:${node.id}`, identity = mediaIdentity(node)
      for (const [id, cached] of exports) if (Date.now() - cached.touched > 600000 || cached.identity !== identity && id === key) exports.delete(id)
      let cached = exports.get(key)
      if (!cached) {
        if (!adapter.readMedia) fail('CANVAS_MEDIA_UNAVAILABLE', 'Media reading is unavailable')
        if (exports.size >= 2) exports.delete(exports.keys().next().value!)
        const blob = await adapter.readMedia!(node, context.signal)
        context.signal.throwIfAborted()
        const current = snapshot().doc
        if (current.id !== doc.id || mediaIdentity(nodesByIds(current, [node.id])[0]) !== identity) fail('CANVAS_MEDIA_CHANGED', 'Media changed during download; read from byte_offset 0')
        if (!blob.size || blob.size > AGENT_MEDIA_MAX_BYTES) fail('CANVAS_MEDIA_LIMIT', 'Media must contain 1 byte to 64 MiB')
        const bytes = new Uint8Array(await blob.arrayBuffer())
        cached = { bytes, mime: blob.type, hash: await sha256(bytes), identity, touched: Date.now() }; exports.set(key, cached)
      }
      if (input.expected_hash && input.expected_hash !== cached.hash) fail('CANVAS_MEDIA_CHANGED', 'Media hash changed; restart export at byte_offset 0')
      if (offset >= cached.bytes.length) fail('CANVAS_MEDIA_OFFSET', 'Byte offset is beyond media length')
      cached.touched = Date.now()
      const bytes = cached.bytes.subarray(offset, offset + AGENT_MEDIA_CHUNK_BYTES)
      return { documentId: doc.id, nodeId: node.id, mimeType: cached.mime, totalBytes: cached.bytes.length, hash: cached.hash, byteOffset: offset, nextOffset: offset + bytes.length < cached.bytes.length ? offset + bytes.length : null, dataBase64: bytesBase64(bytes) }
    },
    async resume_generation(input: CanvasWriteArgs & { node_id: string }, context: CanvasAgentContext) {
      let node!: CanvasNode
      const result = await mutate(input, context, doc => {
        node = nodesByIds(doc, [input.node_id])[0]
        requireSupportedGeneration(node)
        if (adapter.isNodeBusy?.(node.id)) fail('CANVAS_TASK_RUNNING', 'The original task is already being observed')
        if (node.type !== 'prompt' || !adapter.resumeGeneration || (!['running', 'queued'].includes(node.status || '') || !node.taskId && !node.submission && !node.videoSubmission && !node.musicSubmission && !node.voiceDesignSubmission && !node.ttsSubmission)) fail('CANVAS_TASK_NOT_RESUMABLE', 'Only an unresolved original task can be resumed; inspect read_tasks')
        return doc
      }, () => adapter.resumeGeneration!(node))
      return { ...result, nodeId: node.id, accepted: true, completed: false }
    },
    async cancel_generation(input: CanvasWriteArgs & { node_id: string }, context: CanvasAgentContext) {
      let node!: CanvasNode, cancellation!: { status: string; cancelled: boolean }
      const result = await mutate(input, context, doc => {
        node = nodesByIds(doc, [input.node_id])[0]
        requireSupportedGeneration(node)
        const observation = { status: node.taskDiagnostic?.status || node.status, code: node.taskDiagnostic?.code, phase: node.taskDiagnostic?.phase, assetStatus: node.taskDiagnostic?.assetStatus, supplierConfirmationState: node.taskDiagnostic?.supplierConfirmation?.state }
        const lifecycle = mediaTaskState(observation), publicState = mediaTaskPublicState(observation)
        const audioAllowsCancel = node.mediaType === 'audio' && publicState === 'queued' && !lifecycle.isTerminal && !lifecycle.requiresReconciliation
        const canCancel = node.mediaType === 'video' ? videoTaskControls(node).canCancel : audioAllowsCancel
        const rawStatus = String(observation.status || '').trim().toLowerCase()
        const queuedBeforeDispatch = ['created', 'quoted', 'funds_reserved', 'pending', 'queued'].includes(rawStatus)
        if (node.type !== 'prompt' || !node.taskId || !queuedBeforeDispatch || !canCancel || !adapter.cancelGeneration) fail('CANVAS_TASK_NOT_CANCELLABLE', 'Only queued media tasks can be cancelled; tasks that have started executing are not cancellable')
        return doc
      }, async () => { cancellation = await adapter.cancelGeneration!(node, input.idempotency_key, context.signal) })
      return { ...result, nodeId: node.id, cancellationRequested: true, ...cancellation }
    },
    async submit_generation(input: CanvasWriteArgs & { node_id: string }, context: CanvasAgentContext) {
      let node: CanvasNode
      const result = await mutate(input, context, doc => {
        node = nodesByIds(doc, [input.node_id])[0]; requireSupportedGeneration(node); idle([node])
        if (node.type !== 'prompt' || !adapter.startGeneration) fail('CANVAS_INVALID_ARGUMENT', 'Generation requires an editable prompt node')
        return doc
      }, () => adapter.startGeneration!(node!))
      return { ...result, nodeId: input.node_id, accepted: true, completed: false }
    },
  }
}
