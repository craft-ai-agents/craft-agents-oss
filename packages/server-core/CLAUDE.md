# CLAUDE.md — `@archstudio/server-core`

## Purpose
Server-side core logic for ARCHstudio: RPC handlers, session management, task orchestration, transport layer, OAuth flows, and platform services.

## Current scope
- **RPC handlers** — API endpoints for sessions, settings, sources, automations, tasks
- **Session management** — Session creation, lifecycle, message durability, browser integration
- **Task orchestration** — Task creation, running, progress tracking, result handling
- **Transport layer** — WebSocket server, message codec, push notifications
- **OAuth flows** — Setup, token exchange, refresh, validation
- **Platform services** — Git integration, image processing, VC++ redistribution, search
- **Model fetchers** — Anthropic, Pi, Bedrock model catalog and runtime capabilities
- **Bootstrap** — App initialization, auth gates, token entropy validation
- **WebUI** — HTTP server for web-based UI, OAuth relay callback

## Commands
From repo root:
```bash
cd packages/server-core && bun run tsc --noEmit
bun test packages/server-core
```

## Hard rules
1. **RPC handlers are thin** — Validation + delegation to domain logic
2. **No circular dependencies** — handlers → services → domain (never domain → handlers)
3. **Durability first** — Session messages persist before confirmation
4. **OAuth is retry-safe** — Token exchange can be re-attempted without duplication
5. **Task lifecycle is atomic** — Create task + orchestrator session together
6. **Browser integration is async** — Browser state is checked dynamically, not cached

## Key folders

### `src/handlers/rpc/` — RPC endpoints
One file per domain (sessions.ts, settings.ts, tasks.ts, etc.). Each exports:
- `*RpcHandler` — Function that validates input and delegates to service layer
- Input validation (type guards)
- Error handling (structured errors)

**Never:**
- Do domain logic in handlers (move to `src/domain/` or `src/sessions/`)
- Reach across domains (handlers → their own domain only)
- Mutate global state (use injected interfaces)

### `src/sessions/` — Session orchestration
- Session creation and state transitions
- Message durability (persist before ACK)
- Mid-stream queue (user messages during assistant response)
- OAuth refresh on demand
- Browser pane lifecycle
- Task adoption and cleanup

**Key invariants:**
- A session has exactly one active agent backend subprocess
- Messages are persisted in order before being sent to UI
- Mid-stream user messages are queued, not steeped directly
- Browser panes are released on session end
- Background tasks (workflows) are tracked and cleaned up

### `src/tasks/` — Task lifecycle
- `TaskRunner.ts` — Executes a task spec (DAG + nodes)
- `create-task.ts` — Atomic task + orchestrator creation
- Progress tracking via label updates
- Result handling and cleanup

**TaskRunner invariant:**
- A task run creates an orchestrator session + N worker sessions
- Worker sessions inherit labels, project, sources from task spec
- Orchestrator receives results from workers via `task:progress` and `task:complete` messages
- On task end, orchestrator publishes final result, cleanup happens

### `src/domain/` — Domain logic
Stateless functions for:
- Connection setup (OAuth flow, token refresh)
- Session branching (fork/adopt)
- Browser tool detection
- Title generation and sanitization
- Session browser pane management

### `src/transport/` — WebSocket & HTTP
- `server.ts` — WebSocket server for renderer ↔ main
- `client.ts` — Client connecting to server
- `codec.ts` — Message encoding/decoding
- `push.ts` — Push notifications to UI
- `capabilities.ts` — Browser capability declarations

**Message flow:** Renderer → WS → server → session manager → domain → back to WS → renderer

### `src/services/` — Platform services
- `git-bash.ts` — Execute git commands (user config, etc.)
- `image-utils.ts` — Image processing (resize, format, metadata)
- `vcredist.ts` — VC++ redistributable detection (Windows)
- `search.ts` — Session/message full-text search
- `privileged-execution-broker.ts` — Safe execution of admin operations

### `src/runtime/` — Platform abstraction
- `platform.ts` — Node.js runtime info (CPU, memory, OS)
- `platform-headless.ts` — Headless mode (no GPU, no browser)
- Null implementations for testing

### `src/webui/` — Web-based UI
- `http-server.ts` — Express server for web UI
- `oauth-callback.ts` — OAuth redirect handler
- `auth.ts` — WebUI auth setup
- `node-adapter.ts` — Adapt Node env for WebUI

### `src/bootstrap/` — Initialization
- `index.ts` — App startup sequence
- `headless-start.ts` — Headless mode bootstrap
- Token entropy validation (security check)

### `src/model-fetchers/` — LLM model catalogs
- `anthropic.ts` — Claude model list + capabilities
- `pi.ts` — Pi provider models
- `bedrock.ts` — AWS Bedrock models
- `registry.ts` — Model lookup by ID

Each fetcher returns:
```typescript
{ id, name, contextWindow, costPer1mInputTokens, costPer1mOutputTokens, capabilities }
```

## Source of truth
- Public exports: `packages/server-core/src/index.ts`
- RPC handlers: `packages/server-core/src/handlers/rpc/`
- Domain logic: `packages/server-core/src/domain/`
- Session manager: `packages/server-core/src/sessions/index.ts`
