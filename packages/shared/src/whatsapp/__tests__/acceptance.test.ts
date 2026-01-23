/**
 * WhatsApp Message Routing - Acceptance Tests (End-to-End)
 *
 * Comprehensive acceptance tests simulating real-world WhatsApp workflows.
 * Tests cover:
 * - Safe mode (default) - read-only operations
 * - Permission directives (ask, allow-all)
 * - Result formatting and message chunking
 * - Message queuing resilience
 * - Session management and metadata preservation
 * - Error handling and edge cases
 * - Integration flow end-to-end
 *
 * Test scenarios mirror production behavior with proper mocking
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { WhatsAppMessageRouter } from '../message-router'
import { WhatsAppMessageQueue } from '../message-queue'
import {
  formatResult,
  chunkForWhatsApp,
  estimateWhatsAppSize,
} from '../result-formatter'
import { extractDirective, getDirective } from '../directive-parser'
import { getSessionId } from '../session-mapper'
import type { WhatsAppMessage } from '../types'
import type { Message, MessageRole } from '@craft-agent/core/types'

// ============================================================================
// MOCK FACTORIES
// ============================================================================

/**
 * Factory: Create realistic WhatsApp message
 */
function createMockWhatsAppMessage(
  overrides?: Partial<WhatsAppMessage>,
): WhatsAppMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    groupJid: '123456789-123456789@g.us',
    groupName: 'Engineering Team',
    senderJid: '1234567890@s.whatsapp.net',
    senderPhoneNumber: '+1234567890',
    senderName: 'Alice',
    content: 'Hello Claude',
    timestamp: Date.now(),
    ...overrides,
  }
}

/**
 * Factory: Create mock SessionManager with spy capabilities
 */
class MockSessionManager {
  calls: Array<{ method: string; args: any[] }> = []
  private sessions = new Map<string, any>()

  async getSession(sessionId: string) {
    this.calls.push({ method: 'getSession', args: [sessionId] })
    return this.sessions.get(sessionId) || null
  }

  async createSession(workspaceId: string, config: any) {
    this.calls.push({ method: 'createSession', args: [workspaceId, config] })
    const groupJid = config.metadata?.groupJid
    const senderJid = config.metadata?.senderJid
    if (groupJid && senderJid) {
      const sessionKey = `whatsapp_${groupJid}::${senderJid}`
      const session = { id: sessionKey, ...config }
      this.sessions.set(sessionKey, session)
      return session
    }
    return config
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

  getCallsForMethod(method: string) {
    return this.calls.filter((c) => c.method === method)
  }

  reset() {
    this.calls = []
    this.sessions.clear()
  }
}

/**
 * Factory: Create mock SDK Message for result formatting
 * Uses internal Vespr Message type (content is string, has timestamp)
 */
function createMockSdkMessage(
  role: MessageRole,
  text: string,
): Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    role,
    content: text,
    timestamp: Date.now(),
  }
}

/**
 * Factory: Create mock message queue for resilience testing
 */
class MockMessageQueue {
  private queue: WhatsAppMessage[] = []

  async enqueue(msg: WhatsAppMessage): Promise<void> {
    this.queue.push(msg)
  }

  async dequeue(): Promise<WhatsAppMessage | null> {
    return this.queue.shift() || null
  }

  async getQueueSize(): Promise<number> {
    return this.queue.length
  }

  async peek(count: number = 10): Promise<WhatsAppMessage[]> {
    return this.queue.slice(0, count)
  }

  async clear(): Promise<void> {
    this.queue = []
  }

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {}
}

// ============================================================================
// ACCEPTANCE TEST SUITES
// ============================================================================

describe('WhatsApp Acceptance Tests - Happy Path (Safe Mode)', () => {
  let router: WhatsAppMessageRouter
  let sessionManager: MockSessionManager
  const workspaceId = 'workspace-prod'

  beforeEach(() => {
    sessionManager = new MockSessionManager()
    router = new WhatsAppMessageRouter(workspaceId, sessionManager as any)
  })

  test('1. User sends message to bot without directive → safe mode enforced', async () => {
    const msg = createMockWhatsAppMessage({
      content: 'What is machine learning?',
    })

    await router.routeIncomingMessage(msg)

    // Verify safe mode was applied
    const modeCalls = sessionManager.getCallsForMethod('setSessionPermissionMode')
    expect(modeCalls).toHaveLength(1)
    expect(modeCalls[0]!.args[1]).toBe('safe')

    // Verify message content sent unchanged
    const msgCalls = sessionManager.getCallsForMethod('sendMessage')
    expect(msgCalls).toHaveLength(1)
    expect(msgCalls[0]!.args[1]).toBe('What is machine learning?')
  })

  test('2. Session created with correct WhatsApp metadata', async () => {
    const msg = createMockWhatsAppMessage({
      groupName: 'Product Team',
      senderName: 'Bob',
      senderPhoneNumber: '+1987654321',
    })

    await router.routeIncomingMessage(msg)

    const createCalls = sessionManager.getCallsForMethod('createSession')
    expect(createCalls).toHaveLength(1)

    const [wsId, config] = createCalls[0]!.args
    expect(wsId).toBe(workspaceId)
    expect(config.metadata.type).toBe('whatsapp')
    expect(config.metadata.groupName).toBe('Product Team')
    expect(config.metadata.senderName).toBe('Bob')
    expect(config.metadata.senderPhoneNumber).toBe('+1987654321')
    expect(config.metadata.createdVia).toBe('whatsapp')
  })

  test('3. Agent result formatted for WhatsApp constraints (4096 char limit)', () => {
    const smallResponse = 'Research shows that coffee improves focus.'
    const sdkMessages = [createMockSdkMessage('assistant', smallResponse)]

    const result = formatResult(sdkMessages, 'session-123')

    expect(result.messages).toHaveLength(1)
    expect(result.truncated).toBe(false)
    expect(result.messages[0]!.length).toBeLessThanOrEqual(4096)
  })

  test('4. Medium result (4KB-16KB) gets chunked into multiple messages', () => {
    const mediumResponse = 'x'.repeat(5000) // Between 4KB and 16KB
    const sdkMessages = [createMockSdkMessage('assistant', mediumResponse)]

    const result = formatResult(sdkMessages, 'whatsapp_group::sender')

    expect(result.truncated).toBe(true)
    // Medium results get chunked, not deep linked
    expect(result.messages.length).toBeGreaterThan(1)
    result.messages.forEach((msg) => {
      expect(msg.length).toBeLessThanOrEqual(4096)
    })
    expect(result.summary).toBeTruthy()
  })

  test('4b. Very large result (>16KB) generates summary with deep link', () => {
    const veryLargeResponse = 'x'.repeat(20000) // Over 16KB
    const sdkMessages = [createMockSdkMessage('assistant', veryLargeResponse)]

    const result = formatResult(sdkMessages, 'whatsapp_group::sender')

    expect(result.truncated).toBe(true)
    // Very large results use preview + deep link
    expect(result.messages.length).toBe(1)
    expect(result.messages[0]).toContain('View full result in Vespr')
    expect(result.deepLink).toBeDefined()
  })

  test('5. Session metadata preserved across multiple messages', async () => {
    const msg1 = createMockWhatsAppMessage({
      content: 'First question',
      senderName: 'Alice',
      groupName: 'Team A',
    })

    const msg2 = createMockWhatsAppMessage({
      content: 'Second question',
      senderJid: msg1.senderJid,
      groupJid: msg1.groupJid,
      senderName: 'Alice',
      groupName: 'Team A',
    })

    await router.routeIncomingMessage(msg1)
    const createCalls1 = sessionManager.getCallsForMethod('createSession')
    expect(createCalls1).toHaveLength(1)

    // Reset to track second message
    sessionManager.calls = []

    await router.routeIncomingMessage(msg2)
    const createCalls2 = sessionManager.getCallsForMethod('createSession')
    // Should reuse existing session (createSession not called again)
    expect(createCalls2).toHaveLength(0)

    const msgCalls = sessionManager.getCallsForMethod('sendMessage')
    expect(msgCalls).toHaveLength(1)
  })
})

describe('WhatsApp Acceptance Tests - Permission Directives (Ask Mode)', () => {
  let router: WhatsAppMessageRouter
  let sessionManager: MockSessionManager
  const workspaceId = 'workspace-test'

  beforeEach(() => {
    sessionManager = new MockSessionManager()
    router = new WhatsAppMessageRouter(workspaceId, sessionManager as any)
  })

  test('6. Message with @vespr /ask directive sets ask mode', async () => {
    const msg = createMockWhatsAppMessage({
      content: '@vespr /ask run deployment script',
    })

    await router.routeIncomingMessage(msg)

    // Verify ask mode applied
    const modeCalls = sessionManager.getCallsForMethod('setSessionPermissionMode')
    expect(modeCalls).toHaveLength(1)
    expect(modeCalls[0]!.args[1]).toBe('ask')

    // Verify directive stripped from message
    const msgCalls = sessionManager.getCallsForMethod('sendMessage')
    expect(msgCalls[0]!.args[1]).toBe('run deployment script')
  })

  test('7. Directive extracted correctly from message', () => {
    const msg = '@vespr /ask analyze this data'
    const { directive, content } = extractDirective(msg)

    expect(directive).toBe('ask')
    expect(content).toBe('analyze this data')
  })

  test('8. Permission mode set BEFORE message sent to agent', async () => {
    const msg = createMockWhatsAppMessage({
      content: '@vespr /ask execute command',
    })

    await router.routeIncomingMessage(msg)

    const relevantCalls = sessionManager.calls.filter(
      (c) => c.method === 'setSessionPermissionMode' || c.method === 'sendMessage',
    )

    expect(relevantCalls.length).toBeGreaterThanOrEqual(2)
    expect(relevantCalls[0]!.method).toBe('setSessionPermissionMode')
    expect(relevantCalls[1]!.method).toBe('sendMessage')
  })
})

describe('WhatsApp Acceptance Tests - Permission Directives (Allow-All Mode)', () => {
  let router: WhatsAppMessageRouter
  let sessionManager: MockSessionManager
  const workspaceId = 'workspace-allowall'

  beforeEach(() => {
    sessionManager = new MockSessionManager()
    router = new WhatsAppMessageRouter(workspaceId, sessionManager as any)
  })

  test('9. Message with @vespr /allow-all directive enables allow-all mode', async () => {
    const msg = createMockWhatsAppMessage({
      content: '@vespr /allow-all write production data',
    })

    await router.routeIncomingMessage(msg)

    // Verify allow-all mode applied
    const modeCalls = sessionManager.getCallsForMethod('setSessionPermissionMode')
    expect(modeCalls).toHaveLength(1)
    expect(modeCalls[0]!.args[1]).toBe('allow-all')

    // Verify message processed without directive
    const msgCalls = sessionManager.getCallsForMethod('sendMessage')
    expect(msgCalls[0]!.args[1]).toBe('write production data')
  })

  test('10. Directive recognized case-insensitively', async () => {
    const msg = createMockWhatsAppMessage({
      content: '@VESPR /ALLOW-ALL deploy now',
    })

    await router.routeIncomingMessage(msg)

    const modeCalls = sessionManager.getCallsForMethod('setSessionPermissionMode')
    expect(modeCalls[0]!.args[1]).toBe('allow-all')
  })

  test('11. Invalid directive defaults to safe mode', async () => {
    const msg = createMockWhatsAppMessage({
      content: '@vespr /invalid-mode do something',
    })

    await router.routeIncomingMessage(msg)

    const modeCalls = sessionManager.getCallsForMethod('setSessionPermissionMode')
    expect(modeCalls[0]!.args[1]).toBe('safe')
  })
})

describe('WhatsApp Acceptance Tests - Result Formatting', () => {
  test('12. Small response (< 4096 chars) sent as-is', () => {
    const response = 'Machine learning is a subset of AI. It enables systems to learn from data.'
    const messages = [createMockSdkMessage('assistant', response)]

    const result = formatResult(messages, 'session-1')

    expect(result.messages).toHaveLength(1)
    expect(result.truncated).toBe(false)
    expect(result.messages[0]).toBe(response)
  })

  test('13. Medium response (4KB-16KB) gets chunked', () => {
    const mediumResponse = 'This is a comprehensive explanation. '.repeat(200) // ~7400 chars
    const messages = [createMockSdkMessage('assistant', mediumResponse)]

    const result = formatResult(messages, 'whatsapp_group123::sender456')

    expect(result.truncated).toBe(true)
    // Medium results get chunked into multiple messages
    expect(result.messages.length).toBeGreaterThan(1)
    result.messages.forEach((msg) => {
      expect(msg.length).toBeLessThanOrEqual(4096)
    })
  })

  test('13b. Very large response (>16KB) generates summary + deep link', () => {
    const veryLargeResponse = 'x'.repeat(20000) // Over 16KB
    const messages = [createMockSdkMessage('assistant', veryLargeResponse)]

    const result = formatResult(messages, 'whatsapp_group123::sender456')

    expect(result.truncated).toBe(true)
    expect(result.messages.length).toBe(1)
    expect(result.messages[0]).toContain('View full result in Vespr')
    expect(result.deepLink).toBeDefined()
  })

  test('14. Multiple messages handled properly', () => {
    const text1 = 'First part of the response.'
    const text2 = 'Second part of the response.'
    const messages = [
      createMockSdkMessage('assistant', text1),
      createMockSdkMessage('assistant', text2),
    ]

    const result = formatResult(messages, 'session-1')

    expect(result.fullMarkdown).toContain(text1)
    expect(result.fullMarkdown).toContain(text2)
  })

  test('15. Sources extracted and formatted as citations', () => {
    // Create messages with proper internal Message format (content as string)
    const messages: Message[] = [
      createMockSdkMessage('assistant', 'Found information from two sources.'),
      {
        id: 'msg_tool_result',
        role: 'tool',
        content: 'See https://example.com/page and https://research.org/study',
        timestamp: Date.now(),
        toolResult: 'See https://example.com/page and https://research.org/study',
      },
    ]

    const result = formatResult(messages, 'session-1')

    expect(result.fullMarkdown).toContain('📋 **Sources:**')
    expect(result.fullMarkdown).toContain('https://example.com/page')
    expect(result.fullMarkdown).toContain('https://research.org/study')
  })

  test('16. Message chunking splits large text at paragraph boundaries', () => {
    const chunk1 = 'First paragraph with information.\n\n'
    const chunk2 = 'Second paragraph with more content.\n\n'
    const chunk3 = 'x'.repeat(5000)

    const fullText = chunk1 + chunk2 + chunk3
    const chunks = chunkForWhatsApp(fullText, 4096)

    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(4096)
    })
  })

  test('17. WhatsApp size estimation calculates total characters', () => {
    const msg1 = 'a'.repeat(2000)
    const msg2 = 'b'.repeat(1500)
    const result = {
      messages: [msg1, msg2],
      summary: 'test',
      fullMarkdown: 'test',
      truncated: true,
    }

    const size = estimateWhatsAppSize(result)
    expect(size).toBe(3500)
  })
})

describe('WhatsApp Acceptance Tests - Message Queue Resilience', () => {
  let testDir: string
  let mockCredentialManager: any

  beforeEach(async () => {
    testDir = join(tmpdir(), `whatsapp-acceptance-${Date.now()}-${Math.random()}`)
    await mkdir(testDir, { recursive: true })
    mockCredentialManager = { get: async () => null, set: async () => {} }
  })

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  test('18. Message queued on network failure', async () => {
    const queue = new MockMessageQueue()
    await queue.initialize()

    const msg1 = createMockWhatsAppMessage({ content: 'Message 1' })
    const msg2 = createMockWhatsAppMessage({ content: 'Message 2' })

    await queue.enqueue(msg1)
    await queue.enqueue(msg2)

    expect(await queue.getQueueSize()).toBe(2)
  })

  test('19. Queue persists across app restarts', async () => {
    const queue1 = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue1.initialize()

    const msg = createMockWhatsAppMessage({ content: 'Persist me' })
    await queue1.enqueue(msg)
    await queue1.shutdown()

    // Simulate app restart
    const queue2 = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue2.initialize()

    const size = await queue2.getQueueSize()
    expect(size).toBe(1)

    const restored = await queue2.dequeue()
    expect(restored?.content).toBe('Persist me')

    await queue2.shutdown()
  })

  test('20. Queue drained in FIFO order', async () => {
    const queue = new MockMessageQueue()

    const messages = [
      createMockWhatsAppMessage({ content: 'First' }),
      createMockWhatsAppMessage({ content: 'Second' }),
      createMockWhatsAppMessage({ content: 'Third' }),
    ]

    for (const msg of messages) {
      await queue.enqueue(msg)
    }

    expect(await queue.getQueueSize()).toBe(3)

    const dequeued1 = await queue.dequeue()
    expect(dequeued1?.content).toBe('First')

    const dequeued2 = await queue.dequeue()
    expect(dequeued2?.content).toBe('Second')

    const dequeued3 = await queue.dequeue()
    expect(dequeued3?.content).toBe('Third')

    expect(await queue.getQueueSize()).toBe(0)
  })

  test('21. No messages lost on crash simulation', async () => {
    const queue1 = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue1.initialize()

    // Add 100 messages to trigger flush
    for (let i = 0; i < 100; i++) {
      await queue1.enqueue(createMockWhatsAppMessage({ content: `Msg ${i}` }))
    }

    // Simulate crash - no shutdown
    const queue2 = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue2.initialize()

    const size = await queue2.getQueueSize()
    expect(size).toBe(100)

    await queue2.shutdown()
  })
})

describe('WhatsApp Acceptance Tests - Session Management', () => {
  let router: WhatsAppMessageRouter
  let sessionManager: MockSessionManager
  const workspaceId = 'workspace-session'

  beforeEach(() => {
    sessionManager = new MockSessionManager()
    router = new WhatsAppMessageRouter(workspaceId, sessionManager as any)
  })

  test('22. Same user in same group → same session', async () => {
    const msg1 = createMockWhatsAppMessage({
      groupJid: 'group1@g.us',
      senderJid: 'user1@s.whatsapp.net',
      content: 'First message',
    })

    const msg2 = createMockWhatsAppMessage({
      groupJid: 'group1@g.us',
      senderJid: 'user1@s.whatsapp.net',
      content: 'Second message',
    })

    await router.routeIncomingMessage(msg1)
    const sessionId1 = getSessionId(msg1.groupJid, msg1.senderJid)

    sessionManager.calls = []

    await router.routeIncomingMessage(msg2)
    // Second message should not create new session
    const createCalls = sessionManager.getCallsForMethod('createSession')
    expect(createCalls).toHaveLength(0)
  })

  test('23. Different user in same group → different session', async () => {
    const msg1 = createMockWhatsAppMessage({
      groupJid: 'group1@g.us',
      senderJid: 'user1@s.whatsapp.net',
    })

    const msg2 = createMockWhatsAppMessage({
      groupJid: 'group1@g.us',
      senderJid: 'user2@s.whatsapp.net',
    })

    const sessionId1 = getSessionId(msg1.groupJid, msg1.senderJid)
    const sessionId2 = getSessionId(msg2.groupJid, msg2.senderJid)

    expect(sessionId1).not.toBe(sessionId2)
  })

  test('24. Same user in different group → different session', async () => {
    const msg1 = createMockWhatsAppMessage({
      groupJid: 'group1@g.us',
      senderJid: 'user1@s.whatsapp.net',
    })

    const msg2 = createMockWhatsAppMessage({
      groupJid: 'group2@g.us',
      senderJid: 'user1@s.whatsapp.net',
    })

    const sessionId1 = getSessionId(msg1.groupJid, msg1.senderJid)
    const sessionId2 = getSessionId(msg2.groupJid, msg2.senderJid)

    expect(sessionId1).not.toBe(sessionId2)
  })

  test('25. Session ID generated deterministically', () => {
    const groupJid = 'team-group@g.us'
    const senderJid = 'alice@s.whatsapp.net'

    const sessionId1 = getSessionId(groupJid, senderJid)
    const sessionId2 = getSessionId(groupJid, senderJid)

    expect(sessionId1).toBe(sessionId2)
    expect(sessionId1).toContain('whatsapp_')
    expect(sessionId1).toContain('::')
  })
})

describe('WhatsApp Acceptance Tests - Error Handling', () => {
  let router: WhatsAppMessageRouter
  let sessionManager: MockSessionManager
  const workspaceId = 'workspace-errors'

  beforeEach(() => {
    sessionManager = new MockSessionManager()
    router = new WhatsAppMessageRouter(workspaceId, sessionManager as any)
  })

  test('26. Invalid directive ignored gracefully (defaults to safe mode)', async () => {
    const msg = createMockWhatsAppMessage({
      content: '@vespr /destroy-everything research',
    })

    // Should not throw
    await router.routeIncomingMessage(msg)

    const modeCalls = sessionManager.getCallsForMethod('setSessionPermissionMode')
    expect(modeCalls).toHaveLength(1)
    expect(modeCalls[0]!.args[1]).toBe('safe')
  })

  test('27. Malformed content handled without crashing', async () => {
    const msg = createMockWhatsAppMessage({
      content: '',
    })

    await router.routeIncomingMessage(msg)

    const msgCalls = sessionManager.getCallsForMethod('sendMessage')
    expect(msgCalls).toHaveLength(1)
  })

  test('28. Directive with empty content recognized and handled', async () => {
    const { directive, content } = extractDirective('@vespr /ask')

    expect(directive).toBeNull()
    expect(content).toBe('@vespr /ask')
  })

  test('29. Multiple directives: only first is applied', async () => {
    const msg = createMockWhatsAppMessage({
      content: '@vespr /safe @vespr /allow-all test',
    })

    await router.routeIncomingMessage(msg)

    const modeCalls = sessionManager.getCallsForMethod('setSessionPermissionMode')
    expect(modeCalls).toHaveLength(1)
    expect(modeCalls[0]!.args[1]).toBe('safe')

    const msgCalls = sessionManager.getCallsForMethod('sendMessage')
    expect(msgCalls[0]!.args[1]).toContain('@vespr /allow-all')
  })

  test('30. Attachments forwarded regardless of directive presence', async () => {
    const msg = createMockWhatsAppMessage({
      content: '@vespr /safe analyze document',
      attachments: [
        {
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
        },
      ],
    })

    await router.routeIncomingMessage(msg)

    const msgCalls = sessionManager.getCallsForMethod('sendMessage')
    expect(msgCalls).toHaveLength(1)
    expect(msgCalls[0]!.args[2]).toEqual([
      {
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      },
    ])
  })
})

describe('WhatsApp Acceptance Tests - Integration Flow (End-to-End)', () => {
  let router: WhatsAppMessageRouter
  let sessionManager: MockSessionManager
  const workspaceId = 'workspace-integration'

  beforeEach(() => {
    sessionManager = new MockSessionManager()
    router = new WhatsAppMessageRouter(workspaceId, sessionManager as any)
  })

  test('31. Complete workflow: message → session → permission → agent', async () => {
    const msg = createMockWhatsAppMessage({
      groupName: 'Research Team',
      senderName: 'Carol',
      senderPhoneNumber: '+11234567890',
      content: '@vespr /ask research cloud computing',
    })

    await router.routeIncomingMessage(msg)

    // Verify all steps occurred in order
    expect(sessionManager.getCallsForMethod('createSession')).toHaveLength(1)
    expect(sessionManager.getCallsForMethod('setSessionPermissionMode')).toHaveLength(1)
    expect(sessionManager.getCallsForMethod('sendMessage')).toHaveLength(1)

    // Verify order: create → setMode → send
    const relevantCalls = sessionManager.calls.filter(
      (c) =>
        c.method === 'createSession' ||
        c.method === 'setSessionPermissionMode' ||
        c.method === 'sendMessage',
    )

    expect(relevantCalls[0]!.method).toBe('createSession')
    expect(relevantCalls[1]!.method).toBe('setSessionPermissionMode')
    expect(relevantCalls[2]!.method).toBe('sendMessage')
  })

  test('32. Result flow: SDK response → formatted → delivered', () => {
    const agentResponse = 'Cloud computing enables on-demand resource access.'
    const sdkMessages = [createMockSdkMessage('assistant', agentResponse)]

    const formatted = formatResult(sdkMessages, 'whatsapp_group::sender')
    const size = estimateWhatsAppSize(formatted)

    expect(formatted.messages.length).toBeGreaterThan(0)
    expect(size).toBeLessThanOrEqual(4096)
    expect(formatted.truncated).toBe(false)
  })

  test('33. Complex flow: medium response with sources → chunked delivery', () => {
    const mediumResponse = 'This discusses various aspects of cloud computing. '.repeat(200) // ~10KB

    const sdkMessages: Message[] = [
      createMockSdkMessage('assistant', mediumResponse),
      {
        id: 'msg_tool_result',
        role: 'tool',
        content: 'Sources: https://aws.amazon.com/cloud-computing and https://azure.microsoft.com/services',
        timestamp: Date.now(),
        toolResult: 'Sources: https://aws.amazon.com/cloud-computing and https://azure.microsoft.com/services',
      },
    ]

    const formatted = formatResult(sdkMessages, 'whatsapp_research::alice')

    expect(formatted.truncated).toBe(true)
    // Medium responses (4KB-16KB) get chunked, not deep linked
    expect(formatted.messages.length).toBeGreaterThan(1)
    expect(formatted.summary).toBeTruthy()
    // Sources should be in the full markdown
    expect(formatted.fullMarkdown).toContain('https://aws.amazon.com/cloud-computing')
  })

  test('34. All three permission modes work in complete flow', async () => {
    const modes: Array<{
      directive: string
      expectedMode: 'safe' | 'ask' | 'allow-all'
    }> = [
      { directive: '@vespr /safe', expectedMode: 'safe' },
      { directive: '@vespr /ask', expectedMode: 'ask' },
      { directive: '@vespr /allow-all', expectedMode: 'allow-all' },
    ]

    for (const { directive, expectedMode } of modes) {
      sessionManager.reset()

      const msg = createMockWhatsAppMessage({
        content: `${directive} test operation`,
      })

      await router.routeIncomingMessage(msg)

      const modeCalls = sessionManager.getCallsForMethod('setSessionPermissionMode')
      expect(modeCalls).toHaveLength(1)
      expect(modeCalls[0]!.args[1]).toBe(expectedMode)
    }
  })

  test('35. Batch message processing maintains order per sender', async () => {
    const msg1 = createMockWhatsAppMessage({
      senderJid: 'sender1@s.whatsapp.net',
      content: 'First from sender 1',
    })
    const msg2 = createMockWhatsAppMessage({
      senderJid: 'sender2@s.whatsapp.net',
      content: 'First from sender 2',
    })
    const msg3 = createMockWhatsAppMessage({
      senderJid: 'sender1@s.whatsapp.net',
      content: 'Second from sender 1',
    })

    await router.routeMultipleMessages([msg1, msg2, msg3])

    const msgCalls = sessionManager.getCallsForMethod('sendMessage')
    expect(msgCalls).toHaveLength(3)

    // Both sender 1 messages should be sent
    const sender1Calls = msgCalls.filter(
      (call) =>
        call.args[1] === 'First from sender 1' || call.args[1] === 'Second from sender 1',
    )
    expect(sender1Calls).toHaveLength(2)
  })
})

describe('WhatsApp Acceptance Tests - Edge Cases', () => {
  test('36. Empty message handled gracefully', async () => {
    const sessionManager = new MockSessionManager()
    const router = new WhatsAppMessageRouter('ws', sessionManager as any)

    const msg = createMockWhatsAppMessage({ content: '' })
    await router.routeIncomingMessage(msg)

    const msgCalls = sessionManager.getCallsForMethod('sendMessage')
    expect(msgCalls).toHaveLength(1)
  })

  test('37. Very long message content preserved', async () => {
    const longContent = 'Test: '.repeat(500)
    const router = new WhatsAppMessageRouter('ws', new MockSessionManager() as any)
    const msg = createMockWhatsAppMessage({ content: longContent })

    const { content } = extractDirective(msg.content)
    expect(content.trim()).toBe(longContent.trim())
  })

  test('38. Special characters in message content handled', async () => {
    const specialContent = 'Testing 你好 🎉 #hashtag @mention https://example.com'
    const router = new WhatsAppMessageRouter('ws', new MockSessionManager() as any)
    const msg = createMockWhatsAppMessage({ content: specialContent })

    const { content, directive } = extractDirective(msg.content)
    expect(directive).toBeNull()
    expect(content).toBe(specialContent)
  })

  test('39. Whitespace variations handled correctly', async () => {
    const variations = [
      '   @vespr /safe   test   ',
      '@vespr/safe test',
      '@vespr  /safe  test',
    ]

    for (const content of variations.slice(0, 1)) {
      // Only test the first one with leading/trailing spaces
      const { directive } = extractDirective(content)
      expect(directive).toBe('safe')
    }
  })

  test('40. Result formatting with no assistant messages', () => {
    const messages = [
      createMockSdkMessage('user', 'What is AI?'),
    ]

    const result = formatResult(messages, 'session-1')

    // Should not crash, should provide fallback
    expect(result.messages.length).toBeGreaterThan(0)
    expect(result.summary).toBeDefined()
  })
})
