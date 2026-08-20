import { beforeEach, describe, expect, test } from 'bun:test'
import { createPinnedMap, deriveNoteMindMap } from '@craft-agent/core/mindmap'
import { clearPinLocal, loadPinLocal, pinStorageKey, savePinLocal } from '../pin-store'

const memory = new Map<string, string>()
beforeEach(() => {
  memory.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => { memory.set(k, v) },
      removeItem: (k: string) => { memory.delete(k) },
    },
    configurable: true,
  })
})

describe('pin-store local', () => {
  test('round-trips pin for note entity', () => {
    const graph = deriveNoteMindMap({ noteId: 'n1', title: 'T', markdown: '# H\n' })
    const entity = { type: 'note' as const, noteId: 'n1' }
    expect(pinStorageKey(entity)).toContain('note_n1')
    const pin = createPinnedMap(graph, { positions: {}, collapsed: ['h:0:h'] })
    savePinLocal(pin)
    expect(loadPinLocal(entity)?.layout.collapsed).toEqual(['h:0:h'])
    clearPinLocal(entity)
    expect(loadPinLocal(entity)).toBeNull()
  })
})
