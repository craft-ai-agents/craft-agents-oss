import { describe, expect, test } from 'bun:test'
import { buildAgentCreateSessionOptions } from './run-agent'
import type { AgentDefinitionDTO } from '../../shared/types'
import type { MemoryEntry } from '@craft-agent/shared/memory/types'

function makeAgent(): AgentDefinitionDTO {
  return {
    slug: 'test-agent',
    metadata: {
      name: 'Test Agent',
      description: 'For tests.',
    },
    systemPrompt: 'You are a test agent.',
    path: '/tmp/fake',
    source: 'global',
  } as AgentDefinitionDTO
}

function makeMemory(name: string, expires?: string): MemoryEntry {
  return {
    name,
    type: 'reference',
    created: '2026-05-01',
    expires,
    body: 'Body.',
  }
}

describe('buildAgentCreateSessionOptions memory receipts', () => {
  test('records active user and agent memory names in direct launch receipts', () => {
    const options = buildAgentCreateSessionOptions(makeAgent(), {
      skills: [],
      sources: [],
      userMemoryEntries: [
        makeMemory('Current user fact', '2999-12-31'),
        makeMemory('Expired user fact', '2000-01-01'),
      ],
      agentMemoryEntries: [makeMemory('Review rule')],
    })

    expect(options.launchReceipt?.injected.memory).toEqual({
      user: [{ name: 'Current user fact' }],
      agent: [{ name: 'Review rule' }],
    })
  })
})
