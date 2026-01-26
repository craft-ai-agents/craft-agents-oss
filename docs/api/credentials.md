# Credentials API

Secure credential storage with AES-256-GCM encryption for API keys, OAuth tokens, and sensitive data.

## Storage

- **Location:** `~/.vesper/credentials.enc`
- **Encryption:** AES-256-GCM with PBKDF2 key derivation
- **Format:** Encrypted JSON

## Features

- **AES-256-GCM encryption** - Industry-standard encryption
- **Key derivation** - PBKDF2 with high iteration count
- **Type-safe IDs** - Structured credential identifiers
- **Metadata support** - Store additional context
- **Refresh tokens** - OAuth token refresh support
- **Expiration tracking** - Automatic expiration detection

## Data Types

### CredentialId

```typescript
interface CredentialId {
  type: CredentialType;
  workspaceId?: string;      // Required for workspace-scoped credentials
  sourceId?: string;         // Required for source-scoped credentials
}
```

### CredentialType

```typescript
type CredentialType =
  | 'anthropic_api_key'
  | 'slack_oauth'
  | 'telegram_bot_token'
  | 'claude_profile'
  | 'github_oauth'
  | 'source_oauth'
  | 'mcp_oauth'
  // ... extensible
```

### Credential

```typescript
interface Credential {
  value: string;              // Main credential value (encrypted)
  refreshToken?: string;      // OAuth refresh token (encrypted)
  expiresAt?: number;         // Expiration timestamp
  metadata?: Record<string, unknown>;  // Additional context
}
```

## Core Methods

These are internal methods used by IPC handlers. Direct IPC access is not exposed for security.

### `set(id: CredentialId, credential: Credential)`

Store or update a credential.

**Example:**
```typescript
import { getCredentialManager } from '@vesper/shared/credentials';

const manager = getCredentialManager();

await manager.set(
  {
    type: 'slack_oauth',
    workspaceId: 'workspace-1',
    sourceId: 'slack'
  },
  {
    value: 'xoxb-...',
    refreshToken: 'xoxr-...',
    expiresAt: Date.now() + 86400000,
    metadata: {
      teamId: 'T12345',
      teamName: 'My Team',
      userId: 'U67890'
    }
  }
);
```

---

### `get(id: CredentialId)`

Retrieve a credential.

**Returns:** `Credential | null`

**Example:**
```typescript
const cred = await manager.get({
  type: 'anthropic_api_key'
});

if (cred) {
  console.log('API Key found');
  if (cred.expiresAt && cred.expiresAt < Date.now()) {
    console.log('Expired!');
  }
}
```

---

### `delete(id: CredentialId)`

Delete a credential.

**Example:**
```typescript
await manager.delete({
  type: 'telegram_bot_token',
  workspaceId: 'workspace-1',
  sourceId: 'default'
});
```

---

### `has(id: CredentialId)`

Check if a credential exists.

**Returns:** `boolean`

**Example:**
```typescript
const exists = await manager.has({
  type: 'github_oauth',
  workspaceId: 'workspace-1'
});
```

---

### `list()`

List all credential IDs (for debugging/admin).

**Returns:** `CredentialId[]`

**Example:**
```typescript
const ids = await manager.list();
console.log('Stored credentials:', ids);
```

---

## Convenience Methods

### `getAnthropicApiKey()`

Get the global Anthropic API key.

**Returns:** `string | null`

**Example:**
```typescript
const apiKey = await manager.getAnthropicApiKey();
if (!apiKey) {
  throw new Error('No API key configured');
}
```

---

### `setAnthropicApiKey(key: string)`

Set the global Anthropic API key.

**Example:**
```typescript
await manager.setAnthropicApiKey('sk-ant-...');
```

---

### `deleteAnthropicApiKey()`

Delete the global Anthropic API key.

**Example:**
```typescript
await manager.deleteAnthropicApiKey();
```

---

### `getTelegramBotToken(workspaceId: string, accountId: string)`

Get Telegram bot token for a workspace account.

**Returns:** `string | null`

**Example:**
```typescript
const token = await manager.getTelegramBotToken('workspace-1', 'default');
```

---

### `setTelegramBotToken(workspaceId: string, accountId: string, token: string)`

Set Telegram bot token.

**Example:**
```typescript
await manager.setTelegramBotToken('workspace-1', 'default', '123456:ABC...');
```

---

### `deleteTelegramBotToken(workspaceId: string, accountId: string)`

Delete Telegram bot token.

**Example:**
```typescript
await manager.deleteTelegramBotToken('workspace-1', 'default');
```

---

## Integration Examples

### Slack OAuth

```typescript
// Store OAuth result
await manager.set(
  {
    type: 'slack_oauth',
    workspaceId: 'workspace-1',
    sourceId: 'slack'
  },
  {
    value: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
    metadata: {
      teamId: result.teamId,
      teamName: result.teamName,
      userId: result.userId,
      connectedAt: Date.now()
    }
  }
);

// Retrieve later
const cred = await manager.get({
  type: 'slack_oauth',
  workspaceId: 'workspace-1',
  sourceId: 'slack'
});

if (cred && cred.value) {
  // Use access token
  connectToSlack(cred.value);
}
```

---

### Claude Profile (Multi-Account OAuth)

```typescript
// Store profile
await manager.set(
  {
    type: 'claude_profile',
    sourceId: profileId
  },
  {
    value: accessToken,
    refreshToken: refreshToken,
    expiresAt: Date.now() + 3600000,
    metadata: {
      name: 'Work Account',
      email: 'user@work.com',
      createdAt: Date.now()
    }
  }
);

// List all profiles
const profileIds = await manager.list();
const claudeProfiles = profileIds.filter(id => id.type === 'claude_profile');
```

---

### GitHub OAuth

```typescript
// Store GitHub token
await manager.set(
  {
    type: 'github_oauth',
    workspaceId: 'workspace-1'
  },
  {
    value: oauthToken,
    metadata: {
      username: 'johndoe',
      scopes: ['repo', 'user']
    }
  }
);
```

---

## Security Considerations

### Encryption

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key Derivation:** PBKDF2 with 100,000 iterations
- **Salt:** Random 32-byte salt per file
- **IV:** Random 12-byte IV per encryption

### Key Management

- Encryption key derived from machine-specific data
- No plaintext keys stored on disk
- Automatic key rotation on decrypt failure

### Access Control

- No direct IPC access to credential manager
- Credentials only accessible via authenticated IPC handlers
- Each integration (Slack, Telegram, etc.) has scoped access

### GDPR Compliance

- Credentials deleted on disconnect (Telegram)
- User can manually delete all credentials
- No credentials logged or exposed in errors

---

## Error Handling

All methods throw `CredentialError` with specific codes:

```typescript
try {
  await manager.get({ type: 'invalid' });
} catch (error) {
  if (error instanceof CredentialError) {
    console.error('Code:', error.code);
    console.error('Message:', error.message);
  }
}
```

**Error Codes:**
- `NOT_FOUND`: Credential not found
- `INVALID_INPUT`: Invalid credential ID or data
- `ENCRYPTION_ERROR`: Encryption/decryption failed
- `IO_ERROR`: File system error
- `CORRUPT_DATA`: Invalid encrypted data

---

## Sanitization

Sensitive values are automatically sanitized in error messages:

```typescript
import { sanitizeError } from '@vesper/shared/utils';

try {
  await connectWithToken(botToken);
} catch (error) {
  // Removes botToken from error message
  const sanitized = sanitizeError(error, [botToken]);
  console.error(sanitized);
}
```

---

## Best Practices

1. **Use convenience methods** for common credential types
2. **Check expiration** before using OAuth tokens
3. **Handle missing credentials** gracefully
4. **Delete on disconnect** for GDPR compliance
5. **Use metadata** to store context (team name, user ID, etc.)
6. **Sanitize errors** to prevent credential leakage
7. **Validate before storage** to ensure correct format
8. **Use refresh tokens** for long-term OAuth access
