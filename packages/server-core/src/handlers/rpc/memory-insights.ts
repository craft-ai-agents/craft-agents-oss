/**
 * Y1/Y4: memory.* dashboard insights + onboarding marker.
 *
 * - memory:insights (workspaceId?) aggregates the last 7 days of BOTH audit
 *   logs (global config dir + the resolved workspace's) plus live store
 *   counters, for the Memory tab insights card. Audit reads are best-effort:
 *   a missing/corrupt audit.jsonl degrades to an empty list, never throws.
 * - memory:markOnboarded () stamps {configDir}/memory/.onboarded after the
 *   onboarding seed dialog closes (any path) so it is shown exactly once.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { AuditEntry, MemoryInsights } from '@craft-agent/shared/memory/types'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { AuditLog } from '../../memory/AuditLog'
import { LessonStore } from '../../memory/LessonStore'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { SkillPendingQueue } from '../../memory/SkillPendingQueue'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.memory.INSIGHTS,
  RPC_CHANNELS.memory.MARK_ONBOARDED,
] as const

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/** Marker file name for the one-shot onboarding flag (no config schema change). */
export const ONBOARDED_MARKER = '.onboarded'

export function registerMemoryInsightsHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.memory.INSIGHTS, async (_ctx, workspaceId?: string): Promise<MemoryInsights> => {
    const workspace = workspaceId ? getWorkspaceByNameOrId(workspaceId) : null
    const workspaceRoot = workspace?.rootPath ?? null

    // Merge both audit logs: global entries always; workspace entries only
    // when the workspace resolves. Corrupt/missing files read as [] (AuditLog).
    const entries: AuditEntry[] = [...new AuditLog('global').read()]
    if (workspaceRoot) entries.push(...new AuditLog('workspace', workspaceRoot).read())

    const cutoff = Date.now() - SEVEN_DAYS_MS
    const recent = entries.filter((e) => {
      const ts = Date.parse(e.ts)
      return Number.isFinite(ts) && ts >= cutoff
    })
    const lessonsAdded7d = recent.filter((e) => e.action === 'add').length
    const conflicts7d = recent.filter((e) => e.action === 'conflict').length
    const approved7d = recent.filter((e) => e.action === 'approved').length

    let pendingCount = 0
    if (workspaceRoot) {
      try {
        pendingCount = new SkillPendingQueue(workspaceRoot).list().length
      } catch (err) {
        deps.platform.logger?.warn('MEMORY_INSIGHTS: pending queue read failed, defaulting to 0', err)
      }
    }

    // Categories/chips and the Y4 emptiness check read the live lesson
    // stores — audit lines don't carry a category field.
    const categories: Record<string, number> = {}
    let totalLessons = 0
    const stores = [
      new LessonStore(new MemoryFileStore('global').lessonsPath, 'global'),
      ...(workspaceRoot ? [new LessonStore(new MemoryFileStore('workspace', workspaceRoot).lessonsPath, 'workspace')] : []),
    ]
    for (const store of stores) {
      for (const lesson of store.list()) {
        totalLessons += 1
        categories[lesson.category] = (categories[lesson.category] ?? 0) + 1
      }
    }

    return {
      lessonsAdded7d,
      conflicts7d,
      pendingCount,
      approved7d,
      categories,
      totalLessons,
      onboarded: existsSync(join(new AuditLog('global').memoryDir, ONBOARDED_MARKER)),
    }
  })

  // Y4: stamp the marker once the onboarding dialog closes (either action) —
  // best-effort so a read-only config dir never breaks the app flow.
  server.handle(RPC_CHANNELS.memory.MARK_ONBOARDED, async (): Promise<void> => {
    try {
      const dir = new AuditLog('global').memoryDir
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, ONBOARDED_MARKER), new Date().toISOString(), 'utf-8')
    } catch (err) {
      deps.platform.logger?.warn('MEMORY_MARK_ONBOARDED: marker write failed', err)
    }
  })
}
