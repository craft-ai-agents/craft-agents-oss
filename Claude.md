# Claude.md - Vesper Project Guide

This file provides guidance to Claude Code (claude.ai/code) when working with the Vesper codebase.

**Important:** Keep this file up-to-date whenever significant functionality changes or new features are added.

## Project Overview

**Vesper** is an open-source AI agent platform built by Tin from Ather Labs. It's a desktop application that enables intuitive multitasking with AI agents through a beautiful, document-centric interface.

Vesper leverages the Claude Agent SDK and Claude Code while adding significant improvements for agentic workflows. It's built with Agent Native software principles and is highly customizable out of the box.

## Recent Major Features (Past 12 Hours)

### 1. Skills Marketplace Integration
- **Location:** `apps/electron/src/renderer/components/skills/`
- **Features:**
  - Browse and install skills from skills.sh marketplace
  - Search skills with marketplace toggle ("Installed" vs "Marketplace")
  - Preview SKILL.md content fetched from GitHub
  - Smart folder discovery with fallback strategy for mismatched skill IDs
- **Key Files:**
  - `MarketplaceSearchPanel.tsx` - Search interface with install buttons
  - `MarketplaceSkillInfoPage.tsx` - Skill details in right panel
  - `apps/electron/src/main/skills-marketplace.ts` - IPC handlers for marketplace operations
- **Routes:** `skills/marketplace/{source~repo}/{skillId}`

### 2. Terminal Resume Button
- **Location:** `apps/electron/src/renderer/components/app-shell/input/TerminalResumeButton.tsx`
- **Features:**
  - Resume Claude Agent SDK sessions in external terminal window
  - Cross-platform support (macOS Terminal.app, Linux gnome-terminal/konsole/xterm, Windows Terminal/PowerShell/cmd.exe)
  - Security: Session ID validation, path escaping, injection prevention
  - Task list integration via `CLAUDE_CODE_TASK_LIST_ID` environment variable
- **Backend:** `apps/electron/src/main/terminal.ts` (349 lines)
- **UX:** Appears after working directory badge, hidden until session has SDK session ID

### 3. Session Labels
- **Location:** `apps/electron/src/renderer/components/settings/LabelsSettingsSection.tsx`
- **Features:**
  - Create, edit, and delete workspace labels
  - 8-color preset palette matching `LABEL_COLORS`
  - Preview label badge before saving
  - Always-visible Labels submenu in session context menu
- **Integration:** WorkspaceSettingsPage → Mode Cycling section

### 4. Scheduler Session Continuation
- **Location:** `apps/electron/src/main/scheduler.ts`
- **Features:**
  - Reuse `lastRunSessionId` from previous scheduled executions
  - Preserves conversation context across scheduled runs
  - Agent can learn from and reference previous executions
  - Graceful fallback to new session if previous was deleted

### 5. Viewer Backend Abstraction
- **Location:** `packages/shared/src/viewer/`
- **Features:**
  - ViewerService interface with pluggable implementations
  - `CraftHostedViewer` - Default backend (craft.do compatible)
  - `StaticExportViewer` - Generate standalone HTML for any static host
  - Privacy-first and offline-capable session sharing
- **Configuration:** Settings UI for configuring viewer backend
- **Integration:** SessionManager refactored to use ViewerService

### 6. WhatsApp Integration
- **Location:** `apps/electron/src/renderer/components/whatsapp/` and `apps/electron/src/main/whatsapp-*.ts`
- **Features:**
  - QR code authentication via WhatsApp Web
  - Session management and persistence
  - Message routing with permission directives
  - Real-time notifications for incoming messages
- **Key Files:**
  - `WhatsAppSettingsSection.tsx` - Settings UI for WhatsApp connection
  - `whatsapp-service.ts` - Main process WhatsApp service
  - `whatsapp-ipc.ts` - IPC handlers for WhatsApp operations
- **Backend:** `packages/shared/src/whatsapp/`
  - `message-router` - Routes incoming messages
  - `directive-parser` - Parses permission directives from messages
  - `session-mapper` - Maps WhatsApp sessions to Vesper sessions
  - `result-formatter` - Formats agent responses for WhatsApp

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
- `skills-marketplace:*` - Marketplace search, install, and skill details
- `terminal:*` - Terminal spawning for session resume
- `labels:*` - Workspace label management
- `viewer:*` - Viewer backend configuration

## Recent Bug Fixes

1. **Skills Marketplace Folder Discovery**: Smart fallback when skill ID doesn't match GitHub folder name
2. **Labels Submenu**: Always show labels submenu and subscribe to changes
3. **WhatsApp Session Completion**: Wire up session completion callback for message delivery
4. **Slack IPC Static Import**: Fixed build error by moving slack-ipc to static import
5. **TypeScript Test Errors**: Resolved errors in WhatsApp and viewer tests

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

*Last Updated: 2026-01-24*
*For questions or updates, please refer to the main README.md and CONTRIBUTING.md*
