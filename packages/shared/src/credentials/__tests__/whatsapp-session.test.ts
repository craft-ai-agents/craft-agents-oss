/**
 * WhatsApp Session Credential Tests
 *
 * Tests for WhatsApp session storage, retrieval, and deletion
 * using the CredentialManager.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { CredentialManager, type WhatsAppSession } from '../manager'

describe('WhatsApp Session Credentials', () => {
  let manager: CredentialManager

  beforeEach(async () => {
    manager = new CredentialManager()
    await manager.initialize()
  })

  afterEach(async () => {
    // Clean up test sessions
    try {
      await manager.deleteWhatsAppSession('test-workspace', '+1234567890')
      await manager.deleteWhatsAppSession('test-workspace', '+0987654321')
      await manager.deleteWhatsAppSession('other-workspace', '+1234567890')
    } catch {
      // Ignore cleanup errors
    }
  })

  /**
   * Factory: Create a mock WhatsApp session
   */
  function createMockSession(overrides?: Partial<WhatsAppSession>): WhatsAppSession {
    return {
      jid: '1234567890@s.whatsapp.net',
      pushName: 'Test User',
      sessionData: { key: 'value', nested: { data: true } },
      createdAt: Date.now(),
      connectedAt: Date.now(),
      isExpired: false,
      ...overrides,
    }
  }

  describe('setWhatsAppSession', () => {
    test('stores session successfully', async () => {
      const session = createMockSession()

      await manager.setWhatsAppSession('test-workspace', '+1234567890', session)

      const retrieved = await manager.getWhatsAppSession('test-workspace', '+1234567890')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.jid).toBe(session.jid)
      expect(retrieved?.pushName).toBe(session.pushName)
    })

    test('overwrites existing session', async () => {
      const session1 = createMockSession({ pushName: 'User 1' })
      const session2 = createMockSession({ pushName: 'User 2' })

      await manager.setWhatsAppSession('test-workspace', '+1234567890', session1)
      await manager.setWhatsAppSession('test-workspace', '+1234567890', session2)

      const retrieved = await manager.getWhatsAppSession('test-workspace', '+1234567890')
      expect(retrieved?.pushName).toBe('User 2')
    })

    test('preserves complex sessionData', async () => {
      const complexData = {
        creds: { noiseKey: 'abc', signedPreKey: 'def' },
        keys: { preKeys: [1, 2, 3], sessions: { 'key1': 'value1' } },
      }
      const session = createMockSession({ sessionData: complexData })

      await manager.setWhatsAppSession('test-workspace', '+1234567890', session)

      const retrieved = await manager.getWhatsAppSession('test-workspace', '+1234567890')
      expect(retrieved?.sessionData).toEqual(complexData)
    })
  })

  describe('getWhatsAppSession', () => {
    test('returns null for non-existent session', async () => {
      const result = await manager.getWhatsAppSession('test-workspace', '+9999999999')
      expect(result).toBeNull()
    })

    test('returns null for wrong workspace', async () => {
      const session = createMockSession()
      await manager.setWhatsAppSession('test-workspace', '+1234567890', session)

      const result = await manager.getWhatsAppSession('wrong-workspace', '+1234567890')
      expect(result).toBeNull()
    })

    test('isolates sessions by workspace', async () => {
      const session1 = createMockSession({ pushName: 'Workspace 1 User' })
      const session2 = createMockSession({ pushName: 'Workspace 2 User' })

      await manager.setWhatsAppSession('workspace-1', '+1234567890', session1)
      await manager.setWhatsAppSession('workspace-2', '+1234567890', session2)

      const retrieved1 = await manager.getWhatsAppSession('workspace-1', '+1234567890')
      const retrieved2 = await manager.getWhatsAppSession('workspace-2', '+1234567890')

      expect(retrieved1?.pushName).toBe('Workspace 1 User')
      expect(retrieved2?.pushName).toBe('Workspace 2 User')

      // Cleanup
      await manager.deleteWhatsAppSession('workspace-1', '+1234567890')
      await manager.deleteWhatsAppSession('workspace-2', '+1234567890')
    })

    test('isolates sessions by phone number', async () => {
      const session1 = createMockSession({ pushName: 'User A' })
      const session2 = createMockSession({ pushName: 'User B' })

      await manager.setWhatsAppSession('test-workspace', '+1111111111', session1)
      await manager.setWhatsAppSession('test-workspace', '+2222222222', session2)

      const retrieved1 = await manager.getWhatsAppSession('test-workspace', '+1111111111')
      const retrieved2 = await manager.getWhatsAppSession('test-workspace', '+2222222222')

      expect(retrieved1?.pushName).toBe('User A')
      expect(retrieved2?.pushName).toBe('User B')

      // Cleanup
      await manager.deleteWhatsAppSession('test-workspace', '+1111111111')
      await manager.deleteWhatsAppSession('test-workspace', '+2222222222')
    })
  })

  describe('deleteWhatsAppSession', () => {
    test('deletes existing session', async () => {
      const session = createMockSession()
      await manager.setWhatsAppSession('test-workspace', '+1234567890', session)

      const deleted = await manager.deleteWhatsAppSession('test-workspace', '+1234567890')
      expect(deleted).toBe(true)

      const retrieved = await manager.getWhatsAppSession('test-workspace', '+1234567890')
      expect(retrieved).toBeNull()
    })

    test('returns false for non-existent session', async () => {
      const deleted = await manager.deleteWhatsAppSession('test-workspace', '+9999999999')
      expect(deleted).toBe(false)
    })

    test('only deletes specified session (GDPR isolation)', async () => {
      const session1 = createMockSession({ pushName: 'User 1' })
      const session2 = createMockSession({ pushName: 'User 2' })

      await manager.setWhatsAppSession('test-workspace', '+1234567890', session1)
      await manager.setWhatsAppSession('test-workspace', '+0987654321', session2)

      await manager.deleteWhatsAppSession('test-workspace', '+1234567890')

      const deleted = await manager.getWhatsAppSession('test-workspace', '+1234567890')
      const remaining = await manager.getWhatsAppSession('test-workspace', '+0987654321')

      expect(deleted).toBeNull()
      expect(remaining?.pushName).toBe('User 2')
    })
  })

  describe('getAllWhatsAppSessions', () => {
    test('returns empty array when no sessions', async () => {
      const sessions = await manager.getAllWhatsAppSessions('empty-workspace')
      expect(sessions).toEqual([])
    })

    test('returns all sessions for workspace', async () => {
      const session1 = createMockSession({ jid: '1111@s.whatsapp.net', pushName: 'User 1' })
      const session2 = createMockSession({ jid: '2222@s.whatsapp.net', pushName: 'User 2' })

      await manager.setWhatsAppSession('test-workspace', '+1111111111', session1)
      await manager.setWhatsAppSession('test-workspace', '+2222222222', session2)

      const sessions = await manager.getAllWhatsAppSessions('test-workspace')

      expect(sessions.length).toBe(2)
      expect(sessions.map(s => s.pushName).sort()).toEqual(['User 1', 'User 2'])

      // Cleanup
      await manager.deleteWhatsAppSession('test-workspace', '+1111111111')
      await manager.deleteWhatsAppSession('test-workspace', '+2222222222')
    })

    test('only returns sessions for specified workspace', async () => {
      const session1 = createMockSession({ pushName: 'WS1 User' })
      const session2 = createMockSession({ pushName: 'WS2 User' })

      await manager.setWhatsAppSession('workspace-1', '+1234567890', session1)
      await manager.setWhatsAppSession('workspace-2', '+1234567890', session2)

      const ws1Sessions = await manager.getAllWhatsAppSessions('workspace-1')
      const ws2Sessions = await manager.getAllWhatsAppSessions('workspace-2')

      expect(ws1Sessions.length).toBe(1)
      expect(ws1Sessions[0]?.pushName).toBe('WS1 User')

      expect(ws2Sessions.length).toBe(1)
      expect(ws2Sessions[0]?.pushName).toBe('WS2 User')

      // Cleanup
      await manager.deleteWhatsAppSession('workspace-1', '+1234567890')
      await manager.deleteWhatsAppSession('workspace-2', '+1234567890')
    })
  })

  describe('expired sessions', () => {
    test('stores expired session flag', async () => {
      const session = createMockSession({ isExpired: true })
      await manager.setWhatsAppSession('test-workspace', '+1234567890', session)

      const retrieved = await manager.getWhatsAppSession('test-workspace', '+1234567890')
      expect(retrieved?.isExpired).toBe(true)
    })

    test('stores non-expired session flag', async () => {
      const session = createMockSession({ isExpired: false })
      await manager.setWhatsAppSession('test-workspace', '+1234567890', session)

      const retrieved = await manager.getWhatsAppSession('test-workspace', '+1234567890')
      expect(retrieved?.isExpired).toBe(false)
    })
  })
})
