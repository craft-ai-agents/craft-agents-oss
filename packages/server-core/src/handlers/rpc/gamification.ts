/**
 * Gamification RPC — profile XP/level surface + award hook.
 *
 * State lives in CONFIG_DIR/gamification.json (user-scoped, not workspace).
 * Balance has no billing API yet → null → UI shows em dash.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  awardXp,
  getGamificationProgress,
  getLevelProgress,
  isXpEventType,
  loadGamificationState,
  setGamificationAwardListener,
  type AwardXpResult,
  type GamificationState,
  type XpEventType,
} from '@craft-agent/shared/gamification'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.gamification.GET,
  RPC_CHANNELS.gamification.AWARD,
] as const

export type GamificationProfileDto = {
  xp: number
  level: number
  balance: number | null
  progress: number
  xpIntoLevel: number
  xpForNext: number
  nextThreshold: number | null
  currentThreshold: number
  displayNameHint?: string
}

function toDto(state: GamificationState): GamificationProfileDto {
  const progress = getLevelProgress(state.xp)
  return {
    xp: state.xp,
    level: progress.level,
    balance: state.balance,
    progress: progress.progress,
    xpIntoLevel: progress.xpIntoLevel,
    xpForNext: progress.xpForNext,
    nextThreshold: progress.nextThreshold,
    currentThreshold: progress.currentThreshold,
  }
}

function broadcast(server: RpcServer, state: GamificationState): void {
  pushTyped(server, RPC_CHANNELS.gamification.CHANGED, { to: 'all' }, toDto(state))
}

/** Best-effort award used by product hooks. Never throws. */
export function awardXpAndBroadcast(
  server: RpcServer | null | undefined,
  event: XpEventType,
): AwardXpResult | null {
  try {
    const result = awardXp(event)
    if (server) broadcast(server, result.state)
    return result
  } catch {
    return null
  }
}

export function registerGamificationHandlers(server: RpcServer, _deps: HandlerDeps): void {
  setGamificationAwardListener((result) => {
    broadcast(server, result.state)
  })

  server.handle(RPC_CHANNELS.gamification.GET, async () => {
    const { state } = getGamificationProgress()
    return toDto(state)
  })

  server.handle(RPC_CHANNELS.gamification.AWARD, async (_ctx, event: unknown) => {
    if (!isXpEventType(event)) {
      throw new Error(`Unknown XP event: ${String(event)}`)
    }
    const result = awardXp(event)
    // listener already broadcasts; return full award payload
    return {
      ...toDto(result.state),
      awarded: result.awarded,
      event: result.event,
      leveledUp: result.leveledUp,
      previousLevel: result.previousLevel,
    }
  })
}

/** Read-only snapshot for non-RPC callers. */
export function getGamificationDto(): GamificationProfileDto {
  return toDto(loadGamificationState())
}
