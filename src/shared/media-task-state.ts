/** Shared, side-effect-free classification for media task lifecycle states. */

export type MediaTaskStateInput = {
  status?: unknown
  code?: unknown
  message?: unknown
  /** Stable control-plane phase, when the API provides it. */
  phase?: unknown
  /** Platform-owned asset state. A succeeded task can still be collecting its asset. */
  assetStatus?: unknown
  assetCount?: unknown
  /** Latest supplier evidence, kept separate from the task's durable status. */
  supplierConfirmationState?: unknown
  supplierConfirmationStatus?: unknown
  /** Reconciliation and generation have separate completion conditions. */
  reconciliationState?: unknown
  currentStage?: unknown
  attentionReason?: unknown
}

export type MediaTaskState = {
  status?: string
  code?: string
  requiresReconciliation: boolean
  isTerminal: boolean
  canRetry: boolean
}

/** The only lifecycle vocabulary exposed by user-facing media surfaces. */
export type MediaTaskPublicState = 'queued' | 'running' | 'succeeded' | 'failed'
/** Alias used by callers that describe these values as user statuses. */
export type MediaUserStatus = MediaTaskPublicState
export type MediaTaskDisplayStage = MediaTaskPublicState | 'collecting' | 'reconciling'

export const MEDIA_TASK_RECONCILIATION_CODES = [
  'creation_result_unknown',
  'unknown_resolution_expired',
  'media_task_requires_reconciliation',
  'media_task_state_unknown',
  'task_state_reconciliation_required',
  'media_reconciliation_required',
  'provider_reconciliation_manual_required',
  'provider_lookup_unsupported',
  'provider_status_lookup_unsupported',
  'upstream_poll_result_unknown',
  'asset_collection_reconciliation_required',
  'VIDEO_TASK_UNKNOWN',
  'VIDEO_TASK_READ_UNAVAILABLE',
  'VIDEO_TASK_STATUS_MISSING',
  'VIDEO_SUBMISSION_LOOKUP_UNAVAILABLE',
  'VIDEO_SUBMISSION_LOOKUP_INVALID',
  'IMAGE_TASK_READ_FAILED',
  'IMAGE_TASK_PENDING',
  'IMAGE_SUBMISSION_LOOKUP_UNAVAILABLE',
  'IMAGE_SUBMISSION_LOOKUP_INVALID',
  'IMAGE_RESULT_UNCONFIRMED',
] as const

const reconciliationCodes = new Set<string>(MEDIA_TASK_RECONCILIATION_CODES.map((value) => value.toLowerCase()))
const failureStatuses = new Set(['failed', 'cancelled', 'canceled', 'expired', 'refunded', 'unknown_resolution_expired'])
const unavailableAssetStatuses = new Set(['failed', 'expired', 'unavailable'])
// The retry endpoint only accepts failed/cancelled durable tasks. Expiry and
// refunds are separate platform decisions, not authorization for another run.
const retryableStatuses = new Set(['failed', 'cancelled', 'canceled'])

function normalized(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/** Execution completion is not the same as a playable/persisted result. */
export function mediaTaskExecutionSucceeded(input: MediaTaskStateInput) {
  return !failureStatuses.has(normalized(input.status)) && (
    ['succeeded', 'completed', 'success'].includes(normalized(input.status)) || normalized(input.phase) === 'completed'
  )
}

/** Unknown means an explicit reconciliation signal, not a failed task. */
export function requiresMediaTaskReconciliation(input: MediaTaskStateInput) {
  const status = normalized(input.status)
  const code = normalized(input.code)
  const phase = normalized(input.phase)
  const supplierState = normalized(input.supplierConfirmationState)
  if (mediaTaskExecutionSucceeded(input)) return false
  // Only an evidence-backed resolution clears prior ambiguity. In particular,
  // an unsupported lookup does not establish that the create request failed.
  if (code === 'unknown_reconciled' && ['failed', 'cancelled', 'canceled'].includes(status)) return false
  return status === 'unknown' || status === 'unknown_resolution_expired' || reconciliationCodes.has(code) ||
    phase === 'reconciling' || phase === 'reconciliation' ||
    ['pending', 'manual_required', 'closed'].includes(normalized(input.reconciliationState)) ||
    supplierState === 'unconfirmed' || supplierState === 'unconfirmed_after_timeout'
}

/** Closing the platform task does not confirm the supplier's result. */
export function mediaTaskReconciliationClosed(input: MediaTaskStateInput) {
  return !mediaTaskExecutionSucceeded(input) && (normalized(input.status) === 'unknown_resolution_expired' ||
    normalized(input.code) === 'unknown_resolution_expired' || normalized(input.reconciliationState) === 'closed')
}

export function mediaTaskNeedsManualReconciliation(input: MediaTaskStateInput) {
  if (!requiresMediaTaskReconciliation(input)) return false
  return normalized(input.reconciliationState) === 'manual_required' ||
    normalized(input.currentStage) === 'reconciliation_manual' ||
    [input.code, input.attentionReason].some(value => [
      'provider_lookup_unsupported', 'provider_status_lookup_unsupported', 'provider_reconciliation_manual_required',
    ].includes(normalized(value)))
}

export function mediaTaskState(input: MediaTaskStateInput): MediaTaskState {
  const status = normalized(input.status) || undefined
  const code = normalized(input.code) || undefined
  const requiresReconciliation = requiresMediaTaskReconciliation(input)
  const expiredUnknown = mediaTaskReconciliationClosed(input)
  const durableTerminal = ['cancelled', 'canceled', 'expired', 'refunded'].includes(status || '')
  // Cancellation, refund and an explicit reconciliation deadline are control
  // plane decisions. A stale reconciliation code or late supplier evidence
  // must not reopen their polling/recovery loop. Plain `failed` remains
  // unresolved when its provider result is still ambiguous.
  const completed = mediaTaskExecutionSucceeded(input)
  const assetTerminal = unavailableAssetStatuses.has(normalized(input.assetStatus))
  const isTerminal = expiredUnknown || durableTerminal || assetTerminal || !requiresReconciliation && (
    status === 'failed' || ['failed', 'cancelled', 'canceled'].includes(normalized(input.phase)) || completed && normalized(input.assetStatus) !== 'pending'
  )
  return {
    status,
    code,
    requiresReconciliation,
    isTerminal,
    canRetry: isTerminal && !requiresReconciliation && Boolean(status && retryableStatuses.has(status)),
  }
}

/**
 * Convert internal scheduler states into the four states shown to users.
 * Unknown and reconciliation states stay in progress because the provider may
 * have accepted the request and the platform must reconcile it before a new
 * submission is safe. The explicit expiry code is a terminal platform decision;
 * supplier evidence remains available to operators without reopening the user
 * task.
 */
export function mediaTaskPublicState(input: MediaTaskStateInput): MediaTaskPublicState {
  const phase = normalized(input.phase)
  const status = normalized(input.status)
  const code = normalized(input.code)
  const assetStatus = normalized(input.assetStatus)

  if (mediaTaskReconciliationClosed(input)) return 'failed'
  // Cancellation, expiry, and refund are durable control-plane decisions.
  // A stale reconciliation code must not resurrect them as an active task;
  // only a plain `failed + creation_result_unknown` remains observable.
  if (status === 'cancelled' || status === 'canceled' || status === 'expired' || status === 'refunded') return 'failed'
  if (unavailableAssetStatuses.has(assetStatus)) return 'failed'
  // A timeout can leave the durable task status as failed while the provider
  // result is still unconfirmed. Keep it in progress until reconciliation
  // resolves the outcome. An explicit expiry code above is the control
  // plane's terminal reconciliation decision and takes precedence.
  if (requiresMediaTaskReconciliation(input)) return 'running'

  // Execution success does not make an expired/missing result usable. These
  // are terminal delivery states, not a reason to restart generation polling.
  if (failureStatuses.has(status) || phase === 'failed' || phase === 'cancelled' || phase === 'canceled') return 'failed'

  if (phase === 'completed' || status === 'succeeded' || status === 'completed' || status === 'success') {
    // Execution and asset persistence are separate. Do not tell the user the
    // task succeeded until the pending result has been collected.
    return assetStatus === 'pending' ? 'running' : 'succeeded'
  }

  if (phase === 'dispatching' || phase === 'running' || phase === 'collecting' || phase === 'canceling') return 'running'
  if (phase === 'queued') return 'queued'
  if (['dispatching', 'accepted', 'in_progress', 'running', 'processing', 'collecting', 'asset_pending', 'cancel_requested', 'cancel_pending', 'canceling', 'reconciling', 'reconciliation'].includes(status)) return 'running'
  if (['created', 'quoted', 'funds_reserved', 'pending', 'queued', 'no_task_id'].includes(status)) return 'queued'

  // Missing or unrecognized observations are not evidence of failure. The
  // control plane will repair them on the next read.
  return 'queued'
}

/** Progress detail, not another durable status. All surfaces share this mapping. */
export function mediaTaskDisplayStage(input: MediaTaskStateInput): MediaTaskDisplayStage {
  const state = mediaTaskPublicState(input)
  if (state === 'failed' || state === 'succeeded') return state
  if (requiresMediaTaskReconciliation(input)) return 'reconciling'
  if (normalized(input.phase) === 'collecting' || ['collecting', 'asset_pending'].includes(normalized(input.status))
    || mediaTaskExecutionSucceeded(input) && normalized(input.assetStatus) === 'pending') return 'collecting'
  return state
}

/** Backwards-compatible name for callers that only need the public state. */
export function mediaUserStatus(input: MediaTaskStateInput): MediaUserStatus {
  return mediaTaskPublicState(input)
}

/**
 * Whether the control plane should keep observing this task.  This is kept
 * separate from the public label: a task can be shown as "生成中" while its
 * provider result is still being reconciled, and a succeeded task can remain
 * observable while its platform asset is being collected.  Conversely,
 * `unknown_resolution_expired` and durable cancellation/refund decisions are
 * terminal, so they must not create an endless client refresh loop.
 */
export function mediaTaskNeedsPolling(input: MediaTaskStateInput): boolean {
  const lifecycle = mediaTaskState(input)
  if (lifecycle.isTerminal) return false
  const publicState = mediaTaskPublicState(input)
  return publicState === 'queued' || publicState === 'running'
}

export function mediaTaskPublicLabel(state: MediaTaskPublicState, locale: 'zh' | 'en' = 'zh') {
  const labels = locale === 'en'
    ? { queued: 'Queued', running: 'Generating', succeeded: 'Success', failed: 'Failed' }
    : { queued: '排队中', running: '生成中', succeeded: '成功', failed: '失败' }
  return labels[state]
}

export function canRetryMediaTask(input: MediaTaskStateInput) {
  return mediaTaskState(input).canRetry
}

/** Precise UI labels without changing the compatible four-state filter contract. */
export function mediaTaskDisplayLabel(input: MediaTaskStateInput, locale: 'zh' | 'en' = 'zh') {
  const en = locale === 'en'
  if (mediaTaskReconciliationClosed(input)) return en ? 'Closed · result unconfirmed' : '已关闭 · 结果待核查'
  if (requiresMediaTaskReconciliation(input)) {
    return mediaTaskNeedsManualReconciliation(input)
      ? en ? 'Awaiting manual verification' : '待人工核查'
      : en ? 'Awaiting verification' : '待核验'
  }
  const state = mediaTaskPublicState(input)
  if (state === 'succeeded' && normalized(input.code) === 'unknown_recovered_after_release') return en ? 'Result recovered' : '已追回结果'
  if (['cancelled', 'canceled'].includes(normalized(input.status))) return en ? 'Cancelled' : '已取消'
  if (normalized(input.code) === 'unknown_reconciled' && state === 'failed') return en ? 'Failure verified' : '已核实失败'
  if (mediaTaskDisplayStage(input) === 'collecting') return en ? 'Collecting result' : '结果收集中'
  return mediaTaskPublicLabel(state, locale)
}

export type MediaFailureCategory = 'input' | 'service' | 'reconciliation'

const inputErrorCodes = new Set(['invalid_request', 'capability_mismatch', 'input_image_limit_exceeded', 'unsupported_media_format', 'invalid_input_reference', 'input_reference_transport_unsupported'])

/** Categorize the next user action without treating unknown provider states as failures. */
export function mediaFailureCategory(input: MediaTaskStateInput): MediaFailureCategory {
  const status = normalized(input.status)
  const code = normalized(input.code)
  if (status === 'unknown_resolution_expired' || code === 'unknown_resolution_expired') return 'reconciliation'
  if (requiresMediaTaskReconciliation(input)) return 'reconciliation'
  if (inputErrorCodes.has(code) || /image count exceeds|unsupported value|invalid (?:image|video|audio|request|parameter)/i.test(String(input.message || ''))) return 'input'
  return 'service'
}
