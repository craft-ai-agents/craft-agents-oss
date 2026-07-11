---
name: project-conventions
description: Reference for craft-agents-oss code conventions. Claude-only — loaded automatically when making changes to the codebase.
user-invocable: false
---

# craft-agents-oss Conventions

## Monorepo Layout

- `packages/*` — shared libraries (no app entry points)
- `apps/*` — runnable applications (Electron desktop, etc.)
- `bridge-mcp-server/` and `session-mcp-server/` — bundled MCP servers
- `docs/` — documentation; `scripts/` — dev/CI helpers

## TypeScript

- Strict mode is on in all packages.
- Prefer `type` over `interface` for plain data shapes; use `interface` only when extension is expected.
- Do not use `any`; use `unknown` and narrow explicitly.
- Exports from a package must go through `src/index.ts`.

## ESLint Rules (custom)

Eight custom rules live in `eslint-rules/`. Key ones:
- `no-direct-fs` — use the platform FS abstraction, not `fs.*` directly
- `no-direct-ipc` — use the IPC abstraction layer
- `no-direct-env` — access env vars via the config module, not `process.env.*`
- Always run `bunx eslint --fix` before submitting; hooks do this automatically.

## React Components

- Functional components only; no class components.
- Props types defined inline as `type Props = { ... }` immediately above the component.
- Tailwind 4 utility classes for styling; no inline `style=` objects except for dynamic values.
- Use Craft Agent skill components from `packages/ui` rather than re-implementing patterns.

## Testing

- Vitest for `apps/desktop` and `packages/ui*`.
- Test files live next to source: `src/foo.ts` → `src/foo.test.ts`.
- No mocks for internal modules unless they touch network/filesystem.

## Skill Files (`.claude/skills/`)

- Required frontmatter: `name`, `description`.
- `user-invocable: false` for Claude-only reference skills.
- `disable-model-invocation: true` for side-effect skills (deploy, commit, send).
- Skills may bundle supporting templates/scripts in subdirectories.

## Git

- Branch naming: `claude/<slug>` for AI-generated branches.
- Never commit directly to `main`.
- PRs must target `main`.

## Package Manager

- Use `bun` exclusively; never `npm` or `yarn`.
- Do not edit lock files (`bun.lock`) directly.

## Sensitive Files

- Never edit `.env`, `.env.local`, `.env.production`, `.env.development` directly.
- Secrets belong in environment config, not in code or comments.
