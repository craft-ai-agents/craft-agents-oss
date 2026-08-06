import * as React from 'react'
import {
  ChevronLeft,
  ChevronDown,
  Sparkles,
  Plus,
  Trash2,
  GripVertical,
  Check,
  Hash,
  Clock3,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { getModelShortName } from '@config/models'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { SessionStatusMenu } from '@/components/ui/session-status-menu'
import { mockStatuses, mockStatusesById, mockProjects } from '../demos/kanban/mock-kanban-data'
import type { ComponentEntry } from './types'

// ---------------------------------------------------------------------------
// Static catalogs (stand-ins for the workspace's real models / projects)
// ---------------------------------------------------------------------------
const OPUS = 'claude-opus-4-7'
const SONNET = 'claude-sonnet-4-6'
const HAIKU = 'claude-haiku-4-5-20251001'

const MODELS: { id: string; name: string; dot: string }[] = [
  { id: OPUS, name: 'Opus 4.7', dot: '#6366f1' },
  { id: SONNET, name: 'Sonnet 4.6', dot: '#0ea5e9' },
  { id: HAIKU, name: 'Haiku 4.5', dot: '#10b981' },
]
const modelName = (id: string) => MODELS.find(m => m.id === id)?.name ?? getModelShortName(id)
const modelDot = (id: string) => MODELS.find(m => m.id === id)?.dot ?? '#9aa1aa'

let _uid = 0
const uid = () => `st-${++_uid}`
const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)

type Mode = 'generate' | 'manual'

interface EditorSubtask {
  id: string
  title: string
  model: string
  dependsOn: string | null
}

// ---------------------------------------------------------------------------
// YAML preview (live, theme-adaptive)
// ---------------------------------------------------------------------------
function wrap(text: string, width = 56): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const out: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      out.push(line)
      line = w
    } else {
      line = (line ? line + ' ' : '') + w
    }
  }
  if (line) out.push(line)
  return out
}

function buildYaml(s: {
  title: string
  goal: string
  projectId: string
  orchModel: string
  statusId: string
  subtasks: EditorSubtask[]
  aiMode: boolean
}): string {
  const slug = slugify(s.title) || 'untitled-task'
  const proj = mockProjects.find(p => p.id === s.projectId)
  const lines: string[] = []
  lines.push(`# workspace/tasks/${slug}.yaml`)
  lines.push(`id: ${slug}`)
  lines.push(`title: ${s.title || 'Untitled task'}`)
  const goalLines = wrap(s.goal)
  if (goalLines.length) {
    lines.push(`goal: >`)
    for (const g of goalLines) lines.push(`  ${g}`)
  } else {
    lines.push(`goal: ~`)
  }
  lines.push(`project: ${proj ? slugify(proj.name) : '~'}`)
  lines.push(`model: ${s.orchModel}        # orchestrator`)
  lines.push(`status: ${s.statusId}`)
  lines.push(`state: prepared               # not run yet`)
  lines.push(`subtasks:`)
  if (s.aiMode) {
    lines.push(`  # drafted by the orchestrator when the task runs`)
  } else if (s.subtasks.length === 0) {
    lines.push(`  []`)
  } else {
    for (const st of s.subtasks) {
      const dep = st.dependsOn ? s.subtasks.find(x => x.id === st.dependsOn) : null
      lines.push(`  - title: ${st.title || 'Untitled subtask'}`)
      lines.push(`    model: ${st.model}`)
      lines.push(`    depends_on: [${dep ? slugify(dep.title) : ''}]`)
    }
  }
  return lines.join('\n')
}

function YamlLine({ line }: { line: string }) {
  if (line.trim().startsWith('#'))
    return <div className="text-foreground/35">{line || ' '}</div>
  const m = line.match(/^(\s*-?\s*)([\w.-]+:)(.*)$/)
  if (m) {
    const [, lead, key, rest] = m
    const cm = rest.indexOf(' #')
    const value = cm >= 0 ? rest.slice(0, cm) : rest
    const comment = cm >= 0 ? rest.slice(cm) : ''
    return (
      <div>
        <span>{lead}</span>
        <span className="text-indigo-500 dark:text-indigo-300">{key}</span>
        <span className="text-foreground/80">{value}</span>
        {comment && <span className="text-foreground/30">{comment}</span>}
      </div>
    )
  }
  return <div className="text-foreground/75">{line || ' '}</div>
}

// ---------------------------------------------------------------------------
// Small inline controls
// ---------------------------------------------------------------------------
// Unified button system — one radius (rounded-lg), one height per size, a small
// set of variants. Every actionable button routes through this so heights /
// radii / hover states can't drift apart (the previous editor hand-rolled ~8).
type BtnVariant = 'primary' | 'secondary' | 'ghost'
type BtnSize = 'sm' | 'md' | 'lg'

const BTN_SIZE: Record<BtnSize, string> = {
  sm: 'h-7 px-2.5 text-[12px]',
  md: 'h-8 px-3 text-[12.5px]',
  lg: 'h-11 px-4 text-[13.5px]',
}
const BTN_VARIANT: Record<BtnVariant, string> = {
  // Solid indigo = the single commit action ("Prepare task").
  primary: 'bg-indigo-500 text-white hover:bg-indigo-600',
  // Neutral outline = quiet secondary (Save draft, Add subtask).
  secondary: 'border border-border bg-card text-foreground hover:bg-foreground/[0.03]',
  // Borderless = lowest emphasis (Board back link).
  ghost: 'text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground',
}

function Btn({
  variant = 'secondary',
  size = 'md',
  block = false,
  className,
  ...rest
}: { variant?: BtnVariant; size?: BtnSize; block?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors',
        'disabled:pointer-events-none disabled:opacity-60',
        BTN_SIZE[size],
        BTN_VARIANT[variant],
        block && 'w-full',
        className
      )}
      {...rest}
    />
  )
}

// A dropdown/popover trigger styled as a consistent "select" pill. `sm` for the
// dense subtask rows, `md` for the left-column field selects.
function SelectButton({
  size = 'md',
  children,
  className,
  ...rest
}: { size?: 'sm' | 'md' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background font-medium text-foreground',
        'transition-colors hover:bg-foreground/[0.03] data-[state=open]:bg-foreground/[0.03]',
        size === 'sm' ? 'h-7 px-2 text-[11.5px]' : 'h-8 px-2.5 text-[12.5px]',
        className
      )}
      {...rest}
    >
      {children}
      <ChevronDown
        className={cn('ml-auto shrink-0 text-foreground/40', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')}
        strokeWidth={2}
      />
    </button>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12.5px] font-medium text-foreground/55">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function ModelSelect({ value, onChange, width = 168, size = 'md' }: { value: string; onChange: (id: string) => void; width?: number; size?: 'sm' | 'md' }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SelectButton size={size} style={{ width }}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: modelDot(value) }} />
          <span className="truncate">{modelName(value)}</span>
        </SelectButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {MODELS.map(m => (
          <DropdownMenuItem key={m.id} className="text-xs" onSelect={() => onChange(m.id)}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: m.dot }} />
            <span className="truncate">{m.name}</span>
            {m.id === value && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// Subtask card
// ---------------------------------------------------------------------------
function SubtaskCard({
  index,
  subtask,
  earlier,
  onChange,
  onRemove,
}: {
  index: number
  subtask: EditorSubtask
  earlier: EditorSubtask[]
  onChange: (patch: Partial<EditorSubtask>) => void
  onRemove: () => void
}) {
  const depTitle = subtask.dependsOn ? earlier.find(s => s.id === subtask.dependsOn)?.title : null
  return (
    <div className="group rounded-[10px] border border-border/70 bg-foreground/[0.015] p-3">
      <div className="flex items-start gap-2">
        {/* Drag handle on the left edge — the conventional reorder affordance. */}
        <GripVertical
          className="mt-1 h-4 w-4 shrink-0 cursor-grab text-foreground/20 transition-colors group-hover:text-foreground/40"
          strokeWidth={2}
          aria-hidden
        />
        <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-500/10 text-[12px] font-bold text-indigo-500 dark:text-indigo-300">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <input
            value={subtask.title}
            onChange={e => onChange({ title: e.target.value })}
            placeholder="Subtask title…"
            className="w-full bg-transparent text-[13.5px] font-semibold text-foreground outline-none placeholder:text-foreground/30"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ModelSelect value={subtask.model} onChange={id => onChange({ model: id })} width={128} size="sm" />
            {/* dependency picker — same select shape as the model picker */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SelectButton size="sm" style={{ width: 168 }}>
                  <span className="truncate text-foreground/70">
                    {depTitle ? `depends on: ${depTitle}` : 'no dependency'}
                  </span>
                </SelectButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-w-[240px]">
                <DropdownMenuItem className="text-xs" onSelect={() => onChange({ dependsOn: null })}>
                  No dependency
                  {!subtask.dependsOn && <Check className="ml-auto h-3.5 w-3.5" strokeWidth={2} />}
                </DropdownMenuItem>
                {earlier.map(e => (
                  <DropdownMenuItem key={e.id} className="text-xs" onSelect={() => onChange({ dependsOn: e.id })}>
                    <span className="truncate">{e.title || 'Untitled subtask'}</span>
                    {subtask.dependsOn === e.id && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                  </DropdownMenuItem>
                ))}
                {earlier.length === 0 && (
                  <div className="px-2 py-1.5 text-[11px] text-foreground/40">No earlier subtasks</div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {/* Delete stays hover-reveal to keep the row calm. */}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove subtask"
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-foreground/40 opacity-0 transition-all hover:bg-foreground/10 hover:text-red-500 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task Editor
// ---------------------------------------------------------------------------
function TaskEditorPreview({ mode: initialMode = 'generate' }: { mode?: Mode }) {
  const [mode, setMode] = React.useState<Mode>(initialMode)
  const [title, setTitle] = React.useState('Migrate auth to new session model')
  const [goal, setGoal] = React.useState(
    "Migrate our auth layer to the new session model. Coordinate the work and route each part to the best-fit model. Don't run anything yet — just prepare the plan and subtasks."
  )
  const [projectId, setProjectId] = React.useState(mockProjects[0]?.id ?? '')
  const [orchModel, setOrchModel] = React.useState(OPUS)
  const [statusId, setStatusId] = React.useState('todo')
  const [subtasks, setSubtasks] = React.useState<EditorSubtask[]>([])
  const [yamlOpen, setYamlOpen] = React.useState(false)

  React.useEffect(() => setMode(initialMode), [initialMode])

  const project = mockProjects.find(p => p.id === projectId)
  const status = mockStatusesById.get(statusId)
  const yaml = React.useMemo(
    () => buildYaml({ title, goal, projectId, orchModel, statusId, subtasks, aiMode: mode === 'generate' }),
    [title, goal, projectId, orchModel, statusId, subtasks, mode]
  )

  const updateSubtask = (id: string, patch: Partial<EditorSubtask>) =>
    setSubtasks(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)))
  const removeSubtask = (id: string) =>
    setSubtasks(prev => prev.filter(s => s.id !== id).map(s => (s.dependsOn === id ? { ...s, dependsOn: null } : s)))
  const addSubtask = () =>
    setSubtasks(prev => [
      ...prev,
      { id: uid(), title: '', model: SONNET, dependsOn: prev[prev.length - 1]?.id ?? null },
    ])

  const slug = slugify(title) || 'untitled-task'

  return (
    <div className="flex h-full flex-col gap-3 bg-background p-3 text-foreground">
      {/* Header */}
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 shadow-minimal">
        <Btn variant="ghost" className="px-2">
          <ChevronLeft className="h-4 w-4" strokeWidth={2} /> Board
        </Btn>
        <span className="text-foreground/25">/</span>
        <span className="text-sm font-semibold">New Task</span>
        {/* Disclaimer demoted to a quiet inline note (was a loud amber pill). */}
        <span className="inline-flex items-center gap-1 text-[11px] text-foreground/40">
          <Clock3 className="h-3 w-3" strokeWidth={2} /> prepares only — nothing runs yet
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Btn
            variant="secondary"
            onClick={() => toast('Draft saved', { description: `workspace/tasks/${slug}.yaml` })}
          >
            Save draft
          </Btn>
          <Btn
            variant="primary"
            onClick={() =>
              title.trim()
                ? toast.success('Task prepared', {
                    description:
                      mode === 'generate'
                        ? `Wrote ${slug}.yaml · created the orchestrator session — it drafts subtasks on first run. Dispatch from the board.`
                        : `Wrote ${slug}.yaml · created parent + ${subtasks.length} pending subtask session(s). Run from the board.`,
                  })
                : toast.error('Add a title first')
            }
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} /> Prepare task
          </Btn>
        </div>
      </div>

      {/* Body: two columns */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(380px,2fr)_3fr] gap-3">
        {/* Left — task definition */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-minimal">
          <div className="text-[15px] font-bold">Task definition</div>

          {/* mode toggle */}
          <div className="inline-flex w-fit rounded-[9px] bg-foreground/[0.05] p-0.5">
            {(['generate', 'manual'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
                  mode === m ? 'bg-card text-foreground shadow-minimal' : 'text-foreground/55 hover:text-foreground/80'
                )}
              >
                {m === 'generate' && <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />}
                {m === 'generate' ? 'Generate' : 'Manual'}
              </button>
            ))}
          </div>

          {/* title */}
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-foreground/55">Title</div>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Name this task…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13.5px] font-semibold outline-none focus:border-foreground/25"
            />
          </div>

          {/* goal */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[12px] font-semibold text-foreground/55">Goal / prompt</span>
              <span className="text-[10.5px] text-foreground/35">orchestrator's first message</span>
            </div>
            <textarea
              value={goal}
              onChange={e => setGoal(e.target.value)}
              rows={4}
              placeholder="Describe the goal…"
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:border-foreground/25 field-sizing-content max-h-48"
            />
          </div>

          {/* meta selects */}
          <div className="flex flex-col gap-3">
            <FieldRow label="Project">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SelectButton style={{ width: 168 }}>
                    {project ? (
                      <>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
                        <span className="truncate">{project.name}</span>
                      </>
                    ) : (
                      <span className="text-foreground/50">No project</span>
                    )}
                  </SelectButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuItem className="text-xs" onSelect={() => setProjectId('')}>
                    No project
                    {!projectId && <Check className="ml-auto h-3.5 w-3.5" strokeWidth={2} />}
                  </DropdownMenuItem>
                  {mockProjects.map(p => (
                    <DropdownMenuItem key={p.id} className="text-xs" onSelect={() => setProjectId(p.id)}>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="truncate">{p.name}</span>
                      {projectId === p.id && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </FieldRow>

            <FieldRow label="Orchestrator model">
              <ModelSelect value={orchModel} onChange={setOrchModel} />
            </FieldRow>

            <FieldRow label="Initial status">
              <Popover>
                <PopoverTrigger asChild>
                  <SelectButton style={{ width: 168 }}>
                    {status && (
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: status.resolvedColor }} />
                    )}
                    <span className="truncate">{status?.label ?? statusId}</span>
                  </SelectButton>
                </PopoverTrigger>
                <PopoverContent align="end" sideOffset={4} className="w-auto border-0 bg-transparent p-0 shadow-none">
                  <SessionStatusMenu states={mockStatuses} activeState={statusId} onSelect={setStatusId} />
                </PopoverContent>
              </Popover>
            </FieldRow>
          </div>
        </div>

        {/* Right — subtask editor (Manual) or AI hand-off (Generate).
            The editable list is a *Manual-mode* affordance: in Generate mode the
            orchestrator authors the subtasks, so there's nothing to hand-edit. */}
        <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card shadow-minimal">
          {mode === 'manual' ? (
            <>
              <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
                <span className="text-[15px] font-bold">Subtasks</span>
                <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-foreground/[0.06] px-1.5 text-[11px] font-bold text-foreground/55">
                  {subtasks.length}
                </span>
                <Btn variant="secondary" size="sm" className="ml-auto" onClick={addSubtask}>
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Add subtask
                </Btn>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
                {subtasks.map((st, i) => (
                  <SubtaskCard
                    key={st.id}
                    index={i}
                    subtask={st}
                    earlier={subtasks.slice(0, i)}
                    onChange={patch => updateSubtask(st.id, patch)}
                    onRemove={() => removeSubtask(st.id)}
                  />
                ))}
                {subtasks.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-6">
                    <button
                      onClick={addSubtask}
                      className="flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-border py-2.5 text-[12.5px] font-semibold text-foreground/40 transition-colors hover:border-foreground/30 hover:text-foreground/60"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Add subtask
                    </button>
                    <p className="px-1 text-center text-[12px] text-foreground/40">
                      No subtasks yet — add the first one to define the breakdown.
                    </p>
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-border/60 px-4 py-2.5 text-[10.5px] text-foreground/40">
                Reorder by drag · each subtask spawns a child session (pending) · models route per-subtask
              </div>
            </>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
                <span className="text-[15px] font-bold">Subtasks</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-indigo-500 dark:text-indigo-300">
                  <Sparkles className="h-2.5 w-2.5" strokeWidth={2.5} /> AI
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-indigo-500/10 text-indigo-500 dark:text-indigo-300">
                    <Sparkles className="h-6 w-6" strokeWidth={2} />
                  </div>
                  <div className="text-[14px] font-bold">AI generates the subtasks</div>
                  <p className="max-w-[340px] text-[12.5px] leading-relaxed text-foreground/55">
                    When you prepare this task, the orchestrator ({modelName(orchModel)}) reads your goal and
                    breaks it into subtasks — picking a best-fit model and wiring dependencies for each. You
                    don't define them here.
                  </p>
                  <Btn variant="ghost" size="sm" onClick={() => setMode('manual')}>
                    Or author them by hand →
                  </Btn>
                </div>
              </div>

              <div className="shrink-0 border-t border-border/60 px-4 py-2.5 text-[10.5px] text-foreground/40">
                Drafted on Prepare · each becomes a pending child session · models route per-subtask
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom — live YAML (collapsible, to reclaim vertical space) */}
      <div className="rounded-xl border border-border bg-card shadow-minimal">
        <button
          type="button"
          onClick={() => setYamlOpen(o => !o)}
          aria-expanded={yamlOpen}
          className="flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left transition-colors hover:bg-foreground/[0.02]"
        >
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-foreground/45 transition-transform', yamlOpen ? 'rotate-0' : '-rotate-90')}
            strokeWidth={2}
          />
          <span className="font-mono text-[13px] font-bold">task.yaml</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[11px] font-medium text-foreground/55">
            <Hash className="h-3 w-3" strokeWidth={2} />
            workspace/tasks/{slug}.yaml
          </span>
          <span className="ml-auto text-[11px] text-foreground/40">
            {yamlOpen ? 'generated · editable · written on Prepare' : 'click to preview'}
          </span>
        </button>
        {yamlOpen && (
          <div className="px-4 pb-4">
            <div className="max-h-[210px] overflow-auto rounded-lg border border-border/60 bg-foreground/[0.025] p-3">
              <div className="font-mono text-[11.5px] leading-[1.55]">
                {yaml.split('\n').map((ln, i) => (
                  <YamlLine key={i} line={ln} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const taskEditorComponents: ComponentEntry[] = [
  {
    id: 'task-editor',
    name: 'Task Editor',
    category: 'Kanban',
    description:
      "Full-pane editor opened from 'Add Task'. Two modes for how subtasks come to exist: Generate — write a goal and let the orchestrator draft the subtasks (model routing + dependencies) when the task runs; Manual — author them by hand. The subtask editor only appears in Manual mode. Nothing runs here — Prepare writes a task.yaml under Workspace/tasks/ and creates the orchestrator session (plus the pending subtask sessions in Manual mode), which you then dispatch from the board. The YAML preview is live. (Buttons toast; this is a UI mock — no real files/sessions.)",
    component: TaskEditorPreview,
    layout: 'full',
    props: [
      {
        name: 'mode',
        description: 'Starting mode',
        control: { type: 'select', options: [{ label: 'Generate', value: 'generate' }, { label: 'Manual', value: 'manual' }] },
        defaultValue: 'generate',
      },
    ],
    variants: [
      { name: 'Generate', description: 'AI drafts the subtasks from the goal at run time — no manual list', props: { mode: 'generate' } },
      { name: 'Manual', description: 'Author the subtasks by hand', props: { mode: 'manual' } },
    ],
    mockData: () => ({}),
  },
]
