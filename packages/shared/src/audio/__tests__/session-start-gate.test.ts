import { describe, it, expect } from 'bun:test'
import { SessionStartGate } from '../session-start-gate.js'

describe('SessionStartGate', () => {
  it('shouldPlay returns true for an unknown sessionId', () => {
    const gate = new SessionStartGate()
    expect(gate.shouldPlay('session-A')).toBe(true)
  })

  it('shouldPlay returns false after markPlayed', () => {
    const gate = new SessionStartGate()
    gate.markPlayed('session-A')
    expect(gate.shouldPlay('session-A')).toBe(false)
  })

  it('tracks different sessionIds independently', () => {
    const gate = new SessionStartGate()
    gate.markPlayed('session-A')
    expect(gate.shouldPlay('session-A')).toBe(false)
    expect(gate.shouldPlay('session-B')).toBe(true)
    gate.markPlayed('session-B')
    expect(gate.shouldPlay('session-A')).toBe(false)
    expect(gate.shouldPlay('session-B')).toBe(false)
  })

  it('clear resets state for one session', () => {
    const gate = new SessionStartGate()
    gate.markPlayed('session-A')
    gate.markPlayed('session-B')
    gate.clear('session-A')
    expect(gate.shouldPlay('session-A')).toBe(true)
    expect(gate.shouldPlay('session-B')).toBe(false)
  })

  it('clear is a no-op for an unknown sessionId', () => {
    const gate = new SessionStartGate()
    gate.clear('session-A') // should not throw
    expect(gate.shouldPlay('session-A')).toBe(true)
  })

  it('clearAll resets state for all sessions', () => {
    const gate = new SessionStartGate()
    gate.markPlayed('session-A')
    gate.markPlayed('session-B')
    gate.markPlayed('session-C')
    gate.clearAll()
    expect(gate.shouldPlay('session-A')).toBe(true)
    expect(gate.shouldPlay('session-B')).toBe(true)
    expect(gate.shouldPlay('session-C')).toBe(true)
  })
})
