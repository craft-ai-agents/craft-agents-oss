# CLAUDE.md

Craft Agents monorepo overview for fast onboarding.

## Purpose
- Electron desktop app for Craft Agent sessions and tooling.
- Shared business logic in workspace packages.
- Web viewer for read-only session transcript sharing.

## Monorepo map (current)
- `apps/electron` — primary desktop app
- `apps/viewer` — transcript viewer
- `apps/marketing`, `apps/online-docs` — web properties
- `packages/shared` — core app logic (agent, sources, sessions, config)
- `packages/core` — shared types
- `packages/ui` — shared UI components
- `packages/session-tools-core`, `packages/session-mcp-server`, `packages/bridge-mcp-server`, `packages/pi-agent-server`, `packages/apps-runtime`, `packages/apps-db` — runtime/integration packages

## Run & validate (from repo root)
```bash
bun install
bun run electron:dev
bun run viewer:dev
bun run validate:dev
bun run typecheck:all
bun run test:doc-tools
```

## Hard rules
- Default to **Bun** commands.
- Keep docs minimal; link to source-of-truth instead of duplicating long inventories.
- If behavior changes, update the nearest package/app `CLAUDE.md` in the same PR.
- If changing files under `apps/electron/resources/scripts/` or `apps/electron/resources/bin/`, update smoke tests in `apps/electron/resources/scripts/tests/` and run `bun run test:doc-tools`.

## Source-of-truth pointers
- Electron app guidance: `apps/electron/CLAUDE.md`
- Shared logic guidance: `packages/shared/CLAUDE.md`
- Core types guidance: `packages/core/CLAUDE.md`
- Viewer guidance: `apps/viewer/claude.md`
- Main process logs (debug): `~/Library/Logs/@craft-agent/electron/main.log`

## Doc style policy
- Prefer short, verifiable facts.
- Avoid exhaustive tables that drift.
- If a section cannot be verified quickly from code, remove it or replace it with a pointer.
