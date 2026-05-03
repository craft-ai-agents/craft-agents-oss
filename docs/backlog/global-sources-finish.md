# Global Sources — Finishing & Audit

## Status

Foundation shipped (6 commits, ~4,000 LOC, +55 tests). Renderer v1 is now wired:
the Sources list shows workspace/global/dormant tiers, can activate/deactivate shared
sources, can promote workspace sources to global, and Source Info shows tier plus
credential scope.

This doc captures both:
1. **What's left after renderer v1** (Phase 5 deeper CRUD + Phase 6 polish).
2. **A review/audit procedure** for what's already landed, gating Lane D's start.

The full design is at [docs/global-sources/](../global-sources/) — 6 docs, 1,353 lines.
This doc is operational; the design docs are normative.

## What shipped (and where to find it)

| Commit | Subject | What it lands |
|---|---|---|
| `9d139d3` | docs: add global-sources spec and skill-recipes design | Full 6-doc spec + skill-recipes README. Source of truth. |
| `638c5a1` | sources: load globals via activation manifest | `~/.agents/sources/` constants, `.global-sources.json` reader, `loadGlobalSource`(s), `LoadedSource.tier` field, `loadAllSources({ includeDormant })`. |
| `282d60b` | sources: workspace credential override | `StoredCredential.override`, `loadEffective`, `writeOverrideMarker`, `clearOverride`. |
| `929505c` | sources: add write path and global activation rpc | Storage writers, `mirrorSourceToGlobal`, 5 new RPC channels, SessionManager call-site swap, channel-map wiring, ElectronAPI signatures. |
| `4fc51b6` | sources: add list_sources tool and source-recipe starter skill | Session tool + bindings; `source-recipe` in `STARTER_SKILLS`. |
| `4230604` | sources: preserve override flag through oauth exchange | One-line preservation of override flag in `exchangeAndStore`. |

## Goal

Take the headless plumbing to a clickable, discoverable user-facing feature. The full design
is at [04-ux.md](../global-sources/04-ux.md); this section enumerates the concrete work items.

## Non-goals

- Cloud sync of global sources / credentials.
- Multi-user shared global library.
- A community registry to install global sources from.
- Any change to the storage / RPC / credentials shape established in commits `638c5a1`–`4230604`.
  Lane D consumes the existing surface; it does not reshape it.

---

## What's left

### Lane D — Renderer UI (v1 shipped)

Owns the renderer atoms, list-row rendering with tier badges, activate/deactivate/promote
flows, and source details tier/credential visibility.

**Shipped files:**

- `apps/electron/src/renderer/atoms/sources.ts` — global/effective source atoms.
- `apps/electron/src/renderer/components/app-shell/SourcesListPanel.tsx` — effective list, tier badges, Browse Global dialog, activate/deactivate/promote actions.
- `apps/electron/src/renderer/components/app-shell/SourceMenu.tsx` — global source actions and managed-source delete guard.
- `apps/electron/src/renderer/pages/SourceInfoPage.tsx` — dormant global fallback load plus tier/credential scope rows.
- `apps/electron/src/shared/types.ts` — renderer export for `SourceTier`.
- `packages/shared/src/i18n/locales/*.json` — v1 labels in every locale.

**Deferred from the original Lane D wishlist:**
- Full CRUD page for editing global definitions directly. Existing backend only exposes list/activate/promote, so v1 uses a read-only Browse Global dialog plus promote-from-workspace.
- Dedicated credential override/revert dialogs. The credential manager supports it, but no renderer RPC exists yet.
- `includeCredentials` checkbox for promote. V1 deliberately promotes definitions only (`includeCredentials: false`).
- Dedicated `global-dormant` dot state. V1 shows a Dormant tier badge and suppresses connection status for dormant rows.

**Tests:**
- `bun run typecheck:all`
- `bun run lint`
- `bun test packages/shared/src/sources/__tests__/storage.test.ts packages/shared/src/sources/__tests__/credential-manager-effective.test.ts packages/shared/src/i18n/__tests__/locale-parity.test.ts`
- `git diff --check`

### Phase 5 — Settings → Global Sources Library page (subset of Lane D)

Folded into Lane D above. The new RPC channels needed (`CREATE_GLOBAL`, `UPDATE_GLOBAL`,
`DELETE_GLOBAL`) are NOT yet wired — Lane B's commit (`929505c`) added the activate/promote
channels but not the full library-management ones. Lane D either:
- (a) adds those three channels (small extension to `rpc/sources.ts`, `channels.ts`,
  `events.ts`, `routing.ts`, `channel-map.ts`, `electron/shared/types.ts`), or
- (b) treats the global library as edit-via-filesystem-only for v1, with the UI page being
  read-only (list + activation count) and definition edits going through `~/.agents/sources/`
  manually.

**Recommend (b) for v1.** Promotion handles the typical flow ("I made it in a workspace, now
I want it global"). Direct global creation is rare enough to defer until users actually ask
for it.

### Phase 6 — Polish (small, optional)

- **Discoverability nudges** — when a workspace has no sources, show a "Browse Global" CTA.
  When a workspace has duplicate slugs across tiers, suggest deleting the workspace copy.
  Per [04-ux.md § Discoverability nudges](../global-sources/04-ux.md#discoverability-nudges).
- **Telemetry** — instrument activate/deactivate/promote events. Out of scope unless the
  product wants signal here.
- **Translation pass** — non-en locales currently get English placeholders.

### Typecheck floor

`bun run typecheck:all` is green as of renderer v1.

### Phase 1 follow-up — `tier` field becomes required

Today `LoadedSource.tier` is optional. Once Lane D ships and the constructor sites listed in
Lane A's report ([Phase 1 commit `638c5a1`](../../) handoff notes) all set tier explicitly,
flip the field to required. Small cleanup commit.

The construction sites needing `tier`:
- `packages/shared/src/agent/__tests__/test-utils.ts:59` — `createMockSource` factory
- `packages/shared/src/agent/claude-context.ts:146,158,169` — three shim sites
- `packages/session-mcp-server/src/index.ts`
- `packages/session-tools-core/src/handlers/source-oauth.ts:162`, `source-test.ts:483`
  (these use a *local* LoadedSource interface, so they're independent — flip after the local interface gets `tier`)

### `os.homedir` test sandbox (small)

Lane A test setup uses `mock.module('os', ...)` per-test. Move to a `setupFile`-level mock
so Lane B/C tests that sandbox `~/.agents/` don't repeat the pattern. One-line tsconfig +
fixture.

---

## Audit / review procedure

The foundation was built by three parallel agents from a spec. Before painting Lane D on
top, follow this procedure to verify the foundation is sound. Each step has an explicit
gate.

### Step 1 — Spec walkthrough (15 min)

Read [docs/global-sources/00-README.md](../global-sources/00-README.md) and [02-runtime.md](../global-sources/02-runtime.md)
end to end. Confirm the four-tier resolution order and three-gate spawn rule are the design
you want before reading code.

**Gate:** spec matches your mental model. If not, stop here — fix the spec first, the code
is built to it.

### Step 2 — Storage layer review (`638c5a1` + `929505c`)

Files: `packages/shared/src/sources/storage.ts`, `types.ts`, `index.ts`.

Look for:
- [ ] `GLOBAL_AGENT_SOURCES_DIR` resolves under `homedir()`, not project-relative.
- [ ] `GLOBAL_WORKSPACE_ID = '__global__'` — exported, used as `LoadedSource.workspaceId` for global-tier sources.
- [ ] `loadGlobalSource()` sets `tier: 'global'` and `workspaceId: GLOBAL_WORKSPACE_ID`. Verify by reading the function.
- [ ] `loadAllSources()` resolution order: workspace > activated globals > project > dormant. Dedup by slug, first-match wins. The `includeDormant` opt is honored.
- [ ] Manifest reader tolerates: missing file, malformed JSON (logs + backs up to `.broken-<ts>`), unknown slugs, duplicate slugs.
- [ ] `mirrorSourceToGlobal` uses staging-dir + atomic rename + `.old-` sidecar pattern. Compare to `mirrorSkillToGlobal` in `packages/shared/src/skills/storage.ts:512`.
- [ ] `mirrorSourceToGlobal` activates the slug in the originating workspace's manifest after success (per [02-runtime.md § Mirror flow step 5](../global-sources/02-runtime.md#mirror-flow-promote-workspace--global)).
- [ ] `mirrorSourceToGlobal` collision behavior: throws clearly without `overwrite: true`; with it, moves existing aside before rename.

**Test gate:** `~/.bun/bin/bun test ./packages/shared/src/sources/__tests__/storage.test.ts` — must show 31/31. (17 from Phase 1 + 15 from Phase 2 + a couple of helpers.)

### Step 3 — Credentials review (`282d60b` + `4230604`)

Files: `packages/shared/src/credentials/types.ts`, `packages/shared/src/sources/credential-manager.ts`.

Look for:
- [ ] `StoredCredential.override?: boolean` declared with a comment explaining the WHY.
- [ ] `loadEffective(source)` resolution order matches [03-credentials.md § Resolution at load time](../global-sources/03-credentials.md#resolution-at-load-time):
  1. Workspace key → if `override === true`, return as-is or null
  2. Workspace key → if value, return
  3. Global tier → fall back to `__global__` key
  4. Otherwise null
- [ ] `writeOverrideMarker` rejects on workspace-tier sources (only global-tier can be overridden).
- [ ] `clearOverride` deletes the workspace record entirely (no half-state).
- [ ] `exchangeAndStore` (commit `4230604`) reads existing record and forwards `override: true` if set.
- [ ] No new direct calls to `load(source)` in spawn paths — those should use `loadEffective`. Old call sites that legitimately want workspace-only (e.g., "does an override exist?") may stay on `load`. Audit greppable: `grep -n 'credManager\.load\|\.load(source)' packages/`. Check each hit's intent.

**Test gate:** `~/.bun/bin/bun test ./packages/shared/src/sources/__tests__/credential-manager-effective.test.ts` — must show 9/9.

**Manual gate (recommended):** trace one end-to-end path on paper:
1. User activates `notion` (global) in workspace W.
2. User clicks "Use different creds" → `writeOverrideMarker(source)` writes `{ override: true, value: null }`.
3. User completes OAuth → `exchangeAndStore` reads existing override marker, saves new token with `override: true` preserved.
4. Next session start in W → `loadEffective(notion)` returns workspace token (override flag honored).
5. Other workspace's session → `loadEffective(notion)` falls back to `__global__` key (workspace has no record).
6. User clicks "Revert to global" → `clearOverride` deletes workspace record. Next session in W gets global creds.

### Step 4 — Server-side wiring review (`929505c`)

Files: `packages/server-core/src/handlers/rpc/sources.ts`, `packages/server-core/src/sessions/SessionManager.ts`, protocol files.

Look for:
- [ ] `loadWorkspaceSources` is no longer called anywhere in `SessionManager.ts` — `grep -n 'loadWorkspaceSources' packages/server-core/src/sessions/SessionManager.ts` should return no hits. All swapped to `loadAllSources`.
- [ ] All 5 new channels (`LIST_GLOBAL`, `GET_ENABLED_GLOBAL`, `SET_GLOBAL_ENABLED`, `PROMOTE_TO_GLOBAL`, `CHANGED_GLOBAL`) are declared in `channels.ts`, classified as REMOTE_ELIGIBLE in `routing.ts`, and registered in `HANDLED_CHANNELS` in `rpc/sources.ts`.
- [ ] `SET_GLOBAL_ENABLED` triggers an immediate `reloadSourcesForWorkspace` call so mid-session activation works. Note the type-erased duck-cast — flag for a follow-up that promotes the method to a public interface, but the duck-cast is acceptable for v1.
- [ ] `PROMOTE_TO_GLOBAL` emits both `CHANGED_GLOBAL` and the existing `CHANGED` (so workspace UI also refetches).
- [ ] `apps/electron/src/transport/channel-map.ts` and `apps/electron/src/shared/types.ts` have matching entries for the 5 new channels — the channel-map parity test enforces this.

**Test gate:** Full floor + new suites:
```bash
~/.bun/bin/bun test ./packages/shared/src/outputs/storage.test.ts ./packages/shared/src/workflows/storage.test.ts ./packages/shared/src/workflows/template.test.ts ./packages/server-core/src/workflows/runner.test.ts ./packages/server-core/src/outputs/OutputService.test.ts ./packages/session-tools-core/src/handlers/outputs.test.ts ./packages/session-tools-core/src/handlers/create-agent.test.ts ./packages/session-tools-core/src/handlers/create-automation.test.ts ./apps/electron/src/renderer/lib/compose-agent-prompt.test.ts ./packages/shared/src/sources/__tests__/storage.test.ts ./packages/shared/src/sources/__tests__/credential-manager-effective.test.ts ./packages/session-tools-core/src/handlers/__tests__/list-sources.test.ts ./packages/shared/src/skills/__tests__/starter-templates.test.ts
```
Expected: 228+ pass / 0 fail. (Floor 174 + Lane A 17 + Lane B 15 + Lane C 9 + Lane E 14 = 229.)

### Step 5 — Tooling review (`4fc51b6`)

Files: `packages/session-tools-core/src/handlers/list-sources.ts`, `tool-defs.ts`, `context.ts`, `packages/shared/src/agent/session-self-management-bindings.ts`, `packages/shared/src/skills/starter-templates.ts`.

Look for:
- [ ] `list_sources` description in `tool-defs.ts` uses trigger language ("When the user wants to..."). The current description is at the top of [04-ux.md § list_sources session tool](../global-sources/04-ux.md#list_sources-session-tool) for reference.
- [ ] `list_sources` declared `safeMode: 'allow', readOnly: true` — auto-allowed in every session.
- [ ] Binding in `session-self-management-bindings.ts` calls `loadAllSources(workspaceRoot, { includeDormant: !activeOnly })` and projects to `SourceListItem[]`.
- [ ] `SOURCE_RECIPE_SKILL` is in `STARTER_SKILLS` array. Description is trigger-style. Cap rule (3 max) is explicit in body.
- [ ] No duplicate slugs in `STARTER_SKILLS` — should be 4 entries: `agent-creator`, `automation-creator`, `workflow-creator`, `source-recipe`.

**Manual gate:** invoke `list_sources` from any session in a workspace with at least one source, with and without `activeOnly`. Verify the response shape and tier values.

### Step 6 — Typecheck floor (continuous)

```bash
cd /Users/mikeymike/Documents/projects/Crafter
(cd packages/shared && ~/.bun/bin/bun run tsc --noEmit) && \
(cd packages/server-core && ~/.bun/bin/bun run tsc --noEmit) && \
(cd apps/electron && ~/.bun/bin/bun run tsc --noEmit)
```

Expected: all three green. `session-tools-core` has 3 pre-existing errors that are documented;
audit-acceptable.

### Step 7 — Smoke matrix (manual, 30 min)

Run the desktop app. Without Lane D shipped, you'll need to drive activation via direct file edits since there's no UI yet. That's fine — confirms the foundation works.

- [ ] Create `~/.agents/sources/test/config.json` with a minimal `{ slug, name, type: 'mcp', enabled: true, ... }`.
- [ ] Create `<workspace>/sources/.global-sources.json` with `{ "version": 1, "activatedSlugs": ["test"], "lastModified": "..." }`.
- [ ] Open a session in that workspace. Verify `test` appears in the spawned source list.
- [ ] Remove the slug from the manifest. Restart session. Verify `test` is gone.
- [ ] Hand-edit `~/.agents/sources/test/config.json` to set `enabled: false`. Verify even with manifest activation, the source doesn't spawn.
- [ ] In a second workspace, activate `test` similarly. Verify both workspaces see it independently.
- [ ] (OAuth source only) Trigger an OAuth flow on a global-tier source. Verify the credential lands at `__global__::slug` in your credential store. Activate the source in a second workspace; confirm it reuses the credential without re-OAuth.

**Audit acceptance:** all checkboxes pass.

### Step 8 — Risk acceptance and sign-off

- [ ] OAuth flow round-trip verified for at least one provider type (any of: generic, slack, google, microsoft, mcp).
- [ ] Mirror collision behavior verified manually — `mirrorSourceToGlobal` called twice for the same slug without `overwrite` throws as expected.
- [ ] No `loadWorkspaceSources` references remain in spawn paths.
- [ ] No new direct credential `load` calls in spawn paths (use `loadEffective`).
- [ ] All four typechecks green (modulo the 3 pre-existing session-tools-core errors).
- [ ] Test floor at >= 228 pass / 0 fail.

If all the above pass, the foundation is audit-clear and Lane D can ship on top of it.

---

## Suggested Lane D agent partition (when ready)

Lane D is a single agent's responsibility per the spec, but if it's too large for one go,
split:

- **D1 — atoms + RPC wiring** — `atoms/sources.ts`, hooks for activate/deactivate/promote, event subscription. ~150 LOC. Independent.
- **D2 — list rows + tier badges + status indicator** — visual layer for the existing Sources page. ~250 LOC. Depends on D1.
- **D3 — dialogs (Activate/Deactivate/Override/Revert/Promote)** — five modals. ~400 LOC. Depends on D1.
- **D4 — Global Sources Library page** — Settings page. ~250 LOC. Depends on D1.
- **D5 — i18n keys across 7 locales** — pure data fanout. ~50 lines per locale, ~350 LOC total. Independent of all others as long as D2/D3/D4 use the keys.

Each ships as its own commit. Suggested order: D1 → (D5 in parallel with D2 + D3) → D4.

## Things to defer

- Cloud sync of global sources or credentials.
- A community/marketplace registry to install global sources from.
- Per-workspace overrides of `source-recipe` (the loader supports it; UX is a future
  conversation).
- Automation-driven source activation (e.g., "when I open this kind of project, auto-activate
  these sources" — interesting, not v1).

These are explicitly named to keep them out of v1 scope.
