# Claude.md - Vespr Project Guide

This file provides guidance to Claude Code (claude.ai/code) when working with the Vespr codebase.

**Important:** Keep this file up-to-date whenever significant functionality changes or new features are added.

## Project Overview

**Vespr** is an open-source AI agent platform built by Tin from Ather Labs. It's a desktop application that enables intuitive multitasking with AI agents through a beautiful, document-centric interface.

Vespr leverages the Claude Agent SDK and Claude Code while adding significant improvements for agentic workflows. It's built with Agent Native software principles and is highly customizable out of the box.

## Recent Major Features (Past 12 Hours)

### 1. Command Palette (CMD+K)
- **Location:** `apps/electron/src/renderer/components/command-palette/`
- **Shortcut:** `Cmd+K`
- **Functionality:** Fast navigation and session management
- **Files:** `CommandPalette.tsx`, `command-palette.ts` (atoms)

### 2. Vector Search & Semantic Search
- **Location:** `apps/electron/src/renderer/components/vector-search/`
- **Features:**
  - QMD-based semantic search over markdown documentation
  - Collection management with modal dialogs
  - Document viewer for search results
- **Components:**
  - `VectorSearch.tsx` - Main search interface
  - `AddCollectionModal.tsx` - Create/manage collections
  - `CollectionList.tsx` - Display collections
  - `DocumentViewerPage.tsx` - View search results

### 3. Cron Scheduler
- **Location:** `apps/electron/src/renderer/components/scheduler/`
- **Features:**
  - Visual cron builder with time picker
  - Preset schedules (hourly, daily, weekly, monthly)
  - Schedule detail panel with clickable executions
  - Real-time UI sync on CRUD operations
- **Components:**
  - `ScheduleModal.tsx` - Create/edit schedules
  - `ScheduleList.tsx` - List scheduled tasks
  - `ScheduleDetailPanel.tsx` - View schedule details
  - `CronBuilder.tsx` - Visual cron builder
  - `TimePicker.tsx` - Time selection UI
  - `PresetCard.tsx` - Preset schedule templates

### 4. Real-Time UI Sync
- **Broadcast Events:** Scheduler broadcasts CRUD operations for live updates
- **Location:** `apps/electron/src/main/scheduler.ts`
- **Impact:** All connected clients receive immediate updates

### 5. WhatsApp Integration
- **Location:** `apps/electron/src/renderer/components/whatsapp/` and `apps/electron/src/main/whatsapp-*.ts`
- **Features:**
  - QR code authentication via WhatsApp Web
  - Session management and persistence
  - Message routing with permission directives
- **Key Files:**
  - `WhatsAppSettingsSection.tsx` - Settings UI for WhatsApp connection
  - `whatsapp-service.ts` - Main process WhatsApp service
  - `whatsapp-ipc.ts` - IPC handlers for WhatsApp operations
- **Backend:** `packages/shared/src/whatsapp/`
  - `message-router` - Routes incoming messages
  - `directive-parser` - Parses permission directives from messages
  - `session-mapper` - Maps WhatsApp sessions to Vespr sessions
  - `result-formatter` - Formats agent responses for WhatsApp

### 6. GitHub OAuth Settings UI
- **Location:** Settings page
- **Feature:** Users can enter GitHub OAuth credentials directly in the UI
- **Benefit:** Simplified OAuth setup without manual config file editing

## Project Structure

```
vespr/
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

# Debug logging (written to ~/Library/Logs/Vespr/)
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
~/.vespr/
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
~/Library/Logs/Vespr/       # Application logs (macOS)
```

## IPC Messages (main/renderer communication)

Key IPC handlers in `apps/electron/src/main/ipc.ts`:
- `scheduler:*` - Schedule CRUD operations
- `vector-search:*` - Document search operations
- `session:*` - Session management
- `config:*` - Configuration updates
- `source:*` - Data source operations
- `whatsapp:*` - WhatsApp connection and messaging

## Recent Bug Fixes

1. **QMD CLI Integration**: Resolved issues with QMD document vectorization
2. **Ralph Loop Security**: Added hardening and memory leak prevention
3. **Dark Mode Support**: Fixed markdown overlay rendering in dark mode
4. **Global Skills Loading**: Auto-create plugin manifest for SDK integration
5. **Dropdown Aria-Hidden Dialog Conflict**: Fixed accessibility conflict between dropdown menus and dialog components

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

- **Product Name:** Vespr (not Vesper)
- **Owner:** Tin from Ather Labs
- **Website:** vespr.atherslabs.com
- **Repository:** github.com/atherslabs/vespr
- **Deep Linking:** `vespr://` protocol
- **Configuration Dir:** `~/.vespr/`
- **Logs Dir:** `~/Library/Logs/Vespr/`

## Contributing

When working on Vespr:
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

*Last Updated: 2026-01-23*
*For questions or updates, please refer to the main README.md and CONTRIBUTING.md*
