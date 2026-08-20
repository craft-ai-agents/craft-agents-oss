import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { PushTarget } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import { getMemoryConfig } from '@craft-agent/shared/config/storage'
import type { Lesson, LessonCategory, LessonScope, ProjectMemoryDto, WorkspaceMemory } from '@craft-agent/shared/memory/types'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { LessonStore, lessonKey } from '../../memory/LessonStore'
import { buildConflictPrompt, parseConflicts, promoteLessonToGlobal, scanPromotionCandidates } from '../../memory/lesson-graph'
import type { LessonConflictVerdict } from '../../memory/lesson-graph'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { getProjectMemoryPath, loadProject, loadProjectById, loadProjectMemory } from '@craft-agent/shared/projects'
import { search as ftsSearch } from '../../memory/fts-index'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.memory.LIST_LESSONS,
  RPC_CHANNELS.memory.ADD_LESSON,
  RPC_CHANNELS.memory.UPDATE_LESSON,
  RPC_CHANNELS.memory.DELETE_LESSON,
  RPC_CHANNELS.memory.GET_CONTEXT,
  RPC_CHANNELS.memory.GET_PROJECT_MEMORY,
  RPC_CHANNELS.memory.UPDATE_CONTEXT,
  RPC_CHANNELS.memory.LIST_HISTORY,
  RPC_CHANNELS.memory.PROMOTION_CANDIDATES,
  RPC_CHANNELS.memory.PROMOTE_LESSON,
] as const

export interface LessonInput {
  rule: string
  category: LessonCategory
  negative?: boolean
  scope: LessonScope
}

/** ADD_LESSON result (spec L2): the stored lesson plus conflicts detected
 *  post-write against existing rules. `conflicts` is [] whenever the LLM
 *  check is unavailable or fails — it never blocks the write. */
export interface AddLessonResult {
  lesson: Lesson
  conflicts: LessonConflictVerdict[]
}

export interface MemoryContextDto {
  /** Global ~/.craft-agent/memory/preferences.md */
  preferences: string
  /** Workspace {root}/memory/context.md ('' when no workspace given) */
  context: string
  /** Full workspace memory bundle (context + preferences + recent history) */
  workspaceMemory: WorkspaceMemory | null
}

export interface MemoryHistoryDto {
  dates: string[]
  /** The date whose content is returned (requested, else most recent, else null) */
  date: string | null
  content: string
}

function lessonStoreFor(scope: LessonScope, workspaceId?: string): LessonStore | null {
  if (scope === 'global') {
    return new LessonStore(new MemoryFileStore('global').lessonsPath, 'global')
  }
  if (!workspaceId) return null
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return null
  return new LessonStore(new MemoryFileStore('workspace', workspace.rootPath).lessonsPath, 'workspace')
}

export function registerMemoryHandlers(server: RpcServer, deps: HandlerDeps): void {
  const broadcastChanged = (workspaceId: string | null, scope: LessonScope | 'both'): void => {
    const target: PushTarget = workspaceId ? { to: 'workspace', workspaceId } : { to: 'all' }
    pushTyped(server, RPC_CHANNELS.memory.CHANGED, target, workspaceId, scope)
  }

  // L2: post-write, best-effort LLM check of the new rule against existing
  // rules (same scope; workspace adds also check global rules). One attempt,
  // any failure (no workspaces configured, no distiller wired, LLM error,
  // unparseable reply) degrades to [] — the write always stands.
  const detectLessonConflicts = async (
    workspaceId: string | null,
    scope: LessonScope,
    store: LessonStore,
    newLesson: Lesson,
  ): Promise<LessonConflictVerdict[]> => {
    try {
      const run = deps.sessionManager?.runDistillOneShot
      if (typeof run !== 'function') return []
      const existing = store.list().filter(l => lessonKey(l.rule) !== lessonKey(newLesson.rule))
      if (scope === 'workspace') {
        existing.push(...new LessonStore(new MemoryFileStore('global').lessonsPath, 'global').list())
      }
      if (existing.length === 0) return []
      const llmWorkspaceId = workspaceId ?? getWorkspaces()[0]?.id
      if (!llmWorkspaceId) return []
      const rules = existing.map(l => l.rule)
      const text = await run.call(deps.sessionManager, llmWorkspaceId, buildConflictPrompt(newLesson.rule, rules))
      return parseConflicts(text, rules)
    } catch (err) {
      deps.platform.logger?.warn('MEMORY_ADD_LESSON: conflict check failed, skipping', err)
      return []
    }
  }

  // List lessons for one scope or both.
  server.handle(RPC_CHANNELS.memory.LIST_LESSONS, async (_ctx, scope: LessonScope | 'both', workspaceId?: string) => {
    const scopes: LessonScope[] = scope === 'both' ? ['global', 'workspace'] : [scope]
    const lessons: Lesson[] = []
    for (const s of scopes) {
      const store = lessonStoreFor(s, workspaceId)
      if (!store) {
        if (s === 'workspace') deps.platform.logger?.error(`MEMORY_LIST_LESSONS: Workspace not found: ${workspaceId}`)
        continue
      }
      lessons.push(...store.list())
    }
    return lessons
  })

  // Add a lesson from the UI (explicit trigger). Returns {lesson, conflicts}:
  // the L2 conflict list is best-effort and empty whenever the check is
  // unavailable (no LLM, parse failure) — it never blocks the write.
  server.handle(RPC_CHANNELS.memory.ADD_LESSON, async (_ctx, workspaceId: string | null, input: LessonInput): Promise<AddLessonResult> => {
    const scope: LessonScope = input.scope ?? 'global'
    const store = lessonStoreFor(scope, workspaceId ?? undefined)
    if (!store) throw new Error('Workspace not found')
    const lesson = store.add({
      ts: new Date().toISOString(),
      rule: input.rule,
      category: input.category,
      scope,
      ...(input.negative ? { negative: true } : {}),
      source: { trigger: 'explicit' },
    })
    broadcastChanged(scope === 'global' ? null : workspaceId, scope)
    const conflicts = await detectLessonConflicts(workspaceId, scope, store, lesson)
    return { lesson, conflicts }
  })

  // Patch a lesson by rule text or index.
  server.handle(
    RPC_CHANNELS.memory.UPDATE_LESSON,
    async (_ctx, workspaceId: string | null, scope: LessonScope, match: string | number, patch: Partial<Omit<Lesson, 'scope'>>) => {
      const store = lessonStoreFor(scope, workspaceId ?? undefined)
      if (!store) throw new Error('Workspace not found')
      const updated = store.update(match, patch)
      if (!updated) return null
      broadcastChanged(scope === 'global' ? null : workspaceId, scope)
      return updated
    },
  )

  // Delete a lesson by rule text or index.
  server.handle(RPC_CHANNELS.memory.DELETE_LESSON, async (_ctx, workspaceId: string | null, scope: LessonScope, match: string | number) => {
    const store = lessonStoreFor(scope, workspaceId ?? undefined)
    if (!store) throw new Error('Workspace not found')
    const deleted = store.delete(match)
    if (deleted) broadcastChanged(scope === 'global' ? null : workspaceId, scope)
    return deleted
  })

  // L3: rules repeated as workspace lessons in ≥2 distinct workspaces →
  // candidates for promotion to the global scope (Memory tab banner).
  server.handle(RPC_CHANNELS.memory.PROMOTION_CANDIDATES, async () => scanPromotionCandidates(getWorkspaces()))

  // L3: copy a workspace rule into the global store, marked promoted
  // {fromScope:'workspace', workspaceIds, ts}; an already-global rule is
  // re-marked in place (dedup). Broadcasts memory.changed(global).
  server.handle(RPC_CHANNELS.memory.PROMOTE_LESSON, async (_ctx, _workspaceId: string | null, rule: string) => {
    const result = promoteLessonToGlobal(getWorkspaces(), rule)
    if (!result) return null
    broadcastChanged(null, 'global')
    return result
  })

  // Global preferences.md + workspace context.md (+ workspace memory bundle).
  // M1: optional query → FTS-ranked subset of the bundle (context/preferences
  // documents only when matched, history restricted to ranked days, top-K per
  // memory.ftsLimit). Missing query, any index error, or zero hits fall back
  // to the full recent bundle.
  server.handle(RPC_CHANNELS.memory.GET_CONTEXT, async (_ctx, workspaceId?: string, query?: string): Promise<MemoryContextDto> => {
    const globalStore = new MemoryFileStore('global')
    const preferences = globalStore.readPreferences()
    if (!workspaceId) return { preferences, context: '', workspaceMemory: null }
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`MEMORY_GET_CONTEXT: Workspace not found: ${workspaceId}`)
      return { preferences, context: '', workspaceMemory: null }
    }
    const wsStore = new MemoryFileStore('workspace', workspace.rootPath)
    const fullBundle = (): MemoryContextDto => ({
      preferences,
      context: wsStore.readContext(),
      workspaceMemory: wsStore.loadWorkspaceMemory(),
    })
    if (!query?.trim()) return fullBundle()
    try {
      const limit = getMemoryConfig().ftsLimit ?? 20
      const wHits = ftsSearch(wsStore.memoryDir, query, { limit })
      const gHits = ftsSearch(globalStore.memoryDir, query, { limit })
      if (!wHits || !gHits) return fullBundle()
      const contextDoc = wHits.context.find(h => h.kind === 'context')?.text ?? ''
      const prefsDoc = gHits.context.find(h => h.kind === 'preferences')?.text ?? ''
      const historyText = wHits.history.map(h => h.text).filter(t => t.trim().length > 0).join('\n\n')
      if (!contextDoc && !prefsDoc && !historyText) return fullBundle()
      return {
        preferences: prefsDoc,
        context: contextDoc,
        workspaceMemory: { context: contextDoc, preferences: prefsDoc, recentHistory: historyText },
      }
    } catch {
      return fullBundle()
    }
  })

  // M5: project-scope memory surfaced read-only in the Memory tab. Project
  // MEMORY.md is agent-managed (agents already inject it into prompts via
  // ProjectPromptContext) — this endpoint only READS it for display.
  server.handle(RPC_CHANNELS.memory.GET_PROJECT_MEMORY, async (_ctx, workspaceId: string, projectId: string): Promise<ProjectMemoryDto | null> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null
    const project = loadProjectById(workspace.rootPath, projectId) ?? loadProject(workspace.rootPath, projectId)
    if (!project) return null
    const slug = project.config.slug
    return {
      name: project.config.name,
      slug,
      memoryPath: getProjectMemoryPath(workspace.rootPath, slug),
      // Generous viewer cap (the 5000-token default is sized for prompt
      // injection, not for a read-only UI viewer).
      memoryContent: loadProjectMemory(workspace.rootPath, slug, 20_000) ?? '',
    }
  })

  // Overwrite preferences.md (global) or context.md (workspace).
  server.handle(RPC_CHANNELS.memory.UPDATE_CONTEXT, async (_ctx, workspaceId: string | null, scope: LessonScope, content: string) => {
    if (scope === 'global') {
      new MemoryFileStore('global').writePreferences(content)
      broadcastChanged(null, 'global')
      return true
    }
    const workspace = workspaceId ? getWorkspaceByNameOrId(workspaceId) : null
    if (!workspace) throw new Error('Workspace not found')
    new MemoryFileStore('workspace', workspace.rootPath).writeContext(content)
    broadcastChanged(workspaceId, 'workspace')
    return true
  })

  // History dates for the workspace memory log + content of one date
  // (requested date, else the most recent entry).
  server.handle(RPC_CHANNELS.memory.LIST_HISTORY, async (_ctx, workspaceId: string, date?: string): Promise<MemoryHistoryDto> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`MEMORY_LIST_HISTORY: Workspace not found: ${workspaceId}`)
      return { dates: [], date: null, content: '' }
    }
    const store = new MemoryFileStore('workspace', workspace.rootPath)
    const dates = store.listHistoryDates()
    const selected = date ?? dates[0] ?? null
    return { dates, date: selected, content: selected ? store.readHistory(selected) : '' }
  })
}
