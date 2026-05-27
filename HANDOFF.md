# Handoff: RunnerOS

## Mission

RunnerOS is a local Electron/Bun/TypeScript desktop workspace app forked from Craft Agents. The product is moving from "chat app" to local AI control plane: agents, skills, sources/tools, workflows, automations, workspace context, memory, visual outputs, and multi-step execution. The core direction is practical: specialist agents run with declared skills/sources, missing tools fail loudly before execution, and long-running workflows stay inspectable and recoverable.

## Current State

- Repo path: `/Users/michaelb.williams/RunnerOS`
- Current branch at handoff time: `codex/memory-os`
- Remote target: `origin/main`
- Package name still says `craft-agent`; product direction is RunnerOS.
- Root `AGENTS.md` is not checked in here. Use the user-provided RunnerOS instructions and `/Users/michaelb.williams/.codex` indexes.
- Recent work has focused on Memory OS and Deep Research.
- Current dirty files are mostly unrelated messaging-gateway/server automation work plus untracked visual assets/docs. Do not stage or revert them unless the user explicitly asks.

Working pieces to know:

- Agent/source/workflow/automation infrastructure already exists.
- Memory Phase 1 is built enough to dogfood: local markdown memory, save/update/forget tools, recall search, review queue, launch receipts, workflow/automation preservation, UI surfaces.
- Deep Research exists as a native workflow-style run mode, not a separate mega-agent. It has shared types/storage, server runner, RPC handler, and Electron atoms.
- Visual sidecar/output work exists in docs and output preview code, with untracked visual docs/assets also present.

Unfinished or next-tier:

- Vector semantic memory search is not done yet.
- Memory relationship graph and daily consolidation are spec-level, not fully built.
- Deep Research should be smoke-tested in the app with real sources/tools before calling it product-complete.
- Pi dependency check found no bump needed: Pi packages are already latest `0.73.1`.

## Tech Stack

- Electron + React + TypeScript + Vite
- Bun workspaces
- Runtime/backend: `packages/server-core`, `packages/shared`, `packages/session-tools-core`, `packages/server`
- UI: `apps/electron`
- Agent runtime includes Claude Agent SDK and Pi SDK packages.
- Local/global agent assets: `/Users/michaelb.williams/.agents`
- Codex assets: `/Users/michaelb.williams/.codex`
- Installed local sources live under `sources/<slug>/`

## Key Files To Read First

- `/Users/michaelb.williams/RunnerOS/README.md` — upstream Craft Agents feature baseline and install/run commands.
- `/Users/michaelb.williams/RunnerOS/package.json` — workspace layout, scripts, dependency versions.
- `/Users/michaelb.williams/RunnerOS/docs/memory/README.md` — current Memory Phase 1 product shape.
- `/Users/michaelb.williams/RunnerOS/docs/memory/06-memory-os-spec.md` — north-star memory architecture.
- `/Users/michaelb.williams/RunnerOS/packages/shared/src/memory/storage.ts` — markdown memory source of truth.
- `/Users/michaelb.williams/RunnerOS/packages/shared/src/memory/recall.ts` — current non-vector recall search.
- `/Users/michaelb.williams/RunnerOS/packages/session-tools-core/src/handlers/memory.ts` — `save_memory`, `update_memory`, `forget_memory`, `recall_memory` tools.
- `/Users/michaelb.williams/RunnerOS/packages/server-core/src/memory/MemorySidecarService.ts` — post-turn memory proposal service.
- `/Users/michaelb.williams/RunnerOS/docs/deep-research/README.md` — Deep Research product decision.
- `/Users/michaelb.williams/RunnerOS/packages/shared/src/deep-research/types.ts` — Deep Research run schema.
- `/Users/michaelb.williams/RunnerOS/packages/server-core/src/deep-research/DeepResearchRunner.ts` — Deep Research execution loop.
- `/Users/michaelb.williams/RunnerOS/packages/server-core/src/workflows/runner.ts` — workflow execution backbone.
- `/Users/michaelb.williams/RunnerOS/packages/shared/src/sources/storage.ts` — source registration/storage.
- `/Users/michaelb.williams/RunnerOS/apps/electron/src/renderer/pages/settings/MemorySettingsPage.tsx` — memory UI entry point.

## Recent Accomplishments

- Added memory recall and audit events.
- Showed injected memory in launch receipts.
- Added agent memory recall search.
- Counted memory writes in Pulse snapshots.
- Hardened memory recall ranking.
- Preserved automation memory launch receipts.
- Confirmed Pi packages are already latest `0.73.1`; Pi shared tests passed `75/75`, and `packages/pi-agent-server` typecheck completed cleanly.

Recent commits:

- `2ea41ef Preserve automation memory launch receipts`
- `285ead9 Harden memory recall ranking`
- `21ce65c Count memory writes in pulse snapshots`
- `a467f29 Add agent memory recall search`
- `4c66248 Show injected memory in launch receipts`
- `4922f23 Add memory recall and usage audit`

## Next Best Actions

1. If the next job is Memory OS: add vector semantic search as a derived local index while keeping markdown as truth.
2. If the next job is Deep Research: run an end-to-end local smoke with real enabled sources, especially browser/search-capable tools.
3. If the next job is product polish: wire the Deep Research UI path so a normal user can launch it from a native nav/control surface.
4. If the next job is repo hygiene: separate unrelated dirty work before staging any new changes.

## Major Risks / Watchouts

- Do not claim a source/tool works until file registration and runtime visibility are both verified.
- Do not default Deep Research to Computer Use. Browser/search tools are appropriate; desktop clicking should be opt-in.
- Missing required sources/skills should fail before execution, not halfway through a run.
- Markdown memory is canonical. SQLite, embeddings, and graph edges should be rebuildable indexes only.
- Subagents/background runs should not freely mutate global memory without explicit rules.
- Preserve unrelated dirty files. This repo has active uncommitted work not owned by the current task.

## Commands / Verification

Useful commands:

```bash
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun install
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun run typecheck:all
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun test packages/shared/src/memory packages/session-tools-core/src/handlers/memory.test.ts packages/server-core/src/memory/MemorySidecarService.test.ts
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun test packages/shared/src/deep-research packages/server-core/src/deep-research
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun run electron:dev
```

Recently verified:

```bash
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun test packages/shared/src/agent/__tests__/pi-agent-error-handling.test.ts packages/shared/src/agent/__tests__/pi-agent-stderr-buffer.test.ts packages/shared/src/agent/__tests__/pi-agent-bedrock-env.test.ts packages/shared/src/agent/__tests__/pi-query-llm.test.ts packages/shared/src/agent/__tests__/pi-event-adapter.test.ts packages/shared/src/agent/backend/pi/event-adapter-call-llm.test.ts
cd packages/pi-agent-server && PATH=/Users/michaelb.williams/.bun/bin:$PATH bun run typecheck
```

## Working Rules For The Next Agent

- Read before editing.
- Use `rg` first.
- Use `apply_patch` for manual edits.
- Keep changes small and verified.
- Preserve unrelated dirty work.
- Use `/Users/michaelb.williams/.codex/README.md`, `/Users/michaelb.williams/.codex/skills/INDEX.md`, `/Users/michaelb.williams/.codex/agents/INDEX.md`, and the alias catalogs before browsing `.codex` manually.
- If editing `.codex` skills/agents, rerun `python3 /Users/michaelb.williams/.codex/scripts/rebuild_codex_catalog.py`.
- For RunnerOS sources/agents/skills, validate both storage files and runtime visibility.
- Keep final reports short and honest. The user values exact status over long explanation.

## Unknowns

- Whether the current dirty messaging-gateway/server automation files are user work, another agent's work, or in-progress generated work.
- Whether Deep Research has been smoked through the live Electron UI with actual installed search/browser sources.
- Whether vector memory should be built with `sqlite-vec`, another local embedding stack, or a pluggable provider layer.
- Whether visual sidecar docs/assets should be merged into this branch or kept separate.
