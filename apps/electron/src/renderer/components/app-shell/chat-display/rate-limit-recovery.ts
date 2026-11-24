import type { Message } from '../../../../shared/types'

/** Only the latest failed turn can offer an in-place account switch. */
export function getRateLimitRecoveryMessageId(
  messages: readonly Message[] | undefined,
  isProcessing: boolean | undefined,
): string | undefined {
  if (isProcessing) return undefined
  // Ignore status, tool, and partial assistant messages around the error.
  const latest = messages?.findLast(message => message.role === 'user' || message.role === 'error'
    || (message.role === 'assistant' && !message.isIntermediate && !message.isStreaming))
  return latest?.role === 'error' && latest.errorCode === 'rate_limited' ? latest.id : undefined
}
