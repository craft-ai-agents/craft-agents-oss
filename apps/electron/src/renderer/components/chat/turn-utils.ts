/**
 * turn-utils.ts
 *
 * Utilities for grouping messages by turn for TurnCard rendering.
 * Converts the flat Message[] array into grouped turns for email-like display.
 */

import type { Message } from '../../../shared/types'
import type { ActivityItem, ActivityStatus, ActivityType, ResponseContent, TodoItem } from './TurnCard'

// ============================================================================
// Types
// ============================================================================

/** Represents one complete assistant turn */
export interface AssistantTurn {
  type: 'assistant'
  turnId: string
  activities: ActivityItem[]
  response?: ResponseContent
  intent?: string
  isStreaming: boolean
  isComplete: boolean
  timestamp: number
  /** Extracted from TodoWrite tool - latest todo state in this turn */
  todos?: TodoItem[]
}

/** Represents a user message */
export interface UserTurn {
  type: 'user'
  message: Message
  timestamp: number
}

/** Represents a system/info/error message that stands alone */
export interface SystemTurn {
  type: 'system'
  message: Message
  timestamp: number
}

/** Represents a plan message for review */
export interface PlanTurn {
  type: 'plan'
  message: Message
  timestamp: number
}

export type Turn = AssistantTurn | UserTurn | SystemTurn | PlanTurn

// ============================================================================
// Helper Functions
// ============================================================================

/** Convert tool status from message to ActivityStatus */
function getToolStatus(message: Message): ActivityStatus {
  if (message.isError) return 'error'
  // Check explicit toolStatus first (set by tool_result handler)
  if (message.toolStatus === 'completed') return 'completed'
  // Fallback: check if toolResult exists (handles empty string results)
  if (message.toolResult !== undefined) return 'completed'
  if (message.toolStatus === 'pending') return 'pending'
  return 'running'
}

/**
 * Convert message to ActivityItem with incremental depth calculation.
 * Depth is calculated immediately using existing activities, enabling
 * correct tree view rendering during streaming (not just on flush).
 *
 * @param message - The message to convert
 * @param existingActivities - Activities already in the turn (for depth lookup)
 */
function messageToActivity(message: Message, existingActivities: ActivityItem[] = []): ActivityItem {
  const activity: ActivityItem = {
    id: message.id,
    type: 'tool' as ActivityType,
    status: getToolStatus(message),
    toolName: message.toolName,
    toolUseId: message.toolUseId,  // For parent-child matching
    toolInput: message.toolInput,
    content: message.toolResult || message.content,
    intent: message.toolIntent,
    displayName: message.toolDisplayName,  // LLM-generated human-friendly name
    timestamp: message.timestamp,
    error: message.isError ? message.content : undefined,
    // parentId: The toolUseId of the parent tool (e.g., Task subagent).
    // This is tracked by session manager's parentToolStack, NOT the SDK's
    // parent_tool_use_id which is for result-matching, not hierarchy.
    parentId: message.parentToolUseId,
  }

  // Calculate depth incrementally using existing activities
  // This enables correct tree view rendering during streaming
  if (activity.parentId) {
    const parent = existingActivities.find(a => a.toolUseId === activity.parentId)
    activity.depth = parent ? (parent.depth || 0) + 1 : 1
  } else {
    activity.depth = 0
  }

  return activity
}

/**
 * Calculate nesting depths for activities based on parent-child relationships.
 * Modifies activities in place, adding depth field (0 = root, 1 = child, etc.)
 *
 * Note: With incremental depth calculation in messageToActivity(), this function
 * serves as a safety net for edge cases (e.g., parent arrives after child) and
 * ensures all depths are correctly set when a turn is flushed.
 */
function calculateActivityDepths(activities: ActivityItem[]): void {
  // Build a map of toolUseId -> activity for fast parent lookup
  const toolIdToActivity = new Map<string, ActivityItem>()
  for (const activity of activities) {
    if (activity.toolUseId) {
      toolIdToActivity.set(activity.toolUseId, activity)
    }
  }

  // Calculate depth for each activity (recalculates to handle edge cases)
  for (const activity of activities) {
    let depth = 0
    let parentId = activity.parentId

    // Walk up the parent chain, max 10 levels to prevent infinite loops
    while (parentId && depth < 10) {
      depth++
      const parent = toolIdToActivity.get(parentId)
      parentId = parent?.parentId
    }

    activity.depth = depth
  }
}

// ============================================================================
// TodoWrite Extraction
// ============================================================================

/**
 * Extract todos from TodoWrite tool results in activities.
 * Returns the latest todo state (from the most recent TodoWrite call).
 */
function extractTodosFromActivities(activities: ActivityItem[]): TodoItem[] | undefined {
  // Find all TodoWrite tool results, get the latest one
  const todoWriteActivities = activities
    .filter(a => a.toolName === 'TodoWrite' && a.status === 'completed' && a.content)
    .sort((a, b) => b.timestamp - a.timestamp) // Most recent first

  if (todoWriteActivities.length === 0) return undefined

  const latestResult = todoWriteActivities[0].content
  if (!latestResult) return undefined

  try {
    // TodoWrite result is typically a success message, but the input contains the todos
    // We need to get the toolInput which has the todos array
    const input = todoWriteActivities[0].toolInput
    if (input && Array.isArray(input.todos)) {
      return input.todos.map((todo: { content: string; status: string; activeForm?: string }) => ({
        content: todo.content,
        status: todo.status as 'pending' | 'in_progress' | 'completed',
        activeForm: todo.activeForm,
      }))
    }
  } catch {
    // Failed to parse, return undefined
  }

  return undefined
}

// ============================================================================
// Main Grouping Function
// ============================================================================

/**
 * Groups messages into turns for TurnCard rendering
 *
 * Rules:
 * - User messages flush and start fresh context
 * - Tool messages + intermediate assistant messages belong to current turn
 * - Final assistant message (non-streaming, non-intermediate) flushes the turn
 * - Error/status/info messages are standalone system turns
 *
 * Note: We intentionally ignore turnId for grouping. The SDK generates a new
 * turnId for each API message, but from a user perspective, all work between
 * a user message and the final response should be ONE turn. We use isIntermediate
 * as the signal: isIntermediate=true means more work coming, isIntermediate=false
 * means final response.
 */
export function groupMessagesByTurn(messages: Message[]): Turn[] {
  const turns: Turn[] = []
  let currentTurn: AssistantTurn | null = null

  const flushCurrentTurn = (interrupted = false) => {
    if (currentTurn) {
      // Sort activities by timestamp to ensure correct chronological order
      // This is necessary because buffering can delay when messages are added
      // to the array, causing commentary to appear after tools that started later
      currentTurn.activities.sort((a, b) => a.timestamp - b.timestamp)

      // Calculate nesting depths for parent-child tool relationships
      calculateActivityDepths(currentTurn.activities)

      // Extract todos from TodoWrite tool results
      currentTurn.todos = extractTodosFromActivities(currentTurn.activities)

      // If interrupted, mark any running activities as error
      if (interrupted) {
        currentTurn.activities = currentTurn.activities.map(activity =>
          activity.status === 'running'
            ? { ...activity, status: 'error' as ActivityStatus, error: 'Interrupted' }
            : activity
        )
        currentTurn.isStreaming = false
        currentTurn.isComplete = true
      }
      turns.push(currentTurn)
      currentTurn = null
    }
  }

  for (const message of messages) {
    // User messages are their own turn
    if (message.role === 'user') {
      flushCurrentTurn()
      turns.push({
        type: 'user',
        message,
        timestamp: message.timestamp,
      })
      continue
    }

    // Error/status/info/warning messages are standalone
    if (message.role === 'error' || message.role === 'status' || message.role === 'info' || message.role === 'warning') {
      // Flush current turn first (mark as interrupted if info message)
      const isInterruption = message.role === 'info'
      flushCurrentTurn(isInterruption)
      turns.push({
        type: 'system',
        message,
        timestamp: message.timestamp,
      })
      continue
    }

    // Plan messages are standalone (for plan review)
    if (message.role === 'plan') {
      flushCurrentTurn()
      turns.push({
        type: 'plan',
        message,
        timestamp: message.timestamp,
      })
      continue
    }

    // Tool messages belong to current assistant turn
    if (message.role === 'tool') {
      // Tool is complete if toolStatus is 'completed' OR toolResult exists
      const isToolComplete = message.toolStatus === 'completed' || message.toolResult !== undefined
      if (!currentTurn) {
        // Start a new turn
        currentTurn = {
          type: 'assistant',
          turnId: message.turnId || message.id,
          activities: [],
          response: undefined,
          intent: message.toolIntent,
          isStreaming: !isToolComplete,
          isComplete: false,
          timestamp: message.timestamp,
        }
      }
      // Always add to current turn (ignoring turnId differences)
      // Pass existing activities for incremental depth calculation
      currentTurn.activities.push(messageToActivity(message, currentTurn.activities))
      currentTurn.isStreaming = !isToolComplete
      continue
    }

    // Assistant messages are the response part of a turn
    if (message.role === 'assistant') {
      // Intermediate messages OR pending messages (don't know yet) are activities, not responses
      // Pending: streaming text where we don't yet know if it's intermediate - treat as intermediate
      // until text_complete arrives with the definitive isIntermediate flag
      if (message.isIntermediate || message.isPending) {
        if (!currentTurn) {
          // Start a new turn for this intermediate message
          currentTurn = {
            type: 'assistant',
            turnId: message.turnId || message.id,
            activities: [],
            response: undefined,
            intent: undefined,
            isStreaming: !!message.isPending,
            isComplete: false,
            timestamp: message.timestamp,
          }
        }
        // Always add to current turn as activity (ignoring turnId differences)
        // Pending messages show as 'running' until we know they're complete
        // Include parentId for intermediate messages to support nesting within subagents
        const intermediateActivity: ActivityItem = {
          id: message.id,
          type: 'intermediate',
          status: message.isPending ? 'running' : 'completed',
          content: message.content,
          timestamp: message.timestamp,
          parentId: message.parentToolUseId,
        }
        // Calculate depth for intermediate messages too
        if (intermediateActivity.parentId) {
          const parent = currentTurn.activities.find(a => a.toolUseId === intermediateActivity.parentId)
          intermediateActivity.depth = parent ? (parent.depth || 0) + 1 : 1
        } else {
          intermediateActivity.depth = 0
        }
        currentTurn.activities.push(intermediateActivity)
        continue
      }

      // Non-intermediate assistant message = final response
      if (!currentTurn) {
        // This is a response-only turn (no tools)
        currentTurn = {
          type: 'assistant',
          turnId: message.turnId || message.id,
          activities: [],
          response: undefined,
          intent: undefined,
          isStreaming: !!message.isStreaming,
          isComplete: !message.isStreaming,
          timestamp: message.timestamp,
        }
      }

      // Set as response on current turn (ignoring turnId differences)
      currentTurn.response = {
        text: message.content,
        isStreaming: !!message.isStreaming,
        streamStartTime: message.isStreaming ? message.timestamp : undefined,
      }
      currentTurn.isStreaming = !!message.isStreaming
      currentTurn.isComplete = !message.isStreaming

      // Flush when turn is complete (non-streaming = final response received)
      if (!message.isStreaming) {
        flushCurrentTurn()
      }
      continue
    }
  }

  // Flush any remaining turn
  flushCurrentTurn()

  return turns
}

/**
 * Get the primary intent for a turn (first available intent from activities)
 */
export function getTurnIntent(turn: AssistantTurn): string | undefined {
  // First check explicit turn intent
  if (turn.intent) return turn.intent

  // Then look for activity intents
  for (const activity of turn.activities) {
    if (activity.intent) return activity.intent
  }

  return undefined
}

/**
 * Check if any activity in the turn is still running
 */
export function hasPendingActivities(turn: AssistantTurn): boolean {
  return turn.activities.some(a => a.status === 'running' || a.status === 'pending')
}

/**
 * Check if any activity in the turn has an error
 */
export function hasErrorActivities(turn: AssistantTurn): boolean {
  return turn.activities.some(a => a.status === 'error')
}

/**
 * Get a summary of completed activities
 */
export function getActivitySummary(turn: AssistantTurn): string {
  const completed = turn.activities.filter(a => a.status === 'completed').length
  const running = turn.activities.filter(a => a.status === 'running').length
  const errors = turn.activities.filter(a => a.status === 'error').length

  const parts: string[] = []
  if (running > 0) parts.push(`${running} running`)
  if (completed > 0) parts.push(`${completed} completed`)
  if (errors > 0) parts.push(`${errors} failed`)

  return parts.join(', ') || 'No activities'
}

/**
 * Format an AssistantTurn as markdown for detailed viewing in Monaco
 * Shows full tool inputs, results, and response
 */
export function formatTurnAsMarkdown(turn: AssistantTurn): string {
  const lines: string[] = []

  // Header with intent if available
  if (turn.intent) {
    lines.push(`# ${turn.intent}`)
  } else {
    lines.push('# Turn Details')
  }
  lines.push('')

  // Summary
  const summary = getActivitySummary(turn)
  lines.push(`**Status:** ${turn.isComplete ? 'Complete' : 'In Progress'} · ${summary}`)
  lines.push('')

  // Activities section
  if (turn.activities.length > 0) {
    lines.push('---')
    lines.push('')
    lines.push('## Activities')
    lines.push('')

    for (const activity of turn.activities) {
      if (activity.type === 'intermediate') {
        // Intermediate text (thinking/commentary)
        lines.push(`### 💭 Commentary`)
        lines.push('')
        if (activity.content) {
          lines.push(activity.content)
        }
        lines.push('')
      } else if (activity.toolName) {
        // Tool call
        const statusEmoji = activity.status === 'completed' ? '✅' :
                           activity.status === 'error' ? '❌' :
                           activity.status === 'running' ? '⏳' : '⏸️'

        lines.push(`### ${statusEmoji} ${activity.toolName}`)
        lines.push('')

        // Intent if available
        if (activity.intent) {
          lines.push(`> ${activity.intent}`)
          lines.push('')
        }

        // Input
        if (activity.toolInput && Object.keys(activity.toolInput).length > 0) {
          lines.push('**Input:**')
          lines.push('```json')
          lines.push(JSON.stringify(activity.toolInput, null, 2))
          lines.push('```')
          lines.push('')
        }

        // Result/Output
        if (activity.content) {
          lines.push('**Result:**')
          // Check if result looks like JSON
          const trimmed = activity.content.trim()
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(trimmed)
              lines.push('```json')
              lines.push(JSON.stringify(parsed, null, 2))
              lines.push('```')
            } catch {
              // Not valid JSON, show as text
              lines.push('```')
              lines.push(activity.content)
              lines.push('```')
            }
          } else {
            lines.push('```')
            lines.push(activity.content)
            lines.push('```')
          }
          lines.push('')
        }

        // Error if present
        if (activity.error) {
          lines.push('**Error:**')
          lines.push('```')
          lines.push(activity.error)
          lines.push('```')
          lines.push('')
        }
      }
    }
  }

  // Response section
  if (turn.response?.text) {
    lines.push('---')
    lines.push('')
    lines.push('## Response')
    lines.push('')
    lines.push(turn.response.text)
  }

  return lines.join('\n')
}

/**
 * Format a single ActivityItem as markdown for detailed viewing in Monaco
 */
export function formatActivityAsMarkdown(activity: ActivityItem): string {
  const lines: string[] = []

  if (activity.type === 'intermediate') {
    // Commentary/thinking
    lines.push('# Commentary')
    lines.push('')
    if (activity.content) {
      lines.push(activity.content)
    }
    return lines.join('\n')
  }

  // Tool activity
  const statusEmoji = activity.status === 'completed' ? '✅' :
                     activity.status === 'error' ? '❌' :
                     activity.status === 'running' ? '⏳' : '⏸️'

  lines.push(`# ${statusEmoji} ${activity.toolName || 'Tool'}`)
  lines.push('')

  // Intent if available
  if (activity.intent) {
    lines.push(`> ${activity.intent}`)
    lines.push('')
  }

  // Input
  if (activity.toolInput && Object.keys(activity.toolInput).length > 0) {
    lines.push('## Input')
    lines.push('')
    lines.push('```json')
    lines.push(JSON.stringify(activity.toolInput, null, 2))
    lines.push('```')
    lines.push('')
  }

  // Result/Output
  if (activity.content) {
    lines.push('## Result')
    lines.push('')
    // Check if result looks like JSON
    const trimmed = activity.content.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        lines.push('```json')
        lines.push(JSON.stringify(parsed, null, 2))
        lines.push('```')
      } catch {
        // Not valid JSON, show as text
        lines.push('```')
        lines.push(activity.content)
        lines.push('```')
      }
    } else {
      lines.push('```')
      lines.push(activity.content)
      lines.push('```')
    }
    lines.push('')
  }

  // Error if present
  if (activity.error) {
    lines.push('## Error')
    lines.push('')
    lines.push('```')
    lines.push(activity.error)
    lines.push('```')
  }

  return lines.join('\n')
}

// ============================================================================
// Last Turn/Message Utilities
// ============================================================================

/**
 * Get the last assistant turn from a list of turns.
 * Useful for determining the current/most recent assistant response.
 */
export function getLastAssistantTurn(turns: Turn[]): AssistantTurn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].type === 'assistant') {
      return turns[i] as AssistantTurn
    }
  }
  return undefined
}

/**
 * Get the timestamp of the last user message from turns.
 * Useful for calculating elapsed time since user sent their message.
 */
export function getLastUserMessageTime(turns: Turn[]): number | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].type === 'user') {
      return (turns[i] as UserTurn).timestamp
    }
  }
  return undefined
}

/**
 * Check if the last assistant turn is still streaming/processing.
 */
export function isLastTurnStreaming(turns: Turn[]): boolean {
  const lastAssistant = getLastAssistantTurn(turns)
  return lastAssistant?.isStreaming ?? false
}

/**
 * Pre-compute which activities are the last child at their depth level.
 * Returns a Set of activity IDs that are last children.
 * This is O(n) instead of O(n²) for checking during render.
 */
export function computeLastChildSet(activities: ActivityItem[]): Set<string> {
  // Track the last activity for each parentId
  const lastByParent = new Map<string | undefined, string>()

  for (const activity of activities) {
    if (activity.depth && activity.depth > 0) {
      // This activity has a parent - mark it as the (potentially) last child
      lastByParent.set(activity.parentId, activity.id)
    }
  }

  return new Set(lastByParent.values())
}
