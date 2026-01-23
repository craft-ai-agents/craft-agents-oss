import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { WhatsAppMessageRouter } from '../message-router'
import type { WhatsAppMessage } from '../types'

/**
 * Mock SessionManager for testing
 * Tracks all method calls to verify correct behavior
 */
class MockSessionManager {
  calls: Array<{
    method: string
    args: any[]
  }> = []

  private sessions = new Map<string, any>()

  async getSession(sessionId: string) {
    this.calls.push({ method: 'getSession', args: [sessionId] })
    return this.sessions.get(sessionId) || null
  }

  async createSession(workspaceId: string, config: any) {
    this.calls.push({ method: 'createSession', args: [workspaceId, config] })
    const session = { id: config.name, ...config }
    // Store session by the config name (which becomes the session ID reference)
    // The message router will look it up via the sessionId from getSessionId()
    // We need to store it with the same key format used in router
    const groupJid = config.metadata?.groupJid
    const senderJid = config.metadata?.senderJid
    if (groupJid && senderJid) {
      const sessionKey = `whatsapp_${groupJid}::${senderJid}`
      this.sessions.set(sessionKey, session)
    }
    return session
  }

  async setSessionPermissionMode(sessionId: string, mode: string) {
    this.calls.push({ method: 'setSessionPermissionMode', args: [sessionId, mode] })
  }

  async sendMessage(sessionId: string, content: string, attachments?: any) {
    this.calls.push({ method: 'sendMessage', args: [sessionId, content, attachments] })
  }

  setSessionCompletionCallback(sessionId: string, callback: (sessionId: string, messages: any[]) => Promise<void>) {
    this.calls.push({ method: 'setSessionCompletionCallback', args: [sessionId, callback] })
    // Immediately call the callback with an empty message array to simulate completion
    callback(sessionId, [])
  }

  getCallsForMethod(method: string): Array<{ method: string; args: any[] }> {
    return this.calls.filter(c => c.method === method)
  }

  reset() {
    this.calls = []
    this.sessions.clear()
  }
}

describe('WhatsAppMessageRouter with Directive Integration', () => {
  let router: WhatsAppMessageRouter
  let mockSessionManager: MockSessionManager
  const workspaceId = 'test-workspace'

  beforeEach(() => {
    mockSessionManager = new MockSessionManager()
    router = new WhatsAppMessageRouter(workspaceId, mockSessionManager as any)
  })

  /**
   * Helper to create test WhatsApp message
   */
  function createTestMessage(overrides?: Partial<WhatsAppMessage>): WhatsAppMessage {
    return {
      id: 'msg-001',
      groupJid: '123456789-123456789@g.us',
      groupName: 'Team Discussion',
      senderJid: '1234567890@s.whatsapp.net',
      senderPhoneNumber: '+1234567890',
      senderName: 'Alice',
      content: 'Hello Claude',
      timestamp: Date.now(),
      ...overrides,
    }
  }

  describe('Directive Extraction and Permission Mode Mapping', () => {
    test('message with no directive defaults to safe mode', async () => {
      const msg = createTestMessage({
        content: 'just ask claude something',
      })

      await router.routeIncomingMessage(msg)

      // Verify permission mode was set to 'safe'
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe('safe')

      // Verify full content was sent (no stripping)
      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls).toHaveLength(1)
      expect(msgCalls[0]!.args[1]).toBe('just ask claude something')
    })

    test('message with @vespr /safe directive sets safe mode', async () => {
      const msg = createTestMessage({
        content: '@vespr /safe research competitors',
      })

      await router.routeIncomingMessage(msg)

      // Verify permission mode was set to 'safe'
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe('safe')

      // Verify directive was stripped from message
      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls).toHaveLength(1)
      expect(msgCalls[0]!.args[1]).toBe('research competitors')
    })

    test('message with @vespr /ask directive sets ask mode', async () => {
      const msg = createTestMessage({
        content: '@vespr /ask run this script',
      })

      await router.routeIncomingMessage(msg)

      // Verify permission mode was set to 'ask'
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe('ask')

      // Verify directive was stripped
      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls).toHaveLength(1)
      expect(msgCalls[0]!.args[1]).toBe('run this script')
    })

    test('message with @vespr /allow-all directive sets allow-all mode', async () => {
      const msg = createTestMessage({
        content: '@vespr /allow-all execute deployment',
      })

      await router.routeIncomingMessage(msg)

      // Verify permission mode was set to 'allow-all'
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe('allow-all')

      // Verify directive was stripped
      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls).toHaveLength(1)
      expect(msgCalls[0]!.args[1]).toBe('execute deployment')
    })
  })

  describe('Case Insensitivity', () => {
    test('directives are case insensitive', async () => {
      const msg = createTestMessage({
        content: '@vespr /SAFE research info',
      })

      await router.routeIncomingMessage(msg)

      // Should normalize to lowercase 'safe'
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe('safe')

      // Content should be stripped correctly
      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls[0]!.args[1]).toBe('research info')
    })

    test('@vespr prefix case insensitivity', async () => {
      const msg = createTestMessage({
        content: '@VESPR /ask test',
      })

      await router.routeIncomingMessage(msg)

      // Should recognize despite case difference
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe('ask')
    })
  })

  describe('Directive Stripping', () => {
    test('directive prefix is completely stripped from agent input', async () => {
      const msg = createTestMessage({
        content: '@vespr /allow-all deploy to production',
      })

      await router.routeIncomingMessage(msg)

      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls).toHaveLength(1)
      expect(msgCalls[0]!.args[1]).toBe('deploy to production')
      // Ensure no @vespr or /allow-all remains
      expect(msgCalls[0]!.args[1]).not.toContain('@vespr')
      expect(msgCalls[0]!.args[1]).not.toContain('/')
    })

    test('multi-word content is preserved after stripping', async () => {
      const msg = createTestMessage({
        content: '@vespr /safe research my competitors market share trends',
      })

      await router.routeIncomingMessage(msg)

      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls).toHaveLength(1)
      expect(msgCalls[0]!.args[1]).toBe('research my competitors market share trends')
    })
  })

  describe('Edge Cases', () => {
    test('just directive with no content sends empty message', async () => {
      const msg = createTestMessage({
        content: '@vespr /safe',
      })

      await router.routeIncomingMessage(msg)

      // Directive should not be recognized without content
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')

      expect(modeCalls).toHaveLength(1)
      expect(msgCalls).toHaveLength(1)
      // Full message should be sent (not recognized as valid directive)
      expect(msgCalls[0]!.args[1]).toBe('@vespr /safe')
    })

    test('multiple directives: only first one is recognized', async () => {
      const msg = createTestMessage({
        content: '@vespr /safe @vespr /allow-all test content',
      })

      await router.routeIncomingMessage(msg)

      // Only first directive should be applied
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe('safe')

      // Second directive should remain in content
      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls[0]!.args[1]).toBe('@vespr /allow-all test content')
    })

    test('directive in middle of message is not recognized', async () => {
      const msg = createTestMessage({
        content: 'hello @vespr /safe world',
      })

      await router.routeIncomingMessage(msg)

      // Should default to safe mode (no directive at start)
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe('safe')

      // Full message should be sent
      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls[0]!.args[1]).toBe('hello @vespr /safe world')
    })

    test('invalid directive ignored, defaults to safe', async () => {
      const msg = createTestMessage({
        content: '@vespr /invalid research',
      })

      await router.routeIncomingMessage(msg)

      // Should default to safe mode
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe('safe')

      // Full message (including invalid directive) should be sent
      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls[0]!.args[1]).toBe('@vespr /invalid research')
    })

    test('whitespace trimming around directive and content', async () => {
      const msg = createTestMessage({
        content: '   @vespr /ask   test content   ',
      })

      await router.routeIncomingMessage(msg)

      // Should recognize directive despite extra whitespace
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe('ask')

      // Content should be trimmed and stripped
      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls[0]!.args[1]).toBe('test content')
    })
  })

  describe('Permission Mode Setting Order', () => {
    test('permission mode is set BEFORE sending message', async () => {
      const msg = createTestMessage({
        content: '@vespr /allow-all deploy',
      })

      await router.routeIncomingMessage(msg)

      // Track order of calls
      const relevantCalls = mockSessionManager.calls.filter(
        c => c.method === 'setSessionPermissionMode' || c.method === 'sendMessage'
      )

      expect(relevantCalls).toHaveLength(2)
      expect(relevantCalls[0]!.method).toBe('setSessionPermissionMode')
      expect(relevantCalls[1]!.method).toBe('sendMessage')
    })
  })

  describe('Session Management with Directives', () => {
    test('creates session with correct metadata', async () => {
      const msg = createTestMessage({
        content: '@vespr /ask analyze this',
        groupName: 'Engineering Team',
        senderName: 'Bob',
      })

      await router.routeIncomingMessage(msg)

      const createCalls = mockSessionManager.getCallsForMethod('createSession')
      expect(createCalls).toHaveLength(1)

      const [wsId, config] = createCalls[0]!.args
      expect(wsId).toBe(workspaceId)
      expect(config.metadata.groupName).toBe('Engineering Team')
      expect(config.metadata.senderName).toBe('Bob')
    })

    test('reuses existing session for same sender/group pair', async () => {
      const msg1 = createTestMessage({
        content: 'first message',
      })
      const msg2 = createTestMessage({
        content: '@vespr /ask second message',
      })

      await router.routeIncomingMessage(msg1)

      // Get the session ID that was created
      const createCalls1 = mockSessionManager.getCallsForMethod('createSession')
      expect(createCalls1).toHaveLength(1)

      // Now simulate session manager returning the existing session
      const secondRouter = new WhatsAppMessageRouter(workspaceId, mockSessionManager as any)

      // Reset only call tracking, keep sessions
      const callsBeforeSecond = mockSessionManager.calls.length
      mockSessionManager.calls = []

      await secondRouter.routeIncomingMessage(msg2)

      // Should NOT create a new session (calls after the first batch)
      const createCalls2 = mockSessionManager.getCallsForMethod('createSession')
      expect(createCalls2).toHaveLength(0)

      // Should still set permission mode and send message
      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe('ask')
    })
  })

  describe('Attachment Handling with Directives', () => {
    test('attachments are forwarded to agent when directive present', async () => {
      const msg = createTestMessage({
        content: '@vespr /safe analyze this document',
        attachments: [
          {
            fileName: 'report.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
      })

      await router.routeIncomingMessage(msg)

      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls).toHaveLength(1)
      expect(msgCalls[0]!.args[1]).toBe('analyze this document')
      expect(msgCalls[0]!.args[2]).toEqual([
        {
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        },
      ])
    })

    test('attachments are forwarded when no directive', async () => {
      const msg = createTestMessage({
        content: 'analyze this document',
        attachments: [
          {
            fileName: 'data.csv',
            mimeType: 'text/csv',
            sizeBytes: 2048,
          },
        ],
      })

      await router.routeIncomingMessage(msg)

      const msgCalls = mockSessionManager.getCallsForMethod('sendMessage')
      expect(msgCalls).toHaveLength(1)
      expect(msgCalls[0]!.args[2]).toEqual([
        {
          fileName: 'data.csv',
          mimeType: 'text/csv',
          sizeBytes: 2048,
        },
      ])
    })
  })

  describe('All Valid Directives Work Correctly', () => {
    test('/safe directive', async () => {
      const msg = createTestMessage({ content: '@vespr /safe data' })
      await router.routeIncomingMessage(msg)

      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls[0]!.args[1]).toBe('safe')
    })

    test('/ask directive', async () => {
      const msg = createTestMessage({ content: '@vespr /ask code' })
      await router.routeIncomingMessage(msg)

      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls[0]!.args[1]).toBe('ask')
    })

    test('/allow-all directive', async () => {
      const msg = createTestMessage({ content: '@vespr /allow-all run' })
      await router.routeIncomingMessage(msg)

      const modeCalls = mockSessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls[0]!.args[1]).toBe('allow-all')
    })
  })
})
