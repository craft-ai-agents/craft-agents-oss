# CLAUDE.md - Core Package

This file provides guidance to Claude Code when working with the `@craft-agent/core` package.

**Important:** Keep this file and `README.md` up-to-date whenever functionality changes. After making changes to this package, update the documentation to reflect the current state.

## Overview

The core package provides shared TypeScript types and utilities used by the Electron app and shared packages. It serves as the type definition layer for the Craft Agent monorepo.

**Current State:** This package currently only exports types and a debug utility stub. The actual implementation of storage, credentials, agent logic, auth, and MCP handling still lives in the root `src/` directory and is accessed via relative imports by the apps.

## Directory Structure

```
packages/core/
├── src/
│   ├── index.ts           # Main entry point, re-exports
│   ├── types/
│   │   ├── index.ts       # Type re-exports
│   │   ├── workspace.ts   # Workspace, auth, config types
│   │   ├── session.ts     # Session, metadata types
│   │   └── message.ts     # Message, token, event types
│   └── utils/
│       ├── index.ts       # Utility re-exports
│       └── debug.ts       # Debug logging stub
├── package.json
└── tsconfig.json
```

## Type Categories

### Workspace Types (`types/workspace.ts`)

| Type | Description |
|------|-------------|
| `Workspace` | Workspace configuration with MCP URL and auth |
| `McpAuthType` | MCP authentication method: `workspace_oauth`, `workspace_bearer`, `public` |
| `AuthType` | API setup method: `api_key`, `oauth_token` |
| `OAuthCredentials` | OAuth tokens from authentication flow |
| `StoredConfig` | Full application configuration |
| `CumulativeUsage` | Global token/cost tracking |

### Session Types (`types/session.ts`)

| Type | Description |
|------|-------------|
| `Session` | Conversation scope with SDK session binding |
| `StoredSession` | Session with persisted messages and tokens |
| `SessionMetadata` | Lightweight session info for listings |

### Message Types (`types/message.ts`)

| Type | Description |
|------|-------------|
| `Message` | Runtime message with all fields |
| `StoredMessage` | Persisted message format |
| `MessageRole` | `user`, `assistant`, `tool`, `error`, `status`, `system`, `info`, `warning` |
| `ToolStatus` | `pending`, `executing`, `completed`, `error` |
| `TokenUsage` | Input/output/cache token counts and cost |
| `AgentEvent` | Events from CraftAgent during chat (incl. task_backgrounded, shell_backgrounded, task_progress) |
| `TypedError` | Structured error with code, title, canRetry |
| `Question` | AskUserQuestion tool format |

## Usage

```typescript
// Import types
import type {
  Workspace,
  Session,
  Message,
  AgentEvent,
} from '@craft-agent/core';

// Import utilities
import { generateMessageId, debug } from '@craft-agent/core';

// Or import from specific subpaths
import type { Session } from '@craft-agent/core/types';
```

## Key Design Decisions

### Session as Primary Boundary

Sessions are the primary isolation boundary, not workspaces. Each session:
- Has a unique `id` (our UUID, known immediately)
- Maps 1:1 with an SDK session (`sdkSessionId`)
- Belongs to exactly one workspace
- Can be archived and named

### MCP Auth Separation

**Critical:** Craft OAuth (`craft_oauth::global`) is ONLY for the Craft API (managing spaces, MCP links). It is NEVER used for MCP server authentication. Each MCP server has its own OAuth via `workspace_oauth::{workspaceId}`.

### Message ID Generation

Use `generateMessageId()` for consistent ID format:
```typescript
const id = generateMessageId(); // "msg-1702736400000-a1b2c3"
```

## Future Migration

This package is designed to eventually contain more than just types. The migration plan:

1. **Current:** Types only, implementation in root `src/`
2. **Phase 2:** Move storage logic to `@craft-agent/core`
3. **Phase 3:** Move auth, credentials, MCP client
4. **Phase 4:** Move agent logic, prompts

Apps would then import from workspace packages instead of relative paths.

## Peer Dependencies

This package declares peer dependencies to avoid bundling duplicates:
- `@anthropic-ai/claude-agent-sdk`
- `@anthropic-ai/sdk`
- `@modelcontextprotocol/sdk`
