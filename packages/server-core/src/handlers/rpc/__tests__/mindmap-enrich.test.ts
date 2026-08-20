import { describe, expect, test } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  addChild,
  createEmptyGraph,
  finalizeGraph,
  type MindMapGraph,
} from '@craft-agent/core/mindmap'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import type { RequestContext } from '../../../transport/types'
import { registerMindmapHandlers } from '../mindmap'

type HandlerFn = (ctx: RequestContext, ...args: unknown[]) => unknown | Promise<unknown>

function sampleGraph(): MindMapGraph {
  const g = createEmptyGraph({ type: 'note', noteId: 'n1' }, 'Doc')
  addChild(g, g.rootId, { id: 'a', label: 'Alpha', kind: 'heading' })
  addChild(g, 'a', { id: 'a1', label: 'Alpha detail', kind: 'section' })
  addChild(g, g.rootId, { id: 'b', label: 'Beta', kind: 'heading' })
  return finalizeGraph(g, 'note')
}

function createHarness(distiller?: (workspaceId: string, prompt: string) => Promise<string>) {
  const handlers = new Map<string, HandlerFn>()
  const distillCalls: Array<{ workspaceId: string; prompt: string }> = []

  const server = {
    handle(channel: string, handler: HandlerFn) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
    hasClientCapability() {
      return false
    },
    findClientsWithCapability() {
      return []
    },
  } as unknown as RpcServer

  const deps = {
    sessionManager: distiller
      ? {
          runDistillOneShot: (workspaceId: string, prompt: string) => {
            distillCalls.push({ workspaceId, prompt })
            return distiller(workspaceId, prompt)
          },
        }
      : {},
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
  } as unknown as HandlerDeps

  registerMindmapHandlers(server, deps)

  const invoke = (input: unknown) => {
    const handler = handlers.get(RPC_CHANNELS.mindmap.ENRICH)
    if (!handler) throw new Error('mindmap:enrich not registered')
    return handler({ clientId: 'c1', workspaceId: 'ws1' } as RequestContext, input)
  }

  return { invoke, distillCalls }
}

describe('mindmap.enrich RPC', () => {
  test('registers channel and applies LLM JSON outline', async () => {
    const graph = sampleGraph()
    const { invoke, distillCalls } = createHarness(async () =>
      JSON.stringify({
        outline: [{ id: 'a', label: 'Alpha improved', children: [{ label: 'Only child' }] }],
      }),
    )

    const result = (await invoke({
      workspaceId: 'ws1',
      entity: graph.entity,
      graph,
    })) as { ok: boolean; mode?: string; graph?: MindMapGraph }

    expect(distillCalls).toHaveLength(1)
    expect(distillCalls[0]!.prompt).toContain('Alpha')
    expect(result.ok).toBe(true)
    expect(result.mode).toBe('llm')
    expect(result.graph?.derivation).toBe('enriched')
    expect(result.graph?.nodes.root?.children.length).toBe(1)
    expect(result.graph?.nodes.a?.label).toBe('Alpha improved')
  })

  test('heuristicOnly skips LLM', async () => {
    const graph = sampleGraph()
    const { invoke, distillCalls } = createHarness(async () => {
      throw new Error('should not call LLM')
    })

    const result = (await invoke({
      workspaceId: 'ws1',
      entity: graph.entity,
      graph,
      heuristicOnly: true,
    })) as { ok: boolean; mode?: string }

    expect(distillCalls).toHaveLength(0)
    expect(result.ok).toBe(true)
    expect(result.mode).toBe('heuristic')
  })

  test('LLM failure falls back to heuristic', async () => {
    const graph = sampleGraph()
    const { invoke } = createHarness(async () => {
      throw new Error('boom')
    })

    const result = (await invoke({
      workspaceId: 'ws1',
      entity: graph.entity,
      graph,
    })) as { ok: boolean; mode?: string }

    expect(result.ok).toBe(true)
    expect(result.mode).toBe('heuristic')
  })

  test('missing graph fails soft', async () => {
    const { invoke } = createHarness()
    const result = (await invoke({ workspaceId: 'ws1' })) as {
      ok: boolean
      mode?: string
      error?: string
    }
    expect(result.ok).toBe(false)
    expect(result.mode).toBe('passthrough')
    expect(result.error).toMatch(/graph required/i)
  })
})
