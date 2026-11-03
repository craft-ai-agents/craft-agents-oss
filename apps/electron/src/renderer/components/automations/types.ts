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
import type { PermissionMode } from '../../../shared/types'
import type { ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import { AUTOMATIONS_LOAD_ISSUES_KEY, type AutomationLoadIssue } from '@craft-agent/shared/protocol'
import { DEFAULT_WEBHOOK_METHOD } from './constants'

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
  /** LLM connection slug override for the spawned session */
  llmConnection?: string
  /** Model ID override for the spawned session */
  model?: string
  /** Thinking level override for the spawned session */
  thinkingLevel?: ThinkingLevel
}

export interface WebhookAction {
  type: 'webhook'
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  bodyFormat?: 'json' | 'form' | 'raw'
  body?: unknown
  captureResponse?: boolean
  auth?: { type: 'basic'; username: string; password: string } | { type: 'bearer'; token: string }
}

export interface ScriptAction {
  type: 'script'
  /** Script path relative to the workspace root */
  script: string
  args?: string[]
  runtime?: 'bun' | 'node' | 'python3'
  timeoutMs?: number
  /** Slug of the page this script refreshes */
  page?: string
}

export type AutomationAction = PromptAction | WebhookAction | ScriptAction

// ============================================================================
// Conditions (mirrored from packages/shared/src/automations/types.ts)
// ============================================================================

export interface TimeConditionUI {
  condition: 'time'
  after?: string
  before?: string
  weekday?: string[]
  timezone?: string
}

export interface StateConditionUI {
  condition: 'state'
  field: string
  value?: unknown
  from?: unknown
  to?: unknown
  contains?: string
  not_value?: unknown
}

export interface LogicalConditionUI {
  condition: 'and' | 'or' | 'not'
  conditions: AutomationConditionUI[]
}

export type AutomationConditionUI = TimeConditionUI | StateConditionUI | LogicalConditionUI

/** Human-friendly field names for state conditions */
const FIELD_LABELS: Record<string, string> = {
  permissionMode: 'permission mode',
  sessionStatus: 'session status',
  isFlagged: 'flagged',
  labels: 'label',
  sessionName: 'session name',
}

/** Get a readable field name, falling back to the raw field */
function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

/** Produce a short human-readable label for a single leaf condition */
function describeLeaf(c: AutomationConditionUI): string {
  switch (c.condition) {
    case 'time': {
      const parts: string[] = []
      if (c.weekday?.length) parts.push(c.weekday.join(', '))
      if (c.after) parts.push(`after ${c.after}`)
      if (c.before) parts.push(`before ${c.before}`)
      if (c.timezone) parts.push(`(${c.timezone})`)
      return parts.length ? parts.join(' ') : 'any time'
    }
    case 'state': {
      const label = fieldLabel(c.field)
      if (c.from !== undefined || c.to !== undefined) {
        const from = c.from !== undefined ? String(c.from) : 'any'
        const to = c.to !== undefined ? String(c.to) : 'any'
        return `${label} changed from ${from} to ${to}`
      }
      if (c.contains) return `has ${label} "${c.contains}"`
      if (c.not_value !== undefined) {
        if (c.field === 'isFlagged') return c.not_value ? 'not flagged' : 'is flagged'
        return `${label} is not ${String(c.not_value)}`
      }
      if (c.value !== undefined) {
        if (c.field === 'isFlagged') return c.value ? 'is flagged' : 'not flagged'
        return `${label} is ${String(c.value)}`
      }
      return label
    }
    case 'and':
    case 'or':
    case 'not': {
      const sep = c.condition === 'not' ? ' and not ' : ` ${c.condition} `
      return c.conditions.map(describeLeaf).join(sep)
    }
    default:
      return 'unknown condition'
  }
}

/**
 * Flatten a condition tree into displayable rows.
 * Logical conditions are expanded so their children appear as joined text.
 * Returns an array of { label, description } for rendering in Info_Table.
 */
export function flattenConditions(conditions: AutomationConditionUI[]): { label: string; description: string }[] {
  const rows: { label: string; description: string }[] = []
  for (const c of conditions) {
    if (c.condition === 'and' || c.condition === 'or' || c.condition === 'not') {
      // Flatten: join inner descriptions with the operator
      const sep = c.condition === 'not' ? ' and not ' : ` ${c.condition} `
      const inner = c.conditions.map(describeLeaf).join(sep)
      // Use the label of the first child type, or 'Condition' as fallback
      const firstChild = c.conditions[0]
      const label = firstChild
        ? firstChild.condition === 'time' ? 'Time'
          : firstChild.condition === 'state' ? 'State'
          : 'Condition'
        : 'Condition'
      rows.push({ label, description: inner })
    } else {
      const label = c.condition === 'time' ? 'Time' : c.condition === 'state' ? 'State' : 'Condition'
      rows.push({ label, description: describeLeaf(c) })
    }
  }
  return rows
}

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
  permissionMode?: PermissionMode
  /** Labels for prompt sessions */
  labels?: string[]
  /** Conditions that must pass before actions run */
  conditions?: AutomationConditionUI[]
  /** The actions this automation performs */
  actions: AutomationAction[]
  /**
   * Optional Telegram forum-topic name. When set, sessions spawned by this
   * matcher are bound to a topic of this name in the workspace's paired
   * supergroup (created on first use).
   */
  telegramTopic?: string
  /** Timestamp of last execution (ms since epoch) */
  lastExecutedAt?: number
  /**
   * Why this automation does not run, from the server's load of automations.json
   * (invalid entry skipped, or an event that never runs). Undefined when it runs.
   */
  issues?: string[]
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

/** `skipped`: the matcher's semanticCondition was not met, so no action ran. */
export type ExecutionStatus = 'success' | 'error' | 'blocked' | 'skipped'

export interface WebhookDetails {
  method: string
  url: string
  statusCode: number
  durationMs: number
  attempts?: number
  error?: string
  responseBody?: string
}

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
  /** Structured webhook execution details (expandable in timeline) */
  webhookDetails?: WebhookDetails
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
export const PERMISSION_DISPLAY_NAMES: Record<PermissionMode, string> = {
  'safe':      'Explore',
  'ask':       'Ask',
  // Not selectable for automations (they run unattended); listed for completeness.
  'guarded':   'Guarded',
  'allow-all': 'Execute',
}

export function getPermissionDisplayName(mode?: PermissionMode): string {
  if (!mode) return 'Explore'
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

/** A raw action is whatever the file holds — including types that no longer exist (e.g. "command"). */
type LooseAction = { type?: unknown; [key: string]: unknown }

function isLooseAction(value: unknown): value is LooseAction {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Actions the screen can show: prompt, webhook and script (all three run). */
function isKnownAction(value: unknown): value is AutomationAction {
  if (!isLooseAction(value)) return false
  if (value.type === 'prompt') return typeof value.prompt === 'string'
  if (value.type === 'webhook') return typeof value.url === 'string'
  if (value.type === 'script') return typeof value.script === 'string'
  return false
}

interface AutomationsConfigMatcher {
  id?: string
  name?: string
  matcher?: string
  cron?: string
  timezone?: string
  permissionMode?: PermissionMode
  labels?: string[]
  conditions?: AutomationConditionUI[]
  enabled?: boolean
  actions?: unknown[]
}

/** Derive a human-readable name from task actions and event */
function deriveAutomationName(event: string, matcher: AutomationsConfigMatcher): string {
  if (matcher.name) return matcher.name
  const firstAction = (Array.isArray(matcher.actions) ? matcher.actions : [])[0]
  // Missing or unknown action (e.g. the removed "command" type): name it after the event
  if (!isKnownAction(firstAction)) return getEventDisplayName(event as AutomationTrigger)

  if (firstAction.type === 'webhook') {
    const label = `Webhook ${firstAction.method ?? DEFAULT_WEBHOOK_METHOD} ${firstAction.url}`
    return label.length > 40 ? label.slice(0, 40) + '...' : label
  }

  if (firstAction.type === 'script') {
    const label = `Script ${firstAction.script}`
    return label.length > 40 ? label.slice(0, 40) + '...' : label
  }

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
    const runs = computeNextRuns(matcher.cron, 1, matcher.timezone)
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

/** Key that ties a load issue to the row it describes: raw event name + index in that event's list. */
function matcherKey(event: string, index: number): string {
  return `${event}#${index}`
}

/**
 * The automations that will not run, and why, as attached by the server to the
 * automations.json it returns (empty for older servers that don't send them).
 */
export function parseAutomationLoadIssues(json: unknown): AutomationLoadIssue[] {
  if (!json || typeof json !== 'object') return []
  const raw = (json as Record<string, unknown>)[AUTOMATIONS_LOAD_ISSUES_KEY]
  if (!Array.isArray(raw)) return []
  const issues: AutomationLoadIssue[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const messages = Array.isArray(e.messages) ? e.messages.filter((m): m is string => typeof m === 'string') : []
    if (messages.length === 0) continue
    const issue: AutomationLoadIssue = { messages }
    if (typeof e.event === 'string') issue.event = e.event
    if (typeof e.index === 'number') issue.index = e.index
    if (typeof e.id === 'string') issue.id = e.id
    if (typeof e.name === 'string') issue.name = e.name
    issues.push(issue)
  }
  return issues
}

/**
 * Load issues no listed row shows — the whole file (e.g. not valid JSON), an
 * event whose value isn't a list, an entry that isn't an object. The list puts
 * these in its banner so nothing that won't run goes unexplained.
 */
export function getUnattachedLoadIssues(json: unknown, items: AutomationListItem[]): string[] {
  const listed = new Set(items.map(item => matcherKey(item.event, item.matcherIndex)))
  return parseAutomationLoadIssues(json)
    .filter(issue => issue.event === undefined || issue.index === undefined || !listed.has(matcherKey(issue.event, issue.index)))
    .map((issue) => {
      if (issue.event === undefined) return issue.messages.join(' ')
      const where = `${issue.name ?? issue.event}${issue.index === undefined ? '' : ` #${issue.index + 1}`}`
      return `${where}: ${issue.messages.join(' ')}`
    })
}

/**
 * Parse an automations.json file into a flat list of AutomationListItem[].
 * Each matcher entry under each event becomes one item. Entries the server
 * reports as not running carry `issues`, and are listed even when they have no
 * action the screen can show (e.g. only the removed "command" type).
 */
export function parseAutomationsConfig(json: unknown): AutomationListItem[] {
  if (!json || typeof json !== 'object') return []
  const config = json as AutomationsConfigFile
  const eventMap = config.automations
  if (!eventMap || typeof eventMap !== 'object') return []

  const issuesByMatcher = new Map<string, string[]>()
  for (const issue of parseAutomationLoadIssues(json)) {
    if (issue.event === undefined || issue.index === undefined) continue
    const key = matcherKey(issue.event, issue.index)
    issuesByMatcher.set(key, [...(issuesByMatcher.get(key) ?? []), ...issue.messages])
  }

  const items: AutomationListItem[] = []
  let index = 0

  for (const [eventName, matchers] of Object.entries(eventMap)) {
    if (!Array.isArray(matchers)) continue
    const event = eventName as AutomationTrigger

    for (let matcherIdx = 0; matcherIdx < matchers.length; matcherIdx++) {
      const matcher = matchers[matcherIdx] as AutomationsConfigMatcher | null
      if (!matcher || typeof matcher !== 'object' || Array.isArray(matcher)) continue
      const issues = issuesByMatcher.get(matcherKey(eventName, matcherIdx))

      const actions = (Array.isArray(matcher.actions) ? matcher.actions : []).filter(isKnownAction)
      // Nothing to show: list it only when the server says why it won't run.
      if (actions.length === 0 && !issues) continue

      const rawTopic = (matcher as { telegramTopic?: unknown }).telegramTopic
      const telegramTopic =
        typeof rawTopic === 'string' && rawTopic.trim().length > 0 ? rawTopic.trim() : undefined

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
        conditions: matcher.conditions,
        actions,
        telegramTopic,
        issues,
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
