/**
 * Handler tests for the self-learning v2 L2/L3 memory RPC paths:
 * - ADD_LESSON returns {lesson, conflicts} where the post-write LLM conflict
 *   check is best-effort: canned JSON verdicts surface, garbage/throw/no-LLM
 *   degrade to [] without blocking the write.
 * - PROMOTION_CANDIDATES / PROMOTE_LESSON wire the lesson-graph helpers to
 *   the RPC layer and broadcast memory.changed(global) on promote.
 *
 * Follows the memory-skills-pending.test.ts harness: workspace resolution and
 * the workspace registry (@craft-agent/shared/config) are mocked; the global
 * config dir is redirected via memory-test-setup.
 */
import './memory-test-setup' // must run before any module reading CRAFT_CONFIG_DIR
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, HandlerFn, RequestContext } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let workspaceRoots: string[]
const configDir = process.env.CRAFT_CONFIG_DIR!

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => {
    const i = ['ws1', 'ws2', 'ws3'].indexOf(id)
    return i >= 0 ? { id, name: id, rootPath: workspaceRoots[i] } : null
  },
  getWorkspaces: () => ['ws1', 'ws2', 'ws3'].map((id, i) => ({ id, name: id, rootPath: workspaceRoots[i] })),
}))

import { registerMemoryHandlers } from './memory'

interface DistillCall {
  workspaceId: string
  prompt: string
}

function createHarness(distiller?: (workspaceId: string, prompt: string) => Promise<string>) {
  const handlers = new Map<string, HandlerFn>()
  const pushCalls: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  const distillCalls: DistillCall[] = []

  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push(channel, target, ...args) { pushCalls.push({ channel, target, args }) },
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }

  const deps: HandlerDeps = {
    sessionManager: (distiller
      ? {
          runDistillOneShot: (workspaceId: string, prompt: string) => {
            distillCalls.push({ workspaceId, prompt })
            return distiller(workspaceId, prompt)
          },
        }
      : {}) as HandlerDeps['sessionManager'],
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

  registerMemoryHandlers(server, deps)

  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: null } as unknown as RequestContext, ...args)
  }

  return { invoke, pushCalls, distillCalls }
}

beforeEach(() => {
  workspaceRoots = [0, 1, 2].map(() => mkdtempSync(join(tmpdir(), 'mem-l23-ws-')))
  rmSync(configDir, { recursive: true, force: true })
  mkdirSync(configDir, { recursive: true })
})

afterEach(() => {
  for (const root of workspaceRoots) rmSync(root, { recursive: true, force: true })
})

const ADD = RPC_CHANNELS.memory.ADD_LESSON

describe('ADD_LESSON → {lesson, conflicts} (spec L2)', () => {
  it('surfaces LLM verdicts and never blocks the write', async () => {
    const { invoke } = createHarness(async (_ws, prompt) => {
      expect(prompt).toContain('Always run typecheck')
      expect(prompt).toContain('Skip all checks')
      return JSON.stringify({
        conflicts: [{ existingRule: 'Always run typecheck', relation: 'contradicts' }],
        rationale: 'skip vs always',
      })
    })

    const first = await invoke(ADD, null, { rule: 'Always run typecheck', category: 'workflow', scope: 'global' })
    expect(first).toMatchObject({ lesson: { rule: 'Always run typecheck' }, conflicts: [] })

    const result = await invoke(ADD, null, { rule: 'Skip all checks', category: 'workflow', scope: 'global' })
    expect(result.lesson.rule).toBe('Skip all checks')
    expect(result.conflicts).toEqual([
      { existingRule: 'Always run typecheck', relation: 'contradicts', rationale: 'skip vs always' },
    ])
    // the write stood despite the conflict report
    expect((await invoke(RPC_CHANNELS.memory.LIST_LESSONS, 'global')).map((l: { rule: string }) => l.rule))
      .toEqual(['Always run typecheck', 'Skip all checks'])
  })

  it('degrades to [] on unparseable LLM replies', async () => {
    const { invoke, distillCalls } = createHarness(async () => 'sure! here is what I think: nah.')
    await invoke(ADD, null, { rule: 'Always run typecheck', category: 'workflow', scope: 'global' })
    const result = await invoke(ADD, null, { rule: 'Skip all checks', category: 'workflow', scope: 'global' })
    expect(result.conflicts).toEqual([])
    expect(distillCalls).toHaveLength(1) // first add short-circuits (no existing rules)
  })

  it('degrades to [] when the distiller throws', async () => {
    const { invoke } = createHarness(async () => {
      throw new Error('no LLM configured')
    })
    await invoke(ADD, null, { rule: 'Always run typecheck', category: 'workflow', scope: 'global' })
    const result = await invoke(ADD, null, { rule: 'Skip all checks', category: 'workflow', scope: 'global' })
    expect(result).toMatchObject({ lesson: { rule: 'Skip all checks' }, conflicts: [] })
    expect((await invoke(RPC_CHANNELS.memory.LIST_LESSONS, 'global'))).toHaveLength(2)
  })

  it('returns [] when no distiller is wired at all', async () => {
    const { invoke } = createHarness()
    await invoke(ADD, null, { rule: 'Always run typecheck', category: 'workflow', scope: 'global' })
    const result = await invoke(ADD, null, { rule: 'Skip all checks', category: 'workflow', scope: 'global' })
    expect(result.conflicts).toEqual([])
  })

  it('workspace adds are checked against workspace AND global rules', async () => {
    const { invoke, distillCalls } = createHarness(async () => '{"conflicts":[]}')
    await invoke(ADD, null, { rule: 'Global baseline', category: 'knowledge', scope: 'global' })
    const result = await invoke(ADD, 'ws1', { rule: 'ws rule', category: 'workflow', scope: 'workspace' })
    expect(result.conflicts).toEqual([])
    expect(distillCalls).toHaveLength(1)
    expect(distillCalls[0].workspaceId).toBe('ws1')
    expect(distillCalls[0].prompt).toContain('Global baseline')
    expect(distillCalls[0].prompt).toContain('ws rule')
  })
})

describe('promotion handlers (spec L3)', () => {
  it('lists candidates and promotes into the global store with broadcast', async () => {
    const { invoke, pushCalls } = createHarness()
    await invoke(ADD, 'ws1', { rule: 'Use bun, not npm', category: 'workflow', scope: 'workspace' })
    await invoke(ADD, 'ws2', { rule: ' use BUN, not npm ', category: 'workflow', scope: 'workspace' })
    await invoke(ADD, 'ws3', { rule: 'Unique to ws3', category: 'workflow', scope: 'workspace' })

    const candidates = await invoke(RPC_CHANNELS.memory.PROMOTION_CANDIDATES)
    expect(candidates).toEqual([{ rule: 'Use bun, not npm', category: 'workflow', workspaceIds: ['ws1', 'ws2'] }])

    const promoted = await invoke(RPC_CHANNELS.memory.PROMOTE_LESSON, null, 'use bun, not npm')
    expect(promoted.alreadyGlobal).toBe(false)
    expect(promoted.lesson).toMatchObject({
      scope: 'global',
      rule: 'Use bun, not npm',
      promoted: { fromScope: 'workspace', workspaceIds: ['ws1', 'ws2'] },
    })
    expect(pushCalls.at(-1)).toMatchObject({
      channel: RPC_CHANNELS.memory.CHANGED,
      target: { to: 'all' },
      args: [null, 'global'],
    })
    expect((await invoke(RPC_CHANNELS.memory.LIST_LESSONS, 'global')).map((l: { rule: string }) => l.rule))
      .toEqual(['Use bun, not npm'])

    // second promote dedups in place
    const again = await invoke(RPC_CHANNELS.memory.PROMOTE_LESSON, null, 'Use bun, not npm')
    expect(again.alreadyGlobal).toBe(true)
    expect(await invoke(RPC_CHANNELS.memory.LIST_LESSONS, 'global')).toHaveLength(1)

    // unknown rule → null, no broadcast
    const broadcastsBefore = pushCalls.length
    expect(await invoke(RPC_CHANNELS.memory.PROMOTE_LESSON, null, 'not a rule')).toBeNull()
    expect(pushCalls).toHaveLength(broadcastsBefore)
  })
})
