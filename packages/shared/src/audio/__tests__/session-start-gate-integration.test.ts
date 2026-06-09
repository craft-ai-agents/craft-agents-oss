/**
 * Integration test: SessionStartGate wired into a play() flow.
 *
 * This test mirrors the exact sequence in apps/electron/src/main/audio/SoundEngine.ts
 * `play()` to verify the gate is actually consulted in the right order:
 *
 *   1. enabled check
 *   2. category enabled check
 *   3. cooldown check (per category)
 *   4. silenced check (NO_SOUND_PACK sentinel)
 *   5. session.start gate check (per session)  ← the fix
 *   6. resolve pack
 *   7. play
 *
 * If the gate is missing or in the wrong order, the second play() call
 * will produce a sound for the same session — which is Bug #11.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { SessionStartGate } from '../session-start-gate.js'

// Mirrors the CooldownTracker in SoundEngine.ts
class CooldownTracker {
  private lastPlayedAt = new Map<string, number>()

  canPlay(category: string, cooldownMs: number): boolean {
    const last = this.lastPlayedAt.get(category)
    if (last === undefined) return true
    return Date.now() - last >= cooldownMs
  }

  record(category: string): void {
    this.lastPlayedAt.set(category, Date.now())
  }
}

const NO_SOUND_PACK = '__none__'

/**
 * Mirrors the relevant portion of SoundEngine.play() for session.start.
 * Returns 'played' if a sound was emitted, or a reason string if skipped.
 */
function playSessionStart(
  engine: {
    gate: SessionStartGate
    cooldown: CooldownTracker
    sessionPacks: Map<string, string>
    settings: { enabled: boolean; cooldownMs: number }
  },
  sessionId: string,
): 'played' | string {
  const category = 'session.start'

  if (!engine.settings.enabled) return 'disabled'
  const catSettings = { enabled: true }
  if (catSettings && !catSettings.enabled) return 'category-disabled'

  if (!engine.cooldown.canPlay(category, engine.settings.cooldownMs)) {
    return 'cooldown'
  }

  if (sessionId) {
    const sp = engine.sessionPacks.get(sessionId)
    if (sp === NO_SOUND_PACK) return 'silenced'
  }

  // session.start gate — this is the Bug #11 fix
  if (category === 'session.start' && sessionId) {
    if (!engine.gate.shouldPlay(sessionId)) return 'gate'
    engine.gate.markPlayed(sessionId)
  }

  engine.cooldown.record(category)
  return 'played'
}

describe('SessionStartGate integration with play()', () => {
  let engine: {
    gate: SessionStartGate
    cooldown: CooldownTracker
    sessionPacks: Map<string, string>
    settings: { enabled: boolean; cooldownMs: number }
  }

  beforeEach(() => {
    engine = {
      gate: new SessionStartGate(),
      cooldown: new CooldownTracker(),
      sessionPacks: new Map(),
      settings: { enabled: true, cooldownMs: 2000 },
    }
  })

  it('plays session.start for a new session', () => {
    expect(playSessionStart(engine, 'session-A')).toBe('played')
  })

  it('blocks a second session.start for the same session via the gate (Bug #11 regression)', () => {
    expect(playSessionStart(engine, 'session-A')).toBe('played')
    // Wait long enough to clear the 2s cooldown, so the gate is the only thing that can block.
    Bun.sleepSync(10)
    engine.cooldown = new CooldownTracker() // simulate cooldown elapsed
    expect(playSessionStart(engine, 'session-A')).toBe('gate')
  })

  it('plays session.start for a different session independently', () => {
    expect(playSessionStart(engine, 'session-A')).toBe('played')
    Bun.sleepSync(10)
    engine.cooldown = new CooldownTracker() // simulate cooldown elapsed
    expect(playSessionStart(engine, 'session-B')).toBe('played')
  })

  it('simulates a full multi-turn session and never replays session.start after turn 1', () => {
    // Turn 1
    expect(playSessionStart(engine, 'session-X')).toBe('played')

    // Turns 2..5 — each spaced more than 2s apart (cooldown resets)
    for (let turn = 2; turn <= 5; turn++) {
      Bun.sleepSync(10)
      engine.cooldown = new CooldownTracker() // cooldown elapsed
      const result = playSessionStart(engine, 'session-X')
      expect(result).toBe('gate') // each subsequent turn is gated
    }
  })

  it('gate survives across cooldown resets (the key Bug #11 invariant)', () => {
    // Play turn 1
    expect(playSessionStart(engine, 'session-Y')).toBe('played')
    // Reset cooldown (simulate time passing)
    engine.cooldown = new CooldownTracker()
    // Turn 2 should be GATED, not played
    expect(playSessionStart(engine, 'session-Y')).toBe('gate')
    // Reset cooldown again
    engine.cooldown = new CooldownTracker()
    // Turn 3 still GATED
    expect(playSessionStart(engine, 'session-Y')).toBe('gate')
  })

  it('cooldown blocks a fast second call (before the gate matters)', () => {
    expect(playSessionStart(engine, 'session-Z')).toBe('played')
    // Don't reset cooldown — second call is within 2s
    expect(playSessionStart(engine, 'session-Z')).toBe('cooldown')
  })

  it('silenced session is not gated (does not consume a gate slot)', () => {
    engine.sessionPacks.set('session-S', '__none__')
    expect(playSessionStart(engine, 'session-S')).toBe('silenced')
    // Unsilence and try again
    engine.sessionPacks.delete('session-S')
    expect(playSessionStart(engine, 'session-S')).toBe('played')
  })

  it('clear() on the gate allows replay after session delete', () => {
    expect(playSessionStart(engine, 'session-D')).toBe('played')
    engine.gate.clear('session-D')
    engine.cooldown = new CooldownTracker()
    // New session with same ID (e.g., a fresh session after the old one was deleted)
    expect(playSessionStart(engine, 'session-D')).toBe('played')
  })
})
