import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getLevelForXp,
  getLevelProgress,
  getXpReward,
  LEVEL_XP_THRESHOLDS,
  XP_EVENT_REWARDS,
} from './levels.ts'
import {
  awardXp,
  getDefaultGamificationState,
  loadGamificationState,
  saveGamificationState,
} from './storage.ts'

describe('gamification levels', () => {
  it('maps thresholds to levels', () => {
    expect(getLevelForXp(0)).toBe(1)
    expect(getLevelForXp(99)).toBe(1)
    expect(getLevelForXp(100)).toBe(2)
    expect(getLevelForXp(LEVEL_XP_THRESHOLDS[LEVEL_XP_THRESHOLDS.length - 1]!)).toBe(
      LEVEL_XP_THRESHOLDS.length,
    )
  })

  it('computes in-level progress', () => {
    const p = getLevelProgress(100)
    expect(p.level).toBe(2)
    expect(p.xpIntoLevel).toBe(0)
    expect(p.nextThreshold).toBe(250)
    expect(p.progress).toBe(0)

    const mid = getLevelProgress(175)
    expect(mid.level).toBe(2)
    expect(mid.xpIntoLevel).toBe(75)
    expect(mid.progress).toBeCloseTo(75 / 150, 5)
  })

  it('defines rewards for required events', () => {
    expect(getXpReward('session_completed')).toBe(XP_EVENT_REWARDS.session_completed)
    expect(getXpReward('automation_ran')).toBeGreaterThan(0)
    expect(getXpReward('cloud_run_imported')).toBeGreaterThan(0)
    expect(getXpReward('note_linked')).toBeGreaterThan(0)
  })
})

describe('gamification storage + award', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function tempConfigDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'craft-xp-'))
    dirs.push(dir)
    return dir
  }

  it('starts at level 1 with 0 xp', () => {
    const dir = tempConfigDir()
    const state = loadGamificationState(dir)
    expect(state).toMatchObject(getDefaultGamificationState())
    expect(state.xp).toBe(0)
    expect(state.level).toBe(1)
    expect(state.balance).toBeNull()
  })

  it('increments XP on session_completed and levels up across threshold', () => {
    const dir = tempConfigDir()
    // 4 × 25 = 100 → exactly level 2
    let last = awardXp('session_completed', dir)
    expect(last.awarded).toBe(25)
    expect(last.state.xp).toBe(25)
    expect(last.state.level).toBe(1)
    expect(last.leveledUp).toBe(false)

    last = awardXp('session_completed', dir)
    last = awardXp('session_completed', dir)
    last = awardXp('session_completed', dir)

    expect(last.state.xp).toBe(100)
    expect(last.state.level).toBe(2)
    expect(last.leveledUp).toBe(true)
    expect(last.previousLevel).toBe(1)

    const reloaded = loadGamificationState(dir)
    expect(reloaded.xp).toBe(100)
    expect(reloaded.level).toBe(2)
    expect(reloaded.recentEvents?.[0]?.type).toBe('session_completed')
  })

  it('persists manual save round-trip', () => {
    const dir = tempConfigDir()
    saveGamificationState(
      {
        version: 1,
        xp: 450,
        level: 1, // stale — load should derive 4
        balance: null,
      },
      dir,
    )
    const state = loadGamificationState(dir)
    expect(state.xp).toBe(450)
    expect(state.level).toBe(4)
  })

  it('writes gamification.json without leaving .tmp sibling', () => {
    const dir = tempConfigDir()
    saveGamificationState(
      {
        version: 1,
        xp: 10,
        level: 1,
        balance: null,
      },
      dir,
    )
    const path = join(dir, 'gamification.json')
    expect(existsSync(path)).toBe(true)
    expect(existsSync(`${path}.tmp`)).toBe(false)
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    expect(parsed.xp).toBe(10)
    expect(parsed.version).toBe(1)
  })
})
