# CLAUDE.md — Viewer (`apps/viewer`)

## Purpose
Read-only web viewer for Craft Agent session transcripts.

Users can:
- Upload local session JSON files (client-side)
- Open shared sessions via `/s/{sessionId}`

## Stack (minimal)
- React + TypeScript + Vite + Tailwind
- Cloudflare Pages Functions + R2 for shared-session API

## Commands
From repo root:
```bash
bun run viewer:dev
bun run viewer:build
bun run viewer:typecheck
```

From `apps/viewer`:
```bash
bun run dev
bun run build
bun run typecheck
```

## Hard rules
- Preserve read-only viewer behavior.
- Keep local file handling client-side only.
- Validate loaded session payloads (`id`, `messages`) before rendering.

## Source of truth
- App entry: `apps/viewer/src/App.tsx`
- API function: `apps/viewer/functions/s/api/[[path]].ts`
- Build config: `apps/viewer/vite.config.ts`, `apps/viewer/wrangler.toml`
