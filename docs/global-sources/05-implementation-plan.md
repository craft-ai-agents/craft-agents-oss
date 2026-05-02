# Global Sources — Implementation Plan

## Phasing

| Phase | Goal | Ships? |
|---|---|---|
| **0** | OAuth callback spike + decision | yes (1 hour) |
| **1** | Read path: load globals + activation manifest, three-gate spawn rule | yes |
| **2** | Write path: activate / deactivate / promote-to-global RPC + UI | yes |
| **3** | Credentials: workspace-override mechanic + override flag | yes |
| **4** | `list_sources` tool + `source-recipe` skill | yes |
| **5** | Settings → Global Sources Library page | yes |
| **6** | Polish: discoverability nudges, telemetry, deeper i18n | optional |

Phases 1–5 are the v1 ship. Phase 6 is post-launch QoL.

## Phase 0: OAuth callback spike — RESOLVED

**Verdict:** stable + state-tracked. No callback refactor needed.

The redirect URL is `http://localhost:{port}/callback` (no workspace/session/tier
templating). The `state` parameter is a random token that keys a server-side
`PendingOAuthFlow` containing `workspaceId`, `sourceSlug`, and full OAuth context. On
callback completion, the handler retrieves the flow by state and dispatches.

For Phase 3 credential dispatch: a single-line change at the OAuth handler's
`credManager.exchangeAndStore` call site reads `flow.source.tier` (added to flow record
in Phase 1) and the override flag, then routes to the right credential key. No third-party
OAuth app registrations need updating.

See [03-credentials.md § OAuth callback model](03-credentials.md#oauth-callback-model) for
the file:line evidence.

**Phase 1 is unblocked.** Phase 3 is unblocked once Phase 1 lands the `tier` field.

## Phase 1: Read path

Goal: A workspace can see and load global sources via the activation manifest. No write
operations yet.

### Files touched

| File | Change |
|---|---|
| `packages/shared/src/sources/storage.ts` | Add `GLOBAL_AGENT_SOURCES_DIR`, `WORKSPACE_GLOBAL_SOURCES_MANIFEST`, manifest read fns, `loadGlobalSource`, `loadGlobalSources`, `listGlobalSourceSlugs`. Extend `loadAllSources` to union activated globals + dormant (when requested). |
| `packages/shared/src/sources/types.ts` | Add `tier: SourceTier` to `LoadedSource`. |
| `packages/shared/src/sources/index.ts` | Export new symbols. |
| `packages/server-core/src/sessions/SessionManager.ts` | Replace `loadWorkspaceSources(ws)` with `loadAllSources(ws)` at the 6 callsites identified in recon. |
| `packages/shared/src/sources/__tests__/storage.test.ts` | New test file (or extend existing) — global path constants, manifest read tolerance, dormant exclusion, dedup by tier. |

### Acceptance

- A user manually creates `~/.agents/sources/notion/config.json` and `<ws>/.global-sources.json`
  with `{"activatedSlugs":["notion"]}`. Restarts. The session loads with Notion in the spawn list.
- Same setup but no manifest entry: Notion is NOT in the spawn list. Tool tier listing
  via `loadAllSources(ws, { includeDormant: true })` shows it as `global-dormant`.
- Same setup but `config.enabled = false` globally: Notion is NOT in the spawn list.

## Phase 2: Write path (activation + promotion)

Goal: User can activate / deactivate global sources and promote workspace sources to global,
all via UI.

### Files touched

| File | Change |
|---|---|
| `packages/shared/src/sources/storage.ts` | Add `activateGlobalSourceInWorkspace`, `deactivateGlobalSourceInWorkspace`, `mirrorSourceToGlobal`. Atomic-write pattern from skills. |
| `packages/shared/src/protocol/channels.ts` | Add `sources.LIST_GLOBAL`, `sources.GET_ENABLED_GLOBAL`, `sources.SET_GLOBAL_ENABLED`, `sources.PROMOTE_TO_GLOBAL`, `sources.CHANGED_GLOBAL`. |
| `packages/shared/src/protocol/events.ts` | Wire `sources:changedGlobal` event. |
| `packages/server-core/src/handlers/rpc/sources.ts` | New handlers for the new channels. |
| `apps/electron/src/renderer/atoms/sources.ts` | Add `globalSourcesAtom`, `activatedGlobalSlugsAtom`, `effectiveSourcesAtom`. |
| `apps/electron/src/renderer/components/sources/*` | List rows render tier badges; new actions; new modals. (See Phase 5 for the global library page.) |
| `apps/electron/src/transport/channel-map.ts` | Wire new channel handlers. |
| 7 locale files | New i18n keys per [04-ux.md § i18n keys](04-ux.md#i18n-keys). |

### Acceptance

- Activating a dormant global writes the manifest and the source becomes spawn-eligible.
- Deactivating an active global removes it from the manifest and the source unspawns
  on next session start (or hot-reload, depending on what the existing pipeline does for
  enabled-toggle).
- Promote-to-Global on a workspace source creates `~/.agents/sources/<slug>/`, activates it
  in the source workspace's manifest, and (without `includeCredentials`) leaves credentials
  alone.

## Phase 3: Credentials override

Goal: Workspace-specific credential override semantics work end-to-end.

### Files touched

| File | Change |
|---|---|
| `packages/shared/src/credentials/types.ts` | Add `override?: boolean` to `StoredCredential`. |
| `packages/shared/src/sources/credential-manager.ts` | Add `loadEffective(source)`. Extend `getCredentialId` to support `__global__`. |
| `packages/shared/src/sources/credential-manager.ts` (caller paths) | Replace direct `load(source)` calls in spawn-path with `loadEffective(source)`. Workspace-edit-flow callers stay on `load(source)`. |
| `packages/server-core/src/handlers/rpc/oauth.ts` | OAuth completion writes to the right tier (global vs workspace) based on source.tier and override flag. |
| `packages/server-core/src/handlers/rpc/sources.ts` | `SAVE_CREDENTIALS` and a new `DELETE_CREDENTIALS_OVERRIDE` channel. |
| `apps/electron/src/renderer/components/sources/*` | "Use different creds" / "Revert to global" actions wired. |
| Tests across all 4 packages above | Override flag, fallback resolution, OAuth tier dispatch. |

### Acceptance

- Global Notion exists with personal account creds. Activating in workspace W and clicking
  "Use different creds" → workspace creds get written. Sessions in W use work creds; sessions
  in other workspaces continue with personal.
- "Revert to global creds" deletes the workspace creds. W reverts to personal.
- Token refresh writes to the right tier in both cases.

## Phase 4: `list_sources` tool + `source-recipe`

Goal: Agents can introspect available sources and reason about bundling.

### Files touched

| File | Change |
|---|---|
| `packages/session-tools-core/src/handlers/list-sources.ts` | New file — mirrors `list-skills.ts`. |
| `packages/session-tools-core/src/tool-defs.ts` | Register `list_sources` tool. Description must use trigger language. |
| `packages/session-tools-core/src/context.ts` | Extend `SessionToolContext` with `listSources?(opts): ListSourcesResult`. |
| `packages/shared/src/agent/session-self-management-bindings.ts` | Bind `listSources` to a real implementation calling `loadAllSources`. |
| `packages/shared/src/skills/starter-templates.ts` | Add `SOURCE_RECIPE_SKILL` and entry in `STARTER_SKILLS`. |
| `~/.agents/skills/source-recipe/SKILL.md` (live) | Mirror — for the existing user install. |

### Acceptance

- `list_sources` is callable from any session, returns the same shape as `list_skills` but
  for sources.
- A new agent created via Concierge / agent-creator gets a curated source bundle (≤3) that
  matches its specialty, not a kitchen sink.

## Phase 5: Settings → Global Sources Library page

Goal: One place to create / edit / delete global source definitions.

### Files touched

| File | Change |
|---|---|
| `apps/electron/src/renderer/pages/GlobalSourcesLibraryPage.tsx` | New page. |
| `apps/electron/src/renderer/components/app-shell/SettingsNav.tsx` (or equivalent) | New nav entry. |
| Reuse existing source editor components | Same form as workspace source editor, just writes to a different RPC. |
| `packages/server-core/src/handlers/rpc/sources.ts` | `CREATE_GLOBAL`, `UPDATE_GLOBAL`, `DELETE_GLOBAL` channels. Block delete when active in any workspace (or warn + cascade-deactivate, TBD). |

### Acceptance

- User creates a new global source from the library page, logs in, the source becomes
  available to activate in any workspace.
- Editing a global source's `config.json` propagates: open sessions hot-reload via the
  existing pipeline.

## Parallel-execution partition

Five non-overlapping lanes. After Phase 0 spike completes, lanes can run in parallel as
separate subagents. File ownership is strict — no two lanes touch the same file:

### Lane A — Shared storage layer

**Owns:**
- `packages/shared/src/sources/storage.ts`
- `packages/shared/src/sources/types.ts`
- `packages/shared/src/sources/index.ts`
- `packages/shared/src/sources/__tests__/storage.test.ts`

**Deliverables:** Phase 1 storage + Phase 2 mirror function + Phase 3 type changes
(`override` on `StoredCredential` requires a touch in `packages/shared/src/credentials/types.ts`
which lane A also owns).

### Lane B — Server-side wiring

**Owns:**
- `packages/server-core/src/sessions/SessionManager.ts` (the 6 call-site swaps)
- `packages/server-core/src/handlers/rpc/sources.ts`
- `packages/server-core/src/handlers/rpc/oauth.ts`
- `packages/shared/src/protocol/channels.ts`
- `packages/shared/src/protocol/events.ts`

**Deliverables:** All RPC channels wired. OAuth tier dispatch. Backfill `ensureRequiredGlobalSources`
hook in initialize.

### Lane C — Credentials

**Owns:**
- `packages/shared/src/sources/credential-manager.ts`
- `packages/shared/src/sources/__tests__/credential-manager-*.test.ts`
- The `loadEffective` rollout — caller-path patches in spawn-path code (lane B coordinates
  but lane C owns the cred-manager-internal changes)

**Deliverables:** Phase 3 in full.

### Lane D — Renderer UI + atoms

**Owns:**
- `apps/electron/src/renderer/atoms/sources.ts`
- `apps/electron/src/renderer/components/sources/*` (list, dialogs, status indicator)
- `apps/electron/src/renderer/pages/SourceInfoPage.tsx`
- `apps/electron/src/renderer/pages/GlobalSourcesLibraryPage.tsx` (new)
- `apps/electron/src/transport/channel-map.ts`
- 7 locale files

**Deliverables:** Phase 2 UI, Phase 5 settings page, all i18n keys.

### Lane E — Session tools + skill-recipe analog

**Owns:**
- `packages/session-tools-core/src/handlers/list-sources.ts` (new)
- `packages/session-tools-core/src/tool-defs.ts` (additions only — no overlap)
- `packages/session-tools-core/src/context.ts` (additions only)
- `packages/shared/src/agent/session-self-management-bindings.ts`
- `packages/shared/src/skills/starter-templates.ts` (additions to STARTER_SKILLS only)
- `~/.agents/skills/source-recipe/SKILL.md` (live)

**Deliverables:** Phase 4 in full.

### Coordination points

Three places lanes touch each other and need explicit handshake:

1. **`LoadedSource.tier` field** — Lane A defines it; Lane B and Lane D consume it. Lane A
   ships first.
2. **RPC channel constants** — Lane B defines; Lane D consumes. Lane B ships first.
3. **`StoredCredential.override` flag** — Lane A defines; Lane C uses; Lane D presents.
   Lane A → C → D order.

Suggested execution order: **A in parallel with B**, then **C**, then **D and E in
parallel**.

## Tests budget

- **Storage:** ~6 tests — manifest read tolerance, dormant exclusion, mirror atomicity, mirror
  with credential, mirror collision, dedup priority order.
- **Credentials:** ~6 tests — `loadEffective` workspace key, `loadEffective` global fallback,
  override flag suppresses fallback, save tier dispatch, OAuth completion writes correct tier,
  delete-override restores fallback.
- **Server / RPC:** ~3 tests — activate/deactivate channel writes manifest, mirror channel
  validates non-collision, oauth completion writes correct tier.
- **Session tools:** ~2 tests — `list_sources` returns activated globals, `list_sources`
  excludes dormant unless requested.
- **Renderer:** smoke tests for atom selectors and tier-badge rendering.

Target: **~17 new tests** + extensions to ~3 existing tests. Total floor uplift from current
166 → ~183.

## Typecheck floor

`packages/shared`, `packages/server-core`, `packages/session-tools-core`, `apps/electron` —
all four must remain green at every commit. Lane owners run their package's typecheck
before staging.

## Commit style

Follow the existing `<area>: <imperative>` lowercase pattern. Suggested split:

1. `sources: load globals via activation manifest` (Lane A Phase 1)
2. `sources: add promote-to-global mirror` (Lane A Phase 2 storage)
3. `sources: wire global activation rpc` (Lane B Phase 2)
4. `sources: workspace credential override` (Lanes A+C Phase 3)
5. `sources: oauth tier dispatch` (Lane B Phase 3)
6. `sources: add list_sources session tool` (Lane E Phase 4)
7. `skills: add source-recipe starter` (Lane E Phase 4)
8. `sources: ui activate/deactivate/promote actions` (Lane D Phase 2)
9. `sources: ui credential override flow` (Lane D Phase 3)
10. `sources: settings page for global library` (Lane D Phase 5)

Each commit independently typechecks and tests. No commit-bombs.

## Risk register

| Risk | Mitigation | Owner |
|---|---|---|
| OAuth callback URL is workspace-scoped | RESOLVED — Phase 0 verdict is stable + state-tracked. No refactor needed. | Phase 0 (closed) |
| Concurrent mirror races | Reuse `mirrorSkillToGlobal` atomic pattern verbatim. | Lane A |
| Credential keychain backend doesn't accept `__global__` sentinel | Smoke test in Phase 3, fall back to filesystem-only path if needed. | Lane C |
| Renderer atom desync after manifest write | Use the existing `sources:changed` reload path; verify it covers the new manifest channel too. | Lane D |
| `list_sources` returns full descriptions (could be long, eat context) | Cap description in tool result the same way `list_skills` does today. | Lane E |
| User has same slug at workspace + global with different creds, then deletes workspace copy | After delete, workspace falls back to global creds. Document; this is expected. | Phase 2 docs |
| Session running when a source is deactivated mid-flight | Existing reload pipeline handles it via `setSourceServers`. Smoke-test it. | Lane B |

## Definition of done

- All 5 phases land.
- All 4 typechecks green.
- ~17 new tests + 3 extensions pass.
- Manual smoke matrix:
  - [ ] Activate global Notion in workspace → spawn picks it up.
  - [ ] Deactivate → spawn stops.
  - [ ] Promote workspace source → appears at global tier, activated in source ws.
  - [ ] Use different creds in W → W uses override, others use global.
  - [ ] Revert to global → W reverts.
  - [ ] OAuth global Notion in fresh global → all activated workspaces inherit.
  - [ ] Delete a global with active workspaces → block or cascade-deactivate (TBD per Lane D).
  - [ ] `list_sources` from a session returns correct tier labels.
  - [ ] Concierge / agent-creator suggests source bundle within cap of 3.
- Commit messages follow the existing repo convention.
- `docs/global-sources/` updated with anything that surfaced during implementation.
