import { describe, it, expect } from 'bun:test'
import { getSessionsToRefreshAfterReconnect, getSessionsToRefreshAfterStaleReconnect } from '../reconnect-recovery'
import type { SessionMeta } from '@/atoms/sessions'

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: overrides.id ?? 'session',
    workspaceId: overrides.workspaceId ?? 'workspace',
    isProcessing: overrides.isProcessing ?? false,
    ...overrides,
  }
}

describe('getSessionsToRefreshAfterStaleReconnect', () => {
  it('includes the active session and all processing sessions', () => {
    const metaMap = new Map<string, SessionMeta>([
      ['active', meta({ id: 'active' })],
      ['processing', meta({ id: 'processing', isProcessing: true })],
      ['other', meta({ id: 'other' })],
    ])

    expect(getSessionsToRefreshAfterStaleReconnect(metaMap, 'active')).toEqual([
      'active',
      'processing',
    ])
  })

  it('deduplicates the active session when it is already processing', () => {
    const metaMap = new Map<string, SessionMeta>([
      ['active', meta({ id: 'active', isProcessing: true })],
    ])

    expect(getSessionsToRefreshAfterStaleReconnect(metaMap, 'active')).toEqual(['active'])
  })
})

describe('getSessionsToRefreshAfterReconnect', () => {
  it('refreshes the active session even when replay succeeds', () => {
    const metaMap = new Map<string, SessionMeta>([
      ['active', meta({ id: 'active' })],
      ['processing', meta({ id: 'processing', isProcessing: true })],
    ])

    expect(getSessionsToRefreshAfterReconnect(metaMap, 'active', false)).toEqual(['active'])
  })

  it('refreshes processing sessions on stale reconnects', () => {
    const metaMap = new Map<string, SessionMeta>([
      ['active', meta({ id: 'active' })],
      ['processing', meta({ id: 'processing', isProcessing: true })],
    ])

    expect(getSessionsToRefreshAfterReconnect(metaMap, 'active', true)).toEqual([
      'active',
      'processing',
    ])
  })
})
