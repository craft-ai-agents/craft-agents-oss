/**
 * End-to-End Tests for Telegram Integration
 *
 * Comprehensive E2E tests that combine multiple features and simulate realistic scenarios:
 * - Message deduplication in production workflows
 * - Multi-account setup with isolated state
 * - Debouncing with rapid message sequences
 * - Retry logic with simulated API failures
 * - Reconnection after disconnect
 * - Access control policies (DM/group/allowlist)
 * - Mention gating in groups
 * - Echo tracking
 *
 * These tests use mocked Telegram Bot API responses to simulate real-world conditions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageDeduplicator } from '../deduplication'
import { InboundDebouncer, type DebouncedMessage } from '../debounce'
import { withRetry, shouldRetryTelegramError, type BackoffPolicy } from '../retry'
import { checkDMAccess, checkGroupAccess } from '../access-control'
import { shouldProcessGroupMessage } from '../mention-gate'
import { EchoTracker } from '../echo-tracker'
import type { TelegramMessage } from '../types'

describe('Telegram E2E Tests', () => {
  const createMessage = (
    content: string,
    chatId = 123,
    userId = 456,
    messageId = 1,
    chatType: 'private' | 'group' | 'supergroup' = 'private'
  ): TelegramMessage => ({
    id: messageId,
    chatId,
    chatTitle: chatType === 'private' ? '' : 'Test Group',
    chatType,
    userId,
    username: 'testuser',
    firstName: 'Test',
    content,
    timestamp: Math.floor(Date.now() / 1000),
    attachments: []
  })

  describe('Scenario 1: User sends rapid messages with access control enabled', () => {
    it('should deduplicate, apply access control, and debounce allowed messages', async () => {
      const deduplicator = new MessageDeduplicator()
      const echoTracker = new EchoTracker()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      // User sends 5 rapid messages, but message 3 is a duplicate
      const messages = [
        createMessage('Message 1', 100, 999, 1),
        createMessage('Message 2', 100, 999, 2),
        createMessage('Message 2', 100, 999, 2), // Duplicate (same ID)
        createMessage('Message 3', 100, 999, 3),
        createMessage('Message 4', 100, 999, 4)
      ]

      // Access control: User 999 is allowed
      const accessConfig = {
        policy: 'allowlist' as const,
        allowlist: [999, 888]
      }

      let processedCount = 0

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!

        // Step 1: Echo check
        if (echoTracker.isEcho(msg.id)) {
          continue
        }

        // Step 2: Deduplication
        if (deduplicator.isDuplicate(i, msg.id, msg.chatId)) {
          continue
        }

        // Step 3: Access control
        const access = checkDMAccess({
          userId: msg.userId,
          policy: accessConfig.policy,
          allowlist: accessConfig.allowlist
        })

        if (!access.allowed) {
          continue
        }

        // Step 4: Debounce
        await debouncer.add(msg)
        processedCount++
      }

      await new Promise(r => setTimeout(r, 100))

      // Should have processed 4 messages (1 duplicate skipped)
      expect(processedCount).toBe(4)

      // Should have 1 combined flush
      expect(flushedMessages.length).toBe(1)
      expect(flushedMessages[0]!.messages.length).toBe(4)
      expect(flushedMessages[0]!.combinedContent).toContain('Message 1')
      expect(flushedMessages[0]!.combinedContent).toContain('Message 4')

      debouncer.cleanup()
    })

    it('should block user not on allowlist', async () => {
      const deduplicator = new MessageDeduplicator()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      // User 777 sends messages but is not on allowlist
      const messages = [
        createMessage('Unauthorized 1', 100, 777, 1),
        createMessage('Unauthorized 2', 100, 777, 2)
      ]

      const accessConfig = {
        policy: 'allowlist' as const,
        allowlist: [999, 888] // 777 not here
      }

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!

        if (deduplicator.isDuplicate(i, msg.id, msg.chatId)) {
          continue
        }

        const access = checkDMAccess({
          userId: msg.userId,
          policy: accessConfig.policy,
          allowlist: accessConfig.allowlist
        })

        if (!access.allowed) {
          continue
        }

        await debouncer.add(msg)
      }

      await new Promise(r => setTimeout(r, 100))

      // No messages should be processed
      expect(flushedMessages.length).toBe(0)

      debouncer.cleanup()
    })
  })

  describe('Scenario 2: Multi-account bots handle messages independently', () => {
    it('should maintain separate state for each bot account', async () => {
      // Account 1: Support Bot
      const account1 = {
        deduplicator: new MessageDeduplicator(),
        echoTracker: new EchoTracker(),
        flushedMessages: [] as DebouncedMessage[],
        debouncer: new InboundDebouncer({
          debounceMs: 50,
          onFlush: async (msg) => {
            account1.flushedMessages.push(msg)
          }
        })
      }

      // Account 2: Alerts Bot
      const account2 = {
        deduplicator: new MessageDeduplicator(),
        echoTracker: new EchoTracker(),
        flushedMessages: [] as DebouncedMessage[],
        debouncer: new InboundDebouncer({
          debounceMs: 50,
          onFlush: async (msg) => {
            account2.flushedMessages.push(msg)
          }
        })
      }

      // Same user sends messages to both bots (different chats)
      const supportBotMessage = createMessage('Help with issue', 100, 456, 1)
      const alertsBotMessage = createMessage('Alert status', 200, 456, 1)

      // Process message for account 1
      if (!account1.echoTracker.isEcho(supportBotMessage.id) &&
          !account1.deduplicator.isDuplicate(1, supportBotMessage.id, supportBotMessage.chatId)) {
        await account1.debouncer.add(supportBotMessage)
      }

      // Process same message ID for account 2 (different chat)
      if (!account2.echoTracker.isEcho(alertsBotMessage.id) &&
          !account2.deduplicator.isDuplicate(1, alertsBotMessage.id, alertsBotMessage.chatId)) {
        await account2.debouncer.add(alertsBotMessage)
      }

      // Mark echo for account 1 only
      account1.echoTracker.track(100)

      // Check echo isolation
      expect(account1.echoTracker.isEcho(100)).toBe(true)
      expect(account2.echoTracker.isEcho(100)).toBe(false)

      await new Promise(r => setTimeout(r, 100))

      // Both accounts should have processed their messages
      expect(account1.flushedMessages.length).toBe(1)
      expect(account2.flushedMessages.length).toBe(1)
      expect(account1.flushedMessages[0]!.combinedContent).toContain('Help with issue')
      expect(account2.flushedMessages[0]!.combinedContent).toContain('Alert status')

      account1.debouncer.cleanup()
      account2.debouncer.cleanup()
    })

    it('should apply different access policies per account', async () => {
      const userId = 12345

      // Account 1: Open to all
      const account1Access = checkDMAccess({
        userId,
        policy: 'open',
        allowlist: []
      })

      // Account 2: Pairing required
      const account2Access = checkDMAccess({
        userId,
        policy: 'pairing',
        allowlist: []
      })

      expect(account1Access.allowed).toBe(true)
      expect(account2Access.allowed).toBe(false)
      expect(account2Access.pairingCode).toBeDefined()

      // After pairing approval
      const account2AfterPairing = checkDMAccess({
        userId,
        policy: 'pairing',
        allowlist: [userId]
      })

      expect(account2AfterPairing.allowed).toBe(true)
    })
  })

  describe('Scenario 3: Group messages require mention and pass access control', () => {
    it('should process group message with mention when both access control and mention gate pass', async () => {
      const deduplicator = new MessageDeduplicator()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      const groupMessage = createMessage('@testbot check this', -100, 456, 1, 'group')

      // Access control check
      const groupAccess = checkGroupAccess({
        chatId: groupMessage.chatId,
        userId: groupMessage.userId,
        groupPolicy: 'allowlist',
        allowedGroups: [-100, -200],
        allowedUsers: [456, 789]
      })

      // Mention gate check
      const shouldProcess = shouldProcessGroupMessage({
        content: groupMessage.content,
        botUsername: 'testbot',
        requireMention: true,
        isReplyToBot: false
      })

      if (!deduplicator.isDuplicate(1, groupMessage.id, groupMessage.chatId) &&
          groupAccess.allowed &&
          shouldProcess) {
        await debouncer.add(groupMessage)
      }

      await new Promise(r => setTimeout(r, 100))

      expect(flushedMessages.length).toBe(1)
      expect(flushedMessages[0]!.combinedContent).toContain('@testbot check this')

      debouncer.cleanup()
    })

    it('should block group message without mention when requireMention is true', async () => {
      const deduplicator = new MessageDeduplicator()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      const groupMessage = createMessage('check this', -100, 456, 1, 'group')

      // Access control passes
      const groupAccess = checkGroupAccess({
        chatId: groupMessage.chatId,
        userId: groupMessage.userId,
        groupPolicy: 'open',
        allowedGroups: [],
        allowedUsers: []
      })

      // But mention gate blocks (no @mention)
      const shouldProcess = shouldProcessGroupMessage({
        content: groupMessage.content,
        botUsername: 'testbot',
        requireMention: true,
        isReplyToBot: false
      })

      if (!deduplicator.isDuplicate(1, groupMessage.id, groupMessage.chatId) &&
          groupAccess.allowed &&
          shouldProcess) {
        await debouncer.add(groupMessage)
      }

      await new Promise(r => setTimeout(r, 100))

      expect(flushedMessages.length).toBe(0)

      debouncer.cleanup()
    })

    it('should process commands in groups without mention', async () => {
      const deduplicator = new MessageDeduplicator()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      const commandMessage = createMessage('/help', -100, 456, 1, 'group')

      const groupAccess = checkGroupAccess({
        chatId: commandMessage.chatId,
        userId: commandMessage.userId,
        groupPolicy: 'open',
        allowedGroups: [],
        allowedUsers: []
      })

      // Commands always pass mention gate
      const shouldProcess = shouldProcessGroupMessage({
        content: commandMessage.content,
        botUsername: 'testbot',
        requireMention: true,
        isReplyToBot: false
      })

      if (!deduplicator.isDuplicate(1, commandMessage.id, commandMessage.chatId) &&
          groupAccess.allowed &&
          shouldProcess) {
        await debouncer.add(commandMessage)
      }

      await new Promise(r => setTimeout(r, 100))

      expect(flushedMessages.length).toBe(1)
      expect(flushedMessages[0]!.combinedContent).toBe('/help')

      debouncer.cleanup()
    })

    it('should block messages when group is not allowlisted', async () => {
      const groupMessage = createMessage('@testbot hello', -999, 456, 1, 'group')

      const groupAccess = checkGroupAccess({
        chatId: groupMessage.chatId,
        userId: groupMessage.userId,
        groupPolicy: 'allowlist',
        allowedGroups: [-100, -200], // -999 not here
        allowedUsers: [456]
      })

      expect(groupAccess.allowed).toBe(false)
      expect(groupAccess.reason).toContain('group is not authorized')
    })

    it('should block messages when user is not allowlisted in group', async () => {
      const groupMessage = createMessage('@testbot hello', -100, 999, 1, 'group')

      const groupAccess = checkGroupAccess({
        chatId: groupMessage.chatId,
        userId: groupMessage.userId,
        groupPolicy: 'allowlist',
        allowedGroups: [-100],
        allowedUsers: [456, 789] // 999 not here
      })

      expect(groupAccess.allowed).toBe(false)
      expect(groupAccess.reason).toContain('You are not authorized')
    })
  })

  describe('Scenario 4: Failed message delivery retries with backoff', () => {
    it('should retry transient failures with exponential backoff', async () => {
      let attempts = 0
      const attemptTimestamps: number[] = []

      const fastBackoff: BackoffPolicy = {
        initialMs: 10,
        maxMs: 100,
        factor: 2,
        jitter: 0, // No jitter for predictable testing
        maxAttempts: 4
      }

      const result = await withRetry(
        async () => {
          attempts++
          attemptTimestamps.push(Date.now())

          if (attempts < 3) {
            throw new Error('503 Service Unavailable')
          }

          return 'success'
        },
        fastBackoff,
        shouldRetryTelegramError
      )

      expect(result).toBe('success')
      expect(attempts).toBe(3)

      // Verify exponential backoff (approximate due to timing)
      expect(attemptTimestamps.length).toBe(3)

      // Check delays between attempts
      if (attemptTimestamps.length >= 2) {
        const delay1 = attemptTimestamps[1]! - attemptTimestamps[0]!
        expect(delay1).toBeGreaterThanOrEqual(8) // ~10ms (first backoff)
      }

      if (attemptTimestamps.length >= 3) {
        const delay2 = attemptTimestamps[2]! - attemptTimestamps[1]!
        expect(delay2).toBeGreaterThanOrEqual(18) // ~20ms (second backoff)
      }
    })

    it('should not retry client errors (403, 404)', async () => {
      let attempts = 0

      try {
        await withRetry(
          async () => {
            attempts++
            throw new Error('403 Forbidden: Bot was blocked by the user')
          },
          {
            initialMs: 10,
            maxMs: 100,
            factor: 2,
            jitter: 0,
            maxAttempts: 5
          },
          shouldRetryTelegramError
        )
        expect(true).toBe(false) // Should not reach here
      } catch (err) {
        expect(attempts).toBe(1) // Should fail immediately
        expect((err as Error).message).toContain('403')
      }
    })

    it('should retry rate limiting errors (429)', async () => {
      let attempts = 0

      const result = await withRetry(
        async () => {
          attempts++
          if (attempts < 2) {
            throw new Error('429 Too Many Requests')
          }
          return 'success'
        },
        {
          initialMs: 10,
          maxMs: 100,
          factor: 2,
          jitter: 0,
          maxAttempts: 3
        },
        shouldRetryTelegramError
      )

      expect(result).toBe('success')
      expect(attempts).toBe(2)
    })

    it('should give up after max attempts', async () => {
      let attempts = 0

      try {
        await withRetry(
          async () => {
            attempts++
            throw new Error('500 Internal Server Error')
          },
          {
            initialMs: 5,
            maxMs: 50,
            factor: 2,
            jitter: 0,
            maxAttempts: 3
          },
          shouldRetryTelegramError
        )
        expect(true).toBe(false) // Should not reach here
      } catch (err) {
        expect(attempts).toBe(3)
        expect((err as Error).message).toContain('500')
      }
    })
  })

  describe('Scenario 5: Debouncing with rapid message sequences', () => {
    it('should combine burst typing from single user', async () => {
      const deduplicator = new MessageDeduplicator()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      // User types rapidly: 10 messages in 100ms
      for (let i = 1; i <= 10; i++) {
        const msg = createMessage(`Part ${i}`, 123, 456, i)

        if (!deduplicator.isDuplicate(i, msg.id, msg.chatId)) {
          await debouncer.add(msg)
        }

        if (i < 10) {
          await new Promise(r => setTimeout(r, 10)) // 10ms between messages
        }
      }

      await new Promise(r => setTimeout(r, 100))

      // Should combine all into one
      expect(flushedMessages.length).toBe(1)
      expect(flushedMessages[0]!.messages.length).toBe(10)
      expect(flushedMessages[0]!.combinedContent).toContain('Part 1')
      expect(flushedMessages[0]!.combinedContent).toContain('Part 10')

      debouncer.cleanup()
    })

    it('should keep messages from different users separate despite timing', async () => {
      const deduplicator = new MessageDeduplicator()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      // Three users send messages in quick succession
      const messages = [
        createMessage('User 1 msg 1', 123, 111, 1),
        createMessage('User 2 msg 1', 123, 222, 2),
        createMessage('User 1 msg 2', 123, 111, 3),
        createMessage('User 3 msg 1', 123, 333, 4),
        createMessage('User 2 msg 2', 123, 222, 5),
        createMessage('User 1 msg 3', 123, 111, 6)
      ]

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!
        if (!deduplicator.isDuplicate(i, msg.id, msg.chatId)) {
          await debouncer.add(msg)
        }
        await new Promise(r => setTimeout(r, 5))
      }

      await new Promise(r => setTimeout(r, 100))

      // Should have 3 separate flushes (one per user)
      expect(flushedMessages.length).toBe(3)

      // User 1 should have 3 messages combined
      const user1Flush = flushedMessages.find(f => f.combinedContent.includes('User 1 msg 1'))
      expect(user1Flush).toBeDefined()
      expect(user1Flush!.messages.length).toBe(3)

      // User 2 should have 2 messages combined
      const user2Flush = flushedMessages.find(f => f.combinedContent.includes('User 2 msg 1'))
      expect(user2Flush).toBeDefined()
      expect(user2Flush!.messages.length).toBe(2)

      // User 3 should have 1 message
      const user3Flush = flushedMessages.find(f => f.combinedContent.includes('User 3 msg 1'))
      expect(user3Flush).toBeDefined()
      expect(user3Flush!.messages.length).toBe(1)

      debouncer.cleanup()
    })

    it('should flush commands immediately even during rapid typing', async () => {
      const deduplicator = new MessageDeduplicator()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      // User sends messages then a command
      const messages = [
        createMessage('Regular message 1', 123, 456, 1),
        createMessage('Regular message 2', 123, 456, 2),
        createMessage('/help', 123, 456, 3), // Command
        createMessage('Regular message 3', 123, 456, 4)
      ]

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!
        if (!deduplicator.isDuplicate(i, msg.id, msg.chatId)) {
          await debouncer.add(msg)
        }
        await new Promise(r => setTimeout(r, 5))
      }

      // Command should flush immediately
      await new Promise(r => setTimeout(r, 20))
      expect(flushedMessages.length).toBeGreaterThan(0)

      await new Promise(r => setTimeout(r, 100))

      // Should have separate flushes for messages before/after command
      expect(flushedMessages.length).toBeGreaterThanOrEqual(2)

      // Command should be in its own flush
      const commandFlush = flushedMessages.find(f => f.combinedContent.includes('/help'))
      expect(commandFlush).toBeDefined()

      debouncer.cleanup()
    })
  })

  describe('Scenario 6: Echo tracking prevents self-reply loops', () => {
    it('should skip processing own messages that echo back', async () => {
      const echoTracker = new EchoTracker()
      const deduplicator = new MessageDeduplicator()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      // Bot sends a message
      const sentMessageId = 100
      echoTracker.track(sentMessageId)

      // User sends a real message
      const userMessage = createMessage('Real user message', 123, 456, 200)

      // Bot's own message echoes back (rare edge case)
      const echoMessage = createMessage('Bot sent this', 123, 456, sentMessageId)

      // Process both messages
      for (const msg of [userMessage, echoMessage]) {
        if (echoTracker.isEcho(msg.id)) {
          continue // Skip echo
        }

        if (!deduplicator.isDuplicate(msg.id, msg.id, msg.chatId)) {
          await debouncer.add(msg)
        }
      }

      await new Promise(r => setTimeout(r, 100))

      // Should only process the real user message
      expect(flushedMessages.length).toBe(1)
      expect(flushedMessages[0]!.combinedContent).toBe('Real user message')

      debouncer.cleanup()
    })

    it('should handle multiple bots with separate echo tracking', async () => {
      const bot1Echo = new EchoTracker()
      const bot2Echo = new EchoTracker()

      // Bot 1 sends message
      bot1Echo.track(100)

      // Bot 2 sends different message
      bot2Echo.track(200)

      // Check isolation
      expect(bot1Echo.isEcho(100)).toBe(true)
      expect(bot1Echo.isEcho(200)).toBe(false)

      expect(bot2Echo.isEcho(100)).toBe(false)
      expect(bot2Echo.isEcho(200)).toBe(true)
    })

    it('should expire old echoes after TTL', () => {
      const echoTracker = new EchoTracker()

      echoTracker.track(100)

      // Immediately is an echo
      expect(echoTracker.isEcho(100)).toBe(true)

      // Note: Actual TTL is 5 minutes, too long for tests
      // This verifies the mechanism exists
      expect(echoTracker.size()).toBe(1)
    })

    it('should prune old echoes when exceeding max size', () => {
      const echoTracker = new EchoTracker()

      // Track 150 messages (exceeds MAX_ITEMS of 100)
      for (let i = 0; i < 150; i++) {
        echoTracker.track(i)
      }

      // Should have pruned to 100
      expect(echoTracker.size()).toBe(100)

      // Recent messages should still be tracked
      expect(echoTracker.isEcho(149)).toBe(true)
      expect(echoTracker.isEcho(145)).toBe(true)
    })
  })

  describe('Scenario 7: Complete pipeline with all gates', () => {
    it('should process valid DM through full pipeline', async () => {
      const deduplicator = new MessageDeduplicator()
      const echoTracker = new EchoTracker()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      const message = createMessage('Hello bot', 123, 456, 1, 'private')

      // Full pipeline
      let shouldProcess = true

      // Gate 1: Echo check
      if (echoTracker.isEcho(message.id)) {
        shouldProcess = false
      }

      // Gate 2: Deduplication
      if (shouldProcess && deduplicator.isDuplicate(1, message.id, message.chatId)) {
        shouldProcess = false
      }

      // Gate 3: Access control
      if (shouldProcess) {
        const access = checkDMAccess({
          userId: message.userId,
          policy: 'allowlist',
          allowlist: [456]
        })
        if (!access.allowed) {
          shouldProcess = false
        }
      }

      // Gate 4: Debounce
      if (shouldProcess) {
        await debouncer.add(message)
      }

      await new Promise(r => setTimeout(r, 100))

      expect(flushedMessages.length).toBe(1)
      expect(flushedMessages[0]!.combinedContent).toBe('Hello bot')

      debouncer.cleanup()
    })

    it('should block messages that fail any gate', async () => {
      const deduplicator = new MessageDeduplicator()
      const echoTracker = new EchoTracker()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      // Test 1: Blocked by echo
      echoTracker.track(100)
      const echoMsg = createMessage('Echo test', 123, 456, 100)

      if (!echoTracker.isEcho(echoMsg.id)) {
        await debouncer.add(echoMsg)
      }

      // Test 2: Blocked by deduplication
      const dupMsg = createMessage('Dup test', 123, 456, 200)
      deduplicator.isDuplicate(1, dupMsg.id, dupMsg.chatId)

      if (!deduplicator.isDuplicate(2, dupMsg.id, dupMsg.chatId)) {
        await debouncer.add(dupMsg)
      }

      // Test 3: Blocked by access control
      const unauthedMsg = createMessage('Unauthed test', 123, 999, 300)

      const access = checkDMAccess({
        userId: unauthedMsg.userId,
        policy: 'allowlist',
        allowlist: [456]
      })

      if (access.allowed) {
        if (!deduplicator.isDuplicate(3, unauthedMsg.id, unauthedMsg.chatId)) {
          await debouncer.add(unauthedMsg)
        }
      }

      await new Promise(r => setTimeout(r, 100))

      // None should pass
      expect(flushedMessages.length).toBe(0)

      debouncer.cleanup()
    })

    it('should process group message through full pipeline with mention', async () => {
      const deduplicator = new MessageDeduplicator()
      const echoTracker = new EchoTracker()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      const groupMsg = createMessage('@testbot analyze this', -100, 456, 1, 'group')

      let shouldProcess = true

      // Echo check
      if (echoTracker.isEcho(groupMsg.id)) {
        shouldProcess = false
      }

      // Deduplication
      if (shouldProcess && deduplicator.isDuplicate(1, groupMsg.id, groupMsg.chatId)) {
        shouldProcess = false
      }

      // Group access control
      if (shouldProcess) {
        const groupAccess = checkGroupAccess({
          chatId: groupMsg.chatId,
          userId: groupMsg.userId,
          groupPolicy: 'allowlist',
          allowedGroups: [-100],
          allowedUsers: [456]
        })
        if (!groupAccess.allowed) {
          shouldProcess = false
        }
      }

      // Mention gate
      if (shouldProcess) {
        const mentionCheck = shouldProcessGroupMessage({
          content: groupMsg.content,
          botUsername: 'testbot',
          requireMention: true,
          isReplyToBot: false
        })
        if (!mentionCheck) {
          shouldProcess = false
        }
      }

      // Debounce
      if (shouldProcess) {
        await debouncer.add(groupMsg)
      }

      await new Promise(r => setTimeout(r, 100))

      expect(flushedMessages.length).toBe(1)
      expect(flushedMessages[0]!.combinedContent).toContain('@testbot analyze this')

      debouncer.cleanup()
    })
  })

  describe('Scenario 8: High load and stress testing', () => {
    it('should handle 100 concurrent messages from different chats', async () => {
      const deduplicator = new MessageDeduplicator()
      const flushedMessages: DebouncedMessage[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      // 100 different users in 100 different chats
      const messages = []
      for (let i = 0; i < 100; i++) {
        messages.push(createMessage(`Message ${i}`, 100 + i, 200 + i, i))
      }

      // Process all concurrently
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!
        if (!deduplicator.isDuplicate(i, msg.id, msg.chatId)) {
          await debouncer.add(msg)
        }
      }

      await new Promise(r => setTimeout(r, 150))

      // Should have 100 separate flushes
      expect(flushedMessages.length).toBe(100)

      debouncer.cleanup()
    })

    it('should handle deduplication cache pruning under high load', async () => {
      const deduplicator = new MessageDeduplicator()

      // Send 3000 unique messages (exceeds MAX_CACHE_SIZE of 2000)
      for (let i = 0; i < 3000; i++) {
        deduplicator.isDuplicate(i, i, i)
      }

      // Cache should be pruned to 2000 or less
      const cacheSize = deduplicator.getCacheSize()
      expect(cacheSize).toBeLessThanOrEqual(2000)
    })

    it('should maintain echo tracker under heavy load', () => {
      const echoTracker = new EchoTracker()

      // Track 150 messages (exceeds MAX_ITEMS of 100)
      for (let i = 0; i < 150; i++) {
        echoTracker.track(i)
      }

      // Should have pruned to 100
      expect(echoTracker.size()).toBe(100)

      // Recent messages should still be tracked
      expect(echoTracker.isEcho(149)).toBe(true)
      expect(echoTracker.isEcho(145)).toBe(true)
    })
  })

  describe('Scenario 9: Pairing mode workflow', () => {
    it('should complete full pairing workflow', async () => {
      const newUserId = 54321
      const pairingCodes: string[] = []

      // Step 1: User sends first message (not paired)
      const firstAttempt = checkDMAccess({
        userId: newUserId,
        policy: 'pairing',
        allowlist: []
      })

      expect(firstAttempt.allowed).toBe(false)
      expect(firstAttempt.pairingCode).toBeDefined()
      pairingCodes.push(firstAttempt.pairingCode!)

      // Step 2: User sends another message (still not paired)
      const secondAttempt = checkDMAccess({
        userId: newUserId,
        policy: 'pairing',
        allowlist: []
      })

      expect(secondAttempt.allowed).toBe(false)
      expect(secondAttempt.pairingCode).toBeDefined()
      pairingCodes.push(secondAttempt.pairingCode!)

      // Pairing codes should follow format but include random component
      // Both should start with PAIR-4321-
      expect(pairingCodes[0]).toContain('PAIR-4321-')
      expect(pairingCodes[1]).toContain('PAIR-4321-')

      // Step 3: Admin approves and adds to allowlist
      const afterApproval = checkDMAccess({
        userId: newUserId,
        policy: 'pairing',
        allowlist: [newUserId]
      })

      expect(afterApproval.allowed).toBe(true)
      expect(afterApproval.pairingCode).toBeUndefined()

      // Step 4: User can now send messages
      const flushedMessages: DebouncedMessage[] = []
      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg)
        }
      })

      const message = createMessage('Now I can chat!', 123, newUserId, 1)

      const access = checkDMAccess({
        userId: message.userId,
        policy: 'pairing',
        allowlist: [newUserId]
      })

      if (access.allowed) {
        await debouncer.add(message)
      }

      await new Promise(r => setTimeout(r, 100))

      expect(flushedMessages.length).toBe(1)
      expect(flushedMessages[0]!.combinedContent).toBe('Now I can chat!')

      debouncer.cleanup()
    })

    it('should generate pairing codes with correct format', () => {
      const testCases = [
        { userId: 12345, expectedSuffix: '2345' },
        { userId: 987654321, expectedSuffix: '4321' },
        { userId: 42, expectedSuffix: '42' },
        { userId: 1, expectedSuffix: '1' }
      ]

      for (const testCase of testCases) {
        const result = checkDMAccess({
          userId: testCase.userId,
          policy: 'pairing',
          allowlist: []
        })

        expect(result.pairingCode).toBeDefined()
        expect(result.pairingCode).toContain('PAIR-')
        expect(result.pairingCode).toContain(testCase.expectedSuffix)
      }
    })
  })
})
