/**
 * buildFlowDiagram
 *
 * Generates a Mermaid `graph LR` string that visualizes an automation's pipeline:
 * Event → Conditions (with logic gates) → Actions.
 *
 * Uses digital logic gate shapes (AND = hexagon, OR/NOT = circles) with a distinct
 * color palette per element role.
 */

import type { AutomationListItem, AutomationConditionUI, AutomationAction } from './types'
import { getEventDisplayName } from './types'

// ============================================================================
// Constants
// ============================================================================

const MAX_CONDITION_NODES = 4
const MAX_ACTION_NODES = 4
const MAX_LABEL_LENGTH = 30

// Color palette — classDef definitions
const CLASS_DEFS = [
  'classDef trigger fill:#a78bfa,color:#000,stroke:#7c3aed',
  'classDef condition fill:#4ade80,color:#000,stroke:#22c55e',
  'classDef andGate fill:#60a5fa,color:#000,stroke:#3b82f6',
  'classDef orGate fill:#fb923c,color:#000,stroke:#f97316',
  'classDef notGate fill:#f87171,color:#000,stroke:#ef4444',
  'classDef action fill:#f472b6,color:#000,stroke:#ec4899',
].join('\n    ')

const CONDS_STYLE = 'style CONDS fill:#f0fdf4,stroke:#86efac,color:#166534'

// ============================================================================
// Helpers
// ============================================================================

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

/** Escape characters that can break Mermaid labels */
function esc(str: string): string {
  return str
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/"/g, "'")
    .replace(/[\[\](){}|#&;<>`\\]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function describeTimeCondition(c: { after?: string; before?: string; weekday?: string[] }): string {
  const parts: string[] = []
  if (c.after && c.before) {
    parts.push(`${c.after}–${c.before}`)
  } else if (c.after) {
    parts.push(`after ${c.after}`)
  } else if (c.before) {
    parts.push(`before ${c.before}`)
  }
  if (c.weekday?.length) {
    parts.push(c.weekday.join(', '))
  }
  return parts.join(' ') || 'time condition'
}

function describeStateCondition(c: { field: string; value?: unknown; from?: unknown; to?: unknown; contains?: string; not_value?: unknown }): string {
  if (c.from !== undefined && c.to !== undefined) return `${c.field}: ${String(c.from)} → ${String(c.to)}`
  if (c.to !== undefined) return `${c.field} → ${String(c.to)}`
  if (c.from !== undefined) return `${c.field} from ${String(c.from)}`
  if (c.value !== undefined) return `${c.field} = ${String(c.value)}`
  if (c.not_value !== undefined) return `${c.field} ≠ ${String(c.not_value)}`
  if (c.contains) return `${c.field} ∋ ${c.contains}`
  return c.field
}

function describeAction(action: AutomationAction): string {
  if (action.type === 'prompt') {
    const mentionMatch = action.prompt.match(/@(\S+)/)
    if (mentionMatch) return `Prompt @${mentionMatch[1]}`
    return truncate(action.prompt, MAX_LABEL_LENGTH)
  }
  return `${action.method ?? 'POST'} webhook`
}

// ============================================================================
// Condition Tree → Mermaid Nodes
// ============================================================================

interface DiagramState {
  lines: string[]
  nodeClasses: Map<string, string>  // nodeId → classDef name
  nextId: number
}

function nextNodeId(state: DiagramState, prefix: string): string {
  return `${prefix}${state.nextId++}`
}

/**
 * Walk the condition tree, emitting Mermaid node definitions and edges.
 * Returns the ID of the "output" node (the one that feeds into the parent gate or actions).
 */
function emitConditionTree(
  conditions: AutomationConditionUI[],
  state: DiagramState,
  depth: number,
): string {
  if (depth > 8) return '' // safety cap

  // Top-level array is always an implicit AND
  if (conditions.length === 1) {
    return emitSingleCondition(conditions[0], state, depth)
  }

  // Multiple conditions → implicit AND gate
  const andId = nextNodeId(state, 'AND')
  state.lines.push(`        ${andId}{{"AND"}}`)
  state.nodeClasses.set(andId, 'andGate')

  const displayed = conditions.slice(0, MAX_CONDITION_NODES)
  const remaining = conditions.length - displayed.length

  for (const cond of displayed) {
    const childId = emitSingleCondition(cond, state, depth)
    if (childId) state.lines.push(`        ${childId} --> ${andId}`)
  }

  if (remaining > 0) {
    const moreId = nextNodeId(state, 'CM')
    state.lines.push(`        ${moreId}["...and ${remaining} more"]`)
    state.nodeClasses.set(moreId, 'condition')
    state.lines.push(`        ${moreId} --> ${andId}`)
  }

  return andId
}

function emitSingleCondition(
  cond: AutomationConditionUI,
  state: DiagramState,
  depth: number,
): string {
  if (cond.condition === 'and' || cond.condition === 'or' || cond.condition === 'not') {
    return emitLogicalCondition(cond, state, depth)
  }

  // Leaf condition (time or state)
  const id = nextNodeId(state, 'C')
  const label = cond.condition === 'time'
    ? describeTimeCondition(cond)
    : describeStateCondition(cond as { field: string; value?: unknown; from?: unknown; to?: unknown; contains?: string; not_value?: unknown })
  state.lines.push(`        ${id}["${esc(truncate(label, MAX_LABEL_LENGTH))}"]`)
  state.nodeClasses.set(id, 'condition')
  return id
}

function emitLogicalCondition(
  cond: { condition: 'and' | 'or' | 'not'; conditions: AutomationConditionUI[] },
  state: DiagramState,
  depth: number,
): string {
  const gateType = cond.condition.toUpperCase()
  const gateId = nextNodeId(state, gateType)

  if (cond.condition === 'and') {
    state.lines.push(`        ${gateId}{{"AND"}}`)
    state.nodeClasses.set(gateId, 'andGate')
  } else if (cond.condition === 'or') {
    state.lines.push(`        ${gateId}(("OR"))`)
    state.nodeClasses.set(gateId, 'orGate')
  } else {
    state.lines.push(`        ${gateId}(("NOT"))`)
    state.nodeClasses.set(gateId, 'notGate')
  }

  const children = cond.conditions.slice(0, MAX_CONDITION_NODES)
  const remaining = cond.conditions.length - children.length

  for (const child of children) {
    const childId = emitSingleCondition(child, state, depth + 1)
    if (childId) state.lines.push(`        ${childId} --> ${gateId}`)
  }

  if (remaining > 0) {
    const moreId = nextNodeId(state, 'CM')
    state.lines.push(`        ${moreId}["...and ${remaining} more"]`)
    state.nodeClasses.set(moreId, 'condition')
    state.lines.push(`        ${moreId} --> ${gateId}`)
  }

  return gateId
}

// ============================================================================
// Main
// ============================================================================

/**
 * Build a Mermaid flow diagram for an automation.
 * Returns the mermaid source string, or null if the automation has no meaningful flow.
 */
export function buildFlowDiagram(automation: AutomationListItem): string | null {
  if (automation.actions.length === 0) return null

  const state: DiagramState = {
    lines: [],
    nodeClasses: new Map(),
    nextId: 0,
  }

  // --- Trigger node ---
  const triggerLabel = esc(truncate(getEventDisplayName(automation.event), MAX_LABEL_LENGTH))
  const matcherLabel = automation.matcher
    ? `|"${esc(truncate(automation.matcher, MAX_LABEL_LENGTH))}"|`
    : ''

  // --- Action nodes ---
  const actionIds: string[] = []
  const displayedActions = automation.actions.slice(0, MAX_ACTION_NODES)
  const remainingActions = automation.actions.length - displayedActions.length

  for (const action of displayedActions) {
    const id = nextNodeId(state, 'A')
    actionIds.push(id)
    state.nodeClasses.set(id, 'action')
  }
  if (remainingActions > 0) {
    const id = nextNodeId(state, 'AM')
    actionIds.push(id)
    state.nodeClasses.set(id, 'action')
  }

  const hasConditions = automation.conditions && automation.conditions.length > 0

  // --- Build diagram ---
  const lines: string[] = ['graph LR']

  if (hasConditions) {
    // Emit conditions inside a subgraph
    const condState: DiagramState = {
      lines: [],
      nodeClasses: new Map(),
      nextId: state.nextId,
    }

    const outputId = emitConditionTree(automation.conditions!, condState, 0)
    state.nextId = condState.nextId

    // Merge node classes
    for (const [k, v] of condState.nodeClasses) state.nodeClasses.set(k, v)

    lines.push(`    E["${triggerLabel}"]`)
    lines.push(`    subgraph CONDS["Conditions"]`)
    lines.push(`        direction LR`)
    lines.push(...condState.lines)
    lines.push(`    end`)

    if (outputId) {
      // Explicit trigger → condition-tree root path
      lines.push(`    E -->${matcherLabel} ${outputId}`)

      // Output gate → actions
      for (let i = 0; i < displayedActions.length; i++) {
        lines.push(`    ${outputId} --> ${actionIds[i]}["${esc(truncate(describeAction(displayedActions[i]), MAX_LABEL_LENGTH))}"]`)
      }
      if (remainingActions > 0) {
        lines.push(`    ${outputId} --> ${actionIds[actionIds.length - 1]}["...and ${remainingActions} more"]`)
      }
    }
  } else {
    // No conditions — direct trigger → actions
    if (automation.actions.length === 1) {
      lines.push(`    E["${triggerLabel}"] -->${matcherLabel} ${actionIds[0]}["${esc(truncate(describeAction(displayedActions[0]), MAX_LABEL_LENGTH))}"]`)
    } else {
      lines.push(`    E["${triggerLabel}"]`)
      for (let i = 0; i < displayedActions.length; i++) {
        lines.push(`    E -->${matcherLabel} ${actionIds[i]}["${esc(truncate(describeAction(displayedActions[i]), MAX_LABEL_LENGTH))}"]`)
      }
      if (remainingActions > 0) {
        lines.push(`    E -->${matcherLabel} ${actionIds[actionIds.length - 1]}["...and ${remainingActions} more"]`)
      }
    }
  }

  // --- classDef & class assignments ---
  lines.push(`    ${CLASS_DEFS}`)
  lines.push(`    class E trigger`)

  // Group nodeClasses by class name for compact output
  const byClass = new Map<string, string[]>()
  for (const [nodeId, cls] of state.nodeClasses) {
    const arr = byClass.get(cls) ?? []
    arr.push(nodeId)
    byClass.set(cls, arr)
  }
  for (const [cls, ids] of byClass) {
    lines.push(`    class ${ids.join(',')} ${cls}`)
  }

  if (hasConditions) {
    lines.push(`    ${CONDS_STYLE}`)
  }

  return lines.join('\n')
}
