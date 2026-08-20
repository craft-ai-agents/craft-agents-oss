import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  addChild,
  createEmptyGraph,
  createPinnedMap,
  finalizeGraph,
  pinFilename,
} from '@craft-agent/core/mindmap'
import type { RpcServer } from '../../../transport/types'
import type { HandlerDeps } from '../../handler-deps'
import type { RequestContext } from '../../../transport/types'

let root = ''
mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) =>
    id === 'ws1' ? { id: 'ws1', name: 'ws1', rootPath: root } : null,
}))

import { MINDMAP_PIN_DIRNAME, registerMindmapHandlers } from '../mindmap'

type HandlerFn = (ctx: RequestContext, ...args: unknown[]) => unknown | Promise<unknown>

function harness() {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  } as unknown as RpcServer
  const deps = {
    sessionManager: {},
    platform: {
      appRootPath: '/', resourcesPath: '/', isPackaged: false, appVersion: '0.0.0-test', isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  } as unknown as HandlerDeps
  registerMindmapHandlers(server, deps)
  return (channel: string, input: unknown) => {
    const h = handlers.get(channel)
    if (!h) throw new Error(`missing ${channel}`)
    return h({ clientId: 'c1', workspaceId: 'ws1' } as RequestContext, input)
  }
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mindmap-pin-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('mindmap pin IO RPC', () => {
  test('save load clear round-trip under workspace/mindmaps', async () => {
    const invoke = harness()
    const g0 = createEmptyGraph({ type: 'session', sessionId: 's1' }, 'S')
    addChild(g0, g0.rootId, { id: 'a', label: 'A', kind: 'turn' })
    const graph = finalizeGraph(g0, 'session')
    const pin = createPinnedMap(graph, { positions: { root: { x: 0, y: 0 } }, collapsed: [] }, 1, graph.contentHash)

    expect(await invoke(RPC_CHANNELS.mindmap.PIN_SAVE, { workspaceId: 'ws1', pin })).toEqual({ ok: true })
    const file = join(root, MINDMAP_PIN_DIRNAME, pinFilename(pin.entity))
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf-8')).toContain('"sessionId": "s1"')

    const loaded = await invoke(RPC_CHANNELS.mindmap.PIN_LOAD, { workspaceId: 'ws1', entity: pin.entity }) as { graph?: { contentHash?: string } } | null
    expect(loaded?.graph?.contentHash).toBe(graph.contentHash)

    expect(await invoke(RPC_CHANNELS.mindmap.PIN_CLEAR, { workspaceId: 'ws1', entity: pin.entity })).toEqual({ ok: true })
    expect(existsSync(file)).toBe(false)
    expect(await invoke(RPC_CHANNELS.mindmap.PIN_LOAD, { workspaceId: 'ws1', entity: pin.entity })).toBeNull()
  })
})
