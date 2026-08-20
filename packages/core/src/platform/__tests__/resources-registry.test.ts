import { describe, it, expect } from 'bun:test'
import { createResourceProviderRegistry } from '../resources/index.ts'
import type { ResourceItem, ResourceProvider, ResourceSearchContext } from '../resources/index.ts'

function item(id: string, score = 0, kind: ResourceItem['kind'] = 'session'): ResourceItem {
  return { id, kind, title: id, score }
}

function provider(
  id: string,
  prefixes: ResourceProvider['prefixes'],
  search: ResourceProvider['search'],
): ResourceProvider {
  return { id, label: id, prefixes, search }
}

function ctx(partial: Partial<ResourceSearchContext> = {}): ResourceSearchContext {
  return {
    query: '',
    prefix: '',
    keys: {},
    ...partial,
  }
}

describe('ResourceProviderRegistry', () => {
  it('registers providers and returns them by id', () => {
    const registry = createResourceProviderRegistry()
    const p = provider('craft-sessions', [''], async () => [item('s1')])
    registry.register(p)
    expect(registry.get('craft-sessions')).toBe(p)
  })

  it('throws on duplicate provider id', () => {
    const registry = createResourceProviderRegistry()
    registry.register(provider('dup', [''], async () => []))
    expect(() => registry.register(provider('dup', [''], async () => []))).toThrow()
  })

  it('filters providers by prefix', async () => {
    const registry = createResourceProviderRegistry()
    registry.register(
      provider('sessions', ['', '@'], async () => [item('session-a', 1)]),
    )
    registry.register(
      provider('skills', ['', '/'], async () => [item('skill-a', 1, 'skill')]),
    )
    registry.register(
      provider('commands-only', ['>'], async () => [item('cmd', 1, 'command-hint')]),
    )

    const universal = await registry.search(ctx({ prefix: '', query: 'a' }))
    expect(universal.map((i) => i.id).sort()).toEqual(['session-a', 'skill-a'])

    const at = await registry.search(ctx({ prefix: '@', query: 'a' }))
    expect(at.map((i) => i.id)).toEqual(['session-a'])

    const slash = await registry.search(ctx({ prefix: '/', query: 'a' }))
    expect(slash.map((i) => i.id)).toEqual(['skill-a'])

    const gt = await registry.search(ctx({ prefix: '>', query: 'a' }))
    expect(gt.map((i) => i.id)).toEqual(['cmd'])
  })

  it('merges results and sorts by score descending', async () => {
    const registry = createResourceProviderRegistry()
    registry.register(
      provider('a', [''], async () => [item('low', 0.2), item('high', 0.9)]),
    )
    registry.register(
      provider('b', [''], async () => [item('mid', 0.5, 'skill')]),
    )

    const results = await registry.search(ctx({ query: 'x' }))
    expect(results.map((i) => i.id)).toEqual(['high', 'mid', 'low'])
  })

  it('respects limit after merge', async () => {
    const registry = createResourceProviderRegistry()
    registry.register(
      provider('a', [''], async () => [
        item('1', 1),
        item('2', 0.9),
        item('3', 0.8),
        item('4', 0.7),
      ]),
    )
    const results = await registry.search(ctx({ limit: 2 }))
    expect(results).toHaveLength(2)
    expect(results.map((i) => i.id)).toEqual(['1', '2'])
  })

  it('isolates provider failures', async () => {
    const registry = createResourceProviderRegistry()
    registry.register(
      provider('bad', [''], async () => {
        throw new Error('boom')
      }),
    )
    registry.register(
      provider('good', [''], async () => [item('ok', 1)]),
    )
    const results = await registry.search(ctx({ query: 'x' }))
    expect(results.map((i) => i.id)).toEqual(['ok'])
  })

  it('returns empty when signal is already aborted', async () => {
    const registry = createResourceProviderRegistry()
    let called = false
    registry.register(
      provider('a', [''], async () => {
        called = true
        return [item('x', 1)]
      }),
    )
    const controller = new AbortController()
    controller.abort()
    const results = await registry.search(ctx({ signal: controller.signal }))
    expect(results).toEqual([])
    expect(called).toBe(false)
  })

  it('dispose unregisters provider; onDidChange fires', async () => {
    const registry = createResourceProviderRegistry()
    let changes = 0
    registry.onDidChange(() => {
      changes++
    })
    const d = registry.register(provider('temp', [''], async () => [item('t', 1)]))
    expect(changes).toBe(1)
    d.dispose()
    expect(changes).toBe(2)
    expect(registry.get('temp')).toBeUndefined()
    const results = await registry.search(ctx())
    expect(results).toEqual([])
  })

  it('stamps providerId into item data', async () => {
    const registry = createResourceProviderRegistry()
    registry.register(
      provider('craft-sessions', [''], async () => [
        { id: 's1', kind: 'session', title: 'S', score: 1, data: { foo: 1 } },
      ]),
    )
    const [hit] = await registry.search(ctx())
    expect(hit?.data?.providerId).toBe('craft-sessions')
    expect(hit?.data?.foo).toBe(1)
  })
})
