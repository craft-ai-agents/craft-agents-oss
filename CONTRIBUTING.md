# Contributing to ARCHstudio

Thank you for your interest in contributing to ARCHstudio! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime
- Node.js 18+ (for some tooling)
- macOS, Linux, or Windows

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/lukilabs/craft-agents-oss.git
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

### Validation

Run the fast validation gate while iterating, then the full CI-equivalent suite before submitting a PR:

```bash
bun run validate:dev:fast
bun run validate:ci
```

For a narrower compile-only check, use `bun run typecheck:all`.

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
archstudio/
├── apps/
│   ├── electron/    # Primary desktop application
│   ├── webui/       # Browser client for remote servers
│   ├── viewer/      # Shared-session viewer
│   └── cli/         # Terminal client and integration validator
└── packages/
    ├── core/        # Shared public types
    ├── shared/      # Agent, source, config, and persistence logic
    ├── server-core/ # Shared server, RPC, session, and task infrastructure
    ├── server/      # Standalone headless server
    ├── ui/          # Shared React components
    └── ...          # Session tools, agent runtimes, and messaging packages
```

## Key Areas

- **Agent backends and permissions**: `packages/shared/src/agent/`
- **Sources and credentials**: `packages/shared/src/sources/`, `packages/shared/src/credentials/`
- **Session and task orchestration**: `packages/server-core/src/sessions/`, `packages/server-core/src/tasks/`
- **Shared UI components**: `packages/ui/src/`
- **Electron main and renderer**: `apps/electron/src/main/`, `apps/electron/src/renderer/`
- **Headless server and WebUI**: `packages/server/`, `apps/webui/`

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions or ideas

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
