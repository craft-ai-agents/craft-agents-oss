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
  - **MCP data binding** via `mcp_fetch` action for dynamic content
    - Fetch live data from connected MCP sources
    - Supports both HTTP and stdio MCP transports
    - Automatic authentication handling (OAuth, Bearer tokens)
    - Button actions can trigger MCP tool calls with parameters
  - Chart component with recharts (bar, line, pie, area)
  - DataTable with sorting, filtering, pagination
- **Key Files:**
  - `JSONRenderView.tsx` - Main rendering component with action handlers
  - `catalog.ts` - Component registry with action definitions
  - `packages/shared/src/agent/session-scoped-tools.ts` - render_ui tool
  - `apps/electron/src/main/ipc.ts` - SOURCES_CALL_MCP_TOOL IPC handler

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
  - **Multi-Account Support:** Run multiple bot accounts per workspace with isolated configurations
  - **Access Control:**
    - DM policies: disabled, pairing (with approval codes), allowlist, open
    - Group policies: disabled, allowlist (by chat and user), open
    - Pairing mode generates unique codes for new user approval
  - **Message Processing:**
    - Inbound debouncing: combines rapid messages within 1.5s window (configurable)
    - Deduplication: prevents duplicate processing (10-min TTL, max 2000 cache)
    - Echo tracking: prevents bot from processing its own messages (5-min TTL)
    - Mention gating: filter group messages by @mention, reply-to-bot, or commands
  - **Reliability:**
    - Retry logic with exponential backoff (5 attempts, 1s-30s delays, 25% jitter)
    - Automatic retry for 429 rate limits and 5xx errors
    - Skip retry for 4xx client errors (400, 401, 403, 404)
  - **Other Features:**
    - Bot token authentication (encrypted storage with account-specific keys)
    - Message queue for rate limiting (30 msgs/sec)
    - Per-chat rate limiting (token bucket algorithm: 5 burst, 0.5 tokens/sec)
    - Permission directives (`/safe`, `/ask`, `/allow_all`)
    - Large result handling (4096 char limit, chunking + deep links)
    - Session continuity (same chat+user = same session)
    - Typing indicators and message reactions (👀/✅/❌)
- **Key Files:**
  - `telegram-service.ts` (458 lines) - TelegramService with polling
  - `telegram-ipc.ts` (139 lines) - IPC handlers
  - `message-router.ts` (610 lines) - Message routing and session management
  - `account-manager.ts` (112 lines) - Multi-account support
  - `access-control.ts` (110 lines) - DM/group policies and pairing
  - `debounce.ts` (112 lines) - Inbound message debouncing
  - `deduplication.ts` (101 lines) - Duplicate message prevention
  - `retry.ts` (116 lines) - Exponential backoff with jitter
  - `echo-tracker.ts` (83 lines) - Self-message detection
  - `mention-gate.ts` (41 lines) - Group mention filtering
  - `MULTI_ACCOUNT.md` - Multi-account architecture guide
  - `TelegramSettingsSection.tsx` - Bot configuration UI
- **Storage:**
  - Bot tokens: `~/.vesper/credentials.enc` (key: `telegram_bot_token:{workspaceId}:{accountId}`)
  - Account configs: `~/.vesper/config.json` under `telegramAccounts`
- **Testing:** Comprehensive test suite covering all features in `__tests__/`

### 5. Session Templates
- **Location:** `packages/shared/src/templates/` and `apps/electron/src/renderer/components/templates/`
- **Features:**
  - Create reusable session configuration presets
  - Save templates from existing sessions
  - Store: permission mode, model, thinking level, working directory, skill IDs, task list IDs
  - Optional initial prompt inclusion
  - `gatherContext` field for Claude to ask clarifying questions before starting
  - Default starter templates (Code Review, Feature Build, Bug Investigation, Documentation, Refactoring, Quick Question)
  - Workspace-scoped `templatesEnabled` setting to enable/disable templates per workspace
  - Usage count tracking for popularity sorting
  - Global and workspace-scoped templates
  - File-based locking for concurrent updates
  - Integration with EditPopover for conversational template creation
  - Schedule creation tool for conversational scheduler setup
- **Key Files:**
  - `packages/shared/src/templates/storage.ts` (394 lines) - CRUD, default templates
  - `packages/shared/src/templates/types.ts` (48 lines) - Type definitions with gatherContext
  - `apps/electron/src/main/templates.ts` (140 lines) - IPC handlers, create-defaults
  - `TemplateManager.tsx` - Settings CRUD UI
  - `session-scoped-tools.ts` - schedule_create tool (133 lines)

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

### 7. Team Skills Sync
- **Location:** `packages/shared/src/skills/` and `apps/electron/src/renderer/components/skills/`
- **Features:**
  - Sync shared skills from a private GitHub repository
  - Three-tier skill precedence: workspace > team > claude-code
  - Secure GitHub PAT storage (AES-256-GCM encrypted)
  - On-demand sync with skill count tracking
  - Path traversal protection with strict slug validation
  - Repository URL in config.json, token in encrypted credentials
  - Auto-broadcast skills-changed event after sync
  - Supports multiple URL formats (owner/repo, https://github.com/owner/repo)
- **Skill Sources:**
  - **Workspace:** `~/.vesper/workspaces/{id}/skills/` - Local overrides
  - **Team:** `~/.vesper/team-skills/` - Synced from GitHub
  - **Claude Code:** `~/.claude/skills/` and `~/.claude/commands/` - Built-in
- **GitHub API Integration:**
  - Fetch repository contents via GitHub API v3
  - Download all files in each skill directory
  - 30-second timeout on all requests
  - Sequential download per skill (graceful error handling)
- **Key Files:**
  - `packages/shared/src/skills/storage.ts` - loadTeamSkills(), loadAllSkills()
  - `apps/electron/src/main/ipc.ts` - team-skills:* IPC handlers
  - `TeamSkillsSettingsSection.tsx` - Configuration UI
  - `packages/shared/src/config/paths.ts` - TEAM_SKILLS_DIR constant
- **Security:**
  - Skill ID validation: `/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/`
  - No path traversal (e.g., `../`, `./`)
  - Encrypted PAT storage with type `team_skills_token`
- **Storage:**
  - Team skills: `~/.vesper/team-skills/`
  - Config: `~/.vesper/config.json` → `teamSkillsRepoUrl`
  - Token: `~/.vesper/credentials.enc` (type: `team_skills_token`)
- **Documentation:**
  - `docs/user-guide/team-skills.md` - Setup, usage, migration guide
  - `docs/developer/team-skills-architecture.md` - Technical implementation

### 8. GitHub OAuth Integration
- **Location:** `packages/shared/src/github/` and `apps/electron/src/renderer/components/orchestration/`
- **Features:**
  - OAuth 2.0 authentication with PKCE for enhanced security
  - CSRF state validation to prevent attacks
  - Test connection feature for credential validation
  - Secure credential storage (AES-256-GCM encrypted)
  - Per-workspace GitHub account connections
  - Default repository configuration for daily reports
  - Automatic retry with exponential backoff (3 attempts, jitter)
  - Comprehensive error handling with user-friendly messages
  - Support for environment variable credentials (fallback)
- **OAuth Flow:**
  - Generate PKCE code verifier and challenge
  - Create temporary local callback server
  - Open browser for GitHub authorization
  - Validate state parameter on callback
  - Exchange authorization code for access token
  - Fetch and store user profile information
- **Key Files:**
  - `packages/shared/src/github/oauth.ts` (424 lines) - OAuth flow implementation
  - `GitHubConnectModal.tsx` (231 lines) - OAuth modal dialog
  - `GitHubSettingsSection.tsx` (553 lines) - 3-step setup UI
- **Scopes:**
  - `repo` - Full control of repositories
  - `read:org` - Read organization membership
  - `read:user` - Read user profile data
- **Storage:**
  - OAuth credentials: `~/.vesper/credentials.enc` (type: `github_oauth_client_id`, `github_oauth_client_secret`)
  - Access tokens: `~/.vesper/credentials.enc` (type: `github_access_token`, per workspace)
- **Documentation:**
  - `docs/user-guide/github-integration.md` - Setup guide with troubleshooting
  - `docs/api/github-oauth.md` - API reference and technical details

### 9. Premium Themes
- **Location:** `apps/electron/resources/themes/` and `packages/shared/src/config/theme.ts`
- **Features:**
  - 4 premium themes inspired by luxury brands and minimalism
  - OKLCH color space for perceptually uniform colors
  - Full light and dark mode support
  - 6-color semantic system (background, foreground, accent, info, success, destructive)
  - Surface color overrides for fine-grained control
  - Scenic mode support with background images
- **Premium Themes:**
  - **Ivory & Ebony** - Classic luxury with cognac leather accents (AMAN Hotels inspiration)
  - **Sand & Stone** - Natural elements with terra cotta warmth (Monocle Magazine inspiration)
  - **Jade & Midnight** - Asian-inspired refinement with celadon jade aesthetics
  - **Pure Function** - Dieter Rams minimalism with near-zero chroma
- **Key Files:**
  - `packages/shared/src/config/theme.ts` (401 lines) - Theme types, resolution, CSS generation
  - `apps/electron/resources/themes/ivory-ebony.json` - Ivory & Ebony theme
  - `apps/electron/resources/themes/sand-stone.json` - Sand & Stone theme
  - `apps/electron/resources/themes/jade-midnight.json` - Jade & Midnight theme
  - `apps/electron/resources/themes/pure-function.json` - Pure Function theme
- **Storage:**
  - App-level override: `~/.vesper/theme.json`
  - Preset themes: `apps/electron/resources/themes/*.json`
- **Documentation:**
  - `docs/user-guide/themes.md` - User guide with theme descriptions and customization
  - `docs/developer/theming-architecture.md` - Technical architecture and API reference

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
├── task-lists/             # Task lists storage
│   └── {id}.json           # Individual task lists
├── team-skills/            # Team skills synced from GitHub
│   ├── skill-1/
│   │   └── SKILL.md
│   └── skill-2/
│       └── SKILL.md
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
- `team-skills:*` - Team skills sync from GitHub (setConfig, sync, getStatus)
- `terminal:*` - Terminal spawning for session resume
- `labels:*` - Workspace label management
- `viewer:*` - Viewer backend configuration
- `templates:*` - Session template CRUD operations
- `notification:*` - Notification settings and test notification
- `task-lists:*` - Task list and task CRUD operations (`apps/electron/src/main/task-lists-ipc.ts`)

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
- **Website:** github.com/AskTinNguyen/vesper
- **Repository:** github.com/AskTinNguyen/vesper
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

*Last Updated: 2026-01-26*
*For questions or updates, please refer to the main README.md and CONTRIBUTING.md*
