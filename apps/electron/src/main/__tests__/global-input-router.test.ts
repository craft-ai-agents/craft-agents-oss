import { describe, expect, it, mock } from 'bun:test'
import {
  attachOmniboxChordListener,
  isOmniboxChord,
} from '../global-input-router'

describe('isOmniboxChord', () => {
  it('matches keyDown + k + meta', () => {
    expect(isOmniboxChord({ type: 'keyDown', key: 'k', meta: true })).toBe(true)
  })

  it('matches keyDown + K + control', () => {
    expect(isOmniboxChord({ type: 'keyDown', key: 'K', control: true })).toBe(true)
  })

  it('matches metaKey/controlKey aliases', () => {
    expect(isOmniboxChord({ type: 'keyDown', key: 'k', metaKey: true })).toBe(true)
    expect(isOmniboxChord({ type: 'keyDown', key: 'k', controlKey: true })).toBe(true)
  })

  it('rejects non-keyDown, wrong key, or no modifier', () => {
    expect(isOmniboxChord({ type: 'keyUp', key: 'k', meta: true })).toBe(false)
    expect(isOmniboxChord({ type: 'keyDown', key: 'p', meta: true })).toBe(false)
    expect(isOmniboxChord({ type: 'keyDown', key: 'k' })).toBe(false)
    expect(isOmniboxChord({})).toBe(false)
  })
})

describe('attachOmniboxChordListener', () => {
  it('invokes onMatch and preventDefault on chord', () => {
    type Handler = (event: { preventDefault(): void }, input: Parameters<typeof isOmniboxChord>[0]) => void
    const listeners = new Map<string, Handler[]>()
    const wc = {
      on(event: 'before-input-event', cb: Handler) {
        const list = listeners.get(event) ?? []
        list.push(cb)
        listeners.set(event, list)
      },
      removeListener(event: 'before-input-event', cb: Handler) {
        const list = listeners.get(event) ?? []
        listeners.set(
          event,
          list.filter((fn) => fn !== cb),
        )
      },
    }
    const onMatch = mock(() => {})
    const dispose = attachOmniboxChordListener(wc, onMatch)

    const preventDefault = mock(() => {})
    const handlers = listeners.get('before-input-event') ?? []
    expect(handlers).toHaveLength(1)
    handlers[0]!({ preventDefault }, { type: 'keyDown', key: 'k', meta: true })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onMatch).toHaveBeenCalledTimes(1)

    handlers[0]!({ preventDefault }, { type: 'keyDown', key: 'x', meta: true })
    expect(onMatch).toHaveBeenCalledTimes(1)

    dispose()
    expect(listeners.get('before-input-event')).toEqual([])
  })
})
