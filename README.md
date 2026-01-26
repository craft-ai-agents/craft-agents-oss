# Vesper

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

Vesper is an open-source AI agent platform built by Tin from Ather Labs. It enables intuitive multitasking, no-fluff connection to any API or Service, sharing sessions, and a more document-centric workflow in a beautiful and fluid desktop experience.

Vesper leverages the Claude Agent SDK and Claude Code, combining what works great while adding significant improvements for agentic workflows. It's built with Agent Native software principles in mind and is highly customizable out of the box—one of the first of its kind.

Vesper is open source under the Apache 2.0 license—you're free to remix and modify anything. We're building Vesper with Vesper itself, no code editors required—any customization is just a prompt away.

We built Vesper because we wanted a better, more opinionated approach to working with the world's most powerful AI agents. We continue to improve it based on real-world usage and intuition.

<img alt="Vesper Main Interface" src="docs/images/vesper-main-interface.png" />

*Multi-session inbox with AI-powered chat, scheduled tasks, and document-centric workflow*

## Installation

### Download Pre-Built Binaries (Recommended)

Download the latest release for your platform from [GitHub Releases](https://github.com/AskTinNguyen/vesper/releases):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `Vesper-arm64.dmg` |
| macOS (Intel) | `Vesper-x64.dmg` |
| Windows | `Vesper-Setup.exe` |
| Linux | `Vesper-x64.AppImage` |

### Build from Source

```bash
git clone https://github.com/AskTinNguyen/vesper.git
cd vesper
bun install
bun run electron:start
```

## Features

- **Multi-Session Inbox**: Desktop app with session management, status workflow, and flagging
- **Claude Code Experience**: Streaming responses, tool visualization, real-time updates
- **Claude Profiles [NEEDS QA & ENGINEER SUPPORT]**: Multi-account OAuth with intelligent automatic switching and real-time usage monitoring (not fully completed, not E2E tested)
- **Command Palette**: Fast navigation with CMD+K command palette for session management
- **Vector Search**: Semantic search over markdown documentation using QMD with collection management
- **Document Viewer**: Integrated document preview for search results with rich formatting
- **Cron Scheduler**: Visual cron-based scheduling with "Edit with AI" for natural language schedule editing
- **Skills Marketplace**: Browse and install skills from skills.sh with one-click installation
- **Team Skills Sync**: Sync shared skills from private GitHub repositories with recursive directory sync and three-tier precedence
- **Terminal Resume**: Resume Claude Agent SDK sessions in external terminal (cross-platform)
- **Session Labels**: Organize sessions with customizable color-coded labels
- **Session Templates**: Reusable session configurations with production-ready reliability and conversational creation
- **Session Sharing**: Share sessions via pluggable backends (craft.do or static HTML export)
- **JSON Rendering**: AI-generated UI components (charts, metrics, buttons, forms, tables) with MCP data binding
- **Inline Flowy Diagrams**: Embedded flowcharts and UI mockups rendered directly in chat messages
- **MCP Integration**: Connect to MCP servers (Craft, Linear, GitHub, Notion, custom)
- **Sources**: Connect to REST APIs (Google, Slack, Microsoft) and local filesystems
- **GitHub OAuth [NEEDS QA & ENGINEER SUPPORT]**: Secure OAuth 2.0 authentication with PKCE for GitHub integration and daily reports (not fully completed, not E2E tested)
- **Slack Integration [NEEDS QA & ENGINEER SUPPORT]**: Connect Slack workspace with Socket Mode for message routing and permission directives (not fully completed, not E2E tested - see [Clawdbot](https://github.com/anthropics/clawdbot) for reference implementation)
- **Telegram Integration [NEEDS QA & ENGINEER SUPPORT]**: Production-ready multi-account bot support with comprehensive reliability features (deduplication, retry logic, debouncing, rate limiting) (not fully completed, not E2E tested - see [Clawdbot](https://github.com/anthropics/clawdbot) for reference implementation)
- **WhatsApp Integration [NEEDS QA & ENGINEER SUPPORT]**: Connect WhatsApp to receive and respond to messages via AI agents with permission directives (not fully completed, not E2E tested - see [Clawdbot](https://github.com/anthropics/clawdbot) for reference implementation)
- **Notification Settings**: Custom notification sounds with volume control and per-type toggles
- **Permission Modes**: Three-level system (Explore, Ask to Edit, Auto) with customizable rules
- **Background Tasks**: Run long-running operations with progress tracking and real-time UI sync
- **Dynamic Status System**: Customizable session workflow states (Todo, In Progress, Done, etc.)
- **Theme System**: 20+ preset themes including 4 premium themes inspired by luxury brands and minimalism (Ivory & Ebony, Sand & Stone, Jade & Midnight, Pure Function) with full OKLCH color space customization
- **Multi-File Diff**: VS Code-style window for viewing all file changes in a turn
- **Skills**: Specialized agent instructions stored per-workspace
- **File Attachments**: Drag-drop images, PDFs, Office documents with auto-conversion

## Quick Start

1. **Launch the app** after installation
2. **Choose billing**: Use your own Anthropic API key or Claude Max subscription
3. **Create a workspace**: Set up a workspace to organize your sessions
4. **Connect sources** (optional): Add MCP servers, REST APIs, or local filesystems
5. **Start chatting**: Create sessions and interact with Claude

## Desktop App Features

### Session Management

- **Inbox/Archive**: Sessions organized by workflow status
- **Flagging**: Mark important sessions for quick access
- **Status Workflow**: Todo → In Progress → Needs Review → Done
- **Session Naming**: AI-generated titles or manual naming
- **Session Persistence**: Full conversation history saved to disk

### Skills Marketplace

Browse and install agent skills from the skills.sh marketplace:

<img alt="Skills Management" src="docs/images/vesper-skills.png" />

*Manage installed skills with detailed metadata, permission modes, and instructions*

1. Navigate to **Skills** in the sidebar
2. Toggle to **Marketplace** view
3. Search for skills by name or description
4. Click **Install** to add skills to your workspace

Skills provide specialized agent instructions for specific tasks like React best practices, code review, and more.

### Team Skills Sync

Share and sync custom skills across your team using GitHub:

**Vesper Desktop App:**
1. Navigate to **Settings** → **Team Skills**
2. Configure your GitHub repository (owner/repo format)
3. Add your GitHub Personal Access Token (encrypted storage)
4. Click **Sync** to download team skills (recursively syncs all subdirectories)

**Claude Code CLI:**
```bash
# Clone and symlink approach (recommended for auto-updates)
git clone https://github.com/your-org/team-skills ~/.claude/team-skills
for skill in ~/.claude/team-skills/*/; do
  if [[ -f "$skill/SKILL.md" ]]; then
    ln -sf "$skill" ~/.claude/skills/
  fi
done
```

**Features:**
- Recursive directory sync for complex skill structures (hooks/, scripts/, references/)
- Three-tier precedence: workspace > team > claude-code
- Encrypted credential storage (AES-256-GCM)
- Cross-platform support (Vesper desktop + Claude Code CLI)

See [Team Skills documentation](docs/user-guide/team-skills.md) for complete installation and usage instructions.

### GitHub OAuth Integration [NEEDS QA & ENGINEER SUPPORT]

> **Note**: This feature is not fully completed and not E2E tested.

Connect your GitHub account for daily reports and repository access:

1. Navigate to **Settings** → **Orchestration** → **GitHub**
2. Configure OAuth credentials (or use environment variables)
3. Click **Connect GitHub Account** to authenticate via OAuth 2.0
4. Set default repository for daily reports

Features OAuth 2.0 with PKCE, automatic token refresh, and secure credential storage.

### Vector Search (Search Docs)

Semantic search over your markdown documentation with collection management:

<img alt="Search Docs" src="docs/images/vesper-search-docs.png" />

*Hybrid search across multiple document collections with BM25 and vector embeddings*

1. Navigate to **Search Docs** in the sidebar
2. Create collections pointing to your markdown directories
3. Search using keyword, semantic, or hybrid mode
4. Results are ranked and displayed with rich previews

### Session Labels

Organize your sessions with customizable labels:

1. Go to **Settings** → **Labels** to manage workspace labels
2. Create labels with custom names and colors (8-color palette)
3. Right-click any session to assign labels
4. Filter sessions by label in the inbox

### Sources

Connect external data sources to your workspace:

<img alt="MCP Sources - GitHub Integration" src="docs/images/vesper-mcp-sources.png" />

*Connect to MCP servers like GitHub with granular tool permissions*

| Type | Examples |
|------|----------|
| **MCP Servers** | Craft, Linear, GitHub, Notion, custom servers |
| **REST APIs** | Google (Gmail, Calendar, Drive), Slack, Microsoft |
| **Local Files** | Filesystem, Obsidian vaults, Git repos |

### Permission Modes

<img alt="Permission Settings" src="docs/images/vesper-permissions.png" />

*Configure granular permission patterns for safe, controlled agent operations*

| Mode | Display | Behavior |
|------|---------|----------|
| `safe` | Explore | Read-only, blocks all write operations |
| `ask` | Ask to Edit | Prompts for approval (default) |
| `allow-all` | Auto | Auto-approves all commands |

Use **SHIFT+TAB** to cycle through modes in the chat interface.

### Terminal Resume

Resume your Vesper session in an external terminal for Claude Code CLI access:

1. Start a session and send at least one message
2. Click the **terminal icon** in the chat input area (appears after working directory badge)
3. A new terminal window opens with your session automatically resumed
4. Works on macOS (Terminal.app), Linux (gnome-terminal, konsole, xterm), and Windows (Windows Terminal, PowerShell, cmd.exe)

### Claude Profiles [NEEDS QA & ENGINEER SUPPORT]

> **Note**: This feature is not fully completed and not E2E tested.

Manage multiple Claude accounts with intelligent automatic switching and real-time usage monitoring:

**Features:**
- **Multi-Account OAuth**: Connect multiple Claude accounts via OAuth 2.0 with PKCE security
- **Real-Time Usage Monitoring**: Track 5-hour and 7-day rolling window usage across all profiles
- **Intelligent Profile Scoring**: Automatically selects best available profile based on usage, limits, and availability
- **Automatic Switching**: Proactive (usage-based) and reactive (error-based) switching modes
- **Configurable Thresholds**: Customize when to switch profiles (default: 95% session, 99% weekly)

**How It Works:**
1. Navigate to **Settings** → **Claude Profiles**
2. Click **Add Profile** and complete OAuth flow
3. Configure auto-switching thresholds and preferences
4. Profiles automatically switch when hitting rate limits or approaching thresholds

**Storage**: OAuth tokens encrypted at `~/.vesper/credentials.enc`, profile metadata at `~/.vesper/claude-profiles/profiles.json`

### Scheduler with AI Editing

Schedule recurring tasks and one-time executions with natural language editing:

<img alt="Schedule Management" src="docs/images/vesper-schedules.png" />

*Create and manage scheduled tasks with execution history and AI-powered editing*

**Features:**
- **"Edit with AI" Button**: Modify schedules using natural language (e.g., "change it to run at 3pm daily")
- **Conversational Editing**: AI agent asks clarifying questions and confirms changes before applying
- **Comprehensive Scheduling**: Hourly, daily, weekdays, weekly, monthly, custom cron, or one-time execution
- **Session Continuation**: Scheduled tasks resume their previous session context
- **Human-Readable Descriptions**: Automatic conversion of cron expressions to readable format

**How It Works:**
1. Create a schedule in **Settings** → **Scheduler**
2. Click **Edit with AI** to modify schedule using natural language
3. Agent parses your request and uses the `schedule_update` tool
4. Confirm changes and see updated schedule with next run time

### Session Templates with AI Creation

Create reusable session configurations with production-ready reliability:

**Features:**
- **Conversational Creation**: Use "Edit with AI" to create templates through natural language
- **Comprehensive Configuration**: Save permission mode, model, thinking level, skills, sources, and working directory
- **Context Gathering**: Optional field for Claude to ask clarifying questions before starting
- **Default Starter Templates**: 6 pre-built templates (Code Review, Feature Build, Bug Investigation, etc.)
- **Production-Ready**: File-based locking, comprehensive error handling, scope validation
- **Real-Time Search**: Filter templates by name and description

**Storage**: Templates stored at `~/.vesper/workspaces/{id}/templates/` with usage tracking

### Telegram Bot Integration [NEEDS QA & ENGINEER SUPPORT]

> **Note**: This feature is not fully completed and not E2E tested. For a production-ready reference implementation, see [Clawdbot](https://github.com/anthropics/clawdbot).

Production-ready Telegram bot with comprehensive reliability features:

**Multi-Account Support:**
- Run multiple bot accounts per workspace with isolated configurations
- Per-account access control and rate limiting
- Backward-compatible with existing single-account setups

**Reliability Features:**
- **Message Deduplication**: Prevents duplicate processing (10-min TTL, dual-key strategy)
- **Inbound Debouncing**: Combines rapid messages within 1.5s window
- **Exponential Backoff**: Intelligent retry with jitter (5 attempts, 1s-30s delays)
- **Auto-Reconnection**: Maintains healthy uptime with automatic recovery

**Access Control:**
- **DM Policies**: disabled, pairing (with approval codes), allowlist, open
- **Group Policies**: disabled, allowlist, open
- **Mention Gating**: Filter group messages by @mention or reply-to-bot
- **Echo Tracking**: Prevents self-reply loops

**UX Enhancements:**
- Typing indicators and message reactions (👀/✅/❌)
- Per-chat rate limiting (token bucket: 5 burst, 0.5 tokens/sec)
- Permission directives (`/safe`, `/ask`, `/allow_all`)

**Test Coverage**: 104 comprehensive tests across backend and E2E (2,706 lines)

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open command palette |
| `Cmd+N` | New chat |
| `Cmd+1/2/3` | Focus sidebar/list/chat |
| `Cmd+/` | Keyboard shortcuts dialog |
| `SHIFT+TAB` | Cycle permission modes |
| `Enter` | Send message |
| `Shift+Enter` | New line |

## Architecture

```
vesper/
├── apps/
│   └── electron/              # Desktop GUI (primary)
│       └── src/
│           ├── main/          # Electron main process
│           ├── preload/       # Context bridge
│           └── renderer/      # React UI (Vite + shadcn)
└── packages/
    ├── core/                  # Shared types
    └── shared/                # Business logic
        └── src/
            ├── agent/         # VesperAgent, permissions
            ├── auth/          # OAuth, tokens
            ├── claude-profiles/ # Multi-account profile management
            ├── config/        # Storage, preferences, themes
            ├── credentials/   # AES-256-GCM encrypted storage
            ├── flowy/         # Inline diagram rendering
            ├── github/        # GitHub OAuth integration
            ├── orchestrate/    # Autonomous coding workflows
            ├── sessions/      # Session persistence
            ├── skills/        # Team skills sync
            ├── slack/         # Slack integration
            ├── sources/       # MCP, API, local sources
            ├── statuses/      # Dynamic status system
            ├── telegram/      # Telegram bot integration
            └── templates/     # Session templates
```

## Development

```bash
# Hot reload development
bun run electron:dev

# Build and run
bun run electron:start

# Type checking
bun run typecheck:all

# Debug logging (writes to ~/Library/Logs/Vesper/)
# Logs are automatically enabled in development
```

### Environment Variables

OAuth integrations (Google, Slack, Microsoft, GitHub) require credentials. Create a `.env` file:

```bash
MICROSOFT_OAUTH_CLIENT_ID=your-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-google-client-secret
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
SLACK_OAUTH_CLIENT_ID=your-slack-client-id
SLACK_OAUTH_CLIENT_SECRET=your-slack-client-secret
GITHUB_OAUTH_CLIENT_ID=your-github-client-id
GITHUB_OAUTH_CLIENT_SECRET=your-github-client-secret
```

See [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and [GitHub OAuth Apps](https://github.com/settings/developers) to create OAuth credentials.

### User Preferences

Personalize Vesper to understand your context and preferences:

<img alt="User Preferences" src="docs/images/vesper-preferences.png" />

*Configure your name, timezone, language, and location for personalized responses*

Navigate to **Settings** → **Preferences** to set:
- **Name**: How Vesper should address you
- **Timezone**: For relative date handling ("tomorrow", "next week")
- **Language**: Preferred language for responses
- **Location**: City and country for regional context
- **Notes**: Free-form context about your preferences

## Configuration

Configuration is stored at `~/.vesper/`:

```
~/.vesper/
├── config.json              # Main config (workspaces, auth type)
├── credentials.enc          # Encrypted credentials (AES-256-GCM)
├── preferences.json         # User preferences
├── theme.json               # App-level theme
├── claude-profiles/         # Claude account profiles and usage data
│   └── profiles.json        # Profile metadata with OAuth tokens
├── team-skills/             # Team skills synced from GitHub
└── workspaces/
    └── {id}/
        ├── config.json      # Workspace settings
        ├── theme.json       # Workspace theme override
        ├── sessions/        # Session data (JSONL)
        ├── sources/         # Connected sources
        ├── skills/          # Custom skills (override team skills)
        ├── statuses/        # Status configuration
        └── templates/       # Session templates
```

## Advanced Features

### Large Response Handling

Tool responses exceeding ~60KB are automatically summarized using Claude Haiku with intent-aware context. The `_intent` field is injected into MCP tool schemas to preserve summarization focus.

### Deep Linking

External apps can navigate using `vesper://` URLs:

```
vesper://allChats                    # All chats view
vesper://allChats/chat/session123    # Specific chat
vesper://settings                    # Settings
vesper://sources/source/github       # Source info
vesper://action/new-chat             # Create new chat
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | [Bun](https://bun.sh/) |
| AI | [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) |
| Desktop | [Electron](https://www.electronjs.org/) + React |
| UI | [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS v4 |
| Build | esbuild (main) + Vite (renderer) |
| Credentials | AES-256-GCM encrypted file storage |

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

### Third-Party Licenses

This project uses the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), which is subject to [Anthropic's Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms).

### Trademark

"Vesper" is a trademark of Ather Labs. See [TRADEMARK.md](TRADEMARK.md) for usage guidelines.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

### Local MCP Server Isolation

When spawning local MCP servers (stdio transport), sensitive environment variables are filtered out to prevent credential leakage to subprocesses. Blocked variables include:

- `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` (app auth)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
- `GITHUB_TOKEN`, `GH_TOKEN`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `STRIPE_SECRET_KEY`, `NPM_TOKEN`

To explicitly pass an env var to a specific MCP server, use the `env` field in the source config.

To report security vulnerabilities, please see [SECURITY.md](SECURITY.md).
