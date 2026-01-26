# Multi-Account Telegram Architecture

This document describes Vesper's multi-account architecture for Telegram bot integration.

## Overview

Vesper supports running multiple Telegram bot accounts per workspace, each with isolated configurations and independent operations. This enables enterprise use cases such as:

- Separate bots for different teams or departments
- Different access control policies per bot
- Specialized bots for different purposes (support, alerts, etc.)

## Architecture

### Account Configuration

Each Telegram account is defined in the workspace config (`config.json`) under `telegramAccounts`:

```json
{
  "telegramAccounts": {
    "default": {
      "id": "default",
      "enabled": true,
      "name": "Support Bot",
      "tokenSource": "config",
      "config": {
        "accessControl": {
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowedUsers": ["123456789"],
          "allowedChats": []
        },
        "debounceMs": 1500,
        "requireMention": false
      }
    },
    "alerts-bot": {
      "id": "alerts-bot",
      "enabled": true,
      "name": "Alerts Bot",
      "tokenSource": "env",
      "config": {
        "requireMention": true
      }
    }
  }
}
```

### Token Resolution Priority

Tokens are resolved in the following order (first match wins):

1. **Account-specific tokenFile** (if `tokenSource: 'tokenFile'`)
   - Future enhancement for file-based token storage

2. **Account-specific token in credentials** (if `tokenSource: 'config'`)
   - Stored in encrypted credentials file: `~/.vesper/credentials.enc`
   - Key format: `telegram_bot_token:{workspaceId}:{accountId}`

3. **Legacy global token** (backward compatibility for "default" account only)
   - Key format: `telegram_bot_token:{workspaceId}:default`
   - Ensures existing single-account setups continue to work

4. **Environment variable** (for "default" account only, if `tokenSource: 'env'`)
   - Variable: `TELEGRAM_BOT_TOKEN`
   - Useful for development and CI/CD

### Service Factory Pattern

The `TelegramService` now uses a multi-account factory pattern:

```typescript
// Get service for specific account
const service = getTelegramService('workspace-id', 'alerts-bot')

// Get all services for a workspace
const services = getAllTelegramServicesForWorkspace('workspace-id')
```

Each service instance is isolated with its own:
- Bot connection and polling loop
- Message queue and rate limiter
- Deduplicator and message router
- Event handlers and connection status

### IPC Layer

All Telegram IPC handlers now accept an optional `accountId` parameter:

```typescript
// Connect to specific account
await window.api.telegram.connect({
  workspaceId: 'ws-123',
  accountId: 'alerts-bot',
  botToken: 'token...'
})

// Default account (backward compatibility)
await window.api.telegram.connect({
  workspaceId: 'ws-123',
  botToken: 'token...'
  // accountId defaults to 'default'
})
```

## Backward Compatibility

The architecture is fully backward compatible with existing single-account setups:

1. **Default account ID**: All existing code uses `accountId: 'default'` by default
2. **Legacy token migration**: Old tokens are accessible via the "default" account
3. **Auto-migration**: Workspaces without `telegramAccounts` are migrated on first access

### Migration Example

Old workspace config:
```json
{
  "id": "ws-123",
  "name": "My Workspace"
}
```

Auto-migrated workspace config:
```json
{
  "id": "ws-123",
  "name": "My Workspace",
  "telegramAccounts": {
    "default": {
      "id": "default",
      "enabled": true,
      "name": "Default Bot",
      "tokenSource": "config",
      "config": {
        "debounceMs": 1500,
        "requireMention": false
      }
    }
  }
}
```

## Usage Examples

### Adding a New Account

1. Edit workspace config to add account:
```json
{
  "telegramAccounts": {
    "default": { ... },
    "new-bot": {
      "id": "new-bot",
      "enabled": true,
      "name": "New Bot",
      "tokenSource": "config",
      "config": {}
    }
  }
}
```

2. Connect the account via IPC:
```typescript
await window.api.telegram.connect({
  workspaceId: 'ws-123',
  accountId: 'new-bot',
  botToken: 'your-bot-token'
})
```

### Managing Multiple Accounts

```typescript
// Get all enabled accounts
const workspace = loadWorkspace(rootPath)
const enabledAccounts = getEnabledAccounts(workspace.config)

// Connect all enabled accounts
for (const account of enabledAccounts) {
  const token = await resolveAccountToken(
    workspace.config.id,
    account.id,
    account,
    credentialManager
  )

  if (token) {
    const service = getTelegramService(workspace.config.id, account.id)
    await service.start(token)
  }
}
```

### Access Control Per Account

Each account can have different access control policies:

```json
{
  "telegramAccounts": {
    "public-bot": {
      "id": "public-bot",
      "config": {
        "accessControl": {
          "dmPolicy": "open",
          "groupPolicy": "open",
          "allowedUsers": [],
          "allowedChats": []
        }
      }
    },
    "internal-bot": {
      "id": "internal-bot",
      "config": {
        "accessControl": {
          "dmPolicy": "allowlist",
          "groupPolicy": "allowlist",
          "allowedUsers": ["123456789", "987654321"],
          "allowedChats": ["-1001234567890"]
        }
      }
    }
  }
}
```

## API Reference

### Account Manager

```typescript
// Resolve token for an account
async function resolveAccountToken(
  workspaceId: string,
  accountId: string,
  account: TelegramAccountConfig,
  credentialManager: CredentialManager
): Promise<string | null>

// Get all enabled accounts
function getEnabledAccounts(
  workspaceConfig: WorkspaceConfig
): TelegramAccountConfig[]

// Get account by ID
function getAccountById(
  workspaceConfig: WorkspaceConfig,
  accountId: string
): TelegramAccountConfig | null

// Get default account config
function getDefaultAccountConfig(): TelegramAccountConfig

// Ensure default account exists
function ensureDefaultAccount(
  workspaceConfig: WorkspaceConfig
): WorkspaceConfig
```

### Service Factory

```typescript
// Get service for specific account
function getTelegramService(
  workspaceId: string,
  accountId?: string
): TelegramService

// Get all services for a workspace
function getAllTelegramServicesForWorkspace(
  workspaceId: string
): TelegramService[]
```

### Credential Manager

```typescript
// Set account-specific token
async function setTelegramBotToken(
  workspaceId: string,
  botToken: string,
  accountId?: string
): Promise<void>

// Get account-specific token
async function getTelegramBotToken(
  workspaceId: string,
  accountId?: string
): Promise<string | null>

// Delete account-specific token
async function deleteTelegramBotToken(
  workspaceId: string,
  accountId?: string
): Promise<boolean>
```

## Testing

Run the account manager tests:

```bash
cd packages/shared
bun test src/telegram/account-manager.test.ts
```

## Future Enhancements

1. **Token File Support**: Read tokens from external files (`tokenSource: 'tokenFile'`)
2. **Account-Specific Rate Limits**: Different rate limits per account
3. **Account Health Monitoring**: Track uptime, error rates, message volume per account
4. **UI for Account Management**: Settings UI for adding/editing/removing accounts
5. **Account Templates**: Predefined configs for common use cases

## Related Files

- `packages/shared/src/telegram/types.ts` - Type definitions
- `packages/shared/src/telegram/account-manager.ts` - Account management utilities
- `packages/shared/src/workspaces/types.ts` - Workspace config schema
- `packages/shared/src/credentials/manager.ts` - Credential storage
- `apps/electron/src/main/telegram-service.ts` - Service implementation
- `apps/electron/src/main/telegram-ipc.ts` - IPC handlers
