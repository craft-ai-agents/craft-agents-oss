import { describe, it, expect } from 'bun:test'
import { createCommandRegistry } from '../commands/index.ts'
import type { CommandContext, CommandContribution } from '../commands/index.ts'

function command(id: string, extra?: Partial<CommandContribution>): CommandContribution {
  return {
    id,
    title: id,
    category: 'Test',
    source: 'craft',
    execute: async () => {},
    ...extra,
  }
}

describe('CommandRegistry', () => {
  it('registers commands and returns them by id', () => {
    const registry = createCommandRegistry()
    const contribution = command('app.newChat')

    registry.register(contribution)

    expect(registry.get('app.newChat')).toBe(contribution)
  })

  it('throws on duplicate id; the first registration wins', () => {
    const registry = createCommandRegistry()
    const first = command('app.newChat')
    registry.register(first)

    expect(() => registry.register(command('app.newChat'))).toThrow()
    expect(registry.get('app.newChat')).toBe(first)
  })

  it('query returns everything in registration order when no filters apply', () => {
    const registry = createCommandRegistry()
    registry.register(command('a.first'))
    registry.register(command('b.second'))

    expect(registry.query({}, {}).map((c) => c.id)).toEqual(['a.first', 'b.second'])
  })

  it('filters commands through the when-language (spec-verbatim expression)', () => {
    const registry = createCommandRegistry()
    registry.register(
      command('knowledge.research-selected-blocks', {
        when: "activeSurface=='knowledge' && selectedBlocks.count>0 && agent.available==true",
      }),
    )
    registry.register(command('app.newChat'))

    const knowledgeCtx = { activeSurface: 'knowledge', 'selectedBlocks.count': 3, 'agent.available': true }
    const sessionCtx = { activeSurface: 'session', 'agent.available': true }

    expect(registry.query({}, knowledgeCtx).map((c) => c.id)).toEqual([
      'knowledge.research-selected-blocks',
      'app.newChat',
    ])
    expect(registry.query({}, sessionCtx).map((c) => c.id)).toEqual(['app.newChat'])
    expect(registry.query({}, { activeSurface: 'knowledge' }).map((c) => c.id)).toEqual(['app.newChat'])
  })

  it('matches query text against title, category and keywords case-insensitively', () => {
    const registry = createCommandRegistry()
    registry.register(
      command('knowledge.research-selected-blocks', {
        title: 'Research selected blocks',
        category: 'Knowledge',
        keywords: ['исследовать', 'research', 'проверить'],
      }),
    )
    registry.register(command('app.newChat', { title: 'New chat' }))

    expect(registry.query({ text: 'research selected' }, {}).map((c) => c.id)).toEqual([
      'knowledge.research-selected-blocks',
    ])
    expect(registry.query({ text: 'ИССЛЕДОВАТЬ' }, {}).map((c) => c.id)).toEqual([
      'knowledge.research-selected-blocks',
    ])
    expect(registry.query({ text: 'knowledge' }, {}).map((c) => c.id)).toEqual([
      'knowledge.research-selected-blocks',
    ])
    expect(registry.query({ text: 'definitely-not-there' }, {})).toEqual([])
    expect(registry.query({ text: '  ' }, {}).map((c) => c.id)).toEqual([
      'knowledge.research-selected-blocks',
      'app.newChat',
    ])
  })

  it('filters by source', () => {
    const registry = createCommandRegistry()
    registry.register(command('craft.command', { source: 'craft' }))
    registry.register(command('skill.command', { source: 'skill' }))

    expect(registry.query({ source: 'skill' }, {}).map((c) => c.id)).toEqual(['skill.command'])
  })

  it('accepts source siyuan-plugin', () => {
    const registry = createCommandRegistry()
    registry.register(command('plugin.command', { source: 'siyuan-plugin' }))
    expect(registry.query({ source: 'siyuan-plugin' }, {}).map((c) => c.id)).toEqual([
      'plugin.command',
    ])
    expect(registry.get('plugin.command')?.source).toBe('siyuan-plugin')
  })

  it('passes a CommandContext with the keys snapshot to execute()', async () => {
    const registry = createCommandRegistry()
    const contexts: CommandContext[] = []
    const contribution = command('app.echo', {
      execute: async (ctx) => {
        contexts.push(ctx)
      },
    })
    registry.register(contribution)

    await contribution.execute({ keys: { activeSurface: 'knowledge' } })

    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.keys.activeSurface).toBe('knowledge')
  })

  it('onDidChange fires on register and dispose', () => {
    const registry = createCommandRegistry()
    let calls = 0
    registry.onDidChange(() => {
      calls++
    })

    const registration = registry.register(command('app.newChat'))
    registration.dispose()

    expect(calls).toBe(2)
    expect(registry.get('app.newChat')).toBeUndefined()
  })
})
