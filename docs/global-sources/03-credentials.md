# Global Sources — Credentials

The headline complication. Skills don't have credentials; sources do. This doc establishes
the storage model, resolution order, override mechanic, OAuth callback semantics, and threat
model.

## Goals

1. **One login, reused everywhere.** Activate Notion globally, log in once, every workspace
   sees it. Don't re-OAuth per workspace.
2. **Workspace override possible.** A workspace that needs different creds (work vs personal
   Notion) can override without breaking other workspaces.
3. **No silent fallback ambiguity.** When the user says "use these creds in this workspace,"
   they get those creds — not some surprising fallback behavior.
4. **Credentials never leak across workspaces unintentionally.** A workspace using its own
   override doesn't accidentally reveal the global creds via tool output, telemetry, or logs.

## Storage

### Today

Existing keying ([packages/shared/src/sources/credential-manager.ts:281](packages/shared/src/sources/credential-manager.ts:281)):

```
source_oauth::{workspaceId}::{sourceSlug}
source_bearer::{workspaceId}::{sourceSlug}
source_apikey::{workspaceId}::{sourceSlug}
source_basic::{workspaceId}::{sourceSlug}
```

The `CredentialManager` (see [packages/shared/src/credentials/](packages/shared/src/credentials/))
abstracts away whether the actual storage is OS keychain, encrypted file, or plain JSON. We
reuse it.

### After

Add a new sentinel workspace value `__global__` to indicate the global tier:

```
source_oauth::__global__::{sourceSlug}
source_bearer::__global__::{sourceSlug}
source_apikey::__global__::{sourceSlug}
source_basic::__global__::{sourceSlug}
```

The leading double-underscore prevents collision with any real workspace ID (which is a
basename of a workspace root path, unlikely but possible to start with `__`). For belt-and-
suspenders, the workspace creation flow rejects any workspace whose folder name starts with
`__` going forward (one-line validator addition).

### Resolution at load time

The credential manager gets one new method:

```typescript
async loadEffective(source: LoadedSource): Promise<StoredCredential | null> {
  // 1. Try workspace-scoped key.
  const wsId = getCredentialId(source);  // existing — uses source.workspaceId
  const ws = await getCredentialManager().get(wsId);
  if (ws) return ws;

  // 2. If source is a global tier, fall back to global key.
  if (source.tier === 'global') {
    const globalId = { ...wsId, workspaceId: '__global__' };
    const g = await getCredentialManager().get(globalId);
    if (g) return g;
  }

  return null;
}
```

The existing `load(source)` method **stays unchanged** — it returns workspace-only creds and
is used in workspace-edit flows where you specifically want the workspace value (e.g.,
"clear my override" should not return the global). All session-spawn paths and `isSourceUsable`
checks call the new `loadEffective`.

### Save semantics

Saves are **always tier-explicit** — never ambiguous about which key gets written:

| User action | Key written |
|---|---|
| OAuth completes for an activated global source (no workspace override exists) | `source_*::__global__::{slug}` |
| OAuth completes for a workspace source | `source_*::{workspaceId}::{slug}` (existing) |
| User clicks "Use different creds in this workspace" on a global source | Marks the workspace as override-pending; next OAuth/manual-save writes to `source_*::{workspaceId}::{slug}` |
| User clicks "Revert to global creds" on a workspace override | Deletes the `source_*::{workspaceId}::{slug}` key. Next load falls back to global. |
| User manually edits creds on the global tier | `source_*::__global__::{slug}` |
| Mirror with `includeCredentials: true` | Reads workspace key, re-encrypts, writes global key, leaves workspace key in place. |

There is **no auto-promote** of workspace creds to global. Promotion is explicit.

## The override mechanic — UX vs internals

The user-facing model from [00-README.md](00-README.md):

> If the user wants different api/creds for this workspace, they can delete default and
> update with no key (that doesn't update keys in any source/workspace but itself).

Internally this is two distinct operations the UI presents as one fluid action:

1. **Delete default in this workspace** → write a workspace-local credential record marked
   `{ override: true, value: null }`. This *shadows* the global at load time even though
   no actual credential is set yet — `loadEffective` checks for the override flag and
   returns `null` rather than falling back to global.
2. **User adds new creds** → workspace credential record gets `{ override: true, value: <new> }`.

Why the override flag instead of just an empty workspace credential entry? Because we need
to distinguish "no creds at this tier yet" (fall back to global) from "explicitly suppressed
the global for this workspace" (don't fall back). Without the flag, "delete default" would
silently re-fall-back to the global cred, which violates goal 3.

```typescript
interface StoredCredential {
  // existing fields...
  override?: boolean;   // NEW: when true at workspace tier, suppress global fallback
}
```

`loadEffective` becomes:

```typescript
const ws = await getCredentialManager().get(wsId);
if (ws?.override === true) return ws.value ? ws : null;  // explicit suppression
if (ws) return ws;                                         // ordinary workspace creds
if (source.tier === 'global') return await getCredentialManager().get(globalKey(source));
return null;
```

The "Revert to global creds" UI action deletes the entire workspace record (including the
flag), restoring the implicit fallback.

## OAuth callback model

The risk flagged in [00-README.md](00-README.md): some OAuth providers require a fixed
redirect URL registered with the provider's app config. If RunnerOS baked a `workspaceId`
into the callback URL, global sources would break OAuth.

### Phase 0 spike — RESOLVED

Verdict: **stable + state-tracked**. No callback refactor needed.

Evidence:
- [packages/shared/src/auth/generic-oauth.ts:52](packages/shared/src/auth/generic-oauth.ts:52) —
  `redirectUri` is `callbackUrl ?? \`http://localhost:${callbackPort}/callback\``. No
  workspace, session, or source path component.
- [packages/shared/src/auth/oauth-flow-types.ts:19](packages/shared/src/auth/oauth-flow-types.ts:19) —
  the `state` parameter is the sole key into a server-side `PendingOAuthFlow` store.
- [packages/server-core/src/handlers/rpc/oauth.ts:38,114](packages/server-core/src/handlers/rpc/oauth.ts:38) —
  flow record stores `workspaceId`, `sourceSlug`, `ownerClientId`, `sessionId`,
  `authRequestId`, and full OAuth parameters. Callback retrieves all context via state.

### What this means for Global Sources

The OAuth callback URL is identical for global and workspace sources — `http://localhost:{port}/callback`.
What differs is what the callback handler does once it has the flow context:

- **Today:** writes the resolved token to `source_oauth::{flow.workspaceId}::{flow.sourceSlug}`.
- **After Phase 3:** writes to either `source_oauth::__global__::{flow.sourceSlug}` (when
  the source resolves to the global tier and no workspace override is in effect) or
  `source_oauth::{flow.workspaceId}::{flow.sourceSlug}` (when the workspace explicitly
  overrode global creds).

The dispatch decision happens at [packages/server-core/src/handlers/rpc/oauth.ts:49 (`credManager.exchangeAndStore`)](packages/server-core/src/handlers/rpc/oauth.ts:49).
The handler reads `flow.source.tier` (added to the flow record in Phase 1) and the
override flag, then routes the write to the right credential ID. Single-line change at
the call site, all the logic lives in `CredentialManager`.

No additional registered redirect URLs need updating in third-party app configs (Notion,
Slack, etc.). The user's existing OAuth app registrations continue to work.

## Token refresh

`TokenRefreshManager` is keyed by source slug ([packages/shared/src/sources/token-refresh-manager.ts:40](packages/shared/src/sources/token-refresh-manager.ts:40)),
not by workspace. Cooldown tracking is per-instance (per-session). This works correctly for
global sources without changes:

- Session A activates global Notion → refresh fails → 5min cooldown for Notion in Session A.
- Session B activates global Notion at the same time → has its own cooldown counter →
  retries independently.

This is the documented current behavior. The recon noted it as a gotcha — for our purposes,
it's actually the right behavior. Independent retry per session prevents one session's
broken refresh from stalling all others.

When the refresh succeeds and writes the new token, the write goes through the same
`loadEffective`-respecting save path: if the source is at the global tier and not
overridden in this workspace, the new token writes to the global key; otherwise it writes
to the workspace key. All sessions immediately benefit on next load.

## Credential portability across machines

Out of scope. Global creds are stored locally (filesystem or OS keychain depending on
existing CredentialManager backend). No multi-device sync.

If a user wants to copy their global setup to another machine, they `rsync ~/.agents/` —
same as skills. Whether the keychain entries come along depends on the keychain backend
and the OS; for filesystem-based credential storage, they do.

## Threat model

| Threat | Mitigation |
|---|---|
| Workspace A reads workspace B's override creds via `loadEffective` | Override creds are keyed by workspaceId. `loadEffective` only checks the calling source's `workspaceId`. Cross-workspace lookup never happens. |
| Workspace agent exfiltrates global creds via tool output | Tool outputs only see resolved tokens that were used for an authenticated request, not raw cred records. Same threat model as today; no change. |
| Promote-with-credentials silently uploads workspace creds to global | Default is `includeCredentials: false`. Confirm dialog when user opts in. |
| Concurrent OAuth flows for the same global source from two workspaces race | Both flows use the same `state`-tracked dispatch. Last write wins on the credential key. The losing flow's tokens are still valid (refresh tokens are per-grant, not per-app-state) — user just gets the most recent set. |
| Stale global creds keep getting tried by new sessions | After refresh failure → cooldown → user notified. UI surfaces "global creds need re-auth" prominently. User clicks → re-OAuth at global tier → all sessions pick up new creds. |
| Malicious workspace source with the same slug as a global tries to override | Workspace tier wins by design. This is identical to the existing "I install Notion in my workspace, my workspace's Notion config is what I see" — no change. |

## Concurrency

Credential writes already use the existing `CredentialManager`'s write path, which is
expected to be atomic per backend (filesystem-based uses `writeFileSync` with `O_TRUNC`;
keychain-based delegates to OS atomicity). No new concurrency concerns introduced by
moving the workspace identifier from `{wsId}` to `__global__`.

For the override flag specifically: writes are full-record replacements, never field
updates, so no read-modify-write race exists. A "delete override" operation is a single
DELETE, not a flag flip.

## Migration

For users with existing workspace-tier OAuth setups: nothing changes. Their workspace
sources keep their workspace-keyed credentials. They never touch the `__global__` namespace
unless they explicitly promote a source.

The first time a user clicks "Promote to Global" with `includeCredentials: true`, their
workspace creds get *copied* (not moved) to the global key. They're now in two places. The
`loadEffective` resolution still works correctly: workspace key wins.

If the user later wants to use the global creds in that originating workspace too:
"Revert to global creds" deletes the workspace copy. From then on, the workspace uses the
global. No data loss because the global copy was created before.

## Worked examples

### Example 1: One Notion account everywhere

1. User installs `notion` MCP at the global tier (UI: New Source → Promote to Global, or
   the future "browse global library" flow).
2. UI prompts to log in. OAuth completes. Token written to `source_oauth::__global__::notion`.
3. User activates `notion` in workspace A → adds slug to `<wsA>/.global-sources.json`.
4. User activates `notion` in workspace B → adds slug to `<wsB>/.global-sources.json`.
5. Both workspaces' sessions spawn the Notion MCP using the global token. One login.

### Example 2: Personal Notion globally, work Notion in workspace W

1. State after Example 1: global Notion uses personal account.
2. In workspace W, user clicks the source's "Use different credentials in this workspace"
   action.
3. UI: "This will override the global credentials with workspace-only credentials. Continue?"
4. On confirm: workspace credential record at `source_oauth::W::notion` written with
   `{ override: true, value: null }`.
5. UI prompts to log in. Work-account OAuth completes. Workspace record updated with token.
6. From now on, sessions in workspace W use work-Notion. All other workspaces continue with
   personal-Notion.

### Example 3: Revert workspace W to global

1. State after Example 2.
2. In workspace W, user clicks "Revert to global credentials."
3. UI: "This deletes your workspace-specific work-Notion credentials. Continue?"
4. On confirm: workspace credential record at `source_oauth::W::notion` deleted.
5. From now on, sessions in workspace W fall back to the global token (personal account).
   Other workspaces unaffected.

## Open questions

These need a one-hour spike or a decision before implementation:

1. **OAuth callback URL format** — see [§ OAuth callback model](#oauth-callback-model) above.
2. **Keychain backend behavior under `__global__` keying** — does the existing keychain
   provider (if used) handle our sentinel cleanly? Verify with a smoke test.
3. **Bearer/API-key sources in the global tier** — most of the design is OAuth-flavored. For
   bearer/API-key sources the override flow is the same, just sans OAuth dance. UI should
   still distinguish "use global creds" / "use workspace-specific creds" / "no creds set."
   Confirm before UI implementation that this maps cleanly.
4. **Should `loadEffective` log or telemeter when fallback happens?** Useful for debugging
   "why is this source using my work account instead of personal?" Soft-yes; log at debug.
