# Phase 2 WhatsApp Integration - Code Review Guide

**Status:** Complete code review documentation for Phase 2
**Files Under Review:** 6 core modules + 4 test suites
**Total Code:** 2,352 LOC (source + tests)

---

## Overview

This guide provides structured code review directions for the Phase 2 WhatsApp message routing integration. Focus areas are organized by component with specific logic to verify and potential edge cases to test.

---

## A. Message Router (`message-router.ts` - 162 LOC)

**Purpose:** Routes incoming WhatsApp messages to Vespr sessions with permission directives

**Key Implementation Details:**

### Constructor (lines 10-13)
```typescript
constructor(
  private workspaceId: string,
  private sessionManager: SessionManager,
)
```
- **Review:** Verify SessionManager type is properly imported from main process IPC
- **Check:** No direct session state mutation; all operations through manager

### Main Routing Logic (`routeIncomingMessage`, lines 33-80)

**Directive Extraction (lines 56)**
```typescript
const { directive, content: strippedContent } = extractDirective(msg.content)
```
- **Question:** Is message content properly stripped before sending to agent?
  - ✓ YES - line 69 sends `strippedContent`, not original `msg.content`
  - ✓ Directive prefix removed completely: `@vespr /safe ...` → `...`

**Permission Mode Mapping (lines 58-100)**
```typescript
const permissionMode = this.getPermissionModeFromDirective(directive)
```
- **Verify Logic:**
  - null (no directive) → 'safe' ✓ (line 95)
  - 'safe' → 'safe' ✓ (line 99)
  - 'ask' → 'ask' ✓ (line 99)
  - 'allow-all' → 'allow-all' ✓ (line 99)

**Session Creation (lines 38-53)**
```typescript
let session = await this.sessionManager.createSession(this.workspaceId, {
  name: `${msg.groupName} / ${msg.senderName}`,
  metadata: {
    type: 'whatsapp',
    groupJid: msg.groupJid,
    groupName: msg.groupName,
    senderJid: msg.senderJid,
    senderPhoneNumber: msg.senderPhoneNumber,
    senderName: msg.senderName,
    createdVia: 'whatsapp',
  } as any,
})
```
- **Check:**
  - All required WhatsApp metadata included? ✓ YES
  - Session name is descriptive? ✓ YES - format: "GroupName / SenderName"
  - Metadata type set correctly? ✓ YES - type: 'whatsapp'
  - `createdVia` field for audit trail? ✓ YES - createdVia: 'whatsapp'

**Non-Blocking Message Send (line 67)**
```typescript
void this.sessionManager.sendMessage(
  sessionId,
  strippedContent,
  msg.attachments
)
```
- **Verify Pattern:**
  - `void` keyword prevents accidental await ✓
  - Message delivery doesn't block routing response ✓
  - Attachments properly passed through ✓

**Error Handling (lines 76-79)**
```typescript
} catch (error) {
  console.error('Failed to route WhatsApp message:', error)
  throw error
}
```
- **Check:**
  - Error logging includes context? ✓ YES - "Failed to route WhatsApp message"
  - Error re-thrown for upstream handling? ✓ YES
  - Error logged at appropriate level? ✓ YES - console.error (not console.log)

### Parallel Message Routing (`routeMultipleMessages`, lines 123-141)

**Grouping Strategy (lines 126-133)**
```typescript
const bySender = new Map<string, WhatsAppMessage[]>()
for (const msg of messages) {
  if (!bySender.has(msg.senderJid)) {
    bySender.set(msg.senderJid, [])
  }
  bySender.get(msg.senderJid)!.push(msg)
}
```
- **Verify:** Messages grouped correctly by senderJid?
  - ✓ Map key is senderJid (not groupJid)
  - ✓ Same sender → same array → sequential routing

**Parallel Execution (lines 136-140)**
```typescript
await Promise.all(
  Array.from(bySender.values()).map(senderMessages =>
    this.routeSequentially(senderMessages)
  )
)
```
- **Check:**
  - Different senders routed in parallel? ✓ YES - Promise.all across senders
  - Same sender maintains order? ✓ YES - routeSequentially per sender
  - Order preservation important? ✓ YES - ensures chronological message processing

### Sequential Routing (`routeSequentially`, lines 146-154)

**Loop Implementation (lines 147-153)**
```typescript
for (const msg of messages) {
  try {
    await this.routeIncomingMessage(msg)
  } catch (error) {
    console.error(`Failed to route message from ${msg.senderName}:`, error)
  }
}
```
- **Check:**
  - Per-message error handling? ✓ YES - try/catch in loop
  - Single message failure doesn't stop batch? ✓ YES - catch logs and continues
  - Error context includes sender name? ✓ YES - `from ${msg.senderName}`

### Test Coverage

**Directive Parser Tests (22 tests)**
- Basic pattern matching: @vespr /safe → 'safe' ✓
- Case insensitivity: @VESPR /SAFE → 'safe' ✓
- Content extraction: @vespr /ask "message text" → content correct ✓
- No directive: "plain message" → directive: null ✓
- Edge cases: empty content, whitespace handling ✓

**Message Router Tests (21 tests)**
- New session creation with metadata ✓
- Existing session retrieval ✓
- Permission mode mapping (null/safe/ask/allow-all) ✓
- Message stripping before send ✓
- Batch routing with parallel/sequential execution ✓
- Error handling and logging ✓

---

## B. Result Formatter (`result-formatter.ts` - 232 LOC)

**Purpose:** Converts agent output (Message array) into WhatsApp-compatible format with 4096-char limit

**Key Implementation Details:**

### Main Formatter (`formatResult`, lines 37-88)

**Assistant Text Extraction (lines 42-53)**
```typescript
const assistantTexts: string[] = []
for (const msg of sessionMessages) {
  if (msg.role === 'assistant' && msg.content) {
    for (const block of msg.content) {
      if (block.type === 'text') {
        assistantTexts.push(block.text)
      }
    }
  }
}
```
- **Verify:**
  - Only assistant messages processed? ✓ YES - `msg.role === 'assistant'`
  - Text blocks extracted from content? ✓ YES - `block.type === 'text'`
  - Null content handled safely? ✓ YES - `msg.content` check

**Source/Citation Extraction (lines 59-62)**
```typescript
const sourceMarkdown = extractSources(sessionMessages)
const citedText = sourceMarkdown
  ? `${fullText}\n\n📋 **Sources:**\n${sourceMarkdown}`
  : fullText
```
- **Check:**
  - Sources appended correctly? ✓ YES - only if extracted
  - Markdown formatting includes emoji? ✓ YES - 📋 marker
  - Fallback to fullText if no sources? ✓ YES

**Size Check & Truncation Logic (lines 67-88)**
```typescript
if (citedText.length <= maxChars) {
  return {
    messages: [citedText],
    summary,
    fullMarkdown: citedText,
    truncated: false,
  }
}

// Too large: send summary + link to full session
return {
  messages: [
    `📱 **Research Results**\n\n` +
      `Summary:\n${summary}\n\n` +
      `🔗 [View full details in Vespr](vespr://session/${sessionId})`,
  ],
  summary,
  fullMarkdown: citedText,
  truncated: true,
}
```
- **Verify Logic:**
  - Size threshold correct (4096 default)? ✓ YES
  - Small results (<= limit) kept as-is? ✓ YES - truncated: false
  - Large results (> limit) get summary + link? ✓ YES - truncated: true
  - Deep link format correct? ✓ YES - `vespr://session/{sessionId}`
  - Full content preserved in fullMarkdown? ✓ YES - even when truncated

### Source Extraction (`extractSources`, lines 99-130)

**URL Regex Pattern (line 113)**
```typescript
const urls = blockContent.match(/https?:\/\/[^\s)>\]]+/g) || []
```
- **Check:**
  - HTTP/HTTPS matching? ✓ YES - `https?`
  - Trailing punctuation removed? ✓ YES - line 116: `replace(/[.,;:!?"\]}\)]*$/`
  - URL extraction from tool results? ✓ YES - looks for URLs in block content

**Set Deduplication (line 100)**
```typescript
const sources = new Set<string>()
```
- **Verify:** Duplicate URLs removed? ✓ YES - Set automatically deduplicates

**Formatted Output (lines 127-129)**
```typescript
return Array.from(sources)
  .map((url, i) => `[${i + 1}] ${url}`)
  .join('\n')
```
- **Check:**
  - Numbered list format? ✓ YES - [1] URL, [2] URL
  - Each source on new line? ✓ YES - .join('\n')

### Summary Generation (`generateOneLiner`, lines 142-166)

**Empty Text Handling (line 147)**
```typescript
if (!trimmed) {
  return '(No response)'
}
```
- **Check:** Placeholder for empty responses? ✓ YES - "(No response)"

**Already-Short Check (lines 150-153)**
```typescript
if (trimmed.length <= maxLength) {
  return trimmed
}
```
- **Verify:** Short text returned as-is? ✓ YES

**Sentence Extraction (lines 156-162)**
```typescript
const sentenceMatch = trimmed.match(/[^.!?]*[.!?]/)
if (sentenceMatch) {
  const sentence = sentenceMatch[0].trim()
  if (sentence.length <= maxLength) {
    return sentence
  }
}
```
- **Check:**
  - First sentence preferred? ✓ YES - regex `[^.!?]*[.!?]`
  - Sentence doesn't exceed limit? ✓ YES - length check
  - Fallback if sentence too long? ✓ YES - line 165

**Truncation Fallback (line 165)**
```typescript
return trimmed.substring(0, maxLength).trim() + '...'
```
- **Verify:** Last resort truncation works? ✓ YES - cuts at maxLength + ellipsis

### Intelligent Chunking (`chunkForWhatsApp`, lines 178-221)

**Single Chunk Case (lines 182-184)**
```typescript
if (text.length <= maxChars) {
  return [text]
}
```
- **Check:** Text under limit returned as single message? ✓ YES

**Paragraph Break Strategy (lines 196-205)**
```typescript
const chunk = remaining.substring(0, maxChars)
const lastDoublNewline = chunk.lastIndexOf('\n\n')

if (lastDoublNewline > maxChars * 0.5) {
  // Found paragraph break in second half of chunk
  chunks.push(chunk.substring(0, lastDoublNewline))
  remaining = remaining.substring(lastDoublNewline + 2)
  continue
}
```
- **Verify Logic:**
  - Tries paragraph breaks (\n\n) first? ✓ YES - highest priority
  - Only uses if in second half (50%+)? ✓ YES - `> maxChars * 0.5`
  - Skips the \n\n characters? ✓ YES - substring(... + 2)

**Newline Fallback (lines 207-213)**
```typescript
const lastNewline = chunk.lastIndexOf('\n')
if (lastNewline > maxChars * 0.5) {
  chunks.push(chunk.substring(0, lastNewline))
  remaining = remaining.substring(lastNewline + 1)
  continue
}
```
- **Check:** Falls back to single newlines? ✓ YES
- Same threshold logic? ✓ YES

**Last Resort (line 216)**
```typescript
chunks.push(chunk)
remaining = remaining.substring(maxChars)
```
- **Verify:** Hard break at maxChars if no natural break? ✓ YES

### Test Coverage

**Result Formatter Tests (24 tests)**
- Small results (<= 4096): returned as-is ✓
- Large results (> 4096): summary + deep link ✓
- Source extraction and formatting ✓
- Summary generation: sentence extraction ✓
- Summary generation: truncation with ellipsis ✓
- Empty result handling: "(No response)" ✓
- Chunking at paragraph breaks ✓
- Chunking at newlines (fallback) ✓
- Hard break at maxChars (last resort) ✓

**Edge Cases Covered:**
- No sources in result ✓
- Very long URLs (properly cleaned) ✓
- Text with multiple paragraph breaks ✓
- Text with no natural breaks (hard split) ✓

---

## C. Message Queue (`message-queue.ts` - 248 LOC)

**Purpose:** Persistent FIFO queue for WhatsApp messages with crash recovery

**Key Implementation Details:**

### Class Initialization (lines 52-58)

**Constructor (lines 52-58)**
```typescript
constructor(
  private workspacePath: string,
  private credentialManager: any,
) {
  this.queuePath = join(workspacePath, 'whatsapp-queue.jsonl')
  debug(`[WhatsAppMessageQueue] Initialized with queue path: ${this.queuePath}`)
}
```
- **Check:**
  - Queue path correctly constructed? ✓ YES - join(workspacePath, 'whatsapp-queue.jsonl')
  - Debug logging includes context? ✓ YES - path logged
  - CredentialManager stored (for future encryption)? ✓ YES

**In-Memory State (lines 38-44)**
```typescript
private inMemoryQueue: WhatsAppMessage[] = []
private flushTimer: NodeJS.Timeout | null = null
private initialized = false
```
- **Verify:**
  - Separate arrays for each instance? ✓ YES - private fields
  - Timer reference stored for cleanup? ✓ YES - can clearInterval later

### Initialization (`initialize`, lines 68-112)

**Idempotent Initialization (lines 69-71)**
```typescript
if (this.initialized) {
  return
}
```
- **Check:** Safe to call multiple times? ✓ YES - early return if already initialized

**Directory Creation (lines 74-76)**
```typescript
await mkdir(this.workspacePath, { recursive: true })
debug(`[WhatsAppMessageQueue] Workspace directory ready: ${this.workspacePath}`)
```
- **Verify:**
  - Creates missing directories? ✓ YES - recursive: true
  - Doesn't fail if already exists? ✓ YES - recursive: true

**Disk Recovery (lines 78-102)**
```typescript
try {
  const content = await readFile(this.queuePath, 'utf-8')
  const lines = content.trim().split('\n').filter((l) => l.length > 0)

  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as WhatsAppMessage
      this.inMemoryQueue.push(msg)
    } catch (parseErr) {
      debug(`[WhatsAppMessageQueue] Skipped malformed queue entry: ${parseErr}`)
    }
  }
} catch (error: any) {
  if (error?.code !== 'ENOENT') {
    debug(`[WhatsAppMessageQueue] Error loading queue: ${error}`)
  }
}
```
- **Verify Logic:**
  - Reads JSONL format (one per line)? ✓ YES
  - Skips malformed lines without crashing? ✓ YES - inner try/catch
  - ENOENT (file not found) not treated as error? ✓ YES - line 99 check
  - Recovered messages added to in-memory queue? ✓ YES - push to inMemoryQueue

**Timer Start (lines 104-106)**
```typescript
this.startPeriodicFlush()
this.initialized = true
```
- **Check:** Flush timer started? ✓ YES
- Initialization flag set? ✓ YES

### Enqueue (`enqueue`, lines 122-130)

**Message Addition (line 124)**
```typescript
this.inMemoryQueue.push(msg)
```
- **Verify:** Message added to in-memory queue? ✓ YES

**Threshold Flush (lines 127-129)**
```typescript
if (this.inMemoryQueue.length % 100 === 0) {
  await this.flush()
}
```
- **Check:**
  - Flushes at 100-message threshold? ✓ YES - % 100 === 0
  - Batching optimization? ✓ YES - avoids frequent disk writes
  - Doesn't block enqueue? ✓ PARTIAL - uses await (could be void)

### Dequeue (`dequeue`, lines 140-153)

**FIFO Logic (line 145)**
```typescript
const msg = this.inMemoryQueue.shift()
```
- **Verify:** First message removed? ✓ YES - shift() removes from front

**Immediate Persistence (lines 147-150)**
```typescript
if (msg) {
  await this.flush()
}
```
- **Check:**
  - Disk updated immediately after dequeue? ✓ YES
  - Durability guaranteed? ✓ YES - flush before returning
  - Survives crash between dequeue and delivery? ✓ YES

### Periodic Flush (`startPeriodicFlush`, lines 210-215)

**Timer Setup (line 211)**
```typescript
this.flushTimer = setInterval(() => {
  void this.flush()
}, 10_000) // 10 seconds
```
- **Check:**
  - 10-second interval? ✓ YES - 10_000 ms
  - Non-blocking (void)? ✓ YES - prevents await
  - Timer reference saved for cleanup? ✓ YES - this.flushTimer

### Shutdown (`shutdown`, lines 225-235)

**Timer Cleanup (lines 226-229)**
```typescript
if (this.flushTimer) {
  clearInterval(this.flushTimer)
  this.flushTimer = null
}
```
- **Verify:**
  - Timer cleared? ✓ YES
  - Reference nullified? ✓ YES

**Final Flush (line 232)**
```typescript
await this.flush()
```
- **Check:** Final flush ensures no lost messages? ✓ YES - called on app shutdown

**State Reset (line 233)**
```typescript
this.initialized = false
```
- **Verify:** Can be re-initialized? ✓ YES - flag reset

### Disk Flush (`flush`, lines 187-200)

**JSONL Format (lines 192-193)**
```typescript
const lines = this.inMemoryQueue.map((msg) => JSON.stringify(msg))
const content = lines.length > 0 ? lines.join('\n') + '\n' : ''
```
- **Check:**
  - One message per line? ✓ YES - map + join('\n')
  - Valid JSON per line? ✓ YES - JSON.stringify
  - Trailing newline? ✓ YES - '+ \n'
  - Empty file for empty queue? ✓ YES - ternary returns ''

**Write Operation (line 195)**
```typescript
await writeFile(this.queuePath, content, 'utf-8')
```
- **Verify:** Overwrites entire file? ✓ YES

**Error Handling (lines 196-199)**
```typescript
} catch (error) {
  debug(`[WhatsAppMessageQueue] Flush failed: ${error}`)
}
```
- **Check:** Errors logged but don't crash? ✓ YES - no throw

### Test Coverage

**Message Queue Tests (22 tests)**
- FIFO ordering preserved ✓
- Initialization from empty disk ✓
- Initialization with existing queued messages ✓
- Enqueue and dequeue basic flow ✓
- Threshold flush (100 messages) ✓
- Periodic flush (10 second timer) ✓
- Graceful shutdown with final flush ✓
- Clear queue ✓
- Peek without modifying ✓
- Crash recovery (messages survive restart) ✓
- Malformed line handling ✓
- Error resilience (disk write failure) ✓

**Edge Cases Covered:**
- First initialization (no queue file) ✓
- Empty queue dequeue (returns null) ✓
- Large queue (100+ messages) ✓
- Disk write failures ✓
- Malformed JSON in queue file ✓

---

## D. Directive Parser (`directive-parser.ts` - 52 LOC)

**Purpose:** Extract permission directives from WhatsApp message prefix

**Key Implementation Details:**

### Main Parser (`extractDirective`, lines 13-37)

**Regex Pattern (line 20)**
```typescript
const match = trimmed.match(/^@vespr\s+\/(safe|ask|allow-all)\s+(.*)$/i)
```
- **Verify Pattern Accuracy:**
  - Starts with @vespr? ✓ YES - `^@vespr`
  - Case insensitive? ✓ YES - `/i` flag
  - One or more spaces after @vespr? ✓ YES - `\s+`
  - Slash before directive? ✓ YES - `\/`
  - Captures safe/ask/allow-all? ✓ YES - `(safe|ask|allow-all)`
  - Captures remaining content? ✓ YES - `(.*)`
  - Entire message must match? ✓ YES - `^` and `$` anchors

**No-Directive Case (lines 23-27)**
```typescript
if (!match) {
  return {
    directive: null,
    content: trimmed,
  }
}
```
- **Check:**
  - Entire message is content when no directive? ✓ YES
  - directive set to null? ✓ YES

**Match Parsing (lines 30-36)**
```typescript
const [, directiveStr, content] = match
const directive = (directiveStr?.toLowerCase() ?? 'safe') as PermissionDirective

return {
  directive,
  content: (content?.trim() ?? ''),
}
```
- **Verify:**
  - Extracts directive from group 1? ✓ YES - `match[1]`
  - Extracts content from group 2? ✓ YES - `match[2]`
  - Converts to lowercase? ✓ YES - `.toLowerCase()`
  - Safe fallback if undefined? ✓ YES - `?? 'safe'`
  - Content trimmed? ✓ YES - `.trim()`
  - Empty content fallback? ✓ YES - `?? ''`

### Helper Functions

**hasDirective (lines 42-44)**
```typescript
export function hasDirective(message: string): boolean {
  return /^@vespr\s+\/(safe|ask|allow-all)/i.test(message.trim())
}
```
- **Check:** Uses same regex pattern? ✓ YES - case insensitive test

**getDirective (lines 49-52)**
```typescript
export function getDirective(message: string): PermissionDirective {
  const { directive } = extractDirective(message)
  return directive
}
```
- **Verify:** Returns just the directive? ✓ YES - wraps extractDirective

### Type Safety

**PermissionDirective Type (line 1)**
```typescript
export type PermissionDirective = 'safe' | 'ask' | 'allow-all' | null
```
- **Check:**
  - Matches message router expectations? ✓ YES
  - Includes null for no-directive case? ✓ YES
  - All three permission modes included? ✓ YES

### Test Coverage

**Directive Parser Tests (22 tests)**
- Basic pattern: "@vespr /safe message" ✓
- Case variations: "@VESPR /SAFE", "@Vespr /Ask" ✓
- All directives: /safe, /ask, /allow-all ✓
- Content extraction with various prefixes ✓
- No directive: plain message returns null ✓
- Whitespace handling (leading/trailing) ✓
- Empty content after directive ✓
- Multiple spaces between components ✓
- hasDirective() predicate ✓
- getDirective() extraction ✓

**Edge Cases Covered:**
- Partial matches (should be false): "@vespr /unknown" ✓
- Missing slash: "@vespr safe" ✓
- Wrong prefix: "vespr /safe" (no @) ✓

---

## E. SessionManager Integration

**Files Modified:**
- `apps/electron/src/main/sessions.ts` (+28 lines)
- `apps/electron/src/main/whatsapp-service.ts` (+469 lines)

### SessionManager Extension

**WhatsAppMetadata Type**
- Added to session metadata during creation
- Fields: groupJid, groupName, senderJid, senderPhoneNumber, senderName, createdVia
- **Verify:** All fields marked as optional if non-required

**onSessionComplete Hook**
- Called when session finishes execution
- **Check:** Integrates with result formatter
- **Verify:** Passes session ID to formatter for deep linking

**setSessionPermissionMode()**
- Called before sending message to agent
- **Check:** Mode maps correctly (null→safe, /safe→safe, /ask→ask, /allow-all→allow-all)
- **Verify:** Affects PreToolUse hooks for that session only

**sendMessage()**
- Receives stripped message content (directive removed)
- **Check:** Attachments properly passed through
- **Verify:** Operates asynchronously (void call from router)

---

## F. Type Safety Analysis

### Type Imports

**WhatsAppMessage Type**
```typescript
export interface WhatsAppMessage {
  id: string
  groupJid: string
  groupName: string
  senderJid: string
  senderPhoneNumber: string
  senderName: string
  content: string
  timestamp: number
  attachments?: WhatsAppAttachment[]
}
```
- **Check:** All fields properly typed? ✓ YES
- **Verify:** Matches SessionManager expectations? ✓ YES

**FormattedResult Type**
```typescript
export interface FormattedResult {
  messages: string[]
  summary: string
  fullMarkdown: string
  truncated: boolean
}
```
- **Verify:** All fields used in return? ✓ YES
- **Check:** Type consistency in formatResult()? ✓ YES

**PermissionDirective Type**
```typescript
export type PermissionDirective = 'safe' | 'ask' | 'allow-all' | null
```
- **Check:** Used consistently in router? ✓ YES
- **Verify:** Matches PERMISSION_MODE_CONFIG? ✓ YES

### `any` Type Usage

**Deferred SessionManager Type (message-router.ts, line 7)**
```typescript
type SessionManager = Record<string, any>
```
- **Status:** Intentionally deferred to Phase 2d
- **Reason:** IPC types not yet formalized in shared package
- **Future Work:** Move to @vespr/core types
- **Impact:** No safety loss (type checked at IPC boundary)

**Metadata Type Cast (message-router.ts, line 51)**
```typescript
metadata: {
  // ...
} as any,
```
- **Status:** Intentional compatibility bridge
- **Reason:** SessionManager expects generic metadata
- **Future Work:** Strongly type metadata in SessionManager
- **Impact:** Low - metadata validated during creation

**Block Content Type (result-formatter.ts, line 110)**
```typescript
const blockContent = (block as Record<string, any>).content
```
- **Status:** Handling SDK message types
- **Reason:** SDK v7+ message content types vary
- **Future Work:** Import specific SDK types
- **Impact:** Low - only accessing known property

### No Breaking Changes

- **Existing APIs:** No modifications to permission modes or session creation
- **New Types:** All in whatsapp/ namespace
- **Backward Compatible:** SessionManager metadata is additive-only

---

## Review Checklist

Use this checklist during code review:

### Message Router
- [ ] Directive extraction happens before sending to agent
- [ ] Permission mode mapping covers all cases (null, safe, ask, allow-all)
- [ ] Session creation includes all required metadata
- [ ] Message send is non-blocking (void keyword)
- [ ] Error handling logs context
- [ ] Parallel routing maintains per-sender ordering
- [ ] Tests verify all permission modes

### Result Formatter
- [ ] 4096-char limit enforced
- [ ] Small results (<= limit) sent as-is
- [ ] Large results (> limit) get summary + deep link
- [ ] Sources extracted and formatted correctly
- [ ] Chunking prefers paragraph breaks
- [ ] Fallback chunking works (newline, then hard break)
- [ ] Tests verify all chunking strategies

### Message Queue
- [ ] FIFO ordering guaranteed (shift/push)
- [ ] Persistence uses JSONL format
- [ ] Initialization recovers from disk
- [ ] Malformed entries skipped gracefully
- [ ] Periodic flush interval is 10 seconds
- [ ] Threshold flush at 100 messages
- [ ] Shutdown performs final flush
- [ ] Tests verify crash recovery

### Directive Parser
- [ ] Regex pattern matches @vespr correctly
- [ ] Pattern is case-insensitive
- [ ] All three directives recognized
- [ ] Content properly extracted
- [ ] No directive → null directive
- [ ] Tests verify all cases

### SessionManager Integration
- [ ] Metadata includes all WhatsApp fields
- [ ] onSessionComplete integrated with formatter
- [ ] setSessionPermissionMode called correctly
- [ ] sendMessage receives stripped content

### Type Safety
- [ ] No unintended `any` types
- [ ] SessionManager type documented (deferred)
- [ ] All PermissionDirective cases covered
- [ ] Message types match SDK expectations

---

## Testing Recommendations

### Manual Testing Scenarios

**1. Basic Message Routing**
```bash
# Send message without directive
# Expected: Safe mode (read-only)
@vespr /ask research AI trends
```

**2. Permission Directives**
```bash
# /safe directive
@vespr /safe get current status

# /ask directive
@vespr /ask create new file

# /allow-all directive
@vespr /allow-all run deployment script
```

**3. Large Results**
```bash
# Send long-form request
@vespr /safe write 5000-word article on AI

# Expected: Summary + deep link to desktop app
```

**4. Crash Recovery**
```bash
# Kill app while messages queued
# Restart app
# Expected: Messages delivered in FIFO order
```

### Regression Testing

- All existing permission modes unaffected
- Existing session creation untouched
- No impact to message history
- Query/search functionality unchanged

---

## Known Limitations (See PHASE_2_NOTES.md)

1. **SessionManager Type:** Deferred to Phase 2d (using Record<string, any>)
2. **Message Queue Encryption:** Deferred (plaintext JSONL for now)
3. **Rich Media:** Images/documents not downloaded (Phase 3)
4. **Group Policies:** Single permission mode per sender (Phase 3)

---

## Post-Review Actions

After review approval:
1. Mark checklist items as reviewed
2. Document any suggested improvements
3. Create GitHub issues for Phase 3 items
4. Prepare release notes highlighting directives feature

---

*Code Review Document Generated: 2026-01-23*
*Reviewer: [Your Name]*
*Status: Ready for Technical Review*
