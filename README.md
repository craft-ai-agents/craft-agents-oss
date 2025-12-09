# Craft TUI Agent

A Claude Code-like TUI (Terminal User Interface) agent for Craft documents using the Anthropic SDK and Craft MCP.

## Features

- **Claude Code-like Experience**: Streaming responses, tool visualization, and real-time updates
- **Craft MCP Integration**: Access to 32+ Craft document tools (blocks, collections, search, tasks)
- **Subagents**: Define specialized agents in Craft documents with custom instructions, MCP servers, and REST APIs
- **Dynamic API Integration**: Automatically extract REST APIs from curl examples and create tools
- **Rich Terminal UI**: Built with Ink (React for CLIs)
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
│ Craft TUI Agent - Setup             │
└─────────────────────────────────────┘
Step 1 of 4: Welcome

Welcome to Craft TUI Agent!
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

**Security**: All sensitive credentials (API keys, OAuth tokens) are stored securely in your operating system's native keychain:
- **macOS**: Keychain Access
- **Linux**: Secret Service (GNOME Keyring / KWallet)
- **Windows**: Credential Manager

## Usage

```bash
# Run the TUI agent (shows setup wizard on first run)
craft

# Re-run setup wizard to change configuration
craft --setup

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
| `/setup` | Re-run the configuration wizard |
| `/config` | Show current configuration |
| `/clear` | Clear conversation |
| `/exit` | Exit application |
| `Ctrl+C` | Interrupt / Exit |
| `Up/Down` | Navigate command history |

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

**MCP Servers** (HTTP/HTTPS only):
```yaml
servers:
  - name: myserver
    url: https://example.com/mcp
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
- Parse endpoints, authentication methods, and example parameters
- Create tools like `exa_search` that Claude can use
- Prompt for API keys on first activation

### Using Subagents

```bash
/agent              # List available subagents
/agent myagent      # Activate a subagent
/agent off          # Deactivate current subagent
/info               # Show active agent info and tools
```

### Large Response Handling

API responses are automatically summarized if they exceed ~40KB to prevent context overflow. The summarization:
- Uses Claude Haiku for fast, cheap processing
- Focuses on relevant information based on your search parameters
- Preserves key data points, URLs, and actionable information

## Example Prompts

```
Show me today's daily note
Search for meeting notes about project X
Add a task: Review PR #123
List all my collections
What tasks do I have due this week?
```

## Architecture

```
src/
├── index.tsx           # Entry point with CLI + setup flow
├── agent/
│   └── craft-agent.ts  # Claude Agent SDK wrapper
├── agents/
│   ├── manager.ts      # Subagent management
│   ├── extractor.ts    # Extract agent definitions from docs
│   └── cache.ts        # Agent definition cache
├── credentials/
│   ├── manager.ts      # Keychain credential management
│   └── backends/       # Platform-specific backends
├── mcp/
│   └── tools.ts        # Tool registry
├── tui/
│   ├── App.tsx         # Main application
│   ├── components/
│   │   ├── Setup.tsx   # Setup wizard
│   │   ├── Header.tsx  # Status bar
│   │   ├── Messages.tsx
│   │   ├── Input.tsx
│   │   ├── ToolCall.tsx
│   │   └── Spinner.tsx
│   └── hooks/
│       ├── useAgent.ts
│       └── useHistory.ts
├── prompts/
│   └── system.ts       # System prompt
└── config/
    ├── env.ts          # Environment validation
    └── storage.ts      # Persistent config (~/.craft-agent/)
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
- **MCP**: HTTP transport via Agent SDK
- **Credentials**: [keytar](https://www.npmjs.com/package/keytar) (cross-platform OS keychain access)

## License

MIT
