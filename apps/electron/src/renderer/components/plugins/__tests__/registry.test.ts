import { describe, expect, it } from 'bun:test'
import type { PluginCapabilityRef } from '@craft-agent/shared/plugins'
import { matchPluginChatCardsForTurn } from '../registry'

describe('matchPluginChatCardsForTurn', () => {
  it('matches tool cards against failing activities', () => {
    const capabilities: PluginCapabilityRef[] = [
      {
        pluginId: 'craft.plugins.ui',
        id: 'tool-error-card',
        type: 'chatCardType',
        title: 'Tool Error Card',
        matcher: {
          role: 'tool',
          isError: true,
        },
      },
    ]

    const matches = matchPluginChatCardsForTurn({
      capabilities,
      activities: [
        {
          id: 'tool-1',
          type: 'tool',
          status: 'error',
          toolName: 'Bash',
          timestamp: Date.now(),
          error: 'command failed',
        },
      ],
    })

    expect(matches).toHaveLength(1)
    expect(matches[0]?.id).toBe('tool-error-card')
  })

  it('matches plan cards against plan responses', () => {
    const capabilities: PluginCapabilityRef[] = [
      {
        pluginId: 'craft.plugins.ui',
        id: 'plan-card',
        type: 'chatCardType',
        title: 'Plan Card',
        matcher: {
          role: 'plan',
        },
      },
    ]

    const matches = matchPluginChatCardsForTurn({
      capabilities,
      activities: [],
      response: {
        text: 'Generated plan',
        isStreaming: false,
        isPlan: true,
      },
    })

    expect(matches).toHaveLength(1)
    expect(matches[0]?.id).toBe('plan-card')
  })
})
