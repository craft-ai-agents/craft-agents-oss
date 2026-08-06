import * as React from 'react'
import { LayoutGrid, List, X } from 'lucide-react'
import type { ComponentEntry } from './types'
import { cn } from '@/lib/utils'
import { getModelShortName } from '@config/models'
import type { ProjectColorTreatment } from '@/utils/project-colors'
import { KanbanBoard } from '@/components/app-shell/kanban/KanbanBoard'
import { TaskTile } from '@/components/app-shell/kanban/TaskTile'
import { TaskChatPreview } from '@/components/app-shell/kanban/TaskChatPreview'
import { StatusBadge } from '@/components/app-shell/kanban/StatusBadge'
import { ModelChip } from '@/components/app-shell/kanban/ModelChip'
import { KANBAN_COLUMNS, statusToColumn } from '@/components/app-shell/kanban/status-column'
import type {
  KanbanColumnId,
  KanbanModelProviderGroup,
  KanbanSubtask,
  KanbanTask,
  SubtaskRunState,
} from '@/components/app-shell/kanban/types'
import {
  mockTasks,
  mockProjectsById,
  mockStatuses,
  mockStatusesById,
  DEFAULT_EXPANDED_TASK_IDS,
  ANATOMY_SUBTASKS,
  mockTaskWindow,
} from '../demos/kanban/mock-kanban-data'

const MODEL_OPTIONS = [
  { label: 'Opus 4.7', value: 'claude-opus-4-7' },
  { label: 'Sonnet 4.6', value: 'claude-sonnet-4-6' },
  { label: 'Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
]

const STATUS_OPTIONS = [
  { label: 'Todo', value: 'todo' },
  { label: 'In Progress', value: 'in-progress' },
  { label: 'Needs Review', value: 'needs-review' },
  { label: 'Done', value: 'done' },
  { label: 'Cancelled', value: 'cancelled' },
]

const TREATMENT_OPTIONS = [
  { label: 'Stripe + tint', value: 'stripe-tint' },
  { label: 'Stripe only', value: 'stripe' },
]

/**
 * Provider→model catalog for the "Add subtask" composer. Stands in for the
 * workspace's real LLM connections (which the wiring phase will supply): the
 * point of the demo is that a subtask can be routed to *any* provider's model,
 * not just Anthropic. Provider keys drive the brand icons via `getProviderIcon`.
 */
const SUBTASK_MODEL_GROUPS: KanbanModelProviderGroup[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: [
      { id: 'claude-opus-4-7', name: 'Opus 4.7' },
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
    ],
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'openai/gpt-5', name: 'GPT-5' },
      { id: 'openai/gpt-5-mini', name: 'GPT-5 mini' },
    ],
  },
  {
    provider: 'google',
    label: 'Google AI Studio',
    models: [
      { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro' },
      { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash' },
    ],
  },
  {
    provider: 'xai',
    label: 'xAI (Grok)',
    models: [{ id: 'xai/grok-4', name: 'Grok 4' }],
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    models: [{ id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2' }],
  },
  {
    provider: 'mistral',
    label: 'Mistral',
    models: [{ id: 'mistral/mistral-large', name: 'Mistral Large' }],
  },
  {
    provider: 'groq',
    label: 'Groq',
    models: [{ id: 'groq/llama-4-70b', name: 'Llama 4 70B' }],
  },
]

/** Model a freshly-spawned subtask is routed to when the picker isn't touched. */
const DEFAULT_SUBTASK_MODEL = 'claude-sonnet-4-6'

/** Build a new pending subtask from a typed title + chosen model (the "Add" path; Run dispatches it). */
function makeSubtask(title: string, idPrefix: string, model: string): KanbanSubtask {
  return { id: `${idPrefix}-new-${Date.now()}`, title, runState: 'pending', model }
}

// ============================================================================
// List ⇄ Board toggle (lives in the All-Sessions header)
// ============================================================================

type KanbanView = 'board' | 'list'

function ViewToggle({ value, onChange }: { value: KanbanView; onChange: (v: KanbanView) => void }) {
  const Btn = ({ view, icon: Icon, label }: { view: KanbanView; icon: typeof List; label: string }) => {
    const active = value === view
    return (
      <button
        type="button"
        onClick={() => onChange(view)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
          active ? 'bg-card text-foreground shadow-sm' : 'text-foreground/50 hover:text-foreground/80'
        )}
        aria-pressed={active}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        {label}
      </button>
    )
  }
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-foreground/[0.02] p-0.5">
      <Btn view="list" icon={List} label="List" />
      <Btn view="board" icon={LayoutGrid} label="Board" />
    </div>
  )
}

function StubSessionList() {
  return (
    <div className="flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-md divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60 bg-card">
        {mockTasks.map(task => {
          const project = task.projectId ? mockProjectsById.get(task.projectId) : undefined
          const status = mockStatusesById.get(task.statusId)
          return (
            <div key={task.id} className="flex items-center gap-2 px-3 py-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: project?.color ?? 'var(--muted-foreground)' }}
                aria-hidden
              />
              <span className="flex-1 truncate text-sm text-foreground">{task.title}</span>
              {status && <StatusBadge status={status} />}
              <ModelChip model={task.model} />
            </div>
          )
        })}
      </div>
      <p className="mx-auto mt-3 max-w-md text-center text-xs text-foreground/40">
        List view is a stub here — the Board toggle is the focus of this preview.
      </p>
    </div>
  )
}

// ============================================================================
// Simulated "separate window" — opening a task or subtask session
// ============================================================================

type TaskWindowProps = React.ComponentProps<typeof TaskChatPreview>

type OpenTarget =
  | { kind: 'task'; taskId: string }
  | { kind: 'subtask'; taskId: string; subtaskId: string }

const SUBTASK_STATUS_BY_RUN_STATE: Record<SubtaskRunState, string> = {
  done: 'done',
  running: 'in-progress',
  pending: 'todo',
  failed: 'needs-review',
}

/** Chat-window props for a parent task opened from its tile. */
function buildTaskWindowProps(task: KanbanTask): TaskWindowProps {
  const project = task.projectId ? mockProjectsById.get(task.projectId) : undefined
  const hasSubtasks = task.subtasks.length > 0
  return {
    title: task.title,
    project,
    status: mockStatusesById.get(task.statusId),
    model: task.model,
    userMessage: `Coordinate "${task.title}" and route each part to the best-fit model.`,
    assistantIntro: hasSubtasks
      ? "I'm acting as the orchestrator — here are the subtasks I've spawned, each routed to a best-fit model:"
      : "I'm acting as the orchestrator. No subtasks have been spawned yet — add one from the tile to send it down to run.",
    subtasks: task.subtasks,
    assistantFollowUp: hasSubtasks
      ? "I'll update each subtask here as the spawned sessions report back."
      : undefined,
  }
}

/** Chat-window props for a single spawned subtask opened from its row. */
function buildSubtaskWindowProps(sub: KanbanSubtask, parent: KanbanTask): TaskWindowProps {
  const project = parent.projectId ? mockProjectsById.get(parent.projectId) : undefined
  const followUp: Record<SubtaskRunState, string> = {
    done: 'This subtask has completed and reported back to the parent task.',
    running: 'This subtask is running now; results will report back to the parent task.',
    pending: 'This subtask is queued and will start once upstream work is ready.',
    failed: 'This subtask failed; the parent task can retry or rerun it.',
  }

  return {
    title: sub.title,
    project,
    status: mockStatusesById.get(SUBTASK_STATUS_BY_RUN_STATE[sub.runState]),
    model: sub.model,
    userMessage: sub.title,
    assistantIntro: `Spawned from "${parent.title}" and routed to ${getModelShortName(sub.model)} as the best fit for this subtask.`,
    subtasks: [],
    assistantFollowUp: followUp[sub.runState],
  }
}

/**
 * Stand-in for opening a session in its own OS window. The playground can't spawn
 * real windows, so this overlays the same `TaskChatPreview` body inside a faux
 * window chrome (with a close button + Escape-to-close).
 */
function TaskWindowOverlay({ windowProps, onClose }: { windowProps: TaskWindowProps; onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className="relative z-10 flex h-[88%] w-[90%] max-w-2xl flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/40 bg-foreground/[0.02] px-3 py-1.5">
          <span className="text-[11px] font-medium text-foreground/40">Session window</span>
          <button
            type="button"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground/80"
            aria-label="Close window"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <TaskChatPreview {...windowProps} />
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Entry 1 — full Kanban view (All-Sessions header + toggle + board)
// ============================================================================

function KanbanViewPreview({
  view = 'board',
  treatment = 'stripe-tint',
}: {
  view?: KanbanView
  treatment?: ProjectColorTreatment
}) {
  const [activeView, setActiveView] = React.useState<KanbanView>(view)
  React.useEffect(() => setActiveView(view), [view])

  // Clone the module-level mock so the demo can mutate (add subtasks) without
  // leaking edits across previews.
  const [tasks, setTasks] = React.useState<KanbanTask[]>(() =>
    mockTasks.map(t => ({ ...t, subtasks: [...t.subtasks] }))
  )
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(DEFAULT_EXPANDED_TASK_IDS))
  const [openTarget, setOpenTarget] = React.useState<OpenTarget | null>(null)

  const toggleSubtasks = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const addSubtask = (taskId: string, title: string, model: string) => {
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId ? { ...t, subtasks: [...t.subtasks, makeSubtask(title, taskId, model)] } : t
      )
    )
    setExpanded(prev => new Set(prev).add(taskId))
  }

  // Dispatch a tile's pending subtasks: flip them to running (the "Play" path).
  const runSubtasks = (taskId: string) => {
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId
          ? { ...t, subtasks: t.subtasks.map(s => (s.runState === 'pending' ? { ...s, runState: 'running' } : s)) }
          : t
      )
    )
  }

  // Create a named task tile in the ToDo column (the inline "New Task" composer path).
  const createTask = (title: string) => {
    setTasks(prev => [
      ...prev,
      { id: `task-new-${Date.now()}`, title, column: 'todo', statusId: 'todo', model: DEFAULT_SUBTASK_MODEL, subtasks: [] },
    ])
  }

  const changeStatus = (taskId: string, statusId: string) => {
    setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, statusId } : t)))
  }

  // Demo of the per-column "status on move" mapping the live board reads from
  // settings: dropping into a column also folds the status to that column.
  const COLUMN_STATUS: Record<KanbanColumnId, string> = {
    todo: 'todo',
    'in-progress': 'in-progress',
    done: 'done',
  }
  const moveTask = (taskId: string, toColumn: KanbanColumnId) => {
    setTasks(prev =>
      prev.map(t => (t.id === taskId ? { ...t, column: toColumn, statusId: COLUMN_STATUS[toColumn] } : t))
    )
  }

  // Derive overlay props from the *current* tasks so a freshly added subtask
  // shows up live in an already-open parent window.
  const windowProps = React.useMemo<TaskWindowProps | null>(() => {
    if (!openTarget) return null
    const task = tasks.find(t => t.id === openTarget.taskId)
    if (!task) return null
    if (openTarget.kind === 'task') return buildTaskWindowProps(task)
    const sub = task.subtasks.find(s => s.id === openTarget.subtaskId)
    return sub ? buildSubtaskWindowProps(sub, task) : null
  }, [openTarget, tasks])

  return (
    <div className="relative flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5">
        <span className="text-sm font-medium">All Tasks</span>
        <ViewToggle value={activeView} onChange={setActiveView} />
      </div>
      {activeView === 'board' ? (
        <div className="min-h-0 flex-1">
          <KanbanBoard
            columns={KANBAN_COLUMNS}
            tasks={tasks}
            projectsById={mockProjectsById}
            statusesById={mockStatusesById}
            statuses={mockStatuses}
            onChangeStatus={changeStatus}
            treatment={treatment}
            expandedTaskIds={expanded}
            onTaskClick={taskId => setOpenTarget({ kind: 'task', taskId })}
            onToggleSubtasks={toggleSubtasks}
            onSubtaskClick={(taskId, subtaskId) => setOpenTarget({ kind: 'subtask', taskId, subtaskId })}
            onAddSubtask={addSubtask}
            onRunSubtasks={runSubtasks}
            subtaskModelGroups={SUBTASK_MODEL_GROUPS}
            defaultSubtaskModel={DEFAULT_SUBTASK_MODEL}
            onCreateTask={createTask}
            onMoveTask={moveTask}
          />
        </div>
      ) : (
        <StubSessionList />
      )}

      {windowProps && <TaskWindowOverlay windowProps={windowProps} onClose={() => setOpenTarget(null)} />}
    </div>
  )
}

// ============================================================================
// Entry 2 — single tile (anatomy)
// ============================================================================

function TaskTilePreview({
  subtasksExpanded = true,
  statusId = 'in-progress',
  treatment = 'stripe-tint',
  model = 'claude-opus-4-7',
}: {
  subtasksExpanded?: boolean
  statusId?: string
  treatment?: ProjectColorTreatment
  model?: string
}) {
  const [expanded, setExpanded] = React.useState(subtasksExpanded)
  React.useEffect(() => setExpanded(subtasksExpanded), [subtasksExpanded])

  const [subtasks, setSubtasks] = React.useState<KanbanSubtask[]>(() => [...ANATOMY_SUBTASKS])

  const task: KanbanTask = {
    id: 'anatomy',
    title: 'Migrate auth to new session model',
    column: statusToColumn(statusId),
    statusId,
    model,
    projectId: 'p-eng',
    subtasks,
  }

  return (
    <div className="w-[340px]">
      <TaskTile
        task={task}
        project={mockProjectsById.get('p-eng')}
        status={mockStatusesById.get(statusId)}
        treatment={treatment}
        expanded={expanded}
        onClick={() => {}}
        onToggleSubtasks={() => setExpanded(v => !v)}
        onAddSubtask={(title, subtaskModel) => {
          setSubtasks(prev => [...prev, makeSubtask(title, 'anatomy', subtaskModel)])
          setExpanded(true)
        }}
        onRunSubtasks={() =>
          setSubtasks(prev => prev.map(s => (s.runState === 'pending' ? { ...s, runState: 'running' } : s)))
        }
        subtaskModelGroups={SUBTASK_MODEL_GROUPS}
        defaultSubtaskModel={DEFAULT_SUBTASK_MODEL}
      />
    </div>
  )
}

// ============================================================================
// Entry 3 — focused task window (chat-only)
// ============================================================================

function KanbanTaskWindowPreview() {
  return <TaskChatPreview {...mockTaskWindow} />
}

// ============================================================================
// Registry
// ============================================================================

export const kanbanComponents: ComponentEntry[] = [
  {
    id: 'kanban-board',
    name: 'Kanban Board',
    category: 'Kanban',
    description:
      'The 3-column board (ToDo / In Progress / Done) with the List⇄Board toggle in the All-Tasks header. Tiles place by column, independent from their status badge. Clicking a tile — or any spawned subtask row — opens that session in a (simulated) separate window; the "+ Add subtask" composer creates a pending subtask, and the Play (▶) button on a tile dispatches all pending subtasks to the orchestrator.',
    component: KanbanViewPreview,
    layout: 'full',
    props: [
      {
        name: 'view',
        description: 'Which view the All-Sessions header toggle starts on',
        control: { type: 'select', options: [{ label: 'Board', value: 'board' }, { label: 'List', value: 'list' }] },
        defaultValue: 'board',
      },
      {
        name: 'treatment',
        description: 'How a tile shows its project color',
        control: { type: 'select', options: TREATMENT_OPTIONS },
        defaultValue: 'stripe-tint',
      },
    ],
    variants: [
      { name: 'Board view', description: 'Default 3-column board', props: { view: 'board', treatment: 'stripe-tint' } },
      { name: 'Board · stripe only', description: 'Project color as a stripe without tint', props: { view: 'board', treatment: 'stripe' } },
      { name: 'List view (stub)', description: 'Toggle flipped to the (stubbed) list', props: { view: 'list' } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'kanban-task-tile',
    name: 'Task Tile (anatomy)',
    category: 'Kanban',
    description:
      'A single parent-session tile: project color, status badge (independent from column), orchestrator model, a collapsable auto-routed subtask list, an inline "+ Add subtask" composer (type a title → Add → creates a pending subtask), and a Play (▶) button that dispatches all pending subtasks.',
    component: TaskTilePreview,
    layout: 'centered',
    props: [
      {
        name: 'subtasksExpanded',
        description: 'Expand the spawned-subtask list',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'statusId',
        description: 'Status badge — independent from the board column',
        control: { type: 'select', options: STATUS_OPTIONS },
        defaultValue: 'in-progress',
      },
      {
        name: 'treatment',
        description: 'Project color treatment',
        control: { type: 'select', options: TREATMENT_OPTIONS },
        defaultValue: 'stripe-tint',
      },
      {
        name: 'model',
        description: 'Orchestrator model for the parent task',
        control: { type: 'select', options: MODEL_OPTIONS },
        defaultValue: 'claude-opus-4-7',
      },
    ],
    variants: [
      { name: 'Expanded', description: 'Subtasks visible', props: { subtasksExpanded: true } },
      { name: 'Collapsed', description: 'Subtasks hidden', props: { subtasksExpanded: false } },
      { name: 'Needs Review', description: 'Needs-review badge (would sit in In Progress)', props: { statusId: 'needs-review' } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'kanban-task-window',
    name: 'Task Window (chat-only)',
    category: 'Kanban',
    description:
      'The focused task window body: title bar, transcript showing Task mode acting as an orchestrator that spawns best-fit-model subtasks, and an input bar. No board, no sidebar.',
    component: KanbanTaskWindowPreview,
    layout: 'full',
    props: [],
    mockData: () => ({}),
  },
]
