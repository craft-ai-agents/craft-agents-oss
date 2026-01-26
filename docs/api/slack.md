# Slack Integration API

Slack integration with OAuth authentication and Socket Mode for real-time messaging.

## Features

- OAuth 2.0 authentication (stores access/refresh tokens)
- Socket Mode for real-time event listening
- Message routing with permission directives
- Thread context resolution
- Message deduplication (10-min TTL)
- Inbound debouncing (1.5s window)
- Automatic chunking (4000 char limit)
- Session continuity across conversations

## Storage

- **Credentials:** Encrypted via CredentialManager (type: `slack_oauth`)
- **Config:** Workspace-specific settings in memory
- **Sessions:** Mapped by `{accountId}:{channel}:{thread}:{user}`

## Data Types

### SlackAccountConfig

```typescript
interface SlackAccountConfig {
  accountId: string;
  enabled: boolean;
  mode: 'socket' | 'events';           // Socket Mode or Events API
  dmPolicy: 'open' | 'restricted';     // DM acceptance policy
  groupPolicy: 'open' | 'restricted';  // Channel message policy
  replyToMode: 'all' | 'mentions';     // Reply to all or only mentions
  allowedChannels?: string[];          // Channel IDs (if restricted)
  allowedUsers?: string[];             // User IDs (if restricted)
}
```

### SlackServiceState

```typescript
interface SlackServiceState {
  accountId: string;
  status: SlackConnectionStatus;
  teamId?: string;
  teamName?: string;
  botUserId?: string;
  connectedAt?: number;
  error?: SlackError;
}
```

### SlackOutboundMessage

```typescript
interface SlackOutboundMessage {
  channel: string;
  text: string;
  threadTs?: string;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
}
```

### SlackInboundMessage

```typescript
interface SlackInboundMessage {
  ts: string;
  text: string;
  channel: string;
  channelName?: string;
  user: string;
  botId?: string;
  threadTs?: string;
  parentUserId?: string;
  files?: any[];
  subtype?: string;
  accountId: string;
  teamId: string;
  wasMentioned: boolean;
  isThreadReply: boolean;
}
```

## IPC Handlers

### `slack:start-oauth`

Start Slack OAuth flow and store credentials.

**Request:**
```typescript
{
  workspaceId: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  error?: string;
  connection?: {
    isConnected: boolean;
    teamName?: string;
    teamId?: string;
    userId?: string;
    connectedAt?: number;
  };
  workspaces?: Array<{
    teamId: string;
    teamName: string;
    userId: string;
    connectedAt: number;
  }>;
}
```

**Example:**
```typescript
const result = await ipcRenderer.invoke('slack:start-oauth', workspaceId);

if (result.success) {
  console.log('Connected to:', result.connection.teamName);
} else {
  console.error('OAuth failed:', result.error);
}
```

**Behavior:**
1. Opens browser for OAuth authorization
2. User grants permissions
3. Stores access token (encrypted)
4. Returns connection info

**Required Environment Variables:**
- `SLACK_OAUTH_CLIENT_ID`
- `SLACK_OAUTH_CLIENT_SECRET`

---

### `slack:get-status`

Get current Slack connection status.

**Request:**
```typescript
{
  workspaceId: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  connection?: {
    isConnected: boolean;
    isConnecting: boolean;
    teamName?: string;
    teamId?: string;
    userId?: string;
    connectedAt?: number;
  };
  workspaces?: Array<{...}>;
  error?: string;
}
```

**Example:**
```typescript
const result = await ipcRenderer.invoke('slack:get-status', workspaceId);

if (result.success && result.connection.isConnected) {
  console.log('Connected to:', result.connection.teamName);
}
```

---

### `slack:disconnect`

Disconnect and remove OAuth credentials.

**Request:**
```typescript
{
  workspaceId: string;
  teamId?: string;
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
await ipcRenderer.invoke('slack:disconnect', workspaceId);
```

**Behavior:**
1. Deletes stored credentials
2. Stops active service (if any)

---

### `slack:has-oauth-credentials`

Check if OAuth credentials are configured (environment variables).

**Request:**
```typescript
// No parameters
```

**Response:**
```typescript
boolean  // true if SLACK_OAUTH_CLIENT_ID and SLACK_OAUTH_CLIENT_SECRET are set
```

**Example:**
```typescript
const hasCredentials = await ipcRenderer.invoke('slack:has-oauth-credentials');

if (!hasCredentials) {
  showError('Slack OAuth not configured. Set environment variables.');
}
```

---

### `slack:connect`

Start Slack service (begin listening for messages).

**Request:**
```typescript
{
  workspaceId: string;
  accountId?: string;  // Default: 'default'
  config?: Partial<SlackAccountConfig>;
}
```

**Response:**
```typescript
{
  success: boolean;
  state?: SlackServiceState;
  error?: string;
}
```

**Example:**
```typescript
const result = await ipcRenderer.invoke('slack:connect', {
  workspaceId: 'workspace-1',
  config: {
    dmPolicy: 'open',
    groupPolicy: 'restricted',
    allowedChannels: ['C12345', 'C67890'],
    replyToMode: 'mentions'
  }
});

if (result.success) {
  console.log('Listening on:', result.state.teamName);
}
```

**Behavior:**
1. Retrieves stored OAuth token
2. Gets app token from env (`SLACK_APP_TOKEN`)
3. Creates Bolt App with Socket Mode
4. Registers message/event handlers
5. Starts listening for messages

**Events:**
- `slack:message-received` when message arrives
- `slack:status-changed` when connection state changes
- `slack:error` on errors

---

### `slack:disconnect-service`

Stop Slack service (stop listening).

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
await ipcRenderer.invoke('slack:disconnect-service', {
  workspaceId: 'workspace-1'
});
```

**Behavior:**
1. Stops Bolt App
2. Clears debounce queues
3. Updates status to disconnected

---

### `slack:send-message`

Send a message to Slack.

**Request:**
```typescript
{
  workspaceId: string;
  accountId?: string;  // Default: 'default'
  message: SlackOutboundMessage;
}
```

**Response:**
```typescript
{
  success: boolean;
  ts?: string;    // Message timestamp
  error?: string;
}
```

**Example:**
```typescript
const result = await ipcRenderer.invoke('slack:send-message', {
  workspaceId: 'workspace-1',
  message: {
    channel: 'C12345',
    text: 'Hello from Vesper!',
    threadTs: '1234567890.123456'  // Reply in thread
  }
});

if (result.success) {
  console.log('Message sent:', result.ts);
}
```

**Behavior:**
- Chunks messages > 4000 characters
- Sends multiple messages in thread if chunked
- Returns timestamp of first message

---

### `slack:get-service-status`

Get service status (separate from OAuth status).

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
  connected: boolean;
  state: SlackServiceState | null;
}
```

**Example:**
```typescript
const { connected, state } = await ipcRenderer.invoke('slack:get-service-status', {
  workspaceId: 'workspace-1'
});

if (connected) {
  console.log('Service running on:', state.teamName);
}
```

---

## Events

### `slack:message-received`

Broadcast when a message is received and routed.

**Payload:**
```typescript
{
  workspaceId: string;
  accountId: string;
  message: SlackInboundMessage;
  sessionKey: string;
  permissionMode: 'safe' | 'ask' | 'allow-all';
}
```

**Usage:**
```typescript
ipcRenderer.on('slack:message-received', (event, data) => {
  console.log('Message from:', data.message.user);
  console.log('Session:', data.sessionKey);
  console.log('Mode:', data.permissionMode);
});
```

---

### `slack:status-changed`

Broadcast when connection status changes.

**Payload:**
```typescript
{
  workspaceId: string;
  accountId: string;
  status: SlackConnectionStatus;
  state: SlackServiceState;
}
```

**Usage:**
```typescript
ipcRenderer.on('slack:status-changed', (event, data) => {
  updateStatusIndicator(data.status);
});
```

---

### `slack:error`

Broadcast when an error occurs.

**Payload:**
```typescript
{
  workspaceId: string;
  accountId: string;
  error: SlackError;
}
```

**Usage:**
```typescript
ipcRenderer.on('slack:error', (event, data) => {
  console.error('Slack error:', data.error.message);
  if (data.error.recoverable) {
    // Retry connection
  }
});
```

---

## Message Routing

### Permission Directives

Messages can include directives to control permission mode:

| Directive | Permission Mode | Description |
|-----------|----------------|-------------|
| `/safe` | `safe` | Read-only mode |
| `/ask` | `ask` | Prompt for approval (default) |
| `/allow-all` | `allow-all` | Auto-approve all |

**Example:**
```
/safe What files are in this directory?
/allow-all Install dependencies and run tests
```

**Behavior:**
- Directive is stripped from message
- Permission mode applies to session
- Default is `ask` if no directive

---

### Reply To Mode

Controls which messages the bot responds to:

| Mode | Behavior |
|------|----------|
| `all` | Reply to all messages in allowed channels |
| `mentions` | Only reply when @mentioned |

**Example Config:**
```typescript
{
  replyToMode: 'mentions',  // Only respond to @mentions
  groupPolicy: 'open'       // But allow all channels
}
```

---

### Session Mapping

Sessions are mapped by: `{accountId}:{channel}:{threadTs}:{user}`

**Examples:**
```
default:C12345::U67890           → Main channel message from U67890
default:C12345:1234.5678:U67890  → Thread reply from U67890
default:D12345::U67890           → DM from U67890
```

**Behavior:**
- Same channel + thread + user = same session
- Different threads = different sessions
- DMs are separate from channels

---

## Message Deduplication

Prevents processing duplicate messages:

- **TTL:** 10 minutes
- **Cache size:** 2000 entries (LRU eviction)
- **Key:** `{channel}:{ts}`

**Behavior:**
1. Check if message seen in last 10 minutes
2. If yes, skip processing
3. If no, add to cache and process

---

## Inbound Debouncing

Combines rapid messages into single agent call:

- **Window:** 1.5 seconds
- **Scope:** Per `{accountId}:{channel}:{thread}:{user}`

**Behavior:**
1. Queue messages in 1.5s window
2. Combine into single message
3. Send to agent once

**Exceptions (not debounced):**
- Messages with file attachments
- Control commands (`/stop`, `/cancel`, `/abort`)

---

## Thread Context Resolution

Resolves missing `threadTs` for thread replies:

**Problem:** Some thread replies don't include `threadTs`

**Solution:**
1. Detect thread reply via `parentUserId`
2. Call `conversations.replies` API
3. Extract `threadTs` from first message
4. Use for session mapping

---

## Security

### OAuth Token Storage

- Encrypted with AES-256-GCM
- Refresh token stored for long-term access
- Expiration tracking

### Access Control

- Restrict DMs/channels via allowlists
- Policy enforcement (open/restricted)
- Bot mention detection

### Error Handling

- Sanitized error messages
- Recoverable vs non-recoverable errors
- Retry logic for transient failures

---

## Best Practices

1. **Check OAuth credentials** before showing Slack settings
2. **Auto-connect on startup** if OAuth token exists
3. **Monitor events** for message/status updates
4. **Set access control** to restrict bot access
5. **Use Socket Mode** for real-time messaging (requires `SLACK_APP_TOKEN`)
6. **Handle disconnections** gracefully with status monitoring
7. **Chunk long responses** automatically via service
8. **Use threads** for organized conversations
