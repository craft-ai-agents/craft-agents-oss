/**
 * Tests for McpAppsHostBridge JSON-RPC message routing.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { McpAppsHostBridge, type McpAppsHostBridgeOptions } from '../McpAppsHostBridge'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessageEvent(data: unknown): MessageEvent {
  return { data } as MessageEvent
}

function createBridge(overrides: Partial<McpAppsHostBridgeOptions> = {}) {
  const sent: unknown[] = []
  const options: McpAppsHostBridgeOptions = {
    sendMessage: (data) => sent.push(data),
    hostInfo: { name: 'TestHost', version: '1.0.0' },
    hostContext: { theme: { mode: 'dark' }, displayMode: 'inline', platform: 'desktop' },
    hostCapabilities: { openLinks: {}, logging: {} },
    ...overrides,
  }
  const bridge = new McpAppsHostBridge(options)
  return { bridge, sent }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpAppsHostBridge', () => {
  describe('message routing', () => {
    it('ignores non-JSON-RPC messages', () => {
      const { bridge, sent } = createBridge()
      bridge.handleMessage(makeMessageEvent({ type: 'random' }))
      bridge.handleMessage(makeMessageEvent(null))
      bridge.handleMessage(makeMessageEvent('string'))
      expect(sent).toHaveLength(0)
    })

    it('ui/initialize returns host info and capabilities', async () => {
      const { bridge, sent } = createBridge()
      bridge.handleMessage(makeMessageEvent({
        jsonrpc: '2.0',
        id: 1,
        method: 'ui/initialize',
        params: {},
      }))
      // handleRequest is async, wait a tick
      await new Promise(r => setTimeout(r, 10))
      expect(sent).toHaveLength(1)
      const response = sent[0] as Record<string, unknown>
      expect(response.id).toBe(1)
      const result = response.result as Record<string, unknown>
      expect(result.protocolVersion).toBe('2025-03-26')
      expect(result.hostInfo).toEqual({ name: 'TestHost', version: '1.0.0' })
      expect(result.hostCapabilities).toBeDefined()
    })

    it('tools/call invokes onCallTool with correct args', async () => {
      const calls: Array<{ name: string; args: Record<string, unknown> }> = []
      const { bridge, sent } = createBridge({
        onCallTool: async (name, args) => {
          calls.push({ name, args })
          return { result: 'ok' }
        },
      })
      bridge.handleMessage(makeMessageEvent({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'my-tool', arguments: { x: 1 } },
      }))
      await new Promise(r => setTimeout(r, 10))
      expect(calls).toHaveLength(1)
      expect(calls[0]!.name).toBe('my-tool')
      expect(calls[0]!.args).toEqual({ x: 1 })
      const response = sent[0] as Record<string, unknown>
      expect(response.id).toBe(2)
      expect((response.result as Record<string, unknown>).result).toBe('ok')
    })

    it('tools/call returns error when no handler', async () => {
      const { bridge, sent } = createBridge()
      bridge.handleMessage(makeMessageEvent({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'tool', arguments: {} },
      }))
      await new Promise(r => setTimeout(r, 10))
      expect(sent).toHaveLength(1)
      const response = sent[0] as Record<string, unknown>
      expect(response.error).toBeDefined()
      expect((response.error as Record<string, unknown>).code).toBe(-32601)
    })

    it('resources/read invokes onReadResource', async () => {
      const uris: string[] = []
      const { bridge } = createBridge({
        onReadResource: async (uri) => {
          uris.push(uri)
          return { contents: 'data' }
        },
      })
      bridge.handleMessage(makeMessageEvent({
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: { uri: 'file:///test.txt' },
      }))
      await new Promise(r => setTimeout(r, 10))
      expect(uris).toEqual(['file:///test.txt'])
    })

    it('resources/list invokes onListResources', async () => {
      let called = false
      const { bridge, sent } = createBridge({
        onListResources: async () => {
          called = true
          return { resources: [{ uri: 'a' }] }
        },
      })
      bridge.handleMessage(makeMessageEvent({
        jsonrpc: '2.0',
        id: 5,
        method: 'resources/list',
        params: {},
      }))
      await new Promise(r => setTimeout(r, 10))
      expect(called).toBe(true)
      const response = sent[0] as Record<string, unknown>
      expect((response.result as Record<string, unknown>).resources).toBeDefined()
    })

    it('ui/open-link invokes onOpenLink', async () => {
      const urls: string[] = []
      const { bridge } = createBridge({
        onOpenLink: (url) => urls.push(url),
      })
      bridge.handleMessage(makeMessageEvent({
        jsonrpc: '2.0',
        id: 6,
        method: 'ui/open-link',
        params: { url: 'https://example.com' },
      }))
      await new Promise(r => setTimeout(r, 10))
      expect(urls).toEqual(['https://example.com'])
    })

    it('ui/notifications/size-changed invokes onSizeChanged', () => {
      const sizes: Array<{ width?: number; height?: number }> = []
      const { bridge } = createBridge({
        onSizeChanged: (size) => sizes.push(size),
      })
      bridge.handleMessage(makeMessageEvent({
        jsonrpc: '2.0',
        method: 'ui/notifications/size-changed',
        params: { height: 300 },
      }))
      expect(sizes).toEqual([{ height: 300 }])
    })

    it('ui/notifications/initialized invokes onInitialized', () => {
      let called = false
      const { bridge } = createBridge({
        onInitialized: () => { called = true },
      })
      bridge.handleMessage(makeMessageEvent({
        jsonrpc: '2.0',
        method: 'ui/notifications/initialized',
        params: {},
      }))
      expect(called).toBe(true)
    })

    it('unknown method returns error -32601', async () => {
      const { bridge, sent } = createBridge()
      bridge.handleMessage(makeMessageEvent({
        jsonrpc: '2.0',
        id: 7,
        method: 'unknown/method',
        params: {},
      }))
      await new Promise(r => setTimeout(r, 10))
      expect(sent).toHaveLength(1)
      const response = sent[0] as Record<string, unknown>
      expect((response.error as Record<string, unknown>).code).toBe(-32601)
    })

    it('handler exception returns error -32603', async () => {
      const { bridge, sent } = createBridge({
        onCallTool: async () => { throw new Error('boom') },
      })
      bridge.handleMessage(makeMessageEvent({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'tool', arguments: {} },
      }))
      await new Promise(r => setTimeout(r, 10))
      const response = sent[0] as Record<string, unknown>
      expect((response.error as Record<string, unknown>).code).toBe(-32603)
      expect((response.error as Record<string, unknown>).message).toBe('boom')
    })
  })

  describe('outgoing messages', () => {
    it('sendToolInput sends correct notification', () => {
      const { bridge, sent } = createBridge()
      bridge.sendToolInput({ foo: 'bar' })
      expect(sent).toHaveLength(1)
      const msg = sent[0] as Record<string, unknown>
      expect(msg.jsonrpc).toBe('2.0')
      expect(msg.method).toBe('ui/notifications/tool-input')
      expect((msg.params as Record<string, unknown>).arguments).toEqual({ foo: 'bar' })
    })

    it('sendToolResult wraps non-content objects in structuredContent', () => {
      const { bridge, sent } = createBridge()
      bridge.sendToolResult({ data: 123 })
      expect(sent).toHaveLength(1)
      const msg = sent[0] as Record<string, unknown>
      expect(msg.method).toBe('ui/notifications/tool-result')
      expect((msg.params as Record<string, unknown>).structuredContent).toEqual({ data: 123 })
    })

    it('sendToolResult passes through objects with content key', () => {
      const { bridge, sent } = createBridge()
      bridge.sendToolResult({ content: [{ type: 'text', text: 'hi' }] })
      expect(sent).toHaveLength(1)
      const msg = sent[0] as Record<string, unknown>
      expect((msg.params as Record<string, unknown>).content).toBeDefined()
      expect((msg.params as Record<string, unknown>).structuredContent).toBeUndefined()
    })
  })
})
