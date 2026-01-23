# WhatsApp Message Routing - Phase 2 Integration Guide

## Overview

The WhatsApp message routing module provides comprehensive integration between WhatsApp groups/chats and Vespr's AI agent system. It handles message ingestion, permission directives, session mapping, result formatting, and persistent message queuing.

This module is part of **Phase 2** of the WhatsApp bot integration and focuses on reliable message routing, session isolation, and graceful error handling.

### Architecture Goals

- **Session Isolation**: Each sender+group combination gets a dedicated isolated Vespr session
- **Permission Control**: Per-message permission directives allow users to control agent behavior inline
- **Reliability**: Persistent message queue ensures no messages are lost across restarts
- **WhatsApp Compliance**: Respects 4096 character message limits with intelligent formatting
- **Security**: Permission defaults to read-only (`safe` mode) for safety

## Module Organization

The WhatsApp integration is organized into five focused modules:

| Module | Purpose |
|--------|---------|
| `types.ts` | Core type definitions for messages, sessions, and formatting |
| `directive-parser.ts` | Extract and parse permission directives from message text |
| `session-mapper.ts` | Create deterministic session IDs from WhatsApp identifiers |
| `message-router.ts` | Route incoming WhatsApp messages to Vespr sessions |
| `result-formatter.ts` | Format agent output for WhatsApp constraints |
| `message-queue.ts` | Persistent, encrypted queue for reliable delivery |

## Key Concepts

### Sessions and Isolation

Each unique combination of (sender, group) receives a dedicated Vespr session. This ensures:

- **Context Preservation**: If a user asks multiple questions in the same group, the agent maintains conversation history
- **User Isolation**: Different senders in the same group don't see each other's conversation history
- **Cross-Group Isolation**: Same sender in different groups gets separate sessions

**Session ID Format**: `whatsapp_{groupJid}::{senderJid}`

Example:
```
groupJid: "123456789-987654321@g.us"
senderJid: "1234567890@s.whatsapp.net"
sessionId: "whatsapp_123456789-987654321@g.us::1234567890@s.whatsapp.net"
```

### Permission Directives

Users can control agent permissions on a per-message basis using inline directives:

```
@vespr /safe research competitors
@vespr /ask run script.sh
@vespr /allow-all deploy to production
```

**Directive Format**: `@vespr /{mode} {message content}`

**Modes**:
- `@vespr /safe` - Read-only mode (no write operations allowed)
- `@vespr /ask` - Ask for approval mode (prompts before executing)
- `@vespr /allow-all` - Auto-approve mode (auto-executes all commands)
- No directive (default) - Falls back to `safe` mode for safety

### WhatsApp Message Structure

Messages received from WhatsApp contain:

```typescript
{
  id: "3EB0D33EFF0CEC06",
  groupJid: "123456789-1234567890@g.us",
  groupName: "Team Discussion",
  senderJid: "1234567890@s.whatsapp.net",
  senderPhoneNumber: "+1234567890",
  senderName: "Alice",
  content: "@vespr /ask run diagnostic.sh",
  timestamp: 1674067200000,
  attachments: [
    {
      fileName: "data.csv",
      mimeType: "text/csv",
      sizeBytes: 2048,
      downloadUrl: "https://..."
    }
  ]
}
```

### Result Formatting

Agent responses are formatted for WhatsApp's 4096 character limit:

- **Small results (≤4096 chars)**: Sent as single message with full formatting
- **Large results (>4096 chars)**: Summary sent with deep link to full session in desktop app
- **Multi-part results**: Intelligently chunked at paragraph boundaries

Deep link format: `vespr://session/{sessionId}`

## API Reference

### directive-parser.ts

Utilities for extracting and validating permission directives from WhatsApp messages.

#### `extractDirective(message: string)`

Parses a message for inline permission directives and returns both the directive and cleaned content.

**Parameters:**
- `message` (string): Raw WhatsApp message text

**Returns:**
```typescript
{
  directive: PermissionDirective  // 'safe' | 'ask' | 'allow-all' | null
  content: string                 // Message content without directive prefix
}
```

**Examples:**
```typescript
// With directive
extractDirective("@vespr /safe research competitors")
// Returns: { directive: 'safe', content: 'research competitors' }

// With allow-all directive
extractDirective("@vespr /allow-all deploy main")
// Returns: { directive: 'allow-all', content: 'deploy main' }

// No directive (defaults to safe)
extractDirective("just ask claude something")
// Returns: { directive: null, content: 'just ask claude something' }

// Case-insensitive
extractDirective("@VESPR /ASK run script")
// Returns: { directive: 'ask', content: 'run script' }
```

#### `hasDirective(message: string): boolean`

Quickly check if a message contains a directive without parsing.

**Example:**
```typescript
if (hasDirective(msg.content)) {
  const { directive } = extractDirective(msg.content)
  console.log(`Message has ${directive} directive`)
}
```

#### `getDirective(message: string): PermissionDirective`

Extract only the directive without the content.

**Example:**
```typescript
const mode = getDirective("@vespr /ask run script")
// Returns: 'ask'
```

#### `type PermissionDirective`

```typescript
type PermissionDirective = 'safe' | 'ask' | 'allow-all' | null
```

### session-mapper.ts

Deterministically map WhatsApp identifiers to Vespr session IDs with persistence.

#### `getSessionId(groupJid: string, senderJid: string): string`

Generate a deterministic session ID from WhatsApp identifiers. Uses a simple composition pattern.

**Parameters:**
- `groupJid` (string): Group JID (e.g., "123-456@g.us")
- `senderJid` (string): Sender JID (e.g., "1234567890@s.whatsapp.net")

**Returns:** Session ID string (e.g., "whatsapp_123-456@g.us::1234567890@s.whatsapp.net")

**Example:**
```typescript
const sessionId = getSessionId(
  "123456789-987654321@g.us",
  "1234567890@s.whatsapp.net"
)
// Returns: "whatsapp_123456789-987654321@g.us::1234567890@s.whatsapp.net"
```

#### `class SessionMapper`

Manages persistent mappings between WhatsApp identifiers and Vespr session IDs.

**Constructor:**
```typescript
constructor(workspacePath: string)
```

**Storage Location:** `{workspacePath}/whatsapp-mappings.json`

**Storage Format:**
```json
[
  {
    "key": "123-456@g.us::1234567890@s.whatsapp.net",
    "sessionId": "whatsapp_123-456@g.us::1234567890@s.whatsapp.net"
  }
]
```

##### `async load(): Promise<void>`

Load persisted mappings from disk. Idempotent (safe to call multiple times).

**Example:**
```typescript
const mapper = new SessionMapper(workspacePath)
await mapper.load() // Loads from whatsapp-mappings.json
```

##### `async getOrCreateSessionId(groupJid: string, senderJid: string): Promise<string>`

Get existing or create new session ID with persistence.

**Behavior:**
- Returns existing session ID if mapping exists
- Creates and persists new mapping if not found
- Guarantees same (groupJid, senderJid) always maps to same sessionId

**Example:**
```typescript
const sessionId = await mapper.getOrCreateSessionId(
  "123-456@g.us",
  "1234567890@s.whatsapp.net"
)
// Creates mapping if new, returns same ID on subsequent calls
```

##### `getSessionId(groupJid: string, senderJid: string): string | null`

Synchronously get session ID if mapping exists (no persistence).

**Returns:** Session ID if mapping exists, `null` otherwise

**Example:**
```typescript
const sessionId = mapper.getSessionId(groupJid, senderJid)
if (!sessionId) {
  console.log("Mapping not yet loaded")
}
```

##### `async save(): Promise<void>`

Explicitly flush mappings to disk (normally automatic).

##### `async clear(): Promise<void>`

Clear all mappings and truncate the mapping file.

### message-router.ts

Route incoming WhatsApp messages to Vespr sessions with directive processing.

#### `class WhatsAppMessageRouter`

Main router class that orchestrates message routing, session creation, and permission mode management.

**Constructor:**
```typescript
constructor(workspaceId: string, sessionManager: SessionManager)
```

**Parameters:**
- `workspaceId` (string): Vespr workspace ID for session creation
- `sessionManager` (SessionManager): Session manager (injected dependency)

##### `async routeIncomingMessage(msg: WhatsAppMessage): Promise<void>`

Main routing method. Processes a WhatsApp message end-to-end.

**Processing Flow:**

1. Extract permission directive from message (e.g., `@vespr /ask`)
2. Generate deterministic session ID from groupJid + senderJid
3. Get or create Vespr session with WhatsApp metadata
4. Apply permission mode override based on directive
5. Send stripped message content to agent (non-blocking)
6. Monitor session for results and delivery

**Permission Mode Mapping:**
- No directive → `'safe'` (read-only, default)
- `@vespr /safe` → `'safe'`
- `@vespr /ask` → `'ask'`
- `@vespr /allow-all` → `'allow-all'`

**Example:**
```typescript
const router = createMessageRouter(workspaceId, sessionManager)

const whatsappMsg = {
  id: "3EB0D33EFF0CEC06",
  groupJid: "123-456@g.us",
  groupName: "Team",
  senderJid: "1234567890@s.whatsapp.net",
  senderPhoneNumber: "+1234567890",
  senderName: "Alice",
  content: "@vespr /ask run backup.sh",
  timestamp: Date.now()
}

await router.routeIncomingMessage(whatsappMsg)
// Automatically:
// 1. Extracts /ask directive
// 2. Creates session "Team / Alice" if needed
// 3. Sets permission mode to 'ask'
// 4. Sends "run backup.sh" to agent
```

**Directive Processing Example:**

User sends: `@vespr /safe research competitors`
- Directive extracted: `'safe'`
- Permission mode set to: `'safe'` (read-only)
- Agent receives: `research competitors`
- Result: Agent can browse web but cannot write files

##### `async routeMultipleMessages(messages: WhatsAppMessage[]): Promise<void>`

Route multiple messages with order preservation per sender.

**Behavior:**
- Messages from same sender routed sequentially (preserves order)
- Messages from different senders routed in parallel
- One error doesn't block other senders

**Example:**
```typescript
const messages = [
  { senderJid: "alice@s.whatsapp.net", content: "First question" },
  { senderJid: "alice@s.whatsapp.net", content: "Second question" },
  { senderJid: "bob@s.whatsapp.net", content: "Another question" }
]

await router.routeMultipleMessages(messages)
// Alice's messages processed sequentially
// Bob's message processed in parallel
```

#### `createMessageRouter(workspaceId: string, sessionManager: SessionManager): WhatsAppMessageRouter`

Factory function to create a message router instance.

**Example:**
```typescript
import { createMessageRouter } from '@vespr/shared/whatsapp'

const router = createMessageRouter(workspaceId, sessionManager)
```

### result-formatter.ts

Format agent output for WhatsApp constraints (4096 char limit).

#### `formatResult(sessionMessages: Message[], sessionId: string, maxChars?: number): FormattedResult`

Convert agent session output to WhatsApp-compatible format.

**Parameters:**
- `sessionMessages` (Message[]): Array of messages from SDK session
- `sessionId` (string): Session ID for deep linking (e.g., "whatsapp_group::sender")
- `maxChars` (number, optional): Max characters per message (default: 4096)

**Returns:**
```typescript
{
  messages: string[]      // Array of WhatsApp messages (each ≤ maxChars)
  summary: string         // One-line summary (~100 chars max)
  fullMarkdown: string    // Complete untruncated result
  truncated: boolean      // True if split across multiple messages
}
```

**Behavior:**
- Extracts all assistant text blocks from session
- Combines with citation sources
- If fits in 4096 chars: returns full message
- If too large: returns summary + deep link to session

**Deep Link Format**: `vespr://session/{sessionId}`

**Example: Small Result**
```typescript
const result = formatResult(messages, sessionId)
// Returns:
// {
//   messages: ["Here's the summary of competitors...\n\nSources:\n[1] https://..."],
//   summary: "Here's the summary of competitors...",
//   truncated: false
// }
```

**Example: Large Result**
```typescript
const result = formatResult(messages, sessionId)
// Returns:
// {
//   messages: [
//     "📱 Research Results\n\nSummary:\nExtensive analysis of 50+ competitors...\n\n" +
//     "🔗 [View full details in Vespr](vespr://session/whatsapp_group::sender)"
//   ],
//   summary: "Extensive analysis of 50+ competitors...",
//   truncated: true
// }
```

#### `chunkForWhatsApp(text: string, maxChars?: number): string[]`

Split large text into WhatsApp-compatible chunks.

**Parameters:**
- `text` (string): Text to split
- `maxChars` (number, optional): Max characters per chunk (default: 4096)

**Returns:** Array of chunks (each ≤ maxChars)

**Chunking Strategy:**
1. Prefer paragraph breaks (`\n\n`)
2. Fall back to line breaks (`\n`)
3. Last resort: split at maxChars

**Example:**
```typescript
const largeText = "Paragraph 1...\n\nParagraph 2...\n\nParagraph 3..."
const chunks = chunkForWhatsApp(largeText, 1000)
// Chunks split at paragraph boundaries to preserve formatting
```

#### `estimateWhatsAppSize(result: FormattedResult): number`

Calculate total character count for a formatted result.

**Example:**
```typescript
const size = estimateWhatsAppSize(result)
if (size > 8192) {
  console.log(`Result will be split across ${result.messages.length} messages`)
}
```

#### `function extractSources(messages: Message[]): string`

Extract URLs/sources from session messages and format as markdown list.

**Returns:** Markdown-formatted source list (empty string if none found)

**Example:**
```
[1] https://example.com
[2] https://research.org
```

#### `function generateOneLiner(text: string, maxLength?: number): string`

Create a one-line summary from text.

**Strategy:**
1. Use first sentence if it fits within maxLength
2. Otherwise truncate at maxLength with ellipsis

### message-queue.ts

Persistent, encrypted message queue for reliable delivery across restarts.

#### `class WhatsAppMessageQueue`

Manages a reliable message queue with disk persistence and automatic recovery.

**Storage Location:** `{workspacePath}/whatsapp-queue.jsonl`

**Storage Format:** Newline-delimited JSON (JSONL)

```
{"id":"3EB0D33EFF0CEC06","groupJid":"123-456@g.us",...}
{"id":"3EB0D33EFF0CEC07","groupJid":"123-456@g.us",...}
```

**Constructor:**
```typescript
constructor(workspacePath: string, credentialManager: any)
```

**Parameters:**
- `workspacePath` (string): Workspace directory path
- `credentialManager` (any): For future encryption integration

##### `async initialize(): Promise<void>`

Initialize the queue and load persisted messages from disk.

**Behavior:**
- Creates workspace directory if needed
- Loads existing queued messages from JSONL file
- Starts periodic flush timer (every 10 seconds)
- Idempotent (safe to call multiple times)

**Example:**
```typescript
const queue = new WhatsAppMessageQueue(workspacePath, credentialManager)
await queue.initialize()

if (await queue.getQueueSize() > 0) {
  console.log(`Recovered ${await queue.getQueueSize()} messages from queue`)
}
```

##### `async enqueue(msg: WhatsAppMessage): Promise<void>`

Add message to queue.

**Behavior:**
- Adds message to in-memory queue
- Auto-flushes to disk when queue reaches 100 items
- Periodic flush every 10 seconds ensures persistence

**Example:**
```typescript
await queue.enqueue(whatsappMessage)
console.log(`Queue size: ${await queue.getQueueSize()}`)
```

##### `async dequeue(): Promise<WhatsAppMessage | null>`

Remove and return next message from queue (FIFO).

**Behavior:**
- Removes message from front of queue
- Immediately flushes to disk to reflect removal
- Ensures no message is lost even on immediate crash

**Example:**
```typescript
const msg = await queue.dequeue()
if (msg) {
  await router.routeIncomingMessage(msg)
}
```

##### `async getQueueSize(): Promise<number>`

Get current queue size without modification.

**Example:**
```typescript
const size = await queue.getQueueSize()
console.log(`${size} messages queued`)
```

##### `async peek(count?: number): Promise<WhatsAppMessage[]>`

Preview next N messages without removing them.

**Parameters:**
- `count` (number, optional): Number of messages to preview (default: 10)

**Returns:** Array of next messages (or fewer if not enough queued)

**Example:**
```typescript
const nextMessages = await queue.peek(5)
nextMessages.forEach(msg => console.log(msg.senderName))
```

##### `async shutdown(): Promise<void>`

Gracefully shutdown the queue.

**Behavior:**
- Stops periodic flush timer
- Performs final flush to disk
- Ensures no messages lost on shutdown
- Idempotent (safe to call multiple times)

**Example:**
```typescript
// On app shutdown
await queue.shutdown()
console.log("Queue flushed and shutdown complete")
```

##### `async clear(): Promise<void>`

Clear entire queue and truncate file.

**Use Cases:**
- GDPR compliance: User requested account deletion
- Disconnect workflow: Removing WhatsApp account

**Example:**
```typescript
// User wants to disconnect from WhatsApp
await queue.clear()
console.log("Queue cleared for workspace")
```

## Type Reference

### WhatsAppMessage

Represents a message received from WhatsApp.

```typescript
interface WhatsAppMessage {
  /** Unique message ID (from Baileys) */
  id: string

  /** Group JID (e.g., "123456789-123456789@g.us") */
  groupJid: string

  /** Human-readable group name (e.g., "Team Discussion") */
  groupName: string

  /** Sender's user JID (e.g., "1234567890@s.whatsapp.net") */
  senderJid: string

  /** Sender's phone number in E.164 format (e.g., "+1234567890") */
  senderPhoneNumber: string

  /** Sender's display name */
  senderName: string

  /** Message text content */
  content: string

  /** Timestamp in milliseconds since epoch */
  timestamp: number

  /** Optional: Array of attachments (images, documents, etc.) */
  attachments?: WhatsAppAttachment[]
}
```

### WhatsAppAttachment

Represents a file attachment in a WhatsApp message.

```typescript
interface WhatsAppAttachment {
  /** File name with extension (e.g., "document.pdf") */
  fileName: string

  /** MIME type (e.g., "application/pdf", "image/jpeg") */
  mimeType: string

  /** File size in bytes */
  sizeBytes: number

  /** Optional: URL for downloading the attachment */
  downloadUrl?: string
}
```

### FormattedResult

Formatted agent output ready for WhatsApp delivery.

```typescript
interface FormattedResult {
  /** Array of messages, each ≤ 4096 chars */
  messages: string[]

  /** One-line summary for chat display */
  summary: string

  /** Full untruncated result in markdown */
  fullMarkdown: string

  /** True if result was split across multiple messages */
  truncated: boolean
}
```

### WhatsAppSession

Stored WhatsApp session state (encrypted in credentials).

```typescript
interface WhatsAppSession {
  /** User's JID from Baileys */
  jid: string

  /** Display name from Baileys */
  pushName: string

  /** Full Baileys session state (opaque) */
  sessionData: unknown

  /** Timestamp when session was created */
  createdAt: number

  /** Timestamp when user last connected */
  connectedAt: number

  /** Whether session has expired */
  isExpired: boolean
}
```

## Usage Examples

### Example 1: Basic Message Routing

```typescript
import { createMessageRouter } from '@vespr/shared/whatsapp'
import { SessionManager } from '../sessions'

// Initialize
const workspaceId = 'workspace-123'
const sessionManager = new SessionManager()
const router = createMessageRouter(workspaceId, sessionManager)

// Receive WhatsApp message
const whatsappMsg = {
  id: '3EB0D33EFF0CEC06',
  groupJid: '123-456@g.us',
  groupName: 'Engineering Team',
  senderJid: '1234567890@s.whatsapp.net',
  senderPhoneNumber: '+1234567890',
  senderName: 'Alice Johnson',
  content: 'What are the system metrics?',
  timestamp: Date.now(),
}

// Route the message
await router.routeIncomingMessage(whatsappMsg)
// Automatically creates session and sends to agent
```

### Example 2: Permission Directive Override

```typescript
// User sends message with permission directive
const msg = {
  ...whatsappMsg,
  content: '@vespr /ask run backup.sh'
}

await router.routeIncomingMessage(msg)
// Extracts /ask directive
// Sets permission mode to 'ask' for this session
// Message content becomes: "run backup.sh"
// Agent will prompt for approval before running bash
```

### Example 3: Result Formatting and Delivery

```typescript
import { formatResult, estimateWhatsAppSize } from '@vespr/shared/whatsapp'

// After agent completes
const sessionId = 'whatsapp_123-456@g.us::1234567890@s.whatsapp.net'
const agentMessages = await sessionManager.getSessionMessages(sessionId)

// Format for WhatsApp
const result = formatResult(agentMessages, sessionId)

console.log(`Result size: ${estimateWhatsAppSize(result)} chars`)
console.log(`Truncated: ${result.truncated}`)

// Send messages back to WhatsApp
for (const message of result.messages) {
  await whatsappClient.sendMessage(groupJid, message)
}
```

### Example 4: Persistent Message Queue

```typescript
import { WhatsAppMessageQueue } from '@vespr/shared/whatsapp'

// Initialize queue
const queue = new WhatsAppMessageQueue(workspacePath, credentialManager)
await queue.initialize()

// On message received
await queue.enqueue(whatsappMsg)

// In message processor loop
async function processQueue() {
  while (true) {
    const msg = await queue.dequeue()
    if (!msg) break

    try {
      await router.routeIncomingMessage(msg)
    } catch (error) {
      // Re-queue on error
      await queue.enqueue(msg)
      await new Promise(r => setTimeout(r, 5000)) // Backoff
    }
  }
}

// On app shutdown
process.on('SIGTERM', async () => {
  await queue.shutdown()
  process.exit(0)
})
```

### Example 5: Session Mapper with Persistence

```typescript
import { SessionMapper, getSessionId } from '@vespr/shared/whatsapp'

// Create mapper
const mapper = new SessionMapper(workspacePath)
await mapper.load()

// Map WhatsApp identifiers to session IDs
const sessionId = await mapper.getOrCreateSessionId(
  '123-456@g.us',
  '1234567890@s.whatsapp.net'
)

// Same identifiers always map to same session ID
const sameId = await mapper.getOrCreateSessionId(
  '123-456@g.us',
  '1234567890@s.whatsapp.net'
)

console.assert(sessionId === sameId) // ✓ True
```

## Architecture Diagram

```
WhatsApp Input (Baileys)
        |
        v
┌─────────────────────┐
│ WhatsApp Service    │ (apps/electron/src/main/whatsapp-service.ts)
└──────────┬──────────┘
           |
           v
┌─────────────────────────────────────────────────┐
│ Message Router (message-router.ts)              │
│                                                 │
│ 1. Extract Directive Parser (directive-parser)  │
│    - Parse @vespr /safe|/ask|/allow-all         │
│    - Return: directive + stripped content       │
│                                                 │
│ 2. Session Mapper (session-mapper)              │
│    - Generate deterministic sessionId           │
│    - Composite key: (groupJid, senderJid)       │
│    - Persist mapping to disk                    │
│                                                 │
│ 3. Permission Mode Override                     │
│    - Map directive → permission mode            │
│    - Apply via SessionManager                   │
│                                                 │
│ 4. Agent Message (stripped content)             │
│    - Send cleaned message to agent              │
│    - Non-blocking execution                     │
└──────────┬────────────────────────────────────┘
           |
           v
┌─────────────────────────────────┐
│ SessionManager                  │
│ (apps/electron/src/main/sessions) │
└──────────┬──────────────────────┘
           |
           v
┌─────────────────────────────────┐
│ VesperAgent (Claude Agent SDK)  │
│ Executes with permission mode   │
└──────────┬──────────────────────┘
           |
           v
┌─────────────────────────────────────────┐
│ Result Formatter (result-formatter.ts)  │
│                                         │
│ 1. Extract Assistant Messages           │
│ 2. Add Sources/Citations                │
│ 3. Size Calculation                     │
│    - If ≤4096 chars: Send as-is         │
│    - If >4096 chars: Summary + deep link│
│ 4. Chunk Large Results                  │
│    - Split at paragraph boundaries      │
│    - Each chunk ≤4096 chars             │
└──────────┬────────────────────────────────┘
           |
           v
┌──────────────────────────────────────┐
│ Message Queue (message-queue.ts)     │
│                                      │
│ 1. Enqueue Formatted Messages        │
│ 2. Persist to Disk (JSONL format)    │
│ 3. Encrypt Credentials (Phase 2b)    │
│ 4. Periodic Flush (10s intervals)    │
│ 5. Automatic Recovery on Restart     │
└──────────┬─────────────────────────────┘
           |
           v
┌────────────────────────────┐
│ Baileys + WhatsApp         │
│ Send to Recipient          │
└────────────────────────────┘
```

## Integration Points

### SessionManager Integration

The message router depends on a SessionManager instance (injected via constructor):

```typescript
interface SessionManager {
  // Create or get session
  getSession(sessionId: string): Promise<Session | null>

  createSession(workspaceId: string, options: {
    name: string
    metadata: Record<string, any>
  }): Promise<Session>

  // Send message to session
  sendMessage(
    sessionId: string,
    content: string,
    attachments?: WhatsAppAttachment[]
  ): Promise<void>

  // Permission control
  setSessionPermissionMode(
    sessionId: string,
    mode: 'safe' | 'ask' | 'allow-all'
  ): Promise<void>

  // Get messages (for formatting)
  getSessionMessages(sessionId: string): Promise<Message[]>
}
```

**Location:** `apps/electron/src/main/sessions.ts`

### WhatsApp Service Integration

The message router is instantiated by the WhatsApp service:

```typescript
// In apps/electron/src/main/whatsapp-service.ts
import { createMessageRouter } from '@vespr/shared/whatsapp'

const router = createMessageRouter(workspaceId, sessionManager)

// When Baileys receives a message
baileys.on('messages.upsert', async (m) => {
  const whatsappMsg = convertBaileysToVesprMessage(m)
  await router.routeIncomingMessage(whatsappMsg)
})
```

### Credential Manager Integration

The message queue uses credential manager for encryption (Phase 2b):

```typescript
// Current: Plaintext JSONL (Phase 2a)
// Future: AES-256-GCM encrypted (Phase 2b)

import { getCredentialManager } from '@vespr/shared/credentials'
const credentialManager = getCredentialManager()
const queue = new WhatsAppMessageQueue(workspacePath, credentialManager)
```

**Location:** `packages/shared/src/credentials/`

### IPC Bridge Integration

Main process communicates with renderer via IPC for session updates:

```typescript
// In main process
ipcMain.handle('session:send-message', async (event, sessionId, content) => {
  await sessionManager.sendMessage(sessionId, content)
})

// In renderer
await window.electronAPI.invoke('session:send-message', sessionId, content)
```

**Location:** `apps/electron/src/main/ipc.ts`

## Security Considerations

### Permission Mode Defaults

The system defaults to `safe` (read-only) mode when no directive is provided:

```typescript
// User sends message without directive
const { directive } = extractDirective("research competitors")
// directive is null → defaults to 'safe' mode

const permissionMode = directive || 'safe'
```

This ensures safe behavior by default.

### Per-Message Permission Control

Directives are evaluated per-message, not globally. Each message can specify its own permission level:

```typescript
// Message 1: Limited permissions
"@vespr /safe what's the budget?"

// Message 2 (from same user, same session): Extended permissions
"@vespr /ask deploy to staging"

// Each message independently controls its permission mode
```

### Session Isolation via Composite Key

Sessions are isolated using a composite key preventing cross-user/group contamination:

```
SessionId = whatsapp_{groupJid}::{senderJid}

Same sender, different groups → Different sessions
Different senders, same group → Different sessions
Same sender, same group → Same session (context preserved)
```

### Queue Encryption

Message queue storage is encrypted (Phase 2b):

**Current (Phase 2a):** Plaintext JSONL at `~/.vespr/workspaces/{id}/whatsapp-queue.jsonl`

**Future (Phase 2b):** AES-256-GCM encrypted via CredentialManager

### GDPR Compliance

Full data deletion workflow:

```typescript
// User requests account deletion
await queue.clear()              // Clear queued messages
await sessionMapper.clear()      // Clear session mappings
await sessionManager.deleteWorkspace(workspaceId)  // Delete sessions
```

## Permission Modes Reference

### Safe Mode (`@vespr /safe`)

Read-only, all write operations blocked.

**Use Case:** Information gathering, research, analysis

```
Message: @vespr /safe analyze competitor pricing

Allowed:
- Browse websites
- Query APIs (read-only)
- Analyze documents

Blocked:
- Run bash commands
- Write files
- Delete data
- Modify systems
```

### Ask Mode (`@vespr /ask`)

Default permission mode. Prompts for approval before write operations.

**Use Case:** Administrative tasks, deployments, system changes

```
Message: @vespr /ask deploy release-1.0

User sees:
⚠️ The agent wants to: Run bash: ./deploy.sh
[Approve] [Deny] [Edit]

If approved → Command executes
If denied → Agent continues without command
```

### Allow-All Mode (`@vespr /allow-all`)

Auto-approves all operations without prompting.

**Use Case:** Trusted automation, batch processing, high-volume operations

```
Message: @vespr /allow-all sync all databases

All commands auto-execute without approval
Use with caution - suitable only for trusted workflows
```

## Best Practices

### 1. Always Quote Directive Commands

For clarity, put directive and command together:

```
✓ GOOD:   @vespr /ask run backup.sh
✗ BAD:    Run backup.sh @vespr /ask
✗ WORSE:  @vespr /ask
          run backup.sh
```

### 2. Use Safe Mode for Public Groups

In groups with untrusted members, stick to safe mode:

```typescript
// Enforce safe mode in public groups
if (isPublicGroup) {
  permissionMode = 'safe'  // Override directive
}
```

### 3. Monitor Queue Size

Check queue health regularly:

```typescript
const size = await queue.getQueueSize()
if (size > 1000) {
  logger.warn(`Queue backlog: ${size} messages`)
}
```

### 4. Graceful Shutdown

Always shutdown gracefully to preserve messages:

```typescript
process.on('SIGTERM', async () => {
  await queue.shutdown()
  await sessionManager.saveAllSessions()
  process.exit(0)
})
```

### 5. Error Handling and Retries

Implement exponential backoff for failed messages:

```typescript
async function processWithRetry(msg, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await router.routeIncomingMessage(msg)
      return
    } catch (error) {
      if (i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000  // Exponential backoff
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
}
```

## Troubleshooting

### Messages Not Being Routed

1. Check if router is initialized: `await router.routeIncomingMessage()`
2. Verify sessionManager dependency is passed correctly
3. Check logs in `~/Library/Logs/Vespr/`

### Queue Growing Indefinitely

1. Verify `dequeue()` is being called in message processor
2. Check if processor is handling errors properly
3. Monitor queue size: `await queue.getQueueSize()`

### Permission Mode Not Applied

1. Verify directive syntax: `@vespr /mode message`
2. Check message is being sent to SessionManager: `sendMessage()`
3. Confirm SessionManager supports `setSessionPermissionMode()`

### Session ID Collisions

This shouldn't happen with composite key approach. If it does:

1. Verify groupJid format: "123-456@g.us"
2. Verify senderJid format: "1234567890@s.whatsapp.net"
3. Check SessionMapper loaded correctly: `await mapper.load()`

## Future Enhancements (Phase 3+)

- Attachment processing and integration with agent tools
- Image OCR for screenshots
- Document parsing for PDFs and spreadsheets
- Encryption of message queue (Phase 2b)
- Rate limiting and quota management
- Message history pruning
- Rich message formatting with buttons/reactions
- Webhook delivery instead of polling

## Summary

The WhatsApp message routing module provides a production-ready integration layer between WhatsApp and Vespr's agent system. It handles message ingestion, permission control, session isolation, result formatting, and reliable delivery through a modular, well-tested architecture.

Key responsibilities:
- **Directive Parsing**: Extract permission overrides from messages
- **Session Mapping**: Deterministic, persistent session IDs
- **Message Routing**: Route messages to appropriate sessions with permission context
- **Result Formatting**: Format agent output for WhatsApp constraints
- **Message Queue**: Reliable delivery across restarts and failures

All modules are independently testable and can be composed into larger workflows.
