# Craft Agents

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

## How it Works (Video)
To understand what Craft Agents does and how it works watch this video.

[![Demo Video](https://img.youtube.com/vi/xQouiAIilvU/hqdefault.jpg)](https://www.youtube.com/watch?v=xQouiAIilvU)

[Click Here (or on the image above) to watch the video on YouTube →](https://www.youtube.com/watch?v=xQouiAIilvU)


## Why Craft Agents was built
Craft Agents is a tool we built so that we (at craft.do) can work effectively with agents. It enables intuitive multitasking, no-fluff connection to any API or Service, sharing sessions, and a more document (vs code) centric workflow - in a beautiful and fluid UI.

It leans on Claude Code through the Claude Agent SDK - follows what we found great, and improves areas where we've desired improvements.

It's built with Agent Native software principles in mind, and is highly customisable out of the box. One of the first of its kind.

Craft Agents is open source under the Apache 2.0 license - so you are free to remix, change anything. And that's actually possible. We ourselves are building Craft Agents with Craft Agents only - no code editors - so really, any customisation is just a prompt away.

We built Craft Agents because we wanted a better, more opinionated (and preferably non-CLI way) of working with the most powerful agents in the world. We'll continue to improve it, based on our experiences and intuition.

<img width="1578" height="894" alt="image" src="https://github.com/user-attachments/assets/3f1f2fe8-7cf6-4487-99ff-76f6c8c0a3fb" />

## Things that are hard to believe "just work"

**How do I connect to Linear, Gmail, Slack...?**
Tell the agent "add Linear as a source." It finds public APIs and MCP servers, reads their docs, sets up credentials, and configures everything. No config files, no setup wizards.

[Check out how I just connected to Slack →](https://agents.craft.do/s/DRNQEiy8w2e1v5LPgKl8b)

**I already have my MCP config JSON.**
Paste it. The agent handles the rest.

**What about local MCPs?**
Fully supported. Stdio-based MCP servers run as local subprocesses on your machine. Point it at an npx command, a Python script, or any local binary. It just works.

**Can it handle custom APIs?**
Yes. Paste an OpenAPI spec, some endpoint URLs, screenshots of docs, whatever you have. It figures it out and guides you through the rest.

**APIs too? Not just MCPs?**
Craft Agents connects to anything. We have it hooked up to a direct Postgres DB behind a jumpbox. Skills + Sources = magic.

**How do I import my Claude Code skills and MCPs?**
Tell the agent you want to import your skills from Claude Code. It handles the migration.

[Here I imported all my skills in one go →](https://agents.craft.do/s/gWCFqwhObFWaNJIEJmd6j)

**How do I create a new skill?**
Describe what the skill should do, give it context. The agent takes care of the rest.

**Do I need to restart after changes?**
No. Everything is instant. Mention new skills or sources with `@`, even mid-conversation.

**So I can just ask it anything?**
Yes. That's the core idea behind agent-native software. You describe what you want, and it figures out how. That's a good use of tokens.


## Installation

### One-Line Install (Recommended)

**macOS / Linux:**
```bash
curl -fsSL https://agents.craft.do/install-app.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://agents.craft.do/install-app.ps1 | iex
```

### Build from Source

```bash
git clone https://github.com/lukilabs/craft-agents-oss.git
cd craft-agents-oss
bun install
bun run electron:start
```

## Features

- **Multi-Session Inbox**: Desktop app with session management, status workflow, and flagging
- **Claude Code Experience**: Streaming responses, tool visualization, real-time updates
- **Craft MCP Integration**: Access to 32+ Craft document tools (blocks, collections, search, tasks)
- **Sources**: Connect to MCP servers, REST APIs (Google, Slack, Microsoft), and local filesystems
- **Permission Modes**: Three-level system (Explore, Ask to Edit, Auto) with customizable rules
- **Background Tasks**: Run long-running operations with progress tracking
- **Dynamic Status System**: Customizable session workflow states (Todo, In Progress, Done, etc.)
- **Theme System**: Cascading themes at app and workspace levels
- **Multi-File Diff**: VS Code-style window for viewing all file changes in a turn
- **Skills**: Specialized agent instructions stored per-workspace
- **File Attachments**: Drag-drop images, PDFs, Office documents with auto-conversion

## Quick Start

1. **Launch the app** after installation
2. **Choose API Connection**: Use your own Anthropic API key or Claude Max subscription
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

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New chat |
| `Cmd+1/2/3` | Focus sidebar/list/chat |
| `Cmd+/` | Keyboard shortcuts dialog |
| `SHIFT+TAB` | Cycle permission modes |
| `Enter` | Send message |
| `Shift+Enter` | New line |

## Architecture

```
craft-agent/
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
            ├── agent/         # CraftAgent, permissions
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

# Debug logging — see "Troubleshooting > Debug Logging" below
# Logs are automatically enabled in development
```

### Environment Variables

OAuth integrations (Slack, Microsoft) require credentials baked into the build. Create a `.env` file:

```bash
MICROSOFT_OAUTH_CLIENT_ID=your-client-id
SLACK_OAUTH_CLIENT_ID=your-slack-client-id
SLACK_OAUTH_CLIENT_SECRET=your-slack-client-secret
```

**Note:** Google OAuth credentials are NOT baked into the build. Users provide their own credentials via source configuration. See the [Google OAuth Setup](#google-oauth-setup-gmail-calendar-drive) section below.

### Google OAuth Setup (Gmail, Calendar, Drive)

Google integrations require you to create your own OAuth credentials. This is a one-time setup.

#### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Note your Project ID

#### 2. Enable Required APIs

Go to **APIs & Services → Library** and enable the APIs you need:
- **Gmail API** - for email integration
- **Google Calendar API** - for calendar integration
- **Google Drive API** - for file storage integration

#### 3. Configure OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **External** user type (unless you have Google Workspace)
3. Fill in required fields:
   - App name: e.g., "My Craft Agent"
   - User support email: your email
   - Developer contact: your email
4. Add scopes (optional - can leave default)
5. Add yourself as a test user (required for External apps in testing mode)
6. Complete the wizard

#### 4. Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth Client ID**
3. Application type: **Desktop app**
4. Name: e.g., "Craft Agent Desktop"
5. Click **Create**
6. Note the **Client ID** and **Client Secret**

#### 5. Configure in Craft Agent

When setting up a Google source (Gmail, Calendar, Drive), add these fields to your source's `config.json`:

```json
{
  "api": {
    "googleService": "gmail",
    "googleOAuthClientId": "your-client-id.apps.googleusercontent.com",
    "googleOAuthClientSecret": "your-client-secret"
  }
}
```

Or simply tell the agent you want to connect Gmail/Calendar/Drive - it will guide you through entering your credentials.

#### Security Notes

- Your OAuth credentials are stored encrypted alongside other source credentials
- Never commit credentials to version control
- For production use, consider getting your OAuth consent screen verified by Google

## Troubleshooting

### Debug Logging

In development (`bun run electron:start` or `bun run electron:dev`),
debug logging is enabled automatically.
Logs are written to both the console and a log file.

In packaged builds, logs are disabled by default.
To enable them, launch the app with the `--debug` flag:

```bash
# macOS
/Applications/Craft\ Agents.app/Contents/MacOS/Craft\ Agents --debug

# Linux
craft-agents --debug
```

```powershell
# Windows (PowerShell) - from the install directory
& ".\Craft Agents.exe" --debug
```

You can also set the `CRAFT_DEBUG=1` environment variable
to enable debug output from the shared/SDK layer.
(Note: in the desktop app, `--debug` also enables `CRAFT_DEBUG`.)

Logs are written by `electron-log` to a platform-specific app logs directory.
The most reliable way to find the exact path is to launch with `--debug`
and look for the startup line:

```text
Debug mode enabled - logs at: /path/to/log/file.log
```

You can also search for a `Craft Agents` folder within your app-data directory.

### WSL2 Notes

On WSL2, OAuth login (Claude Max / Claude Pro) may fail because Electron's `shell.openExternal`
cannot open a browser on the Windows host by default.

**Fix: install `wslu`** to bridge `xdg-open` to the Windows side:

```bash
sudo apt install wslu
```

Also ensure WSL interop is enabled (it is by default on most distros).
You can verify with:

```bash
cat /proc/sys/fs/binfmt_misc/WSLInterop
```

If you see output (not "No such file"), interop is working.

**Alternative:** If you are running WSLg
(GUI support built into recent Windows 11 builds),
a Linux browser can handle the OAuth redirect directly.
In that case `wslu` is not required,
but you need a browser installed inside WSL.

## Configuration

Configuration is stored at `~/.craft-agent/`:

```
~/.craft-agent/
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

External apps can navigate using `bunnyagents://` URLs:

```
bunnyagents://allChats                    # All chats view
bunnyagents://allChats/chat/session123    # Specific chat
bunnyagents://settings                    # Settings
bunnyagents://sources/source/github       # Source info
bunnyagents://action/new-chat             # Create new chat
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

"Craft" and "Craft Agents" are trademarks of Craft Docs Ltd. See [TRADEMARK.md](TRADEMARK.md) for usage guidelines.

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
