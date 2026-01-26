# Telegram Integration API

Telegram bot integration with in-process polling, permission directives, and session continuity.

## Features

- Bot token authentication (encrypted storage)
- Per-chat rate limiting (token bucket: 5 burst, 0.5 tokens/sec)
- Message queue for global rate limiting (30 msgs/sec)
- Permission directives (`/safe`, `/ask`, `/allow_all`)
- Large result handling (4096 char limit with chunking)
- Session continuity (same chat+user = same session)

## Storage

- **Credentials:** Encrypted via CredentialManager (type: `telegram_bot_token`)
- **Config:** `~/.vesper/workspaces/{id}/config.json` (telegramAccounts)

## Data Types

### AccessControlConfig

```typescript
interface AccessControlConfig {
  dmPolicy: 'open' | 'restricted';      // DM acceptance policy
  groupPolicy: 'open' | 'restricted';   // Group message policy
  allowedUsers: number[];               // User IDs (if restricted)
  allowedChats: number[];               // Chat IDs (if restricted)
}
```

### ConnectionStatus

```typescript
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
```

## IPC Handlers

### `telegram:connect`

Connect to Telegram with bot token.

**Request:**
```typescript
{
  workspaceId: string;
  botToken: string;
  accountId?: string;  // Default: 'default'
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
const result = await ipcRenderer.invoke('telegram:connect', {
  workspaceId: 'workspace-1',
  botToken: '123456:ABC-DEF...'
});

if (result.success) {
  console.log('Connected to Telegram');
} else {
  console.error(result.error);
}
```

**Behavior:**
1. Validates bot token
2. Stores encrypted credentials
3. Loads access control config
4. Starts polling for messages
5. Attaches error handler to prevent crashes

**Events:**
- `telegram:error` on connection errors

---

### `telegram:disconnect`

Disconnect from Telegram and delete credentials (GDPR compliant).

**Request:**
```typescript
{
  workspaceId: string;
  accountId?: string;  // Default: 'default'
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
const result = await ipcRenderer.invoke('telegram:disconnect', {
  workspaceId: 'workspace-1'
});
```

**Behavior:**
1. Stops bot polling
2. Deletes encrypted credentials
3. Clears session mapping

---

### `telegram:status`

Get current connection status.

**Request:**
```typescript
{
  workspaceId: string;
  accountId?: string;  // Default: 'default'
}
```

**Response:**
```typescript
{
  success: boolean;
  status?: ConnectionStatus;
  error?: string;
}
```

**Example:**
```typescript
const result = await ipcRenderer.invoke('telegram:status', {
  workspaceId: 'workspace-1'
});

if (result.success) {
  console.log('Status:', result.status); // 'connected', 'disconnected', etc.
}
```

---

### `telegram:send-message`

Send a message to a Telegram chat.

**Request:**
```typescript
{
  workspaceId: string;
  chatId: number;
  content: string;
  accountId?: string;  // Default: 'default'
}
```

**Response:**
```typescript
{
  success: boolean;
  messageId?: number;
  error?: string;
}
```

**Example:**
```typescript
const result = await ipcRenderer.invoke('telegram:send-message', {
  workspaceId: 'workspace-1',
  chatId: 123456789,
  content: 'Hello from Vesper!'
});

if (result.success) {
  console.log('Message sent with ID:', result.messageId);
}
```

**Behavior:**
- Chunks messages > 4096 characters
- Respects rate limiting (per-chat and global)
- Queues messages if rate limit exceeded

---

### `telegram:get-saved-token`

Get saved bot token for auto-connect.

**Request:**
```typescript
{
  workspaceId: string;
  accountId?: string;  // Default: 'default'
}
```

**Response:**
```typescript
{
  success: boolean;
  token?: string;
  error?: string;
}
```

**Example:**
```typescript
const result = await ipcRenderer.invoke('telegram:get-saved-token', {
  workspaceId: 'workspace-1'
});

if (result.success && result.token) {
  // Auto-connect with saved token
  await ipcRenderer.invoke('telegram:connect', {
    workspaceId: 'workspace-1',
    botToken: result.token
  });
}
```

---

### `telegram:get-access-control`

Get access control configuration.

**Request:**
```typescript
{
  workspaceId: string;
  accountId?: string;  // Default: 'default'
}
```

**Response:**
```typescript
{
  success: boolean;
  accessControl?: AccessControlConfig;
  error?: string;
}
```

**Example:**
```typescript
const result = await ipcRenderer.invoke('telegram:get-access-control', {
  workspaceId: 'workspace-1'
});

if (result.success) {
  console.log('DM Policy:', result.accessControl.dmPolicy);
  console.log('Allowed users:', result.accessControl.allowedUsers);
}
```

---

### `telegram:set-access-control`

Set access control configuration.

**Request:**
```typescript
{
  workspaceId: string;
  accountId?: string;  // Default: 'default'
  accessControl: AccessControlConfig;
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
const result = await ipcRenderer.invoke('telegram:set-access-control', {
  workspaceId: 'workspace-1',
  accessControl: {
    dmPolicy: 'restricted',
    groupPolicy: 'open',
    allowedUsers: [123456, 789012],
    allowedChats: []
  }
});
```

**Behavior:**
1. Validates access control config
2. Saves to workspace config
3. Updates live service configuration

---

## Events

### `telegram:error`

Broadcast when an error occurs.

**Payload:**
```typescript
{
  workspaceId: string;
  accountId: string;
  message: string;
  timestamp: number;
}
```

**Usage:**
```typescript
ipcRenderer.on('telegram:error', (event, data) => {
  console.error(`[${data.accountId}] Error:`, data.message);
  showNotification('Telegram Error', data.message);
});
```

---

## Permission Directives

Users can control permission mode via message prefixes:

| Directive | Permission Mode | Description |
|-----------|----------------|-------------|
| `/safe` | `safe` | Read-only, blocks all write operations |
| `/ask` | `ask` | Prompts for approval (default) |
| `/allow_all` | `allow-all` | Auto-approves all commands |

**Example:**
```
/safe What files are in this directory?
/allow_all Install dependencies and run tests
/ask Can you review this PR?
```

**Behavior:**
- Directive is stripped from message before sending to agent
- Permission mode applies to current session only
- Default mode is `ask` if no directive specified

---

## Session Continuity

Sessions are mapped by `{chatId}:{userId}`:

```typescript
const sessionKey = `${message.chat.id}:${message.from.id}`;
```

**Behavior:**
- Same chat + user = same session (conversation continues)
- Different user in same chat = different session
- DMs and group chats are separate sessions

**Example:**
```
User A in Chat 1 → Session "chat1:userA"
User B in Chat 1 → Session "chat1:userB"
User A in Chat 2 → Session "chat2:userA"
```

---

## Rate Limiting

### Per-Chat Rate Limiting

Token bucket algorithm:
- **Burst:** 5 messages
- **Refill rate:** 0.5 tokens/sec (1 message every 2 seconds)

**Behavior:**
- Allows quick bursts of 5 messages
- Then rate limits to 1 message per 2 seconds
- Prevents flooding individual chats

### Global Rate Limiting

Message queue:
- **Limit:** 30 messages/second (Telegram API limit)

**Behavior:**
- Queues messages if global limit exceeded
- Processes queue FIFO
- Prevents API rate limit errors

---

## Large Result Handling

Telegram has a 4096 character limit per message.

**Behavior:**
1. Chunk results into 4000-char segments (safe margin)
2. Send first chunk with "Message too long" notice
3. Create deep link for full result viewing
4. User can click link to view full content in Vesper

**Example Response:**
```
[Agent response truncated - message too long]

First 4000 characters:
...

View full response: vesper://view-result/{id}
```

---

## Security

### Bot Token Storage

- Encrypted with AES-256-GCM via CredentialManager
- Never logged or exposed in errors
- Deleted on disconnect (GDPR compliant)

### Access Control

- Restrict DMs/groups to specific users/chats
- Default policy is `open` (accepts all messages)
- Can be changed to `restricted` with allowlists

### ReDoS Protection

- Non-greedy regex patterns for message parsing
- Timeout protection on long messages
- Sanitized error messages (no token exposure)

---

## Error Handling

All handlers return `{ success: boolean; error?: string }` format.

**Common Errors:**
- `Invalid bot token`: Token format incorrect
- `Bot already running`: Service already connected
- `Network error`: Connection failed
- `Rate limit exceeded`: Too many requests

**Example:**
```typescript
const result = await ipcRenderer.invoke('telegram:connect', { ... });

if (!result.success) {
  switch (result.error) {
    case 'Invalid bot token':
      showError('Please check your bot token');
      break;
    case 'Network error':
      showError('Unable to connect to Telegram');
      break;
    default:
      showError(result.error);
  }
}
```

---

## Best Practices

1. **Auto-connect on startup** using saved token
2. **Set access control** to restrict bot access
3. **Monitor errors** via `telegram:error` event
4. **Handle disconnections** gracefully with retry logic
5. **Chunk long messages** for better UX
6. **Use directives** for quick permission mode switching
7. **Session mapping** preserves conversation context
