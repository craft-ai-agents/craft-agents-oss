/**
 * Persist gamification state to `~/.craft-agent/gamification.json`.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CONFIG_DIR } from '../config/paths.ts'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import {
  getLevelForXp,
  getLevelProgress,
  getXpReward,
  isXpEventType,
  type XpEventType,
} from './levels.ts'

export const GAMIFICATION_FILE = 'gamification.json'

export interface GamificationState {
  version: 1
  /** Lifetime cumulative XP */
  xp: number
  /** Cached level (recomputed on award; may lag if file edited) */
  level: number
  /** Optional local credits counter (no billing API → UI shows em dash) */
  balance: number | null
  /** ISO timestamps of recent awards (bounded) */
  recentEvents?: Array<{
    type: XpEventType
    xp: number
    at: number
  }>
  updatedAt?: number
}

export interface AwardXpResult {
  state: GamificationState
  awarded: number
  event: XpEventType
  leveledUp: boolean
  previousLevel: number
}

const RECENT_EVENTS_CAP = 50

type AwardListener = (result: AwardXpResult) => void
let awardListener: AwardListener | null = null

/** Optional listener (server registers to push CHANGED). */
export function setGamificationAwardListener(listener: AwardListener | null): void {
  awardListener = listener
}

export function getGamificationPath(configDir: string = CONFIG_DIR): string {
  return join(configDir, GAMIFICATION_FILE)
}

export function getDefaultGamificationState(): GamificationState {
  return {
    version: 1,
    xp: 0,
    level: 1,
    balance: null,
    recentEvents: [],
    updatedAt: Date.now(),
  }
}

function normalizeState(raw: unknown): GamificationState {
  const base = getDefaultGamificationState()
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  const xp =
    typeof obj.xp === 'number' && Number.isFinite(obj.xp) && obj.xp >= 0
      ? Math.floor(obj.xp)
      : 0
  const level =
    typeof obj.level === 'number' && Number.isFinite(obj.level)
      ? Math.max(1, Math.floor(obj.level))
      : getLevelForXp(xp)
  let balance: number | null = null
  if (typeof obj.balance === 'number' && Number.isFinite(obj.balance)) {
    balance = obj.balance
  } else if (obj.balance === null) {
    balance = null
  }
  const recentEvents: GamificationState['recentEvents'] = []
  if (Array.isArray(obj.recentEvents)) {
    for (const entry of obj.recentEvents) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      if (!isXpEventType(e.type)) continue
      if (typeof e.xp !== 'number' || typeof e.at !== 'number') continue
      recentEvents.push({ type: e.type, xp: Math.floor(e.xp), at: e.at })
      if (recentEvents.length >= RECENT_EVENTS_CAP) break
    }
  }
  return {
    version: 1,
    xp,
    // Prefer derived level from XP so manual edits stay coherent
    level: getLevelForXp(xp) || level,
    balance,
    recentEvents,
    updatedAt:
      typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
        ? obj.updatedAt
        : Date.now(),
  }
}

export function loadGamificationState(
  configDir: string = CONFIG_DIR,
): GamificationState {
  try {
    const path = getGamificationPath(configDir)
    if (!existsSync(path)) return getDefaultGamificationState()
    return normalizeState(readJsonFileSync<unknown>(path))
  } catch {
    return getDefaultGamificationState()
  }
}

export function saveGamificationState(
  state: GamificationState,
  configDir: string = CONFIG_DIR,
): void {
  const path = getGamificationPath(configDir)
  mkdirSync(dirname(path), { recursive: true })
  const payload: GamificationState = {
    ...state,
    version: 1,
    level: getLevelForXp(state.xp),
    updatedAt: Date.now(),
  }
  atomicWriteFileSync(path, JSON.stringify(payload, null, 2))
}

/**
 * Award XP for a known event. Best-effort, never throws to callers
 * when used via `awardXpSafe`.
 */
export function awardXp(
  event: XpEventType,
  configDir: string = CONFIG_DIR,
): AwardXpResult {
  const current = loadGamificationState(configDir)
  const previousLevel = getLevelForXp(current.xp)
  const awarded = getXpReward(event)
  const xp = current.xp + awarded
  const level = getLevelForXp(xp)
  const recentEvents = [
    { type: event, xp: awarded, at: Date.now() },
    ...(current.recentEvents ?? []),
  ].slice(0, RECENT_EVENTS_CAP)
  const state: GamificationState = {
    version: 1,
    xp,
    level,
    balance: current.balance,
    recentEvents,
    updatedAt: Date.now(),
  }
  saveGamificationState(state, configDir)
  const result: AwardXpResult = {
    state,
    awarded,
    event,
    leveledUp: level > previousLevel,
    previousLevel,
  }
  try {
    awardListener?.(result)
  } catch {
    // listener must never break awards
  }
  return result
}

/** Best-effort award — swallows all errors (hooks must never break product paths). */
export function awardXpSafe(
  event: XpEventType,
  configDir: string = CONFIG_DIR,
): AwardXpResult | null {
  try {
    return awardXp(event, configDir)
  } catch {
    return null
  }
}

export function getGamificationProgress(configDir: string = CONFIG_DIR) {
  const state = loadGamificationState(configDir)
  return {
    state,
    ...getLevelProgress(state.xp),
  }
}
