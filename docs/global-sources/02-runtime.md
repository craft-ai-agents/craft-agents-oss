# Global Sources — Runtime

## Load order

`loadAllSources(workspaceRoot, { includeDormant })` materializes the effective source list.
Resolution order, highest priority first:

1. **Workspace sources** — every directory under `<workspace>/sources/<slug>/`. `tier:
   'workspace'`. Always included regardless of any manifest.
2. **Activated globals** — every slug listed in the workspace's `.global-sources.json` that
   resolves to a directory under `~/.agents/sources/<slug>/`. Skipped if the slug also
   exists at the workspace tier (workspace wins). `tier: 'global'`.
3. **Project sources** — existing concept, unchanged. `tier: 'project'`.
4. **Dormant globals** — only when `includeDormant: true`. Globals NOT in the manifest, NOT
   shadowed by a workspace source. `tier: 'global-dormant'`. Used by UI listings; never used
   for spawning.

Deduplication by slug happens at load time. The first-matched entry wins; subsequent matches
are dropped. This means workspace-tier wins over activated globals, which win over project,
which win over dormant.

## Spawn lifecycle

The session-tools-core / SessionManager spawn pipeline is unchanged in shape. What changes
is the input to `buildServersFromSources`:

```
loadAllSources(workspaceRoot)             // workspace + activated globals + project
  → filter(isSourceUsable)                 // 3-gate spawn rule
  → buildServersFromSources(...)
  → setSourceServers(mcpServers, apiServers, intendedSlugs)
```

### The three-gate spawn rule

A source is spawned in a session iff **all three** are true:

| Gate | Where checked | Source of truth |
|---|---|---|
| **Activated** in this workspace | `loadAllSources` resolution | `.global-sources.json` (for global tier) or directory existence (for workspace tier) |
| **Enabled** flag on config | `getEnabledSources` filter | `config.enabled` boolean in `config.json` |
| **Authenticated** (or `auth: 'none'`) | `isSourceUsable` | Credential lookup result (see [03-credentials.md](03-credentials.md)) |

A dormant global passes 0/3. An activated-but-disabled global passes 1/3. An activated,
enabled, but credential-less OAuth source passes 2/3 — the UI surfaces "needs auth" but no
process spawns.

### Process scope: still per-session

This feature does NOT change MCP process lifecycle. Servers spawn at session start, die at
session end. There is no shared global MCP daemon. Each session gets its own copy of every
activated source's process — exactly as today.

What this means in practice:
- Activating a source in a workspace doesn't spawn a process. Only opening a session does.
- Deactivating a source mid-session triggers a `setSourceServers` call with the slug
  removed from `intendedSlugs`. Existing servers in `intendedSlugs` survive; the deactivated
  one's connection is gracefully closed by the SDK.
- Dormant globals never spawn until activated.

## Mid-session source toggles

When the user activates / deactivates a source while a session is running:

1. RPC handler updates `.global-sources.json` (via atomic write).
2. RPC handler emits `sources:changedGlobal` event (renderer + active sessions subscribe).
3. SessionManager's existing source-reload pipeline ([SessionManager.ts:2039](packages/server-core/src/sessions/SessionManager.ts:2039))
   re-runs `loadWorkspaceSources` (now `loadAllSources`) → re-runs `buildServersFromSources`
   → calls `setSourceServers` with the new `intendedSlugs`.
4. SDK reconciles: new sources spawn, removed sources disconnect, existing sources untouched.

The pipeline already exists. This feature only changes the *input* to `loadWorkspaceSources`,
not the wiring downstream. The Pi/SDK constraint about freezing mcpServers (noted in
[SessionManager.ts:4742](packages/server-core/src/sessions/SessionManager.ts:4742)) is
respected by going through `setSourceServers`, which is the SDK-blessed reconcile path.

## Mirror flow (promote workspace → global)

User clicks "Promote to Global" on a workspace source. RPC calls `mirrorSourceToGlobal(ws, slug, opts)`.

Steps (atomic-write pattern from `mirrorSkillToGlobal`):

1. **Validate** — workspace source exists; slug doesn't already exist at global (unless
   `overwrite: true`); workspace source has a valid config.
2. **Stage** — copy `<workspace>/sources/<slug>/` (config, guide, icon) into
   `~/.agents/sources/.tmp-<slug>-<pid>-<rand>/`.
3. **Credentials decision** — if `includeCredentials: true`:
   - Read workspace credential under `source_*::{workspaceId}::{slug}` key.
   - Re-encrypt under `source_*::__global__::{slug}` key, write to staging dir.
   - Default is **`includeCredentials: false`** — promote the source definition only, prompt
     the user to log in fresh at the global tier. Safer.
4. **Promote** — `renameSync` staging dir → `~/.agents/sources/<slug>/`. If a global already
   exists and `overwrite: true`, move the existing into `.old-<slug>-<pid>-<rand>/` first,
   delete after rename.
5. **Activate in source workspace** — append `<slug>` to `.global-sources.json` so the
   workspace continues to see the source after promotion.
6. **Optionally delete workspace copy** — only if user explicitly opts in. Default is to
   leave the workspace copy in place; it shadows the global, which is fine. Clean up later.
7. **Emit events** — `sources:changedGlobal` to renderer; `sources:changed` to the workspace.

If two workspaces concurrently promote the same slug:
- Whoever wins the `renameSync` race wins. The loser's staging dir is cleaned up in
  `finally`. The loser's workspace gets its slug appended to its manifest, so it sees the
  promoted source (which is the winner's content) — surprising but harmless.
- This race is rare in practice. Document and move on.

## Backfill on app start

`SessionManager.initialize` already runs the skills backfill ([SessionManager.ts:2041](packages/server-core/src/sessions/SessionManager.ts:2041)).
A parallel `ensureRequiredGlobalSources(STARTER_SOURCES)` call lands here.

For v1 there are **no starter sources** — `STARTER_SOURCES = []`. Sources that currently
ship as workspace-defaults (per [builtin-sources.ts](packages/shared/src/sources/builtin-sources.ts))
stay where they are. We're not migrating anything in v1. The infrastructure exists for
future use.

Auto-mirror of workspace sources → global is **NOT** enabled. Skills auto-mirror because
they're idempotent text. Sources with credentials are not — surprising the user by
automagically uploading their workspace creds to the global tier is unacceptable. Promotion
stays manual.

## Concurrency

All file writes use the canonical RunnerOS pattern:

```
const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
writeFileSync(tmp, content);
renameSync(tmp, file);
```

The protected files:
- `.global-sources.json` — writers: UI activate, mirror, RPC.
- `~/.agents/sources/<slug>/config.json` — writers: mirror (rename from staging dir).
- `~/.agents/sources/<slug>/credentials.json` — writers: OAuth flow, manual creds save,
  mirror with `includeCredentials`.

For credential writes specifically, see [03-credentials.md § Concurrency](03-credentials.md#concurrency)
— the existing `CredentialManager` already does atomic writes; we inherit that.

## Cache invalidation & live reload

The renderer's source list atom (`sourcesAtom` in [apps/electron/src/renderer/atoms/sources.ts](apps/electron/src/renderer/atoms/sources.ts))
gets two new sibling atoms:

```typescript
const globalSourcesAtom = atom<LoadedSource[]>([]);              // all globals (definition tier)
const activatedGlobalSlugsAtom = atom<Set<string>>(new Set());   // current workspace activations
const effectiveSourcesAtom = atom<LoadedSource[]>(get => /* union as in loadAllSources */);
```

On `sources:changed` or `sources:changedGlobal` events, the affected atom(s) refetch from
RPC. Components select from `effectiveSourcesAtom` for the runtime view, or from the raw
atoms for the global library browser.

## File watcher

The skills auto-mirror logic uses a `ConfigWatcher` that fires on workspace skill
write/create. **For sources, no equivalent watcher.** Promotion is explicit. Removing the
watcher avoids the "I just saved my workspace source's creds and they got auto-uploaded
globally" footgun.

## Failure modes

| Scenario | Behavior |
|---|---|
| Manifest missing | Treat as `{ activatedSlugs: [] }`. Lazy-create on first activation. |
| Manifest malformed | Log error. Treat as empty. Backup to `.global-sources.json.broken-<ts>` for forensics. |
| Activated slug points to a deleted global | Log warn. Drop from runtime list. Leave the manifest entry until next write (no automatic cleanup; lets users restore the global). |
| Global config.json malformed | Skip during load. Log error. UI shows "broken" badge. |
| Credentials missing for activated global with `auth !== 'none'` | Source loads but is unusable; UI shows "needs auth"; spawn skipped. |
| Mirror collision (slug already exists globally) | Without `overwrite: true`, fail fast with a clear error. With `overwrite: true`, move the existing aside before rename. |
| Two workspaces activate the same global concurrently | Both succeed independently — they update different manifests. No conflict. |
| User deletes a global while a session has it spawned | Process keeps running until session ends. Next session refuses to spawn (slug doesn't resolve). UI shows broken state until manifests are reconciled. |

## Performance budget

- Loading globals adds one `readdirSync` of `~/.agents/sources/` per `loadAllSources` call.
  Same cost shape as skills, which has been fine in practice.
- Manifest read is one small JSON file (sub-1KB typically). Negligible.
- No network or process I/O at load time.

## Where this fits in the existing pipeline

```
Session start
  → SessionManager.initialize
      → ensureRequiredGlobalSkills(STARTER_SKILLS)         // existing
      → ensureRequiredGlobalSources(STARTER_SOURCES)       // NEW (no-op for v1)
      → silentSkillBackfill (existing watcher)             // existing
      → (no source backfill — explicit promotion only)     // NEW absence
  → SessionManager.startSession
      → loadAllSources(ws, { includeDormant: false })       // CHANGED to use new union loader
          → (existing) loadWorkspaceSources
          → (NEW) read .global-sources.json + load activated globals
          → (NEW) load project sources (unchanged)
      → getEnabledSources(...)                              // unchanged
      → isSourceUsable filter                               // unchanged
      → buildServersFromSources                             // unchanged
      → setSourceServers(mcpServers, apiServers, intendedSlugs)  // unchanged
```

Five changes, zero in the spawn pipeline.
