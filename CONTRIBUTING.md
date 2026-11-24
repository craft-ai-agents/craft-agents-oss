# Contributing to Craft Agents

Thank you for your interest in contributing to Craft Agents! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime
- Node.js 18+ (for some tooling)
- macOS, Linux, or Windows

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/craft-ai-agents/craft-agents-oss.git
   cd craft-agents-oss
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. Run in development mode:
   ```bash
   bun run electron:dev
   ```

## Development Workflow

### Branch Naming

Use descriptive branch names:
- `feature/add-new-tool` - New features
- `fix/resolve-auth-issue` - Bug fixes
- `refactor/simplify-agent-loop` - Code refactoring
- `docs/update-readme` - Documentation updates

### Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Run type checking: `bun run typecheck:all`
4. Commit your changes with clear, descriptive messages
5. Push to your fork and create a pull request

### Code Style

- We use TypeScript throughout the codebase
- Follow existing patterns in the codebase
- Use meaningful variable and function names
- Add comments for complex logic

### Type Checking

Before submitting a PR, ensure all type checks pass:

```bash
bun run typecheck:all
```

CI runs `validate:ci`, which adds the shared package tests, the document-tool smoke tests and the i18n checks:

```bash
bun run validate:ci
```

## Pull Request Process

1. **Title**: Use a clear, descriptive title
2. **Description**: Explain what the PR does and why
3. **Testing**: Describe how you tested the changes
4. **Screenshots**: Include screenshots for UI changes

### PR Template

```markdown
## Summary
Brief description of changes

## Changes
- Change 1
- Change 2

## Testing
How you tested these changes

## Screenshots (if applicable)
```

## Project Structure

```
craft-agents-oss/
├── apps/
│   ├── electron/                   # Desktop GUI (primary interface)
│   ├── webui/                      # Browser UI served by the headless server
│   ├── cli/                        # Terminal client for the headless server
│   └── viewer/                     # Web viewer for shared session transcripts
└── packages/
    ├── core/                       # @craft-agent/core - Shared types
    ├── shared/                     # @craft-agent/shared - Business logic
    ├── ui/                         # @craft-agent/ui - React components
    ├── server-core/                # @craft-agent/server-core - RPC transport, handlers, session management
    ├── server/                     # @craft-agent/server - Standalone headless server
    ├── pi-agent-server/            # Pi agent subprocess (JSONL over stdio)
    ├── session-tools-core/         # Session-scoped tool implementations
    ├── messaging-gateway/          # Telegram, WhatsApp and Lark messaging gateway
    └── messaging-whatsapp-worker/  # WhatsApp worker subprocess
```

## Key Areas

- **Agent Logic**: `packages/shared/src/agent/`
- **Authentication**: `packages/shared/src/auth/`
- **MCP Integration**: `packages/shared/src/mcp/`
- **Sessions**: `packages/server-core/src/sessions/`
- **RPC Handlers**: `packages/server-core/src/handlers/rpc/`
- **UI Components**: `packages/ui/src/`
- **Electron App**: `apps/electron/`

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions or ideas

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
