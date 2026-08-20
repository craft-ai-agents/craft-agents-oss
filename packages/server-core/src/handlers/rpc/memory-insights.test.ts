/**
 * Handler tests for memory:insights / memory:markOnboarded, following the
 * memory-skills-pending.test.ts harness pattern: workspace resolution is
 * mocked and the global config dir is redirected via memory-test-setup.
 */
import './memory-test-setup' // must run before any module reading CRAFT_CONFIG_DIR
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { MemoryInsights } from '@craft-agent/shared/memory/types'
import type { RpcServer, HandlerFn, RequestContext } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let workspaceRoot: string
const configDir = process.env.CRAFT_CONFIG_DIR!

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) =>
    id === 'ws1' ? { id: 'ws1', name: 'ws1', rootPath: workspaceRoot } : null,
}))

import { registerMemoryInsightsHandlers, HANDLED_CHANNELS, ONBOARDED_MARKER } from './memory-insights'
import { AuditLog } from '../../memory/AuditLog'
import { LessonStore } from '../../memory/LessonStore'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { SkillPendingQueue } from '../../memory/SkillPendingQueue'

function harness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  } as unknown as RpcServer
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
  registerMemoryInsightsHandlers(server, deps)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: null } as unknown as RequestContext, ...args)
  }
  return { invoke }
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'insights-ws-'))
  rmSync(configDir, { recursive: true, force: true })
  mkdirSync(configDir, { recursive: true })
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

function addLesson(scope: 'global' | 'workspace', rule: string, category: 'preference' | 'workflow' | 'knowledge' | 'correction') {
  const store = new LessonStore(new MemoryFileStore(scope, workspaceRoot).lessonsPath, scope)
  store.add({ ts: new Date().toISOString(), rule, category, scope, source: { trigger: 'explicit' } })
}

it('memory:insights counts audits from both scopes, grouped by 7d window', async () => {
  const { invoke } = harness()
  const globalLog = new AuditLog('global')
  // Fresh counters (inside the window)
  globalLog.append({ actor: 'rpc', action: 'add', target: 'rule a' })
  globalLog.append({ actor: 'distill', action: 'conflict', target: 'rule b' })
  globalLog.append({ actor: 'queue', action: 'approved', target: 'skill-x' })
  // Stale: outside the 7d window — must not be counted
  globalLog.append({ actor: 'rpc', action: 'add', target: 'old rule', ts: new Date(Date.now() - 10 * 24 * 3600e3).toISOString() })
  // Workspace audit merges into the same counters
  const wsLog = new AuditLog('workspace', workspaceRoot)
  wsLog.append({ actor: 'distill', action: 'add', target: 'ws rule' })
  wsLog.append({ actor: 'queue', action: 'dismissed', target: 'skill-y' })

  const insights = (await invoke(RPC_CHANNELS.memory.INSIGHTS, 'ws1')) as MemoryInsights
  expect({
    lessonsAdded7d: insights.lessonsAdded7d,
    conflicts7d: insights.conflicts7d,
    approved7d: insights.approved7d,
  }).toEqual({ lessonsAdded7d: 2, conflicts7d: 1, approved7d: 1 })
  // 'dismissed' and the stale 'add' are NOT counted anywhere above
  expect(insights.pendingCount).toBe(0)
})

it('memory:insights derives categories from the live stores and counts the pending queue', async () => {
  const { invoke } = harness()
  // Two global lessons + one workspace lesson across distinct categories
  addLesson('global', 'run tests before done', 'workflow')
  addLesson('global', 'prefer bun over npm', 'preference')
  addLesson('workspace', 'this repo uses prettier', 'workflow')
  // One dangling pending candidate lifts pendingCount
  const queue = new SkillPendingQueue(workspaceRoot)
  expect(queue.enqueue({ slug: 'candidate-one', description: 'd', body: 'b', source: { ts: new Date().toISOString() } })).toBe(true)

  const insights = (await invoke(RPC_CHANNELS.memory.INSIGHTS, 'ws1')) as MemoryInsights
  expect(insights.categories).toEqual({ preference: 1, workflow: 2 })
  expect(insights.totalLessons).toBe(3)
  expect(insights.pendingCount).toBe(1)
  expect(insights.onboarded).toBe(false)
})

it('memory:insights without a workspace only reads the global scope', async () => {
  const { invoke } = harness()
  addLesson('global', 'global rule', 'knowledge')
  const wsLog = new AuditLog('workspace', workspaceRoot)
  wsLog.append({ actor: 'rpc', action: 'add', target: 'invisible ws rule' })

  const insights = (await invoke(RPC_CHANNELS.memory.INSIGHTS)) as MemoryInsights
  expect(insights.totalLessons).toBe(1)
  expect(insights.categories).toEqual({ knowledge: 1 })
  // 1 = the audit line LessonStore.add appended for the global lesson. The
  // workspace-scoped 'add' is skipped: no workspaceId → no workspace audit.
  expect(insights.lessonsAdded7d).toBe(1)
  expect(insights.pendingCount).toBe(0)
})

it('memory:markOnboarded stamps the marker and insights reflects it', async () => {
  const { invoke } = harness()
  expect((await invoke(RPC_CHANNELS.memory.INSIGHTS) as MemoryInsights).onboarded).toBe(false)
  await invoke(RPC_CHANNELS.memory.MARK_ONBOARDED)
  expect(existsSync(join(configDir, 'memory', ONBOARDED_MARKER))).toBe(true)
  expect((await invoke(RPC_CHANNELS.memory.INSIGHTS) as MemoryInsights).onboarded).toBe(true)
})

it('registers every channel in HANDLED_CHANNELS', () => {
  const handlers = new Set<string>()
  const server = { handle: (c: string) => { handlers.add(c) } } as unknown as RpcServer
  registerMemoryInsightsHandlers(server, {} as HandlerDeps)
  for (const ch of HANDLED_CHANNELS) expect(handlers.has(ch)).toBe(true)
})
