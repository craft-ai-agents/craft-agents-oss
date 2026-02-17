/**
 * HooksListPanel
 *
 * Navigator panel for displaying hooks in the 2nd column.
 * Follows the SourcesListPanel pattern with avatar, title, subtitle, badges.
 * Title and Plus button are handled by the shared PanelHeader in AppShell.
 */

import * as React from 'react'
import { useState } from 'react'
import { MoreHorizontal, Webhook, ChevronDown, ChevronRight } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import type { Locale } from 'date-fns'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
} from '@/components/ui/styled-dropdown'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import { DropdownMenuProvider, ContextMenuProvider } from '@/components/ui/menu-context'
import { SessionSearchHeader } from '@/components/app-shell/SessionSearchHeader'
import { HookMenu } from './HookMenu'
import { HookAvatar } from './HookAvatar'
import { HookActionPreview } from './HookActionPreview'
import { cn } from '@/lib/utils'
import { APP_EVENTS, AGENT_EVENTS, getEventDisplayName, type HookListItem, type HookFilter } from './types'

/** Short relative time locale — produces compact strings: "7m", "2h", "3d" */
const shortTimeLocale: Pick<Locale, 'formatDistance'> = {
  formatDistance: (token: string, count: number) => {
    const units: Record<string, string> = {
      xSeconds: `${count}s`,
      xMinutes: `${count}m`,
      xHours: `${count}h`,
      xDays: `${count}d`,
      xWeeks: `${count}w`,
      xMonths: `${count}mo`,
      xYears: `${count}y`,
    }
    return units[token] || `${count}`
  },
}


// ============================================================================
// Hook Item
// ============================================================================

interface HookItemProps {
  hook: HookListItem
  isSelected: boolean
  isFirst: boolean
  onClick: () => void
  onDelete: () => void
  onToggleEnabled: () => void
  onTest: () => void
  onDuplicate: () => void
}

function getActionTypeBadge(hook: HookListItem): { label: string; classes: string } {
  const types = [...new Set(hook.hooks.map(h => h.type))]
  if (types.length === 1) {
    return types[0] === 'command'
      ? { label: 'Command', classes: 'bg-foreground/8 text-foreground/60' }
      : { label: 'Prompt', classes: 'bg-accent/10 text-accent' }
  }
  return { label: 'Mixed', classes: 'bg-foreground/8 text-foreground/60' }
}

function HookItem({
  hook,
  isSelected,
  isFirst,
  onClick,
  onDelete,
  onToggleEnabled,
  onTest,
  onDuplicate,
}: HookItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const actionBadge = getActionTypeBadge(hook)

  return (
    <div className={cn('hook-item', !hook.enabled && 'opacity-50')} data-selected={isSelected || undefined}>
      {/* Separator */}
      {!isFirst && (
        <div className="hook-separator pl-12 pr-4">
          <Separator />
        </div>
      )}

      <ContextMenu modal={true} onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger asChild>
          <div className="hook-content relative group select-none pl-2 mr-2">
            {/* Background wrapper — covers chevron, avatar, button, and expanded content */}
            <div
              className={cn(
                'relative rounded-[8px] transition-all',
                isSelected
                  ? 'bg-foreground/5 hover:bg-foreground/7'
                  : 'hover:bg-foreground/2'
              )}
            >
              {/* Expand chevron — positioned absolutely inside background wrapper */}
              <div
                className="absolute left-[4px] top-3.5 z-10 flex items-center justify-center cursor-pointer p-1 rounded-[4px] hover:bg-foreground/5 transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  setExpanded(!expanded)
                }}
              >
                {expanded ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
              </div>

              {/* Hook Avatar — shifted right to make room for chevron */}
              <div className="absolute left-[24px] top-3.5 z-10 flex items-center justify-center">
                <HookAvatar event={hook.event} size="sm" />
              </div>

              {/* Main content button */}
              <button
                className="flex w-full items-start gap-2 pl-6 pr-4 py-3 text-left text-sm outline-none"
                onClick={onClick}
              >
                {/* Spacer for chevron + avatar */}
                <div className="w-5 h-5 shrink-0" />

                {/* Content column */}
                <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                  {/* Title */}
                  <div className="flex items-start gap-2 w-full pr-6 min-w-0">
                    <div className="font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]">
                      {hook.name}
                    </div>
                  </div>

                  {/* Subtitle: summary */}
                  <div className="flex items-center gap-1.5 text-xs text-foreground/50 w-full -mb-[2px] pr-6 min-w-0">
                    <span className="truncate">{hook.summary}</span>
                  </div>

                  {/* Badges row: event + action type + last ran timestamp */}
                  <div className="flex items-center gap-1.5 -mb-[2px]">
                    <span className={cn(
                      'shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded',
                      'bg-foreground/8 text-foreground/60'
                    )}>
                      {getEventDisplayName(hook.event)}
                    </span>
                    <span className={cn(
                      'shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded',
                      actionBadge.classes
                    )}>
                      {actionBadge.label}
                    </span>
                    {/* Last ran timestamp — bottom right */}
                    {hook.lastExecutedAt && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="shrink-0 ml-auto text-[11px] text-foreground/40 whitespace-nowrap cursor-default">
                            {formatDistanceToNowStrict(new Date(hook.lastExecutedAt), { locale: shortTimeLocale as Locale, roundingMethod: 'floor' })}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={4}>
                          Last ran {formatDistanceToNowStrict(new Date(hook.lastExecutedAt), { addSuffix: true })}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </button>

              {/* Expanded When/Then details */}
              {expanded && (
                <div className="pl-[50px] pr-4 pb-3 space-y-2.5">
                  {/* When */}
                  <div className="space-y-0.5">
                    <h5 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">When</h5>
                    <div className="text-xs text-foreground/70">
                      <span className="font-medium">{getEventDisplayName(hook.event)}</span>
                      {hook.matcher && (
                        <span className="ml-2">
                          matching <code className="font-mono bg-foreground/5 px-1 rounded">{hook.matcher}</code>
                        </span>
                      )}
                      {hook.cron && (
                        <span className="ml-2">
                          at <code className="font-mono bg-foreground/5 px-1 rounded">{hook.cron}</code>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Then */}
                  <div className="space-y-0.5">
                    <h5 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Then</h5>
                    <HookActionPreview actions={hook.hooks} />
                  </div>
                </div>
              )}
            </div>

            {/* Action buttons - visible on hover */}
            <div
              className={cn(
                'absolute right-2 top-2 transition-opacity z-10',
                menuOpen || contextMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
            >
              <div className="flex items-center rounded-[8px] overflow-hidden border border-transparent hover:border-border/50">
                <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <div className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </DropdownMenuTrigger>
                  <StyledDropdownMenuContent align="end">
                    <DropdownMenuProvider>
                      <HookMenu
                        hookId={hook.id}
                        hookName={hook.name}
                        enabled={hook.enabled}
                        onToggleEnabled={onToggleEnabled}
                        onTest={onTest}
                        onDuplicate={onDuplicate}
                        onDelete={onDelete}
                      />
                    </DropdownMenuProvider>
                  </StyledDropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </ContextMenuTrigger>

        {/* Context menu */}
        <StyledContextMenuContent>
          <ContextMenuProvider>
            <HookMenu
              hookId={hook.id}
              hookName={hook.name}
              enabled={hook.enabled}
              onToggleEnabled={onToggleEnabled}
              onTest={onTest}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          </ContextMenuProvider>
        </StyledContextMenuContent>
      </ContextMenu>
    </div>
  )
}

// ============================================================================
// HooksListPanel
// ============================================================================

export interface HooksListPanelProps {
  hooks: HookListItem[]
  hookFilter?: HookFilter | null
  onHookClick: (hookId: string) => void
  onDeleteHook?: (hookId: string) => void
  onToggleHook?: (hookId: string) => void
  onTestHook?: (hookId: string) => void
  onDuplicateHook?: (hookId: string) => void
  selectedHookId?: string | null
  className?: string
}

export function HooksListPanel({
  hooks,
  hookFilter,
  onHookClick,
  onDeleteHook,
  onToggleHook,
  onTestHook,
  onDuplicateHook,
  selectedHookId,
  className,
}: HooksListPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)

  const isSearchMode = searchActive && searchQuery.length >= 2

  // Filter hooks based on sidebar-driven filter (from route)
  const categoryFiltered = React.useMemo(() => {
    const kind = hookFilter?.kind ?? 'all'
    if (kind === 'all') return hooks
    if (kind === 'scheduled') return hooks.filter(h => h.event === 'SchedulerTick')
    if (kind === 'app') return hooks.filter(h => (APP_EVENTS as string[]).includes(h.event) && h.event !== 'SchedulerTick')
    if (kind === 'agent') return hooks.filter(h => (AGENT_EVENTS as string[]).includes(h.event))
    return hooks
  }, [hooks, hookFilter?.kind])

  // Further filter by search query (name, summary, event display name)
  const filteredHooks = React.useMemo(() => {
    if (!isSearchMode) return categoryFiltered
    const q = searchQuery.toLowerCase()
    return categoryFiltered.filter(h =>
      h.name.toLowerCase().includes(q) ||
      h.summary.toLowerCase().includes(q) ||
      getEventDisplayName(h.event).toLowerCase().includes(q)
    )
  }, [categoryFiltered, isSearchMode, searchQuery])

  // Empty state
  if (hooks.length === 0) {
    return (
      <div className={cn('flex flex-col flex-1 min-h-0', className)}>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Webhook />
            </EmptyMedia>
            <EmptyTitle>No tasks configured</EmptyTitle>
            <EmptyDescription>
              Tasks run actions when events occur — execute commands on schedules,
              react to label changes, or trigger prompts automatically.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      {/* Search header */}
      {searchActive && (
        <SessionSearchHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchClose={() => {
            setSearchActive(false)
            setSearchQuery('')
          }}
          placeholder="Search tasks..."
          resultCount={isSearchMode ? filteredHooks.length : undefined}
        />
      )}

      {/* Filtered empty state */}
      {filteredHooks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <p className="text-sm text-muted-foreground">
            {isSearchMode ? 'No tasks found' : 'No tasks configured.'}
          </p>
          {isSearchMode && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs text-foreground hover:underline"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="pb-2">
            <div className="pt-1">
              {filteredHooks.map((hook, index) => (
                <HookItem
                  key={hook.id}
                  hook={hook}
                  isSelected={selectedHookId === hook.id}
                  isFirst={index === 0}
                  onClick={() => onHookClick(hook.id)}
                  onDelete={() => onDeleteHook?.(hook.id)}
                  onToggleEnabled={() => onToggleHook?.(hook.id)}
                  onTest={() => onTestHook?.(hook.id)}
                  onDuplicate={() => onDuplicateHook?.(hook.id)}
                />
              ))}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
