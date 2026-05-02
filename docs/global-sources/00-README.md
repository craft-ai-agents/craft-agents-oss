# Global Sources

A precise architectural mirror of "Global Skills," extended to **sources** (MCP servers, API
connectors, local connectors). Sources become **define-once-globally, activate-per-workspace**,
with credentials inherited globally by default and workspace-override allowed.

## The pitch

> Today: install Notion MCP in workspace A, paste credentials, OAuth dance. Repeat for
> workspace B. Repeat for workspace C. Every credential update means N edits.
>
> After: install Notion MCP once at the global tier, log in once. Activate it in the workspaces
> that should see it. A workspace that needs different credentials (e.g., personal vs work
> Notion) drops in a workspace-local override; everything else continues to share the global
> creds.

## Why now

The global skills mirror landed (commit `1e87836`), proving the architecture: definition
global, activation per-workspace via a workspace-scoped manifest, with workspace-local
overrides preserving the priority order. Sources are the obvious next noun for the same
treatment.

Sources also have a problem skills don't: **credentials**. The bulk of the design effort here
goes into making credentials inherit-by-default-but-overridable cleanly.

## What this is not

- **Not** a process-pool change. MCP servers are already session-scoped (spawned at session
  start, killed at session end) — see [SessionManager.ts:684](packages/server-core/src/sessions/SessionManager.ts:684).
  The "30 servers running at once eating tokens" failure mode is not the current reality.
  This feature solves the **definition + credential duplication** problem, not a process
  lifecycle problem.
- **Not** a multi-tenant credentials store. The global tier is per-user. This is local-first
  desktop software for one user with many workspaces.
- **Not** a registry of public/community sources to install from. That's a separate idea.
  Global Sources is about *your* installed sources being reusable across *your* workspaces.

## Doc map

| Doc | What it covers |
|---|---|
| [00-README.md](00-README.md) | This doc — pitch, problem, decision summary, doc nav |
| [01-spec.md](01-spec.md) | File layout, manifest schema, source-config compatibility, fields that move and fields that stay |
| [02-runtime.md](02-runtime.md) | Load order, three-gate spawn rule, session lifecycle integration, mirror/backfill behavior, concurrency |
| [03-credentials.md](03-credentials.md) | The headline complication — global creds default, workspace-override semantics, OAuth callback model, token-refresh keying, security threat model |
| [04-ux.md](04-ux.md) | Renderer changes — Sources page tabs, dormant tier, activate / deactivate / promote / override actions, agent-creator integration via list_sources |
| [05-implementation-plan.md](05-implementation-plan.md) | Phased rollout + parallel-execution partition by file ownership |

## Decision summary

| Decision | Choice | Why |
|---|---|---|
| Definition tier | `~/.agents/sources/<slug>/` | Mirrors `~/.agents/skills/`. Same backup/sync semantics. |
| Activation manifest | `<workspace>/.global-sources.json` | Mirrors `.global-skills.json`. Per-workspace opt-in list of slugs. |
| Workspace override | `<workspace>/sources/<slug>/` (existing) | Same-slug shadow wins at load. Preserves existing behavior. |
| Credentials default | Global at `~/.agents/sources/<slug>/credentials.json` | One login, reused everywhere. Matches user mental model. |
| Credential override | Workspace-local credential file shadows global | Multi-account scenarios (work vs personal Notion). |
| Override mechanic | "Delete default + add fresh creds in workspace" | Explicit, no silent fallback chain confusion. |
| Promote-to-global | Manual UI action on a workspace source | Auto-mirror is too surprising for credentialed objects. |
| Auto-mirror | **Off**. Skills auto-mirror; sources don't. | Credentials change the safety calculus. |
| `list_sources` tool | New session tool, mirrors `list_skills` | Lets agent-creator's `skill-recipe` analog (and any agent) introspect available sources. |
| Token refresh keying | Per-source-slug (unchanged) | Already slug-keyed, not workspace-keyed. No work needed. |
| Migration | None — additive feature | Existing workspace sources stay put. Promote button is opt-in. |

## The hard part

The credentials story. A source in workspace A and the same source in workspace B need to be
*the same source* by default — same access token, same OAuth refresh — but workspace B should
be able to say "for this workspace I want my work account, not my personal one" without
breaking workspace A.

The credential ID format today is `source_oauth::{workspaceId}::{sourceId}`. To support the
global tier, this becomes:

- **Global creds:** `source_oauth::__global__::{sourceId}`
- **Workspace override:** `source_oauth::{workspaceId}::{sourceId}` (existing, unchanged)
- **Resolution order at load:** workspace key → fall back to global key → null

When the user "deletes default + adds fresh creds in workspace," what happens mechanically:
the workspace simply gets its own credential at the workspace key. The global cred is
untouched. Other workspaces continue to use the global cred. See [03-credentials.md](03-credentials.md)
for the full model, security implications, and OAuth callback gotchas.

## Estimated scope

- **18 files** changed across 4 packages
- **~1,800 LOC** new (extrapolated from skills mirror commit footprint)
- **~12 new tests** (storage, manifest, credential fallback, mirror atomicity, list_sources)
- **7 i18n locale files** updated
- **1 new session tool** (`list_sources`)
- **3 new RPC channels** (`LIST_GLOBAL`, `GET_ENABLED_GLOBAL`, `SET_GLOBAL_ENABLED`)

## Risks worth naming

1. **OAuth callback URL format.** ✅ Closed by Phase 0 spike. Verdict: stable callback URL
   (`http://localhost:{port}/callback`) with state-tracked dispatch. Phase 3 credential
   dispatch is a one-line change at the handler's `credManager.exchangeAndStore` call site.
   See [03-credentials.md § OAuth callback model](03-credentials.md#oauth-callback-model).
2. **Stdio MCP global compatibility.** A global stdio MCP source assumes the command works in
   any workspace's environment. For most stdio sources this is fine (they're npx-installed).
   For ones that depend on workspace cwd or env, document the constraint and let users opt to
   keep them workspace-only.
3. **Concurrent mirror races.** Same pattern proved in the skills mirror — staging temp
   directory + atomic rename. Reuse the same approach. See [02-runtime.md § Concurrency](02-runtime.md#concurrency).
