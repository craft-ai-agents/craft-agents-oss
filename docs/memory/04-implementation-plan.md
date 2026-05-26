# Memory implementation plan

A fresh agent should be able to ship Phase 1 from this doc + [`01-spec.md`](./01-spec.md) + [`02-runtime.md`](./02-runtime.md) + [`03-ux.md`](./03-ux.md) without re-deciding anything.

`bun` is at `~/.bun/bin/bun` (not on PATH).

## Current implementation status

Branch: `codex/memory-os-hardening`

Phase 1 is implemented and hardened enough for internal use:

- Markdown-backed `USER.md` and per-agent `MEMORY.md` remain the source of truth.
- Agent memory tools can save, update, forget, recall, and audit memory.
- Ordinary spawned agents cannot directly mutate `USER.md`; only manual sessions and top-level system agents can.
- Review proposals apply through one backend RPC path, so approval cannot half-write memory and then fail to mark the queue item.
- The post-turn memory sidecar exists.
- Memory sidecar modes exist in Settings:
  - `Auto`: quietly saves safe new agent-scoped memory.
  - `Review`: queues every proposal for approval.
  - `Manual`: disables the sidecar.
- Auto mode rejects obvious secrets, provider tokens, env assignments, transient workspace facts, localhost/runtime facts, and test-result junk.
- Auto mode serializes per-agent writes and re-checks existing memory immediately before writing, preventing duplicate `-v2` sidecar saves under concurrent runs.

Remaining before calling Memory OS foundation fully done:

- Electron smoke for Settings `Auto / Review / Manual`.
- Electron smoke for review queue apply/reject UX.
- Decide whether auto-saved memories need a subtle activity indicator or whether audit log visibility is enough.
- Add broader secret-detection tests over realistic credential samples if this gets used with more providers.
- Merge plan from `codex/memory-os-hardening` after one clean app smoke.

## Phase 1 — File-based memory (~5-7 days)

### Scope

✅ In:
- Shared module: types, parser/serializer, validation, CRUD, tombstones, mutex (`packages/shared/src/memory/`)
- Three session-tools: `save_memory`, `update_memory`, `forget_memory`
- Registry callbacks + lazy bindings + SessionManager implementations
- Auto-injection into `composeAgentSystemPrompt` (renderer) AND `resolveAgentSessionOptions` (server, for workflow steps)
- RPC channels for renderer Memory tab
- Renderer atom + hook
- Basic Memory tab on `AgentInfoPage`: list, add/edit, forget
- Basic User profile dialog on top-bar menu: list, add/edit, forget
- Simple token-count badge on both surfaces

❌ Out (deferred):
- `sqlite-vec` semantic recall (Tier 2 — only when needed)
- Cross-session summary log (`SESSIONS.md` — see [`05-sessions-log.md`](./05-sessions-log.md), separate phase)
- Recent-activity hint chip (Phase 1.5)
- Memory-specific inline tool-call chips (Phase 1.5)
- Filter chips / keyboard table controls / advanced list polish (Phase 1.5)
- Graph view, diff view, bulk import (out of scope)

### Files to add (proposed)

```
packages/shared/src/memory/
  types.ts
  storage.ts
  storage.test.ts
  index.ts

packages/session-tools-core/src/handlers/
  save-memory.ts
  save-memory.test.ts
  update-memory.ts
  update-memory.test.ts
  forget-memory.ts
  forget-memory.test.ts

packages/server-core/src/handlers/rpc/
  memory.ts          # LIST_AGENT, LIST_USER, UPSERT, DELETE + CHANGED event

apps/electron/src/renderer/atoms/
  memory.ts          # atomFamily by agentSlug + a singleton for USER.md

apps/electron/src/renderer/hooks/
  useAgentMemory.ts  # consumes the atom + RPC + change subscription
  useUserProfile.ts  # singleton hook for USER.md

apps/electron/src/renderer/components/agents/
  AgentMemoryTab.tsx
  MemoryEditDialog.tsx
  UserProfileDialog.tsx

apps/electron/src/renderer/pages/
  AgentInfoPage.tsx  # MODIFIED — add the Memory tab
```

### Modify (existing files)

```
packages/shared/package.json                                        # add ./memory subpath
packages/shared/src/protocol/channels.ts                            # add `memory` namespace
packages/shared/src/protocol/events.ts                              # add memory.CHANGED payload
packages/shared/src/agent/session-scoped-tool-callback-registry.ts  # add 3 *Fn? callbacks
packages/shared/src/agent/session-self-management-bindings.ts       # 3 lazy getters
packages/session-tools-core/src/context.ts                          # 3 capability decls
packages/session-tools-core/src/tool-defs.ts                        # 3 schemas + descriptions + registry entries
packages/session-tools-core/src/handlers/index.ts                   # re-exports
packages/session-tools-core/src/index.ts                            # public exports
packages/server-core/src/sessions/SessionManager.ts                 # 3 backend impls + auto-inject in resolveAgentSessionOptions
packages/server-core/src/handlers/rpc/index.ts                      # register memory handler
apps/electron/src/transport/channel-map.ts                          # bridge methods + listener
apps/electron/src/shared/types.ts                                   # DTO re-exports + ElectronAPI extensions
apps/electron/src/renderer/lib/compose-agent-prompt.ts              # add userMemoryEntries + agentMemoryEntries params
apps/electron/src/renderer/lib/run-agent.ts                         # thread memory through agent spawn flow
apps/electron/src/renderer/components/app-shell/AppShell.tsx        # top-bar menu "Memory & Profile" entry
apps/electron/src/renderer/components/app-shell/AgentSessionsPanel.tsx     # context-fetch-and-pass memory
apps/electron/src/renderer/components/app-shell/AppShell.tsx               # Concierge handler — same
apps/electron/src/renderer/pages/AgentInfoPage.tsx                         # Run handler — same
```

### Build order

1. **Shared module first.** Types + parser/serializer + storage + tombstones + mutex + tests. **Stop and run typecheck + tests before moving on.** Mirror `packages/shared/src/workspace-context/storage.ts` pattern verbatim.

2. **Session-tools.** All three handlers + tests. Mirror `create-agent.ts` shape — same shape of error/success responses, same tool-defs registration. Use `Cron`-style explicit `'block'` safe mode.

3. **Registry + bindings + SessionManager.** Three callbacks added to all three files (registry, bindings, SessionManager). Use the agent-creator + automation-creator block as the template — copy the structural shape exactly.

4. **Auto-injection — renderer first, then server.** Extend `composeAgentSystemPrompt` with `userMemoryEntries` and `agentMemoryEntries` params. Render two named sections between Workspace Context and the bundle footer. Test the renderer-side compose change. **Then** mirror in `SessionManager.resolveAgentSessionOptions` so workflow-spawned sessions also get memory injected. Add a "kept in sync" comment between the two render paths.

5. **RPC + IPC bridge.** Mirror workspace-context exactly. Methods: `LIST_AGENT(slug)`, `LIST_USER`, `UPSERT(scope, agentSlug?, input)`, `DELETE(scope, agentSlug?, name)`, `CHANGED` event.

6. **Renderer atom + hook.** Mirror `useWorkspaceContext` shape. Two hooks because USER.md is global and per-agent memory is keyed.

7. **UI top-down.** Memory tab on AgentInfoPage → MemoryEditDialog → UserProfileDialog → token badge → top-bar menu entry.

8. **Wire memory through every spawn callsite.** Every place that calls `openAgentSessionComposer` today must also fetch USER.md + that agent's MEMORY.md and pass them as the new params. There are 3 callsites — same as workspace-context: AgentSessionsPanel, AppShell (Concierge handler), AgentInfoPage (Run button).

9. **Verify.** All three packages typecheck. New tests pass. Old tests still pass.

### Success criteria

- A user can chat with Concierge, mention "I'm Mikey, I prefer terse replies," and on the next session-start Concierge already knows.
- Editing a memory entry through the UI persists across restarts.
- Forgetting an entry adds a tombstone so the agent doesn't immediately re-write the same memory.
- A workflow step's spawned session also receives the agent's memory (verified by inspecting the launchReceipt or the agent's reply).
- Typecheck clean across `packages/shared`, `packages/server-core`, `apps/electron`.
- Tests: shared + session-tools + at least one renderer test for the compose change.
- No `SESSIONS.md`, semantic recall, inline chip UI, or advanced filtering is included in this phase.

### What to skip in Phase 1 (historical guidance)

- **Don't add semantic recall.** Even if you think you'll need it. The injected file is fine until you've earned the upgrade.
- **Don't add fuzzy consolidation.** Exact duplicate prevention exists for sidecar auto-save, but broader semantic merging still belongs later.
- **Don't add automatic memory consolidation** ("merge these similar entries"). The agent is not a database optimizer.
- **Don't hide behavior behind a vague feature flag.** The shipped control is a user-facing mode: `Auto / Review / Manual`.

---

## Phase 1.5 — Polish (~2-3 days, optional)

- Electron smoke for memory sidecar mode switching.
- Electron smoke for the review queue.
- Small audit/activity affordance for quiet auto-saves, if audit log alone feels too hidden.
- Recent-activity hint chip on Concierge chat header (depends on `SESSIONS.md` from [`05-sessions-log.md`](./05-sessions-log.md))
- Memory tool-call inline chip in chat transcript (the 📝 affordance)
- Empty-state copy on the Memory tab guiding users to chat first
- Filter chips (All/User/Feedback/Project/Reference) on the Memory tab
- Keyboard list controls and other table polish

---

## Phase 2 — Tier 2 recall (~3 days, only if needed)

Trigger condition: at least one agent's MEMORY.md exceeds 200 entries OR 25k tokens AND the user reports that "the agent doesn't remember things even though they're in the file."

Then:
- Add `sqlite-vec` to `packages/shared` deps
- Build a `~/.agents/agents/<slug>/memory.db` index alongside `MEMORY.md` (the markdown stays authoritative; db is derived)
- Auto-rebuild the index on every memory write
- Add a `recall_memory(query, limit?)` session-tool that returns top-N relevant entries
- Modify the auto-injection to inject only the most recent 50 entries by default; the agent uses `recall_memory` for older context
- The Memory tab gets a search bar that uses semantic recall

Don't pre-build this. Most users won't hit it for months. Premature.

---

## Cross-cutting concerns

### Migration for existing installs

Users with existing AGENT.md files don't have `MEMORY.md` files. The loader treats missing files as "no memory yet" — silent. No migration needed.

### Concurrency at the file level

Per-file mutex. Two simultaneous `save_memory` calls for the same agent serialize. Pattern: `withMemoryFileMutex(filePath, async () => {...})` — copy from `withAutomationConfigMutex` in SessionManager.

### Backward compat

Memory injection adds tokens to every prompt. Models with small context windows (e.g., 8k-context fine-tunes) could overflow. Phase 1 adds a sanity guard: if the combined `USER.md + MEMORY.md` exceeds 8k tokens, only inject the most recent N entries that fit. Document this in `02-runtime.md`. Phase 2 (Tier 2 recall) is the proper fix.

### Testing hygiene

- All shared tests use `mkdtempSync` for an isolated `~/.agents` root via a `MemoryStorageOptions.globalAgentsDir` override. Same pattern as agent-definitions storage tests.
- Session-tool tests mock the context's three memory capabilities — they don't touch real files.
- Don't test against a real LLM. Memory injection is verified by inspecting the composed prompt string, not by chatting with a model.

---

## Hard rules during implementation

- **Mirror existing patterns.** No new architectural decisions. Workspace Context + agent-creator are the templates.
- **Visible and inspectable writes.** Manual memory mutations are tool calls. Sidecar auto-writes are limited to safe new agent-scoped memories and must remain visible through audit/event surfaces.
- **Markdown is canonical.** Even when Tier 2 sqlite-vec lands, the markdown file remains the source of truth.
- **Server-side memory injection MUST be kept in sync with renderer-side.** Add a comment at both render paths citing each other.
- **Do NOT add comments that just restate code.** Only "why" comments.
- **One feature per commit.** Don't bundle Phase 1 with Phase 1.5 polish.

## Done definition

When Phase 1 ships, a user can:

1. Chat with Concierge for a few minutes, watch it call `save_memory` once or twice when learning something durable.
2. Close the app. Reopen tomorrow. Open a new Concierge session. Concierge already knows what was saved.
3. Open the agent's Memory tab. See the entries. Edit one. Verify the next session reflects the edit.
4. Forget an entry. Verify the next session does not re-create it (tombstone respected).
5. Open the Workflows starter "weekly content pipeline" and run it. Verify the spawned researcher session's launchReceipt shows that USER.md + the researcher's MEMORY.md were injected.
6. Type-check + tests pass.

That's the demo. When that flow runs without breakage, Phase 1 is done.
