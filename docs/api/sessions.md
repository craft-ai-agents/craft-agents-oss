# Sessions API

Sessions represent individual conversations with the AI agent. Each session maintains its own message history, configuration, and state.

## Storage

- **Location:** `~/.vesper/workspaces/{workspace}/sessions/{sessionId}.jsonl`
- **Format:** JSONL (JSON Lines) for incremental writes
- **Attachments:** `~/.vesper/workspaces/{workspace}/sessions/{sessionId}/attachments/`

## Data Types

### Session

```typescript
interface Session {
  id: string;                        // YYMMDD-word-word format
  workspaceId: string;
  name: string;
  permissionMode: PermissionMode;     // 'safe' | 'ask' | 'allow-all'
  model: string;
  thinkingLevel: ThinkingLevel;       // 'off' | 'think' | 'max'
  workingDirectory?: string;
  skills?: LoadedSkill[];
  sources?: LoadedSource[];
  messages: Message[];
  createdAt: number;
  updatedAt: number;

  // State flags
  isFlagged: boolean;
  isUnread: boolean;
  todoState?: TodoState;              // Dynamic status ID

  // Runtime state
  isProcessing: boolean;
  sdkSessionId?: string;              // Claude SDK session ID
  sdkCwd?: string;                    // Current working directory from SDK

  // Session continuity (Slack/Telegram)
  metadata?: SessionMetadata;
}
```

### Message

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: StoredAttachment[];
  timestamp: number;
  isIntermediate?: boolean;           // Streaming updates
  tokenUsage?: TokenUsage;
}
```

### CreateSessionOptions

```typescript
interface CreateSessionOptions {
  name?: string;
  permissionMode?: PermissionMode;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  workingDirectory?: string;
  sourceIds?: string[];
  skillIds?: string[];
  taskListId?: string;
  metadata?: SessionMetadata;
}
```

## IPC Handlers

### `sessions:get`

Get all sessions (summary view without messages).

**Request:**
```typescript
// No parameters
```

**Response:**
```typescript
Session[]  // Without messages array (lazy loading)
```

**Example:**
```typescript
const sessions = await ipcRenderer.invoke('sessions:get');
// [{ id: '...', name: 'Chat 1', messages: [], ... }]
```

---

### `sessions:getMessages`

Get a single session with full message history.

**Request:**
```typescript
{
  sessionId: string;
}
```

**Response:**
```typescript
Session  // With complete messages array
```

**Example:**
```typescript
const session = await ipcRenderer.invoke('sessions:getMessages', sessionId);
console.log('Messages:', session.messages.length);
```

---

### `sessions:create`

Create a new session.

**Request:**
```typescript
{
  workspaceId: string;
  options?: CreateSessionOptions;
}
```

**Response:**
```typescript
Session
```

**Example:**
```typescript
const session = await ipcRenderer.invoke('sessions:create', workspaceId, {
  name: 'Code Review',
  permissionMode: 'ask',
  workingDirectory: '/Users/user/project',
  skillIds: ['review-pr'],
  taskListId: 'task-list-1'
});
```

---

### `sessions:delete`

Delete a session.

**Request:**
```typescript
{
  sessionId: string;
}
```

**Response:**
```typescript
void
```

**Example:**
```typescript
await ipcRenderer.invoke('sessions:delete', sessionId);
```

---

### `sessions:sendMessage`

Send a message to a session (non-blocking, results via events).

**Request:**
```typescript
{
  sessionId: string;
  message: string;
  attachments?: FileAttachment[];
  storedAttachments?: StoredAttachment[];
  options?: SendMessageOptions;
}
```

**Response:**
```typescript
{ started: boolean }  // Returns immediately
```

**Example:**
```typescript
const result = await ipcRenderer.invoke('sessions:sendMessage', sessionId, 'Hello!');
// Listen for events via 'session:event' channel
```

**Events:**
- `session:event` with type: `message`, `thinking`, `tool`, `complete`, `error`

---

### `sessions:cancel`

Cancel ongoing processing.

**Request:**
```typescript
{
  sessionId: string;
  silent?: boolean;  // Don't show cancellation message
}
```

**Response:**
```typescript
void
```

**Example:**
```typescript
await ipcRenderer.invoke('sessions:cancel', sessionId);
```

---

### `sessions:killShell`

Kill a background shell process.

**Request:**
```typescript
{
  sessionId: string;
  shellId: string;
}
```

**Response:**
```typescript
void
```

**Example:**
```typescript
await ipcRenderer.invoke('sessions:killShell', sessionId, 'shell-123');
```

---

### `sessions:respondToPermission`

Respond to a permission request (bash command approval).

**Request:**
```typescript
{
  sessionId: string;
  requestId: string;
  allowed: boolean;
  alwaysAllow: boolean;
}
```

**Response:**
```typescript
boolean  // true if delivered, false if session gone
```

**Example:**
```typescript
const delivered = await ipcRenderer.invoke('sessions:respondToPermission',
  sessionId, requestId, true, false);
```

---

### `sessions:respondToCredential`

Respond to a credential request (secure auth input).

**Request:**
```typescript
{
  sessionId: string;
  requestId: string;
  response: CredentialResponse;
}
```

**Response:**
```typescript
boolean  // true if delivered, false if session gone
```

**Example:**
```typescript
await ipcRenderer.invoke('sessions:respondToCredential', sessionId, requestId, {
  type: 'credential',
  value: 'api-key-here',
  cancelled: false
});
```

---

### `sessions:resumeInTerminal`

Resume session in external terminal (spawns terminal with SDK session).

**Request:**
```typescript
{
  sessionId: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  error?: string;
}
```

**Example:**
```typescript
const result = await ipcRenderer.invoke('sessions:resumeInTerminal', sessionId);
if (!result.success) {
  console.error(result.error);
}
```

**Requirements:**
- Session must have SDK session ID (send at least one message first)
- Session must have working directory configured

---

### `sessions:command`

Unified handler for session operations.

**Request:**
```typescript
{
  sessionId: string;
  command: SessionCommand;
}
```

**SessionCommand Types:**
```typescript
type SessionCommand =
  | { type: 'flag' }
  | { type: 'unflag' }
  | { type: 'rename', name: string }
  | { type: 'setTodoState', state: TodoState }
  | { type: 'markRead' }
  | { type: 'markUnread' }
  | { type: 'setPermissionMode', mode: PermissionMode }
  | { type: 'setThinkingLevel', level: ThinkingLevel }
  | { type: 'setModel', model: string }
  | { type: 'setWorkingDirectory', directory: string }
  | { type: 'addSkill', skillId: string }
  | { type: 'removeSkill', skillId: string }
  | { type: 'addSource', sourceId: string }
  | { type: 'removeSource', sourceId: string }
  | { type: 'setLabels', labelIds: string[] }
  | { type: 'addLabel', labelId: string }
  | { type: 'removeLabel', labelId: string };
```

**Example:**
```typescript
// Flag a session
await ipcRenderer.invoke('sessions:command', sessionId, { type: 'flag' });

// Rename a session
await ipcRenderer.invoke('sessions:command', sessionId, {
  type: 'rename',
  name: 'New Name'
});

// Set permission mode
await ipcRenderer.invoke('sessions:command', sessionId, {
  type: 'setPermissionMode',
  mode: 'allow-all'
});
```

---

### `sessions:getFiles`

Get files in session directory.

**Request:**
```typescript
{
  sessionId: string;
}
```

**Response:**
```typescript
SessionFile[]  // Recursive tree structure
```

**Example:**
```typescript
const files = await ipcRenderer.invoke('sessions:getFiles', sessionId);
```

---

### `sessions:getNotes`

Get session notes.

**Request:**
```typescript
{
  sessionId: string;
}
```

**Response:**
```typescript
string  // Markdown content
```

---

### `sessions:setNotes`

Set session notes.

**Request:**
```typescript
{
  sessionId: string;
  notes: string;
}
```

**Response:**
```typescript
void
```

---

### `sessions:watchFiles`

Start watching session directory for file changes.

**Request:**
```typescript
{
  sessionId: string;
}
```

**Response:**
```typescript
void
```

**Events:**
- `sessions:filesChanged` when files change

---

### `sessions:unwatchFiles`

Stop watching session directory.

**Request:**
```typescript
{
  sessionId: string;
}
```

**Response:**
```typescript
void
```

---

### `tasks:getOutput`

Get output from background task.

**Request:**
```typescript
{
  taskId: string;
}
```

**Response:**
```typescript
string  // Task output
```

---

## Events

### `session:event`

Streamed session events during message processing.

**Event Types:**

#### `message` - New message added
```typescript
{
  type: 'message';
  sessionId: string;
  message: Message;
}
```

#### `thinking` - Agent thinking update
```typescript
{
  type: 'thinking';
  sessionId: string;
  thinking: string;
}
```

#### `tool` - Tool execution update
```typescript
{
  type: 'tool';
  sessionId: string;
  toolName: string;
  toolInput: any;
  toolOutput?: any;
}
```

#### `complete` - Processing complete
```typescript
{
  type: 'complete';
  sessionId: string;
}
```

#### `error` - Error occurred
```typescript
{
  type: 'error';
  sessionId: string;
  error: string;
}
```

**Usage:**
```typescript
ipcRenderer.on('session:event', (event, data) => {
  switch (data.type) {
    case 'message':
      addMessage(data.message);
      break;
    case 'thinking':
      updateThinking(data.thinking);
      break;
    case 'complete':
      setProcessing(false);
      break;
    case 'error':
      showError(data.error);
      break;
  }
});
```

---

### `sessions:filesChanged`

Broadcast when session directory files change.

**Payload:**
```typescript
{
  sessionId: string;
  files: SessionFile[];
}
```

---

## Permission Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `safe` | Read-only, blocks all write operations | Exploring unknown codebases |
| `ask` | Prompts for approval on write operations | Default, balanced approach |
| `allow-all` | Auto-approves all operations | Trusted workflows, automation |

**Keyboard Shortcut:** `SHIFT+TAB` to cycle through modes

---

## Thinking Levels

| Level | Description | Tokens |
|-------|-------------|--------|
| `off` | No extended thinking | 0 |
| `think` | Standard extended thinking | ~10K |
| `max` | Maximum extended thinking | ~100K |

---

## Session ID Format

Vesper uses human-readable session IDs:

**Format:** `YYMMDD-word-word[-N]`

**Examples:**
- `260111-swift-river`
- `260125-quiet-dawn`
- `260125-quiet-dawn-2` (collision handling)

**Legacy:** UUID format also supported for backwards compatibility

---

## Best Practices

1. **Lazy loading** - Use `sessions:get` for lists, `sessions:getMessages` for details
2. **Event-driven** - Listen to `session:event` for real-time updates
3. **Permission modes** - Start with `ask`, escalate to `allow-all` for trusted workflows
4. **Working directory** - Set for file operations to work correctly
5. **Skills** - Add skills for specialized capabilities
6. **Task lists** - Associate with task list for structured feature development
7. **Labels** - Use for organization and filtering
8. **Session notes** - Document context and decisions
