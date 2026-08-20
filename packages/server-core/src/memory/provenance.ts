/**
 * Memory provenance persistence (spec F4).
 *
 * Records which memory artifacts (lessons, eventually skills) were injected
 * into a session's prompts, so downstream consumers — the feedback loop (L1),
 * usage UI ("Учтено: N уроков"), and pruning analytics — can attribute agent
 * behavior to the exact rules it saw.
 *
 * Layout: {workspace}/sessions/{id}/meta/provenance.json. One record per
 * session, rewritten each time SessionManager assembles fresh prompt blocks
 * (today that is session start / backend spawn — BackendConfig.memoryBlocks
 * is a constructor-time snapshot, see claude-agent pinnedMemoryBlocks and
 * pi-agent's per-turn re-read of config.memoryBlocks).
 *
 * Sync fs on purpose: sessions storage (shared/sessions/storage.ts) is sync
 * throughout this path and the payload is a few hundred bytes.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getSessionPath } from '@craft-agent/shared/sessions/storage'
import type { LessonPromptUsage, SessionProvenance } from '@craft-agent/shared/memory/types'

export type { LessonPromptUsage, SessionProvenance }

/** Absolute path of a session's provenance record. */
export function getProvenancePath(workspaceRoot: string, sessionId: string): string {
  return join(getSessionPath(workspaceRoot, sessionId), 'meta', 'provenance.json')
}

/**
 * Persist the session's provenance record. mkdir -p, atomic via tmp+rename
 * (same convention as session.jsonl writes in shared/sessions/storage.ts).
 */
export function writeProvenance(
  workspaceRoot: string,
  sessionId: string,
  data: { lessons: LessonPromptUsage[]; skills: string[] },
): SessionProvenance {
  const record: SessionProvenance = {
    lessons: data.lessons,
    skills: data.skills,
    ts: new Date().toISOString(),
  }
  const filePath = getProvenancePath(workspaceRoot, sessionId)
  mkdirSync(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8')
  renameSync(tmpPath, filePath)
  return record
}

/**
 * Read the session's provenance record. Returns null when the record is
 * absent (session predates F4, or memory disabled) or unreadable/corrupt —
 * provenance is strictly best-effort and must never break a caller.
 */
export function readProvenance(workspaceRoot: string, sessionId: string): SessionProvenance | null {
  const filePath = getProvenancePath(workspaceRoot, sessionId)
  if (!existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return null
    if (!Array.isArray(parsed.lessons) || !Array.isArray(parsed.skills)) return null
    return {
      lessons: parsed.lessons.filter(
        (l: unknown): l is LessonPromptUsage =>
          !!l && typeof l === 'object'
          && typeof (l as LessonPromptUsage).rule === 'string'
          && ((l as LessonPromptUsage).scope === 'global' || (l as LessonPromptUsage).scope === 'workspace'),
      ),
      skills: parsed.skills.filter((s: unknown): s is string => typeof s === 'string'),
      ts: typeof parsed.ts === 'string' ? parsed.ts : '',
    }
  } catch {
    return null
  }
}
