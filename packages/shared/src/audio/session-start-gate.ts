/**
 * Tracks which sessions have already had `session.start` played.
 *
 * `session.start` is a once-per-session sound — it announces the very first
 * user prompt of a new session. Subsequent turns should not replay it. The
 * gate is consulted by `SoundEngine.play()` and updated in place; cleanup
 * happens via `clear()` when a session is deleted (or `clearAll()` if the
 * engine is torn down).
 */
export class SessionStartGate {
  private played = new Set<string>()

  /** Returns true if `session.start` has not yet been played for this sessionId. */
  shouldPlay(sessionId: string): boolean {
    return !this.played.has(sessionId)
  }

  /** Mark this session as having had `session.start` played. */
  markPlayed(sessionId: string): void {
    this.played.add(sessionId)
  }

  /** Reset state for one session (call when a session is deleted). */
  clear(sessionId: string): void {
    this.played.delete(sessionId)
  }

  /** Reset state for all sessions (call when the engine is torn down). */
  clearAll(): void {
    this.played.clear()
  }
}
