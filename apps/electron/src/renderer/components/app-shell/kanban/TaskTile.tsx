import * as React from 'react'
import { Check, ChevronDown, ChevronRight, Clock, Flag, MessageSquare, Pencil, Play, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { formatDistanceToNowStrict, type Locale } from 'date-fns'
import { DEFAULT_MODEL, getModelShortName } from '@config/models'
import { cn } from '@/lib/utils'
import { getProviderIcon } from '@/lib/provider-icons'
import { shortTimeLocale } from '@/utils/session'
import { kanbanLivePulseAtom } from '@/atoms/kanban'
import { useKanbanColumnColors } from '@/hooks/useKanbanColumnColors'
import type { ProjectColorTreatment } from '@/utils/project-colors'
import type { SessionStatus } from '@/config/session-status-config'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'
import { SessionStatusMenu } from '@/components/ui/session-status-menu'
import { StatusBadge } from './StatusBadge'
import { ModelChip } from './ModelChip'
import { SubtaskRow } from './SubtaskRow'
import { SubtaskProgress } from './SubtaskProgress'
import type { KanbanModelProviderGroup, KanbanProject, KanbanTask } from './types'

/**
 * Brand icon for a provider key. Providers with a bundled SVG (anthropic,
 * openai) resolve directly; others (google, mistral, xai, groq, deepseek, …)
 * resolve through the Pi auth-provider path, which covers both the remaining
 * SVGs and the favicon fallback for icon-less providers.
 */
function resolveProviderIcon(provider: string): string | null {
  return getProviderIcon(provider) ?? getProviderIcon('pi', null, provider)
}

interface TaskTileProps {
  task: KanbanTask
  /** Project the task is bound to (colors the tile). */
  project?: KanbanProject
  /** Resolved status for the badge. */
  status?: SessionStatus
  /** Ordered workspace statuses for the status picker. */
  statuses?: SessionStatus[]
  /** Change this task's status. When set (with `statuses`), the badge opens a picker. */
  onStatusChange?: (statusId: string) => void
  /** How the project color is drawn. Mirrors the SessionList project-color treatment. */
  treatment: ProjectColorTreatment
  /** Whether the subtask list is expanded. */
  expanded: boolean
  /** Open the task (focused chat window). */
  onClick?: () => void
  /** Open the full-pane editor for this task (edit mode). Enables the right-click "Edit task" item. */
  onEdit?: () => void
  /** Toggle the subtask list. */
  onToggleSubtasks?: () => void
  /** Open a spawned subtask's session window. */
  onSubtaskClick?: (subtaskId: string) => void
  /** Spawn a new subtask from a typed title, routed to the chosen model. */
  onAddSubtask?: (title: string, model: string) => void
  /** Run all pending (created-but-not-yet-dispatched) subtasks. Shows the Play button when set. */
  onRunSubtasks?: () => void
  /** Provider→model catalog for the "Add subtask" composer's picker. */
  subtaskModelGroups?: KanbanModelProviderGroup[]
  /** Model id pre-selected in the composer (defaults to the first catalog model). */
  defaultSubtaskModel?: string
}

/**
 * A parent-session ("Task") tile.
 *
 * Project color is drawn directly on the card: a full-height 3px leading stripe
 * plus an optional ~6% tint (same `color-mix` formula as
 * `SessionProjectColorWrapper`, applied on the card because a tile is an opaque
 * surface rather than a transparent list row).
 */
export function TaskTile({
  task,
  project,
  status,
  statuses,
  onStatusChange,
  treatment,
  expanded,
  onClick,
  onEdit,
  onToggleSubtasks,
  onSubtaskClick,
  onAddSubtask,
  onRunSubtasks,
  subtaskModelGroups,
  defaultSubtaskModel,
}: TaskTileProps) {
  const { t } = useTranslation()
  const livePulseEnabled = useAtomValue(kanbanLivePulseAtom)
  const columnColors = useKanbanColumnColors()
  const accent = columnColors.get(task.column)?.solid ?? 'var(--primary)'

  const color = project?.color ?? null
  const showStripe = !!color
  const showTint = !!color && treatment === 'stripe-tint'
  const subtaskCount = task.subtasks.length
  // Play runs a spec-backed task's whole DAG (pending rows count even without a session —
  // the Conductor creates them), but only dispatches session-backed rows on plain tiles.
  // Disabled while anything is in flight: a second Conductor run would be refused anyway.
  const hasRunningSubtasks = task.subtasks.some(s => s.runState === 'running')
  const canRunSubtasks =
    !hasRunningSubtasks &&
    !task.isProcessing &&
    task.subtasks.some(s => s.runState === 'pending' && (task.taskSlug ? true : !!s.sessionId))

  // Live treatment: an in-flight turn on a tile parked in the active column,
  // gated by the user's live-pulse preference.
  const isLive = livePulseEnabled && !!task.isProcessing && task.column === 'in-progress'

  const relativeTime = task.lastMessageAt
    ? formatDistanceToNowStrict(new Date(task.lastMessageAt), {
        locale: shortTimeLocale as Locale,
        roundingMethod: 'floor',
      })
    : null
  const hasMessages = typeof task.messageCount === 'number' && task.messageCount > 0

  const card = (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      className={cn(
        'group relative overflow-hidden rounded-lg border border-border/60 bg-card shadow-minimal',
        'cursor-pointer transition-colors hover:border-border focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/50'
      )}
      style={
        isLive
          ? {
              boxShadow: `0 0 0 1px ${accent}, 0 4px 16px -4px color-mix(in srgb, ${accent} 40%, transparent)`,
            }
          : undefined
      }
    >
      {showTint && color && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 6%, transparent)` }}
          aria-hidden
        />
      )}
      {showStripe && color && (
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px] pointer-events-none"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}

      {onEdit && (
        <button
          type="button"
          data-no-dnd="true"
          onClick={e => {
            e.stopPropagation()
            onEdit()
          }}
          onKeyDown={e => e.stopPropagation()}
          title={t('kanban.editTask')}
          aria-label={t('kanban.editTask')}
          className="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md border border-border/60 bg-card text-foreground/50 opacity-0 shadow-minimal transition-opacity hover:bg-foreground/[0.05] hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}

      <div className="relative p-3 pl-3.5">
        {(project || task.isFlagged) && (
          // Right padding keeps the flag clear of the hover-revealed corner pencil.
          <div className={cn('mb-1.5 flex items-center justify-between gap-2', onEdit && task.isFlagged && 'pr-7')}>
            {project ? (
              <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-medium text-foreground/55">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: project.color }}
                  aria-hidden
                />
                <span className="truncate">{project.name}</span>
              </span>
            ) : (
              <span />
            )}
            {task.isFlagged && (
              <Flag className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500" aria-hidden />
            )}
          </div>
        )}

        <div
          className={cn(
            'text-sm font-medium leading-snug line-clamp-2',
            // Strike done/cancelled by *status* (not column — placement ≠ status).
            status?.category === 'closed' ? 'text-foreground/55 line-through' : 'text-foreground'
          )}
        >
          {task.title}
        </div>

        <div className="mt-2">
          {status &&
            (onStatusChange && statuses && statuses.length > 0 ? (
              <StatusPicker
                status={status}
                statuses={statuses}
                activeStateId={task.statusId}
                live={isLive}
                onSelect={onStatusChange}
              />
            ) : (
              <StatusBadge status={status} live={isLive} />
            ))}
        </div>

        {(subtaskCount > 0 || onAddSubtask) && (
          <div className="mt-2.5 border-t border-border/40 pt-2">
            {subtaskCount > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-no-dnd="true"
                  onClick={e => {
                    e.stopPropagation()
                    onToggleSubtasks?.()
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-foreground/55 transition-colors hover:text-foreground/80"
                  aria-expanded={expanded}
                  aria-label={t('kanban.subtasks')}
                >
                  <ChevronRight
                    className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')}
                    strokeWidth={2}
                  />
                  <SubtaskProgress subtasks={task.subtasks} total={task.subtaskTotal} accent={accent} className="min-w-0 flex-1" />
                </button>
                {onRunSubtasks && (
                  <button
                    type="button"
                    data-no-dnd="true"
                    onClick={e => {
                      e.stopPropagation()
                      onRunSubtasks()
                    }}
                    disabled={!canRunSubtasks}
                    title={t('kanban.runSubtasks')}
                    aria-label={t('kanban.runSubtasks')}
                    // No `disabled:pointer-events-none`: it would let clicks pass THROUGH the
                    // disabled button to the card underneath (which opens the session list).
                    // A disabled button that keeps pointer events swallows the click instead.
                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground/80 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-foreground/50"
                  >
                    <Play className="h-3 w-3" strokeWidth={2} />
                  </button>
                )}
              </div>
            )}

            {(expanded || subtaskCount === 0) && (
              <div className={cn('pl-1', subtaskCount > 0 && 'mt-1')}>
                {task.subtasks.map(subtask => {
                  // Synthetic rows (spec nodes not yet run) have no session to open.
                  const sessionId = subtask.sessionId
                  return (
                    <SubtaskRow
                      key={subtask.id}
                      subtask={subtask}
                      onClick={onSubtaskClick && sessionId ? () => onSubtaskClick(sessionId) : undefined}
                    />
                  )
                })}
                {onAddSubtask && (
                  <AddSubtask
                    onAdd={onAddSubtask}
                    modelGroups={subtaskModelGroups}
                    defaultModel={defaultSubtaskModel}
                  />
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/40 pt-2">
          <ModelChip model={task.model} />
          {(relativeTime || hasMessages) && (
            <div className="flex shrink-0 items-center gap-2 text-[11px] text-foreground/45">
              {relativeTime && (
                <span className="inline-flex items-center gap-0.5 tabular-nums">
                  <Clock className="h-3 w-3" strokeWidth={2} />
                  {relativeTime}
                </span>
              )}
              {hasMessages && (
                <span className="inline-flex items-center gap-0.5 tabular-nums">
                  <MessageSquare className="h-3 w-3" strokeWidth={2} />
                  {task.messageCount}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  if (!onEdit) return card

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onSelect={onEdit}>
          <Pencil className="h-4 w-4" />
          {t('kanban.editTask')}
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

/**
 * Status badge that opens the shared `SessionStatusMenu` in a popover. Stops
 * pointer/keyboard propagation so opening the picker never starts a drag or
 * triggers the tile's open-window handler; closes itself on select.
 */
function StatusPicker({
  status,
  statuses,
  activeStateId,
  live,
  onSelect,
}: {
  status: SessionStatus
  statuses: SessionStatus[]
  activeStateId: string
  live: boolean
  onSelect: (statusId: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-no-dnd="true"
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          aria-label={t('kanban.changeStatus')}
          className="rounded-full transition-shadow hover:ring-2 hover:ring-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:ring-2 data-[state=open]:ring-foreground/20"
        >
          <StatusBadge status={status} live={live} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
        data-no-dnd="true"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      >
        <SessionStatusMenu
          states={statuses}
          activeState={activeStateId}
          onSelect={statusId => {
            onSelect(statusId)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Inline composer for spawning a subtask off a tile. Collapsed it's a "+ Add
 * subtask" affordance; expanded it's a text field plus an action row with a
 * provider→model picker and an Add button that creates a subtask routed to the
 * chosen model. Creation does not execute the subtask — it lands as a pending
 * row, dispatched later by the tile's Play (Run subtasks) button. The picker
 * menu is portaled (the tile lives in an `overflow-y-auto` column that would
 * clip an inline panel). The composer root stops click/keydown propagation so
 * neither the picker, Add, nor keyboard activation ever reaches the tile card's
 * open-window handler.
 */
function AddSubtask({
  onAdd,
  modelGroups,
  defaultModel,
}: {
  onAdd: (title: string, model: string) => void
  modelGroups?: KanbanModelProviderGroup[]
  defaultModel?: string
}) {
  const { t } = useTranslation()
  const [composing, setComposing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  const options = React.useMemo(() => (modelGroups ?? []).flatMap(g => g.models), [modelGroups])
  const [model, setModel] = React.useState(() => defaultModel ?? options[0]?.id ?? DEFAULT_MODEL)

  React.useEffect(() => {
    if (composing) inputRef.current?.focus()
  }, [composing])

  const selectedGroup = modelGroups?.find(g => g.models.some(m => m.id === model))
  const selectedName = options.find(o => o.id === model)?.name ?? getModelShortName(model)
  const selectedIcon = selectedGroup ? resolveProviderIcon(selectedGroup.provider) : null

  const submit = () => {
    const title = draft.trim()
    if (!title) return
    onAdd(title, model)
    setDraft('')
    setComposing(false)
  }

  if (!composing) {
    return (
      <button
        type="button"
        data-no-dnd="true"
        onClick={e => {
          e.stopPropagation()
          setComposing(true)
        }}
        className="mt-1 flex w-full items-center gap-1 text-[11px] font-medium text-foreground/45 transition-colors hover:text-foreground/70"
      >
        <Plus className="h-3 w-3" strokeWidth={2} />
        {t('kanban.addSubtask')}
      </button>
    )
  }

  return (
    <div
      className="mt-1.5 space-y-1.5"
      data-no-dnd="true"
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
    >
      <textarea
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setComposing(false)
            setDraft('')
          }
        }}
        rows={1}
        placeholder={t('kanban.describeSubtask')}
        className="w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-foreground outline-none field-sizing-content max-h-40 focus:border-border"
      />
      <div className="flex items-center justify-between gap-1.5">
        {modelGroups && modelGroups.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-1 text-[11px] font-medium text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                {selectedIcon ? (
                  <img src={selectedIcon} alt="" className="h-3 w-3 shrink-0 rounded-[2px]" aria-hidden />
                ) : (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" aria-hidden />
                )}
                <span className="truncate">{selectedName}</span>
                <ChevronDown className="h-3 w-3 shrink-0 text-foreground/40" strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-[240px]">
              {modelGroups.map((group, gi) => (
                <React.Fragment key={group.provider}>
                  {gi > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] text-foreground/50">
                    {resolveProviderIcon(group.provider) && (
                      <img
                        src={resolveProviderIcon(group.provider)!}
                        alt=""
                        className="h-3 w-3 rounded-[2px]"
                        aria-hidden
                      />
                    )}
                    {group.label}
                  </DropdownMenuLabel>
                  {group.models.map(opt => (
                    <DropdownMenuItem key={opt.id} className="text-xs" onSelect={() => setModel(opt.id)}>
                      <span className="truncate">{opt.name}</span>
                      {opt.id === model && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                    </DropdownMenuItem>
                  ))}
                </React.Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim()}
          className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {t('kanban.add')}
        </button>
      </div>
    </div>
  )
}
