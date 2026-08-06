import * as React from 'react'
import { ChevronLeft, ChevronDown, Sparkles, Plus, Trash2, Check, X, ExternalLink, RefreshCw, CheckCircle2, XCircle, CircleSlash, DatabaseZap, Zap, Folder } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Spinner, LoadingIndicator, Markdown } from '@craft-agent/ui'
import { ANTHROPIC_MODELS, DEFAULT_MODEL, getModelShortName } from '@config/models'
import { useAtomValue, useStore } from 'jotai'
import { useProjects } from '@/hooks/useProjects'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { KanbanModelProviderGroup, TaskEditorTarget } from './types'
import { uid, buildSpec, specToSubtasks, canDependOn, quickAddNodeId, quickAddChildToSubtask, DEFAULT_REPAIR_ATTEMPTS, MAX_REPAIR_ATTEMPTS_CAP, type EditorSubtask, type TaskPermissionMode } from './task-spec-form'
import { resolveNodeStatePill } from './node-state-pill'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SourceSelectorPopover } from '@/components/ui/SourceSelectorPopover'
import { SkillSelectorPopover } from '@/components/ui/SkillSelectorPopover'
import { WorkingDirectorySelector } from '../input/WorkingDirectorySelector'
import type { LoadedSource, LoadedSkill } from '../../../../shared/types'

// Client-side fallback for async generate: a touch longer than the server's GENERATE_TIMEOUT_MS
// (180s) so the orchestrator's own timeout + result push can land before we give up locally.
const GENERATE_CLIENT_TIMEOUT_MS = 200_000

/**
 * TaskEditor — full-pane authoring surface for a Tasks DAG (graduated from the
 * playground demo). Manual mode authors the node list by hand; it serializes to a
 * TaskSpec and (via tasks:create + tasks:run) writes a task.yaml, creates the
 * orchestrator parent session, and starts the Conductor.
 *
 * The spec is sent as JSON (a valid YAML subset) so there is no hand-rolled YAML
 * escaping; the backend re-serializes it to real YAML on save.
 *
 * Generate scaffolds an editable research→plan→implement chain from the goal so
 * you start from a runnable shape and refine it. (LLM-authored generation — the
 * orchestrator drafting the graph — is the next increment.)
 */

// ---------------------------------------------------------------------------
// Model catalog — real provider→model groups (from the workspace's connections),
// with an Anthropic fallback when nothing is connected yet.
// ---------------------------------------------------------------------------
const FALLBACK_MODEL_GROUPS: KanbanModelProviderGroup[] = [
  { provider: 'anthropic', label: 'Anthropic', models: ANTHROPIC_MODELS.map((m) => ({ id: m.id, name: m.name })) },
]
function resolveModelName(groups: KanbanModelProviderGroup[], id: string): string {
  for (const g of groups) {
    const hit = g.models.find((m) => m.id === id)
    if (hit) return hit.name
  }
  return getModelShortName(id)
}

type Mode = 'generate' | 'manual'
type Tab = 'definition' | 'results'

// The target type lives in ./types so the editor-target atom can import it without
// pulling in this component module; re-exported here for existing consumers.
export type { TaskEditorTarget } from './types'

/** Storage-backed run results (shape inferred from the electronAPI so no shared import is needed). */
type TaskResults = Awaited<ReturnType<typeof window.electronAPI.getTaskResults>>

// ---------------------------------------------------------------------------
// Small inline controls (presentational)
// ---------------------------------------------------------------------------
type BtnVariant = 'primary' | 'secondary' | 'ghost'
const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: 'bg-indigo-500 text-white hover:bg-indigo-600',
  secondary: 'border border-border bg-card text-foreground hover:bg-foreground/[0.03]',
  ghost: 'text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground',
}

function Btn({
  variant = 'secondary',
  className,
  ...rest
}: { variant?: BtnVariant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12.5px] font-semibold transition-colors',
        'disabled:pointer-events-none disabled:opacity-60',
        BTN_VARIANT[variant],
        className,
      )}
      {...rest}
    />
  )
}

// MUST forward the ref: Radix's <DropdownMenuTrigger asChild> attaches a ref to
// this element to anchor the menu. A function component without forwardRef drops
// that ref and the dropdown fails to open/position.
const SelectButton = React.forwardRef<
  HTMLButtonElement,
  { size?: 'sm' | 'md' } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function SelectButton({ size = 'md', children, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background font-medium text-foreground',
        'transition-colors hover:bg-foreground/[0.03] data-[state=open]:bg-foreground/[0.03]',
        size === 'sm' ? 'h-7 px-2 text-[11.5px]' : 'h-8 px-2.5 text-[12.5px]',
        className,
      )}
      {...rest}
    >
      {children}
      <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-foreground/40" strokeWidth={2} />
    </button>
  )
})

function ModelSelect({
  value,
  onChange,
  groups,
  width = 168,
  size = 'md',
}: {
  value: string
  onChange: (id: string) => void
  groups: KanbanModelProviderGroup[]
  width?: number
  size?: 'sm' | 'md'
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SelectButton size={size} style={{ width }}>
          <span className="truncate">{resolveModelName(groups, value)}</span>
        </SelectButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[320px] min-w-[180px]">
        {groups.map((g, gi) => (
          <React.Fragment key={`${g.provider}-${gi}`}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] text-foreground/50">{g.label}</DropdownMenuLabel>
            {g.models.map((m) => (
              <DropdownMenuItem key={m.id} className="text-xs" onSelect={() => onChange(m.id)}>
                <span className="truncate">{m.name}</span>
                {m.id === value && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
              </DropdownMenuItem>
            ))}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

/**
 * Overlapping avatar stack for the selector triggers — mirrors the chat input's
 * source badge (first three avatars, then a "+N" chip).
 */
function AvatarStack({ avatars }: { avatars: React.ReactNode[] }) {
  const display = avatars.slice(0, 3)
  const remaining = avatars.length - 3
  return (
    <div className="-ml-0.5 flex shrink-0 items-center">
      {display.map((node, i) => (
        <div
          key={i}
          className={cn(
            'relative flex h-5 w-5 items-center justify-center rounded-[4px] bg-background shadow-minimal',
            i > 0 && '-ml-1',
          )}
          style={{ zIndex: i + 1 }}
        >
          {node}
        </div>
      ))}
      {remaining > 0 && (
        <div
          className="-ml-1 flex h-5 w-5 items-center justify-center rounded-[4px] bg-background text-[8px] font-medium text-muted-foreground shadow-minimal"
          style={{ zIndex: display.length + 1 }}
        >
          +{remaining}
        </div>
      )}
    </div>
  )
}

/**
 * Sources picker — the chat input's source dropdown (SourceSelectorPopover:
 * avatar rows + filter + check) fronted by the form's bordered SelectButton
 * trigger with a leading avatar stack.
 */
function SourcesField({
  sources,
  values,
  onChange,
  title,
}: {
  sources: LoadedSource[]
  values: string[]
  onChange: (next: string[]) => void
  title?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  const selected = values
    .map((slug) => sources.find((s) => s.config.slug === slug))
    .filter((s): s is LoadedSource => Boolean(s))
  const firstName = selected[0]?.config.name ?? values[0]
  const label =
    values.length === 0 ? t('tasks.noneSelected') : values.length === 1 ? firstName : `${firstName} +${values.length - 1}`
  const toggle = (slug: string) =>
    onChange(values.includes(slug) ? values.filter((v) => v !== slug) : [...values, slug])
  return (
    <>
      <SelectButton
        ref={anchorRef}
        style={{ width: 168 }}
        title={title}
        data-state={open ? 'open' : 'closed'}
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected.length === 0 ? (
          <DatabaseZap className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={2} />
        ) : (
          <AvatarStack avatars={selected.map((s) => <SourceAvatar key={s.config.slug} source={s} size="xs" />)} />
        )}
        <span className={cn('min-w-0 flex-1 truncate text-left', values.length === 0 && 'text-foreground/50')}>{label}</span>
      </SelectButton>
      <SourceSelectorPopover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        sources={sources}
        selectedSlugs={values}
        onToggleSlug={toggle}
      />
    </>
  )
}

/**
 * Skills picker — parallel to {@link SourcesField} using SkillSelectorPopover
 * and SkillAvatar (workspace-scoped icons).
 */
function SkillsField({
  skills,
  values,
  onChange,
  workspaceId,
  title,
}: {
  skills: LoadedSkill[]
  values: string[]
  onChange: (next: string[]) => void
  workspaceId: string
  title?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  const selected = values
    .map((slug) => skills.find((s) => s.slug === slug))
    .filter((s): s is LoadedSkill => Boolean(s))
  const firstName = selected[0]?.metadata.name ?? values[0]
  const label =
    values.length === 0 ? t('tasks.noneSelected') : values.length === 1 ? firstName : `${firstName} +${values.length - 1}`
  const toggle = (slug: string) =>
    onChange(values.includes(slug) ? values.filter((v) => v !== slug) : [...values, slug])
  return (
    <>
      <SelectButton
        ref={anchorRef}
        style={{ width: 168 }}
        title={title}
        data-state={open ? 'open' : 'closed'}
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected.length === 0 ? (
          <Zap className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={2} />
        ) : (
          <AvatarStack avatars={selected.map((s) => <SkillAvatar key={s.slug} skill={s} size="xs" workspaceId={workspaceId} />)} />
        )}
        <span className={cn('min-w-0 flex-1 truncate text-left', values.length === 0 && 'text-foreground/50')}>{label}</span>
      </SelectButton>
      <SkillSelectorPopover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        skills={skills}
        selectedSlugs={values}
        onToggleSlug={toggle}
        workspaceId={workspaceId}
      />
    </>
  )
}

/**
 * Working-directory picker — reuses the chat input's folder selector
 * (WorkingDirectorySelector: recent folders, filter, Choose Folder) behind the
 * form's SelectButton trigger.
 */
function FolderField({
  cwd,
  onChange,
  workspaceId,
}: {
  cwd: string
  onChange: (path: string) => void
  workspaceId: string
}) {
  const { t } = useTranslation()
  return (
    <WorkingDirectorySelector
      workingDirectory={cwd || undefined}
      onWorkingDirectoryChange={onChange}
      workspaceId={workspaceId}
      side="bottom"
      align="start"
      renderTrigger={({ hasFolder, folderName }) => (
        <SelectButton style={{ width: 168 }} title={t('tasks.workingDirectoryHint')}>
          <Folder className="h-3.5 w-3.5 shrink-0 text-foreground/40" strokeWidth={2} />
          <span className={cn('min-w-0 flex-1 truncate text-left', !hasFolder && 'text-foreground/50')}>
            {folderName ?? t('chat.workInFolder')}
          </span>
        </SelectButton>
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Subtask card (includes the required prompt)
// ---------------------------------------------------------------------------
function SubtaskCard({
  index,
  subtask,
  allSubtasks,
  groups,
  fallbackModel,
  modelToConnection,
  onChange,
  onRemove,
}: {
  index: number
  subtask: EditorSubtask
  /** Every row, so dependency chips resolve titles (incl. forward edges) and add-candidates can be cycle-filtered. */
  allSubtasks: EditorSubtask[]
  groups: KanbanModelProviderGroup[]
  /** Effective model shown when the node has no explicit one (it inherits the orchestrator default). */
  fallbackModel: string
  /** model id → connection slug, so picking a model pins the connection that serves it. */
  modelToConnection: Map<string, string>
  onChange: (patch: Partial<EditorSubtask>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const titleByUid = new Map(allSubtasks.map((s) => [s.uid, s.title]))
  const depTitle = (depUid: string) => titleByUid.get(depUid) || t('tasks.untitledSubtask')
  const addDep = (depUid: string) => onChange({ dependsOn: [...subtask.dependsOn, depUid] })
  const removeDep = (depUid: string) => onChange({ dependsOn: subtask.dependsOn.filter((d) => d !== depUid) })
  // Candidates exclude self, already-selected, and any edge that would close a cycle.
  const candidates = allSubtasks.filter(
    (s) => !subtask.dependsOn.includes(s.uid) && canDependOn(allSubtasks, subtask.uid, s.uid),
  )
  return (
    <div className="group rounded-[10px] border border-border/70 bg-foreground/[0.015] p-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-500/10 text-[12px] font-bold text-indigo-500 dark:text-indigo-300">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <input
            value={subtask.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={t('tasks.subtaskTitlePlaceholder')}
            className="w-full bg-transparent text-[13.5px] font-semibold text-foreground outline-none placeholder:text-foreground/30"
          />
          <textarea
            value={subtask.prompt}
            onChange={(e) => onChange({ prompt: e.target.value })}
            rows={2}
            placeholder={t('tasks.promptPlaceholder')}
            className="mt-1.5 w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1.5 text-[12px] leading-relaxed outline-none focus:border-foreground/25 field-sizing-content max-h-40"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ModelSelect
              value={subtask.model ?? fallbackModel}
              onChange={(id) => onChange({ model: id, llmConnection: modelToConnection.get(id) })}
              groups={groups}
              width={128}
              size="sm"
            />
            {subtask.dependsOn.map((depUid) => (
              <span
                key={depUid}
                className="inline-flex h-7 max-w-[168px] items-center gap-1 rounded-lg border border-border bg-foreground/[0.03] pl-2 pr-1 text-[11.5px] font-medium text-foreground/70"
              >
                <span className="truncate">{t('tasks.dependsOnLabel', { title: depTitle(depUid) })}</span>
                <button
                  type="button"
                  onClick={() => removeDep(depUid)}
                  aria-label={t('tasks.removeDependency')}
                  className="grid h-4 w-4 shrink-0 place-items-center rounded text-foreground/40 hover:bg-foreground/10 hover:text-red-500"
                >
                  <X className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </span>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SelectButton size="sm" style={{ width: 144 }}>
                  <span className="truncate text-foreground/70">
                    {subtask.dependsOn.length === 0 ? t('tasks.noDependencies') : t('tasks.addDependency')}
                  </span>
                </SelectButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-w-[240px]">
                {candidates.map((c) => (
                  <DropdownMenuItem key={c.uid} className="text-xs" onSelect={() => addDep(c.uid)}>
                    <span className="truncate">{c.title || t('tasks.untitledSubtask')}</span>
                  </DropdownMenuItem>
                ))}
                {candidates.length === 0 && (
                  <div className="px-2 py-1.5 text-[11px] text-foreground/40">{t('tasks.noAvailableSubtasks')}</div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('tasks.removeSubtask')}
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
export interface TaskEditorProps {
  workspaceId: string
  /** What the editor points at: create-new or edit an existing tile. Defaults to create. */
  target?: TaskEditorTarget
  /** Return to the board. */
  onClose: () => void
  /** Jump to the underlying orchestrator chat session (edit mode only). */
  onOpenSession?: () => void
  /** Jump to a specific child/subtask session (used by Results "Open session" links). */
  onOpenChildSession?: (sessionId: string) => void
  /**
   * Fired after a successful CREATE (never for edit-mode saves) so the host can land the
   * user somewhere useful — e.g. the session list scoped to the task. `taskLabelId` is the
   * RESOLVED reserved-label id from tasks:create (may be 'task-2' after a name collision).
   */
  onCreated?: (created: { sessionId: string; taskLabelId?: string; projectId?: string }) => void
  /** Real provider→model groups (from the workspace's LLM connections). */
  modelGroups: KanbanModelProviderGroup[]
  /** model id → connection slug that serves it (so each node routes to the right backend). */
  modelToConnection: Map<string, string>
  /** Default model id. */
  defaultModel: string
}

export function TaskEditor({
  workspaceId,
  target = { mode: 'create' },
  onClose,
  onOpenSession,
  onOpenChildSession,
  onCreated,
  modelGroups,
  modelToConnection,
  defaultModel,
}: TaskEditorProps) {
  const { t } = useTranslation()
  const isEdit = target.mode === 'edit'
  // The slug to pin on save (edit mode). Undefined for create and for quick-add tiles with no slug;
  // in those cases buildSpec derives the id from the title.
  const editSlug = target.mode === 'edit' ? target.taskSlug : undefined
  const editSessionId = target.mode === 'edit' ? target.sessionId : undefined
  const groups = modelGroups.length > 0 ? modelGroups : FALLBACK_MODEL_GROUPS
  const fallbackModel = defaultModel || groups[0]?.models[0]?.id || DEFAULT_MODEL
  const { projects } = useProjects(workspaceId)
  const [tab, setTab] = React.useState<Tab>('definition')
  const [mode, setMode] = React.useState<Mode>('manual')
  const [title, setTitle] = React.useState('')
  const [goal, setGoal] = React.useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState('')
  // Empty string = "use the runner default"; a number pins the spec's max_iterations.
  const [maxRepairs, setMaxRepairs] = React.useState('')
  // Create mode seeds the project from the board's active filter (so a new card stays
  // visible under that filter); edit mode starts empty and is prefilled from the spec below.
  const [projectId, setProjectId] = React.useState(target.mode === 'create' ? (target.initialProjectId ?? '') : '')
  const [orchModel, setOrchModel] = React.useState(fallbackModel)
  // Explicit connection serving the orch model; undefined lets buildSpec derive it from orchModel.
  // Preserved from the loaded spec so an authored connection isn't rewritten on save (round-trip).
  const [orchConnection, setOrchConnection] = React.useState<string | undefined>(undefined)
  // Task-family permission mode. New UI tasks default to autonomous (Execute/allow-all) so product
  // behavior is unchanged; edit mode prefills from the spec. Persisted to defaults.permissionMode so
  // subtask autonomy is explicit + visible, never a hidden runner default.
  const [permissionMode, setPermissionMode] = React.useState<TaskPermissionMode>('allow-all')
  // The task's project binding at load (edit mode). Floor for buildSpec so leaving the picker on
  // "No Project" can't silently drop a binding, and the gate for whether "No Project" is offered.
  const [boundProjectId, setBoundProjectId] = React.useState('')
  const [subtasks, setSubtasks] = React.useState<EditorSubtask[]>([])
  const [cwd, setCwd] = React.useState('')
  // Task-level sources (enabled on orchestrator + children) and skills (read as context
  // before each child works). Empty = leave workspace defaults / no skill preamble.
  const [sourceSlugs, setSourceSlugs] = React.useState<string[]>([])
  const [skillSlugs, setSkillSlugs] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)

  // Pickable catalogs from the active workspace (AppShell keeps these atoms populated).
  const workspaceSources = useAtomValue(sourcesAtom)
  const workspaceSkills = useAtomValue(skillsAtom)
  // Sources are the task-level pickable catalog (children inherit them); skills are
  // read as context before each child. Both feed the icon-rich selector fields below.
  const enabledSources = React.useMemo(
    () => workspaceSources.filter((s) => s.config.enabled !== false),
    [workspaceSources],
  )

  // Results tab (edit mode): storage-backed run outcome, loaded lazily on tab open / refresh.
  const [results, setResults] = React.useState<TaskResults | null>(null)
  const [resultsLoading, setResultsLoading] = React.useState(false)

  // Jotai store handle for one-shot reads (no subscription — the editor must not re-render
  // on every streaming metadata tick just to have read children once at open).
  const store = useStore()

  /**
   * The tile's quick-add children as editor rows, so hand-spawned subtasks show up (and get
   * adopted into the spec on save) instead of living only on the tile. Each row carries the
   * deterministic node id `qa-<sessionId>`; a child whose qa-id is already a spec node was
   * adopted by a previous save and is skipped. Conductor-owned children (`taskNodeId`) are
   * executions of spec nodes — the node row already represents them.
   */
  const collectQuickAddRows = React.useCallback(
    (adoptedNodeIds: ReadonlySet<string>): EditorSubtask[] => {
      if (!editSessionId) return []
      const metaMap = store.get(sessionMetaMapAtom)
      const children = [...metaMap.values()]
        .filter(
          (child) =>
            child.parentSessionId === editSessionId &&
            !child.taskNodeId &&
            !child.hidden &&
            !child.isArchived &&
            !adoptedNodeIds.has(quickAddNodeId(child.id)),
        )
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      return children.map((child) => {
        // Quick-add contract: the typed title is the session name AND the dispatch prompt. Preserve the
        // child's explicit model + connection (custom-routed children must not lose their backend).
        const title = child.name?.trim() || getSessionTitle(child)
        return quickAddChildToSubtask({ sessionId: child.id, title, model: child.model, llmConnection: child.llmConnection })
      })
    },
    // fallbackModel is stable for the life of an open editor (same reasoning as the prefill effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, editSessionId],
  )

  // Edit-mode prefill: spec-backed tiles load their authored task.yaml; either way the tile's
  // quick-add children merge in as editable rows (adopted into the spec on the next save).
  React.useEffect(() => {
    if (target.mode !== 'edit') return
    let cancelled = false
    // The tile's existing project binding (spec-less quick-add tiles have no spec.project, so fall
    // back to the session's own projectId) — prefilled into the picker and kept as the buildSpec floor.
    const sessionMeta = editSessionId ? store.get(sessionMetaMapAtom).get(editSessionId) : undefined
    const sessionProjectId = sessionMeta?.projectId ?? ''
    if (target.taskSlug) {
      void window.electronAPI
        .getTask(workspaceId, target.taskSlug)
        .then((res) => {
          if (cancelled) return
          const spec = res.spec as
            | { title?: string; goal?: string; acceptance_criteria?: string; max_iterations?: number; project?: string; cwd?: string; sources?: string[]; skills?: string[]; defaults?: { model?: string; llmConnection?: string; permissionMode?: TaskPermissionMode }; nodes?: Array<{ id: string; title?: string; prompt?: string; model?: string; llmConnection?: string; depends_on?: string[] }> }
            | undefined
          if (!spec) return
          if (spec.title) setTitle(spec.title)
          if (spec.goal) setGoal(spec.goal)
          setAcceptanceCriteria(spec.acceptance_criteria ?? '')
          setMaxRepairs(spec.max_iterations != null ? String(spec.max_iterations) : '')
          // Bind from the spec, else the session's existing binding. Record it as the immutable floor.
          const bound = spec.project ?? sessionProjectId
          setProjectId(bound)
          setBoundProjectId(bound)
          if (spec.cwd) setCwd(spec.cwd)
          setSourceSlugs(spec.sources ?? [])
          setSkillSlugs(spec.skills ?? [])
          if (spec.defaults?.model) setOrchModel(spec.defaults.model)
          // Preserve the authored orchestrator connection + permission mode (round-trip, no silent rewrite).
          // Fall back to the session's actual mode so saving a bound tile can't silently escalate it.
          setOrchConnection(spec.defaults?.llmConnection)
          if (spec.defaults?.permissionMode) setPermissionMode(spec.defaults.permissionMode)
          else if (sessionMeta?.permissionMode) setPermissionMode(sessionMeta.permissionMode as TaskPermissionMode)
          const nodes = spec.nodes ?? []
          setSubtasks([
            ...specToSubtasks(nodes),
            ...collectQuickAddRows(new Set(nodes.map((n) => n.id))),
          ])
        })
        .catch(() => {})
    } else {
      if (target.initialTitle) setTitle(target.initialTitle)
      // A bound quick-add tile with no task.yaml: prefill + floor from the session's own state, so
      // saving it as a task neither drops its project nor silently changes its permission mode.
      setProjectId(sessionProjectId)
      setBoundProjectId(sessionProjectId)
      if (sessionMeta?.permissionMode) setPermissionMode(sessionMeta.permissionMode as TaskPermissionMode)
      setSubtasks(collectQuickAddRows(new Set()))
    }
    return () => {
      cancelled = true
    }
    // Prefill runs once per target identity; fallbackModel is stable enough for this load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.mode, editSessionId, editSlug, workspaceId])

  const loadResults = React.useCallback(() => {
    if (!editSlug) return
    setResultsLoading(true)
    void window.electronAPI
      .getTaskResults(workspaceId, editSlug)
      .then((res) => setResults(res))
      .catch(() => {})
      .finally(() => setResultsLoading(false))
  }, [workspaceId, editSlug])

  // Load results when the Results tab is first opened (and there's a slug to read).
  React.useEffect(() => {
    if (tab === 'results' && editSlug && !results && !resultsLoading) loadResults()
  }, [tab, editSlug, results, resultsLoading, loadResults])

  // Async generate: tasks:generate returns the orchestrator session id immediately and the
  // authored spec arrives later via the onTaskGenerated push event. We track the pending
  // orchestrator id so the listener only reacts to *our* generation, plus a client-side
  // fallback timer so the spinner can't hang forever if the event never lands.
  const pendingGenRef = React.useRef<string | null>(null)
  const genTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // A completed-but-unadopted generate orchestrator (hidden `taskDraft` session). Submit adopts it
  // in place — editing the authored spec is fine, since the draft is just the conductor orchestrator
  // and spec edits run on it. Discarded on regenerate/close; cleared once adopted so the unmount
  // cleanup never deletes a live orchestrator (#bug1).
  const generatedDraftRef = React.useRef<string | null>(null)

  const discardDraft = React.useCallback((sessionId: string) => {
    void window.electronAPI.deleteSession(sessionId).catch(() => {})
  }, [])

  const finishGenerate = React.useCallback(() => {
    pendingGenRef.current = null
    if (genTimeoutRef.current) {
      clearTimeout(genTimeoutRef.current)
      genTimeoutRef.current = null
    }
    setBusy(false)
  }, [])

  const project = projects.find((p) => p.config.id === projectId)

  const updateSubtask = (id: string, patch: Partial<EditorSubtask>) =>
    setSubtasks((prev) => prev.map((s) => (s.uid === id ? { ...s, ...patch } : s)))
  const removeSubtask = (id: string) =>
    setSubtasks((prev) =>
      prev.filter((s) => s.uid !== id).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== id) })),
    )
  const addSubtask = () =>
    setSubtasks((prev) => {
      const last = prev[prev.length - 1]
      // No explicit model → the new subtask inherits the orchestrator default (the picker still shows
      // that effective model). Picking a model in the row makes it explicit.
      return [...prev, { uid: uid(), title: '', prompt: '', dependsOn: last ? [last.uid] : [] }]
    })

  // Generate mode: the persistent orchestrator session AUTHORS the task.yaml from the goal,
  // then we drop into Manual so the user reviews/edits the AI's plan before running — the
  // generate → edit → run loop (#2 / architecture §3a).
  // Apply a generated spec to the editor (or surface its failure). Runs from the
  // onTaskGenerated listener once the orchestrator finishes authoring.
  const applyGeneratedSpec = React.useCallback(
    (res: { orchestratorSessionId: string; spec?: unknown; validation: { valid: boolean; errors: Array<{ path: string; message: string }> }; error?: string }) => {
      if (res.error) {
        // The hidden draft orchestrator can't produce a usable spec — discard it so it doesn't
        // linger off-board.
        discardDraft(res.orchestratorSessionId)
        toast.error(t('tasks.toastCreateFailed'), { description: res.error })
        return
      }
      const spec = res.spec as
        | { title?: string; goal?: string; acceptance_criteria?: string; max_iterations?: number; defaults?: { model?: string; llmConnection?: string; permissionMode?: TaskPermissionMode }; nodes?: Array<{ id: string; title?: string; prompt?: string; model?: string; llmConnection?: string; depends_on?: string[] }> }
        | undefined
      if (!spec || !res.validation.valid) {
        discardDraft(res.orchestratorSessionId)
        const first = res.validation.errors[0]
        toast.error(t('tasks.toastInvalid'), { description: first ? `${first.path}: ${first.message}` : undefined })
        return
      }
      if (spec.title) setTitle(spec.title)
      if (spec.goal) setGoal(spec.goal)
      setAcceptanceCriteria(spec.acceptance_criteria ?? '')
      setMaxRepairs(spec.max_iterations != null ? String(spec.max_iterations) : '')
      // Adopt the generator's routing only when it explicitly authored it — don't wipe the user's picks.
      if (spec.defaults?.model) setOrchModel(spec.defaults.model)
      if (spec.defaults?.llmConnection) setOrchConnection(spec.defaults.llmConnection)
      if (spec.defaults?.permissionMode) setPermissionMode(spec.defaults.permissionMode)
      setSubtasks(specToSubtasks(spec.nodes ?? []))
      setMode('manual')
      // Record the draft as adoptable: submit reuses it in place (edits are fine to run on it).
      generatedDraftRef.current = res.orchestratorSessionId
      // No success toast here: switching to Manual mode and populating the Subtasks panel is
      // the visible signal. A top-right toast would also overlap the editor's top-right
      // Cancel/Create/Create & Run buttons and swallow their clicks.
    },
    [t, fallbackModel, discardDraft],
  )

  // Subscribe once for async generate results; ignore events for other generations/sessions.
  React.useEffect(() => {
    const off = window.electronAPI.onTaskGenerated((_wsId, res) => {
      if (res.orchestratorSessionId !== pendingGenRef.current) return
      finishGenerate()
      applyGeneratedSpec(res)
    })
    return off
  }, [finishGenerate, applyGeneratedSpec])

  // Clear any pending fallback timer on unmount, and discard a draft orchestrator that was never
  // adopted (editor closed/cancelled after generating). Best-effort — a dropped delete only leaves
  // a hidden draft, never a visible board tile.
  React.useEffect(() => () => {
    if (genTimeoutRef.current) clearTimeout(genTimeoutRef.current)
    const draftId = generatedDraftRef.current
    if (draftId) {
      generatedDraftRef.current = null
      void window.electronAPI.deleteSession(draftId).catch(() => {})
    }
  }, [])

  async function generatePlan() {
    const g = goal.trim() || title.trim()
    if (!g) {
      toast.error(t('tasks.toastNeedTitle'))
      return
    }
    // Regenerating abandons any previously authored draft — discard it before minting a new one.
    if (generatedDraftRef.current) {
      discardDraft(generatedDraftRef.current)
      generatedDraftRef.current = null
    }
    setBusy(true)
    try {
      const ack = await window.electronAPI.generateTask(workspaceId, {
        goal: g,
        title: title.trim() || undefined,
        model: orchModel,
        // Route the authoring turn through the preserved connection (falls back to the model's default),
        // and give the draft the project context + sources + autonomy it will author against — else a
        // pi/* model produces nothing and the draft runs at the workspace-default permission mode.
        llmConnection: orchConnection ?? modelToConnection.get(orchModel),
        permissionMode,
        ...(projectId ? { projectId } : {}),
        ...(sourceSlugs.length ? { enabledSourceSlugs: sourceSlugs } : {}),
        cwd: cwd.trim() || undefined,
      })
      // Authoring continues on the server; the spec arrives via onTaskGenerated. Keep busy until
      // then, with a fallback timer that releases the spinner if the event never lands.
      pendingGenRef.current = ack.orchestratorSessionId
      if (genTimeoutRef.current) clearTimeout(genTimeoutRef.current)
      genTimeoutRef.current = setTimeout(() => {
        if (pendingGenRef.current !== ack.orchestratorSessionId) return
        finishGenerate()
        toast.error(t('tasks.toastCreateFailed'), { description: t('tasks.toastGenerateTimeout') })
      }, GENERATE_CLIENT_TIMEOUT_MS)
    } catch (err) {
      finishGenerate()
      toast.error(t('tasks.toastCreateFailed'), { description: err instanceof Error ? err.message : String(err) })
    }
  }

  // Create the task (write task.yaml + orchestrator session). When `run` is true, also start a
  // run; otherwise the task tile just lands on the board in ToDo for the user to run later.
  async function submit(run: boolean) {
    if (!title.trim()) {
      toast.error(t('tasks.toastNeedTitle'))
      return
    }
    if (subtasks.length === 0) {
      toast.error(t('tasks.toastNeedSubtask'))
      return
    }
    if (subtasks.some((s) => !s.prompt.trim())) {
      toast.error(t('tasks.toastNeedPrompt'))
      return
    }
    // Edit mode pins the existing slug so the title can change without forking a new task folder
    // and orphaning the bound orchestrator session.
    const spec = buildSpec(
      {
        title,
        goal,
        acceptanceCriteria,
        maxRepairs: maxRepairs.trim() === '' ? undefined : Number(maxRepairs),
        projectId,
        orchModel,
        orchConnection,
        permissionMode,
        boundProjectId,
        subtasks,
        cwd,
        sourceSlugs,
        skillSlugs,
        fixedId: editSlug,
      },
      modelToConnection,
    )
    const yaml = JSON.stringify(spec, null, 2) // JSON is a valid YAML subset
    // Adopt the generate draft in place whenever we have one — spec edits run fine on the draft
    // orchestrator, so there's no need to mint a fresh session.
    const draftId = generatedDraftRef.current
    setBusy(true)
    try {
      // Edit mode binds the authored spec onto the tile's existing session; create mode reuses
      // a generate draft if present, else mints a fresh orchestrator.
      const created = await window.electronAPI.createTask(workspaceId, {
        yaml,
        ...(isEdit && editSessionId
          ? { attachToExistingSession: editSessionId }
          : { orchestratorSessionId: draftId ?? undefined }),
      })
      if (!created.validation.valid) {
        const first = created.validation.errors[0]
        toast.error(t('tasks.toastInvalid'), { description: first ? `${first.path}: ${first.message}` : undefined })
        return
      }
      // Resolve the draft: if the server reused it, it's now a live orchestrator — stop tracking it.
      // If it minted a fresh session instead (draft gone server-side), discard the orphan.
      if (draftId) {
        if (created.orchestratorSessionId !== draftId) discardDraft(draftId)
        generatedDraftRef.current = null
      }
      // After a successful CREATE, hand off to the host so it can land the user on the
      // task-scoped session list (edit-mode saves stay on the board).
      const notifyCreated = () => {
        if (isEdit) return
        onCreated?.({
          sessionId: created.orchestratorSessionId,
          taskLabelId: created.taskLabelId,
          projectId: projectId || undefined,
        })
      }
      if (!run) {
        toast.success(t('tasks.toastCreated'), { description: t('tasks.toastCreatedDesc', { slug: created.slug }) })
        onClose()
        notifyCreated()
        return
      }
      const runResult = await window.electronAPI.runTask(workspaceId, {
        slug: created.slug,
        orchestratorSessionId: created.orchestratorSessionId,
      })
      toast.success(t('tasks.toastStarted'), {
        description: t('tasks.toastStartedDesc', { slug: created.slug, runId: runResult.runId, count: runResult.nodes.length }),
      })
      onClose()
      notifyCreated()
    } catch (err) {
      toast.error(t('tasks.toastCreateFailed'), { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 bg-background p-3 text-foreground">
      {/* Header */}
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 shadow-minimal">
        <Btn variant="ghost" className="px-2" onClick={onClose}>
          <ChevronLeft className="h-4 w-4" strokeWidth={2} /> {t('kanban.board')}
        </Btn>
        <span className="text-foreground/25">/</span>
        <span className="text-sm font-semibold">{isEdit ? t('tasks.editTask') : t('kanban.newTask')}</span>

        {/* Definition / Results tabs — edit mode only (results need a backing task to read). */}
        {isEdit && (
          <div className="ml-3 inline-flex rounded-[9px] bg-foreground/[0.05] p-0.5">
            {(['definition', 'results'] as Tab[]).map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={cn(
                  'rounded-[7px] px-3 py-1 text-[12.5px] font-semibold transition-colors',
                  tab === tb ? 'bg-card text-foreground shadow-minimal' : 'text-foreground/55 hover:text-foreground/80',
                )}
              >
                {tb === 'definition' ? t('tasks.tabDefinition') : t('tasks.tabResults')}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isEdit && onOpenSession && (
            <Btn variant="secondary" onClick={onOpenSession} disabled={busy}>
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} /> {t('tasks.openSession')}
            </Btn>
          )}
          {tab === 'definition' && (
            <>
              <Btn variant="secondary" onClick={onClose} disabled={busy}>
                {t('common.cancel')}
              </Btn>
              <Btn variant="secondary" onClick={() => submit(false)} disabled={busy}>
                {isEdit ? t('common.save') : t('common.create')}
              </Btn>
              <Btn variant="primary" onClick={() => submit(true)} disabled={busy}>
                {busy ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />}
                {busy ? t('tasks.starting') : isEdit ? t('tasks.saveAndRun') : t('tasks.createAndRun')}
              </Btn>
            </>
          )}
          {tab === 'results' && (
            <Btn variant="secondary" onClick={loadResults} disabled={resultsLoading}>
              {resultsLoading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />} {t('common.refresh')}
            </Btn>
          )}
        </div>
      </div>

      {tab === 'results' ? (
        <ResultsPanel
          results={results}
          loading={resultsLoading}
          onOpenChildSession={onOpenChildSession}
        />
      ) : (
      /* Body */
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,2fr)_3fr] gap-3">
        {/* Left — definition */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-minimal">
          <div className="text-[15px] font-bold">{t('tasks.definition')}</div>

          <div className="inline-flex w-fit rounded-[9px] bg-foreground/[0.05] p-0.5">
            {(['manual', 'generate'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
                  mode === m ? 'bg-card text-foreground shadow-minimal' : 'text-foreground/55 hover:text-foreground/80',
                )}
              >
                {m === 'generate' && <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />}
                {m === 'generate' ? t('tasks.modeGenerate') : t('tasks.modeManual')}
              </button>
            ))}
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-foreground/55">{t('tasks.title')}</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('tasks.titlePlaceholder')}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13.5px] font-semibold outline-none focus:border-foreground/25"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[12px] font-semibold text-foreground/55">{t('tasks.goal')}</span>
              <span className="text-[10.5px] text-foreground/35">{t('tasks.goalHint')}</span>
            </div>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              placeholder={t('tasks.goalPlaceholder')}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:border-foreground/25 field-sizing-content max-h-48"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[12px] font-semibold text-foreground/55">{t('tasks.acceptanceCriteria')}</span>
              <span className="text-[10.5px] text-foreground/35">{t('tasks.acceptanceCriteriaHint')}</span>
            </div>
            <textarea
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              rows={3}
              placeholder={t('tasks.acceptanceCriteriaPlaceholder')}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:border-foreground/25 field-sizing-content max-h-48"
            />
          </div>

          <div className="flex flex-col gap-3">
            <FieldRow label={t('tasks.project')}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SelectButton style={{ width: 168 }}>
                    <span className="truncate">{project ? project.config.name : t('tasks.noProject')}</span>
                  </SelectButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  {/* "No Project" clears the binding — only offered when NOT already bound. The backend
                      never unbinds on save, and buildSpec floors a blank pick to the existing project,
                      so showing it for a bound task would be a no-op that implies clearing works. */}
                  {!boundProjectId && (
                    <DropdownMenuItem className="text-xs" onSelect={() => setProjectId('')}>
                      {t('tasks.noProject')}
                      {!projectId && <Check className="ml-auto h-3.5 w-3.5" strokeWidth={2} />}
                    </DropdownMenuItem>
                  )}
                  {projects.map((p) => (
                    <DropdownMenuItem key={p.config.id} className="text-xs" onSelect={() => setProjectId(p.config.id)}>
                      <span className="truncate">{p.config.name}</span>
                      {projectId === p.config.id && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </FieldRow>

            <FieldRow label={t('tasks.orchestratorModel')}>
              <ModelSelect
                value={orchModel}
                onChange={(m) => {
                  // Keep the connection in step with the model: an unchanged model preserves the loaded
                  // (possibly custom) connection; changing it re-routes to the new model's connection.
                  setOrchModel(m)
                  setOrchConnection(modelToConnection.get(m))
                }}
                groups={groups}
              />
            </FieldRow>

            <FieldRow label={t('tasks.permissionMode')}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SelectButton style={{ width: 168 }}>
                    <span className="truncate">{t(`mode.${permissionMode}`)}</span>
                  </SelectButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  {(['allow-all', 'ask', 'safe'] as const).map((m) => (
                    <DropdownMenuItem key={m} className="text-xs" onSelect={() => setPermissionMode(m)}>
                      <span className="truncate">{t(`mode.${m}`)}</span>
                      {permissionMode === m && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </FieldRow>

            {enabledSources.length > 0 && (
              <FieldRow label={t('tasks.sources')}>
                <SourcesField
                  sources={enabledSources}
                  values={sourceSlugs}
                  onChange={setSourceSlugs}
                  title={t('tasks.sourcesHint')}
                />
              </FieldRow>
            )}

            {workspaceSkills.length > 0 && (
              <FieldRow label={t('tasks.skills')}>
                <SkillsField
                  skills={workspaceSkills}
                  values={skillSlugs}
                  onChange={setSkillSlugs}
                  workspaceId={workspaceId}
                  title={t('tasks.skillsHint')}
                />
              </FieldRow>
            )}

            <FieldRow label={t('tasks.workingDirectory')}>
              <FolderField cwd={cwd} onChange={setCwd} workspaceId={workspaceId} />
            </FieldRow>

            <FieldRow label={t('tasks.maxRepairs')}>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_REPAIR_ATTEMPTS_CAP}
                value={maxRepairs}
                onChange={(e) => setMaxRepairs(e.target.value)}
                placeholder={String(DEFAULT_REPAIR_ATTEMPTS)}
                title={t('tasks.maxRepairsHint')}
                className="h-8 w-[88px] rounded-lg border border-border bg-background px-2.5 text-right text-[12.5px] tabular-nums outline-none focus:border-foreground/25 placeholder:text-foreground/30"
              />
            </FieldRow>
          </div>
        </div>

        {/* Right — subtasks (Manual) / scaffold (Generate) */}
        <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card shadow-minimal">
          {mode === 'manual' ? (
            <>
              <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
                <span className="text-[15px] font-bold">{t('kanban.subtasks')}</span>
                <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-foreground/[0.06] px-1.5 text-[11px] font-bold text-foreground/55">
                  {subtasks.length}
                </span>
                <Btn variant="secondary" className="ml-auto h-7 px-2.5 text-[12px]" onClick={addSubtask}>
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> {t('kanban.addSubtask')}
                </Btn>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
                {subtasks.map((st, i) => (
                  <SubtaskCard
                    key={st.uid}
                    index={i}
                    subtask={st}
                    allSubtasks={subtasks}
                    groups={groups}
                    fallbackModel={orchModel || fallbackModel}
                    modelToConnection={modelToConnection}
                    onChange={(patch) => updateSubtask(st.uid, patch)}
                    onRemove={() => removeSubtask(st.uid)}
                  />
                ))}
                {subtasks.length === 0 && (
                  <button
                    onClick={addSubtask}
                    className="flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-border py-2.5 text-[12.5px] font-semibold text-foreground/40 transition-colors hover:border-foreground/30 hover:text-foreground/60"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> {t('tasks.addFirstSubtask')}
                  </button>
                )}
              </div>

              <div className="shrink-0 border-t border-border/60 px-4 py-2.5 text-[10.5px] text-foreground/40">
                {t('tasks.subtaskFooter')}
              </div>
            </>
          ) : busy ? (
            <div className="flex min-h-full flex-col gap-3 p-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground/70">
                <LoadingIndicator label={t('tasks.generatingTitle')} showElapsed />
              </div>
              <p className="text-[12px] leading-relaxed text-foreground/50">{t('tasks.generatingBody')}</p>
              {/* Skeleton subtask cards: the long author wait reads as "drafting nodes", not frozen. */}
              {[0, 1, 2].map((i) => (
                <div key={i} className="animate-pulse rounded-[10px] border border-border/70 bg-foreground/[0.015] p-3">
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-foreground/[0.06]" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-3.5 w-1/2 rounded bg-foreground/[0.06]" />
                      <div className="h-8 w-full rounded bg-foreground/[0.04]" />
                      <div className="flex gap-1.5">
                        <div className="h-7 w-[128px] rounded-lg bg-foreground/[0.05]" />
                        <div className="h-7 w-[144px] rounded-lg bg-foreground/[0.05]" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-indigo-500/10 text-indigo-500 dark:text-indigo-300">
                <Sparkles className="h-6 w-6" strokeWidth={2} />
              </div>
              <div className="text-[14px] font-bold">{t('tasks.generatePlan')}</div>
              <p className="max-w-[360px] text-[12.5px] leading-relaxed text-foreground/55">{t('tasks.generateBody')}</p>
              <Btn variant="primary" onClick={generatePlan} disabled={busy}>
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} /> {t('tasks.generatePlan')}
              </Btn>
              <span className="text-[11px] text-foreground/40">{t('tasks.generateHint')}</span>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Results panel — storage-backed run outcome (verdict + per-node output).
// ---------------------------------------------------------------------------
function ResultsPanel({
  results,
  loading,
  onOpenChildSession,
}: {
  results: TaskResults | null
  loading: boolean
  onOpenChildSession?: (sessionId: string) => void
}) {
  const { t } = useTranslation()

  if (loading && !results) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-card text-foreground/50 shadow-minimal">
        <Spinner className="text-lg" />
      </div>
    )
  }

  if (!results || !results.runId || results.nodes.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-6 text-center text-foreground/50 shadow-minimal">
        <CircleSlash className="h-6 w-6 text-foreground/30" strokeWidth={2} />
        <p className="text-[12.5px]">{t('tasks.resultsEmpty')}</p>
      </div>
    )
  }

  const verdict = results.verdict
  const verdicts = results.verdicts ?? (verdict ? [verdict] : [])
  const repair = results.repair
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-minimal">
      {results.acceptanceCriteria && (
        <div className="rounded-[10px] border border-border/70 bg-foreground/[0.015] px-3 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-foreground/45">{t('tasks.acceptanceCriteria')}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-foreground/70">{results.acceptanceCriteria}</p>
        </div>
      )}

      {verdict && (
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5',
            verdict.result === 'pass'
              ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
              : verdict.result === 'fail'
                ? 'border-red-500/30 bg-red-500/[0.06]'
                : 'border-border bg-foreground/[0.03]',
          )}
        >
          {verdict.result === 'pass' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2.5} />
          ) : verdict.result === 'fail' ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" strokeWidth={2.5} />
          ) : (
            <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-foreground/40" strokeWidth={2.5} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold">
                {verdict.result === 'pass' ? t('tasks.verdictPass') : verdict.result === 'fail' ? t('tasks.verdictFail') : t('tasks.verdictUnparsed')}
              </span>
              {repair && (
                <span className="ml-auto shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10.5px] font-bold text-foreground/55">
                  {t('tasks.repairAttempt', { used: repair.used, max: repair.max })}
                </span>
              )}
            </div>
            {verdict.reason && <p className="mt-0.5 text-[12px] leading-relaxed text-foreground/65">{verdict.reason}</p>}
            {verdict.nodes && verdict.nodes.length > 0 && (
              <p className="mt-1 text-[11px] text-foreground/45">{t('tasks.repairNodes', { nodes: verdict.nodes.join(', ') })}</p>
            )}
          </div>
        </div>
      )}

      {verdicts.length > 1 && (
        <div className="rounded-[10px] border border-border/70 bg-foreground/[0.015] px-3 py-2.5">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground/45">{t('tasks.verdictHistory')}</div>
          <div className="flex flex-col gap-1">
            {verdicts.map((v, i) => (
              <div key={i} className="flex items-start gap-2 text-[11.5px]">
                {v.result === 'pass' ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2.5} />
                ) : v.result === 'fail' ? (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2.5} />
                ) : (
                  <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/40" strokeWidth={2.5} />
                )}
                <span className="min-w-0 flex-1 text-foreground/60">
                  {v.reason || (v.result === 'pass' ? t('tasks.verdictPass') : v.result === 'fail' ? t('tasks.verdictFail') : t('tasks.verdictUnparsed'))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.nodes.map((node) => {
        const pill = resolveNodeStatePill(node.state)
        return (
        <div key={node.id} className="rounded-[10px] border border-border/70 bg-foreground/[0.015] p-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{node.title}</span>
            <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-bold', pill.className)}>
              {pill.labelKey ? t(pill.labelKey) : node.state}
            </span>
            {node.sessionId && onOpenChildSession && (
              <button
                type="button"
                onClick={() => onOpenChildSession(node.sessionId!)}
                className="inline-flex shrink-0 items-center gap-1 rounded text-[11.5px] font-semibold text-indigo-500 hover:underline dark:text-indigo-300"
              >
                <ExternalLink className="h-3 w-3" strokeWidth={2.5} /> {t('tasks.openSession')}
              </button>
            )}
          </div>
          {node.output ? (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-border/50 bg-background px-3 py-2 text-[12px] leading-relaxed">
              <Markdown>{node.output}</Markdown>
            </div>
          ) : (
            <p className="mt-1.5 text-[11.5px] text-foreground/40">{t('tasks.noOutput')}</p>
          )}
        </div>
        )
      })}
    </div>
  )
}
