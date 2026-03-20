# CLAUDE.md

Craft Agents monorepo overview for fast onboarding.

## Purpose
- Electron desktop app for Craft Agent sessions and tooling.
- Shared business logic in workspace packages.
- Web viewer for read-only session transcript sharing.

**Keep docs up-to-date:** `packages/shared/` → this file | `apps/electron/` → `apps/electron/CLAUDE.md`

## Monorepo Structure

```
craft-agent/
├── apps/
│   ├── cli/         # Craft CLI terminal client
│   ├── electron/    # Desktop GUI (primary interface)
│   ├── marketing/   # Marketing site
│   ├── online-docs/ # Online documentation
│   ├── viewer/      # Web viewer for session transcripts
│   └── webui/       # Browser UI for remote server access
└── packages/
    ├── core/                # @craft-agent/core - Shared types
    ├── pi-agent-server/     # Pi SDK agent server (subprocess)
    ├── server/              # Standalone headless Bun server
    ├── server-core/         # @craft-agent/server-core - Reusable WS/headless server infrastructure
    ├── session-mcp-server/  # Session-level MCP server
    ├── session-tools-core/  # Core session tool implementations
    ├── shared/              # @craft-agent/shared - Business logic
    └── ui/                  # @craft-agent/ui - Shared UI components
```

**Imports:**
```typescript
import { createAgent, ClaudeAgent, PiAgent } from '@craft-agent/shared/agent'
import type { AgentBackend, BackendConfig } from '@craft-agent/shared/agent'
```

**Sub-docs:** [`apps/electron/CLAUDE.md`](apps/electron/CLAUDE.md) | [`packages/shared/CLAUDE.md`](packages/shared/CLAUDE.md)

## Run & validate (from repo root)
```bash
bun install
bun run electron:dev
bun run viewer:dev
bun run webui:dev
bun run server:dev:webui
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
- Web UI guidance: `apps/webui/CLAUDE.md`
- Main process logs (debug): `~/Library/Logs/@craft-agent/electron/main.log`

## Doc style policy
- Prefer short, verifiable facts.
- Avoid exhaustive tables that drift.
- If a section cannot be verified quickly from code, remove it or replace it with a pointer.
