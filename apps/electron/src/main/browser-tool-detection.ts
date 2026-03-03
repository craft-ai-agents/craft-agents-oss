/**
 * Browser tool detection helpers.
 *
 * Browser overlay activation is now driven by the unified `browser_tool` only.
 * Tool names can be direct (`browser_tool`) or namespaced
 * (`mcp__session__browser_tool`).
 */

const BROWSER_TOOL_MATCH = /(?:^|__)browser_tool$/i

const BROWSER_TOOL_OVERLAY_EXCLUDED_COMMANDS = new Set([
  '--help',
  '-h',
  'help',
  'open',
  'release',
  'close',
  'hide',
])

export function normalizeBrowserToolName(toolName: string): string | null {
  const normalized = toolName.trim()
  if (!normalized) return null

  return BROWSER_TOOL_MATCH.test(normalized) ? 'browser_tool' : null
}

export function getBrowserToolCommandVerb(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== 'object') return ''

  const command = (toolInput as { command?: unknown }).command
  if (typeof command !== 'string') return ''

  return command.trim().toLowerCase().split(/\s+/)[0] || ''
}

export function shouldActivateBrowserOverlay(toolName: string, toolInput: unknown): boolean {
  const normalizedToolName = normalizeBrowserToolName(toolName)
  if (normalizedToolName !== 'browser_tool') return false

  const verb = getBrowserToolCommandVerb(toolInput)
  if (!verb) return false

  return !BROWSER_TOOL_OVERLAY_EXCLUDED_COMMANDS.has(verb)
}

