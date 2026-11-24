import { describe, expect, it } from 'bun:test'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import {
  createToolServer,
  liveMcpServers,
  mcpServerChanges,
  mcpServerSignature,
  waitForIdleMcpServers,
  waitForMcpServers,
  type ToolServer,
} from './live-mcp-servers.ts'

const done = async () => ({ content: [] })

function server(name: string, toolNames: string[]) {
  return createToolServer({ name, version: '1.0.0', tools: toolNames.map(toolName => tool(toolName, toolName, {}, done)) })
}

/** A server with one tool whose calls run until finished, connected to an MCP client. */
async function slowServer(name: string) {
  const calls: Array<{ finish: () => void }> = []
  let started!: () => void
  const firstCall = new Promise<void>((resolve) => { started = resolve })
  const slow = createToolServer({
    name,
    version: '1.0.0',
    tools: [tool('slow', 'slow', {}, () => new Promise((resolve) => {
      calls.push({ finish: () => resolve({ content: [] }) })
      started()
    }))],
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await slow.instance.connect(serverTransport)
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(clientTransport)
  return { server: slow, client, calls, firstCall }
}

describe('mcpServerSignature', () => {
  it('is the same for servers serving the same tools, whatever the order or instance', () => {
    expect(mcpServerSignature(server('session', ['b', 'a']))).toBe(mcpServerSignature(server('session', ['a', 'b'])))
    expect(mcpServerSignature(server('session', ['a']))).not.toBe(mcpServerSignature(server('session', ['a', 'b'])))
  })

  it('ignores descriptions and schemas: the CLI keeps a listed tool\'s definition anyway', () => {
    const signature = (description: string, shape: z.ZodRawShape) =>
      mcpServerSignature(createToolServer({ name: 'linear', tools: [tool('list_issues', description, shape, done)] }))
    expect(signature('List open issues', { team: z.number() })).toBe(signature('List issues', { team: z.string() }))
  })

  it('compares other in-process servers by name and process servers by config', () => {
    expect(mcpServerSignature(createSdkMcpServer({ name: 'plain', version: '1.0.0', tools: [] }))).toBe('')
    expect(mcpServerSignature({ type: 'http', url: 'https://example.com/mcp' })).toBe(JSON.stringify({ type: 'http', url: 'https://example.com/mcp' }))
  })
})

describe('mcpServerChanges', () => {
  const session = server('session', ['a'])
  const linear = server('source-proxy-linear', ['x'])

  it('is null when the servers and their tools are the same', () => {
    expect(mcpServerChanges(liveMcpServers({ session, linear }), { linear: server('source-proxy-linear', ['x']), session: server('session', ['a']) })).toBeNull()
  })

  it('adds and drops servers without replacing the others', () => {
    expect(mcpServerChanges(liveMcpServers({ session }), { session, linear })).toEqual({ unchanged: ['session'], replaced: [], dropped: [] })
    expect(mcpServerChanges(liveMcpServers({ session, linear }), { session })).toEqual({ unchanged: ['session'], replaced: [], dropped: ['linear'] })
  })

  it('replaces a server whose tools changed', () => {
    expect(mcpServerChanges(liveMcpServers({ session, linear }), { session: server('session', ['a', 'source_test']), linear }))
      .toEqual({ unchanged: ['linear'], replaced: ['session'], dropped: [] })
  })

  it('replaces a server that failed to connect, and every server when the current set is unknown', () => {
    const current = liveMcpServers({ session, linear })
    current.set('linear', { config: linear, signature: null })
    expect(mcpServerChanges(current, { session, linear })).toEqual({ unchanged: ['session'], replaced: ['linear'], dropped: [] })
    expect(mcpServerChanges(null, { session, linear })).toEqual({ unchanged: [], replaced: ['session', 'linear'], dropped: [] })
  })
})

describe('waitForIdleMcpServers', () => {
  it('reports a server answering a call as busy until the call finishes', async () => {
    const slow = await slowServer('session')
    const current = liveMcpServers({ session: slow.server, linear: server('source-proxy-linear', ['x']) })
    expect(await waitForIdleMcpServers(current, ['session', 'linear'], Date.now() + 1_000)).toEqual([])

    const call = slow.client.callTool({ name: 'slow', arguments: {} })
    await slow.firstCall
    expect(await waitForIdleMcpServers(current, ['session', 'linear'], Date.now() + 20)).toEqual(['session'])

    const idle = waitForIdleMcpServers(current, ['session'], Date.now() + 1_000)
    slow.calls[0]!.finish()
    expect(await idle).toEqual([])
    expect(await call).toMatchObject({ content: [] })
  })

  it('asks nothing of servers it did not build', async () => {
    const current = liveMcpServers({ remote: { type: 'http', url: 'https://example.com/mcp' } as never as ToolServer })
    expect(await waitForIdleMcpServers(current, ['remote', 'unknown'], Date.now() + 1_000)).toEqual([])
  })
})

describe('waitForMcpServers', () => {
  const live = (statuses: () => Array<{ name: string; status: string }>) => ({ mcpServerStatus: async () => statuses() }) as any

  it('waits while a server is pending or not listed yet', async () => {
    let checks = 0
    const query = live(() => {
      checks++
      return checks === 1 ? [] : [{ name: 'linear', status: checks < 3 ? 'pending' : 'connected' }]
    })
    expect(await waitForMcpServers(query, ['linear'], Date.now() + 1_000)).toEqual([])
    expect(checks).toBe(3)
  })

  it('returns the servers that failed, or are still connecting at the deadline', async () => {
    const query = live(() => [{ name: 'linear', status: 'failed' }, { name: 'github', status: 'pending' }, { name: 'session', status: 'connected' }])
    expect(await waitForMcpServers(query, ['linear', 'session'], Date.now() + 1_000)).toEqual(['linear'])
    expect(await waitForMcpServers(query, ['github', 'session'], Date.now() + 20)).toEqual(['github'])
  })

  it('asks nothing when no server was added', async () => {
    const query = live(() => { throw new Error('not asked') })
    expect(await waitForMcpServers(query, [], Date.now() + 1_000)).toEqual([])
  })
})
