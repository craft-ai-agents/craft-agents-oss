export type PermissionDirective = 'safe' | 'ask' | 'allow-all' | null

/**
 * Parse inline permission directives from WhatsApp messages
 *
 * Format: @vesper /safe|/ask|/allow-all <message content>
 *
 * Examples:
 * - "@vesper /safe research competitors" → directive='safe', content='research competitors'
 * - "@vesper /allow-all run script.sh" → directive='allow-all', content='run script.sh'
 * - "just ask claude" → directive=null, content='just ask claude'
 */
export function extractDirective(message: string): {
  directive: PermissionDirective
  content: string
} {
  const trimmed = message.trim()

  // Pattern: @vesper /directive
  const match = trimmed.match(/^@vesper\s+\/(safe|ask|allow-all)\s+(.*)$/i)

  if (!match) {
    // No directive found - treat entire message as content
    return {
      directive: null,
      content: trimmed,
    }
  }

  const [, directiveStr, content] = match
  const directive = (directiveStr?.toLowerCase() ?? 'safe') as PermissionDirective

  return {
    directive,
    content: (content?.trim() ?? ''),
  }
}

/**
 * Check if message contains a directive
 */
export function hasDirective(message: string): boolean {
  return /^@vesper\s+\/(safe|ask|allow-all)/i.test(message.trim())
}

/**
 * Extract only the directive (if present)
 */
export function getDirective(message: string): PermissionDirective {
  const { directive } = extractDirective(message)
  return directive
}
