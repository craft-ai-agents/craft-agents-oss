/**
 * Browser tool detection helpers.
 *
 * Browser tools can arrive as either:
 * - direct native names (e.g. "browser_snapshot")
 * - namespaced proxy names (e.g. "mcp__session__browser_snapshot")
 *
 * We normalize both shapes to a canonical "browser_*" form so overlay
 * activation logic behaves consistently across backends (Claude + PI).
 */

const BROWSER_TOOL_MATCH = /(?:^|__)(browser_[a-z0-9_-]+)$/i

const BROWSER_TOOL_OVERLAY_EXCLUDED_COMMANDS = new Set([
  '--help',
  '-h',
  'help',
  'release',
])

export function normalizeBrowserToolName(toolName: string): string | null {
  const normalized = toolName.trim()
  if (!normalized) return null

  const match = normalized.match(BROWSER_TOOL_MATCH)
  if (!match) return null

  return match[1].toLowerCase()
}

export function getBrowserToolCommandVerb(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== 'object') return ''

  const command = (toolInput as { command?: unknown }).command
  if (typeof command !== 'string') return ''

  return command.trim().toLowerCase().split(/\s+/)[0] || ''
}

export function shouldActivateBrowserOverlay(toolName: string, toolInput: unknown): boolean {
  const normalizedToolName = normalizeBrowserToolName(toolName)
  if (!normalizedToolName) return false

  if (normalizedToolName !== 'browser_tool') return true

  const verb = getBrowserToolCommandVerb(toolInput)
  if (!verb) return false

  return !BROWSER_TOOL_OVERLAY_EXCLUDED_COMMANDS.has(verb)
}
