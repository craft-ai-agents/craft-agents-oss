import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { PROJECT_COLOR_PALETTE, type ProjectColorTreatment } from '@/utils/project-colors'
import { type SessionStatus, getStatusIconStyle } from '@/config/session-status-config'
import type { KanbanColumnColor } from '@/hooks/useKanbanColumnColors'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { SessionStatusMenu } from '@/components/ui/session-status-menu'
import { TaskTile } from './TaskTile'
import { NewTaskComposer } from './NewTaskComposer'
import { KANBAN_COLLAPSED_WIDTH_PX, KANBAN_COLUMN_MIN_WIDTH_PX } from './status-column'
import type {
  KanbanColumnMeta,
  KanbanModelProviderGroup,
  KanbanProject,
  KanbanTask,
} from './types'

/** Droppable id for a project group section inside a column. */
export function projectGroupDropId(columnId: string, projectId: string | null): string {
  return `group:${columnId}:${projectId ?? '__none__'}`
}

/** Parse a project-group droppable id; returns null when not a group target. */
export function parseProjectGroupDropId(
  overId: string,
): { columnId: string; projectId: string | null } | null {
  if (!overId.startsWith('group:')) return null
  const rest = overId.slice('group:'.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return null
  const columnId = rest.slice(0, sep)
  const rawProject = rest.slice(sep + 1)
  return { columnId, projectId: rawProject === '__none__' ? null : rawProject }
}

export interface KanbanProjectGroup {
  projectId: string | null
  name: string
  color?: string
  tasks: KanbanTask[]
}

interface KanbanColumnProps {
  column: KanbanColumnMeta
  /** Resolved color identity for this column (header pill + body tint). */
  color?: KanbanColumnColor
  tasks: KanbanTask[]
  projectsById: Map<string, KanbanProject>
  statusesById: Map<string, SessionStatus>
  /** Ordered workspace statuses for the per-tile status picker. */
  statuses?: SessionStatus[]
  /** Change a task's status from its tile. Enables the status-badge picker when set. */
  onChangeStatus?: (taskId: string, statusId: string) => void
  treatment: ProjectColorTreatment
  expandedTaskIds: Set<string>
  onTaskClick?: (taskId: string) => void
  /** Open the editor against a tile (edit mode). Enables the tile's "Edit task" action. */
  onEditTask?: (taskId: string) => void
  onToggleSubtasks?: (taskId: string) => void
  onSubtaskClick?: (taskId: string, subtaskId: string) => void
  onAddSubtask?: (taskId: string, title: string, model: string) => void
  /** Run all pending subtasks of a task. Shows each tile's Play button when set. */
  onRunSubtasks?: (taskId: string) => void
  /** Provider→model catalog for each tile's "Add subtask" composer. */
  subtaskModelGroups?: KanbanModelProviderGroup[]
  /** Model id pre-selected in the composer. */
  defaultSubtaskModel?: string
  /** When present, renders the inline "New Task" composer at the top of the column. */
  onCreateTask?: (title: string) => void
  /** Status auto-applied to a task dropped into this column (empty/undefined = leave untouched). */
  dropStatusId?: string
  /** Set this column's drop-status. Enables the header status picker when provided ('' clears). */
  onSelectDropStatus?: (statusId: string) => void
  /** Rename this column. Enables the column editor when provided. */
  onRename?: (name: string) => void
  /** Set this column's accent color. */
  onSetColor?: (color: string) => void
  /** Remove this column. Absent for built-ins and the last remaining column. */
  onRemove?: () => void
  /** Toggle collapsed rail. */
  onToggleCollapsed?: () => void
  /** Auto-prompt toggle + text (column header editor). */
  onSetPrompt?: (patch: { promptEnabled?: boolean; prompt?: string }) => void
  /**
   * When set, tasks are rendered in collapsible project sections instead of a flat list.
   * Dropping onto a section assigns that projectId.
   */
  projectGroups?: KanbanProjectGroup[]
  /**
   * B6 priority subsections: pseudo project groups with `__priority_<p>` ids.
   * Dropping inside a subsection assigns priority (handled container-side).
   * Takes precedence over projectGroups when present.
   */
  priorityGroups?: KanbanProjectGroup[]
  /** Collapsed project group keys (`projectId` or `__none__`). */
  collapsedGroupKeys?: Set<string>
  onToggleProjectGroup?: (groupKey: string) => void
  isTaskSelected?: (taskId: string) => boolean
  multiSelectActive?: boolean
  onSelectTask?: (taskId: string, shiftKey: boolean) => void
}

export function KanbanColumn({
  column,
  color,
  tasks,
  projectsById,
  statusesById,
  statuses,
  onChangeStatus,
  treatment,
  expandedTaskIds,
  onTaskClick,
  onEditTask,
  onToggleSubtasks,
  onSubtaskClick,
  onAddSubtask,
  onRunSubtasks,
  subtaskModelGroups,
  defaultSubtaskModel,
  onCreateTask,
  dropStatusId,
  onSelectDropStatus,
  onRename,
  onSetColor,
  onRemove,
  onToggleCollapsed,
  onSetPrompt,
  projectGroups,
  priorityGroups,
  collapsedGroupKeys,
  onToggleProjectGroup,
  isTaskSelected,
  multiSelectActive,
  onSelectTask,
}: KanbanColumnProps) {
  const { t } = useTranslation()
  // Prefer explicit name override (persisted rename); else i18n labelKey; else id.
  const label = column.name?.trim()
    ? column.name
    : column.labelKey
      ? t(column.labelKey)
      : column.id
  const editable = !!onRename || !!onSetColor || !!onRemove || !!onSetPrompt
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const collapsed = column.collapsed ?? column.defaultCollapsed ?? false

  const tileProps = {
    projectsById,
    statusesById,
    statuses,
    onChangeStatus,
    treatment,
    expandedTaskIds,
    onTaskClick,
    onEditTask,
    onToggleSubtasks,
    onSubtaskClick,
    onAddSubtask,
    onRunSubtasks,
    subtaskModelGroups,
    defaultSubtaskModel,
    columnAccent: color?.solid,
    isTaskSelected,
    multiSelectActive,
    onSelectTask,
  }

  if (collapsed) {
    return (
      <div
        className="flex shrink-0 flex-col"
        style={{
          width: KANBAN_COLLAPSED_WIDTH_PX,
          minWidth: KANBAN_COLLAPSED_WIDTH_PX,
          maxWidth: KANBAN_COLLAPSED_WIDTH_PX,
        }}
      >
        <button
          type="button"
          data-no-dnd="true"
          onClick={onToggleCollapsed}
          title={t('kanban.column.expand')}
          className="flex flex-1 flex-col items-center gap-2 rounded-lg px-1 py-2 transition-colors hover:bg-foreground/[0.04]"
          style={{ backgroundColor: color?.tint }}
        >
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold tabular-nums text-white"
            style={{ backgroundColor: color?.solid ?? '#94a3b8' }}
          >
            {tasks.length}
          </span>
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-foreground/70"
            style={{
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
              maxHeight: '12rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </span>
          <ChevronRight className="mt-auto h-3.5 w-3.5 text-foreground/40" />
        </button>
        {/* Keep droppable while collapsed so cards can still land here. */}
        <div ref={setNodeRef} className="h-0 w-0 overflow-hidden" aria-hidden />
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 flex-col"
      style={{ minWidth: KANBAN_COLUMN_MIN_WIDTH_PX }}
    >
      <div className="flex items-center gap-1 px-0.5 pb-2">
        {onToggleCollapsed && (
          <button
            type="button"
            data-no-dnd="true"
            onClick={onToggleCollapsed}
            title={t('kanban.column.collapse')}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/80"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
        <ColumnHeader
          label={label}
          count={tasks.length}
          color={color}
          statuses={statuses}
          dropStatus={dropStatusId ? statusesById.get(dropStatusId) : undefined}
          onSelectDropStatus={onSelectDropStatus}
          editable={editable}
          onRename={onRename}
          onSetColor={onSetColor}
          onRemove={onRemove}
          promptEnabled={column.promptEnabled}
          prompt={column.prompt}
          onSetPrompt={onSetPrompt}
        />
      </div>

      <div
        ref={setNodeRef}
        className="flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg p-2 transition-shadow"
        style={{
          backgroundColor: color?.tint,
          boxShadow: isOver && color ? `inset 0 0 0 2px ${color.solid}` : undefined,
        }}
      >
        {onCreateTask && <NewTaskComposer onCreate={onCreateTask} />}

        {(() => {
          const sections = priorityGroups ?? projectGroups
          return sections ? (
            sections.map(group => {
              const groupKey = group.projectId ?? '__none__'
              const isGroupCollapsed = collapsedGroupKeys?.has(groupKey) ?? false
              return (
                <ProjectGroupSection
                  key={groupKey}
                  columnId={column.id}
                  group={group}
                  collapsed={isGroupCollapsed}
                  onToggle={() => onToggleProjectGroup?.(groupKey)}
                  tileProps={tileProps}
                />
              )
            })
          ) : (
          tasks.map(task => (
            <DraggableTile key={task.id} taskId={task.id}>
              <TaskTile
                task={task}
                project={task.projectId ? projectsById.get(task.projectId) : undefined}
                status={statusesById.get(task.statusId)}
                statuses={statuses}
                onStatusChange={onChangeStatus ? statusId => onChangeStatus(task.id, statusId) : undefined}
                treatment={treatment}
                expanded={expandedTaskIds.has(task.id)}
                onClick={() => onTaskClick?.(task.id)}
                onEdit={onEditTask ? () => onEditTask(task.id) : undefined}
                onToggleSubtasks={() => onToggleSubtasks?.(task.id)}
                onSubtaskClick={onSubtaskClick ? subtaskId => onSubtaskClick(task.id, subtaskId) : undefined}
                onAddSubtask={onAddSubtask ? (title, model) => onAddSubtask(task.id, title, model) : undefined}
                onRunSubtasks={onRunSubtasks ? () => onRunSubtasks(task.id) : undefined}
                subtaskModelGroups={subtaskModelGroups}
                defaultSubtaskModel={defaultSubtaskModel}
                columnAccent={color?.solid}
                selected={isTaskSelected?.(task.id)}
                multiSelectActive={multiSelectActive}
                onSelect={
                  onSelectTask
                    ? shiftKey => onSelectTask(task.id, shiftKey)
                    : undefined
                }
              />
            </DraggableTile>
          ))
          )
        })()}
      </div>
    </div>
  )
}

type TileSharedProps = {
  projectsById: Map<string, KanbanProject>
  statusesById: Map<string, SessionStatus>
  statuses?: SessionStatus[]
  onChangeStatus?: (taskId: string, statusId: string) => void
  treatment: ProjectColorTreatment
  expandedTaskIds: Set<string>
  onTaskClick?: (taskId: string) => void
  onEditTask?: (taskId: string) => void
  onToggleSubtasks?: (taskId: string) => void
  onSubtaskClick?: (taskId: string, subtaskId: string) => void
  onAddSubtask?: (taskId: string, title: string, model: string) => void
  onRunSubtasks?: (taskId: string) => void
  subtaskModelGroups?: KanbanModelProviderGroup[]
  defaultSubtaskModel?: string
  columnAccent?: string
  isTaskSelected?: (taskId: string) => boolean
  multiSelectActive?: boolean
  onSelectTask?: (taskId: string, shiftKey: boolean) => void
}

function ProjectGroupSection({
  columnId,
  group,
  collapsed,
  onToggle,
  tileProps,
}: {
  columnId: string
  group: KanbanProjectGroup
  collapsed: boolean
  onToggle: () => void
  tileProps: TileSharedProps
}) {
  const dropId = projectGroupDropId(columnId, group.projectId)
  const { setNodeRef, isOver } = useDroppable({ id: dropId })

  return (
    <div
      ref={setNodeRef}
      className="rounded-md border border-border/40 bg-background/30"
      style={{
        boxShadow: isOver ? 'inset 0 0 0 1.5px var(--foreground)' : undefined,
        opacity: isOver ? 0.95 : 1,
      }}
    >
      <button
        type="button"
        data-no-dnd="true"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.03]"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-foreground/40" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-foreground/40" />
        )}
        {group.color && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: group.color }}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/70">
          {group.name}
        </span>
        <span className="tabular-nums text-[10px] text-foreground/40">{group.tasks.length}</span>
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-2 px-1.5 pb-1.5">
          {group.tasks.map(task => (
            <DraggableTile key={task.id} taskId={task.id}>
              <TaskTile
                task={task}
                project={task.projectId ? tileProps.projectsById.get(task.projectId) : undefined}
                status={tileProps.statusesById.get(task.statusId)}
                statuses={tileProps.statuses}
                onStatusChange={
                  tileProps.onChangeStatus
                    ? statusId => tileProps.onChangeStatus!(task.id, statusId)
                    : undefined
                }
                treatment={tileProps.treatment}
                expanded={tileProps.expandedTaskIds.has(task.id)}
                onClick={() => tileProps.onTaskClick?.(task.id)}
                onEdit={tileProps.onEditTask ? () => tileProps.onEditTask!(task.id) : undefined}
                onToggleSubtasks={() => tileProps.onToggleSubtasks?.(task.id)}
                onSubtaskClick={
                  tileProps.onSubtaskClick
                    ? subtaskId => tileProps.onSubtaskClick!(task.id, subtaskId)
                    : undefined
                }
                onAddSubtask={
                  tileProps.onAddSubtask
                    ? (title, model) => tileProps.onAddSubtask!(task.id, title, model)
                    : undefined
                }
                onRunSubtasks={
                  tileProps.onRunSubtasks ? () => tileProps.onRunSubtasks!(task.id) : undefined
                }
                subtaskModelGroups={tileProps.subtaskModelGroups}
                defaultSubtaskModel={tileProps.defaultSubtaskModel}
                columnAccent={tileProps.columnAccent}
                selected={tileProps.isTaskSelected?.(task.id)}
                multiSelectActive={tileProps.multiSelectActive}
                onSelect={
                  tileProps.onSelectTask
                    ? shiftKey => tileProps.onSelectTask?.(task.id, shiftKey)
                    : undefined
                }
              />
            </DraggableTile>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Colored column-identity pill.
 * When `editable`, opens a full editor (rename, color, drop-status, auto-prompt, remove).
 * When only drop-status is set, opens the status menu.
 */
function ColumnHeader({
  label,
  count,
  color,
  statuses,
  dropStatus,
  onSelectDropStatus,
  editable,
  onRename,
  onSetColor,
  onRemove,
  promptEnabled,
  prompt,
  onSetPrompt,
}: {
  label: string
  count: number
  color?: KanbanColumnColor
  statuses?: SessionStatus[]
  dropStatus?: SessionStatus
  onSelectDropStatus?: (statusId: string) => void
  editable?: boolean
  onRename?: (name: string) => void
  onSetColor?: (color: string) => void
  onRemove?: () => void
  promptEnabled?: boolean
  prompt?: string
  onSetPrompt?: (patch: { promptEnabled?: boolean; prompt?: string }) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const pillStyle = color ? { backgroundColor: color.solid, color: color.onAccent } : undefined
  const inner = (
    <>
      {dropStatus && (
        <span className="shrink-0 flex items-center" style={getStatusIconStyle(dropStatus)}>
          {dropStatus.icon}
        </span>
      )}
      {label}
      <span
        className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.25)' }}
      >
        {count}
      </span>
    </>
  )

  if (!onSelectDropStatus && !editable) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
        style={pillStyle}
      >
        {inner}
      </span>
    )
  }

  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        data-no-dnd="true"
        onPointerDown={e => e.stopPropagation()}
        title={editable ? t('kanban.column.edit') : t('kanban.column.setDropStatus')}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-shadow hover:ring-2 hover:ring-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:ring-2 data-[state=open]:ring-foreground/20"
        style={pillStyle}
      >
        {inner}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </button>
    </PopoverTrigger>
  )

  if (!editable) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        {trigger}
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-auto border-0 bg-transparent p-0 shadow-none"
          data-no-dnd="true"
        >
          <SessionStatusMenu
            states={statuses}
            activeState={dropStatus?.id ?? ''}
            onSelect={statusId => {
              onSelectDropStatus?.(statusId)
              setOpen(false)
            }}
            onClear={() => {
              onSelectDropStatus?.('')
              setOpen(false)
            }}
            clearLabel={t('kanban.column.dropStatusNone')}
          />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger}
      <PopoverContent
        align="start"
        sideOffset={4}
        className="dark w-64 space-y-3 border-border/50 bg-background/80 p-3 backdrop-blur-xl backdrop-saturate-150"
        style={{ borderRadius: '8px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)' }}
        data-no-dnd="true"
      >
        {onRename && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground/50">{t('kanban.column.name')}</label>
            <input
              type="text"
              defaultValue={label}
              autoFocus
              onBlur={e => {
                const next = e.target.value.trim()
                if (next && next !== label) onRename(next)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLInputElement).blur()
                  setOpen(false)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                }
              }}
              className="w-full rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-border"
            />
          </div>
        )}

        {onSetColor && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground/50">{t('kanban.column.color')}</label>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_COLOR_PALETTE.map(hex => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onSetColor(hex)}
                  title={hex}
                  className="grid h-5 w-5 place-items-center rounded-full ring-1 ring-border/40 transition-transform hover:scale-110"
                  style={{ backgroundColor: hex }}
                >
                  {color?.solid === hex && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>
        )}

        {onSelectDropStatus && statuses && statuses.length > 0 && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground/50">{t('kanban.column.setDropStatus')}</label>
            <SessionStatusMenu
              states={statuses}
              activeState={dropStatus?.id ?? ''}
              onSelect={statusId => onSelectDropStatus(statusId)}
              onClear={() => onSelectDropStatus('')}
              clearLabel={t('kanban.column.dropStatusNone')}
            />
          </div>
        )}

        {onSetPrompt && (
          <div className="space-y-1.5 border-t border-border/40 pt-2">
            <label className="flex items-center gap-2 text-[11px] font-medium text-foreground/50">
              <input
                type="checkbox"
                checked={!!promptEnabled}
                onChange={e => onSetPrompt({ promptEnabled: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-border"
              />
              {t('kanban.column.autoPrompt')}
            </label>
            {promptEnabled && (
              <textarea
                defaultValue={prompt ?? ''}
                rows={3}
                placeholder={t('kanban.column.autoPromptPlaceholder')}
                onBlur={e => {
                  const next = e.target.value
                  if (next !== (prompt ?? '')) onSetPrompt({ prompt: next })
                }}
                className="max-h-40 w-full resize-y rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-border"
              />
            )}
          </div>
        )}

        {onRemove && (
          <button
            type="button"
            onClick={() => {
              onRemove()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('kanban.column.remove')}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Pointer-drag wrapper for a tile. Only `listeners` are spread (not `attributes`)
 * so the tile keeps its own accessibility role. `data-no-dnd` descendants skip the
 * activation sensor (chevron, composer, menus).
 */
function DraggableTile({ taskId, children }: { taskId: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: taskId })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-30' : undefined}
    >
      {children}
    </div>
  )
}
