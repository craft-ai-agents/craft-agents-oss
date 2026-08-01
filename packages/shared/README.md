# @archstudio/shared

Core business logic for ARCHstudio: agent backends, session management, sources, credentials, and configuration.

## Installation

```bash
# In a workspace package
bun add @archstudio/shared
```

Or add to `package.json`:
```json
{
  "dependencies": {
    "@archstudio/shared": "workspace:*"
  }
}
```

## Overview

`@archstudio/shared` contains the central business logic that powers ARCHstudio:
- **Agent backends** — Claude SDK and Pi provider implementations
- **Session management** — Session persistence, message history, lifecycle
- **Sources** — External data source integrations (MCP, API, local)
- **Credentials** — Encrypted credential storage and retrieval
- **Configuration** — Workspace config, preferences, themes, environment setup
- **Permissions** — Permission mode validation (safe/ask/allow-all)
- **Automations** — Automation rules, conditions, and execution
- **Tasks** — Task tracking and orchestration
- **Labels** — Dynamic labeling system for sessions

## Key Modules

### Agent Backends (`src/agent/`)
- `claude-agent.ts` — Claude SDK agent backend
- `pi-agent.ts` — Pi provider backend (OpenAI-compatible)
- `base-agent.ts` — Shared backend interface
- `tools/` — Session-scoped tools (create_task, call_llm, browser_tool, etc.)
- `permissions/` — Permission mode validation and enforcement

### Session Management (`src/sessions/`)
- Session persistence and indexing
- Message history storage
- Session state tracking (active, paused, completed)
- Mid-stream queue management
- OAuth refresh handling

### Sources (`src/sources/`)
- Source type definitions (MCP, API, local)
- Credential management per source
- Source activation and caching
- OAuth flow integration

### Configuration (`src/config/`)
- Default configuration values
- User preferences persistence
- Theme and color configuration
- Model registry and fetchers (Anthropic, Pi, Bedrock)
- UI language preferences

### Credentials (`src/credentials/`)
- Encrypted credential storage (AES-256-GCM)
- Credential lifecycle (create, read, update, delete)
- Safe credential exposure (no-log patterns)
- Credential refresh for API sources

## Exported Types

### Agent
- `AgentBackend` — Interface for LLM backends
- `ClaudeAgent` — Claude SDK implementation
- `QueryLlmRequest` — LLM query input
- `ThinkingLevel` — Reasoning depth (off/low/medium/high/xhigh/max)

### Session
- `Session` — Active session with messages
- `StoredSession` — Persisted session
- `SessionMetadata` — Lightweight session listing
- `Message` — Chat message with metadata

### Sources
- `SourceConfig` — Source configuration
- `ApiSourceConfig`, `McpSourceConfig` — Type-specific configs
- `SourceCredential` — Stored credential

### Config
- `ConfigDefaults` — Application defaults
- `UserPreferences` — User settings
- `ThemeConfig` — Color/appearance settings

## Hard Rules

1. **Permission modes are immutable** — Always `safe`, `ask`, or `allow-all`. No new modes without discussion.
2. **Source types are immutable** — Always `mcp`, `api`, or `local`. No new types without discussion.
3. **Credential handling is centralized** — Use `src/credentials/` pathways only. Never store secrets ad-hoc.
4. **Backward compatibility** — Keep tool contracts stable for running sessions.
5. **Type stability** — When changing exported types, validate downstream usage in `packages/core`, `packages/server-core`, and `apps/*`.

## Development

```bash
# Type-check
cd packages/shared && bun run tsc --noEmit

# Run tests
bun test packages/shared

# Build
bun run build:shared
```

## Dependencies

- `@archstudio/core` — Shared type definitions
- `@anthropic-ai/sdk` — Claude API client
- `@modelcontextprotocol/sdk` — MCP client
- `jose` — JWT/JOSE handling
- `crypto` — Node.js cryptography (credentials)

## License

MIT
