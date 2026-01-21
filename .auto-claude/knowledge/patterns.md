# Craft Agents - Development Patterns

## 1. Architecture Patterns

### Monorepo Structure (Bun Workspaces)
- **`apps/`**: Application entry points.
  - `electron/`: Desktop App (Main + Preload + Renderer).
  - `viewer/`: Web-based session viewer.
- **`packages/`**: Shared libraries.
  - `core/`: Shared types (Contracts). **Rules**: Pure types/utils only, no heavy deps.
  - `shared/`: Business logic. **Rules**: Contains Agent, Auth, Config, Sources.
  - `ui/`: UI Components. **Rules**: shadcn/ui + Tailwind v4.

### Session Management
- **Isolation**: Sessions are the primary isolation boundary.
- **Mapping**: 1 Session = 1 SDK Session (`sdkSessionId`).
- **Persistence**: Saved as JSONL in `~/.craft-agent/workspaces/{id}/sessions/`.

### State Management
- **Jotai**: Used for global state management across React components.
- **React Query/SWR**: (Implied) for data fetching if applicable, otherwise custom hooks in `shared`.

## 2. Code Patterns

### Message Handling
- **IDs**: ALWAYS use `generateMessageId()` from `@craft-agent/core`.
  - Format: `msg-{timestamp}-{random}`.
- **Roles**: `user`, `assistant`, `tool`, `error`, `status`, `system`.

### Authentication
- **Craft Auth**: `craft_oauth::global` (Only for Craft API).
- **MCP Auth**: `workspace_oauth::{workspaceId}` (Per-server OAuth).
- **Separation**: NEVER mix Craft Auth with MCP Auth.

## 3. Tech Stack Standards
- **Runtime**: Bun (Package Manager & Runtime).
- **Build**: Vite (Renderer) + esbuild (Main/Preload).
- **Styling**: Tailwind CSS v4.
- **Agent SDK**: `@anthropic-ai/claude-agent-sdk`.
