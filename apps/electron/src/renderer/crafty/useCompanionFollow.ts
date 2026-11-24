/**
 * Spike item 3: how smoothly can the companion follow the pointer across other apps?
 *
 * Two strategies, switched in Settings (main pushes a `follow` event):
 * - `poll`: one `crafty.cursor()` request per animation frame (never more than one in flight).
 *   Main reads the global pointer position, so this works wherever the pointer is.
 * - `mousemove`: the window is click-through with forwarding on, so Chromium may still get
 *   `mousemove` for the pointer over it. Cheaper, if macOS delivers them while other apps are in
 *   front; that's what this measures.
 *
 * Every 5 s it records a `follow-rate` metric (updates per second and gaps between updates).
 */

import { useEffect, useRef } from 'react'
import type { CraftyFollowStrategy, CraftyPoint } from '../../shared/crafty'

const REPORT_EVERY_MS = 5000

class GapStats {
  private last = 0
  private gaps: number[] = []
  private startedAt = performance.now()

  tick(): void {
    const now = performance.now()
    if (this.last) this.gaps.push(now - this.last)
    this.last = now
  }

  /** The window's numbers, then start a new window. Null when nothing moved. */
  take(): Record<string, number> | null {
    const elapsed = performance.now() - this.startedAt
    const gaps = this.gaps
    this.gaps = []
    this.startedAt = performance.now()
    if (gaps.length === 0) return null
    const sorted = [...gaps].sort((a, b) => a - b)
    const round = (n: number) => Math.round(n * 10) / 10
    return {
      updates: gaps.length,
      updatesPerSec: round((gaps.length / elapsed) * 1000),
      avgGapMs: round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length),
      p95GapMs: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
      maxGapMs: round(sorted[sorted.length - 1]),
    }
  }
}

export function useCompanionFollow(
  strategy: CraftyFollowStrategy,
  active: boolean,
  move: (point: CraftyPoint) => void,
): void {
  const moveRef = useRef(move)
  moveRef.current = move

  useEffect(() => {
    if (!active || strategy === 'off') return
    const crafty = window.electronAPI.crafty!
    const stats = new GapStats()
    let stopped = false
    let frame = 0
    let inFlight = false
    let lastX = NaN
    let lastY = NaN

    const apply = (point: CraftyPoint) => {
      // Only real movement counts; a still pointer isn't a slow one
      if (point.x === lastX && point.y === lastY) return
      lastX = point.x
      lastY = point.y
      stats.tick()
      moveRef.current(point)
    }

    const report = window.setInterval(() => {
      const numbers = stats.take()
      if (numbers) void crafty.metric({ kind: 'follow-rate', strategy, ...numbers })
    }, REPORT_EVERY_MS)

    let onMouseMove: ((event: MouseEvent) => void) | null = null
    if (strategy === 'poll') {
      const loop = () => {
        if (stopped) return
        if (!inFlight) {
          inFlight = true
          crafty.cursor()
            .then(point => { if (!stopped) apply(point) })
            .catch(() => {})
            .finally(() => { inFlight = false })
        }
        frame = requestAnimationFrame(loop)
      }
      frame = requestAnimationFrame(loop)
    } else {
      onMouseMove = (event: MouseEvent) => apply({ x: event.clientX, y: event.clientY })
      window.addEventListener('mousemove', onMouseMove, { passive: true })
    }

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      window.clearInterval(report)
      if (onMouseMove) window.removeEventListener('mousemove', onMouseMove)
      const numbers = stats.take()
      if (numbers) void crafty.metric({ kind: 'follow-rate', strategy, final: true, ...numbers })
    }
  }, [active, strategy])
}
