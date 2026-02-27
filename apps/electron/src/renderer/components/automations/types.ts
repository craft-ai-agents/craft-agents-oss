/**
 * Automation UI Types
 *
 * UI-specific types for the automations components.
 *
 * ARCHITECTURE NOTE: These types are mirrored from packages/shared/src/automations/types.ts.
 * The renderer runs in a browser context and CANNOT import from @craft-agent/shared,
 * which uses Node.js APIs (crypto, fs, etc.). Additionally, the automations package is not
 * exported as a package entry point. These types must be manually kept in sync.
 * See apps/electron/CLAUDE.md "Common Mistake: Node.js APIs in Renderer".
 */

import { computeNextRuns } from './utils'

// ============================================================================
// Automation System Types (mirrored from packages/shared/src/automations/types.ts)
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

export type AutomationTrigger = AppEvent | AgentEvent

export const APP_EVENTS: AppEvent[] = [
  'LabelAdd', 'LabelRemove', 'LabelConfigChange',
  'PermissionModeChange', 'FlagChange', 'TodoStateChange', 'SessionStatusChange', 'SchedulerTick'
]

export const AGENT_EVENTS: AgentEvent[] = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification',
  'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest', 'Setup'
]

export interface PromptAction {
  type: 'prompt'
  prompt: string
}

export type AutomationAction = PromptAction

// ============================================================================
// List Item (flattened from automations.json for display)
// ============================================================================

export interface AutomationListItem {
  /** Stable 6-char hex ID from automations.json, with fallback to event+index for legacy configs */
  id: string
  /** The event this automation listens to */
  event: AutomationTrigger
  /** Index of this matcher within its event array in automations.json (for write-back) */
  matcherIndex: number
  /** Display name (user-set or auto-derived) */
  name: string
  /** Human-readable summary */
  summary: string
  /** Whether this automation is enabled */
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
  /** The actions this automation performs */
  actions: AutomationAction[]
  /** Timestamp of last execution (ms since epoch) */
  lastExecutedAt?: number
}

// ============================================================================
// Filter
// ============================================================================

export type AutomationFilterKind = 'all' | 'app' | 'agent' | 'scheduled'

export interface AutomationListFilter {
  kind: AutomationFilterKind
}

/** Maps task type (from route) to AutomationFilterKind for the list panel */
export const AUTOMATION_TYPE_TO_FILTER_KIND: Record<string, AutomationFilterKind> = {
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
  automationId: string
  event: AutomationTrigger
  status: ExecutionStatus
  /** Duration in milliseconds */
  duration: number
  /** Timestamp in ms since epoch */
  timestamp: number
  /** Error message (if status === 'error') */
  error?: string
  /** Truncated action summary */
  actionSummary?: string
  /** Session ID created by this execution (for deep linking) */
  sessionId?: string
}

// ============================================================================
// Test Panel
// ============================================================================

export type TestState = 'idle' | 'running' | 'success' | 'error'

export interface TestResult {
  state: TestState
  stderr?: string
  duration?: number
}

// ============================================================================
// Human-Friendly Display Names
// ============================================================================

/** Maps internal event names to user-friendly labels */
export const EVENT_DISPLAY_NAMES: Record<AutomationTrigger, string> = {
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

export function getEventDisplayName(event: AutomationTrigger): string {
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
// Event Categorization (for AutomationAvatar colors)
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
// automations.json Parser
// ============================================================================

/** Raw automations.json file structure */
interface AutomationsConfigFile {
  version: number
  automations?: Record<string, AutomationsConfigMatcher[]>
}

interface AutomationsConfigMatcher {
  id?: string
  name?: string
  matcher?: string
  cron?: string
  timezone?: string
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  labels?: string[]
  enabled?: boolean
  actions?: ({ type: 'prompt'; prompt: string })[]
}

/** Derive a human-readable name from task actions and event */
function deriveAutomationName(event: string, matcher: AutomationsConfigMatcher): string {
  if (matcher.name) return matcher.name
  const allActions = matcher.actions ?? []
  const firstAction = allActions[0]
  if (!firstAction) return getEventDisplayName(event as AutomationTrigger)

  // Extract @skill mentions or use first ~40 chars
  const mentionMatch = firstAction.prompt.match(/@(\S+)/)
  if (mentionMatch) return `${mentionMatch[1]} prompt`
  return firstAction.prompt.length > 40
    ? firstAction.prompt.slice(0, 40) + '...'
    : firstAction.prompt
}

/** Derive a summary line from the matcher/cron/event */
function deriveAutomationSummary(event: string, matcher: AutomationsConfigMatcher): string {
  if (matcher.cron) {
    const runs = computeNextRuns(matcher.cron, 1)
    if (runs.length > 0) {
      const next = runs[0]!
      const tz = matcher.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
      const tzCity = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz
      const formatted = next.toLocaleString('en-US', {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: tz,
      })
      return `Next run: ${formatted} (${tzCity})`
    }
    const tz = matcher.timezone ? ` (${matcher.timezone})` : ''
    return `Cron: ${matcher.cron}${tz}`
  }
  if (matcher.matcher) {
    return `Matches: ${matcher.matcher}`
  }
  return `On ${getEventDisplayName(event as AutomationTrigger)}`
}

/**
 * Parse an automations.json file into a flat list of AutomationListItem[].
 * Each matcher entry under each event becomes one item.
 */
export function parseAutomationsConfig(json: unknown): AutomationListItem[] {
  if (!json || typeof json !== 'object') return []
  const config = json as AutomationsConfigFile
  const eventMap = config.automations
  if (!eventMap || typeof eventMap !== 'object') return []

  const allEvents = [...APP_EVENTS, ...AGENT_EVENTS] as string[]
  const items: AutomationListItem[] = []
  let index = 0

  for (const [eventName, matchers] of Object.entries(eventMap)) {
    if (!Array.isArray(matchers)) continue
    const event = (allEvents.includes(eventName) ? eventName : eventName) as AutomationTrigger

    for (let matcherIdx = 0; matcherIdx < matchers.length; matcherIdx++) {
      const matcher = matchers[matcherIdx]
      const rawActions = matcher.actions
      if (!rawActions || !Array.isArray(rawActions) || rawActions.length === 0) continue

      const actions: AutomationAction[] = rawActions
        .filter((a): a is { type: 'prompt'; prompt: string } => a.type === 'prompt')
      if (actions.length === 0) continue

      items.push({
        id: matcher.id ?? `${eventName}-${index}`,
        event,
        matcherIndex: matcherIdx,
        name: deriveAutomationName(eventName, matcher),
        summary: deriveAutomationSummary(eventName, matcher),
        enabled: matcher.enabled !== false,
        matcher: matcher.matcher,
        cron: matcher.cron,
        timezone: matcher.timezone,
        permissionMode: matcher.permissionMode,
        labels: matcher.labels,
        actions,
      })
      index++
    }
  }

  return items
}

export function getEventCategory(event: AutomationTrigger): EventCategory {
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
