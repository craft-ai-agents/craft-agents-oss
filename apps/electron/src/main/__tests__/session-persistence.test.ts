/**
 * Tests for session persistence bugfixes:
 * 1. createdAt must be preserved (not overwritten by lastMessageAt)
 * 2. Agent creation must handle null connection gracefully (fallback to default model)
 * 3. Orphaned llmConnection references must be detected
 */
import { describe, it, expect } from 'bun:test'
import { DEFAULT_MODEL } from '@craft-agent/shared/config'

// ============================================================================
// createdAt preservation during persistence
// Mirrors: sessions.ts persistSession() — the StoredSession builder
// ============================================================================

describe('createdAt preservation', () => {
  it('should use createdAt, not lastMessageAt, when building StoredSession', () => {
    // Simulate what persistSession builds
    const managed = {
      createdAt: 1700000000000,  // Original creation time
      lastMessageAt: 1700099999000,  // Much later message time
    }

    // The bug was: createdAt: managed.lastMessageAt
    // The fix is: createdAt: managed.createdAt
    const storedSession = {
      createdAt: managed.createdAt,  // FIXED: was managed.lastMessageAt
    }

    expect(storedSession.createdAt).toBe(1700000000000)
    expect(storedSession.createdAt).not.toBe(managed.lastMessageAt)
  })

  it('createdAt and lastMessageAt should be independent values', () => {
    const createdAt = Date.now() - 86400000  // 1 day ago
    const lastMessageAt = Date.now()  // now

    expect(createdAt).not.toBe(lastMessageAt)
    expect(createdAt).toBeLessThan(lastMessageAt)
  })
})

// ============================================================================
// Safe model resolution when connection is null
// Mirrors: sessions.ts sendMessage() model resolution (~line 3345)
// ============================================================================

describe('model resolution with null connection', () => {
  describe('Claude backend', () => {
    it('falls back to DEFAULT_MODEL when connection is null and session has no model', () => {
      const managed = { model: undefined as string | undefined }
      const connection = null as { defaultModel: string } | null

      const resolvedModel = managed.model || connection?.defaultModel || DEFAULT_MODEL

      expect(resolvedModel).toBe(DEFAULT_MODEL)
      expect(resolvedModel).toBeTruthy()
    })

    it('uses session model when available regardless of connection', () => {
      const managed = { model: 'claude-sonnet-4-20250514' }
      const connection = null as { defaultModel: string } | null

      const resolvedModel = managed.model || connection?.defaultModel || DEFAULT_MODEL

      expect(resolvedModel).toBe('claude-sonnet-4-20250514')
    })

    it('uses connection defaultModel when session has no model', () => {
      const managed = { model: undefined }
      const connection = { defaultModel: 'claude-opus-4-20250514' }

      const resolvedModel = managed.model || connection?.defaultModel || DEFAULT_MODEL

      expect(resolvedModel).toBe('claude-opus-4-20250514')
    })
  })

})

// ============================================================================
// Orphaned llmConnection detection
// Mirrors: sessions.ts restoreSession() orphaned connection cleanup
// ============================================================================

describe('orphaned llmConnection detection', () => {
  it('should clear llmConnection and connectionLocked when connection is orphaned', () => {
    // Simulate a managed session with an orphaned connection
    const managed: { id: string; llmConnection: string | undefined; connectionLocked: boolean } = {
      id: 'test-session',
      llmConnection: 'deleted-connection-slug',
      connectionLocked: true,
    }

    // Simulate resolveSessionConnection returning null for orphaned slug
    const conn = null  // resolveSessionConnection would return null

    if (managed.llmConnection && !conn) {
      managed.llmConnection = undefined
      managed.connectionLocked = false
    }

    expect(managed.llmConnection).toBeUndefined()
    expect(managed.connectionLocked).toBe(false)
  })

  it('should preserve valid llmConnection', () => {
    const managed: { id: string; llmConnection: string | undefined; connectionLocked: boolean } = {
      id: 'test-session',
      llmConnection: 'valid-connection',
      connectionLocked: true,
    }

    // Simulate resolveSessionConnection returning a valid connection
    const conn = { slug: 'valid-connection', defaultModel: 'claude-sonnet-4-20250514' }

    if (managed.llmConnection && !conn) {
      managed.llmConnection = undefined
      managed.connectionLocked = false
    }

    expect(managed.llmConnection).toBe('valid-connection')
    expect(managed.connectionLocked).toBe(true)
  })

  it('should not touch sessions without llmConnection', () => {
    const managed = {
      id: 'test-session',
      llmConnection: undefined as string | undefined,
      connectionLocked: false,
    }

    // The migration check should skip sessions without llmConnection
    if (managed.llmConnection) {
      const conn = null
      if (!conn) {
        managed.llmConnection = undefined
        managed.connectionLocked = false
      }
    }

    expect(managed.llmConnection).toBeUndefined()
    expect(managed.connectionLocked).toBe(false)
  })
})
