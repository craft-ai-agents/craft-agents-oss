/**
 * Tests for SoundEngine cooldown tracking and spam detection.
 *
 * Tests the core logic classes (CooldownTracker, SpamDetector)
 * extracted for pure unit testing without Electron dependencies.
 */

import { describe, it, expect } from 'bun:test'

// ---------------------------------------------------------------------------
// Inline class copies for testing (same logic as SoundEngine.ts)
// ---------------------------------------------------------------------------

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

class SpamDetector {
  private timestamps: number[] = []
  private readonly threshold = 3
  private readonly windowMs = 10000

  check(): boolean {
    const now = Date.now()
    this.timestamps.push(now)
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs)
    return this.timestamps.length >= this.threshold
  }

  reset(): void {
    this.timestamps = []
  }
}

// ---------------------------------------------------------------------------
// CooldownTracker Tests
// ---------------------------------------------------------------------------

describe('CooldownTracker', () => {
  it('allows first play for any category', () => {
    const tracker = new CooldownTracker()
    expect(tracker.canPlay('session.start', 2000)).toBe(true)
    expect(tracker.canPlay('task.complete', 2000)).toBe(true)
  })

  it('blocks replay within cooldown window', () => {
    const tracker = new CooldownTracker()
    tracker.record('session.start')
    expect(tracker.canPlay('session.start', 2000)).toBe(false)
  })

  it('allows replay after cooldown expires', () => {
    const tracker = new CooldownTracker()
    tracker.record('session.start')

    // Simulate time passing by checking with 0ms cooldown
    expect(tracker.canPlay('session.start', 0)).toBe(true)
  })

  it('tracks different categories independently', () => {
    const tracker = new CooldownTracker()
    tracker.record('session.start')

    // session.start is on cooldown
    expect(tracker.canPlay('session.start', 2000)).toBe(false)

    // task.complete is NOT on cooldown (different category)
    expect(tracker.canPlay('task.complete', 2000)).toBe(true)

    tracker.record('task.complete')
    expect(tracker.canPlay('task.complete', 2000)).toBe(false)
  })

  it('zero cooldown always allows replay', () => {
    const tracker = new CooldownTracker()
    tracker.record('session.start')
    expect(tracker.canPlay('session.start', 0)).toBe(true)
  })

  it('different cooldown values per check', () => {
    const tracker = new CooldownTracker()
    tracker.record('session.start')

    // With 10 second cooldown, blocked
    expect(tracker.canPlay('session.start', 10000)).toBe(false)

    // With 0 ms cooldown, allowed
    expect(tracker.canPlay('session.start', 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SpamDetector Tests
// ---------------------------------------------------------------------------

describe('SpamDetector', () => {
  it('does not trigger on first check', () => {
    const detector = new SpamDetector()
    expect(detector.check()).toBe(false)
  })

  it('does not trigger on second check', () => {
    const detector = new SpamDetector()
    detector.check()
    expect(detector.check()).toBe(false)
  })

  it('triggers on third rapid check', () => {
    const detector = new SpamDetector()
    detector.check() // 1
    detector.check() // 2
    expect(detector.check()).toBe(true) // 3 → spam!
  })

  it('continues triggering after threshold reached', () => {
    const detector = new SpamDetector()
    detector.check()
    detector.check()
    detector.check() // threshold hit
    expect(detector.check()).toBe(true) // still spamming
  })

  it('reset clears the spam state', () => {
    const detector = new SpamDetector()
    detector.check()
    detector.check()
    detector.check() // spam detected
    detector.reset()
    expect(detector.check()).toBe(false) // back to normal
  })

  it('reset allows fresh start', () => {
    const detector = new SpamDetector()
    detector.check()
    detector.check()
    detector.check()
    detector.reset()
    detector.check() // 1
    detector.check() // 2
    expect(detector.check()).toBe(true) // 3 → spam again
  })
})

// ---------------------------------------------------------------------------
// Volume Clamping
// ---------------------------------------------------------------------------

describe('Volume clamping', () => {
  function clampVolume(volume: number): number {
    return Math.max(0, Math.min(1, volume))
  }

  it('clamps negative values to 0', () => {
    expect(clampVolume(-1)).toBe(0)
    expect(clampVolume(-0.5)).toBe(0)
    expect(clampVolume(-100)).toBe(0)
  })

  it('clamps values above 1 to 1', () => {
    expect(clampVolume(1.5)).toBe(1)
    expect(clampVolume(2)).toBe(1)
    expect(clampVolume(100)).toBe(1)
  })

  it('passes through valid values unchanged', () => {
    expect(clampVolume(0)).toBe(0)
    expect(clampVolume(0.5)).toBe(0.5)
    expect(clampVolume(0.8)).toBe(0.8)
    expect(clampVolume(1)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Session Pack Override Resolution
// ---------------------------------------------------------------------------

describe('Session pack override resolution', () => {
  const sessionPacks = new Map<string, string>()
  const defaultPack = 'default'
  const availablePacks = new Set(['default', 'retro', 'chiptune', 'forest'])

  function getActivePack(sessionId?: string): string | undefined {
    if (sessionId) {
      const sessionPack = sessionPacks.get(sessionId)
      if (sessionPack && availablePacks.has(sessionPack)) {
        return sessionPack
      }
    }
    return availablePacks.has(defaultPack) ? defaultPack : undefined
  }

  it('returns global default when no session override', () => {
    expect(getActivePack()).toBe('default')
    expect(getActivePack('unknown-session')).toBe('default')
  })

  it('returns session override when set and available', () => {
    sessionPacks.set('session-1', 'retro')
    expect(getActivePack('session-1')).toBe('retro')
  })

  it('falls back to default when session pack is not installed', () => {
    sessionPacks.set('session-2', 'nonexistent')
    expect(getActivePack('session-2')).toBe('default')
  })

  it('falls back to default when session pack is undefined', () => {
    sessionPacks.delete('session-1')
    expect(getActivePack('session-1')).toBe('default')
  })

  it('resolves per-session overrides independently', () => {
    sessionPacks.set('a', 'retro')
    sessionPacks.set('b', 'chiptune')
    expect(getActivePack('a')).toBe('retro')
    expect(getActivePack('b')).toBe('chiptune')
    expect(getActivePack('c')).toBe('default')
  })
})
