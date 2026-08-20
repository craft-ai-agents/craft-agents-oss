/**
 * M4 — memory export/import RPC handlers (spec §M4, self-learning v2).
 *
 * - memory.EXPORT(scope, workspaceId?) → versioned JSON bundle
 *   {version: 1, lessons, context, preferences, history: [{day, text}]}
 *   mirroring the sessions EXPORT pattern.
 * - memory.IMPORT(scope, workspaceId, bundle, {mode}) with two modes:
 *     merge  — LessonStore.add dedups rules (case-insensitive); context/
 *              preferences append only when their text is not already
 *              present; history days already on disk are skipped.
 *     replace — lessons.jsonl/context.md/preferences.md/daily history are
 *              rewritten to exactly the bundle content.
 *   A single memory.CHANGED broadcast fires after a completed import.
 *
 * Global scope has no context/history (no workspace); workspace export also
 * bundles the global preferences so a workspace export is self-contained.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { PushTarget } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { Lesson, LessonScope } from '@craft-agent/shared/memory/types'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { LessonStore, lessonKey } from '../../memory/LessonStore'
import { MemoryFileStore } from '../../memory/MemoryFileStore'

export const HANDLED_CHANNELS = [RPC_CHANNELS.memory.EXPORT, RPC_CHANNELS.memory.IMPORT] as const

export const MEMORY_BUNDLE_VERSION = 1
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export interface MemoryHistoryEntry {
  /** YYYY-MM-DD */
  day: string
  text: string
}

export interface MemoryExportBundle {
  version: 1
  lessons: Lesson[]
  /** Workspace {root}/memory/context.md ('' for global scope) */
  context: string
  /** Global ~/.craft-agent/memory/preferences.md */
  preferences: string
  /** Daily history files, oldest first ('' texts are kept verbatim) */
  history: MemoryHistoryEntry[]
}

export interface MemoryImportOptions {
  /** 'merge' (default) dedups; 'replace' rewrites the target store. */
  mode?: 'merge' | 'replace'
}

export interface MemoryImportResult {
  /** Lessons written into the target store (all bundle lessons in replace mode). */
  added: number
  /** Bundle lessons skipped as duplicates (merge mode only). */
  skipped: number
  /** History days written to disk. */
  historyAdded: number
  /** History days skipped as already present (merge mode only). */
  historySkipped: number
}

function broadcastChanged(server: RpcServer, workspaceId: string | null, scope: LessonScope | 'both'): void {
  const target: PushTarget = workspaceId ? { to: 'workspace', workspaceId } : { to: 'all' }
  pushTyped(server, RPC_CHANNELS.memory.CHANGED, target, workspaceId, scope)
}

/** Full atomic rewrite of a lessons.jsonl (tmp + rename, mirrors LessonStore.rewrite). */
function rewriteLessonsFile(store: LessonStore, lessons: Lesson[]): void {
  const content = lessons.map(l => JSON.stringify(l)).join('\n') + (lessons.length ? '\n' : '')
  mkdirSync(dirname(store.filePath), { recursive: true })
  const tmp = join(dirname(store.filePath), `.${Date.now()}-${process.pid}.import.tmp`)
  writeFileSync(tmp, content)
  renameSync(tmp, store.filePath)
  store.invalidate()
}

/** Validate the bundle envelope; per-entry tolerance happens at apply time. */
function assertBundle(bundle: unknown): asserts bundle is MemoryExportBundle {
  const b = bundle as MemoryExportBundle | null
  if (!b || typeof b !== 'object') throw new Error('Invalid memory bundle')
  if (b.version !== MEMORY_BUNDLE_VERSION) throw new Error(`Unsupported memory bundle version: ${String(b.version)}`)
  if (!Array.isArray(b.lessons) || b.lessons.some(l => !l || typeof l !== 'object' || typeof (l as Lesson).rule !== 'string')) {
    throw new Error('Invalid memory bundle: lessons must be an array of lesson objects')
  }
  if (b.history !== undefined && !Array.isArray(b.history)) throw new Error('Invalid memory bundle: history must be an array')
}

/** Build a target lesson entry, enforcing the target scope and minimal fields. */
function normalizeImportLesson(l: Lesson, scope: LessonScope, ts: string): Lesson {
  return {
    ...l,
    scope,
    ts: typeof l.ts === 'string' && l.ts ? l.ts : ts,
    source: l.source ?? { trigger: 'explicit' },
  }
}

export function registerMemoryIoHandlers(server: RpcServer, deps: HandlerDeps): void {
  // ——— EXPORT(scope, workspaceId?) ———
  server.handle(RPC_CHANNELS.memory.EXPORT, async (_ctx, scope: LessonScope, workspaceId?: string): Promise<MemoryExportBundle> => {
    const globalFiles = new MemoryFileStore('global')
    const preferences = globalFiles.readPreferences()
    if (scope === 'global') {
      const lessons = new LessonStore(globalFiles.lessonsPath, 'global').list()
      return { version: 1, lessons, context: '', preferences, history: [] }
    }
    const workspace = workspaceId ? getWorkspaceByNameOrId(workspaceId) : null
    if (!workspace) throw new Error('Workspace not found')
    const wsFiles = new MemoryFileStore('workspace', workspace.rootPath)
    const lessons = new LessonStore(wsFiles.lessonsPath, 'workspace').list()
    const history: MemoryHistoryEntry[] = wsFiles
      .listHistoryDates()
      .sort((a, b) => a.localeCompare(b)) // chronological: oldest first (YYYY-MM-DD compares correctly)
      .map(day => ({ day, text: wsFiles.readHistory(day) }))
    return { version: 1, lessons, context: wsFiles.readContext(), preferences, history }
  })

  // ——— IMPORT(scope, workspaceId, bundle, {mode}) ———
  server.handle(
    RPC_CHANNELS.memory.IMPORT,
    async (
      _ctx,
      scope: LessonScope,
      workspaceId: string | null,
      bundle: MemoryExportBundle,
      options?: MemoryImportOptions,
    ): Promise<MemoryImportResult> => {
      assertBundle(bundle)
      const mode = options?.mode ?? 'merge'
      if (mode !== 'merge' && mode !== 'replace') throw new Error(`Invalid import mode: ${String(mode)}`)
      const ts = new Date().toISOString()
      const result: MemoryImportResult = { added: 0, skipped: 0, historyAdded: 0, historySkipped: 0 }

      const globalFiles = new MemoryFileStore('global')
      // Workspace resolution comes first: a bad id must not half-write globals.
      let wsFiles: MemoryFileStore | null = null
      if (scope === 'workspace') {
        const workspace = workspaceId ? getWorkspaceByNameOrId(workspaceId) : null
        if (!workspace) throw new Error('Workspace not found')
        wsFiles = new MemoryFileStore('workspace', workspace.rootPath)
      }

      // — lessons —
      const files = scope === 'global' ? globalFiles : wsFiles!
      const store = new LessonStore(files.lessonsPath, scope)
      const lessons = bundle.lessons.map(l => normalizeImportLesson(l, scope, ts))
      if (mode === 'replace') {
        rewriteLessonsFile(store, lessons)
        result.added = lessons.length
        try {
          store.auditLog.append({ actor: 'rpc', action: 'update', target: files.lessonsPath, detail: `import replace (${lessons.length} lessons)` })
        } catch {
          // auditing is best-effort; the write already landed
        }
      } else {
        const existing = new Set(store.list().map(l => lessonKey(l.rule)))
        for (const lesson of lessons) {
          if (existing.has(lessonKey(lesson.rule))) {
            result.skipped++
            continue
          }
          store.add(lesson, 'rpc')
          result.added++
        }
      }

      // — preferences (global file; bundled by both scopes) —
      const bundlePrefs = typeof bundle.preferences === 'string' ? bundle.preferences : ''
      if (mode === 'replace') {
        globalFiles.writePreferences(bundlePrefs)
      } else if (bundlePrefs) {
        const current = globalFiles.readPreferences()
        if (!current.includes(bundlePrefs)) {
          globalFiles.writePreferences(current ? `${current.replace(/\n*$/, '')}\n\n${bundlePrefs}` : bundlePrefs)
        }
      }

      // — workspace-only payload: context.md + daily history —
      if (scope === 'workspace' && wsFiles) {
        const bundleContext = typeof bundle.context === 'string' ? bundle.context : ''
        if (mode === 'replace') {
          wsFiles.writeContext(bundleContext)
        } else if (bundleContext) {
          const current = wsFiles.readContext()
          if (!current.includes(bundleContext)) {
            wsFiles.writeContext(current ? `${current.replace(/\n*$/, '')}\n\n${bundleContext}` : bundleContext)
          }
        }

        const entries = (bundle.history ?? []).filter((e): e is MemoryHistoryEntry =>
          Boolean(e && typeof e === 'object' && DAY_RE.test(e.day) && typeof e.text === 'string'),
        )
        const historyDir = wsFiles.memoryDir + '/history'
        if (mode === 'replace') {
          // Rewrite: drop every existing daily file, then write the bundle's.
          if (existsSync(historyDir)) {
            for (const name of readdirSync(historyDir)) {
              if (/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) {
                try {
                  unlinkSync(join(historyDir, name))
                } catch {
                  // best-effort
                }
              }
            }
          }
        }
        for (const entry of entries) {
          const path = join(historyDir, `${entry.day}.md`)
          if (mode === 'merge' && existsSync(path)) {
            result.historySkipped++
            continue
          }
          // Verbatim write: exported text already carries the `# YYYY-MM-DD`
          // header, so prepending one would duplicate it on round-trip.
          mkdirSync(historyDir, { recursive: true })
          const tmp = join(historyDir, `.${Date.now()}-${process.pid}.import.tmp`)
          writeFileSync(tmp, entry.text.endsWith('\n') ? entry.text : entry.text + '\n')
          renameSync(tmp, path)
          result.historyAdded++
        }
      }

      broadcastChanged(server, scope === 'global' ? null : workspaceId, scope)
      deps.platform.logger?.info?.(`MEMORY_IMPORT: ${mode} import into ${scope} store (+${result.added} lessons, ${result.skipped} skipped)`)
      return result
    },
  )
}
