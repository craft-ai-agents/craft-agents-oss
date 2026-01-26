# Vesper API Documentation

Complete API reference for Vesper's IPC handlers, storage systems, and integrations.

## Quick Start

Vesper uses Electron IPC for communication between main and renderer processes. All APIs are accessed via `ipcRenderer.invoke()` calls from the renderer process.

```typescript
import { ipcRenderer } from 'electron';

// Create a session
const session = await ipcRenderer.invoke('sessions:create', workspaceId, {
  permissionMode: 'ask',
  model: 'claude-sonnet-4-20250514'
});

// Send a message (async, results via events)
await ipcRenderer.invoke('sessions:sendMessage', session.id, 'Hello!');

// Listen for responses
ipcRenderer.on('session:event', (event, data) => {
  if (data.type === 'message') {
    console.log('Response:', data.message.content);
  }
});
```

## Core APIs

### [IPC Handlers Reference](./ipc-handlers.md)
Complete reference of all IPC channels with request/response schemas, organized by category.

**Categories:**
- Session Management
- Workspace & Window Management
- File Operations
- Integrations (Slack, Telegram, WhatsApp)
- Task Management
- Configuration & Settings

**Use this when:** You need to find a specific IPC channel or understand the overall API surface.

---

### [Sessions API](./sessions.md)
Manage AI conversation sessions with message history, configuration, and state.

**Key Features:**
- Create/delete sessions
- Send messages (streaming responses)
- Permission modes (safe/ask/allow-all)
- Thinking levels (0-5)
- Session commands (flag, rename, labels, etc.)
- Terminal resume
- File attachments

**Use this when:** Building session-related UI or managing conversations.

---

### [Templates API](./templates.md)
Reusable session configuration presets with optional initial prompts and context gathering.

**Key Features:**
- Global and workspace-scoped templates
- Save sessions as templates
- Initial prompt (pre-filled input)
- Gather context instructions (Claude asks questions)
- Usage tracking (popularity)
- Default starter templates

**Use this when:** Creating repeatable workflows or implementing template pickers.

---

### [Slack Integration API](./slack.md)
OAuth-based Slack integration with Socket Mode for real-time messaging.

**Key Features:**
- OAuth 2.0 authentication
- Socket Mode event listening
- Message routing with permission directives
- Thread context resolution
- Message deduplication
- Session continuity

**Use this when:** Building Slack integration UI or handling Slack messages.

---

### [Telegram Integration API](./telegram.md)
Bot token-based Telegram integration with polling and rate limiting.

**Key Features:**
- Bot token authentication
- Per-chat rate limiting (token bucket)
- Message queue (30 msgs/sec)
- Permission directives (/safe, /ask, /allow_all)
- Large result handling (4096 char limit)
- Session continuity

**Use this when:** Building Telegram integration UI or handling Telegram messages.

---

### [Credentials API](./credentials.md)
Secure credential storage with AES-256-GCM encryption.

**Key Features:**
- AES-256-GCM encryption
- Type-safe credential IDs
- OAuth token management
- Refresh token support
- Expiration tracking
- GDPR compliance (delete on disconnect)

**Use this when:** Storing/retrieving API keys, OAuth tokens, or other sensitive data.

---

## Architecture

### IPC Communication

```
┌─────────────────┐              ┌─────────────────┐
│   Renderer      │              │      Main       │
│   (React UI)    │              │   (Node.js)     │
└─────────────────┘              └─────────────────┘
        │                                │
        │   ipcRenderer.invoke()         │
        ├───────────────────────────────>│
        │                                │
        │   ipcMain.handle()             │
        │   (Request/Response)           │
        │<───────────────────────────────┤
        │                                │
        │   webContents.send()           │
        │   (Broadcast Events)           │
        │<───────────────────────────────┤
```

### Storage Locations

```
~/.vesper/
├── config.json                  # Global configuration
├── credentials.enc              # Encrypted credentials (AES-256-GCM)
├── preferences.json             # User preferences
├── theme.json                   # App theme
├── templates/                   # Global templates
│   └── {id}.json                # Individual template
└── workspaces/{id}/             # Workspace-specific data
    ├── config.json              # Workspace configuration
    ├── sessions/                # Conversation history
    │   └── {sessionId}.jsonl    # JSONL format
    ├── templates/               # Workspace templates
    │   └── {id}.json
    ├── sources/                 # Data sources (MCP servers)
    ├── skills/                  # Agent skills
    └── statuses/                # Workflow statuses
```

### Data Flow

1. **User Interaction** → React component
2. **Component** → `ipcRenderer.invoke()` call
3. **Main Process** → IPC handler execution
4. **Storage/Agent** → Perform operation
5. **Events** → Broadcast to all windows
6. **React** → Update UI via event listeners

---

## Common Patterns

### Request/Response

```typescript
// Simple request/response
const result = await ipcRenderer.invoke('channel:name', param1, param2);
```

### Async Operations with Events

```typescript
// Start async operation
await ipcRenderer.invoke('sessions:sendMessage', sessionId, message);

// Listen for events
ipcRenderer.on('session:event', (event, data) => {
  if (data.sessionId === sessionId) {
    handleEvent(data);
  }
});
```

### Event Cleanup

```typescript
useEffect(() => {
  const handler = (event, data) => {
    // Handle event
  };

  ipcRenderer.on('session:event', handler);

  return () => {
    ipcRenderer.removeListener('session:event', handler);
  };
}, []);
```

### Error Handling

```typescript
try {
  const result = await ipcRenderer.invoke('api:call', params);
  if (!result.success) {
    showError(result.error);
  }
} catch (error) {
  console.error('IPC error:', error);
  showError(error.message);
}
```

---

## Response Formats

### Success/Error Pattern

Many handlers return a consistent format:

```typescript
{
  success: boolean;
  data?: T;
  error?: string;
}
```

### Idempotent Deletes

Delete operations are idempotent (return success even if resource not found):

```typescript
// Always succeeds, even if template doesn't exist
await ipcRenderer.invoke('template:delete', id, scope, workspaceId);
```

### Event-Based Responses

Long-running operations use events instead of blocking:

```typescript
// Returns immediately
await ipcRenderer.invoke('sessions:sendMessage', sessionId, message);

// Results come via events
ipcRenderer.on('session:event', (event, data) => {
  switch (data.type) {
    case 'message': // New message
    case 'thinking': // Agent thinking
    case 'tool': // Tool execution
    case 'complete': // Done
    case 'error': // Error
  }
});
```

---

## Type Definitions

All types are exported from `@vesper/core/types` and `apps/electron/src/shared/types.ts`:

```typescript
import type {
  Session,
  Message,
  SessionTemplate,
  TaskList,
  Task,
  LoadedSkill,
  LoadedSource,
  PermissionMode,
  ThinkingLevel
} from '@vesper/core/types';
```

---

## Testing

### Manual Testing

Use Electron DevTools console:

```javascript
// In renderer DevTools
const { ipcRenderer } = require('electron');

// Test an API call
ipcRenderer.invoke('sessions:get').then(console.log);

// Listen to events
ipcRenderer.on('session:event', console.log);
```

### Automated Testing

```typescript
import { ipcRenderer } from 'electron';

describe('Sessions API', () => {
  it('creates a session', async () => {
    const session = await ipcRenderer.invoke('sessions:create', workspaceId);
    expect(session.id).toBeDefined();
  });
});
```

---

## Security

### Credential Storage

- All credentials encrypted with AES-256-GCM
- Key derivation via PBKDF2 (100,000 iterations)
- No plaintext secrets on disk
- Automatic expiration tracking

### File Path Validation

All file operations validate paths to prevent traversal attacks:

```typescript
// Only allowed directories
const allowedDirs = [
  homedir(),      // User's home directory
  '/tmp',         // Temporary files
  '/var/folders'  // macOS temp
];

// Blocked patterns
const blocked = [
  /\.ssh\//,
  /\.gnupg\//,
  /\.aws\/credentials/,
  /\.env$/
];
```

### Input Sanitization

- File names sanitized to prevent injection
- OAuth state validated for CSRF protection
- Message content escaped for Slack/Telegram

---

## Performance

### Lazy Loading

Sessions are loaded without messages by default:

```typescript
// Fast - no messages
const sessions = await ipcRenderer.invoke('sessions:get');

// Slower - includes all messages
const session = await ipcRenderer.invoke('sessions:getMessages', sessionId);
```

### Batch Operations

Use batch methods for bulk operations when available (e.g., templates, sessions).

### Event Debouncing

Slack/Telegram integrations use debouncing to combine rapid messages:

- **Slack:** 1.5s window
- **Telegram:** Per-chat rate limiting (5 burst, 0.5 tokens/sec)

---

## Migration Guide

### From Direct API to IPC

**Old (Direct API):**
```typescript
import { createSession } from '@vesper/shared/sessions';
const session = createSession(workspaceId, options);
```

**New (IPC):**
```typescript
const session = await ipcRenderer.invoke('sessions:create', workspaceId, options);
```

### From v1 to v2 Templates

**Old:**
```typescript
// Global storage: ~/.vesper/templates/global.json
```

**New:**
```typescript
// Per-template files: ~/.vesper/templates/{id}.json
// Workspace templates: ~/.vesper/workspaces/{id}/templates/{id}.json
```

---

## Related Documentation

- [Main README](../../README.md) - Project overview
- [Developer Guide](../developer/README.md) - Development setup
- [Testing Guide](../testing/README.md) - E2E and unit testing
- [CLAUDE.md](../../CLAUDE.md) - Project instructions for Claude

---

## Support

For questions or issues:

1. Check [GitHub Issues](https://github.com/atherslabs/vesper/issues)
2. Review [Developer Guide](../developer/README.md)
3. Read inline code documentation

---

**Last Updated:** 2026-01-26
