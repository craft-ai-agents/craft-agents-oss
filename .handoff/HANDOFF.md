# ARCHstudio Agents — Handoff
> Current state as of the latest commit on `redesign/owner-agent`.

## Done
- Added MemoryPanel UI with list/graph views, search, filters, and detail pane.
- Added MemoryGraph SVG visualization for the 2nd-brain graph view.
- Added CommandPanel scaffold with terminal-like history/run UI.
- Added HomeHero matching the ARCHstudio brand direction.
- Wired `LayoutShell` view routing for `memory`, `runs`, and command/home.
- Committed UI pieces to git.

## Brand direction
- Dark surface with high contrast.
- Lime-to-electric-purple accent gradient.
- Minimal typographic logo emphasis.

## Code map
- `apps/electron/src/renderer/shell/LayoutShell.tsx` — main shell and view routing.
- `apps/electron/src/renderer/panels/memory/MemoryPanel.tsx` — memory list/detail/graph UI.
- `apps/electron/src/renderer/panels/memory/MemoryGraph.tsx` — SVG graph.
- `apps/electron/src/renderer/panels/command/CommandPanel.tsx` — command scaffold.
- `apps/electron/src/renderer/home/HomeHero.tsx` — branded hero.
- `packages/shared/src/memory/types.ts` — shared memory types.

## Todo
- Complete remaining 7 panels and route them in `LayoutShell`.
- Connect MemoryPanel and CommandPanel to real backends.
- Implement real graph data model with edges/weights.
- Add project/media/workflow panels with data sources.
- Polish auth, permissions, and project scoping UI.
- Add desktop shortcuts and first-run setup.

## Session 2026-07-24
- RunsPanel now live: reads `sessionMetaMapAtom` (jotai) — real session runs with status (running/failed/completed/idle), duration, message count, token usage/cost. Sorted running-first. Live-count pill + empty state + spinner CSS.
- Fixed LayoutShell import (`../panels/runs`), `runs` view routed.
- Fixed pre-existing typecheck errors: MemoryPanel imports `@archstudio/shared/memory/types`, mocks cast via unknown, source display uses sessionId, exported MemoryPanelProps/CommandPanelProps. `bun run typecheck` clean.
- CommandPanel now runs real shell commands: new `archCommand` RPC (RUN/KILL) in `main/handlers/system.ts` using `spawn` (shell:true, 200KB output cap, tracked in a Map by run id for kill). Exposed via channel-map as `runArchCommand`/`killArchCommand` on ElectronAPI. Panel shows exit code, duration, stopped-by-user; Stop button kills the live process. CommandPanel rendered under HomeHero on the `command` view.

- ProjectsPanel: card grid from `projectsAtom`; per-project session count / running count / last activity derived from `sessionMetaMapAtom`; search, archived toggle, per-project accent color.
- IntegrationsPanel: from `sourcesAtom` (built-ins filtered out); status chips with counts (connected / needs_auth / failed / untested / local_disabled), click-to-filter, search, failure reasons on card. Problems sort first.
- SearchPanel: debounced (250ms) `searchSessionContent(workspaceId, query, searchId)`; seq guard drops out-of-order responses; results grouped by session with titles from `sessionMetaMapAtom`, line numbers, match highlighting, show-more per group.
- SecurityPanel: `getCredentialHealth()` store status + issues, permission-mode exposure across live sessions (safe/ask/allow-all with counts, warns on Execute-mode sessions), and unauthenticated/failed enabled integrations.

- SettingsPanel: real settings RPCs — default thinking level (`get/setDefaultThinkingLevel`), keep-awake (`get/setKeepAwakeWhileRunning`), network proxy (`get/setNetworkProxySettings`, fields commit on blur), remote server status (`getServerStatus`) with insecure/needs-restart warnings. Optimistic updates roll back on failure; "Saving…/Saved" indicator.
- MediaLabPanel: scans the 40 most recent sessions via `getSessionFiles`, walks the nested `SessionFile` tree, classifies by extension into image/video/audio/doc. Kind filter chips with counts, image thumbnails via `file://`, click opens with `openFile`. Per-session failures are swallowed so one bad session can't blank the grid.

## Panel status
- ALL 9 panels live-backed and routed: Command, Runs, Memory, Projects, Integrations, Search, Security, Settings, Media Lab.
- `bun run typecheck` clean.

## Next step
- Manual QA pass: `bun dev` in `apps/electron`, click every nav item, verify against real workspace data.
- Then the remaining original todos: real graph data model with edges/weights (MemoryGraph still uses mock memories in MemoryPanel), auth/permissions/project-scoping polish, desktop shortcuts + first-run setup.
- Known shortcuts to revisit: MemoryPanel still renders MOCK_MEMORIES (needs `packages/shared/src/memory/repository.ts` wired through an RPC); MediaLab session scan is capped at 40 and has no pagination.
