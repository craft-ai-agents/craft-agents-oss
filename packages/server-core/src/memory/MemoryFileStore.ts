/**
 * MemoryFileStore — path resolution and markdown-file I/O for the
 * self-learning memory directories.
 *
 * Layout (spec §1):
 * - global:    ~/.craft-agent/memory/           { lessons.jsonl, preferences.md }
 * - workspace: {workspaceRoot}/memory/          { lessons.jsonl, context.md,
 *                                                history/YYYY-MM-DD.md }
 *
 * HOME resolution follows the same convention as the rest of the config code:
 * CONFIG_DIR from @craft-agent/shared/config/paths (CRAFT_CONFIG_DIR override,
 * default ~/.craft-agent).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import type { LessonScope, WorkspaceMemory } from '@craft-agent/shared/memory/types'
import { upsertContext, upsertHistory } from './fts-index'

/** How many of the most recent daily history files loadWorkspaceMemory keeps. */
export const RECENT_HISTORY_DAYS = 7

export class MemoryFileStore {
  /** The scope's memory directory (~/.craft-agent/memory or {workspaceRoot}/memory). */
  readonly memoryDir: string
  readonly scope: LessonScope
  private readonly configDir: string

  /**
   * @param scope  'global' (config dir) or 'workspace' (needs workspaceRoot)
   * @param workspaceRoot  required for workspace scope
   * @param configDir  override for the global config dir (tests); defaults to
   *                   CONFIG_DIR from @craft-agent/shared/config/paths
   */
  // CRAFT_CONFIG_DIR is read lazily here (not via the frozen CONFIG_DIR
  // constant) so late-bound test harnesses with their own import order still
  // resolve the right directory at construction time.
  constructor(scope: LessonScope, workspaceRoot?: string, configDir: string = process.env.CRAFT_CONFIG_DIR || CONFIG_DIR) {
    this.configDir = configDir
    if (scope === 'global') {
      this.memoryDir = join(configDir, 'memory')
    } else {
      if (!workspaceRoot) throw new Error('MemoryFileStore: workspaceRoot is required for workspace scope')
      this.memoryDir = join(workspaceRoot, 'memory')
    }
    this.scope = scope
  }

  /** Path of this scope's lessons.jsonl. */
  get lessonsPath(): string {
    return join(this.memoryDir, 'lessons.jsonl')
  }

  /** Read context.md (workspace scope) or '' when absent. */
  readContext(): string {
    return this.readText(join(this.memoryDir, 'context.md'))
  }

  writeContext(content: string): void {
    this.writeText(join(this.memoryDir, 'context.md'), content)
    // M1 FTS: index the new document (best-effort — indexing never blocks a write).
    try {
      upsertContext(this.memoryDir, 'context', content)
    } catch {}
  }

  /** Read preferences.md (global scope) or '' when absent. */
  readPreferences(): string {
    return this.readText(join(this.memoryDir, 'preferences.md'))
  }

  writePreferences(content: string): void {
    this.writeText(join(this.memoryDir, 'preferences.md'), content)
    // M1 FTS: index the new document (best-effort — indexing never blocks a write).
    try {
      upsertContext(this.memoryDir, 'preferences', content)
    } catch {}
  }

  /**
   * Append a dated section to memory/history/YYYY-MM-DD.md (today when no
   * date is given). Creates the history dir on demand.
   */
  appendDailyHistory(content: string, date?: string): string {
    const day = date ?? new Date().toISOString().slice(0, 10)
    const file = join(this.memoryDir, 'history', `${day}.md`)
    mkdirSync(join(this.memoryDir, 'history'), { recursive: true })
    const existing = this.readText(file)
    const section = existing
      ? existing.replace(/\n*$/, '\n\n') + content.replace(/\n*$/, '\n')
      : `# ${day}\n\n` + content.replace(/\n*$/, '\n')
    writeFileSync(file, section)
    // M1 FTS: reindex the full day document (best-effort — never blocks the write).
    try {
      upsertHistory(this.memoryDir, day, section)
    } catch {}
    return file
  }

  /**
   * Assemble the workspace memory for prompt injection: context.md,
   * preferences.md (global) and the most recent RECENT_HISTORY_DAYS daily
   * history files (most recent first), joined with blank lines.
   */
  loadWorkspaceMemory(): WorkspaceMemory {
    return {
      context: this.readContext(),
      preferences: new MemoryFileStore('global', undefined, this.configDir).readPreferences(),
      recentHistory: this.recentHistoryFiles()
        .map(f => this.readText(f))
        .filter(s => s.length > 0)
        .join('\n\n'),
    }
  }

  /** All history dates (YYYY-MM-DD), most recent first. */
  listHistoryDates(): string[] {
    const dir = join(this.memoryDir, 'history')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(name => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .sort()
      .reverse()
      .map(name => name.slice(0, 10))
  }

  /** Read one daily history file by date (YYYY-MM-DD); '' when absent or invalid. */
  readHistory(date: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
    return this.readText(join(this.memoryDir, 'history', `${date}.md`))
  }

  /** Paths of the most recent RECENT_HISTORY_DAYS daily files, most recent first. */
  private recentHistoryFiles(): string[] {
    return this.listHistoryDates()
      .slice(0, RECENT_HISTORY_DAYS)
      .map(date => join(this.memoryDir, 'history', `${date}.md`))
  }

  private readText(path: string): string {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return ''
    }
  }

  private writeText(path: string, content: string): void {
    mkdirSync(join(this.memoryDir), { recursive: true })
    writeFileSync(path, content)
  }
}
