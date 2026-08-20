/**
 * Gamification level table and XP event awards.
 *
 * Levels are 1-indexed. XP is cumulative lifetime total.
 * Thresholds are the minimum cumulative XP required to *enter* that level.
 */

export type XpEventType =
  | 'session_completed'
  | 'automation_ran'
  | 'cloud_run_imported'
  | 'note_linked'

/** XP awarded per event type. */
export const XP_EVENT_REWARDS: Record<XpEventType, number> = {
  session_completed: 25,
  automation_ran: 15,
  cloud_run_imported: 40,
  note_linked: 10,
}

/**
 * Minimum cumulative XP to reach each level (index = level - 1).
 * Level 1 starts at 0. Curve is gentle early, steeper later.
 */
export const LEVEL_XP_THRESHOLDS: readonly number[] = [
  0, // L1
  100, // L2
  250, // L3
  450, // L4
  700, // L5
  1000, // L6
  1400, // L7
  1900, // L8
  2500, // L9
  3200, // L10
  4000, // L11
  5000, // L12
  6200, // L13
  7600, // L14
  9200, // L15
  11000, // L16
  13000, // L17
  15500, // L18
  18500, // L19
  22000, // L20
] as const

export const MAX_LEVEL = LEVEL_XP_THRESHOLDS.length

export function isXpEventType(value: unknown): value is XpEventType {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(XP_EVENT_REWARDS, value)
  )
}

export function getXpReward(event: XpEventType): number {
  return XP_EVENT_REWARDS[event]
}

/** Level for a cumulative XP total (clamped to 1..MAX_LEVEL). */
export function getLevelForXp(totalXp: number): number {
  const xp = Math.max(0, Math.floor(totalXp))
  let level = 1
  for (let i = LEVEL_XP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_XP_THRESHOLDS[i]!) {
      level = i + 1
      break
    }
  }
  return level
}

/** Cumulative XP required to enter `level` (1-indexed). */
export function getLevelThreshold(level: number): number {
  const idx = Math.min(Math.max(1, Math.floor(level)), MAX_LEVEL) - 1
  return LEVEL_XP_THRESHOLDS[idx] ?? 0
}

/**
 * Progress within the current level toward the next.
 * At max level, `needed` is 0 and `progress` is 1.
 */
export function getLevelProgress(totalXp: number): {
  level: number
  totalXp: number
  currentThreshold: number
  nextThreshold: number | null
  xpIntoLevel: number
  xpForNext: number
  progress: number
} {
  const xp = Math.max(0, Math.floor(totalXp))
  const level = getLevelForXp(xp)
  const currentThreshold = getLevelThreshold(level)
  if (level >= MAX_LEVEL) {
    return {
      level,
      totalXp: xp,
      currentThreshold,
      nextThreshold: null,
      xpIntoLevel: xp - currentThreshold,
      xpForNext: 0,
      progress: 1,
    }
  }
  const nextThreshold = getLevelThreshold(level + 1)
  const span = Math.max(1, nextThreshold - currentThreshold)
  const xpIntoLevel = xp - currentThreshold
  return {
    level,
    totalXp: xp,
    currentThreshold,
    nextThreshold,
    xpIntoLevel,
    xpForNext: nextThreshold - xp,
    progress: Math.min(1, Math.max(0, xpIntoLevel / span)),
  }
}
