# Telegram Integration Improvements Plan

**Date:** 2026-01-25
**Type:** Feature Enhancement
**Status:** Planning
**Priority:** High

## Executive Summary

This plan compares Vesper's current Telegram integration against production-ready patterns from the messaging-integration skill and identifies gaps to address. The current implementation is functional but missing several critical patterns for robustness, security, and multi-account support.

---

## Current Implementation Analysis

### What's Already Implemented ✅

| Pattern | Implementation | Location |
|---------|----------------|----------|
| **Per-Chat Rate Limiting** | Token bucket (5 burst, 0.5/sec) | `telegram-service.ts:73-133` |
| **Global Queue Rate Limiting** | 35ms delay between messages | `telegram-service.ts:14-15` |
| **Message Chunking** | 4096 char limit, paragraph-aware | `result-formatter.ts:266-309` |
| **Deep Link for Large Results** | Preview + vesper:// link for >16KB | `result-formatter.ts:68-95` |
| **Permission Directives** | /safe, /ask, /allow_all parsing | `directive-parser.ts` |
| **Session Mapping** | Deterministic (chatId, userId) → sessionId | `session-mapper.ts` |
| **Error Categorization** | 7 error codes with user-friendly messages | `message-router.ts:51-74` |
| **Credential Encryption** | AES-256-GCM in credentials.enc | Via CredentialManager |
| **Timeout Handling** | 5 minute default | `message-router.ts:24-25` |

### Missing Patterns ❌

| Pattern | Priority | Notes |
|---------|----------|-------|
| **Multi-Account Architecture** | P0 | Only single account per workspace |
| **Message Deduplication** | P0 | No protection against duplicate events |
| **Inbound Debouncing** | P1 | Rapid messages aren't combined |
| **Exponential Backoff/Retry** | P1 | No retry on transient failures |
| **Reconnection Loop** | P1 | No auto-reconnect on disconnect |
| **Access Control Layers** | P2 | No allowlist/DM policy system |
| **Mention Gating** | P2 | No @bot requirement for groups |
| **Echo Tracking** | P2 | Could reply to own messages |
| **Media Handling** | P3 | Attachments deferred (Phase 1) |

---

## Improvement Plan

### Phase 1: Critical Robustness (P0)

#### 1.1 Message Deduplication

**Gap:** No protection against Telegram sending duplicate update events (retries, race conditions).

**Implementation:**

```typescript
// packages/shared/src/telegram/deduplication.ts

const DEDUPE_TTL_MS = 10 * 60_000 // 10 minutes
const MAX_CACHE_SIZE = 2000

export class MessageDeduplicator {
  private seenMessages = new Map<string, number>()

  /**
   * Check if message was already processed
   * @returns true if duplicate (should skip), false if new
   */
  isDuplicate(updateId: number, messageId: number, chatId: number): boolean {
    // Primary key: update_id (unique per Telegram update)
    // Fallback key: chatId:messageId (for edge cases)
    const primaryKey = `update:${updateId}`
    const fallbackKey = `msg:${chatId}:${messageId}`

    const now = Date.now()

    // Check if seen recently
    if (this.checkAndMark(primaryKey, now) || this.checkAndMark(fallbackKey, now)) {
      return true
    }

    // Mark both keys
    this.seenMessages.set(primaryKey, now)
    this.seenMessages.set(fallbackKey, now)

    this.pruneOldEntries(now)
    return false
  }

  private checkAndMark(key: string, now: number): boolean {
    const timestamp = this.seenMessages.get(key)
    if (timestamp && now - timestamp < DEDUPE_TTL_MS) {
      return true // Duplicate
    }
    return false
  }

  private pruneOldEntries(now: number): void {
    if (this.seenMessages.size > MAX_CACHE_SIZE) {
      for (const [key, ts] of this.seenMessages) {
        if (now - ts >= DEDUPE_TTL_MS) {
          this.seenMessages.delete(key)
        }
      }
    }
  }
}
```

**Files to modify:**
- Create: `packages/shared/src/telegram/deduplication.ts`
- Modify: `apps/electron/src/main/telegram-service.ts` (integrate in message handler)

---

#### 1.2 Multi-Account Architecture

**Gap:** Current implementation only supports one bot per workspace. Enterprise users may need multiple bots.

**Implementation:**

```typescript
// packages/shared/src/telegram/types.ts (additions)

export interface TelegramAccountConfig {
  id: string                    // e.g., "default", "support-bot", "alerts-bot"
  enabled: boolean
  name?: string                 // Human-readable name
  tokenSource: 'env' | 'config' | 'tokenFile' | 'none'
  config: {
    accessControl?: AccessControlConfig
    debounceMs?: number
    requireMention?: boolean
  }
}

export interface AccessControlConfig {
  dmPolicy: 'disabled' | 'pairing' | 'allowlist' | 'open'
  groupPolicy: 'disabled' | 'allowlist' | 'open'
  allowedUsers: string[]      // User IDs or "*" for all
  allowedChats: string[]      // Chat IDs or "*" for all
}
```

**Migration path:**
1. Add `accounts` map to workspace config
2. Keep single-account behavior as "default" account
3. Token resolution: account-specific → legacy global → env var (default only)

**Files to modify:**
- Modify: `packages/shared/src/telegram/types.ts`
- Modify: `apps/electron/src/main/telegram-service.ts` (factory pattern)
- Modify: `packages/shared/src/config/storage.ts` (account config schema)

---

### Phase 2: Reliability (P1)

#### 2.1 Inbound Debouncing

**Gap:** Rapid sequential messages from same user create separate sessions/requests.

**Implementation:**

```typescript
// packages/shared/src/telegram/debounce.ts

export interface DebouncedMessage {
  messages: TelegramMessage[]
  combinedContent: string
}

export class InboundDebouncer {
  private buffer = new Map<string, {
    entries: TelegramMessage[]
    timer: NodeJS.Timeout
  }>()

  private debounceMs: number
  private onFlush: (msg: DebouncedMessage) => Promise<void>

  constructor(opts: {
    debounceMs: number  // Recommended: 1500ms
    onFlush: (msg: DebouncedMessage) => Promise<void>
  }) {
    this.debounceMs = opts.debounceMs
    this.onFlush = opts.onFlush
  }

  async add(msg: TelegramMessage): Promise<void> {
    // Don't debounce commands or media
    if (this.shouldSkipDebounce(msg)) {
      await this.onFlush({ messages: [msg], combinedContent: msg.content })
      return
    }

    const key = `${msg.chatId}:${msg.userId}`
    const existing = this.buffer.get(key)

    if (existing) {
      clearTimeout(existing.timer)
      existing.entries.push(msg)
    } else {
      this.buffer.set(key, { entries: [msg], timer: null as any })
    }

    const queue = this.buffer.get(key)!
    queue.timer = setTimeout(async () => {
      this.buffer.delete(key)
      const combined = queue.entries.map(m => m.content).join('\n\n')
      await this.onFlush({
        messages: queue.entries,
        combinedContent: combined
      })
    }, this.debounceMs)
  }

  private shouldSkipDebounce(msg: TelegramMessage): boolean {
    const text = msg.content.trim()
    // Skip debounce for commands
    if (text.startsWith('/')) return true
    // Skip for media (when implemented)
    if (msg.attachments?.length) return true
    return false
  }
}
```

**Files to modify:**
- Create: `packages/shared/src/telegram/debounce.ts`
- Modify: `apps/electron/src/main/telegram-service.ts`

---

#### 2.2 Exponential Backoff with Retry

**Gap:** Message sending fails permanently on first error; no retry logic.

**Implementation:**

```typescript
// packages/shared/src/telegram/retry.ts

export interface BackoffPolicy {
  initialMs: number    // 1000
  maxMs: number        // 30000
  factor: number       // 2
  jitter: number       // 0.25
  maxAttempts: number  // 5
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  initialMs: 1000,
  maxMs: 30000,
  factor: 2,
  jitter: 0.25,
  maxAttempts: 5,
}

export function computeBackoff(policy: BackoffPolicy, attempt: number): number {
  const base = Math.min(
    policy.initialMs * Math.pow(policy.factor, attempt - 1),
    policy.maxMs
  )
  const jitterRange = base * policy.jitter
  const jitter = (Math.random() - 0.5) * 2 * jitterRange
  return Math.max(0, Math.floor(base + jitter))
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  shouldRetry?: (error: unknown) => boolean
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      // Check if we should retry this error
      if (shouldRetry && !shouldRetry(err)) {
        throw err
      }

      if (attempt < policy.maxAttempts) {
        const delay = computeBackoff(policy, attempt)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  throw lastError
}

// Telegram-specific: don't retry 4xx errors (client errors)
export function shouldRetryTelegramError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    // Don't retry client errors
    if (msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('404')) {
      return false
    }
    // Retry rate limits, server errors, network issues
    if (msg.includes('429') || msg.includes('5') || msg.includes('network') || msg.includes('timeout')) {
      return true
    }
  }
  return true // Default: retry
}
```

**Files to modify:**
- Create: `packages/shared/src/telegram/retry.ts`
- Modify: `apps/electron/src/main/telegram-service.ts` (wrap sendMessage)

---

#### 2.3 Reconnection Loop

**Gap:** If polling disconnects (network issue, token revoked), no auto-reconnect.

**Implementation:**

```typescript
// In telegram-service.ts

private async reconnectionLoop(): Promise<void> {
  let attempts = 0
  const healthyThresholdMs = 60_000 // 1 minute uptime = "healthy"
  const maxAttempts = 12

  while (!this.shouldStop) {
    const startedAt = Date.now()

    try {
      await this.startPolling()
      attempts = 0 // Reset on successful connect

      // Wait for disconnect
      await this.waitForDisconnect()
      const uptimeMs = Date.now() - startedAt

      if (uptimeMs > healthyThresholdMs) {
        attempts = 0 // Reset backoff after healthy stretch
      }

      // Check if logged out (token revoked)
      if (this.isTokenRevoked) {
        console.error('Telegram bot token revoked. Manual re-auth required.')
        this.emit('auth-required')
        break
      }
    } catch (err) {
      console.error('Telegram connection error:', err)
    }

    if (this.shouldStop) break

    attempts++
    if (attempts >= maxAttempts) {
      console.error('Max reconnect attempts reached.')
      this.emit('reconnect-failed')
      break
    }

    const delay = computeBackoff(DEFAULT_BACKOFF, attempts)
    console.log(`Reconnecting in ${delay}ms (attempt ${attempts}/${maxAttempts})`)
    await new Promise(r => setTimeout(r, delay))
  }
}
```

**Files to modify:**
- Modify: `apps/electron/src/main/telegram-service.ts`

---

### Phase 3: Access Control (P2)

#### 3.1 Access Control Layers

**Gap:** Any Telegram user can message the bot. No allowlist or DM policy.

**Implementation:**

```typescript
// packages/shared/src/telegram/access-control.ts

export type DMPolicy = 'disabled' | 'pairing' | 'allowlist' | 'open'
export type GroupPolicy = 'disabled' | 'allowlist' | 'open'

export interface AccessCheckResult {
  allowed: boolean
  reason?: string
  pairingCode?: string  // For pairing mode
}

export function checkDMAccess(params: {
  userId: number
  policy: DMPolicy
  allowlist: number[]
}): AccessCheckResult {
  if (params.policy === 'disabled') {
    return { allowed: false, reason: 'DMs are disabled' }
  }
  if (params.policy === 'open') {
    return { allowed: true }
  }

  const isAllowed = params.allowlist.includes(params.userId)

  if (params.policy === 'allowlist') {
    return isAllowed
      ? { allowed: true }
      : { allowed: false, reason: 'You are not authorized to use this bot' }
  }

  if (params.policy === 'pairing') {
    if (isAllowed) return { allowed: true }
    // Generate pairing code for approval flow
    const code = generatePairingCode(params.userId)
    return {
      allowed: false,
      pairingCode: code,
      reason: 'Pairing required. Share this code with the bot owner.'
    }
  }

  return { allowed: false }
}

export function checkGroupAccess(params: {
  chatId: number
  userId: number
  groupPolicy: GroupPolicy
  allowedGroups: number[]
  allowedUsers: number[]
}): AccessCheckResult {
  if (params.groupPolicy === 'disabled') {
    return { allowed: false, reason: 'Group messages are disabled' }
  }
  if (params.groupPolicy === 'open') {
    return { allowed: true }
  }

  // Allowlist: check both group and user
  const groupAllowed = params.allowedGroups.length === 0 ||
                       params.allowedGroups.includes(params.chatId)
  const userAllowed = params.allowedUsers.length === 0 ||
                      params.allowedUsers.includes(params.userId)

  if (!groupAllowed) {
    return { allowed: false, reason: 'This group is not authorized' }
  }
  if (!userAllowed) {
    return { allowed: false, reason: 'You are not authorized in this group' }
  }

  return { allowed: true }
}

function generatePairingCode(userId: number): string {
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `PAIR-${userId.toString().slice(-4)}-${random}`
}
```

**Files to modify:**
- Create: `packages/shared/src/telegram/access-control.ts`
- Modify: `apps/electron/src/main/telegram-service.ts`
- Modify: `apps/electron/src/renderer/components/telegram/TelegramSettingsSection.tsx` (add allowlist UI)

---

#### 3.2 Mention Gating for Groups

**Gap:** Bot responds to all messages in groups, even when not mentioned.

**Implementation:**

```typescript
// packages/shared/src/telegram/mention-gate.ts

export function shouldProcessGroupMessage(params: {
  content: string
  botUsername: string
  requireMention: boolean
  isReplyToBot: boolean
}): boolean {
  // Always process in non-mention mode
  if (!params.requireMention) return true

  // Check if bot was mentioned
  const mentionPattern = new RegExp(`@${params.botUsername}\\b`, 'i')
  if (mentionPattern.test(params.content)) return true

  // Check if this is a reply to the bot
  if (params.isReplyToBot) return true

  // Check if starts with command
  if (params.content.trim().startsWith('/')) return true

  return false
}
```

**Files to modify:**
- Create: `packages/shared/src/telegram/mention-gate.ts`
- Modify: `apps/electron/src/main/telegram-service.ts`
- Modify: `apps/electron/src/renderer/components/telegram/TelegramSettingsSection.tsx` (toggle)

---

#### 3.3 Echo Tracking

**Gap:** Bot could potentially respond to its own messages in edge cases.

**Implementation:**

```typescript
// packages/shared/src/telegram/echo-tracker.ts

export class EchoTracker {
  private sentMessageIds = new Map<number, number>() // messageId → timestamp
  private maxItems = 100
  private ttlMs = 5 * 60_000 // 5 minutes

  track(messageId: number): void {
    this.sentMessageIds.set(messageId, Date.now())

    // Prune if too many
    if (this.sentMessageIds.size > this.maxItems) {
      const oldest = [...this.sentMessageIds.entries()]
        .sort((a, b) => a[1] - b[1])[0]
      this.sentMessageIds.delete(oldest[0])
    }
  }

  isEcho(messageId: number): boolean {
    const timestamp = this.sentMessageIds.get(messageId)
    if (!timestamp) return false

    if (Date.now() - timestamp > this.ttlMs) {
      this.sentMessageIds.delete(messageId)
      return false
    }

    return true
  }
}
```

**Files to modify:**
- Create: `packages/shared/src/telegram/echo-tracker.ts`
- Modify: `apps/electron/src/main/telegram-service.ts`

---

### Phase 4: Enhanced UX (P3)

#### 4.1 Inline Keyboards for Confirmations

**Gap:** Permission confirmations happen via text; could use inline buttons.

**Implementation:** Use Telegram inline keyboards for permission prompts in `ask` mode.

```typescript
// In telegram-service.ts sendMessage enhancement

async sendWithButtons(
  chatId: number,
  text: string,
  buttons?: Array<{ text: string; callbackData: string }>
): Promise<number> {
  const options: TelegramBot.SendMessageOptions = {
    parse_mode: 'Markdown',
  }

  if (buttons?.length) {
    options.reply_markup = {
      inline_keyboard: [
        buttons.map(b => ({
          text: b.text,
          callback_data: b.callbackData
        }))
      ]
    }
  }

  const msg = await this.bot.sendMessage(chatId, text, options)
  return msg.message_id
}
```

---

#### 4.2 Typing Indicator

**Gap:** No visual feedback while agent is processing.

**Implementation:**

```typescript
// Send "typing" action when processing starts
await this.bot.sendChatAction(chatId, 'typing')
```

---

#### 4.3 Reactions for Status

**Gap:** No quick acknowledgment that message was received.

**Implementation:** Use message reactions (Telegram API 7.0+) for status:
- 👀 = Received, processing
- ✅ = Completed
- ❌ = Error

---

## Implementation Order

| Phase | Items | Effort | Dependencies |
|-------|-------|--------|--------------|
| **Phase 1** | Deduplication, Multi-Account | 3-4 days | None |
| **Phase 2** | Debouncing, Retry, Reconnection | 2-3 days | Phase 1 |
| **Phase 3** | Access Control, Mention Gating, Echo Tracking | 2-3 days | Phase 1 |
| **Phase 4** | Inline Keyboards, Typing, Reactions | 1-2 days | Phase 2 |

**Total estimated effort:** 8-12 days

---

## Testing Checklist

- [ ] Deduplication: Send same message twice rapidly → only processed once
- [ ] Multi-account: Configure two bots → both work independently
- [ ] Debouncing: Send 5 messages in 1 second → combined into one request
- [ ] Retry: Simulate network failure → auto-retries with backoff
- [ ] Reconnection: Kill network → auto-reconnects when restored
- [ ] Access control: Unauthorized user → receives rejection message
- [ ] Mention gating: Message without @bot in group → ignored
- [ ] Echo tracking: Bot's own message → not processed as input
- [ ] Typing indicator: Send message → see "typing..." in chat
- [ ] Inline keyboards: Permission prompt → shows Approve/Deny buttons

---

## Files Summary

### New Files
- `packages/shared/src/telegram/deduplication.ts`
- `packages/shared/src/telegram/debounce.ts`
- `packages/shared/src/telegram/retry.ts`
- `packages/shared/src/telegram/access-control.ts`
- `packages/shared/src/telegram/mention-gate.ts`
- `packages/shared/src/telegram/echo-tracker.ts`

### Modified Files
- `packages/shared/src/telegram/types.ts` (multi-account types)
- `packages/shared/src/telegram/index.ts` (new exports)
- `apps/electron/src/main/telegram-service.ts` (integrate all patterns)
- `apps/electron/src/renderer/components/telegram/TelegramSettingsSection.tsx` (access control UI)
- `packages/shared/src/config/storage.ts` (account config schema)

---

## Success Metrics

1. **Reliability:** Zero duplicate message processing
2. **Uptime:** Auto-reconnect success rate >99%
3. **User Experience:** Average typing indicator shown within 500ms of message receipt
4. **Security:** 100% of unauthorized access attempts blocked with clear feedback

---

*Plan created: 2026-01-25*
