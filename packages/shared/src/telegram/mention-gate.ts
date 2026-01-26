/**
 * Mention Gating for Telegram Groups
 *
 * Filters group messages to only process those that:
 * - Mention the bot (@botusername)
 * - Reply to a bot message
 * - Start with a command (/)
 *
 * This reduces noise in busy groups by requiring explicit bot interaction.
 */

export function shouldProcessGroupMessage(params: {
  content: string
  botUsername: string
  requireMention: boolean
  isReplyToBot: boolean
}): boolean {
  // Always process in non-mention mode
  if (!params.requireMention) return true

  // Check if bot was mentioned
  const mentionPattern = new RegExp(`@${escapeRegex(params.botUsername)}\\b`, 'i')
  if (mentionPattern.test(params.content)) return true

  // Check if this is a reply to the bot
  if (params.isReplyToBot) return true

  // Check if starts with command
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
