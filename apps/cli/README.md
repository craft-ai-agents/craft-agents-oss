# Craft Agents CLI

A command-line interface for Craft Agents, wrapping the Claude Agent SDK CLI for reliable execution.

## Installation

```bash
# From the monorepo root
bun install

# Run directly
bun run apps/cli/src/index.ts --help

# Or create an alias
alias craft="bun run /path/to/craft-agents-oss/apps/cli/src/index.ts"
```

## Configuration

### API Key

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or configure in the Craft Agents desktop app (stored in encrypted credentials).

### Workspaces

The CLI uses the same workspace configuration as the desktop app:

```bash
# List available workspaces
craft --list-workspaces

# Use a specific workspace
craft -w "My Workspace" "your prompt here"
```

## Usage

```bash
# Simple prompt (uses print mode by default)
craft "What is 2+2?"

# List files in workspace directory
craft "List the files in the current directory"

# Use specific workspace
craft -w my-project "Explain the codebase structure"

# Continue previous conversation
craft -c "Tell me more"

# Interactive mode (no prompt)
craft

# Restrict allowed tools
craft -a "Bash(git:*) Read" "Show git status"

# Verbose output
craft -v "What time is it?"
```

## Options

| Option | Short | Description |
|--------|-------|-------------|
| `--workspace <name\|id>` | `-w` | Use specific workspace |
| `--model <model>` | `-m` | Model to use (default: claude-sonnet-4-5-20250929) |
| `--continue` | `-c` | Continue the most recent conversation |
| `--print` | `-p` | Print mode (non-interactive, single response) |
| `--allowedTools <tools>` | `-a` | Tools to allow (e.g., "Bash(git:*) Edit") |
| `--list-workspaces` | `-l` | List available workspaces |
| `--verbose` | `-v` | Verbose output |
| `--help` | `-h` | Show help |

## Behavior

- **With prompt**: Runs in print mode (single response, non-interactive)
- **Without prompt**: Runs in interactive mode
- **With `-c`**: Continues the most recent conversation

## Examples

### Quick calculations
```bash
craft "What is 15% of 230?"
```

### Code exploration
```bash
craft "Explain the main entry point of this project"
craft "Find all TODO comments in the codebase"
```

### Git operations
```bash
craft -a "Bash(git:*)" "Show recent commits"
craft -a "Bash(git:*)" "What changed in the last commit?"
```

### Continue conversation
```bash
craft "Explain React hooks"
craft -c "Give me an example of useEffect"
```

## Architecture

This CLI wraps the Claude Agent SDK CLI (`@anthropic-ai/claude-agent-sdk`) for reliable subprocess execution:

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   craft     │────▶│   SDK CLI       │────▶│   Claude API    │
│  (wrapper)  │     │   (subprocess)  │     │                 │
└─────────────┘     └─────────────────┘     └─────────────────┘
```

The wrapper:
1. Loads workspace configuration from `~/.craft-agent/`
2. Finds the API key from env or credential store
3. Spawns the SDK CLI with proper arguments
4. Passes through stdin/stdout/stderr

## Troubleshooting

### "No Anthropic API key configured"
Set `ANTHROPIC_API_KEY` environment variable or configure in the desktop app.

### "Workspace not found"
Use `--list-workspaces` to see available workspaces, or omit `-w` to use the active/first workspace.

### "Could not find Claude Agent SDK CLI"
Make sure dependencies are installed: `bun install` from the monorepo root.
