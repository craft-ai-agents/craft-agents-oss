import { describe, it, expect } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { groupMessagesByTurn } from '../turn-utils'

const userMessage: Message = {
  id: 'user-1',
  role: 'user',
  content: 'Send a message',
  timestamp: 1000,
}

const toolCall: Message = {
  id: 'tool-1',
  role: 'tool',
  content: '',
  timestamp: 1100,
  toolName: 'mcp__session__send_agent_message',
  toolUseId: 'toolu_123',
  toolStatus: 'executing',
  toolInput: { target: 'agent-1' },
}

function visibleToolIds(messages: Message[]): string[] {
  const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')
  return turn?.type === 'assistant'
    ? turn.activities.filter(a => a.type === 'tool').map(a => a.toolUseId!)
    : []
}

describe('tool heartbeat display', () => {
  it('shows one running tool call through repeated SDK heartbeats and completion', () => {
    const heartbeats: Message[] = [0, 1].map((index) => ({
      id: `heartbeat-${index}`,
      role: 'tool' as const,
      content: '',
      timestamp: 1200 + index * 100,
      toolName: toolCall.toolName,
      toolUseId: `toolu_123-heartbeat-${index}`,
      parentToolUseId: 'toolu_123',
      toolStatus: 'executing' as const,
      toolInput: {},
    }))

    expect(visibleToolIds([userMessage, toolCall, ...heartbeats])).toEqual(['toolu_123'])
    expect(visibleToolIds([
      userMessage,
      { ...toolCall, toolStatus: 'completed', toolResult: 'Delivered' },
      ...heartbeats,
    ])).toEqual(['toolu_123'])
  })

  it('keeps real child tools and heartbeats whose parent is missing', () => {
    const child: Message = {
      ...toolCall,
      id: 'child-tool',
      timestamp: 1200,
      toolName: 'Read',
      toolUseId: 'toolu_child',
      parentToolUseId: 'toolu_123',
    }
    const orphan: Message = {
      ...toolCall,
      id: 'orphan-heartbeat',
      timestamp: 1300,
      toolUseId: 'toolu_missing-heartbeat-0',
      parentToolUseId: 'toolu_missing',
    }

    expect(visibleToolIds([userMessage, toolCall, child, orphan])).toEqual([
      'toolu_123', 'toolu_child', 'toolu_missing-heartbeat-0',
    ])
  })
})
