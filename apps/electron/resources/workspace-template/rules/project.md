# Craft Agents Project Rules

- Use Bun commands (bun run ...).
- Monorepo layout:
  - apps/electron for the desktop app (main/preload/renderer)
  - packages/shared for business logic
  - packages/core for shared types
- Keep changes scoped to the smallest package.
- Update README or package CLAUDE.md when behavior changes.
- Do not commit secrets or credentials.
