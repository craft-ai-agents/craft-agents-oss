# Craft Agent

A Claude Code-like agent for Craft documents using the Anthropic SDK and Craft MCP.

## Features

- **Claude Code-like Experience**: Streaming responses, tool visualization, and real-time updates
- **Craft MCP Integration**: Access to 32+ Craft document tools (blocks, collections, search, tasks)
- **Subagents**: Define specialized agents in Craft documents with custom instructions, MCP servers, and REST APIs
- **Dynamic API Integration**: Automatically extract REST APIs from documentation and create flexible tools
- **Permission Modes**: Three-level system (Explore, Ask to Edit, Auto) with customizable rules
- **Background Tasks**: Run long-running operations in the background with progress tracking
- **Dynamic Status System**: Workspace-customizable session workflow states (Todo, In Progress, etc.)
- **Theme System**: Cascading themes at app, workspace, and agent levels
- **Multi-File Diff**: VS Code-style window for viewing all file changes in a turn (Electron)
- **Rich Terminal UI**: Built with Ink (React for CLIs)
- **Ultrathink Mode**: Type "ultrathink" in your message for extended thinking
- **Command History**: Navigate previous inputs with arrow keys
- **Slash Commands**: `/help`, `/tools`, `/setup`, `/clear`, `/agent`, `/info`, `/exit`
- **Interactive Setup**: First-run wizard to configure API keys and MCP connection

## Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Anthropic API Key](https://console.anthropic.com/)
- Craft MCP server running (with valid workflow link)

## Installation

```bash
# Clone the repository
git clone https://github.com/lukilabs/craft-terminal-agent.git
cd craft-tui-agent

# Install dependencies
bun install

# Install globally (creates 'craft' command)
bun link
```

After linking, you can run `craft` from anywhere in your terminal.

## First Run Setup

On first run, you'll be guided through an interactive setup wizard:

```
┌─────────────────────────────────────┐
│ Craft Agent - Setup                 │
└─────────────────────────────────────┘
Step 1 of 4: Welcome

Welcome to Craft Agent!
You'll need:
• An Anthropic API key (from console.anthropic.com)
• Your Craft MCP server URL (workflow link)
• A bearer token for authentication

Press Enter to continue...
```

The wizard will ask for:
1. **Anthropic API Key** - Get one from [console.anthropic.com](https://console.anthropic.com)
2. **Craft MCP URL** - Your workflow link URL (e.g., `http://localhost:3000/v1/links/abc123/mcp`)
3. **Bearer Token** - Authentication token for your MCP server

Configuration is saved to `~/.craft-agent/config.json`

**Security**: All sensitive credentials (API keys, OAuth tokens) are stored in an AES-256-GCM encrypted file at `~/.craft-agent/credentials.enc`. The encryption key is derived from your machine identity using PBKDF2, providing the same security model as OS keychains without requiring system keychain prompts.

## Usage

```bash
# Run the agent (shows setup wizard on first run)
craft

# Override config with CLI options
craft --url http://localhost:3000/v1/links/abc123/mcp

# Show help
craft --help

# Development mode (auto-reload)
bun dev
```

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help message |
| `/tools` | List available Craft MCP tools |
| `/agent` | List, activate, or deactivate subagents |
| `/info` | Show active agent info and available tools |
| `/safe` | Toggle Explore mode (read-only) |
| `/setup` | Re-run the configuration wizard |
| `/safemode` | Toggle Safe Mode (require approval for delete/update/move) |
| `/clear` | Clear conversation (keeps session, starts fresh with Claude) |
| `/new` | Start a new session |
| `/resume` | View and resume previous sessions |
| `/exit` | Exit application |
| `Ctrl+C` | Interrupt / Exit |
| `Ctrl+D` | Exit application (same as `/exit`) |
| `Ctrl+L` | Clear conversation (same as `/clear`) |
| `Ctrl+S` | Toggle Safe Mode (same as `/safemode`) |
| `Up/Down` | Navigate command history |
| `SHIFT+TAB` | Cycle permission modes |

## Headless Mode (Non-Interactive)

Headless mode allows running Craft Agent in scripts, CI/CD pipelines, and automation workflows without user interaction.

### Basic Usage

```bash
# Execute a single prompt and exit
craft --print "List all documents in my workspace"

# With JSON output for parsing
craft --print "Search for meeting notes" --output-format json

# Streaming JSON for real-time processing
craft --print "Summarize today's tasks" --output-format stream-json

# Use a specific workspace
craft --print "What tasks are due?" --workspace my-workspace

# Use a specific subagent
craft --print "Search for TypeScript tutorials" --agent researcher
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--print, -p <query>` | Execute prompt and exit (enables headless mode) |
| `--output-format <fmt>` | Output: `text` (default), `json`, `stream-json` |
| `--permission-policy` | Bash permissions: `deny-all` (default), `allow-safe`, `allow-all` |
| `--session-resume` | Resume last session instead of starting fresh |
| `--session <id>` | Use explicit session ID (for workflow management) |
| `--workspace, -w <name>` | Use specific workspace |
| `--agent, -a <name>` | Activate specific subagent |
| `--model, -m <model>` | Override model selection |

### Permission Policies

| Policy | Behavior |
|--------|----------|
| `deny-all` | Block all bash commands (safest, default) |
| `allow-safe` | Allow read-only commands (ls, cat, grep, find, etc.) |
| `allow-all` | Allow all commands (use with caution) |

### Output Formats

**text** (default): Plain text response
```bash
craft --print "What's in my inbox?"
# Output: You have 3 tasks in your inbox...
```

**json**: Structured JSON with response, tool calls, and usage
```bash
craft --print "List tasks" --output-format json
# Output: {"success":true,"response":"...","toolCalls":[...],"usage":{...}}
```

**stream-json**: Newline-delimited JSON events for real-time processing
```bash
craft --print "Summarize document" --output-format stream-json
# Output: {"type":"status","message":"Processing..."}
#         {"type":"text_delta","text":"The document..."}
#         {"type":"complete","result":{...}}
```

### Permission Policy in Headless Mode

In headless mode, the permission system uses `--permission-policy` instead of interactive mode selection. Use `allow-all` for full automation or `allow-safe` for read-only operations.

### Session Management

By default, each headless run starts with a fresh session. For multi-turn conversations:

```bash
# Resume the last session
craft --print "Continue where we left off" --session-resume

# Use explicit session ID (for external workflow management)
craft --print "Step 1" --session my-workflow-123
craft --print "Step 2" --session my-workflow-123
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (auth required, agent not found, execution error) |

## Permission Modes

Three-level permission system that controls what operations Claude can perform:

| Mode | Display Name | Behavior |
|------|--------------|----------|
| `'safe'` | Explore | Read-only, blocks all write operations |
| `'ask'` | Ask to Edit | Prompts for bash commands (default) |
| `'allow-all'` | Auto | Auto-approves all commands |

### When to Use Each Mode

- **Explore (safe)**: Exploring unfamiliar codebases, understanding code, reviewing plans
- **Ask to Edit (ask)**: Normal development with approval for sensitive commands
- **Auto (allow-all)**: Trusted automation, running tests, builds

### What's Blocked in Explore Mode

| Blocked | Allowed |
|---------|---------|
| `Bash`, `Write`, `Edit` | `Read`, `Glob`, `Grep` |
| API calls (`api_*`) | `Task` (research agents) |
| Craft MCP write tools | `WebSearch`, `WebFetch`, `TodoWrite` |

### Usage

```bash
SHIFT+TAB   # Cycle through modes
/safe       # Toggle explore mode
```

The header shows the current mode indicator.

### Customizable Permissions

Each workspace, source, and agent can have a `permissions.json` file with custom rules:
- `blockedTools` - Additional tools to block
- `allowedBashPatterns` - Regex patterns for safe bash commands
- `allowedMcpPatterns` - Regex patterns for allowed MCP tools
- `allowedWritePaths` - Glob patterns for writable directories

## Safe Mode

Safe Mode is an opt-in feature that requires explicit user approval before executing potentially destructive MCP operations.

### Protected Operations

When Safe Mode is enabled, the following operations require approval:
- **Delete**: `blocks_delete`, `collectionItems_delete`, `tasks_delete`
- **Update**: `blocks_update`, `collectionItems_update`, `tasks_update`
- **Move**: `blocks_move`

### Usage

```bash
Ctrl+S              # Toggle Safe Mode on/off
/safemode           # Toggle Safe Mode on/off
/settings           # Also available in Settings menu
```

When a protected operation is triggered:
1. A permission prompt appears with the operation details
2. Press `Y` to allow or `N` to deny
3. Unlike bash commands, there's no "Always allow" option - each operation requires individual approval

Safe Mode is **off by default** to avoid disrupting existing workflows. Enable it when working with important documents where you want extra confirmation before modifications.

The header shows `🛡 SAFE` indicator when Safe Mode is active.

## Keyboard Shortcuts

Standard terminal/readline shortcuts for efficient text editing:

| Shortcut | Mac | Linux | Action |
|----------|-----|-------|--------|
| `Cmd+Left` / `Ctrl+A` | ✅ | ✅ | Jump to line start |
| `Cmd+Right` / `Ctrl+E` | ✅ | ✅ | Jump to line end |
| `Option+Left` | ✅ | - | Jump to previous word |
| `Option+Right` | ✅ | - | Jump to next word |
| `Option+Delete` | ✅ | - | Delete word backward |
| `Ctrl+W` | ✅ | ✅ | Delete word backward |
| `Ctrl+Backspace` | - | ✅ | Delete word backward |
| `Alt+D` / `Option+D` | ✅ | ✅ | Delete word forward |
| `Ctrl+Delete` | - | ✅ | Delete word forward |
| `Ctrl+K` | ✅ | ✅ | Kill to end of line |
| `Ctrl+U` | ✅ | ✅ | Clear entire line |
| `Shift+Enter` / `Alt+Enter` | ✅ | ✅ | Insert newline (multiline) |
| `Shift+Arrow` | ✅ | ✅ | Text selection |

> **Note:** Mac keyboards have a "Delete" key (acts as backspace) but no "Backspace" key.

## Available Craft Tools

### Read-Only
- `blocks_get` - Fetch document content
- `document_search` - Search within document
- `dailyNotes_search` - Search across daily notes
- `documents_search` - Multi-document search
- `collections_list` - List all collections
- `collectionSchema_get` - Get collection schema
- `collectionItems_get` - Get collection items
- `tasks_get` - Query tasks
- `documents_list` - List documents

### Write
- `blocks_add`, `blocks_update`, `blocks_move`
- `markdown_add`
- `collections_create`, `collectionSchema_update`
- `collectionItems_add`, `collectionItems_update`
- `tasks_add`, `tasks_update`

### Destructive
- `blocks_delete`
- `collectionItems_delete`
- `tasks_delete`

## Subagents

Subagents are specialized agents defined in Craft documents. They extend the base agent with custom instructions, MCP servers, and REST APIs.

### Defining a Subagent

Create a Craft document with an "Instructions" section containing the agent's system prompt. You can also include:

**MCP Servers** (HTTP, SSE, or stdio):
```yaml
servers:
  - name: myserver
    url: https://example.com/mcp
  - name: filesystem
    transport: stdio
    command: npx
    args: ["-y", "@anthropic/mcp-server-filesystem"]
```

**REST APIs** (detected from various sources):
```bash
# Curl examples
curl -X POST https://api.exa.ai/search \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"query": "search query", "numResults": 10}'

# Or fetch/axios calls, inline API docs, or links to API documentation
```

The extractor will automatically:
- Detect APIs from curl examples, fetch calls, axios requests, or API documentation
- Extract authentication methods (header, bearer, query, basic, or public)
- Generate comprehensive markdown documentation for Claude
- Create a single flexible tool (`api_{name}`) that Claude uses with the documentation
- Prompt for API credentials on first activation (with custom labels when provided)

### Using Subagents

```bash
/agent              # List available subagents
/agent myagent      # Activate a subagent
/agent off          # Deactivate current subagent
/info               # Show active agent info and tools
```

### Large Response Handling & Intent-Aware Summarization

Tool responses (from MCP tools, REST APIs, etc.) that exceed ~60KB are automatically summarized using Claude Haiku to prevent context overflow.

**The Problem:** A generic summarizer doesn't know what information is relevant. If you ask "What did John say about the budget?" and the tool returns a 100-page document, how does the summarizer know to focus on John's budget comments?

**The Solution:** The `_intent` field is enforced via schema modification. The fetch interceptor injects `_intent` into every MCP tool's schema in the Anthropic API request, so the model MUST include it.

```javascript
mcp__craft__document_search({
  query: "Q3 budget",
  _intent: "Finding John's budget comments in Q3 meeting notes"
})
```

This intent is:
1. **Enforced** - Schema modification ensures the model includes it
2. **Displayed in the UI** - You see exactly what the model is doing
3. **Passed to the summarizer** - Haiku knows to focus on John + budget
4. **Clean** - Stripped before forwarding to MCP server

**Example UI Output:**
```
⠋ Craft Read Document Finding John's budget comments in Q3 meeting...
✓ Craft Read Document Finding John's budget comments... (2.3s)
```

This system ensures large documents are summarized with the right focus, and users always know what the agent is doing.

## Example Prompts

```
Show me today's daily note
Search for meeting notes about project X
Add a task: Review PR #123
List all my collections
What tasks do I have due this week?
```

## Architecture

This is a Bun-based monorepo with shared business logic and multiple interfaces:

```
craft-tui-agent/
├── apps/
│   ├── electron/              # Desktop GUI app
│   │   └── src/
│   │       ├── main/          # Electron main process
│   │       ├── preload/       # Context bridge
│   │       └── renderer/      # React UI (Vite + shadcn)
│   └── tui/                   # Terminal interface (CLI)
│       └── src/
│           ├── components/    # Ink/React components (PlanMenu, PlanReview, etc.)
│           ├── hooks/         # useAgent, useAgentState, useCommands
│           ├── keyboard/      # Keyboard handling
│           └── utils/         # Terminal utilities
└── packages/
    ├── core/                  # Shared types (Workspace, Session, Message)
    └── shared/                # Shared business logic
        └── src/
            ├── agent/         # CraftAgent, session-scoped-tools, permissions
            ├── agents/        # Agent management, API tools
            ├── auth/          # OAuth, tokens, state
            ├── config/        # Storage, preferences, themes
            ├── credentials/   # AES-256-GCM encrypted storage
            ├── sessions/      # Session persistence
            ├── sources/       # MCP, API, local sources
            └── statuses/      # Dynamic status system
```

## Development

```bash
# Type checking
bun run typecheck

# Run in watch mode
bun dev

# Debug logging (writes to /tmp/craft-debug.log)
craft --debug
```

### Development Secrets (1Password)

Development secrets (Gmail OAuth, etc.) are synced from 1Password to a local `.env` file. This keeps secrets out of the repo while making setup easy.

**One-time setup:**

```bash
# 1. Install 1Password CLI
brew install 1password-cli

# 2. Enable CLI integration: 1Password app → Settings → Developer → CLI Integration

# 3. Sync secrets to .env (requires Touch ID / 1Password unlock once)
bun run sync-secrets
```

**That's it!** Now `bun run electron:dev` and `bun run electron:start` work without prompts.

**When to re-sync:**
- After cloning the repo
- When secrets are rotated in 1Password
- When new secrets are added to `.env.1password`

**How it works:**
- `.env.1password` contains `op://` references (safe to commit)
- `bun run sync-secrets` resolves references → writes `.env` (gitignored)
- Build scripts source `.env` automatically

### Debugging

Debug logging is disabled by default. Enable it with the `--debug` flag:

```bash
# Terminal 1: Run the app with debug logging
craft --debug

# Terminal 2: Watch logs in real-time
tail -f /tmp/craft-debug.log
```

This two-terminal setup lets you interact with the app while seeing debug output stream in real-time.

### Extracting Claude Code System Prompts

Tools for extracting and comparing Claude Code system prompts across SDK versions. Useful for tracking changes to the underlying system prompt.

```bash
# Extract system prompt from current SDK version
bun run scripts/system-prompt/extract.ts
# Output: exported_prompts/claude-code/v{version}.md

# Compare two versions (auto-detects most recent if no args)
bun run scripts/system-prompt/compare.ts
bun run scripts/system-prompt/compare.ts v0.1.62 v0.1.73
```

**How it works:**
1. A fetch interceptor (`scripts/system-prompt/capture-interceptor.ts`) is loaded via `bunfig.toml` preload
2. The extraction script runs a minimal SDK query with the `claude_code` preset
3. The interceptor captures the system prompt from the API request and writes it to a temp file
4. The extraction script formats and saves the prompt to `exported_prompts/claude-code/v{version}.md`

**To extract a different SDK version:**
1. Edit `package.json` to pin the desired version (e.g., `"@anthropic-ai/claude-agent-sdk": "0.1.62"`)
2. Run `rm -f bun.lockb && bun install`
3. Run `bun run scripts/system-prompt/extract.ts`
4. Restore the original version and reinstall

## Releasing

Releases are built and deployed via GitHub Actions.

### Creating a Release

1. Go to [Actions → Build and Upload](https://github.com/lukilabs/craft-terminal-agent/actions/workflows/build-and-upload.yml)
2. Click **"Run workflow"**
3. Enter the version number (e.g., `1.0.1`)
4. Options:
   - **"Also upload to /latest folder"** → Check this to make it the default version users get
   - **"Also upload install.sh to bucket root"** → Check this if you updated the install script
5. Click **"Run workflow"**

The workflow will:
- Build native binaries for all platforms (darwin-arm64, darwin-x64, linux-x64, linux-arm64)
- Upload tarballs and manifest to `agents.craft.do/<version>/`
- Optionally update `/latest` to point to this version

### Testing a Release

After the workflow completes, users can install with:

```bash
curl -fsSL https://agents.craft.do/install.sh | bash
```

### Testing a Fresh Install

Use the uninstall script to completely remove Craft Agent:

```bash
bash scripts/uninstall.sh
```

This removes:
- Binary from `~/.local/bin/craft`
- Bun-linked version (if exists)
- Config and credentials (`~/.craft-agent`)
- PATH entries from shell configs (`.zshrc`, `.bashrc`, etc.)

Then open a **new terminal** and run the install script to test.

### Keyboard Handling

When handling Ctrl+key shortcuts in Ink's raw terminal mode, always check for both forms:
- High-level: `key.ctrl && input === 'c'`
- Raw character: `input === '\x03'` (Ctrl+C = ASCII 3)

Different terminals may deliver only the raw character without setting `key.ctrl`. See `apps/tui/src/keyboard/mappings.ts` for canonical implementations.

## Ultrathink Mode

Include the word "ultrathink" anywhere in your message to enable extended thinking mode. This sets `maxThinkingTokens` based on the model, allowing Claude to think more deeply about complex problems.

**Thinking tokens by model:**
| Model | Thinking Tokens |
|-------|-----------------|
| Opus | 64,000 |
| Sonnet | 64,000 |
| Haiku | 8,000 |

**How it works:**
- The keyword "ultrathink" is detected (case-insensitive) and stripped from the message sent to Claude
- The word appears with a cyan→magenta→cyan gradient while typing
- During processing, a gradient "ultrathink" label appears in the thinking indicator
- Extended thinking is single-shot (only applies to that message)

**When to use:**
- Complex reasoning or multi-step problems
- Code architecture decisions
- Difficult debugging scenarios
- Tasks requiring deep analysis

**Example:**
```
ultrathink How should I refactor this authentication system to support OAuth2?
```

## Extended Prompt Cache

The app can extend Anthropic's prompt cache TTL from 5 minutes to 1 hour, beneficial for longer conversations where you may not respond within 5 minutes.

**Default behavior:** 1-hour cache is enabled for **Opus models only**. Other models use the standard 5-minute cache.

**Pricing:**
- 5-minute cache: 1.25x write cost, 0.1x read cost
- 1-hour cache: 2x write cost, 0.1x read cost

The 2x write cost is negligible for expensive Opus models but significant for cheaper models like Sonnet.

**To override:**
Add to `~/.craft-agent/config.json`:
```json
{ "extendedCacheTtl": true }   // Force 1h for all models
{ "extendedCacheTtl": false }  // Force 5m for all models
```

## Trace Viewer & Langsmith Upload

A standalone utility to view SDK session transcripts and upload them to Langsmith for analysis.

```bash
# List recent sessions
bun tools/langsmith-upload.ts

# View last session (ergonomic - no ID needed)
bun tools/langsmith-upload.ts view

# View specific session (partial ID match)
bun tools/langsmith-upload.ts view abc123

# Output as JSON
bun tools/langsmith-upload.ts view --json

# Upload to Langsmith
LANGSMITH_API_KEY=ls-... bun tools/langsmith-upload.ts upload

# Upload with custom project name
LANGSMITH_API_KEY=ls-... bun tools/langsmith-upload.ts upload --project "My Project"
```

Session transcripts are stored by the Claude Agent SDK at:
```
~/.claude/projects/-{encoded-project-path}/{sessionId}.jsonl
```

**Environment Variables:**
- `LANGSMITH_API_KEY` - Required for upload (get from Langsmith settings)
- `LANGSMITH_ENDPOINT` - Optional, defaults to `https://api.smith.langchain.com`

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **AI**: [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- **TUI**: [Ink](https://github.com/vadimdemedes/ink) (React for CLIs)
- **MCP**: HTTP, SSE, and stdio transports via Agent SDK
- **Credentials**: AES-256-GCM encrypted file storage

## License

MIT
