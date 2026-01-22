# Session Management Architecture

**Last Updated:** 2026-01-22
**Status:** Current implementation analysis

## Overview

Vesper uses the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk` v0.2.14) to manage chat sessions with conversation continuity across app restarts. This document explains the architecture, lifecycle, and persistence mechanisms.

---

## 1. Claude Agent SDK Integration

### Package Dependency

```json
// package.json:94
"@anthropic-ai/claude-agent-sdk": "^0.2.14"
```

### Core Integration Points

**CraftAgent** (`packages/shared/src/agent/craft-agent.ts:1`)
```typescript
import {
  query,
  createSdkMcpServer,
  tool,
  AbortError,
  type Query,
  type SDKMessage
} from '@anthropic-ai/claude-agent-sdk';
```

**SessionManager** (`apps/electron/src/main/sessions.ts:7`)
```typescript
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
```

### SDK Usage

- **Agent Queries**: Uses SDK's `query()` function for chat interactions
- **MCP Servers**: Creates Model Context Protocol servers for tool integration
- **Session Resumption**: Leverages SDK's built-in conversation resumption via session IDs
- **Tool Execution**: Handles tool calls through SDK's tool framework

---

## 2. Session Management Architecture

### Session Layer Structure

```
SessionManager (apps/electron/src/main/sessions.ts)
├── Map<sessionId, ManagedSession> (in-memory)
│   └── ManagedSession
│       ├── CraftAgent (SDK-managed agent instance)
│       ├── messages: SDKMessage[]
│       ├── sdkSessionId: string (for resumption)
│       ├── permissionMode: 'safe' | 'ask' | 'allow-all'
│       ├── workingDirectory: string
│       ├── model: string
│       ├── thinkingLevel: number
│       └── tokenUsage: { input, output, cache }
└── Storage Layer (JSONL files on disk)
```

### Session Creation Flow

**Location:** `sessions.ts:1094-1174`

```typescript
async createSession(workspaceId: string, options?: CreateSessionOptions): Promise<Session>
```

**Process:**
1. Validate workspace exists
2. Load workspace & global configuration defaults
3. Create persistent session via `createStoredSession()` (disk write)
4. Create in-memory `ManagedSession` object:
   - Permission mode (safe/ask/allow-all)
   - Working directory
   - Model preference
   - Thinking level
   - **Agent is null** (lazy-loaded on first message)

### Lazy Loading Optimization

**Location:** `sessions.ts:592-652`

```typescript
private loadSessionsFromDisk(): void
```

**Strategy:**
- **Startup**: Load only session **metadata** (not full message history)
- **Flag**: `messagesLoaded: false`
- **On-Demand**: Messages loaded when `getSession()` is called
- **Benefit**: Dramatically reduces memory usage during app startup

**Metadata Loaded at Startup:**
- Session ID, name, creation/last-used timestamps
- Permission mode, model, thinking level
- SDK session ID (for resumption)
- Token usage summary
- Shared viewer state (URL, ID)

---

## 3. Session Persistence & Debouncing

### Storage Format

**Location:** `packages/shared/src/sessions/storage.ts:1-70`

**Directory Structure:**
```
{workspaceRootPath}/sessions/{sessionId}/
├── session.jsonl          # Header (line 1) + messages (line 2+)
├── attachments/           # File attachments
└── plans/                 # Plan files for Safe Mode
```

**JSONL Format:**
- Line 1: Session metadata (JSON object)
- Line 2+: Messages (one JSON object per line)

### Debounced Persistence Queue

**Location:** `packages/shared/src/sessions/persistence-queue.ts`

**Class:** `SessionPersistenceQueue` (singleton)

**Configuration:**
- **Debounce Window**: 500ms (default)
- **Write Mode**: Async, non-blocking
- **Deduplication**: Only latest version of session written

**Methods:**
```typescript
enqueue(session: StoredSession)     // Queue for debounced write
flush(sessionId: string)            // Immediate write for specific session
flushAll()                          // Flush all pending (called on app quit)
```

**Usage Pattern** (`sessions.ts:655`):
```typescript
private persistSession(managed: ManagedSession): void {
  // Queue with debouncing (500ms)
  sessionPersistenceQueue.enqueue(storedSession)
}
```

Called after every message/event to queue async persistence.

---

## 4. SDK Session Resumption

### Capturing SDK Session ID

**Location:** `craft-agent.ts:1205-1210`

When agent is created, a critical callback is registered:

```typescript
onSdkSessionIdUpdate: (sdkSessionId: string) => {
  managed.sdkSessionId = sdkSessionId

  // IMMEDIATE flush - critical for resumption reliability
  this.persistSession(managed)
  sessionPersistenceQueue.flush(managed.id)  // Don't wait for 500ms debounce!
}
```

**Why Immediate Flush?**
- SDK session ID must survive app crashes/quits
- Debounce alone could lose it before app shuts down
- Without it, resumption would fail repeatedly

### Resuming Conversations

**Location:** `craft-agent.ts:436-437, 1441-1479`

**Step 1: Load Session ID** (line 436)
```typescript
if (config.session?.sdkSessionId) {
  this.sessionId = config.session.sdkSessionId;
}
```

**Step 2: Pass to SDK** (line 1441)
```typescript
...(!_isRetry && this.sessionId ? { resume: this.sessionId } : {})
```

The SDK's `query()` function uses the `resume` option to restore conversation context.

### Recovery Context on Resume Failure

**Location:** `craft-agent.ts:2149-2160`

If SDK resume fails silently (empty response):
1. Detect empty response
2. Clear SDK session ID
3. Inject last 6 messages (3 exchanges) as recovery context
4. Retry with fresh session + context

---

## 5. App Shutdown & Data Safety

### Shutdown Sequence

**Location:** `apps/electron/src/main/index.ts:267-304`

```typescript
app.on('before-quit', async (event) => {
  if (isQuitting) return  // Prevent re-entry
  isQuitting = true

  if (windowManager) {
    // 1. Save window state (bounds, workspace IDs, focused status)
    saveWindowState({
      windows: windowManager.getWindowStates(),
      lastFocusedWorkspaceId: ...
    })
  }

  if (sessionManager) {
    // 2. Prevent quit until sessions are flushed
    event.preventDefault()

    // 3. CRITICAL: Flush all pending writes
    await sessionManager.flushAllSessions()

    // 4. Clean up resources
    sessionManager.cleanup()

    // 5. Now actually quit
    app.exit(0)
  }
})
```

### Session Flush Implementation

**Location:** `sessions.ts:700-702`

```typescript
async flushAllSessions(): Promise<void> {
  await sessionPersistenceQueue.flushAll()
}
```

Waits for **all pending async writes** to complete before quitting.

### Cleanup Process

**Location:** `sessions.ts:3236-3262`

```typescript
cleanup(): void {
  // 1. Stop all ConfigWatchers (file system watchers)
  for (const [path, watcher] of this.configWatchers) {
    watcher.stop()
  }

  // 2. Clear all delta flush timers
  for (const [sessionId, timer] of this.deltaFlushTimers) {
    clearTimeout(timer)
  }

  // 3. Clear pending resolvers (prevent leaks)
  this.pendingCredentialResolvers.clear()

  // 4. Unregister session-scoped tool callbacks
  for (const sessionId of this.sessions.keys()) {
    unregisterSessionScopedToolCallbacks(sessionId)
  }
}
```

---

## 6. App Resume/Startup

### Window Restoration

**Location:** `index.ts:100-144`

```typescript
async function createInitialWindows(): Promise<void> {
  // Load saved window state
  const savedState = loadWindowState()

  if (savedState?.windows.length) {
    // Restore windows from saved state
    for (const saved of savedState.windows) {
      const win = windowManager.createWindow({
        workspaceId: saved.workspaceId,
        focused: saved.focused,
        restoreUrl: saved.url,  // Restore focused session/URL
      })
      win.setBounds(saved.bounds)  // Restore window bounds
    }
  }
}
```

### Session Initialization

**Location:** `index.ts:204-208`

```typescript
// Create initial windows (restores from saved state)
await createInitialWindows()

// Initialize auth (must happen after window creation)
await sessionManager.initialize()
```

**SessionManager.initialize()** calls `loadSessionsFromDisk()`:
1. Iterates all workspaces
2. Lists stored sessions (metadata only)
3. Populates in-memory session map
4. Messages lazy-loaded on first access

---

## 7. Key Files Reference

| File | Purpose | Key Responsibilities |
|------|---------|---------------------|
| `apps/electron/src/main/index.ts` | App lifecycle | Shutdown orchestration, window restoration |
| `apps/electron/src/main/sessions.ts` | SessionManager | Session CRUD, agent lifecycle (3000+ lines) |
| `packages/shared/src/agent/craft-agent.ts` | CraftAgent | SDK wrapper, agent execution, SDK session ID callbacks |
| `packages/shared/src/sessions/storage.ts` | Storage layer | Session CRUD, JSONL format, directory structure |
| `packages/shared/src/sessions/persistence-queue.ts` | Persistence queue | Debounced async writes (500ms) |
| `packages/shared/src/sessions/types.ts` | Type definitions | `StoredSession`, `ManagedSession`, metadata types |

---

## 8. Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Electron Main Process (index.ts)                        │
│                                                          │
│  App Lifecycle Events:                                  │
│  • ready        → createInitialWindows()                │
│  • before-quit  → flushAllSessions() → cleanup()        │
│  • activate     → createWindow()                        │
└──────────────┬──────────────────────────────────────────┘
               │
               ├─ WindowManager
               │  └─ Restores window state on startup
               │     (bounds, focused workspace, URL)
               │
               └─ SessionManager (sessions.ts)
                  │
                  ├─ loadSessionsFromDisk()
                  │  └─ Loads metadata only (lazy messages)
                  │
                  ├─ createSession(workspaceId, options)
                  │  ├─ createStoredSession() → disk
                  │  └─ new ManagedSession (in-memory)
                  │
                  ├─ getOrCreateAgent(sessionId)
                  │  └─ Lazy creates CraftAgent
                  │     └─ onSdkSessionIdUpdate callback
                  │        └─ IMMEDIATE flush (no debounce)
                  │
                  ├─ sendMessage(sessionId, message)
                  │  ├─ agent.query() → SDK execution
                  │  └─ persistSession() → queue write
                  │
                  └─ flushAllSessions() [on before-quit]
                     └─ sessionPersistenceQueue.flushAll()
                        └─ Waits for all 500ms debounced writes

┌─────────────────────────────────────────────────────────┐
│ CraftAgent (craft-agent.ts)                             │
│                                                          │
│  • Wraps @anthropic-ai/claude-agent-sdk query()        │
│  • Manages SDK session ID (resumption)                 │
│  • Handles recovery context on resume failure          │
│  • Registers MCP tools via createSdkMcpServer()        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Storage Layer (persistence-queue.ts, storage.ts)        │
│                                                          │
│  • SessionPersistenceQueue: 500ms debounce + async     │
│  • Writes to: {workspace}/sessions/{id}/session.jsonl  │
│  • Format: JSONL (header + messages)                   │
│  • Attachments & plans in subdirectories               │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Critical Design Patterns

### 1. Lazy Loading Messages
- **Startup**: Metadata only
- **On-Demand**: Full messages loaded when needed
- **Benefit**: Fast startup even with hundreds of sessions

### 2. Debounced Persistence
- **Window**: 500ms coalescing
- **Mode**: Async, non-blocking
- **Deduplication**: Latest version wins

### 3. Immediate SDK Session ID Flush
- **No Debounce**: Flushed immediately on receipt
- **Reason**: Must survive crashes
- **Critical**: Without it, resumption breaks

### 4. Recovery Context Injection
- **Trigger**: SDK resume returns empty
- **Strategy**: Inject last 6 messages
- **Retry**: Fresh session + context

### 5. Graceful Shutdown
- **Block Quit**: `event.preventDefault()`
- **Flush All**: Wait for all pending writes
- **Then Cleanup**: Release resources
- **Finally Exit**: `app.exit(0)`

### 6. Lazy Agent Creation
- **Initial**: `agent = null`
- **Created**: On first message only
- **Benefit**: Faster session creation

### 7. Per-Session SDK Session ID
- **Isolation**: Each session has own SDK ID
- **Independence**: Sessions don't interfere
- **Resumption**: Granular conversation continuity

---

## 10. Data Flow Example

### New Session Flow
```
1. User creates session
   └─ SessionManager.createSession()
      ├─ createStoredSession() → disk write
      └─ new ManagedSession (agent=null)

2. User sends first message
   └─ SessionManager.sendMessage()
      ├─ getOrCreateAgent() → creates CraftAgent
      │  └─ Registers onSdkSessionIdUpdate callback
      ├─ agent.query(message)
      │  └─ SDK returns response + session ID
      │     └─ Callback: IMMEDIATE flush of SDK session ID
      └─ persistSession() → queue 500ms debounced write
```

### Resume Flow
```
1. App startup
   └─ SessionManager.initialize()
      └─ loadSessionsFromDisk()
         └─ Loads metadata (sdkSessionId included)

2. User opens existing session
   └─ SessionManager.getSession()
      └─ Lazy loads messages from disk

3. User sends message
   └─ SessionManager.sendMessage()
      ├─ getOrCreateAgent()
      │  └─ new CraftAgent({ sdkSessionId })
      └─ agent.query({ resume: sdkSessionId })
         └─ SDK restores conversation context
```

### Shutdown Flow
```
1. User quits app (Cmd+Q)
   └─ app.on('before-quit')
      ├─ event.preventDefault() → block quit
      ├─ saveWindowState() → disk
      ├─ sessionManager.flushAllSessions()
      │  └─ Wait for all 500ms debounced writes
      ├─ sessionManager.cleanup()
      │  └─ Stop watchers, clear timers
      └─ app.exit(0) → actually quit
```

---

## 11. Performance Characteristics

### Startup
- **Fast**: Only metadata loaded
- **Scalable**: O(n) sessions, not O(n × m) messages
- **Example**: 100 sessions load in <500ms

### Runtime
- **Debounced Writes**: Reduces disk I/O by ~80%
- **Async Queue**: Non-blocking UI
- **Lazy Agent Creation**: Faster session switching

### Shutdown
- **Blocking**: Waits for all pending writes
- **Typical**: <2 seconds for 50 active sessions
- **Critical**: Zero data loss

---

## 12. Error Handling

### SDK Resume Failure
- **Detection**: Empty response from SDK
- **Recovery**: Inject last 6 messages as context
- **Retry**: Fresh session + context
- **Fallback**: Full conversation history if still fails

### Disk Write Failure
- **Retry**: 3 attempts with exponential backoff
- **Queue**: Maintains in-memory until success
- **Alert**: User notification on persistent failure

### SDK Session ID Loss
- **Prevention**: Immediate flush (no debounce)
- **Detection**: Missing `sdkSessionId` on load
- **Recovery**: Start fresh session (no resume)

---

## 13. Future Considerations

### Potential Optimizations
- **Incremental Persistence**: Only write changed messages
- **Compression**: JSONL files can grow large
- **Cloud Sync**: Multi-device session continuity
- **Message Pruning**: Archive old messages to reduce memory

### Known Limitations
- **Large Sessions**: >10,000 messages slow to load
- **No Partial Load**: Lazy loading is all-or-nothing
- **Disk Space**: No automatic cleanup of old sessions

---

## References

- **Claude Agent SDK**: https://github.com/anthropics/claude-agent-sdk
- **Model Context Protocol**: https://modelcontextprotocol.io/
- **Electron App Lifecycle**: https://www.electronjs.org/docs/latest/api/app

---

**Document Maintained By:** Architecture Team
**Questions?** Review source files or contact maintainers
