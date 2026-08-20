/**
 * MemoryFileStore tests — path resolution (global vs workspace scope),
 * context.md / preferences.md I/O, daily history append and the
 * loadWorkspaceMemory 7-day window.
 *
 * The configDir constructor override stands in for CRAFT_CONFIG_DIR-based
 * CONFIG_DIR resolution in production, so these tests never touch the real
 * home directory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { WorkspaceMemory } from '@craft-agent/shared/memory/types'
import { MemoryFileStore, RECENT_HISTORY_DAYS } from '../MemoryFileStore'

let configDir: string
let workspaceRoot: string
let store: MemoryFileStore

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'memory-config-'))
  workspaceRoot = mkdtempSync(join(tmpdir(), 'memory-ws-'))
  store = new MemoryFileStore('workspace', workspaceRoot, configDir)
})

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('paths', () => {
  it('resolves the global scope under the config dir', () => {
    const global = new MemoryFileStore('global', undefined, configDir)
    expect(global.memoryDir).toBe(join(configDir, 'memory'))
    expect(global.lessonsPath).toBe(join(configDir, 'memory', 'lessons.jsonl'))
  })

  it('resolves the workspace scope under {workspaceRoot}/memory', () => {
    expect(store.memoryDir).toBe(join(workspaceRoot, 'memory'))
    expect(store.lessonsPath).toBe(join(workspaceRoot, 'memory', 'lessons.jsonl'))
  })

  it('throws when workspace scope has no root', () => {
    expect(() => new MemoryFileStore('workspace', undefined, configDir)).toThrow()
  })
})

describe('context.md / preferences.md', () => {
  it('round-trips context.md with mkdir -p on write', () => {
    expect(store.readContext()).toBe('')
    store.writeContext('# Context\nhello')
    expect(readFileSync(join(workspaceRoot, 'memory', 'context.md'), 'utf8')).toBe('# Context\nhello')
    expect(store.readContext()).toBe('# Context\nhello')
  })

  it('round-trips preferences.md in the global scope', () => {
    const global = new MemoryFileStore('global', undefined, configDir)
    expect(global.readPreferences()).toBe('')
    global.writePreferences('prefer bun test')
    expect(global.readPreferences()).toBe('prefer bun test')
  })
})

describe('appendDailyHistory', () => {
  it('creates a daily file with a date header and appends sections', () => {
    const file = store.appendDailyHistory('first entry', '2026-08-05')
    store.appendDailyHistory('second entry', '2026-08-05')
    expect(file).toBe(join(workspaceRoot, 'memory', 'history', '2026-08-05.md'))
    const content = readFileSync(file, 'utf8')
    expect(content).toContain('# 2026-08-05')
    expect(content).toContain('first entry')
    expect(content).toContain('second entry')
    expect(content.indexOf('first entry')).toBeLessThan(content.indexOf('second entry'))
    // exactly one header (the file is created only once, then appended)
    expect(content.split('# 2026-08-05').length).toBe(2)
  })

  it('defaults to today when no date is given', () => {
    const today = new Date().toISOString().slice(0, 10)
    const file = store.appendDailyHistory('auto-dated')
    expect(file.endsWith(join('history', `${today}.md`))).toBe(true)
  })
})

describe('loadWorkspaceMemory', () => {
  it('assembles context, global preferences and the 7 most recent daily files', () => {
    store.writeContext('# WS context')
    new MemoryFileStore('global', undefined, configDir).writePreferences('global prefs')
    // 8 daily files — only the RECENT_HISTORY_DAYS most recent must be included.
    for (let i = 1; i <= 8; i++) {
      store.appendDailyHistory(`entry day ${i}`, `2026-07-0${i}`)
    }
    expect(readdirSync(join(workspaceRoot, 'memory', 'history'))).toHaveLength(8)
    expect(RECENT_HISTORY_DAYS).toBe(7)

    const mem: WorkspaceMemory = store.loadWorkspaceMemory()
    expect(mem.context).toBe('# WS context')
    expect(mem.preferences).toBe('global prefs')
    expect(mem.recentHistory).toContain('entry day 8')
    expect(mem.recentHistory).toContain('entry day 2')
    expect(mem.recentHistory).not.toContain('entry day 1')
    // most recent first
    expect(mem.recentHistory.indexOf('entry day 8')).toBeLessThan(mem.recentHistory.indexOf('entry day 7'))
  })

  it('returns empty strings when nothing exists yet', () => {
    const mem = store.loadWorkspaceMemory()
    expect(mem.context).toBe('')
    expect(mem.preferences).toBe('')
    expect(mem.recentHistory).toBe('')
  })
})
