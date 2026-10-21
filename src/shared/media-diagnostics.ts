/** Safe, content-free facts shared by the task surfaces. Never include prompts or asset URLs. */
import { mediaFailureCategory, mediaTaskNeedsManualReconciliation, mediaTaskReconciliationClosed, mediaTaskState, requiresMediaTaskReconciliation, type MediaFailureCategory, type MediaTaskStateInput } from './media-task-state.ts'

export type MediaInputSummary = {
  model?: string
  reference_count?: number
  duration?: number
  resolution?: string
  aspect_ratio?: string
}

export type MediaFailureDiagnosticInput = MediaTaskStateInput & {
  code?: string
  message?: string
  referenceCount?: number
  status?: string
  evidence?: Record<string, unknown>
}

function referenceTransportUnsupported(input: MediaFailureDiagnosticInput) {
  const code = (input.code || '').trim().toLowerCase()
  const message = (input.message || '').trim()
  return code === 'input_reference_transport_unsupported' ||
    (code === 'invalid_input_reference' && /(?:must be a remote HTTP\(S\) URL|data URLs must be uploaded)/i.test(message)) ||
    (['no_eligible_provider', 'no_eligible_supplier'].includes(code) &&
      /^(?:no eligible media provider: )?video protocol (?:requires a public HTTP\(S\) URL|accepts inline image data or a public HTTP\(S\) URL) for reference media$/i.test(message))
}

export function summarizeMediaInput(payload?: Record<string, unknown>): MediaInputSummary | undefined {
  if (!payload) return undefined
  const references = payload.input_references
  const legacy = payload.images ?? payload._media_images
  const referenceCount = Array.isArray(references)
    ? references.filter(value => value && typeof value === 'object' &&
      ['image_url', 'image'].includes(String((value as Record<string, unknown>).type))).length
    : Array.isArray(legacy) ? legacy.length : payload.image || payload.input_reference ? 1 : 0
  return {
    model: typeof payload.model === 'string' ? payload.model : undefined,
    reference_count: referenceCount,
    duration: typeof payload.duration === 'number' ? payload.duration : undefined,
    resolution: typeof payload.resolution === 'string' ? payload.resolution : undefined,
    aspect_ratio: typeof payload.aspect_ratio === 'string' ? payload.aspect_ratio : undefined,
  }
}

export function diagnoseMediaFailure(input: MediaFailureDiagnosticInput, language = 'zh') {
  const en = language.startsWith('en')
  const message = (input.message || '').trim()
  // Compatibility with durable legacy errors. Match a single specific reason,
  // never claim one limit explains multiple different candidate rejections.
  const imageLimit = /^(?:no eligible media provider: )?(?:input|reference) image count exceeds provider limit of (\d+)$/i.exec(message)
  const evidence = input.evidence
  const structuredLimit = evidence?.constraint_code === 'input_image_limit_exceeded' &&
    typeof evidence.allowed_max === 'number' && Number.isInteger(evidence.allowed_max) && evidence.allowed_max > 0 ? evidence.allowed_max : undefined
  const code = (input.code || '').trim().toLowerCase()
  const status = (input.status || '').trim().toLowerCase()
  const reconciliationExpired = mediaTaskReconciliationClosed(input)
  const manualReconciliationRequired = mediaTaskNeedsManualReconciliation(input)
  const uncertain = requiresMediaTaskReconciliation(input)
  if (reconciliationExpired) return {
    title: en ? 'Provider result could not be confirmed' : '未能确认供应商结果',
    advice: en ? 'The platform task is closed, but the provider result remains unconfirmed. Platform support must verify the original request. Retrying the original input stays blocked; do not resubmit while verification is pending.' : '平台任务已关闭，但供应商结果仍未知，需要平台核查原请求。原样重试仍被关闭，核查完成前请勿重复提交。',
    requiresChange: false, limit: undefined, category: 'reconciliation' as MediaFailureCategory,
  }
  if (manualReconciliationRequired) return {
    title: en ? 'Provider result needs manual confirmation' : '需要人工核对供应商结果',
    advice: en ? 'Automatic verification could not confirm or deliver the original result. Platform support must investigate; do not resubmit while it remains unconfirmed.' : '自动核验未能确认或交付原结果，需由平台核对结果；必要时人工核查。核查完成前请勿重复提交。',
    requiresChange: false, limit: undefined, category: 'reconciliation' as MediaFailureCategory,
  }
  if (uncertain) return {
    title: en ? 'Provider result is being confirmed' : '正在核对供应商结果',
    advice: en ? 'The provider may have accepted the original request. The platform is checking that same task; do not submit it again. Refreshing checks its status without creating another task.' : '供应商可能已接收原请求，平台正在核对这条任务。请勿重复提交；刷新只查询原任务状态，不会再次创建任务。',
    requiresChange: false, limit: undefined, category: 'reconciliation' as MediaFailureCategory,
  }
  if (code === 'unknown_reconciled' && ['failed', 'cancelled', 'canceled'].includes(status)) return {
    title: en ? 'Provider outcome has been verified' : '供应商结果已核实',
    advice: en ? 'The original task has been confirmed as ended. You may adjust the input and generate again.' : '原任务已确认结束，可调整内容后重新生成。',
    requiresChange: false, limit: undefined, category: 'service' as MediaFailureCategory,
  }
  if (referenceTransportUnsupported(input)) return {
    title: en ? 'Reference media format is not supported by the channel' : '当前通道不支持这种参考素材格式',
    advice: en ? 'Use a platform-hosted asset with an accessible link, or choose a model that accepts local images. Retrying the same input will not resolve the format mismatch.' : '请改用已有可访问链接的平台素材，或选择支持本地图片的模型。原样重试无法解决素材格式不匹配。',
    requiresChange: true, limit: undefined, category: 'input' as MediaFailureCategory,
  }
  if (code === 'invalid_input_reference') return {
    title: en ? 'Reference media could not be accepted' : '参考素材未通过校验',
    advice: en ? 'Check the reference file type and link availability, or replace the media before trying again.' : '请检查参考素材的文件类型、链接是否可访问，或更换素材后重试。',
    requiresChange: true, limit: undefined, category: 'input' as MediaFailureCategory,
  }
  if (structuredLimit !== undefined || imageLimit) {
    const limit = structuredLimit ?? Number(imageLimit![1])
    const count = structuredLimit !== undefined && typeof evidence?.actual_value === 'number' ? evidence.actual_value : input.referenceCount
    return {
      title: en ? 'Reference image count exceeded the channel limit for this attempt' : '本次调度未通过参考图数量校验',
      advice: en
        ? `${count !== undefined ? `This request contains ${count} reference images. ` : ''}The rejected channel configuration allowed at most ${limit} at the time. Adjust the references or choose another model; an unchanged retry may fail again.`
        : `${count !== undefined ? `本次提交 ${count} 张参考图，` : ''}失败时的通道配置最多支持 ${limit} 张。请调整参考图或选择其他模型，原样重试可能再次失败。`,
      requiresChange: true, limit, category: 'input' as MediaFailureCategory,
    }
  }
  if (['no_eligible_provider', 'no_eligible_supplier', 'capability_mismatch', 'invalid_request'].includes(code)) return {
    title: en ? 'No channel matched the request' : '本次请求未匹配到可用通道',
    advice: en ? 'Review the input and model settings, or ask support to check channel configuration. Retry after the input or availability changes.' : '请检查输入与模型参数，或联系平台检查通道配置。调整参数或供给恢复后再重试。',
    requiresChange: true, limit: undefined, category: mediaFailureCategory(input),
  }
  return {
    title: en ? 'The generation task did not complete' : '生成任务未完成',
    advice: en ? 'Review the error details. Include the task reference when contacting support.' : '请查看详细错误；联系平台时附上任务编号和诊断信息。',
    requiresChange: false, limit: undefined, category: mediaFailureCategory(input),
  }
}

/** User copy is separate from operational diagnostics and never echoes provider errors. */
export function mediaTaskUserFailure(input: MediaFailureDiagnosticInput, language = 'zh'): { title: string; advice: string } {
  const en = language.startsWith('en')
  const state = mediaTaskState(input)
  const code = state.code || ''
  const status = state.status || ''
  const assetStatus = String(input.assetStatus || '').trim().toLowerCase()
  // Missing assets never establish that an ambiguous upstream submission failed.
  if (mediaTaskReconciliationClosed(input)) return {
    title: en ? 'Task closed · result unconfirmed' : '任务已关闭，结果待核查',
    advice: en ? 'Automatic verification has ended, but the provider may have completed the request. Platform support must verify the original result; do not submit it again. See billing separately for any charge or released reservation.' : '自动核验已结束，但供应商可能已完成生成。平台仍需核查原请求，请勿重复提交；扣费和预留释放情况请查看计费信息。',
  }
  if (state.requiresReconciliation) return {
    title: mediaTaskNeedsManualReconciliation(input)
      ? en ? 'Awaiting manual verification' : '待人工核查'
      : en ? 'Result awaiting verification' : '结果待核验',
    advice: mediaTaskNeedsManualReconciliation(input)
      ? en ? 'Automatic verification could not confirm or deliver the original result. Platform support must investigate; do not resubmit. Refreshing only updates this task.' : '自动核验未能确认或交付原结果，平台需人工核查。请勿重复提交；刷新只更新这条任务的状态。'
      : en ? 'The request was submitted, but its result is not confirmed. Do not resubmit; refreshing checks the original task without generating again.' : '请求已提交，但结果尚未确认。请勿重复提交；刷新只查询原任务，不会再次生成。',
  }
  if (assetStatus === 'expired' || code === 'asset_expired') return {
    title: en ? 'Result expired' : '结果已过期',
    advice: en ? 'Generation completed, but the result is past its retention period. You can create a new generation.' : '生成已完成，但结果已超过保留期限。可重新生成新的作品。',
  }
  if (assetStatus === 'unavailable' || ['asset_unavailable', 'asset_sync_timeout'].includes(code)) return {
    title: en ? 'Result unavailable' : '结果暂不可用',
    advice: en ? 'Generation has ended, but no usable result is available. Refresh to check the result, or create a new generation.' : '生成已结束，但当前没有可读取的结果。可刷新检查结果，或重新生成新的作品。',
  }
  if (code === 'unknown_reconciled' && ['failed', 'cancelled', 'canceled'].includes(status)) return {
    title: ['cancelled', 'canceled'].includes(status) ? en ? 'Cancellation verified' : '已核实取消' : en ? 'Failure verified' : '已核实失败',
    advice: en ? 'The original request was verified as ended without a result. You may adjust the input and generate again.' : '原请求已核实结束且没有生成结果，可调整内容后重新生成。',
  }
  if (referenceTransportUnsupported(input)) return {
    title: en ? 'Reference media format is not supported' : '参考素材格式不支持',
    advice: en ? 'Use reference media with an accessible link, or choose a model that accepts local images.' : '请改用带可访问链接的素材，或选择支持本地图片的模型。',
  }
  if (code === 'invalid_input_reference') return {
    title: en ? 'Reference media is not valid' : '参考素材不可用',
    advice: en ? 'Check the file type and link availability, or replace the reference media before trying again.' : '请检查素材的文件类型、链接是否可访问，或更换素材后重试。',
  }
  const diagnostic = diagnoseMediaFailure(input, language)
  if (diagnostic.limit !== undefined) return {
    title: en ? 'Too many reference images' : '参考图数量过多',
    advice: en ? `This generation allowed up to ${diagnostic.limit} reference images. Reduce the number or choose another model before trying again.` : `本次生成最多支持 ${diagnostic.limit} 张参考图。请减少数量，或选择其他模型后重试。`,
  }
  if (code === 'unsupported_media_format') return {
    title: en ? 'Media format is not supported' : '素材格式不支持',
    advice: en ? 'Use a format supported by the model, or replace the media before trying again.' : '请使用模型支持的素材格式，或更换素材后重新生成。',
  }
  const message = (input.message || '').toLowerCase()
  if (message.includes('generate_audio') && /not supported|unsupported/.test(message)) return {
    title: en ? 'Audio generation is not supported' : '当前模型不支持生成音频',
    advice: en ? 'Turn off audio generation, or choose a model that supports it.' : '请关闭音频生成，或选择支持音频的模型。',
  }
  if (diagnostic.category === 'input' || /invalid media request|not supported by this offer|incompatible with the current platform capability contract/.test(message)) return {
    title: en ? 'Generation settings are not supported' : '生成参数不受支持',
    advice: en ? 'Adjust the reference media, dimensions or duration, or choose another model before trying again.' : '请调整参考素材、尺寸或时长等参数，或选择其他模型后重试。',
  }
  if (['no_eligible_provider', 'no_eligible_supplier'].includes(code) || /no eligible media provider|no configured offer/.test(message)) return {
    title: en ? 'Generation is temporarily unavailable' : '暂时无法生成',
    advice: en ? 'Try again later or choose another model.' : '请稍后重试，或选择其他模型。',
  }
  return {
    title: en ? 'Generation failed' : '生成失败',
    advice: state.canRetry
      ? en ? 'This generation did not complete. You can adjust the content and try again.' : '本次生成未完成，可调整内容后重新生成。'
      : en ? 'This task has ended without a usable result. You can continue editing.' : '本次任务已结束，未获得可用结果。可继续编辑内容。',
  }
}

export function mediaDiagnosticText(input: {
  taskId?: string; requestId?: string; code?: string; status?: string; createdAt?: string; summary?: MediaInputSummary
}) {
  // An explicit allowlist keeps copy-to-support free of prompts, credentials and URLs.
  return Object.entries({
    task_id: input.taskId, request_id: input.requestId, status: input.status,
    error_code: input.code, created_at: input.createdAt,
    model: input.summary?.model, reference_count: input.summary?.reference_count,
    duration: input.summary?.duration, resolution: input.summary?.resolution, aspect_ratio: input.summary?.aspect_ratio,
  }).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => `${key}: ${value}`).join('\n')
}
