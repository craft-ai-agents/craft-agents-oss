# @craft-agent/core

Shared TypeScript types and utilities for Craft Agent applications.

## Installation

```bash
# In a workspace package
bun add @craft-agent/core
```

Or add to `package.json`:
```json
{
  "dependencies": {
    "@craft-agent/core": "workspace:*"
  }
}
```

## Usage

```typescript
// Import types
import type {
  Workspace,
  Session,
  Message,
  TokenUsage,
  AgentEvent,
} from '@craft-agent/core';

// Import utilities
import { generateMessageId, debug } from '@craft-agent/core';
```

## Exported Types

### Workspace & Config
- `Workspace` - Workspace with MCP URL and auth config
- `McpAuthType` - Auth method: `workspace_oauth` | `workspace_bearer` | `public`
- `AuthType` - Billing: `api_key` | `oauth_token`
- `StoredConfig` - Application configuration
- `OAuthCredentials` - OAuth token data

### Sessions
- `Session` - Conversation scope bound to SDK session
- `StoredSession` - Session with messages for persistence
- `SessionMetadata` - Lightweight session listing info

### Messages
- `Message` - Runtime message with all fields
- `StoredMessage` - Persisted message format
- `MessageRole` - Message type enum
- `ToolStatus` - Tool execution state
- `TokenUsage` - Token counts and cost
- `AgentEvent` - Events from CraftAgent
- `TypedError` - Structured error info
- `Question` - AskUserQuestion format

## Utilities

### `generateMessageId()`

Generate a unique message ID:
```typescript
const id = generateMessageId();
// Returns: "msg-1702736400000-a1b2c3"
```

### `debug()`

Debug logging (no-op by default):
```typescript
debug('Processing message:', message.id);
```

## Package Structure

```
src/
├── index.ts          # Main exports
├── types/
│   ├── workspace.ts  # Workspace, auth types
│   ├── session.ts    # Session types
│   └── message.ts    # Message, event types
└── utils/
    └── debug.ts      # Debug utility
```

## Peer Dependencies

This package requires the following peer dependencies:
- `@anthropic-ai/claude-agent-sdk` 0.3.154
- `@modelcontextprotocol/sdk` >= 1.29.0

The Claude Agent SDK also requires `@anthropic-ai/sdk` >= 0.93.0 at the app level.

## License

MIT
