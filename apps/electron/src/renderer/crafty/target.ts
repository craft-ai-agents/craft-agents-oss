/**
 * The panel's target ("Send Crafty here"), kept pure so it can be tested: how a session is named in
 * the target menu, how old it reads, and the menu's search.
 */

import type { CraftyCreateSessionResult, CraftySessionSummary } from '../../shared/crafty'

export const NEW_SESSION_LABEL = 'New session'

/** The title, else the start of its last message (sessions get a title after their first turn). */
export function sessionTitle(session: Pick<CraftySessionSummary, 'name' | 'preview'>): string {
  return session.name?.trim() || session.preview?.trim() || 'Untitled session'
}

/** "now", "5m", "3h", "2d", "4w": the menu's age column. */
export function shortAge(at: number | null, now: number): string {
  if (!at) return ''
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

/** Every word of the query, in any order, in the title (or the preview), ignoring case and accents. */
export function filterSessions(sessions: CraftySessionSummary[], query: string): CraftySessionSummary[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return sessions
  return sessions.filter(session => {
    const text = fold(`${session.name ?? ''} ${session.preview ?? ''}`)
    return words.every(word => text.includes(word))
  })
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** An existing session the panel sends to, in the shape a session it created has. */
export function targetSession(target: CraftySessionSummary): CraftyCreateSessionResult {
  return {
    sessionId: target.sessionId,
    workspaceId: target.workspaceId,
    llmConnection: target.llmConnection,
    model: target.model,
    thinkingLevel: target.thinkingLevel,
  }
}
