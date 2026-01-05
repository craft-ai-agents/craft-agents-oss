# @craft-agent/tui

Terminal User Interface for Craft Agent - an interactive CLI for managing Craft documents with Claude AI.

## Features

- Streaming AI responses with real-time display
- Tool execution visualization with background task support
- Multi-workspace support with session persistence
- Permission modes (Explore, Ask to Edit, Auto)
- @mention system for activating sub-agents
- Keyboard shortcuts and command history
- File drag-and-drop support
- Markdown rendering with syntax highlighting

## Usage

```bash
# From monorepo root
bun run start              # Interactive mode
bun run dev                # Development with auto-reload

# With options
craft --workspace "Work"   # Select workspace
craft --model claude-opus  # Override model
craft --new                # Start fresh session
craft --debug              # Enable debug logging

# Print mode (non-interactive)
craft -p "list my documents"
craft -p "summarize notes" --output-format json
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help information |
| `/clear` | Clear conversation and start fresh |
| `/tools` | List available MCP tools |
| `/model` | Change AI model |
| `/workspace` | Switch workspace |
| `/settings` | Open settings menu |
| `/cost` | Show token usage and cost |
| `/exit` | Exit the application |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `↑/↓` | Navigate command history |
| `Tab` | Autocomplete @mentions |
| `Ctrl+C` | Cancel current operation |
| `Ctrl+U` | Clear input line |
| `Cmd+←/→` | Jump to line start/end |
| `Option+←/→` | Jump by word |

## Development

```bash
# Type checking
cd apps/tui && bun run typecheck

# Debug mode
bun start --debug
tail -f /tmp/craft-debug.log  # In another terminal
```

## Architecture

This package contains only the terminal-specific UI layer:
- React components using [Ink](https://github.com/vadimdemedes/ink)
- Terminal keyboard handling
- Markdown rendering with Shiki syntax highlighting

Business logic (agent, storage, auth) is imported from the root `src/` directory.

## Dependencies

- `@craft-agent/core` - Shared types
- `@craft-agent/shared` - Business logic (agent, auth, storage)
- `ink` - React for CLIs
- `chalk` - Terminal colors
- `shiki` - Syntax highlighting
