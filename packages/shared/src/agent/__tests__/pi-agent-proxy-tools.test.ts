import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'
import type { ProxyToolDef } from '../../mcp/mcp-pool.ts'

// The subprocess replaces its proxy tools with each set PiAgent sends (it used to merge them into
// what it had, so a turned-off source's tools stayed, and calling one turned the source back on).
// So each set is whole: the session tools and every source's tools.

const tool = (name: string): ProxyToolDef => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })

function createAgent(agentProfile?: 'coding') {
  let poolTools = [tool('mcp__linear__list_issues')]
  let enabledSources = new Set(['linear'])
  const config = {
    provider: 'pi',
    workspace: { id: 'ws-test', name: 'Test Workspace', rootPath: '/tmp/pi-proxy-tools-ws' },
    session: { id: 'pi-proxy-tools', workspaceRootPath: '/tmp/pi-proxy-tools-ws', createdAt: Date.now(), lastUsedAt: Date.now() },
    isHeadless: true,
    agentProfile,
    mcpPool: { getProxyToolDefs: () => poolTools },
  } as unknown as BackendConfig
  const agent = new PiAgent(config)
  const sent: Array<Record<string, unknown>> = []
  ;(agent as any).send = (message: Record<string, unknown>) => { sent.push(message) }
  ;(agent as any).subprocess = { stdin: { writable: true } }
  ;(agent as any).sourceManager.getIntendedSlugs = () => new Set(enabledSources)
  return {
    agent,
    sync: () => (agent as any).syncProxyTools(),
    sets: () => sent.filter(message => message.type === 'register_tools').map(message => (message.tools as ProxyToolDef[]).map(t => t.name)),
    turnOff: () => { poolTools = []; enabledSources = new Set() },
  }
}

describe('PiAgent proxy tools', () => {
  it('sends the session tools and the sources\' tools as one set, once', () => {
    const { sync, sets } = createAgent()
    sync()
    sync()
    expect(sets()).toHaveLength(1)
    expect(sets()[0]).toContain('mcp__session__SubmitPlan')
    expect(sets()[0]).toContain('mcp__linear__list_issues')
  })

  it('sends the whole set again when a source is turned off', () => {
    const { sync, sets, turnOff } = createAgent()
    sync()
    turnOff()
    sync()
    expect(sets()).toHaveLength(2)
    expect(sets()[1]).toContain('mcp__session__SubmitPlan')
    expect(sets()[1]).not.toContain('mcp__linear__list_issues')
  })

  it('drops the Coding profile\'s source tools with the last source', () => {
    const { sync, sets, turnOff } = createAgent('coding')
    sync()
    expect(sets()[0]).toContain('mcp__session__source_oauth_trigger')
    turnOff()
    sync()
    expect(sets()[1]).not.toContain('mcp__session__source_oauth_trigger')
  })

  it('sends nothing without a subprocess to send to', () => {
    const { agent, sync, sets } = createAgent()
    ;(agent as any).subprocess = null
    sync()
    expect(sets()).toHaveLength(0)
    ;(agent as any).subprocess = { stdin: { writable: true } }
    sync()
    expect(sets()).toHaveLength(1)
  })
})
