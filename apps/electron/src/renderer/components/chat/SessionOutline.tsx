/**
 * SessionOutline - Lightweight navigation aid for long sessions.
 *
 * Renders a compact list of turns with short labels (USER, PLAN, EXEC, ERROR, etc.).
 * Supports filtering by type, grouping by type, and expandable related-context per turn.
 * Clicking an item scrolls the chat to the corresponding turn.
 */

import * as React from 'react'
import { useMemo, useState, useCallback } from 'react'
import {
  User,
  Bot,
  Wrench,
  AlertTriangle,
  Info,
  ShieldCheck,
  Lightbulb,
  ChevronRight,
  Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Turn, AssistantTurn } from '@craft-agent/ui'

// ============================================================================
// Turn key generation (mirrors ChatDisplay logic)
// ============================================================================

export function getTurnKey(turn: Turn): string {
  if (turn.type === 'user') return `user-${turn.message.id}`
  if (turn.type === 'system') return `system-${turn.message.id}`
  if (turn.type === 'auth-request') return `auth-${turn.message.id}`
  return `turn-${turn.turnId}-${turn.timestamp}`
}

// ============================================================================
// Filter categories
// ============================================================================

type FilterCategory = 'user' | 'agent' | 'exec' | 'error'

const ALL_FILTERS: FilterCategory[] = ['user', 'agent', 'exec', 'error']

const filterLabels: Record<FilterCategory, string> = {
  user: 'USER',
  agent: 'AGENT',
  exec: 'EXEC',
  error: 'ERROR',
}

function variantToFilter(variant: OutlineEntry['variant']): FilterCategory {
  switch (variant) {
    case 'user': return 'user'
    case 'assistant': case 'plan': case 'system': case 'auth': return 'agent'
    case 'tool': return 'exec'
    case 'error': return 'error'
  }
}

// ============================================================================
// Label generation
// ============================================================================

interface RelatedItem {
  label: string
  icon: React.ReactNode
}

interface OutlineEntry {
  key: string
  turnIndex: number
  icon: React.ReactNode
  prefix: string
  label: string
  variant: 'user' | 'assistant' | 'tool' | 'plan' | 'error' | 'system' | 'auth'
  relatedItems: RelatedItem[]
}

function truncate(text: string, max = 50): string {
  const cleaned = text.replace(/\n/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  return cleaned.slice(0, max) + '…'
}

function extractTextContent(content: string | unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as { type?: string; text?: string }[])
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join(' ')
  }
  return ''
}

function buildRelatedItems(turn: AssistantTurn): RelatedItem[] {
  const items: RelatedItem[] = []
  for (const a of turn.activities) {
    if (a.type === 'tool') {
      const name = a.displayName || a.toolName || 'tool'
      const detail = a.intent ? `: ${truncate(a.intent, 35)}` : ''
      items.push({
        label: `${name}${detail}`,
        icon: a.status === 'error' ? <AlertTriangle size={11} /> : <Wrench size={11} />,
      })
    } else if (a.type === 'thinking') {
      items.push({ label: 'Thinking', icon: <Bot size={11} /> })
    } else if (a.type === 'plan') {
      items.push({ label: 'Plan', icon: <Lightbulb size={11} /> })
    }
  }
  if (turn.response?.text) {
    items.push({ label: truncate(`Response: ${turn.response.text}`, 45), icon: <Bot size={11} /> })
  }
  return items
}

function classifyAssistantTurn(turn: AssistantTurn, turnIndex: number): OutlineEntry {
  const key = getTurnKey(turn)
  const hasError = turn.activities.some(a => a.status === 'error')
  const tools = turn.activities.filter(a => a.type === 'tool')
  const isPlan = turn.response?.isPlan
  const relatedItems = buildRelatedItems(turn)

  if (hasError) {
    const errorActivity = turn.activities.find(a => a.status === 'error')
    const label = errorActivity?.error || errorActivity?.intent || turn.intent || 'failed'
    return { key, turnIndex, icon: <AlertTriangle size={13} />, prefix: 'ERROR', label: truncate(label), variant: 'error', relatedItems }
  }

  if (isPlan) {
    const label = turn.response?.text || turn.intent || 'plan'
    return { key, turnIndex, icon: <Lightbulb size={13} />, prefix: 'PLAN', label: truncate(label), variant: 'plan', relatedItems }
  }

  if (tools.length > 0) {
    const primaryTool = tools[0]
    const toolLabel = primaryTool.displayName || primaryTool.toolName || 'tool'
    const detail = primaryTool.intent || (tools.length > 1 ? `+${tools.length - 1} more` : '')
    return { key, turnIndex, icon: <Wrench size={13} />, prefix: `EXEC (${toolLabel})`, label: truncate(detail), variant: 'tool', relatedItems }
  }

  const label = turn.intent || turn.response?.text || ''
  return { key, turnIndex, icon: <Bot size={13} />, prefix: 'ASSISTANT', label: truncate(label), variant: 'assistant', relatedItems }
}

function buildOutlineEntries(turns: Turn[]): OutlineEntry[] {
  return turns.map((turn, turnIndex) => {
    switch (turn.type) {
      case 'user': {
        const text = extractTextContent(turn.message.content)
        return {
          key: getTurnKey(turn),
          turnIndex,
          icon: <User size={13} />,
          prefix: 'USER',
          label: truncate(text),
          variant: 'user' as const,
          relatedItems: [],
        }
      }
      case 'system': {
        const text = extractTextContent(turn.message.content)
        return {
          key: getTurnKey(turn),
          turnIndex,
          icon: <Info size={13} />,
          prefix: 'SYSTEM',
          label: truncate(text),
          variant: 'system' as const,
          relatedItems: [],
        }
      }
      case 'auth-request':
        return {
          key: getTurnKey(turn),
          turnIndex,
          icon: <ShieldCheck size={13} />,
          prefix: 'AUTH',
          label: turn.message.authSourceName || 'credential request',
          variant: 'auth' as const,
          relatedItems: [],
        }
      case 'assistant':
        return classifyAssistantTurn(turn, turnIndex)
    }
  })
}

// ============================================================================
// Variant styles
// ============================================================================

const variantStyles: Record<OutlineEntry['variant'], string> = {
  user: 'text-blue-500',
  assistant: 'text-foreground/70',
  tool: 'text-amber-500',
  plan: 'text-violet-500',
  error: 'text-destructive',
  system: 'text-muted-foreground',
  auth: 'text-orange-500',
}

// ============================================================================
// Outline Item (with expandable related context)
// ============================================================================

function OutlineItem({
  entry,
  onScrollToTurn,
}: {
  entry: OutlineEntry
  onScrollToTurn: (turnKey: string, turnIndex: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasRelated = entry.relatedItems.length > 0

  return (
    <div>
      <div className="flex items-start min-w-0">
        {/* Related-context toggle */}
        {hasRelated ? (
          <button
            type="button"
            onClick={() => setExpanded(prev => !prev)}
            className="shrink-0 mt-1.5 ml-1 mr-0.5 p-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <ChevronRight size={11} className={cn('transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : (
          <span className="shrink-0 w-[18px]" />
        )}
        {/* Main outline button */}
        <button
          type="button"
          onClick={() => onScrollToTurn(entry.key, entry.turnIndex)}
          className="flex items-start gap-1.5 px-1.5 py-1.5 text-left hover:bg-muted/50 transition-colors rounded-sm min-w-0 flex-1"
        >
          <span className={cn('mt-0.5 shrink-0', variantStyles[entry.variant])}>
            {entry.icon}
          </span>
          <span className="min-w-0 truncate">
            <span className={cn('font-medium', variantStyles[entry.variant])}>{entry.prefix}</span>
            {entry.label && (
              <span className="text-muted-foreground ml-1">{entry.label}</span>
            )}
          </span>
          {hasRelated && (
            <span className="shrink-0 ml-auto text-muted-foreground/40 tabular-nums">{entry.relatedItems.length}</span>
          )}
        </button>
      </div>
      {/* Expanded related items */}
      {expanded && (
        <div className="ml-[18px] pl-2 border-l border-border/30 mb-1">
          {entry.relatedItems.map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onScrollToTurn(entry.key, entry.turnIndex)}
              className="flex items-center gap-1.5 px-1.5 py-1 text-left text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors rounded-sm min-w-0 w-full"
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Group-by-type rendering
// ============================================================================

const groupOrder: FilterCategory[] = ['user', 'agent', 'exec', 'error']

const groupSectionStyles: Record<FilterCategory, string> = {
  user: 'text-blue-500',
  agent: 'text-foreground/70',
  exec: 'text-amber-500',
  error: 'text-destructive',
}

// ============================================================================
// Component
// ============================================================================

interface SessionOutlineProps {
  turns: Turn[]
  onScrollToTurn: (turnKey: string, turnIndex: number) => void
  className?: string
}

export function SessionOutline({ turns, onScrollToTurn, className }: SessionOutlineProps) {
  const entries = useMemo(() => buildOutlineEntries(turns), [turns])
  const [activeFilters, setActiveFilters] = useState<Set<FilterCategory>>(() => new Set(ALL_FILTERS))
  const [groupByType, setGroupByType] = useState(false)

  const toggleFilter = useCallback((filter: FilterCategory) => {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(filter)) {
        // Don't allow deselecting all filters
        if (next.size > 1) next.delete(filter)
      } else {
        next.add(filter)
      }
      return next
    })
  }, [])

  const filtered = useMemo(
    () => entries.filter(e => activeFilters.has(variantToFilter(e.variant))),
    [entries, activeFilters],
  )

  if (entries.length === 0) return null

  return (
    <div className={cn('flex flex-col text-xs overflow-y-auto', className)}>
      {/* Filter bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/30">
        {ALL_FILTERS.map(f => (
          <button
            key={f}
            type="button"
            onClick={() => toggleFilter(f)}
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors border',
              activeFilters.has(f)
                ? 'bg-muted border-border text-foreground'
                : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground',
            )}
          >
            {filterLabels[f]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setGroupByType(prev => !prev)}
          title={groupByType ? 'Chronological order' : 'Group by type'}
          className={cn(
            'ml-auto p-0.5 rounded transition-colors',
            groupByType ? 'text-foreground bg-muted' : 'text-muted-foreground/50 hover:text-muted-foreground',
          )}
        >
          <Layers size={12} />
        </button>
      </div>

      {/* Entries */}
      {groupByType ? (
        // Grouped view
        groupOrder.map(cat => {
          const group = filtered.filter(e => variantToFilter(e.variant) === cat)
          if (group.length === 0) return null
          return (
            <div key={cat}>
              <div className={cn('px-3 pt-2 pb-1 font-semibold text-[10px] uppercase tracking-wider', groupSectionStyles[cat])}>
                {filterLabels[cat]} ({group.length})
              </div>
              {group.map(entry => (
                <OutlineItem key={entry.key} entry={entry} onScrollToTurn={onScrollToTurn} />
              ))}
            </div>
          )
        })
      ) : (
        // Chronological view
        filtered.map(entry => (
          <OutlineItem key={entry.key} entry={entry} onScrollToTurn={onScrollToTurn} />
        ))
      )}
    </div>
  )
}
