import * as React from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom, updateSessionMetaAtom, type SessionMeta } from '@/atoms/sessions'
import { projectsAtom } from '@/atoms/projects'
import { kanbanProjectFilterAtom, kanbanColumnStatusAtom, kanbanEditorTargetAtom } from '@/atoms/kanban'
import { useNavigation } from '@/contexts/NavigationContext'
import { useProjectColorTreatment } from '@/hooks/useProjectColorTreatment'
import { useLabels } from '@/hooks/useLabels'
import { getSessionTitle } from '@/utils/session'
import { routes } from '@/lib/navigate'
import { resolveTaskScopeLabelId } from '@craft-agent/shared/labels'
import { DEFAULT_MODEL, getModelShortName } from '@config/models'
import { getDefaultModelsForConnection, type LlmConnectionWithStatus } from '@config/llm-connections'
import type { SessionStatus } from '@/config/session-status-config'
import type { KanbanColumnDef } from '@craft-agent/shared/projects/types'
import { KanbanBoard } from './KanbanBoard'
import { KANBAN_COLUMNS, statusToColumn } from './status-column'
import { BoardListToggle } from './BoardListToggle'
import { KanbanProjectFilter, type KanbanProjectFilterOption } from './KanbanProjectFilter'
import { TaskEditor } from './TaskEditor'
import { mergeSubtaskRows, type SpecNodeSummary, type SubtaskChildRow } from './subtask-merge'
import type { SpecNode } from './task-spec-form'
import type {
  KanbanColumnId,
  KanbanColumnMeta,
  KanbanModelProviderGroup,
  KanbanProject,
  KanbanTask,
  SubtaskRunState,
} from './types'

/**
 * Subtask run-state from the child session. A closed status wins (done), then an
 * in-flight turn (running). A subtask that has exchanged at least one message has
 * been dispatched — in the create-then-run flow these are one-shot, so a finished
 * turn reads as done. Only a created-but-never-run child (no messages) is pending —
 * and that is exactly what the tile's Play button dispatches. `lastMessageAt` can't
 * carry this distinction: the server stamps it at creation time as a sort key.
 */
function deriveRunState(child: SessionMeta, statusesById: Map<string, SessionStatus>): SubtaskRunState {
  if (statusesById.get(child.sessionStatus ?? '')?.category === 'closed') return 'done'
  // The Conductor marks a failed node 'needs-review' (there is no 'failed' session
  // status), so within a task that reads as a failed subtask on the board. v1 heuristic;
  // the precise source is the run-log node-state (P1 inspector wires the live run snapshot).
  if (child.sessionStatus === 'needs-review') return 'failed'
  if (child.isProcessing) return 'running'
  if ((child.messageCount ?? 0) > 0) return 'done'
  return 'pending'
}

/**
 * Build the subtask composer's provider→model catalog from the workspace's
 * authenticated LLM connections, plus a model-id → connection-slug map so a
 * spawned subtask routes to the connection that actually serves the model.
 * Model-id collisions across connections are last-wins (acceptable for v1).
 */
function buildModelCatalog(connections: LlmConnectionWithStatus[]): {
  groups: KanbanModelProviderGroup[]
  modelToConnection: Map<string, string>
} {
  const groups: KanbanModelProviderGroup[] = []
  const modelToConnection = new Map<string, string>()

  for (const conn of connections) {
    if (!conn.isAuthenticated) continue
    const rawModels = conn.models?.length
      ? conn.models
      : getDefaultModelsForConnection(conn.providerType, conn.piAuthProvider)
    const models = rawModels.map(m => {
      const id = typeof m === 'string' ? m : m.id
      const name = typeof m === 'string' ? getModelShortName(m) : m.name || getModelShortName(m.id)
      return { id, name }
    })
    if (models.length === 0) continue
    for (const m of models) modelToConnection.set(m.id, conn.slug)
    // Provider key drives the brand icon: 'anthropic' resolves directly; Pi
    // connections resolve through their piAuthProvider (see resolveProviderIcon in TaskTile).
    const provider = conn.providerType === 'anthropic' ? 'anthropic' : conn.piAuthProvider || conn.providerType
    groups.push({ provider, label: conn.name, models })
  }

  return { groups, modelToConnection }
}

/**
 * Live Kanban board. Derives tiles from the session metadata map: top-level
 * sessions become task tiles, child sessions (those carrying a `parentSessionId`)
 * become subtask rows under their parent. Column placement comes from the
 * persisted `kanbanColumn`, falling back to the session status' default column;
 * the status badge is independent from the column.
 */
export function KanbanBoardContainer() {
  const { activeWorkspaceId, llmConnections, sessionStatuses, onCreateSession, onSendMessage, onJumpToTaskSessions } =
    useAppShellContext()
  const { t } = useTranslation()
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const projects = useAtomValue(projectsAtom)
  const [projectFilter, setProjectFilter] = useAtom(kanbanProjectFilterAtom)
  const [columnStatus, setColumnStatus] = useAtom(kanbanColumnStatusAtom)
  const treatment = useProjectColorTreatment()
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)
  const { navigate, navigateToSession } = useNavigation()
  // Label tree for resolving the reserved Task label (scoped tile-click navigation).
  const { labels: labelConfigs } = useLabels(activeWorkspaceId ?? null)

  // Keep the (module-global) board project filter scoped to the current workspace + live projects:
  //  • on workspace switch, clear it — the previous workspace's project ids are meaningless here;
  //  • otherwise prune ids whose project no longer exists (e.g. after a delete) so the board can't
  //    stay filtered to nothing. Identity-preserving returns avoid needless re-renders/loops.
  const prevWorkspaceRef = React.useRef(activeWorkspaceId)
  React.useEffect(() => {
    if (prevWorkspaceRef.current !== activeWorkspaceId) {
      prevWorkspaceRef.current = activeWorkspaceId
      setProjectFilter(prev => (prev.length ? [] : prev))
      return
    }
    setProjectFilter(prev => {
      if (prev.length === 0) return prev
      const live = prev.filter(id => projects.some(p => p.config.id === id))
      return live.length === prev.length ? prev : live
    })
  }, [activeWorkspaceId, projects, setProjectFilter])

  const [expandedTaskIds, setExpandedTaskIds] = React.useState<Set<string>>(() => new Set())

  // Full-pane Task editor overlays the board pane (no global route needed). "Add task" opens it in
  // create mode; the tile "Edit task" affordance opens it in edit mode pointed at that session.
  // Atom-backed (not local state) so the chat header's "Edit task" can set the target and
  // navigate here — the overlay is already open when the board mounts. Declared before the
  // spec fetch below, which refetches when the editor closes (a save may have changed specs).
  const [editorTarget, setEditorTarget] = useAtom(kanbanEditorTargetAtom)

  const statusesById = React.useMemo(() => {
    const map = new Map<string, SessionStatus>()
    for (const status of sessionStatuses ?? []) map.set(status.id, status)
    return map
  }, [sessionStatuses])

  const projectsById = React.useMemo(() => {
    const map = new Map<string, KanbanProject>()
    for (const project of projects) {
      const color = project.config.color
      // Only color-bearing projects need an entry; a tile without one renders plain.
      if (!color) continue
      map.set(project.config.id, { id: project.config.id, name: project.config.name, color })
    }
    return map
  }, [projects])

  // Every project (with or without a color) is selectable in the header filter.
  const projectOptions = React.useMemo<KanbanProjectFilterOption[]>(
    () => projects.map(p => ({ id: p.config.id, name: p.config.name, color: p.config.color })),
    [projects]
  )

  const { groups: subtaskModelGroups, modelToConnection } = React.useMemo(
    () => buildModelCatalog(llmConnections),
    [llmConnections]
  )

  // Per-project columns apply only when exactly one project is in focus — the
  // cross-project "all tasks" view always uses the default 3 columns so it stays
  // coherent. `editingProject` is that single project (column editing is a project
  // property, so it's only offered here).
  const editingProject = React.useMemo(
    () => (projectFilter.length === 1 ? projects.find(p => p.config.id === projectFilter[0]) : undefined),
    [projectFilter, projects]
  )

  // The active column set: the focused project's custom columns when it defines
  // any, otherwise the default built-ins. Custom defs map straight onto the
  // presentational meta (verbatim `name`, no i18n key).
  const activeColumns = React.useMemo<readonly KanbanColumnMeta[]>(() => {
    const custom = editingProject?.config.kanbanColumns
    if (custom?.length) {
      return custom.map(c => ({ id: c.id, name: c.name, color: c.color, dropStatusId: c.dropStatusId }))
    }
    return KANBAN_COLUMNS
  }, [editingProject])

  const usingProjectColumns = !!editingProject?.config.kanbanColumns?.length

  // ---------------------------------------------------------------------------
  // Spec node summaries for spec-backed tiles, keyed by task slug. The tile merges
  // these with live child sessions (see mergeSubtaskRows) so authored-but-never-run
  // nodes show as pending rows. Refetched when the slug set changes and whenever the
  // editor closes — a save/generate may have rewritten any task.yaml.
  // ---------------------------------------------------------------------------
  const [specNodesBySlug, setSpecNodesBySlug] = React.useState<ReadonlyMap<string, SpecNodeSummary[]>>(
    () => new Map()
  )

  const specSlugsKey = React.useMemo(() => {
    const slugs = new Set<string>()
    for (const meta of metaMap.values()) {
      if (meta.parentSessionId || meta.isArchived || meta.hidden || meta.taskDraft) continue
      if (meta.taskSlug) slugs.add(meta.taskSlug)
    }
    return [...slugs].sort().join(',')
  }, [metaMap])

  const editorOpen = editorTarget != null
  React.useEffect(() => {
    if (!activeWorkspaceId || editorOpen) return
    const slugs = specSlugsKey ? specSlugsKey.split(',') : []
    if (slugs.length === 0) {
      setSpecNodesBySlug(new Map())
      return
    }
    let cancelled = false
    void Promise.all(
      slugs.map(async (slug): Promise<readonly [string, SpecNodeSummary[]]> => {
        try {
          const res = await window.electronAPI.getTask(activeWorkspaceId, slug)
          const spec = res.spec as { defaults?: { model?: string }; nodes?: SpecNode[] } | undefined
          const defaultModel = spec?.defaults?.model
          return [
            slug,
            (spec?.nodes ?? []).map(n => ({ id: n.id, title: n.title || n.id, model: n.model ?? defaultModel })),
          ]
        } catch {
          // Unreadable spec → empty node list: the tile falls back to children-only rows.
          return [slug, []]
        }
      })
    ).then(entries => {
      if (!cancelled) setSpecNodesBySlug(new Map(entries))
    })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, specSlugsKey, editorOpen])

  const tasks = React.useMemo(() => {
    const childrenByParent = new Map<string, SessionMeta[]>()
    for (const meta of metaMap.values()) {
      if (!meta.parentSessionId) continue
      const siblings = childrenByParent.get(meta.parentSessionId)
      if (siblings) siblings.push(meta)
      else childrenByParent.set(meta.parentSessionId, [meta])
    }

    const result: KanbanTask[] = []
    for (const meta of metaMap.values()) {
      if (meta.parentSessionId) continue
      if (meta.isArchived || meta.hidden || meta.taskDraft) continue
      const statusId = meta.sessionStatus ?? 'todo'
      // Placement is the persisted free-string column, else the status' default column.
      // Validity against the *active* column set is enforced by KanbanBoard (unknown
      // ids fall back to the first column), so no built-in-only guard is needed here.
      const column = meta.kanbanColumn ?? statusToColumn(statusId)
      const children: SubtaskChildRow[] = (childrenByParent.get(meta.id) ?? []).map(child => ({
        id: child.id,
        title: getSessionTitle(child),
        runState: deriveRunState(child, statusesById),
        model: child.model ?? DEFAULT_MODEL,
        taskNodeId: child.taskNodeId,
        createdAt: child.createdAt,
      }))
      // Spec-backed tiles show one row per DAG node (bound to its latest child session,
      // or pending when never run) plus unadopted quick-adds; plain tiles show children.
      const specNodes = meta.taskSlug ? specNodesBySlug.get(meta.taskSlug) : undefined
      const subtasks = mergeSubtaskRows(specNodes, children, DEFAULT_MODEL)
      result.push({
        id: meta.id,
        title: getSessionTitle(meta),
        column,
        statusId,
        model: meta.model ?? DEFAULT_MODEL,
        projectId: meta.projectId,
        taskSlug: meta.taskSlug,
        subtasks,
        // With merged spec rows the list already contains every node, so it IS the
        // denominator; the header count only backstops the not-yet-fetched window.
        subtaskTotal: specNodes?.length ? undefined : meta.taskNodeCount,
        isFlagged: meta.isFlagged,
        isProcessing: meta.isProcessing,
        createdAt: meta.createdAt,
        lastMessageAt: meta.lastMessageAt,
        messageCount: meta.messageCount,
        costUsd: meta.tokenUsage?.costUsd,
      })
    }
    return result
  }, [metaMap, statusesById, specNodesBySlug])

  // Project filter: empty selection = show all. While a filter is active, tiles
  // with no project are hidden (an explicit "No project" option is a later add).
  const visibleTasks = React.useMemo(() => {
    if (projectFilter.length === 0) return tasks
    const allow = new Set(projectFilter)
    return tasks.filter(task => task.projectId !== undefined && allow.has(task.projectId))
  }, [tasks, projectFilter])

  const defaultSubtaskModel = modelToConnection.has(DEFAULT_MODEL) ? DEFAULT_MODEL : undefined

  const handleToggleSubtasks = React.useCallback((taskId: string) => {
    setExpandedTaskIds(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }, [])

  const handleAddSubtask = React.useCallback(
    async (taskId: string, title: string, model: string) => {
      if (!activeWorkspaceId) return
      const llmConnection = modelToConnection.get(model)
      // Create only — the subtask lands as a pending row. The title is stored as
      // the session `name` so it shows on the row, is recovered as the prompt when
      // Play dispatches it, and suppresses AI title-gen. Execution is deferred.
      // applyTaskLabel: the child inherits the parent's task::N (numbering a
      // plain-chat parent in the same pass — it becomes a task by gaining a subtask).
      await onCreateSession(activeWorkspaceId, {
        parentSessionId: taskId,
        model,
        ...(llmConnection ? { llmConnection } : {}),
        name: title,
        applyTaskLabel: true,
      })
      setExpandedTaskIds(prev => new Set(prev).add(taskId))
    },
    [activeWorkspaceId, modelToConnection, onCreateSession]
  )

  // Tile Play. Spec-backed tasks start a Conductor run of the whole DAG (tasks:run —
  // the runner drives child creation, statuses, and columns; it throws if a run is
  // already active). Plain tiles dispatch every pending quick-add child directly: the
  // prompt is the child's `name` (set at creation), with `isProcessing` flipped
  // optimistically so the row spins immediately and a double-click is a no-op.
  const handleRunSubtasks = React.useCallback(
    (taskId: string) => {
      const meta = metaMap.get(taskId)
      if (activeWorkspaceId && meta?.taskSlug) {
        window.electronAPI
          .runTask(activeWorkspaceId, { slug: meta.taskSlug, orchestratorSessionId: taskId })
          .catch((err: unknown) => {
            toast.error(t('tasks.toastRunFailed'), {
              description: err instanceof Error ? err.message : String(err),
            })
          })
        return
      }
      for (const child of metaMap.values()) {
        if (child.parentSessionId !== taskId) continue
        // Skip Conductor-owned children: the TaskRunner drives their lifecycle (prompts,
        // status, retries). Dispatching them manually would double-run and race the runner.
        if (child.taskRunId) continue
        if (deriveRunState(child, statusesById) !== 'pending') continue
        const prompt = child.name?.trim()
        if (!prompt) continue
        onSendMessage(child.id, prompt)
        updateSessionMeta(child.id, { isProcessing: true })
      }
    },
    [metaMap, statusesById, onSendMessage, updateSessionMeta, activeWorkspaceId, t]
  )

  // Create a parent task tile in place — no navigation. It lands in ToDo (no
  // kanbanColumn + todo status → todo column). While a project filter is active,
  // bind the new task to the first selected project so it stays visible under the
  // filter (an unbound task would be hidden the moment it's created).
  const handleCreateTask = React.useCallback(
    async (title: string) => {
      if (!activeWorkspaceId) return
      const boundProjectId = projectFilter[0]
      await onCreateSession(activeWorkspaceId, {
        name: title,
        sessionStatus: 'todo',
        ...(boundProjectId ? { projectId: boundProjectId } : {}),
        applyTaskLabel: true,
      })
    },
    [activeWorkspaceId, onCreateSession, projectFilter]
  )

  // Change a task's status badge directly (independent from its column). Mirrors
  // the move handler's optimistic-then-persist shape so the badge reflows before
  // the RPC lands.
  const handleChangeStatus = React.useCallback(
    (taskId: string, statusId: string) => {
      updateSessionMeta(taskId, { sessionStatus: statusId })
      void window.electronAPI.sessionCommand(taskId, { type: 'setSessionStatus', state: statusId })
    },
    [updateSessionMeta]
  )

  const handleMoveTask = React.useCallback(
    (taskId: string, toColumn: KanbanColumnId) => {
      // Optimistic: the column derives from `kanbanColumn` first, so writing it
      // immediately reflows the tile before the RPC lands.
      updateSessionMeta(taskId, { kanbanColumn: toColumn })
      void window.electronAPI.sessionCommand(taskId, { type: 'setKanbanColumn', column: toColumn })
      // Optionally fold the status to the column's configured target. Project
      // columns carry their own `dropStatusId`; the default view reads the global
      // atom. Guarded on a known status so a stale mapping is a no-op.
      const autoStatus = activeColumns.find(c => c.id === toColumn)?.dropStatusId ?? columnStatus[toColumn]
      if (autoStatus && statusesById.has(autoStatus)) {
        handleChangeStatus(taskId, autoStatus)
      }
    },
    [updateSessionMeta, activeColumns, columnStatus, statusesById, handleChangeStatus]
  )

  // Persist a full ordered column set onto the focused project. The `projects:changed`
  // broadcast refreshes `projectsAtom`, so the board reflows without optimistic state.
  const persistProjectColumns = React.useCallback(
    (columns: KanbanColumnDef[]) => {
      if (!activeWorkspaceId || !editingProject) return
      void window.electronAPI.updateProject(activeWorkspaceId, editingProject.config.slug, {
        kanbanColumns: columns,
      })
    },
    [activeWorkspaceId, editingProject]
  )

  // The project's current custom set, or — on first customization — a seed
  // materialized from the active (default) columns. The seed reuses the built-in
  // ids so existing card placement survives, and freezes the default labels in the
  // user's current language (thereafter user-authored, like the project name).
  const resolveEditableColumns = React.useCallback((): KanbanColumnDef[] => {
    const custom = editingProject?.config.kanbanColumns
    if (custom?.length) return custom.map(c => ({ ...c }))
    return activeColumns.map(c => ({
      id: c.id,
      name: c.name ?? (c.labelKey ? t(c.labelKey) : c.id),
      color: c.color,
      dropStatusId: c.dropStatusId,
    }))
  }, [editingProject, activeColumns, t])

  const handleAddColumn = React.useCallback(() => {
    const base = resolveEditableColumns()
    const id = `col-${crypto.randomUUID().slice(0, 8)}`
    persistProjectColumns([...base, { id, name: t('kanban.column.newColumnName') }])
  }, [resolveEditableColumns, persistProjectColumns, t])

  const handleUpdateColumn = React.useCallback(
    (columnId: string, patch: Partial<KanbanColumnDef>) => {
      const next = resolveEditableColumns().map(c => (c.id === columnId ? { ...c, ...patch } : c))
      persistProjectColumns(next)
    },
    [resolveEditableColumns, persistProjectColumns]
  )

  const handleRemoveColumn = React.useCallback(
    (columnId: string) => {
      const remaining = resolveEditableColumns().filter(c => c.id !== columnId)
      const fallbackId = remaining[0]?.id
      // Reassign orphaned cards to the first remaining column so none disappears
      // (optimistic per-task, mirroring handleMoveTask).
      if (fallbackId) {
        for (const task of visibleTasks) {
          if (task.column !== columnId) continue
          updateSessionMeta(task.id, { kanbanColumn: fallbackId })
          void window.electronAPI.sessionCommand(task.id, { type: 'setKanbanColumn', column: fallbackId })
        }
      }
      persistProjectColumns(remaining)
    },
    [resolveEditableColumns, persistProjectColumns, visibleTasks, updateSessionMeta]
  )

  // Set the status auto-applied when a task is dropped into a column (header picker).
  // In single-project view this persists onto the project column's `dropStatusId`;
  // the default/all view edits the global atom (shared with AppearanceSettingsPage,
  // so board header and Settings stay in sync).
  const handleSelectDropStatus = React.useCallback(
    (column: KanbanColumnId, statusId: string) => {
      if (editingProject) {
        handleUpdateColumn(column, { dropStatusId: statusId || undefined })
        return
      }
      setColumnStatus(prev => {
        const next = { ...prev }
        if (statusId) next[column] = statusId
        else delete next[column]
        return next
      })
    },
    [editingProject, handleUpdateColumn, setColumnStatus]
  )

  // Board clicks land on All Sessions with the task's scope applied as the NORMAL,
  // user-clearable header-chip filters: label filter = the session's per-task item
  // label (`TASK-<slug>-<N>` — exactly this task's family; legacy root-only sessions
  // fall back to the Task root), project filter = the task's project (when bound).
  // Sessions without any task label (plain chats) fall back to plain navigation.
  // `projectFallbackId` lets subtask rows inherit the parent tile's project when
  // the child session itself carries none (older quick-add subtasks).
  const openSessionScoped = React.useCallback(
    (sessionId: string, projectFallbackId?: string) => {
      const meta = metaMap.get(sessionId)
      const scopeLabelId = resolveTaskScopeLabelId(meta?.labels, labelConfigs)
      if (scopeLabelId && onJumpToTaskSessions) {
        onJumpToTaskSessions(sessionId, {
          labelId: scopeLabelId,
          projectId: meta?.projectId ?? projectFallbackId,
        })
        return
      }
      navigateToSession(sessionId)
    },
    [metaMap, labelConfigs, onJumpToTaskSessions, navigateToSession]
  )

  const handleEditTask = React.useCallback(
    (taskId: string) => {
      const meta = metaMap.get(taskId)
      setEditorTarget({
        mode: 'edit',
        sessionId: taskId,
        taskSlug: meta?.taskSlug,
        initialTitle: meta ? getSessionTitle(meta) : undefined,
      })
    },
    [metaMap]
  )

  if (editorTarget && activeWorkspaceId) {
    return (
      <TaskEditor
        workspaceId={activeWorkspaceId}
        target={editorTarget}
        onClose={() => setEditorTarget(null)}
        onOpenSession={
          editorTarget.mode === 'edit'
            ? () => {
                const sessionId = editorTarget.sessionId
                setEditorTarget(null)
                navigateToSession(sessionId)
              }
            : undefined
        }
        onOpenChildSession={(sessionId) => {
          setEditorTarget(null)
          navigateToSession(sessionId)
        }}
        onCreated={({ sessionId, taskLabelId, projectId: createdProjectId }) => {
          // Same human-clearable scope as a tile click; no label (fail-soft) → plain open.
          if (taskLabelId && onJumpToTaskSessions) {
            onJumpToTaskSessions(sessionId, { labelId: taskLabelId, projectId: createdProjectId })
          } else {
            navigateToSession(sessionId)
          }
        }}
        modelGroups={subtaskModelGroups}
        modelToConnection={modelToConnection}
        defaultModel={defaultSubtaskModel ?? DEFAULT_MODEL}
      />
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-sm font-medium">{t('kanban.allTasks')}</span>
          {projectOptions.length > 0 && (
            <KanbanProjectFilter projects={projectOptions} value={projectFilter} onChange={setProjectFilter} />
          )}
          {usingProjectColumns && editingProject && (
            <span className="truncate text-[11px] text-foreground/45">
              {t('kanban.column.columnsFrom', { project: editingProject.config.name })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditorTarget({ mode: 'create', initialProjectId: projectFilter[0] })}
            disabled={!activeWorkspaceId}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.03] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> {t('kanban.newTask')}
          </button>
          <BoardListToggle
            value="board"
            onChange={view => {
              if (view === 'list') navigate(routes.view.allSessions())
            }}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <KanbanBoard
          columns={activeColumns}
          tasks={visibleTasks}
          projectsById={projectsById}
          statusesById={statusesById}
          statuses={sessionStatuses ?? []}
          onChangeStatus={handleChangeStatus}
          treatment={treatment}
          expandedTaskIds={expandedTaskIds}
          onTaskClick={openSessionScoped}
          onEditTask={handleEditTask}
          onToggleSubtasks={handleToggleSubtasks}
          onSubtaskClick={(taskId, subtaskId) => openSessionScoped(subtaskId, metaMap.get(taskId)?.projectId)}
          onAddSubtask={handleAddSubtask}
          onRunSubtasks={handleRunSubtasks}
          subtaskModelGroups={subtaskModelGroups}
          defaultSubtaskModel={defaultSubtaskModel}
          onCreateTask={handleCreateTask}
          onMoveTask={handleMoveTask}
          columnDropStatus={columnStatus}
          onSelectDropStatus={handleSelectDropStatus}
          {...(editingProject
            ? {
                onUpdateColumn: handleUpdateColumn,
                onRemoveColumn: handleRemoveColumn,
                onAddColumn: handleAddColumn,
              }
            : {})}
        />
      </div>
    </div>
  )
}
