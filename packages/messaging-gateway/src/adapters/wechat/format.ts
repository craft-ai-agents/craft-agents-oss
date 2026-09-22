/**
 * Message formatting utilities for WeChat.
 *
 * WeChat's iLink Bot API accepts plain text (no Markdown rendering).
 * We strip Markdown formatting and convert to clean text, similar to
 * how WhatsApp handles messages.
 */

/**
 * Strip common Markdown formatting and produce plain text suitable
 * for WeChat messages.
 *
 * - Bold: `**text**` → `text`
 * - Italic: `*text*` → `text`
 * - Code: `` `text` `` → `text`
 * - Code blocks: ```...``` → content
 * - Links: `[text](url)` → `text(url)`
 * - Headers: `### text` → `text`
 */
export function formatForWeChat(text: string): string {
  let result = text

  // Code blocks (triple backtick) → strip fences, keep content
  result = result.replace(/```[\w]*\n?([\s\S]*?)```/g, '$1')

  // Inline code
  result = result.replace(/`([^`]+)`/g, '$1')

  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1')

  // Italic
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')

  // Links [text](url) → text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')

  // Headers (# at line start)
  result = result.replace(/^#{1,6}\s+/gm, '')

  // Horizontal rules
  result = result.replace(/^---+$/gm, '──────────')

  // Unordered list markers
  result = result.replace(/^[-*]\s+/gm, '• ')

  // Ordered list markers
  result = result.replace(/^\d+\.\s+/gm, (match) => {
    return match
  })

  // Collapse multiple blank lines
  result = result.replace(/\n{3,}/g, '\n\n')

  return result.trim()
}

/**
 * Split a long message into chunks that fit within WeChat's message
 * size limits.
 */
export function splitMessage(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }

    // Try to split at a newline within the limit
    let splitAt = remaining.lastIndexOf('\n', maxLen)
    if (splitAt <= 0) {
      // Try to split at a space
      splitAt = remaining.lastIndexOf(' ', maxLen)
    }
    if (splitAt <= 0) {
      // Hard split
      splitAt = maxLen
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd())
    remaining = remaining.slice(splitAt).trimStart()
  }

  return chunks
}
