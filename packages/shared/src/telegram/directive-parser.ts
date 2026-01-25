export type PermissionDirective = 'safe' | 'ask' | 'allow-all' | null

/**
 * Parse inline permission directives from Telegram messages
 *
 * Format: /safe|/ask|/allow_all <message content>
 *
 * Examples:
 * - "/safe research competitors" → directive='safe', content='research competitors'
 * - "/allow_all run script.sh" → directive='allow-all', content='run script.sh'
 * - "just ask claude" → directive=null, content='just ask claude'
 */
export function extractDirective(message: string): {
  directive: PermissionDirective
  content: string
} {
  const trimmed = message.trim()

  // Pattern: /directive
  // Note: Telegram uses underscores in /allow_all for bot commands
  const match = trimmed.match(/^\/(safe|ask|allow_all)\s+(.*)$/i)

  if (!match) {
    // No directive found - treat entire message as content
    return {
      directive: null,
      content: trimmed,
    }
  }

  const [, directiveStr, content] = match
  // Convert allow_all to allow-all for internal use
  const normalizedDirective = directiveStr?.toLowerCase().replace('_', '-') ?? 'safe'
  const directive = normalizedDirective as PermissionDirective

  return {
    directive,
    content: (content?.trim() ?? ''),
  }
}

/**
 * Check if message contains a directive
 */
export function hasDirective(message: string): boolean {
  return /^\/(safe|ask|allow_all)/i.test(message.trim())
}

/**
 * Extract only the directive (if present)
 */
export function getDirective(message: string): PermissionDirective {
  const { directive } = extractDirective(message)
  return directive
}
