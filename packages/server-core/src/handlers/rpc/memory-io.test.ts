/**
 * M4 export/import handler tests (spec §M4): export bundle shape per scope,
 * merge import dedups lessons via LessonStore (case-insensitive) and skips
 * existing history days, replace import rewrites stores and history, exports
 * round-trip through a replace import, and memory.CHANGED broadcasts once
 * per completed import.
 *
 * Harness mirrors memory-conflicts-promotion.test.ts: CRAFT_CONFIG_DIR is
 * redirected by memory-test-setup, workspace registry is mocked.
 */
import './memory-test-setup' // must run before any module reading CRAFT_CONFIG_DIR
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, HandlerFn, RequestContext } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { Lesson } from '@craft-agent/shared/memory/types'

let workspaceRoots: string[]
const configDir = process.env.CRAFT_CONFIG_DIR!

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => {
    const i = ['ws1', 'ws2'].indexOf(id)
    return i >= 0 ? { id, name: id, rootPath: workspaceRoots[i] } : null
  },
  getWorkspaces: () => ['ws1', 'ws2'].map((id, i) => ({ id, name: id, rootPath: workspaceRoots[i] })),
}))

import { registerMemoryIoHandlers, HANDLED_CHANNELS, type MemoryExportBundle, type MemoryImportResult } from './memory-io'
import { LessonStore } from '../../memory/LessonStore'
import { MemoryFileStore } from '../../memory/MemoryFileStore'

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const pushCalls: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push(channel, target, ...args) { pushCalls.push({ channel, target, args }) },
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps: HandlerDeps = {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  }
  registerMemoryIoHandlers(server, deps)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: null } as unknown as RequestContext, ...args)
  }
  return { invoke, pushCalls }
}

const EXPORT_CH = RPC_CHANNELS.memory.EXPORT
const IMPORT_CH = RPC_CHANNELS.memory.IMPORT

function lesson(rule: string): Lesson {
  return { ts: '2026-01-01T00:00:00.000Z', rule, category: 'workflow', scope: 'workspace', source: { trigger: 'explicit' } }
}

function wsFiles(id: string): MemoryFileStore {
  const i = ['ws1', 'ws2'].indexOf(id)
  return new MemoryFileStore('workspace', workspaceRoots[i])
}

function seedWorkspace(id: string): void {
  const files = wsFiles(id)
  const store = new LessonStore(files.lessonsPath, 'workspace')
  store.add(lesson('Use bun, not npm'))
  store.add(lesson('Run typecheck after edits'))
  files.writeContext('repo facts: bun monorepo')
  files.appendDailyHistory('shipped W1', '2026-07-01')
  files.appendDailyHistory('shipped W2', '2026-07-02')
  new MemoryFileStore('global').writePreferences('prefer terse answers')
}

beforeEach(() => {
  workspaceRoots = [0, 1].map(() => mkdtempSync(join(tmpdir(), 'mem-io-ws-')))
  rmSync(configDir, { recursive: true, force: true })
  mkdirSync(configDir, { recursive: true })
})

afterEach(() => {
  for (const root of workspaceRoots) rmSync(root, { recursive: true, force: true })
})

describe('memory.EXPORT', () => {
  it('exports the global scope: lessons + preferences, no context/history', async () => {
    const { invoke } = createHarness()
    new LessonStore(new MemoryFileStore('global').lessonsPath, 'global').add({ ...lesson('global rule'), scope: 'global' })
    new MemoryFileStore('global').writePreferences('prefer terse answers')
    const bundle = (await invoke(EXPORT_CH, 'global')) as MemoryExportBundle
    expect(bundle.version).toBe(1)
    expect(bundle.lessons.map(l => l.rule)).toEqual(['global rule'])
    expect(bundle.preferences).toBe('prefer terse answers')
    expect(bundle.context).toBe('')
    expect(bundle.history).toEqual([])
  })

  it('exports a workspace: lessons, context, global preferences, chronological history', async () => {
    seedWorkspace('ws1')
    const { invoke } = createHarness()
    const bundle = (await invoke(EXPORT_CH, 'workspace', 'ws1')) as MemoryExportBundle
    expect(bundle.lessons.map(l => l.rule)).toEqual(['Use bun, not npm', 'Run typecheck after edits'])
    expect(bundle.context).toBe('repo facts: bun monorepo')
    expect(bundle.preferences).toBe('prefer terse answers')
    expect(bundle.history.map(h => h.day)).toEqual(['2026-07-01', '2026-07-02'])
    expect(bundle.history[0].text).toContain('shipped W1')
  })

  it('throws for an unknown workspace', async () => {
    const { invoke } = createHarness()
    await expect(invoke(EXPORT_CH, 'workspace', 'nope')).rejects.toThrow('Workspace not found')
  })
})

describe('memory.IMPORT merge', () => {
  it('dedups lessons case-insensitively on re-import and skips existing history days', async () => {
    seedWorkspace('ws1')
    const { invoke, pushCalls } = createHarness()
    const bundle = (await invoke(EXPORT_CH, 'workspace', 'ws1')) as MemoryExportBundle

    const first = (await invoke(IMPORT_CH, 'workspace', 'ws1', bundle)) as MemoryImportResult
    expect(first).toMatchObject({ added: 0, skipped: 2, historyAdded: 0, historySkipped: 2 })

    // Merge-in new content alongside the duplicates.
    bundle.lessons.push(lesson('use BUN, not npm')) // dup by case-insensitive key
    bundle.lessons.push(lesson('new lesson'))
    bundle.history = [...bundle.history, { day: '2026-07-03', text: '# 2026-07-03\n\nshipped W3\n' }]
    const second = (await invoke(IMPORT_CH, 'workspace', 'ws1', bundle)) as MemoryImportResult
    // 3 skips: both original dups + the case-variant of an existing rule.
    expect(second).toMatchObject({ added: 1, skipped: 3, historyAdded: 1, historySkipped: 2 })

    const rules = new LessonStore(wsFiles('ws1').lessonsPath, 'workspace').list().map(l => l.rule)
    expect(rules).toEqual(['Use bun, not npm', 'Run typecheck after edits', 'new lesson'])
    expect(wsFiles('ws1').listHistoryDates().sort()).toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])

    // Two imports → two broadcasts, each carrying (workspaceId, scope).
    const broadcasts = pushCalls.filter(p => p.channel === RPC_CHANNELS.memory.CHANGED)
    expect(broadcasts).toHaveLength(2)
    expect(broadcasts[0]).toMatchObject({ channel: RPC_CHANNELS.memory.CHANGED, target: { to: 'workspace', workspaceId: 'ws1' } })
    expect(broadcasts[0].args).toEqual(['ws1', 'workspace'])
  })

  it('global import merges lessons and appends preferences only once; broadcasts (null, global)', async () => {
    const { invoke, pushCalls } = createHarness()
    const bundle: MemoryExportBundle = {
      version: 1,
      lessons: [{ ...lesson('global rule'), scope: 'global' }],
      context: '',
      preferences: 'prefer terse answers',
      history: [],
    }
    const first = (await invoke(IMPORT_CH, 'global', null, bundle)) as MemoryImportResult
    expect(first).toMatchObject({ added: 1, skipped: 0 })
    const second = (await invoke(IMPORT_CH, 'global', null, bundle)) as MemoryImportResult
    expect(second).toMatchObject({ added: 0, skipped: 1 })
    expect(new MemoryFileStore('global').readPreferences().match(/prefer terse answers/g)).toHaveLength(1)
    const broadcasts = pushCalls.filter(p => p.channel === RPC_CHANNELS.memory.CHANGED)
    expect(broadcasts.at(-1)?.target).toEqual({ to: 'all' })
    expect(broadcasts.at(-1)?.args).toEqual([null, 'global'])
  })
})

describe('memory.IMPORT replace', () => {
  it('rewrites lessons/context/history and drops pre-existing extras', async () => {
    seedWorkspace('ws1')
    const ws = wsFiles('ws1')
    new LessonStore(ws.lessonsPath, 'workspace').add(lesson('stale lesson'))
    ws.appendDailyHistory('stale day', '2026-06-30')
    const { invoke, pushCalls } = createHarness()
    const bundle: MemoryExportBundle = {
      version: 1,
      lessons: [lesson('only rule')],
      context: 'only context',
      preferences: 'only prefs',
      history: [{ day: '2026-07-04', text: '# 2026-07-04\n\nonly day\n' }],
    }
    const result = (await invoke(IMPORT_CH, 'workspace', 'ws1', bundle, { mode: 'replace' })) as MemoryImportResult
    expect(result).toMatchObject({ added: 1, skipped: 0, historyAdded: 1, historySkipped: 0 })
    const rules = new LessonStore(ws.lessonsPath, 'workspace').list().map(l => l.rule)
    expect(rules).toEqual(['only rule'])
    expect(ws.readContext()).toBe('only context')
    expect(ws.listHistoryDates()).toEqual(['2026-07-04'])
    expect(ws.readHistory('2026-07-04')).toBe('# 2026-07-04\n\nonly day\n')
    expect(new MemoryFileStore('global').readPreferences()).toBe('only prefs')
    const broadcasts = pushCalls.filter(p => p.channel === RPC_CHANNELS.memory.CHANGED)
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0].args).toEqual(['ws1', 'workspace'])
  })

  it('round-trips: export → replace import → export yields the same bundle', async () => {
    seedWorkspace('ws1')
    const { invoke } = createHarness()
    const original = (await invoke(EXPORT_CH, 'workspace', 'ws1')) as MemoryExportBundle
    await invoke(IMPORT_CH, 'workspace', 'ws1', original, { mode: 'replace' })
    const again = (await invoke(EXPORT_CH, 'workspace', 'ws1')) as MemoryExportBundle
    expect(again).toEqual(original)
  })

  it('rejects a wrong bundle version and invalid mode (no broadcast, no writes)', async () => {
    const { invoke, pushCalls } = createHarness()
    await expect(
      invoke(IMPORT_CH, 'global', null, { version: 2, lessons: [], context: '', preferences: '', history: [] }),
    ).rejects.toThrow('version')
    await expect(
      invoke(IMPORT_CH, 'global', null, { version: 1, lessons: [], context: '', preferences: '', history: [] }, { mode: 'nope' }),
    ).rejects.toThrow('mode')
    expect(pushCalls).toHaveLength(0)
    expect(new LessonStore(new MemoryFileStore('global').lessonsPath, 'global').list()).toEqual([])
  })
})

describe('registration', () => {
  it('registers every channel in HANDLED_CHANNELS', () => {
    const handlers = new Map<string, HandlerFn>()
    const server = { handle: (c: string, h: HandlerFn) => handlers.set(c, h) } as unknown as RpcServer
    registerMemoryIoHandlers(server, {} as HandlerDeps)
    for (const ch of HANDLED_CHANNELS) expect(handlers.has(ch)).toBe(true)
  })
})
