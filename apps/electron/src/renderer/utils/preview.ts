import type { Message } from '../../shared/types'
import { stripMarkdown } from './text'

export { stripMarkdown }

/** Message roles suitable for preview display */
const PREVIEWABLE_ROLES = new Set<Message['role']>(['user', 'assistant', 'info', 'warning'])

/**
 * Find the most appropriate message for preview.
 * Skips tool results, status, system, and error messages.
 */
export function getPreviewMessage(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!PREVIEWABLE_ROLES.has(msg.role)) continue
    if (!msg.content?.trim()) continue
    return msg.content
  }
  return 'New chat'
}

/**
 * Generate a clean preview string for session list.
 * - Finds the most recent previewable message (skips tool results)
 * - Strips markdown formatting using remark parser
 * - Truncates to maxLength characters
 */
export function getSessionPreview(messages: Message[], maxLength = 300): string {
  const raw = getPreviewMessage(messages)
  if (raw === 'New chat') return raw

  // Only parse first 500 chars to avoid parsing huge messages
  const truncatedInput = raw.slice(0, 500)
  const cleaned = stripMarkdown(truncatedInput)

  return cleaned.length > maxLength
    ? cleaned.slice(0, maxLength) + '...'
    : cleaned
}
