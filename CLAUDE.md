# Craft Agents — Project Instructions

## Design System

**Always read [`DESIGN.md`](./DESIGN.md) before making any visual or UI decision.**
All font choices, colors, spacing, and aesthetic direction are defined there. The chat surface, settings panes, and any new screen must follow it. Token-level deltas vs the current renderer theme live in [`docs/design/chat-surface-tokens.patch`](./docs/design/chat-surface-tokens.patch).

Do not deviate without explicit user approval. In QA mode, flag any code that doesn't match `DESIGN.md`.

The first-principles insight that drives the system: *agent transcripts are long-form reading, not Slack-style bursts.* Reading-grade typography (Newsreader serif body, JetBrains Mono metadata, Fraunces display) is appropriate to actual user behavior. Do not silently revert this without naming a successor thesis.

## Don'ts

- **Don't reintroduce purple** as an accent. The `--accent: oklch(0.62 0.13 293)` token has been deliberately removed in favor of `oxblood / indigo / moss`. Purple is the AI-slop default and is forbidden in this codebase.
- **Don't reintroduce `system-ui`** as the body font. See above.
- **Don't add shadow cards on the chat surface.** Hairline `1px solid var(--rule)` replaces card chrome there. Shadow utilities remain available for popovers, modals, and floating menus.

## Project Layout (one-liner)

Bun monorepo. `apps/electron` (desktop, Electron 39), `apps/webui` (web UI, Vite + React 18, thin wrapper around the Electron renderer), `apps/viewer` and `apps/marketing` (smaller). Shared UI in `packages/ui`. Server in `packages/server` + `packages/server-core` + `packages/session-mcp-server` + `packages/pi-agent-server`. Domain types in `packages/core` and `packages/shared`.

## Common Commands

```bash
# Type-check everything
bun run typecheck:all

# Web UI dev (port 5175)
bun run webui:dev

# Server dev (uses webui via CRAFT_WEBUI_DIR)
bun run server:dev:webui

# Electron dev
bun run electron:dev

# Production server (build + serve)
bun run server:prod
```

For UI work, prefer `webui:dev` (instant) over `electron:dev` (slower rebuild).
