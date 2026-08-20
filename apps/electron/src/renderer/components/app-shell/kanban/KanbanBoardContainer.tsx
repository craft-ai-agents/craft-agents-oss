import * as React from 'react'
import { useRef } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { KanbanBoardConfig, KanbanGroupBy } from '@craft-agent/shared/kanban'
import type { SessionPriority } from '@craft-agent/shared/protocol/dto'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom, updateSessionMetaAtom, type SessionMeta } from '@/atoms/sessions'
import { collectionDisplayAtom } from '@/atoms/collection-display'
import { collectionFiltersAtom } from '@/atoms/collection-filters'
import { filterSessionMeta, compareSessions } from '@craft-agent/shared/sessions/collection'
import { projectsAtom } from '@/atoms/projects'
import {
  kanbanProjectFilterAtom,
  kanbanColumnStatusAtom,
  kanbanEditorTargetAtom,
  kanbanColumnColorsAtom,
} from '@/atoms/kanban'
import { useNavigation } from '@/contexts/NavigationContext'
import { useProjectColorTreatment } from '@/hooks/useProjectColorTreatment'
import { useLabels } from '@/hooks/useLabels'
import { getSessionTitle } from '@/utils/session'
import { routes } from '@/lib/navigate'
import { flattenLabels, resolveTaskScopeLabelId } from '@craft-agent/shared/labels'
import { DEFAULT_MODEL, getModelShortName } from '@config/models'
import { getDefaultModelsForConnection, type LlmConnectionWithStatus } from '@config/llm-connections'
import type { SessionStatus } from '@/config/session-status-config'
import { KanbanBoard, type KanbanMoveTarget } from './KanbanBoard'
import { parsePriorityGroupId } from './priority-groups'
import { KANBAN_COLUMNS, statusToColumn } from './status-column'
import { DEFAULT_KANBAN_COLUMN_COLORS } from './kanban-colors'
import { CollectionViewChrome } from '../collection/CollectionViewChrome'
import { CollectionBulkBar } from '../collection/CollectionBulkBar'
import { KanbanProjectFilter, type KanbanProjectFilterOption } from './KanbanProjectFilter'
import { TaskEditor } from './TaskEditor'
import { mergeSubtaskRows, type SpecNodeSummary, type SubtaskChildRow } from './subtask-merge'
import { enqueueKanbanColumnRun, shouldAutoRunOnDrop } from './kanban-column-queue'
import type { SpecNode } from './task-spec-form'
import type {
  BuiltInKanbanColumnId,
  KanbanColumnId,
  KanbanColumnMeta,
  KanbanModelProviderGroup,
  KanbanProject,
  KanbanTask,
  SubtaskRunState,
} from './types'

/**
 * Subtask run-state from the child session. A closed status wins (done), then an
 * in-flight turn (running), then failed, else pending.
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

function groupCollapseStorageKey(workspaceId: string): string {
  return `craft-kanban-group-collapsed:${workspaceId}`
}

function readCollapsedGroups(workspaceId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(groupCollapseStorageKey(workspaceId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function writeCollapsedGroups(workspaceId: string, keys: Set<string>): void {
  try {
    sessionStorage.setItem(groupCollapseStorageKey(workspaceId), JSON.stringify([...keys]))
  } catch {
    // sessionStorage full / unavailable — collapse state is best-effort.
  }
}

/**
 * Merge workspace board config onto the built-in column defs.
 * Config wins for label/color/collapsed/prompt/dropStatus; built-ins keep labelKey
 * as fallback when no override label is set.
 */
function mergeBoardColumns(config: KanbanBoardConfig | null): KanbanColumnMeta[] {
  const builtinById = new Map(KANBAN_COLUMNS.map(c => [c.id, c]))
  const colorDefaults = DEFAULT_KANBAN_COLUMN_COLORS

  if (!config?.columns?.length) {
    return KANBAN_COLUMNS.map(c => ({
      ...c,
      color: colorDefaults[c.id as BuiltInKanbanColumnId],
      collapsed: c.defaultCollapsed ?? false,
    }))
  }

  return config.columns.map(col => {
    const builtin = builtinById.get(col.id as BuiltInKanbanColumnId)
    const isBuiltIn = col.isBuiltIn ?? !!builtin
    return {
      id: col.id,
      labelKey: builtin?.labelKey,
      name: col.label,
      color:
        col.color ??
        (builtin ? colorDefaults[builtin.id] : undefined),
      dropStatusId: col.dropStatusId ?? builtin?.dropStatusId ?? (isBuiltIn ? col.id : undefined),
      defaultCollapsed: builtin?.defaultCollapsed,
      collapsed: col.collapsed ?? builtin?.defaultCollapsed ?? false,
      promptEnabled: col.promptEnabled,
      prompt: col.prompt,
      isBuiltIn,
    } satisfies KanbanColumnMeta
  })
}

/**
 * Live Kanban board. Derives tiles from the session metadata map: top-level
 * sessions become tiles; children become subtask rows. Board column layout,
 * rename/color/prompts, and group-by live in `{workspace}/kanban/config.json`.
 */
export function KanbanBoardContainer() {
  const { activeWorkspaceId, workspaces, llmConnections, sessionStatuses, onCreateSession, onSendMessage, onJumpToTaskSessions } =
    useAppShellContext()
  const { t } = useTranslation()
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const projects = useAtomValue(projectsAtom)
  const [projectFilter, setProjectFilter] = useAtom(kanbanProjectFilterAtom)
  const [columnStatus, setColumnStatus] = useAtom(kanbanColumnStatusAtom)
  const setColumnColors = useSetAtom(kanbanColumnColorsAtom)
  const treatment = useProjectColorTreatment()
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)
  const { navigate, navigateToSession } = useNavigation()
  const { labels: labelConfigs } = useLabels(activeWorkspaceId ?? null)

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
  const [editorTarget, setEditorTarget] = useAtom(kanbanEditorTargetAtom)
  const collectionDisplay = useAtomValue(collectionDisplayAtom)
  const collectionFilters = useAtomValue(collectionFiltersAtom)

  // Workspace board config (columns + groupBy).
  const [boardConfig, setBoardConfig] = React.useState<KanbanBoardConfig | null>(null)
  const boardConfigRef = React.useRef<KanbanBoardConfig | null>(null)
  // Sync-safe loop-guard: metaMap updates are async/batched, so a second drop
  // in the same tick can still see isProcessing=false. Keep an immediate Set.
  const processingRef = useRef(new Set<string>())

  // Drop loop-guard entries once session meta reports idle again.
  React.useEffect(() => {
    for (const id of [...processingRef.current]) {
      if (!metaMap.get(id)?.isProcessing) processingRef.current.delete(id)
    }
  }, [metaMap])

  boardConfigRef.current = boardConfig

  React.useEffect(() => {
    if (!activeWorkspaceId) {
      setBoardConfig(null)
      return
    }
    const remoteWorkspaceId = workspaces.find(w => w.id === activeWorkspaceId)?.remoteServer?.remoteWorkspaceId
    let cancelled = false
    void window.electronAPI.getKanbanConfig(activeWorkspaceId).then(cfg => {
      if (cancelled) return
      setBoardConfig(cfg)
      // One-time migrate localStorage color overrides into file when file has no custom colors.
      try {
        const raw = localStorage.getItem('craft-kanban-column-colors')
        if (raw && cfg) {
          const overrides = JSON.parse(raw) as Record<string, string>
          const keys = Object.keys(overrides)
          if (keys.length > 0) {
            const nextCols = cfg.columns.map(c => {
              const override = overrides[c.id]
              if (!override) return c
              // Prefer localStorage override when file color is missing OR still
              // the stock default — user overrides always win once, then clear.
              const stock =
                DEFAULT_KANBAN_COLUMN_COLORS[c.id as BuiltInKanbanColumnId]
              if (!c.color || (stock && c.color === stock)) {
                return { ...c, color: override }
              }
              return c
            })
            const changed = nextCols.some((c, i) => c.color !== cfg.columns[i]?.color)
            if (changed) {
              const next = { ...cfg, columns: nextCols }
              void window.electronAPI.setKanbanConfig(activeWorkspaceId, next).then(saved => {
                if (!cancelled) setBoardConfig(saved)
              })
              setColumnColors({})
            }
            // One-shot: drop localStorage whether or not file colors changed
            // (overrides for stock defaults already applied above).
            localStorage.removeItem('craft-kanban-column-colors')
          }
        }
      } catch {
        // migrate is best-effort
      }
    }).catch(() => {
      if (!cancelled) setBoardConfig(null)
    })
    const unsub = window.electronAPI.onKanbanConfigChanged((wsId, cfg) => {
      if (wsId === activeWorkspaceId || (!!remoteWorkspaceId && wsId === remoteWorkspaceId)) setBoardConfig(cfg)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [activeWorkspaceId, workspaces, setColumnColors])

  const persistBoardConfig = React.useCallback(
    (next: KanbanBoardConfig) => {
      setBoardConfig(next)
      if (!activeWorkspaceId) return
      void window.electronAPI.setKanbanConfig(activeWorkspaceId, next).then(
        saved => setBoardConfig(saved),
        (err: unknown) => {
          toast.error(t('kanban.toastConfigSaveFailed'), {
            description: err instanceof Error ? err.message : String(err),
          })
        },
      )
    },
    [activeWorkspaceId, t],
  )

  const groupBy: KanbanGroupBy = boardConfig?.groupBy ?? 'project'

  const [collapsedGroupKeys, setCollapsedGroupKeys] = React.useState<Set<string>>(() => new Set())
  React.useEffect(() => {
    if (!activeWorkspaceId) {
      setCollapsedGroupKeys(new Set())
      return
    }
    setCollapsedGroupKeys(readCollapsedGroups(activeWorkspaceId))
  }, [activeWorkspaceId])

  const handleToggleProjectGroup = React.useCallback(
    (groupKey: string) => {
      setCollapsedGroupKeys(prev => {
        const next = new Set(prev)
        if (next.has(groupKey)) next.delete(groupKey)
        else next.add(groupKey)
        if (activeWorkspaceId) writeCollapsedGroups(activeWorkspaceId, next)
        return next
      })
    },
    [activeWorkspaceId],
  )

  const statusesById = React.useMemo(() => {
    const map = new Map<string, SessionStatus>()
    for (const status of sessionStatuses ?? []) map.set(status.id, status)
    return map
  }, [sessionStatuses])

  // All projects for grouping (color optional — group header still works).
  const projectsById = React.useMemo(() => {
    const map = new Map<string, KanbanProject>()
    for (const project of projects) {
      map.set(project.config.id, {
        id: project.config.id,
        name: project.config.name,
        color: project.config.color ?? '#94a3b8',
        slug: project.config.slug,
        icon: project.config.icon,
        workspaceId: project.workspaceId || activeWorkspaceId || undefined,
      })
    }
    return map
  }, [projects, activeWorkspaceId])

  const projectOptions = React.useMemo<KanbanProjectFilterOption[]>(
    () => projects.map(p => ({ id: p.config.id, name: p.config.name, color: p.config.color })),
    [projects],
  )
  const labelOptions = React.useMemo(
    () => flattenLabels(labelConfigs).map(label => ({ id: label.id, name: label.name })),
    [labelConfigs],
  )
  const renderBulkActions = React.useCallback(
    (visibleTaskIds: readonly string[]) => (
      <CollectionBulkBar
        workspaceId={activeWorkspaceId}
        visibleSessionIds={visibleTaskIds}
        statuses={sessionStatuses}
        projects={projectOptions}
        labels={labelOptions}
      />
    ),
    [activeWorkspaceId, labelOptions, projectOptions, sessionStatuses],
  )

  const { groups: subtaskModelGroups, modelToConnection } = React.useMemo(
    () => buildModelCatalog(llmConnections),
    [llmConnections],
  )

  const activeColumns = React.useMemo(
    () => mergeBoardColumns(boardConfig),
    [boardConfig],
  )

  // ---------------------------------------------------------------------------
  // Spec node summaries for spec-backed tiles
  // ---------------------------------------------------------------------------
  const [specNodesBySlug, setSpecNodesBySlug] = React.useState<ReadonlyMap<string, SpecNodeSummary[]>>(
    () => new Map(),
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
          return [slug, []]
        }
      }),
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
    const now = Date.now()
    for (const meta of metaMap.values()) {
      if (meta.parentSessionId) continue
      if (meta.isArchived || meta.hidden || meta.taskDraft) continue
      // B6: honor workspace collection filters (Display.showCompleted EC-5 respects explicit status chips).
      if (!filterSessionMeta(meta, collectionFilters, { showCompleted: collectionDisplay.showCompleted, now, statusById: statusesById })) continue
      const statusId = meta.sessionStatus ?? 'todo'
      const column = meta.kanbanColumn ?? statusToColumn(statusId)
      const children: SubtaskChildRow[] = (childrenByParent.get(meta.id) ?? []).map(child => ({
        id: child.id,
        title: getSessionTitle(child),
        runState: deriveRunState(child, statusesById),
        model: child.model ?? DEFAULT_MODEL,
        taskNodeId: child.taskNodeId,
        createdAt: child.createdAt,
      }))
      const specNodes = meta.taskSlug ? specNodesBySlug.get(meta.taskSlug) : undefined
      const subtasks = mergeSubtaskRows(specNodes, children, DEFAULT_MODEL)
      result.push({
        id: meta.id,
        title: getSessionTitle(meta),
        column,
        statusId,
        model: meta.model ?? DEFAULT_MODEL,
        projectId: meta.projectId,
        priority: meta.priority ?? 'none',
        taskSlug: meta.taskSlug,
        subtasks,
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
  }, [metaMap, statusesById, specNodesBySlug, collectionFilters, collectionDisplay])

  const visibleTasks = React.useMemo(() => {
    if (projectFilter.length === 0) return tasks
    const allow = new Set(projectFilter)
    return tasks.filter(task => task.projectId !== undefined && allow.has(task.projectId))
  }, [tasks, projectFilter])

  const visibleColumns = React.useMemo(() => {
    if (collectionDisplay.showEmptyGroups) return activeColumns
    return activeColumns.filter(column => visibleTasks.some(task => task.column === column.id))
  }, [activeColumns, collectionDisplay.showEmptyGroups, visibleTasks])

  // B6: honor Display.orderBy when ranking cards within each column.
  const displayDrivenSort = React.useCallback(
    (a: KanbanTask, b: KanbanTask): number => {
      const metaA = metaMap.get(a.id)
      const metaB = metaMap.get(b.id)
      if (!metaA || !metaB) return 0
      return compareSessions(metaA, metaB, collectionDisplay.orderBy, collectionDisplay.orderDir)
    },
    [metaMap, collectionDisplay.orderBy, collectionDisplay.orderDir],
  )

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
      await onCreateSession(activeWorkspaceId, {
        parentSessionId: taskId,
        model,
        ...(llmConnection ? { llmConnection } : {}),
        name: title,
        applyTaskLabel: true,
      })
      setExpandedTaskIds(prev => new Set(prev).add(taskId))
    },
    [activeWorkspaceId, modelToConnection, onCreateSession],
  )

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
        if (child.taskRunId) continue
        if (deriveRunState(child, statusesById) !== 'pending') continue
        const prompt = child.name?.trim()
        if (!prompt) continue
        onSendMessage(child.id, prompt)
        updateSessionMeta(child.id, { isProcessing: true })
      }
    },
    [metaMap, statusesById, onSendMessage, updateSessionMeta, activeWorkspaceId, t],
  )

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
    [activeWorkspaceId, onCreateSession, projectFilter],
  )

  const handleChangeStatus = React.useCallback(
    (taskId: string, statusId: string) => {
      updateSessionMeta(taskId, { sessionStatus: statusId })
      void window.electronAPI.sessionCommand(taskId, { type: 'setSessionStatus', state: statusId })
    },
    [updateSessionMeta],
  )

  const handleMoveTask = React.useCallback(
    (taskId: string, to: KanbanColumnId | KanbanMoveTarget) => {
      const target: KanbanMoveTarget = typeof to === 'string' ? { columnId: to } : to
      const toColumn = target.columnId

      // Capture prior column before optimistic writes so same-column project
      // drops never re-trigger auto-run.
      const priorMeta = metaMap.get(taskId)
      const previousColumn: KanbanColumnId =
        (priorMeta?.kanbanColumn as KanbanColumnId | undefined) ??
        statusToColumn(priorMeta?.sessionStatus ?? 'todo')

      // Optimistic column placement.
      updateSessionMeta(taskId, { kanbanColumn: toColumn })
      void window.electronAPI.sessionCommand(taskId, { type: 'setKanbanColumn', column: toColumn })

      // B6: pseudo group '__priority_<value>' assigns priority instead of project (FR-30/FR-47).
      const priorityDrop = parsePriorityGroupId(target.projectId)
      if (priorityDrop !== null) {
        const prio = priorityDrop as SessionPriority
        updateSessionMeta(taskId, { priority: prio })
        void window.electronAPI.sessionCommand(taskId, { type: 'setPriority', priority: prio })
      } else if (target.projectId !== undefined) {
        const nextProjectId = target.projectId
        updateSessionMeta(taskId, {
          projectId: nextProjectId === null ? undefined : nextProjectId,
        })
        void window.electronAPI.sessionCommand(taskId, {
          type: 'setProjectId',
          projectId: nextProjectId,
        })
      }

      // B5: re-rank within destination column when Display orderBy === 'rank'.
      if (collectionDisplay.orderBy === 'rank') {
        const destSiblings = visibleTasks
          .filter((t) => t.column === toColumn)
          .filter((t) => t.id !== taskId)
          .sort(displayDrivenSort)
        const last = destSiblings[destSiblings.length - 1]
        void window.electronAPI.sessionCommand(taskId, {
          type: 'reorderRank',
          prevId: last?.id,
        })
      }

      // Optionally fold the status to the column's configured target.
      const autoStatus =
        activeColumns.find(c => c.id === toColumn)?.dropStatusId ?? columnStatus[toColumn]
      if (autoStatus && statusesById.has(autoStatus)) {
        handleChangeStatus(taskId, autoStatus)
      }

      // P1.4 auto-run hook — only when the column actually changes.
      // In-progress always starts; other columns need prompt.
      const destColumn = activeColumns.find(c => c.id === toColumn)
      if (!activeWorkspaceId) return
      if (previousColumn === toColumn) return
      if (!shouldAutoRunOnDrop(toColumn, destColumn)) return
      const meta = metaMap.get(taskId)
      if (!meta || meta.isProcessing || processingRef.current.has(taskId)) return

      const title = getSessionTitle(meta) || meta.name?.trim() || ''
      const kick = (goalText: string) => {
        enqueueKanbanColumnRun(
          {
            workspaceId: activeWorkspaceId,
            sessionId: taskId,
            columnId: toColumn,
            columnPrompt: destColumn?.prompt?.trim() ?? '',
            title,
            goalText,
            taskSlug: meta.taskSlug,
            enqueuedAt: Date.now(),
          },
          {
            sendMessage: onSendMessage,
            runTask: (wsId, args) => window.electronAPI.runTask(wsId, args),
            isProcessing: id =>
              processingRef.current.has(id) || !!metaMap.get(id)?.isProcessing,
            markProcessing: id => {
              processingRef.current.add(id)
              updateSessionMeta(id, { isProcessing: true })
            },
            onError: (err, job) => {
              processingRef.current.delete(job.sessionId)
              updateSessionMeta(job.sessionId, { isProcessing: false })
              toast.error(t('kanban.toastAutoRunFailed'), {
                description: err instanceof Error ? err.message : String(err),
              })
            },
          },
        )
      }

      // Spec-backed: load goal/acceptance from task.yaml; plain tiles use
      // title + any acceptance/goal-like text from session meta preview.
      if (meta.taskSlug) {
        void window.electronAPI
          .getTask(activeWorkspaceId, meta.taskSlug)
          .then(res => {
            const spec = res.spec as
              | { goal?: string; acceptance_criteria?: string; title?: string }
              | undefined
            const parts = [spec?.goal, spec?.acceptance_criteria].filter(
              (s): s is string => typeof s === 'string' && s.trim().length > 0,
            )
            kick(parts.join('\n\n') || title)
          })
          .catch(() => kick(title))
      } else {
        const preview = typeof meta.preview === 'string' ? meta.preview.trim() : ''
        // Prefer preview when it carries more than the bare title (acceptance/goal context).
        if (preview && preview !== title) {
          kick(preview)
        } else {
          kick(title)
        }
      }
    },
    [
      updateSessionMeta,
      activeColumns,
      collectionDisplay.orderBy,
      columnStatus,
      displayDrivenSort,
      statusesById,
      handleChangeStatus,
      activeWorkspaceId,
      metaMap,
      onSendMessage,
      t,
      visibleTasks,
    ],
  )

  const handleUpdateColumn = React.useCallback(
    (
      columnId: string,
      patch: Partial<{
        name: string
        label: string
        color: string
        dropStatusId: string
        collapsed: boolean
        promptEnabled: boolean
        prompt: string
      }>,
    ) => {
      const current = boardConfigRef.current
      const baseColumns = current?.columns?.length
        ? current.columns.map(c => ({ ...c }))
        : mergeBoardColumns(null).map(c => ({
            id: c.id,
            label: c.name,
            color: c.color,
            collapsed: c.collapsed,
            promptEnabled: c.promptEnabled,
            prompt: c.prompt,
            dropStatusId: c.dropStatusId,
            isBuiltIn: c.isBuiltIn,
          }))

      const nextColumns = baseColumns.map(c => {
        if (c.id !== columnId) return c
        const label = patch.label ?? patch.name
        return {
          ...c,
          ...(label !== undefined ? { label } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          ...(patch.dropStatusId !== undefined
            ? { dropStatusId: patch.dropStatusId || undefined }
            : {}),
          ...(patch.collapsed !== undefined ? { collapsed: patch.collapsed } : {}),
          ...(patch.promptEnabled !== undefined ? { promptEnabled: patch.promptEnabled } : {}),
          ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
        }
      })

      persistBoardConfig({
        version: 1,
        groupBy: current?.groupBy ?? 'project',
        columns: nextColumns,
      })

      // Keep legacy atom in sync for Appearance settings consumers of color overrides.
      if (patch.color !== undefined) {
        setColumnColors(prev => ({ ...prev, [columnId]: patch.color! }))
      }
    },
    [persistBoardConfig, setColumnColors],
  )

  const handleAddColumn = React.useCallback(
    (side: 'left' | 'right' = 'right') => {
      const current = boardConfigRef.current
      const baseColumns = current?.columns?.length
        ? current.columns.map(c => ({ ...c }))
        : mergeBoardColumns(null).map(c => ({
            id: c.id,
            label: c.name,
            color: c.color,
            collapsed: c.collapsed,
            promptEnabled: c.promptEnabled,
            prompt: c.prompt,
            dropStatusId: c.dropStatusId,
            isBuiltIn: c.isBuiltIn,
          }))
      const id = `col-${crypto.randomUUID().slice(0, 8)}`
      const fresh = {
        id,
        label: t('kanban.column.newColumnName'),
        isBuiltIn: false,
        promptEnabled: false,
        prompt: '',
      }
      const columns =
        side === 'left' ? [fresh, ...baseColumns] : [...baseColumns, fresh]
      persistBoardConfig({
        version: 1,
        groupBy: current?.groupBy ?? 'project',
        columns,
      })
    },
    [persistBoardConfig, t],
  )

  const handleRemoveColumn = React.useCallback(
    (columnId: string) => {
      const current = boardConfigRef.current
      const baseColumns = current?.columns?.length
        ? current.columns.map(c => ({ ...c }))
        : mergeBoardColumns(null).map(c => ({
            id: c.id,
            label: c.name,
            color: c.color,
            collapsed: c.collapsed,
            promptEnabled: c.promptEnabled,
            prompt: c.prompt,
            dropStatusId: c.dropStatusId,
            isBuiltIn: c.isBuiltIn,
          }))
      const target = baseColumns.find(c => c.id === columnId)
      if (target?.isBuiltIn) return
      const remaining = baseColumns.filter(c => c.id !== columnId)
      if (remaining.length === 0) return
      const fallbackId = remaining[0]?.id
      if (fallbackId) {
        for (const task of visibleTasks) {
          if (task.column !== columnId) continue
          updateSessionMeta(task.id, { kanbanColumn: fallbackId })
          void window.electronAPI.sessionCommand(task.id, {
            type: 'setKanbanColumn',
            column: fallbackId,
          })
        }
      }
      persistBoardConfig({
        version: 1,
        groupBy: current?.groupBy ?? 'project',
        columns: remaining,
      })
    },
    [persistBoardConfig, visibleTasks, updateSessionMeta],
  )

  const handleSelectDropStatus = React.useCallback(
    (column: KanbanColumnId, statusId: string) => {
      handleUpdateColumn(column, { dropStatusId: statusId })
      // Also mirror into the legacy atom so Appearance settings stay coherent.
      setColumnStatus(prev => {
        const next = { ...prev }
        if (statusId) next[column] = statusId
        else delete next[column]
        return next
      })
    },
    [handleUpdateColumn, setColumnStatus],
  )

  const handleGroupByChange = React.useCallback(
    (next: KanbanGroupBy) => {
      const current = boardConfigRef.current
      const columns = current?.columns?.length
        ? current.columns
        : mergeBoardColumns(null).map(c => ({
            id: c.id,
            label: c.name,
            color: c.color,
            collapsed: c.collapsed,
            promptEnabled: c.promptEnabled,
            prompt: c.prompt,
            dropStatusId: c.dropStatusId,
            isBuiltIn: c.isBuiltIn,
          }))
      persistBoardConfig({ version: 1, groupBy: next, columns })
    },
    [persistBoardConfig],
  )

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
    [metaMap, labelConfigs, onJumpToTaskSessions, navigateToSession],
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
    [metaMap, setEditorTarget],
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
        onOpenChildSession={sessionId => {
          setEditorTarget(null)
          navigateToSession(sessionId)
        }}
        onCreated={({ sessionId, taskLabelId, projectId: createdProjectId }) => {
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
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-card p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => handleGroupByChange('none')}
              className={
                groupBy === 'none'
                  ? 'rounded-md bg-foreground/[0.08] px-2 py-1 font-semibold text-foreground'
                  : 'rounded-md px-2 py-1 text-foreground/55 hover:text-foreground/80'
              }
            >
              {t('kanban.groupBy.none')}
            </button>
            <button
              type="button"
              onClick={() => handleGroupByChange('project')}
              className={
                groupBy === 'project'
                  ? 'rounded-md bg-foreground/[0.08] px-2 py-1 font-semibold text-foreground'
                  : 'rounded-md px-2 py-1 text-foreground/55 hover:text-foreground/80'
              }
            >
              {t('kanban.groupBy.project')}
            </button>
          </div>
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
          <CollectionViewChrome
            workspaceId={activeWorkspaceId}
            viewMode="board"
            onViewModeChange={view => {
              if (view === 'list') navigate(routes.view.allSessions())
              else if (view === 'table') navigate(routes.view.table())
            }}
            compact
          />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <KanbanBoard
          columns={visibleColumns}
          tasks={visibleTasks}
          sortTasks={displayDrivenSort}
          renderBulkActions={renderBulkActions}
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
          onUpdateColumn={handleUpdateColumn}
          onRemoveColumn={handleRemoveColumn}
          onAddColumn={handleAddColumn}
          groupByPriority={collectionDisplay.groupBy === 'priority'}
          groupByProject={
            collectionDisplay.groupBy === 'priority'
              ? false
              : groupBy === 'project' || collectionDisplay.groupBy === 'project'
          }
          collapsedGroupKeys={collapsedGroupKeys}
          onToggleProjectGroup={handleToggleProjectGroup}
          noProjectLabel={t('kanban.noProject')}
        />
      </div>
    </div>
  )
}
