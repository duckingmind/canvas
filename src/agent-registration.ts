import { agent, type AgentHandler, type AgentNextAction } from '@ducking-mind/proxy-app-sdk'
import { capability } from './agent-tools.mjs'

const recovery: Record<string, { reason: string; retryable: boolean; nextAction: AgentNextAction }> = {
  CANVAS_REVISION_CONFLICT: { reason: 'document_changed', retryable: false, nextAction: { type: 'inspect_state', capability: 'proxy_canvas_read_state' } },
  CANVAS_WORKSPACE_CONFLICT: { reason: 'workspace_changed', retryable: false, nextAction: { type: 'inspect_state', capability: 'proxy_canvas_list_documents' } },
  CANVAS_GENERATION_NOT_READY: { reason: 'generation_precondition_missing', retryable: false, nextAction: { type: 'inspect_state', capability: 'proxy_canvas_list_models' } },
}

/** Register each handler with the contract owned by the application code. */
export function registerCanvasCapabilities<T extends Record<string, AgentHandler<any, any>>>(handlers: T): () => void {
  const disposers: Array<() => void> = []
  try {
    for (const [name, handler] of Object.entries(handlers)) {
      const declaration = capability(name)
      disposers.push(agent.register(declaration, async (input, context) => {
        try { return await handler(input, context) }
        catch (error) {
          if (error instanceof Error) {
            const failure = error as Error & { code?: string; reason?: string; retryable?: boolean; nextAction?: AgentNextAction }
            const hint = recovery[failure.code || '']
            if (hint) {
              failure.reason ??= hint.reason
              failure.retryable ??= hint.retryable
              failure.nextAction ??= hint.nextAction
            }
          }
          throw error
        }
      }))
    }
  } catch (error) { disposers.forEach(dispose => dispose()); throw error }
  return () => disposers.forEach(dispose => dispose())
}
