import { describe, expect, it } from 'bun:test'
import type { CraftySessionSummary } from '../../../shared/crafty'
import { filterSessions, sessionTitle, shortAge, targetSession } from '../target'

const summary = (sessionId: string, name: string | null, preview: string | null = null): CraftySessionSummary => ({
  workspaceId: 'w',
  sessionId,
  name,
  preview,
  lastMessageAt: null,
  isProcessing: false,
})

describe('sessionTitle', () => {
  it('the title, else the preview, else a placeholder', () => {
    expect(sessionTitle(summary('a', 'Trip plan'))).toBe('Trip plan')
    expect(sessionTitle(summary('a', '  ', 'What is the weather'))).toBe('What is the weather')
    expect(sessionTitle(summary('a', null, null))).toBe('Untitled session')
  })
})

describe('shortAge', () => {
  const now = Date.UTC(2026, 10, 21, 12)
  it('reads like the session list', () => {
    expect(shortAge(null, now)).toBe('')
    expect(shortAge(now - 20_000, now)).toBe('now')
    expect(shortAge(now - 5 * 60_000, now)).toBe('5m')
    expect(shortAge(now - 3 * 3_600_000, now)).toBe('3h')
    expect(shortAge(now - 2 * 86_400_000, now)).toBe('2d')
    expect(shortAge(now - 15 * 86_400_000, now)).toBe('2w')
    // A clock that moved back never shows a negative age
    expect(shortAge(now + 60_000, now)).toBe('now')
  })
})

describe('filterSessions', () => {
  const sessions = [summary('1', 'Árvíztűrő tükörfúrógép'), summary('2', 'Slack thread digest'), summary('3', null, 'Reply to the design review')]
  it('every word, any order, ignoring case and accents, in the title or the preview', () => {
    expect(filterSessions(sessions, '').map(s => s.sessionId)).toEqual(['1', '2', '3'])
    expect(filterSessions(sessions, 'arvizturo').map(s => s.sessionId)).toEqual(['1'])
    expect(filterSessions(sessions, 'digest SLACK').map(s => s.sessionId)).toEqual(['2'])
    expect(filterSessions(sessions, 'design reply').map(s => s.sessionId)).toEqual(['3'])
    expect(filterSessions(sessions, 'slack design')).toEqual([])
  })
})

describe('targetSession', () => {
  it('carries the model the target runs on, for the model menu', () => {
    const target = { ...summary('s', 'x'), llmConnection: 'work', model: 'opus', thinkingLevel: 'high' as const }
    expect(targetSession(target)).toEqual({ sessionId: 's', workspaceId: 'w', llmConnection: 'work', model: 'opus', thinkingLevel: 'high' })
  })
})
