/**
 * Hook UI Types
 *
 * UI-specific types for the hooks playground components.
 *
 * ARCHITECTURE NOTE: These types are mirrored from packages/shared/src/hooks-simple/types.ts.
 * The renderer runs in a browser context and CANNOT import from @craft-agent/shared,
 * which uses Node.js APIs (crypto, fs, etc.). Additionally, hooks-simple is not
 * exported as a package entry point. These types must be manually kept in sync.
 * See apps/electron/CLAUDE.md "Common Mistake: Node.js APIs in Renderer".
 */

// ============================================================================
// Hook System Types (mirrored from packages/shared/src/hooks-simple/types.ts)
// ============================================================================

export type AppEvent =
  | 'LabelAdd'
  | 'LabelRemove'
  | 'LabelConfigChange'
  | 'PermissionModeChange'
  | 'FlagChange'
  | 'TodoStateChange'
  | 'SessionStatusChange'
  | 'SchedulerTick'

export type AgentEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest'
  | 'Setup'

export type HookEvent = AppEvent | AgentEvent

export const APP_EVENTS: AppEvent[] = [
  'LabelAdd', 'LabelRemove', 'LabelConfigChange',
  'PermissionModeChange', 'FlagChange', 'TodoStateChange', 'SessionStatusChange', 'SchedulerTick'
]

export const AGENT_EVENTS: AgentEvent[] = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification',
  'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest', 'Setup'
]

export interface CommandHookDefinition {
  type: 'command'
  command: string
  timeout?: number
}

export interface PromptHookDefinition {
  type: 'prompt'
  prompt: string
}

export type HookDefinition = CommandHookDefinition | PromptHookDefinition

// ============================================================================
// List Item (flattened from hooks.json for display)
// ============================================================================

export interface HookListItem {
  /** Stable 6-char hex ID from tasks.json, with fallback to event+index for legacy configs */
  id: string
  /** The event this hook listens to */
  event: HookEvent
  /** Index of this matcher within its event array in hooks.json (for write-back) */
  matcherIndex: number
  /** Display name (user-set or auto-derived) */
  name: string
  /** Human-readable summary */
  summary: string
  /** Whether this hook is enabled */
  enabled: boolean
  /** Regex matcher (if any) */
  matcher?: string
  /** Cron expression (SchedulerTick only) */
  cron?: string
  /** IANA timezone for cron */
  timezone?: string
  /** Permission mode */
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  /** Labels for prompt sessions */
  labels?: string[]
  /** The actions this hook performs */
  hooks: HookDefinition[]
  /** Timestamp of last execution (ms since epoch) */
  lastExecutedAt?: number
}

// ============================================================================
// Filter
// ============================================================================

export type HookFilterKind = 'all' | 'app' | 'agent' | 'scheduled'

export interface HookFilter {
  kind: HookFilterKind
}

/** Maps task type (from route) to HookFilterKind for the list panel */
export const TASK_TYPE_TO_FILTER_KIND: Record<string, HookFilterKind> = {
  scheduled: 'scheduled',
  event: 'app',
  agentic: 'agent',
}

// ============================================================================
// Execution History
// ============================================================================

export type ExecutionStatus = 'success' | 'error' | 'blocked'

export interface ExecutionEntry {
  id: string
  hookId: string
  event: HookEvent
  status: ExecutionStatus
  /** Duration in milliseconds */
  duration: number
  /** Timestamp in ms since epoch */
  timestamp: number
  /** Error message (if status === 'error') */
  error?: string
  /** Truncated action summary */
  actionSummary?: string
}

// ============================================================================
// Test Panel
// ============================================================================

export type TestState = 'idle' | 'running' | 'success' | 'error' | 'blocked'

export interface TestResult {
  state: TestState
  stdout?: string
  stderr?: string
  exitCode?: number
  duration?: number
  blockedReason?: string
}

// ============================================================================
// Human-Friendly Display Names
// ============================================================================

/** Maps internal event names to user-friendly labels */
export const EVENT_DISPLAY_NAMES: Record<HookEvent, string> = {
  // App events
  LabelAdd:             'Label Added',
  LabelRemove:          'Label Removed',
  LabelConfigChange:    'Label Settings Changed',
  PermissionModeChange: 'Permission Changed',
  FlagChange:           'Flag Changed',
  TodoStateChange:      'Task Updated',
  SessionStatusChange:  'Status Changed',
  SchedulerTick:        'Scheduled',

  // Agent events
  PreToolUse:           'Before Tool Runs',
  PostToolUse:          'After Tool Runs',
  PostToolUseFailure:   'When Tool Fails',
  Notification:         'Notification',
  UserPromptSubmit:     'Message Sent',
  SessionStart:         'Session Started',
  SessionEnd:           'Session Ended',
  Stop:                 'Agent Stopped',
  SubagentStart:        'Sub-agent Started',
  SubagentStop:         'Sub-agent Stopped',
  PreCompact:           'Before Memory Cleanup',
  PermissionRequest:    'Permission Requested',
  Setup:                'Initial Setup',
}

export function getEventDisplayName(event: HookEvent): string {
  return EVENT_DISPLAY_NAMES[event] ?? event
}

/** Maps permission mode values to user-friendly labels */
export const PERMISSION_DISPLAY_NAMES: Record<string, string> = {
  'safe':      'Safe Mode',
  'ask':       'Ask First',
  'allow-all': 'Allow All',
}

export function getPermissionDisplayName(mode?: string): string {
  if (!mode) return 'Safe Mode'
  return PERMISSION_DISPLAY_NAMES[mode] ?? mode
}

// ============================================================================
// Event Categorization (for HookAvatar colors)
// ============================================================================

export type EventCategory =
  | 'scheduled'
  | 'label'
  | 'permission'
  | 'flag'
  | 'todo'
  | 'agent-pre'
  | 'agent-post'
  | 'agent-error'
  | 'session'
  | 'other'

// ============================================================================
// hooks.json Parser
// ============================================================================

/** Raw tasks.json / hooks.json file structure */
interface HooksConfigFile {
  version: number
  // Accept both "tasks" (v2) and "hooks" (v1) top-level keys
  hooks?: Record<string, HooksConfigMatcher[]>
  tasks?: Record<string, HooksConfigMatcher[]>
}

interface HooksConfigMatcher {
  id?: string
  name?: string
  matcher?: string
  cron?: string
  timezone?: string
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  labels?: string[]
  enabled?: boolean
  // Accept both "actions" (v2) and "hooks" (v1) inner arrays
  hooks?: ({ type: 'command'; command: string; timeout?: number } | { type: 'prompt'; prompt: string })[]
  actions?: ({ type: 'command'; command: string; timeout?: number } | { type: 'prompt'; prompt: string })[]
}

/** Derive a human-readable name from task actions and event */
function deriveHookName(event: string, matcher: HooksConfigMatcher): string {
  if (matcher.name) return matcher.name
  const allActions = matcher.actions ?? matcher.hooks ?? []
  const firstAction = allActions[0]
  if (!firstAction) return getEventDisplayName(event as HookEvent)

  if (firstAction.type === 'prompt') {
    // Extract @skill mentions or use first ~40 chars
    const mentionMatch = firstAction.prompt.match(/@(\S+)/)
    if (mentionMatch) return `${mentionMatch[1]} prompt`
    return firstAction.prompt.length > 40
      ? firstAction.prompt.slice(0, 40) + '...'
      : firstAction.prompt
  }

  // Command: use the script name or first ~40 chars
  const cmd = firstAction.command
  const scriptMatch = cmd.match(/\/([^/\s]+)$/)
  if (scriptMatch) return scriptMatch[1]
  return cmd.length > 40 ? cmd.slice(0, 40) + '...' : cmd
}

/** Derive a summary line from the matcher/cron/event */
function deriveHookSummary(event: string, matcher: HooksConfigMatcher): string {
  if (matcher.cron) {
    const tz = matcher.timezone ? ` (${matcher.timezone})` : ''
    return `Cron: ${matcher.cron}${tz}`
  }
  if (matcher.matcher) {
    return `Matches: ${matcher.matcher}`
  }
  return `On ${getEventDisplayName(event as HookEvent)}`
}

/**
 * Parse a hooks.json file into a flat list of HookListItem[].
 * Each matcher entry under each event becomes one item.
 */
export function parseHooksConfig(json: unknown): HookListItem[] {
  if (!json || typeof json !== 'object') return []
  const config = json as HooksConfigFile
  // Support both "tasks" (v2) and "hooks" (v1) top-level keys
  const eventMap = config.tasks ?? config.hooks
  if (!eventMap || typeof eventMap !== 'object') return []

  const allEvents = [...APP_EVENTS, ...AGENT_EVENTS] as string[]
  const items: HookListItem[] = []
  let index = 0

  for (const [eventName, matchers] of Object.entries(eventMap)) {
    if (!Array.isArray(matchers)) continue
    const event = (allEvents.includes(eventName) ? eventName : eventName) as HookEvent

    for (let matcherIdx = 0; matcherIdx < matchers.length; matcherIdx++) {
      const matcher = matchers[matcherIdx]
      // Support both "actions" (v2) and "hooks" (v1) inner arrays
      const actions = matcher.actions ?? matcher.hooks
      if (!actions || !Array.isArray(actions) || actions.length === 0) continue

      items.push({
        id: matcher.id ?? `${eventName}-${index}`,
        event,
        matcherIndex: matcherIdx,
        name: deriveHookName(eventName, matcher),
        summary: deriveHookSummary(eventName, matcher),
        enabled: matcher.enabled !== false,
        matcher: matcher.matcher,
        cron: matcher.cron,
        timezone: matcher.timezone,
        permissionMode: matcher.permissionMode,
        labels: matcher.labels,
        hooks: actions as HookDefinition[],
      })
      index++
    }
  }

  return items
}

export function getEventCategory(event: HookEvent): EventCategory {
  switch (event) {
    case 'SchedulerTick':
      return 'scheduled'
    case 'LabelAdd':
    case 'LabelRemove':
    case 'LabelConfigChange':
      return 'label'
    case 'PermissionModeChange':
    case 'PermissionRequest':
      return 'permission'
    case 'FlagChange':
      return 'flag'
    case 'TodoStateChange':
    case 'SessionStatusChange':
      return 'todo'
    case 'PreToolUse':
    case 'UserPromptSubmit':
    case 'Setup':
    case 'PreCompact':
    case 'SubagentStart':
      return 'agent-pre'
    case 'PostToolUse':
    case 'SessionEnd':
    case 'SubagentStop':
    case 'Stop':
      return 'agent-post'
    case 'PostToolUseFailure':
      return 'agent-error'
    case 'SessionStart':
    case 'Notification':
      return 'session'
    default:
      return 'other'
  }
}
