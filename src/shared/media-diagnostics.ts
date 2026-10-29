/** Safe, content-free facts shared by the task surfaces. Never include prompts or asset URLs. */
import { mediaFailureCategory, mediaTaskAwaitingAutomaticFailover, mediaTaskReconciliationClosed, mediaTaskState, requiresMediaTaskReconciliation, type MediaFailureCategory, type MediaTaskStateInput } from './media-task-state.ts'

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

function contentPolicyFailure(input: MediaFailureDiagnosticInput) {
  const code = (input.code || '').trim().toLowerCase()
  if (['content_policy_violation', 'provider_content_blocked', 'content_policy', 'content_filter', 'content_filtered', 'safety_violation', 'safety_filter', 'moderation_blocked', 'prompt_blocked', 'prompt_rejected'].includes(code)) return true
  const message = (input.message || '').trim().toLowerCase()
  return ['content policy', 'content_policy', 'content safety', 'content_safety', 'content filter', 'content_filter', 'safety violation', 'safety_violation', 'moderation blocked', 'moderation_blocked', 'prompt blocked', 'prompt_blocked', 'prompt violates', 'prompt violation', 'disallowed content', 'content is not allowed', '违反内容政策', '违反了内容政策', '违反了我们的内容政策', '可能违反内容政策', '违反内容安全政策', '违反了内容安全政策', '违反了我们的内容安全政策', '不符合内容政策', '不符合内容安全政策', '未通过内容安全审核', '内容安全审核未通过', '触发内容安全限制'].some(marker => message.includes(marker))
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
  const automaticFailoverPending = mediaTaskAwaitingAutomaticFailover(input)
  const uncertain = requiresMediaTaskReconciliation(input)
  if (reconciliationExpired) return {
    title: en ? 'Automatic fallback ended · provider result unconfirmed' : '自动兜底已结束 · 供应商结果未确认',
    advice: en ? 'Automatic fallback has ended, but the provider result remains unconfirmed. Check the task billing record before creating another request.' : '自动兜底已结束，但供应商结果仍未确认。重新发起前请先确认本任务的资金状态。',
    requiresChange: false, limit: undefined, category: 'reconciliation' as MediaFailureCategory,
  }
  if (automaticFailoverPending) return {
    title: en ? 'Switching to a fallback provider' : '正在切换备用渠道',
    advice: en ? 'The original result could not be confirmed. The platform is trying the next available provider; customer billing is captured once.' : '原供应商结果无法确认，系统正在尝试下一个可用供应商；用户费用只在任务最终成功时结算一次。',
    requiresChange: false, limit: undefined, category: 'reconciliation' as MediaFailureCategory,
  }
  if (uncertain) return {
    title: en ? 'Provider result is being recovered' : '系统正在恢复供应商结果',
    advice: en ? 'The provider may have accepted the original request. The platform is checking it and will automatically try another provider if needed. Do not submit again.' : '供应商可能已接收原请求，系统正在核对并在需要时自动切换备用渠道。请勿重复提交。',
    requiresChange: false, limit: undefined, category: 'reconciliation' as MediaFailureCategory,
  }
  if (code === 'unknown_reconciled' && ['failed', 'cancelled', 'canceled'].includes(status)) return {
    title: en ? 'Provider outcome has been verified' : '供应商结果已核实',
    advice: en ? 'The original task has been confirmed as ended. You may adjust the input and generate again.' : '原任务已确认结束，可调整内容后重新生成。',
    requiresChange: false, limit: undefined, category: 'service' as MediaFailureCategory,
  }
  if (contentPolicyFailure(input)) return {
    title: en ? 'Request blocked by content safety' : '请求未通过内容安全审核',
    advice: en ? 'Review the prompt and any reference media, then try again.' : '请检查提示词和参考素材，调整后再试。',
    requiresChange: true, limit: undefined, category: 'input' as MediaFailureCategory,
  }
  if (code === 'invalid_prompt') return {
    title: en ? 'Prompt input is invalid' : '提示词未通过格式校验',
    advice: en ? 'Provide a non-empty prompt or a valid reference image, then try again.' : '请填写有效提示词，或添加有效参考素材后重试。',
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
    title: en ? 'Automatic fallback ended · result unconfirmed' : '自动兜底已结束 · 结果未确认',
    advice: en ? 'Automatic fallback has ended, but the provider may have completed the request. Check the task billing record before deciding whether to create another request.' : '自动兜底已结束，但原供应商仍可能完成生成。决定是否重新发起前，请先确认本任务的资金状态。',
  }
  if (state.requiresReconciliation) return {
    title: mediaTaskAwaitingAutomaticFailover(input)
      ? en ? 'Switching to a fallback provider' : '正在切换备用渠道'
      : en ? 'Recovering the provider result' : '系统正在恢复供应商结果',
    advice: mediaTaskAwaitingAutomaticFailover(input)
      ? en ? 'The original result could not be confirmed. The platform is trying the next available provider; customer billing is captured once.' : '原供应商结果无法确认，系统正在尝试下一个可用供应商；用户费用只在任务最终成功时结算一次。'
      : en ? 'The request may have been accepted. The platform will check the original task and automatically try a fallback provider if needed. Do not resubmit.' : '原请求可能已被供应商接收。系统会核验原任务，并在需要时自动切换备用渠道。请勿重复提交。',
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
  if (contentPolicyFailure(input)) return {
    title: en ? 'Request blocked by content safety' : '请求未通过内容安全审核',
    advice: en ? 'Review the prompt and any reference media, then try again.' : '请检查提示词和参考素材，调整后再试。',
  }
  if (code === 'invalid_prompt') return {
    title: en ? 'Prompt input is invalid' : '提示词未通过格式校验',
    advice: en ? 'Provide a non-empty prompt or a valid reference image, then try again.' : '请填写有效提示词，或添加有效参考素材后重试。',
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
