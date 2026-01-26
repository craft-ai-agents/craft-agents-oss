/**
 * Mention Gating for Telegram Groups
 *
 * Filters group messages to only process those that:
 * - Mention the bot (@botusername)
 * - Reply to a bot message
 * - Start with a command (/)
 *
 * This reduces noise in busy groups by requiring explicit bot interaction.
 *
 * Use case: In high-traffic groups, the bot should only respond when explicitly
 * addressed, not to every message. This prevents spam and reduces API usage.
 */

export function shouldProcessGroupMessage(params: {
  content: string
  botUsername: string
  requireMention: boolean
  isReplyToBot: boolean
}): boolean {
  // Always process in non-mention mode (process all messages)
  if (!params.requireMention) return true

  // Check if bot was mentioned (case-insensitive, word boundary)
  // Example: "@mybot can you help?" → true
  const mentionPattern = new RegExp(`@${escapeRegex(params.botUsername)}\\b`, 'i')
  if (mentionPattern.test(params.content)) return true

  // Check if this is a reply to the bot (threaded conversation)
  if (params.isReplyToBot) return true

  // Check if starts with command (always process commands)
  // Example: "/help" → true
  if (params.content.trim().startsWith('/')) return true

  return false
}

/**
 * Escape special regex characters in a string.
 * Prevents ReDoS vulnerabilities from user-controlled input.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
