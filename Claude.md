# Claude.md - Vesper Project Guide

This file provides guidance to Claude Code (claude.ai/code) when working with the Vesper codebase.

**Important:** Keep this file up-to-date whenever significant functionality changes or new features are added.

## Project Overview

**Vesper** is an open-source AI agent platform built by Tin from Ather Labs. It's a desktop application that enables intuitive multitasking with AI agents through a beautiful, document-centric interface.

Vesper leverages the Claude Agent SDK and Claude Code while adding significant improvements for agentic workflows. It's built with Agent Native software principles and is highly customizable out of the box.

## Recent Major Features (Past 12 Hours)

### 1. JSON Rendering System (AI-Generated UI)
- **Location:** `apps/electron/src/renderer/components/json-render/`
- **Features:**
  - AI-generated interactive UI components inline in chat messages
  - Static components: Card, Stack, Text, Badge, Table, Chart, Metric, DataTable
  - Interactive components: Button, TextField, SelectField
  - Actions: copy, open_url, api_call, mcp_fetch, submit, cancel, refresh
  - MCP data binding via `mcp_fetch` action for dynamic content
  - Chart component with recharts (bar, line, pie, area)
  - DataTable with sorting, filtering, pagination
- **Key Files:**
  - `JSONRenderView.tsx` - Main rendering component
  - `catalog.ts` - Component registry
  - `packages/shared/src/agent/session-scoped-tools.ts` - render_ui tool

### 2. Inline Flowy Diagrams
- **Location:** `apps/electron/src/renderer/components/diagram/` and `packages/shared/src/flowy/`
- **Features:**
  - Create flowcharts and UI mockups directly in chat conversations
  - Auto-detects `flowy-flowchart` and `flowy-mockup` code blocks
  - Interactive inline diagrams with edit capabilities
  - Diagram context preserved on follow-up messages
  - React.memo optimization for all diagram components
  - Security: Zod schema constraints, ReDoS-safe parser, authorization checks
- **Key Files:**
  - `DiagramRenderer.tsx` - Diagram rendering component
  - `FlowyInlineEmbed.tsx` - Inline embed handler
  - `flowy-parser.ts` - Safe parser with validation
  - `packages/shared/src/flowy/` - Schema, templates, types

### 3. Slack Integration (Socket Mode)
- **Location:** `apps/electron/src/main/slack-service.ts` and `packages/shared/src/slack/`
- **Features:**
  - Full Slack messaging integration with Socket Mode
  - Access control (channel/user allowlist, DM policy)
  - Message formatting (mrkdwn escaping, 4000 char chunking)
  - Session continuity across conversations
  - Permission directives (`/ask`, `/allow-all`, `/safe`)
  - Message deduplication (10-min TTL)
  - Inbound debouncing (1.5s window)
  - Thread context resolution
- **Key Files:**
  - `slack-service.ts` (661 lines) - SlackService using @slack/bolt
  - `packages/shared/src/slack/message-router.ts` (202 lines)
  - `SlackSettingsSection.tsx` - Service controls UI

### 4. Telegram Bot Integration
- **Location:** `apps/electron/src/main/telegram-service.ts` and `packages/shared/src/telegram/`
- **Features:**
  - Comprehensive Telegram bot integration with in-process polling
  - Bot token authentication (encrypted storage)
  - Message queue for rate limiting (30 msgs/sec)
  - Per-chat rate limiting (token bucket algorithm)
  - Permission directives (`/safe`, `/ask`, `/allow_all`)
  - Large result handling (4096 char limit, chunking + deep links)
  - Session continuity (same chat+user = same session)
- **Key Files:**
  - `telegram-service.ts` (458 lines) - TelegramService
  - `telegram-ipc.ts` (139 lines) - IPC handlers
  - `packages/shared/src/telegram/message-router.ts` (610 lines)
  - `TelegramSettingsSection.tsx` - Bot configuration UI

### 5. Session Templates
- **Location:** `packages/shared/src/templates/` and `apps/electron/src/renderer/components/templates/`
- **Features:**
  - Create reusable session configuration presets
  - Save templates from existing sessions
  - Store: permission mode, model, thinking level, working directory, skill IDs
  - Optional initial prompt inclusion
  - Usage count tracking for popularity sorting
  - Global and workspace-scoped templates
  - File-based locking for concurrent updates
- **Key Files:**
  - `packages/shared/src/templates/storage.ts` (227 lines)
  - `apps/electron/src/main/templates.ts` (105 lines)
  - `TemplateManager.tsx` - Settings CRUD UI
  - `TemplatePickerDialog.tsx` - Template selection modal

### 6. Notification Settings
- **Location:** `apps/electron/src/renderer/pages/settings/NotificationSettingsSection.tsx`
- **Features:**
  - Granular notification control with custom sounds
  - Master toggle (enable/disable all)
  - Custom notification sound with volume slider (0-100%)
  - Quiet hours configuration
  - Per-type toggles: agent completion, errors, scheduler, messages
  - Web Audio API for volume control
  - Sound preview button
- **Key Files:**
  - `NotificationSettingsSection.tsx` (294 lines)
  - `notification-sound.ts` (99 lines) - Audio playback utilities

## Project Structure

```
vesper/
├── apps/
│   ├── electron/              # Main desktop app (Electron + React)
│   │   └── src/
│   │       ├── main/          # Electron main process (IPC, scheduler, sessions)
│   │       ├── preload/       # Context bridge
│   │       ├── renderer/      # React UI (Vite + shadcn)
│   │       │   ├── atoms/     # Jotai atoms for state management
│   │       │   ├── components/# React components
│   │       │   ├── pages/     # Page components
│   │       │   ├── hooks/     # Custom React hooks
│   │       │   ├── contexts/  # Context providers
│   │       │   └── event-processor/ # Event handling
│   │       └── shared/        # Shared types and utilities
│   └── viewer/                # Document viewer app
├── packages/
│   ├── core/                  # Shared TypeScript types
│   ├── shared/                # Business logic and agent
│   │   ├── src/
│   │   │   ├── agent/         # VesperAgent (Claude Agent SDK wrapper)
│   │   │   ├── auth/          # OAuth and authentication
│   │   │   ├── config/        # Config storage and management
│   │   │   ├── credentials/   # AES-256-GCM encrypted storage
│   │   │   ├── sessions/      # Session persistence
│   │   │   ├── sources/       # MCP servers, APIs, local files
│   │   │   ├── statuses/      # Dynamic status system
│   │   │   ├── skills/        # Custom agent skills
│   │   │   └── ralph-loop/    # Autonomous Ralph Loop workflows
│   ├── ui/                    # Shared UI components
│   └── core/                  # Shared utilities
└── docs/                      # Project documentation

```

## Key Technologies

| Layer | Technology |
|-------|------------|
| Runtime | [Bun](https://bun.sh/) |
| AI | [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) |
| Desktop | [Electron](https://www.electronjs.org/) + React |
| UI | [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS v4 |
| State | [Jotai](https://jotai.org/) for atomic state management |
| Build | esbuild (main) + Vite (renderer) |
| Database | JSONL-based session storage |

## Development Commands

```bash
# Development with hot reload
bun run electron:dev

# Build and run
bun run electron:start

# Type checking
bun run typecheck:all

# Run tests
bun test

# Debug logging (written to ~/Library/Logs/Vesper/)
# Automatically enabled in development
```

## Core Concepts

### Session-Based Architecture
- **Sessions** are the primary boundary for isolation
- Each session maps 1:1 with an SDK session
- Sessions belong to exactly one workspace
- Full conversation history persisted to disk

### Permission Modes (Keyboard: SHIFT+TAB)
| Mode | Behavior |
|------|----------|
| `safe` | Read-only, blocks all write operations |
| `ask` | Prompts for approval (default) |
| `allow-all` | Auto-approves all commands |

### Agent Implementation
- **VesperAgent** wraps the Claude Agent SDK
- Handles MCP server connections
- Manages tool permissions via PreToolUse hook
- Summarizes large responses via PostToolUse hook
- Injects `_intent` field into MCP schemas for context preservation

### State Management
- **Jotai atoms** for local state (command palette, vector search, scheduler)
- **Context providers** for global state (navigation, sessions)
- **IPC events** for main/renderer communication

### Data Flow
1. User interaction in React component
2. Atom updates or IPC call to main process
3. Main process executes logic (scheduler CRUD, session updates)
4. Broadcast events back to renderer
5. Atoms/contexts update, UI re-renders

## File Paths and Config

### User Data (Persistent)
```
~/.vesper/
├── config.json              # Main configuration
├── credentials.enc          # Encrypted API keys
├── preferences.json         # User preferences
├── theme.json              # App theme
└── workspaces/{id}/        # Per-workspace data
    ├── sessions/           # Conversation history
    ├── sources/            # Connected data sources
    ├── skills/             # Custom agent skills
    └── statuses/           # Workflow configuration
```

### Logs
```
~/Library/Logs/Vesper/       # Application logs (macOS)
```

## IPC Messages (main/renderer communication)

Key IPC handlers in `apps/electron/src/main/ipc.ts`:
- `scheduler:*` - Schedule CRUD operations
- `vector-search:*` - Document search operations
- `session:*` - Session management
- `config:*` - Configuration updates
- `source:*` - Data source operations
- `whatsapp:*` - WhatsApp connection and messaging
- `slack:*` - Slack service controls and messaging
- `telegram:*` - Telegram bot configuration and messaging
- `skills-marketplace:*` - Marketplace search, install, and skill details
- `terminal:*` - Terminal spawning for session resume
- `labels:*` - Workspace label management
- `viewer:*` - Viewer backend configuration
- `templates:*` - Session template CRUD operations
- `notification:*` - Notification settings and test notification

## Recent Bug Fixes

1. **JSON Render Tool Matching**: Fixed tool name matching using `endsWith('render_ui')` for SDK-prefixed names
2. **JSON Render API Corrections**: Fixed Renderer props (`components` → `registry`) and ActionProvider (`actions` → `handlers`)
3. **Marketplace Search**: Use `/api/search` endpoint with client-side filtering fallback
4. **Marketplace GitHub Sources**: Add `skillsPath` config for different folder structures (ComposioHQ, anthropics)
5. **Marketplace Scroll**: Add `min-h-0` and `overflow-hidden` for proper flex scrolling
6. **Terminal Resume Session ID**: Accept both Vesper IDs (YYMMDD-word-word) and plain UUIDs
7. **Terminal Shell Script Approach**: Replace AppleScript with shell script for better Electron compatibility
8. **Flowy Security**: Zod constraints, ReDoS-safe parser, authorization checks
9. **Flowy Performance**: React.memo optimization eliminates ~150ms redundant renders
10. **Slack OAuth**: Configurable relay URL, fetch timeout protection, code deduplication
11. **Telegram Rate Limiting**: Per-chat token bucket algorithm (5 burst, 0.5 tokens/sec)
12. **Telegram ReDoS Protection**: Non-greedy regex patterns
13. **Templates File Locking**: File-based locking for concurrent updates
14. **Templates Error Handling**: Categorized errors (NOT_FOUND, INVALID_INPUT, IO_ERROR, CORRUPT_DATA)
15. **E2E Test Infrastructure**: Mock workspace setup, cleanup flags, missing IPC handlers

## Common Tasks

### Adding a New Scheduler Feature
1. Add UI component to `apps/electron/src/renderer/components/scheduler/`
2. Add IPC handler in `apps/electron/src/main/scheduler.ts`
3. Broadcast event from main process for UI sync
4. Update atom in `apps/electron/src/renderer/atoms/`

### Extending Vector Search
1. Add component to `apps/electron/src/renderer/components/vector-search/`
2. Call IPC handler for backend operations
3. Update `vector-search.ts` atom for state

### Adding a New Permission Rule
1. Update `PERMISSION_MODE_CONFIG` in `packages/shared/src/agent/`
2. Implement rule in `mode-manager.ts`
3. Add configuration schema to `permissions-config.ts`

## Branding

- **Product Name:** Vesper
- **Owner:** Tin from Ather Labs
- **Website:** vesper.atherslabs.com
- **Repository:** github.com/atherslabs/vesper
- **Deep Linking:** `vesper://` protocol
- **Configuration Dir:** `~/.vesper/`
- **Logs Dir:** `~/Library/Logs/Vesper/`

## Contributing

When working on Vesper:
1. Keep feature components modular and reusable
2. Use Jotai atoms for local state
3. Broadcast IPC events for main/renderer sync
4. Add appropriate error handling and user feedback
5. Update this Claude.md when adding major features
6. Test permission modes thoroughly

## Related Documentation

- [README.md](README.md) - Project overview and installation
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [SECURITY.md](SECURITY.md) - Security policies
- [TRADEMARK.md](TRADEMARK.md) - Trademark guidelines
- [docs/](docs/) - Additional documentation

---

*Last Updated: 2026-01-25*
*For questions or updates, please refer to the main README.md and CONTRIBUTING.md*
