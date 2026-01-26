# Vesper

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

Vesper is an open-source AI agent platform built by Tin from Ather Labs. It enables intuitive multitasking, no-fluff connection to any API or Service, sharing sessions, and a more document-centric workflow in a beautiful and fluid desktop experience.

Vesper leverages the Claude Agent SDK and Claude Code, combining what works great while adding significant improvements for agentic workflows. It's built with Agent Native software principles in mind and is highly customizable out of the box—one of the first of its kind.

Vesper is open source under the Apache 2.0 license—you're free to remix and modify anything. We're building Vesper with Vesper itself, no code editors required—any customization is just a prompt away.

We built Vesper because we wanted a better, more opinionated approach to working with the world's most powerful AI agents. We continue to improve it based on real-world usage and intuition.

<img width="1578" height="894" alt="image" src="https://github.com/user-attachments/assets/3f1f2fe8-7cf6-4487-99ff-76f6c8c0a3fb" />

## Installation

### One-Line Install (Recommended)

**macOS / Linux:**
```bash
curl -fsSL https://vesper.atherslabs.com/install-app.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://vesper.atherslabs.com/install-app.ps1 | iex
```

### Build from Source

```bash
git clone https://github.com/atherslabs/vesper.git
cd vesper
bun install
bun run electron:start
```

## Features

- **Multi-Session Inbox**: Desktop app with session management, status workflow, and flagging
- **Claude Code Experience**: Streaming responses, tool visualization, real-time updates
- **Command Palette**: Fast navigation with CMD+K command palette for session management
- **Vector Search**: Semantic search over markdown documentation using QMD with collection management
- **Document Viewer**: Integrated document preview for search results with rich formatting
- **Cron Scheduler**: Visual cron-based scheduling with session continuation across executions
- **Skills Marketplace**: Browse and install skills from skills.sh with one-click installation
- **Terminal Resume**: Resume Claude Agent SDK sessions in external terminal (cross-platform)
- **Session Labels**: Organize sessions with customizable color-coded labels
- **Session Templates**: Reusable session configurations with skills, sources, and permission modes
- **Session Sharing**: Share sessions via pluggable backends (craft.do or static HTML export)
- **JSON Rendering**: AI-generated UI components (charts, metrics, buttons, forms, tables) with MCP data binding
- **Inline Flowy Diagrams**: Embedded flowcharts and UI mockups rendered directly in chat messages
- **MCP Integration**: Connect to MCP servers (Craft, Linear, GitHub, Notion, custom)
- **Sources**: Connect to REST APIs (Google, Slack, Microsoft) and local filesystems
- **Slack Integration**: Connect Slack workspace with Socket Mode for message routing and permission directives
- **Telegram Integration**: Connect Telegram bot with message routing and permission controls
- **WhatsApp Integration**: Connect WhatsApp to receive and respond to messages via AI agents with permission directives
- **Notification Settings**: Custom notification sounds with volume control and per-type toggles
- **Permission Modes**: Three-level system (Explore, Ask to Edit, Auto) with customizable rules
- **Background Tasks**: Run long-running operations with progress tracking and real-time UI sync
- **Dynamic Status System**: Customizable session workflow states (Todo, In Progress, Done, etc.)
- **Theme System**: 20+ preset themes including 4 premium themes (Ivory & Ebony, Sand & Stone, Jade & Midnight, Pure Function) with full OKLCH color customization
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

1. Navigate to **Skills** in the sidebar
2. Toggle to **Marketplace** view
3. Search for skills by name or description
4. Click **Install** to add skills to your workspace

Skills provide specialized agent instructions for specific tasks like React best practices, code review, and more.

### Session Labels

Organize your sessions with customizable labels:

1. Go to **Settings** → **Labels** to manage workspace labels
2. Create labels with custom names and colors (8-color palette)
3. Right-click any session to assign labels
4. Filter sessions by label in the inbox

### Sources

Connect external data sources to your workspace:

| Type | Examples |
|------|----------|
| **MCP Servers** | Craft, Linear, GitHub, Notion, custom servers |
| **REST APIs** | Google (Gmail, Calendar, Drive), Slack, Microsoft |
| **Local Files** | Filesystem, Obsidian vaults, Git repos |

### Permission Modes

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
            ├── config/        # Storage, preferences, themes
            ├── credentials/   # AES-256-GCM encrypted storage
            ├── sessions/      # Session persistence
            ├── sources/       # MCP, API, local sources
            └── statuses/      # Dynamic status system
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

OAuth integrations (Google, Slack, Microsoft) require credentials. Create a `.env` file:

```bash
MICROSOFT_OAUTH_CLIENT_ID=your-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-google-client-secret
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
SLACK_OAUTH_CLIENT_ID=your-slack-client-id
SLACK_OAUTH_CLIENT_SECRET=your-slack-client-secret
```

See [Google Cloud Console](https://console.cloud.google.com/apis/credentials) to create OAuth credentials.

## Configuration

Configuration is stored at `~/.vesper/`:

```
~/.vesper/
├── config.json              # Main config (workspaces, auth type)
├── credentials.enc          # Encrypted credentials (AES-256-GCM)
├── preferences.json         # User preferences
├── theme.json               # App-level theme
└── workspaces/
    └── {id}/
        ├── config.json      # Workspace settings
        ├── theme.json       # Workspace theme override
        ├── sessions/        # Session data (JSONL)
        ├── sources/         # Connected sources
        ├── skills/          # Custom skills
        └── statuses/        # Status configuration
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
