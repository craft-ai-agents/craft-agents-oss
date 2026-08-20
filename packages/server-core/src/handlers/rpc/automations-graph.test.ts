import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  automationGraphRevision,
  projectAutomationsToGraph,
} from '@craft-agent/shared/automations/graph'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, RequestContext } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

let workspaceRoot = ''

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (workspaceId: string) =>
    workspaceId === 'ws1' ? { id: 'ws1', name: 'ws1', rootPath: workspaceRoot } : null,
}))

import { registerAutomationsHandlers } from './automations'

type Handler = (context: RequestContext, ...args: unknown[]) => unknown | Promise<unknown>

function createHarness() {
  const handlers = new Map<string, Handler>()
  const pushes: Array<{
    channel: string
    target: unknown
    args: unknown[]
  }> = []
  const server = {
    handle(channel: string, handler: Handler) { handlers.set(channel, handler) },
    push(channel: string, target: unknown, ...args: unknown[]) {
      pushes.push({ channel, target, args })
    },
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  } as unknown as RpcServer
  const deps = {
    sessionManager: {},
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  } as unknown as HandlerDeps
  registerAutomationsHandlers(server, deps)

  return {
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`Missing handler: ${channel}`)
      const context = { clientId: 'test-client', workspaceId: 'ws1', webContentsId: null } as RequestContext
      return handler(context, ...args)
    },
    pushes,
  }
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'craft-automation-graph-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

test('projects a missing config without seeding a file', async () => {
  const configPath = join(workspaceRoot, 'automations.json')
  const { invoke } = createHarness()

  const projection = await invoke(
    RPC_CHANNELS.automations.GET_GRAPH,
    'ws1',
  ) as { isDefault: boolean; graph: { nodes: Array<{ kind: string }> } }

  expect(projection.isDefault).toBe(true)
  expect(projection.graph.nodes.some((node) => node.kind === 'trigger')).toBe(true)
  expect(existsSync(configPath)).toBe(false)
})

describe('automation graph save RPC', () => {
  test('atomically persists compiled automations and metadata without stale-write clobbering', async () => {
    const configPath = join(workspaceRoot, 'automations.json')
    const initial = {
      version: 2,
      craftSeedVersion: 1,
      preservedRootSetting: { keep: true },
      automations: {
        SchedulerTick: [{
          id: 'morning',
          name: 'Morning plan',
          cron: '0 9 * * 1-5',
          actions: [{ type: 'prompt', prompt: 'Prepare priorities.' }],
        }],
      },
    }
    writeFileSync(configPath, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8')

    const originalGraph = projectAutomationsToGraph(initial)
    const firstGraph = {
      ...originalGraph,
      nodes: originalGraph.nodes.map((node) =>
        node.kind === 'matcher' ? { ...node, label: 'Edited morning plan' } : node,
      ),
    }
    const { invoke, pushes } = createHarness()

    const saved = await invoke(RPC_CHANNELS.automations.SAVE_GRAPH, {
      workspaceId: 'ws1',
      graph: firstGraph,
      baseRevision: automationGraphRevision(initial),
    }) as { revision: string; automationCount: number }

    expect(saved.automationCount).toBe(1)
    expect(saved.revision).not.toBe(automationGraphRevision(initial))
    expect(existsSync(`${configPath}.tmp`)).toBe(false)
    expect(pushes).toContainEqual({
      channel: RPC_CHANNELS.automations.CHANGED,
      target: { to: 'workspace', workspaceId: 'ws1' },
      args: ['ws1'],
    })

    const afterFirstSave = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(afterFirstSave.preservedRootSetting).toEqual({ keep: true })
    expect(afterFirstSave.craftSeedVersion).toBe(1)
    expect(afterFirstSave.automations).toEqual(initial.automations)
    expect(afterFirstSave.automationGraph.nodes.find((node: { kind: string }) => node.kind === 'matcher')?.label)
      .toBe('Edited morning plan')

    const staleGraph = {
      ...firstGraph,
      nodes: firstGraph.nodes.map((node) =>
        node.kind === 'matcher' ? { ...node, label: 'Stale overwrite' } : node,
      ),
    }
    await expect(invoke(RPC_CHANNELS.automations.SAVE_GRAPH, {
      workspaceId: 'ws1',
      graph: staleGraph,
      baseRevision: automationGraphRevision(initial),
    })).rejects.toThrow(/stale/)

    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual(afterFirstSave)
  })
})
