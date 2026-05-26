# RunnerOS Upgrades — What to Steal from Hermes and OpenHuman

A focused architecture + roadmap doc. Drop this in the RunnerOS repo root (or `docs/UPGRADES.md`).

Written after reading the orchestration source code of all three projects:
- This repo (RunnerOS, fork of `craft-ai-agents/craft-agents-oss`, Apache 2.0, TypeScript)
- Hermes Agent (`NousResearch/hermes-agent`, MIT, Python)
- OpenHuman (`tinyhumansai/openhuman`, GPL-3.0, Rust)

---

## TL;DR

RunnerOS already has the most serious workflow engine of the three. Its `automations/` module (39 files) plus the separate `workflows/` module plus the `spawn_session` tool give you a four-layer orchestration cake that Hermes and OpenHuman do not match.

This doc lists **sixteen concrete upgrades** across two phases, ordered by leverage. Each upgrade names the source file in the upstream project, what to copy, and where it would live in RunnerOS.

- **Phase 1 (Upgrades 1–8)** — ✅ **COMPLETE (2026-05-20)** — orchestration backbone: agent chaining, subagent hardening, triggers, hooks, system-load gating, hot-reload config, prompt-injection scanning, per-job toolset overrides. See `.planning/phases/01-orchestration-backbone/01-SUMMARY.md`.
- **Phase 2 (Upgrades 9–16)** — 🟡 IN PROGRESS — product surface: connector card UI, permission modal, MCP/skill browser, OAuth broker, memory-tree + Obsidian vault, cost accounting, hint-based model routing, operational CLI.
- **Addendum (A–C from CraftBot)** — PKCE-first OAuth with embedded creds, daily midnight memory consolidation, OmniParser for desktop-automation grounding.
- **Phase 3 — Voice as primary interface** powered by Mikey's on-device Rust runtime + cloud STT/TTS/LLM. Two-tier architecture (runtime owns conversation timing, RunnerOS owns work execution). **The implementing agent must consult Mikey before touching this phase** — the runtime is the source of truth.
- **Phase 4 (D–G) — Where voice unlocks new categories** — voice memos → memory tree, meeting agent, cross-device session continuity, voice-driven workflow authoring.
- **Phase 5 (H–P from ARGO)** — Deep Research mode, knowledge-base admin, local model manager, artifact sidecar, MCP install validation, trace inspector, import/export bundles, and prompt debugger. These are product-pattern steals from ARGO, not framework ports.

The non-negotiables before going commercial: rename remaining "Craft" identifiers, add a NOTICE / changes file, and decide carefully on the OpenHuman steals because of GPL-3.0 contamination risk.

---

## Legal status — can you ship this as your own product?

Yes, with constraints.

| Item | Status |
| ---- | ------ |
| License | Apache 2.0 — permissive, commercial-use allowed |
| Sublicense | Allowed |
| Modify | Allowed |
| Patent grant | Included |
| Trademark | "Craft" and "Craft Agents" are Craft Docs Ltd marks. You cannot use them in your product name, marketing, or user-visible strings. You already renamed to RunnerOS — good. |
| Attribution | Must keep `LICENSE` and `NOTICE` files; must state significant changes (Apache 2.0 §4(b–c)) |
| Anthropic SDK | The Claude Agent SDK ships under Anthropic Commercial Terms. Read those before launching anything that competes with Claude itself. |
| OpenHuman code | **GPL-3.0**. Copying any non-trivial implementation from OpenHuman would force you to GPL your whole project. The patterns in this doc that reference OpenHuman are conceptual only — re-implement, do not copy. |
| Hermes code | MIT. Compatible with Apache 2.0. You can copy / port directly, just credit. |

### Remaining "Craft" leaks to scrub before launch
Run these greps when you're ready to ship as a product:

```bash
git grep -i 'craft' -- '*.ts' '*.tsx' '*.json' '*.md' | grep -v node_modules
```

Known hits to address:
- `~/.craft-agent/` data directory — rename to `~/.runneros/` or `~/.runner/`
- `craftagents://` deep-link scheme — rename to `runneros://`
- "Craft Agents" UI strings in the Electron renderer
- `CRAFT_SERVER_*` env vars (`CRAFT_SERVER_TOKEN`, `CRAFT_SERVER_URL`, `CRAFT_RPC_*`)
- `@craft-agent/electron` log paths
- README still says "craft fork" — replace with your own positioning before stars start landing
- `TRADEMARK.md` references Craft Docs Ltd — keep one if you're forking with attribution intact, but your README should make clear this is RunnerOS, not Craft Agents

### Suggested attribution boilerplate

Create `THIRD_PARTY_NOTICES.md` at repo root:

```markdown
# Third-Party Notices

## Upstream
RunnerOS is a fork of Craft Agents (https://github.com/craft-ai-agents/craft-agents-oss),
licensed under Apache 2.0. Original copyright Craft Docs Ltd.

## Concepts and patterns
Architecture patterns informed by:
- Hermes Agent (NousResearch, MIT) — ACP adapter, subagent isolation, shell hooks
- (List any other projects you draw concepts from here)

## SDKs
This project uses the Claude Agent SDK (Anthropic), subject to Anthropic's
Commercial Terms of Service.
```

And `CHANGES_FROM_UPSTREAM.md`:
```markdown
# Significant changes from craft-agents-oss

- Renamed to RunnerOS
- (List your major upgrades as they ship)
```

---

## Status dashboard

**Phase 1 — Orchestration backbone (✅ all 8 shipped 2026-05-20)**

| # | Upgrade | Status |
|---|---|---|
| 1 | ACP adapter | ✅ Done (R8) |
| 2 | Subagent isolation hardening | ✅ Done (R1) |
| 3 | Polyglot shell hooks | ✅ Done (R6) |
| 4 | Scheduler gate (battery/CPU) | ✅ Done (R3) |
| 5 | Subconscious mode | ✅ Done (R7) |
| 6 | Hot-reload config | ✅ Done (R4) — primitive ships; consumer migration deferred (see `01-04-FOLLOWUPS.md`) |
| 7 | Prompt-injection scan | ✅ Done (R2) |
| 8 | Per-job toolset overrides | ✅ Done (R5) |

**Phase 2 — UX, connectors, polish (🟡 partial, cherry-picked as needed)**

| # | Upgrade | Status |
|---|---|---|
| 9 | Connector cards UI | ☐ Not started |
| 10 | Connector permission modal | ☐ Not started — note: chat-level permission picker (default/subconscious/yolo) already exists in `CompactPermissionModeSelector` |
| 11 | MCP + skills card browser | ☐ Not started |
| 12 | OAuth broker (Composio / Klavis) | ☐ Not started |
| 13 | Memory tree + Obsidian vault | ☐ Not started |
| 14 | Cost accounting per workflow run | ☐ Not started |
| 15 | Hint-based model routing | ☐ Not started |
| 16 | Operational CLI | ☐ Not started |

**Track for Phase 2 work:** UI items land on `codex/runneros-ui-pass`; backend items get their own branch as needed. See `ToMerge.md` at repo root.

---

## The eight upgrades

Ordered by leverage. Each one stands alone.

### 1. ACP adapter — cross-vendor agent protocol (Hermes-inspired) ✅ DONE (Phase 1 / R8)

**Why this matters most.** Today, `spawn_session` creates *another RunnerOS session*. With ACP support, your workflows can include nodes that are non-RunnerOS agents — Zed's agent, Claude Desktop, Cursor agents, future Anthropic clients. That turns RunnerOS from "agent harness" into "agent orchestration plane."

**Upstream reference**: `hermes-agent/acp_adapter/` (Python, MIT)
- `server.py` — ACP server entry point
- `session.py` — session lifecycle
- `events.py` — bridges agent events to ACP notifications (worth reading: shows the threading model when the agent runs on a worker but the event loop is on main)
- `tools.py` — tool-call wire format
- `permissions.py` — permission negotiation
- `edit_approval.py` — file-edit approval flow

**Spec**: Agent-Client-Protocol (search "agentclientprotocol.com" — same protocol Zed implements)

**Where this would live in RunnerOS**:
```
packages/shared/src/
├── protocol/
│   └── acp/                    # NEW
│       ├── server.ts           # WebSocket / stdio server
│       ├── session.ts          # ACP session bridge → CraftAgent session
│       ├── events.ts           # agent events → ACP notifications
│       ├── tools.ts            # tool-call serialization
│       ├── permissions.ts
│       └── index.ts
```

**Integration point**: extend `automations/handlers/` with an `acp-spawn` action type and `spawn-session-tool.ts` with an `acpEndpoint` option so the agent can decide whether to spawn a same-process RunnerOS session or hand off to an external ACP endpoint.

**Effort**: medium-large. The ACP spec is non-trivial, but Hermes's implementation is ~6 files of Python you can port to TS.

---

### 2. Subagent isolation hardening (Hermes `delegate_tool.py`) ✅ DONE (Phase 1 / R1)

**The bug RunnerOS will eventually hit**: `spawn_session` currently fires-and-forgets. The moment someone wants synchronous fan-out ("spawn 5 sessions, wait for all 5, summarize results"), thread/approval-callback isolation matters.

**Upstream reference**: `hermes-agent/tools/delegate_tool.py`

Specifically copy these ideas:
- A **`SPAWN_SESSION_BLOCKED_TOOLS`** frozenset. Hermes blocks (in subagents): recursive `delegate_task`, `clarify` (no user interaction), `memory` (no writes to shared MEMORY.md), `send_message` (no cross-platform side effects), `execute_code`. Without this, subagents can do anything the parent could, including spawn more subagents → fork bomb.
- **ThreadPoolExecutor with `initializer=`** for installing an isolated approval callback per worker thread. Hermes does this because subagents inherit the parent's threading.local() callback, which deadlocks against the parent's TUI that owns stdin.
- **`_subagent_auto_deny`** as the default — subagents see a refusal they can recover from, not a hung input() prompt.
- **`subagent_auto_approve: true`** as an opt-in for cron/batch jobs that explicitly need yolo mode.

**Where this would live**:
```
packages/shared/src/agent/
├── spawn-session-tool.ts         # EXISTING — add config
├── spawn-session-isolation.ts    # NEW
│   - SPAWN_SESSION_BLOCKED_TOOLS
│   - createIsolatedApprovalCallback()
│   - subagent_auto_approve config bridge
```

**Effort**: small-medium. Mostly a config + guardrail layer on top of existing `spawn-session-tool.ts`.

---

### 3. Polyglot shell hooks (Hermes `shell_hooks.py`) ✅ DONE (Phase 1 / R6)

**The differentiator**: RunnerOS automation handlers are TypeScript. That's great for type safety, terrible for users who want to write a Python hook that runs `ruff` on every `PostToolUse:file_write`, or a bash hook that posts to Slack on `SessionEnd`.

**Upstream reference**: `hermes-agent/agent/shell_hooks.py`

The wire protocol Hermes uses is dead simple and worth adopting verbatim for compatibility with Claude Code's hooks ecosystem:

```
stdin (JSON):
{
  "hook_event_name": "pre_tool_call",
  "tool_name":       "terminal",
  "tool_input":      {"command": "rm -rf /"},
  "session_id":      "sess_abc123",
  "cwd":             "/home/user/project",
  "extra":           {...}
}

stdout (JSON, optional):
{"decision": "block", "reason":  "Forbidden command"}   # Claude-Code-canonical
{"action":   "block", "message": "Forbidden command"}   # Hermes-canonical
{"context":  "Today is Friday"}                          # inject context
<empty>                                                   # no-op
```

**Critical safety details to copy**:
- First-use consent gate stored at `~/.runneros/shell-hooks-allowlist.json`. Never auto-trust a hook command.
- Non-TTY callers must pass `accept_hooks: true` config to allow registration without a prompt.
- Use `shlex.split` + `shell=False` to avoid shell injection. Document the convention that if users need pipes/redirection they wrap their logic in a script.

**Where this would live**:
```
packages/shared/src/automations/
├── hooks/                          # NEW
│   ├── shell-hook-runner.ts        # subprocess.spawn, JSON wire protocol
│   ├── allowlist-store.ts          # ~/.runneros/shell-hooks-allowlist.json
│   ├── consent.ts                  # first-use approval gate
│   └── types.ts                    # HookEvent, HookResponse types
```

**Integration point**: add a `shell-hook` action handler type to `automations/handlers/` so users can declare in `automations.json`:

```json
{
  "PreToolUse": [
    {
      "matcher": "terminal",
      "actions": [
        { "type": "shell-hook", "command": "~/.runneros/hooks/firewall.sh" }
      ]
    }
  ]
}
```

**Effort**: medium. Subprocess management + JSON wire protocol + allowlist. Hermes's implementation is ~200 LOC.

---

### 4. Scheduler gate — battery/CPU-aware throttling (OpenHuman concept) ✅ DONE (Phase 1 / R3)

**Conceptual borrow only — do not copy code (GPL-3.0).**

**Problem**: a workflow that polls every minute will drain a MacBook battery and bog down the CPU during a meeting. Today, RunnerOS schedulers don't care.

**The pattern from OpenHuman's `scheduler_gate` config**:
```
mode = "auto"
battery_floor = 0.8                # pause below 80% battery on battery power
cpu_busy_threshold_pct = 70.0      # back off if CPU > 70%
throttled_backoff_ms = 30000       # wait 30s before retrying
paused_poll_ms = 60000             # poll for resume every 60s
cpu_severe_pct = 95.0              # emergency stop above this
require_ac_power = false           # opt-in: only run plugged in
```

**Where this would live in RunnerOS**:
```
packages/shared/src/scheduler/
├── scheduler-service.ts           # EXISTING
├── system-pressure.ts             # NEW
│   - getBatteryState()            # navigator.getBattery() (Electron) or systeminformation pkg
│   - getCpuLoadPct()
├── gate.ts                        # NEW
│   - shouldRunNow(): "run" | "throttle" | "pause"
```

Wire `gate.shouldRunNow()` into `automations/automation-system.ts` before dispatching to handlers. Expose the policy via workspace config so users can override per-workflow.

**Effort**: small. Two libraries do the system-pressure read for you (`systeminformation` npm pkg works cross-platform). The gate is ~50 LOC of policy.

---

### 5. "Subconscious" job mode — read-only with escalation (OpenHuman concept) ✅ DONE (Phase 1 / R7)

**Conceptual borrow only.**

**The pattern**: a workflow runs in analysis-only mode (no write tools enabled). If the agent realizes it wants to write — post a message, edit a file, send a transaction — execution **pauses** and creates an escalation entry for user approval rather than just doing it or hard-failing.

OpenHuman's `subconscious/executor.rs` has a clean `ExecutionOutcome` enum:
```rust
enum ExecutionOutcome {
    Completed(ExecutionResult),
    UnapprovedWrite { recommendation: String, duration_ms: u64 },
}
```

This is much nicer than the binary "permission denied → workflow fails" pattern most agent frameworks ship.

**Where this would live in RunnerOS**:
```
packages/shared/src/agent/
├── permissions-config.ts           # EXISTING — add `escalate-on-write` mode
├── escalation-store.ts             # NEW
│   - createEscalation()
│   - listPendingEscalations()
│   - approveEscalation() / rejectEscalation()

packages/shared/src/automations/
├── handlers/
│   └── prompt-handler.ts           # EXISTING — handle escalation outcomes
```

**Integration with automations DSL**: extend the action schema:
```json
{
  "type": "prompt",
  "prompt": "Summarize yesterday's commits",
  "mode": "subconscious",                  // NEW — read-only + escalate
  "onEscalation": "notify-and-queue"       // NEW — notification + approval UI
}
```

**Effort**: medium. The agent SDK already supports permission modes; this is mostly UX plumbing.

---

### 6. Hot-reload config without restart (OpenHuman pattern) ✅ DONE (Phase 1 / R4 — primitive ships; consumer migration deferred)

**Conceptual borrow only.**

**What OpenHuman's heartbeat does**: reloads `Config::load_or_init()` *every tick*. Change a setting in the UI or config file, next tick picks it up. No app restart, no daemon HUP, no "restart to apply" UX papercut.

**Where this would live in RunnerOS**: every long-running service (`scheduler-service.ts`, `automations/poll-service.ts`, `automations/file-watch-service.ts`) currently reads config once at startup. Wrap config access in a function with a TTL cache (say, 10s) and read through it at every tick boundary.

```
packages/shared/src/config/
├── storage.ts                      # EXISTING
├── reactive-config.ts              # NEW
│   - getConfigCached(ttlMs = 10_000)
│   - subscribeConfigChanges(cb)    # optional, file-watcher-based push
```

**Effort**: small. Pure refactor.

---

### 7. Prompt-injection scanning on assembled prompts (Hermes pattern) ✅ DONE (Phase 1 / R2)

**The bug class this prevents**: a user creates a cron job with a clean prompt that loads a skill at runtime. The skill content has a malicious injection payload. The auto-approve cron agent reaches it without any check. Hermes's `cron/scheduler.py` has a comment naming this exact bug (#3968) — they fixed it by scanning the **fully-assembled prompt** at run time, not just the user-supplied prompt field at create time.

**Where this would live**:
```
packages/shared/src/agent/
├── prompt-builder.ts                # NEW (or add to existing)
│   - assemblePrompt({ userPrompt, loadedSkills, contextFiles, ... })
│   - scanForInjection(assembled): { blocked: boolean; reason?: string }
```

The scanner doesn't have to be complex — even a regex pass for common patterns ("ignore previous instructions", "you are now", role-hijack markers, base64-decoded shell commands) catches the bulk. Bonus: pass the assembled prompt through a small LLM with a "is this an injection attempt?" check for the paranoid mode.

**Effort**: small-medium. Pattern lib is ~50 LOC; LLM-assisted scan is optional.

---

### 8. Per-job toolset overrides on workflows (Hermes cron pattern) ✅ DONE (Phase 1 / R5)

**The capability**: a cron job that runs at 3am for backups should not have the same toolset as your interactive chat session. Hermes's `cron/scheduler.py` has precedence-based toolset resolution:

```
Precedence:
1. Per-job `enabled_toolsets` (set via cronjob tool on create/update)
2. Per-platform `hermes tools` config for the "cron" platform
3. None → AIAgent loads the full default set (safety net)
```

**Where this would live in RunnerOS**: the workflows engine (`packages/shared/src/workflows/`) already has `trigger-inputs.ts` — extend it with `enabled_source_slugs` and `permission_mode` as first-class fields on workflow run config. Then automations that fire workflows can override per-trigger.

**Effort**: small. You already have most of the plumbing in `spawn-session-tool.ts` — extend workflows to use the same shape.

---

## Suggested rollout order

1. **Now** — Legal scrub: rename remaining `craft-*` identifiers, write `NOTICE` / `CHANGES_FROM_UPSTREAM.md` / `THIRD_PARTY_NOTICES.md`. Update README to position RunnerOS as your product, not "craft fork."
2. **Week 1** — Upgrade 2 (subagent hardening) + Upgrade 7 (prompt-injection scan). Both are small, both close real safety gaps.
3. **Week 2** — Upgrade 4 (scheduler gate) + Upgrade 6 (hot-reload config). Quality-of-life that users will feel immediately.
4. **Week 3-4** — Upgrade 3 (polyglot shell hooks). Opens up the user base to non-TS workflow authors.
5. **Month 2** — Upgrade 8 (per-workflow toolset overrides) + Upgrade 5 (subconscious mode). Building toward differentiated automation modes.
6. **Month 2-3** — Upgrade 1 (ACP adapter). Highest leverage but largest scope. Ship this and RunnerOS becomes the only OSS agent harness that can orchestrate non-RunnerOS agents declaratively.

---

## What RunnerOS already has that the others don't (do not rebuild)

For self-awareness, here's where you're already ahead. Don't waste time reinventing these:

- **File-watch triggers** (`automations/file-watch-service.ts`) — neither Hermes nor OpenHuman has this. Triggering a workflow when a file changes is genuinely powerful for dev workflows.
- **Polling triggers as a generic primitive** (`automations/poll-service.ts`) — OpenHuman has only a hardcoded 20-min auto-fetch for integrations. RunnerOS lets users configure any polling interval against any source.
- **`workflows/` as a distinct module from `automations/`** — most agent frameworks conflate "event handlers" with "workflows." Keeping them separate is the right call (events fire automations; workflows are reusable templates with typed I/O).
- **Typed workflow outputs** (`workflows/output-schema.ts`) — Hermes and OpenHuman both return free-form text from background runs. Typed outputs make chaining sane.
- **Conditions DSL** (`automations/conditions.ts`) — declarative filtering on triggers is missing from Hermes/OpenHuman entirely.
- **Run history with delivery tracking** (`automations/delivery-history.ts`, `automations/history-store.ts`) — you can audit which automations fired, when, and to where. Hermes has cron run history; OpenHuman has decision logs for subconscious only. RunnerOS unifies.

---

## Open questions to think about

These don't have obvious answers from reading the code alone:

1. **Identity of a workflow run across spawned sessions** — if Workflow A spawns Session B which spawns Session C, what's the "run ID" that links them? Right now `workflows/run-storage.ts` tracks one run; chained sessions become orphans.
2. **Backpressure** — if 50 webhooks fire in 10 seconds, how does RunnerOS queue / drop / rate-limit? `retry-scheduler.ts` exists but I haven't read its policy.
3. **Cost accounting per workflow** — OpenHuman has a `[cost]` block with per-model pricing in the config. RunnerOS doesn't track $-spend per workflow run as far as I saw. Worth adding if you intend to expose this product to non-developers.
4. **Workflow versioning** — if a user edits a workflow template, what happens to in-flight runs of the previous version? Workflow run schema doesn't currently snapshot the template version.
5. **Distributed execution** — the headless server mode in the README implies you could split workflow execution across multiple machines. Is that the roadmap? If yes, ACP (Upgrade 1) is the right substrate.

---

## Phase 2 — UX, connectors, and operational polish

Phase 1 was orchestration backbone (chaining, triggers, schedulers). Phase 2 is the **product surface** — what the user sees and how they discover what your agent can do. This is where OpenHuman runs ahead of every other OSS harness, and where RunnerOS has the biggest opportunity to compound its workflow lead.

Same format: each upgrade names a source, what to steal (concept vs. code), where it would live, and effort.

### 9. Connector cards UI — visual marketplace per workspace ☐

**The OpenHuman insight**: instead of listing connectors as text in a settings menu, render them as **app-icon cards** in a grid. Each card has the official logo, name, one-line description, status pill (Connected / Disconnected / Error), and a primary CTA. The grid is browseable, filterable, and feels like a phone home screen.

**Why this matters**: discoverability is a feature. Most agent products bury their connector list three menus deep; users never realize the agent can talk to their Calendar or Stripe. A card grid in the workspace sidebar surfaces capability and answers "what *can* this thing do for me?" without reading docs.

**Where this would live in RunnerOS**:
```
apps/electron/src/renderer/
├── screens/Connectors/                # NEW
│   ├── ConnectorGrid.tsx              # the card grid
│   ├── ConnectorCard.tsx              # single card: icon, name, status, CTA
│   ├── ConnectorCategoryFilter.tsx    # Productivity / Dev / Comms / Finance / Social
│   ├── ConnectorSearch.tsx
│   └── ConnectorRegistry.ts           # source-of-truth for available connectors
```

The registry is just a typed list. Each entry:
```ts
type ConnectorDef = {
  slug: string;
  name: string;
  category: 'productivity' | 'dev' | 'comms' | 'finance' | 'social' | 'data';
  iconUrl: string;                       // hosted on your CDN or bundled
  description: string;
  authMethod: 'oauth' | 'apikey' | 'token' | 'local';
  oauthScopes?: string[];
  comingSoon?: boolean;
  status: 'stable' | 'beta' | 'experimental';
};
```

**Concrete UX moves to copy from OpenHuman**:
- Status dot color: green dot + "Connected" beats any "✓ Connected" text
- Card hover reveals "Manage" + "Disconnect" without a modal
- Coming-soon cards stay visible but grayed — telegraphs the roadmap
- Search is fuzzy and instant (use `fuse.js`); category chips below the search

**Effort**: medium. Two-three days of focused frontend work. Your shadcn + Tailwind stack already makes this fast.

---

### 10. Connector permission management modal — the "Manage Instagram" pattern ☐

**Source**: the OpenHuman "Manage Instagram" modal you screenshotted earlier. The pattern (independent of Composio):

- Header: app icon + name + close
- Description line
- Status row (green dot, "Connected")
- **Permissions section** with named scopes as toggles (read / write / admin) and per-scope hint text
- **Triggers section** showing which events from this connector RunnerOS subscribes to (with on/off toggles)
- Footer: `Disconnect` (red, outlined) + `Close` (primary)

**Why this matters**: most agent products give you a binary "connect/disconnect" with no permission granularity. The OpenHuman modal lets a user say "I want the agent to *read* my IG but never *post*" with one toggle. That single UX detail addresses 80% of the trust friction users feel about OAuth scope creep.

**Where this would live**:
```
apps/electron/src/renderer/
├── screens/Connectors/
│   ├── ConnectorManageModal.tsx        # NEW — the "Manage X" modal
│   ├── PermissionToggleRow.tsx         # NEW — reusable row component
│   └── TriggerSubscriptionList.tsx     # NEW — list of webhook/event subscriptions per connector

packages/shared/src/sources/
├── permission-scopes.ts                # NEW — registry of scope definitions per connector
└── revoke.ts                           # NEW — clean revoke flow (token + cached state)
```

**Critical safety detail to steal**: when "Disconnect" is clicked, *also* show a "Revoke at provider" link that deep-links the user to the provider's connected-apps page. OpenHuman doesn't do this and it's a privacy gap — Disconnect in the app doesn't always revoke server-side at the provider. RunnerOS could lead here.

**Effort**: small-medium. A couple of well-designed components, plus per-connector scope metadata. Reuses your existing source/credentials plumbing.

---

### 11. MCP + skills card browser per workspace ☐

**Your specific ask**: a way to see all MCPs and skills on cards per workspace to visually add.

**The pattern**:
- Three tabs at the top: **Connectors / MCPs / Skills**
- Each tab renders a card grid (same component as Upgrade 9, parameterized)
- MCP cards show: name, transport (stdio/http/sse), command, args summary, source URL, last-used, enabled toggle
- Skill cards show: name, description, model affinity hint, source (bundled / workspace-local / from `agentskills.io`), enabled toggle, "Open in editor" link
- "Add new" button on each tab opens a guided flow: paste config / paste skill markdown / browse marketplace

**Why three tabs, not one**: connectors are external (OAuth), MCPs are protocol-level (servers), skills are prompt-level. They look similar but have different mental models. Forcing them into one grid hurts users; three tabs of the same component is the clean compromise.

**Where this would live**:
```
apps/electron/src/renderer/
├── screens/Workspace/
│   ├── CapabilitiesBrowser.tsx         # NEW — the 3-tab parent
│   ├── tabs/
│   │   ├── ConnectorsTab.tsx
│   │   ├── McpsTab.tsx
│   │   └── SkillsTab.tsx
│   └── shared/
│       ├── CapabilityCard.tsx          # the polymorphic card component
│       └── CapabilityGrid.tsx
```

**The agentskills.io interop angle** (Hermes is compatible with this open standard): if RunnerOS adopts the same skill format, you instantly inherit a marketplace of community-authored skills without building your own. The format is plain markdown with YAML frontmatter — trivial to support. Worth doing for the network-effects alone.

**Effort**: medium. The component is reused from Upgrades 9–10; the work is per-tab data model + marketplace integration.

---

### 12. Composio (or Composio-alike) integration backbone ☐

**The blunt economics**: OpenHuman ships 118+ integrations because they pay Composio. Writing 100+ OAuth flows yourself is years of work; Composio is the buy-vs-build answer.

**Two paths for RunnerOS**:

**Path A — use Composio directly.** You become a Composio customer ($X/mo flat or per-call); your users get the same 100+ apps with one-click OAuth. Drawbacks: your free users cost you money (the OpenHuman trap — see this conversation's earlier discussion of `promotionBalanceUsd: 0.25`), and your users' OAuth tokens live in Composio's infrastructure, not yours.

**Path B — build/use an open alternative.** Two viable options:
- **Klavis** (https://github.com/klavis-ai/klavis) — OSS MCP-server-per-app backbone with bundled OAuth flows. MIT licensed, runs in your own infra.
- **Arcade** — closed source but more polished; cheaper than Composio at scale.
- **Pipedream Connect** — has a free tier; nice middle ground.

**My honest take for RunnerOS specifically**: start with Klavis. It's MIT, you host it yourself, no third-party data leakage, your users' tokens live in your encrypted store (`credentials.enc` already exists). When you outgrow it, Composio is a one-week migration.

**Where this would live**:
```
packages/shared/src/sources/
├── oauth-broker/                      # NEW
│   ├── klavis-adapter.ts              # if you go Klavis
│   ├── composio-adapter.ts            # if/when you switch
│   ├── built-in/                      # your own hand-rolled OAuth for top 10 apps
│   │   ├── gmail.ts
│   │   ├── slack.ts
│   │   └── ...
│   └── broker-interface.ts            # common interface so swapping backends is one-line
```

**Effort**: medium-large depending on path. Path B (Klavis adapter) is probably one week if you're focused.

---

### 13. Memory tree + Obsidian-style local vault ☐

**Concept only — OpenHuman is GPL, do not copy code.**

**The pattern (Karpathy-inspired)**: every piece of ingested data — email, Slack message, scraped page, meeting note — is canonicalized into ≤3k-token Markdown chunks. Chunks are scored, then folded into hierarchical summary trees stored in **local SQLite**. The same chunks land as `.md` files in an **Obsidian-compatible vault** the user can open, browse, manually link, and edit.

**Why this is genuinely novel architecture**:
1. **Inspectable memory** — the agent can't lie about what it "knows" because you can literally open the vault and see every memory file.
2. **Bidirectional** — user edits to `.md` files get picked up on the next ingest. Your notes shape the agent.
3. **Survives the app** — if RunnerOS becomes unmaintained someday, the user's memory is still readable as Markdown, openable in any text editor, browsable in Obsidian.

**Where this would live**:
```
packages/shared/src/memory/
├── memory-tree/                       # NEW
│   ├── chunker.ts                     # source → ≤3k-token chunks
│   ├── scorer.ts                      # chunk relevance/freshness scoring
│   ├── summary-tree-builder.ts        # hierarchical summarization
│   ├── sqlite-store.ts                # local DB
│   └── vault-writer.ts                # same chunks → .md files in vault dir
└── obsidian-vault/                    # NEW
    ├── vault-config.ts                # vault location, structure conventions
    └── frontmatter.ts                 # YAML frontmatter for links/tags
```

**Default vault location**: `~/RunnerOS/vault/<workspace-slug>/`. Make it user-configurable so power users can point it at an existing Obsidian vault.

**The Obsidian compatibility detail to get right**: use `[[wiki-style links]]` and `#tags` in the markdown frontmatter so the same files render natively in Obsidian without any plugins. The minute you add custom syntax, you break the magic.

**Effort**: large. This is a multi-week feature with real ML + storage architecture work. But it's the single biggest "wow" feature you could add — and it would be **the** RunnerOS differentiator if you ship it.

---

### 14. Cost accounting per workflow run ☐

**The gap in RunnerOS today**: no `$`-spend tracking per workflow run. As soon as you let users build chained workflows that fire 50 times a day, this matters.

**The pattern from OpenHuman's config** (translatable to RunnerOS without copying code):
```toml
[cost]
enabled = false
daily_limit_usd = 10.0
monthly_limit_usd = 100.0
warn_at_percent = 80

[cost.prices.reasoning-quick-v1]
input = 0.6
output = 2.5
[cost.prices.coding-v1]
input = 0.9
output = 3.3
# ... per-model rate card
```

The agent tracks tokens, multiplies by the rate card, persists per-run.

**Where this would live**:
```
packages/shared/src/agent/
├── cost-tracker.ts                    # NEW — per-session token counter
├── rate-card.ts                       # NEW — model_id → ($/MTok in, $/MTok out)
└── budget-guard.ts                    # NEW — pre-call check against daily/monthly cap

packages/shared/src/workflows/
├── run-storage.ts                     # EXISTING — extend WorkflowRun schema with costUsd
└── cost-report.ts                     # NEW — aggregate cost-per-workflow over time
```

**Two UX surfaces worth building**:
- **Live cost** in the chat footer: `$0.043 this turn · $1.27 today`
- **Workflow run history** column: cost-per-run sortable

**Critical "set this before you launch" guardrail**: ship with `daily_limit_usd = 5.0` and `warn_at_percent = 80` as defaults. Users who don't think about this get a safety net. Power users can crank it up.

**Effort**: small-medium. Token counting from the SDK is already available; the budget gate is policy.

---

### 15. Hint-based model routing — `hint:reasoning`, `hint:fast`, etc. ☐

**Source**: both Hermes (`hermes model` routing) and OpenHuman (`src/openhuman/providers/router.rs`). The pattern is in both, the implementation in Hermes is MIT-safe to study.

**The pattern**: agents emit a *hint prefix* on each call instead of a concrete model name. The router maps hint → concrete (provider, model). User can remap hints at runtime without restart.

Default hints from OpenHuman:
- `hint:reasoning` → strong reasoning model (Sonnet, GPT-5, Opus)
- `hint:fast` → fast/cheap (Haiku, Flash, GPT-5-mini)
- `hint:vision` → vision-capable
- `hint:summarize` → good-at-compression model (Haiku or local)
- `hint:code` → code-tuned model

**Why this matters for RunnerOS specifically**: your workflow engine runs N steps. Step 1 is "fetch + summarize" — cheap. Step 2 is "decide what to do" — reasoning. Step 3 is "draft reply" — fast. Without hint routing, every step pays the price of the strongest model. With hints, the same workflow costs 1/5 as much.

**Where this would live**:
```
packages/shared/src/agent/
├── claude-agent.ts                    # EXISTING — already supports model override
├── model-router.ts                    # NEW — hint → (provider, model) resolution
├── default-hints.ts                   # NEW — default mapping table
└── hint-emitter.ts                    # NEW — helper for skills/tools to emit hints
```

**The integration with workflows**: extend workflow step schema to accept a `modelHint` field:
```ts
type WorkflowStep = {
  prompt: string;
  modelHint?: 'reasoning' | 'fast' | 'vision' | 'summarize' | 'code';
  // ... rest
};
```

**Effort**: small. Pure dispatch logic; no new infrastructure.

---

### 16. Operational CLI — `doctor`, `dump`, `backup`, `import`, `update` ☐

**Source**: Hermes (MIT, copy directly). The CLI commands themselves are tiny but punch above their weight in support workflow.

- `runneros doctor` — runs ~20 health checks in parallel: Python/Node available, API keys configured, model endpoints reachable, MCP servers responding, disk space, conflicting installations. Output is human-readable with `✓` / `⚠` / `✗`. The bug-report-quality this generates is night-and-day.
- `runneros dump` — bundles `~/.runneros/config.json`, recent logs, environment fingerprint into a single shareable file (with secrets scrubbed). Pastable into a Discord support thread.
- `runneros backup` — zip of `~/.runneros/` excluding caches.
- `runneros import <backup.zip>` — restore.
- `runneros update` — first-class update flow with `restart_strategy` config (`self_replace` for binaries, `npm` for dev installs).
- `runneros insights --days 7` — usage / cost / token report.

**Where this would live**:
```
apps/cli/src/commands/
├── doctor.ts                          # NEW
├── dump.ts                            # NEW
├── backup.ts                          # NEW
├── import.ts                          # NEW
├── update.ts                          # NEW
└── insights.ts                        # NEW

packages/shared/src/diagnostics/
└── health-checks.ts                   # NEW — the 20 checks
```

**Why these specifically**: every operational support interaction you get from a user starts with "what version are you on / what's broken." `doctor` answers both in one screenshot. Your support cost drops by half.

**Effort**: small per command. Maybe two days for all six.

---

## Phase 2 things considered but NOT recommended

For completeness — what I looked at and decided isn't worth your time:

- **Mascot / desktop pet** (OpenHuman) — niche, divisive, expensive to do well (rigged 3D + lip-sync + lipreading). If RunnerOS goes consumer someday, revisit. Until then, skip.
- **Native voice (STT/TTS)** (OpenHuman, Hermes via ElevenLabs) — high value but a quagmire of edge cases (push-to-talk hotkeys, mic permissions on macOS, multi-language). Worth it only if you're going meeting-agent direction.
- **Meeting Agent (joins Google Meet as participant)** (OpenHuman) — magical when it works, terrifying liability when it doesn't (consent, recording laws vary by jurisdiction). Defer until you have lawyers.
- **Token compression layer "TokenJuice"** (OpenHuman, self-reported 80% reduction unverified) — the wins are mostly from HTML→Markdown (already in `tools/scraper` patterns) and tool-result truncation (you already have `tool_result_budget_bytes`-style limits). Marginal additional juice. Skip until you measure your actual token waste and find a specific 10x+ hotspot.
- **Multiple terminal backends** (Hermes — local/Docker/SSH/Modal/Daytona/Vercel) — your headless-server mode already covers most of this need with a cleaner architecture. Adding Modal would be valuable for serverless hibernation but it's a months-long project. Defer.
- **Persona / SOUL.md** (Hermes) — one editable persona file. Your workspaces already let users define system prompts; this is the same idea with worse UX. Skip.
- **Honcho dialectic user modeling** (Hermes integration) — interesting but adds an external dependency and the "model of the user" is best embedded in your memory tree (Upgrade 13). Skip standalone.

---

## Addendum — patterns from CraftBot (CraftOS-dev/CraftBot, MIT)

CraftBot is a smaller Python harness (60 stars at time of writing, sponsored by E2B) — not architecturally mature enough to take wholesale, but three specific patterns are worth folding in. All MIT, all safe to port directly.

### A. PKCE-first OAuth, with embedded creds for the top connectors *(enhances Upgrade 12)*

CraftBot's OAuth implementation is meaningfully cleaner than what most agent harnesses ship. The pattern:

- **Google + Zoom use PKCE** — desktop OAuth flow where no `client_secret` is needed on the user's machine. Only a `client_id` ships in the binary. This is the *correct* way to do desktop OAuth and most projects do it wrong.
- **Slack + Notion + LinkedIn use OAuth 2.0 with `client_secret`** — because those providers don't support PKCE for desktop apps. CraftBot embeds the secret in their release builds.
- **Release builds ship with embedded OAuth client IDs/secrets** for the top connectors so onboarding is one-click. Power users who don't trust embedded creds can override via `.env`.

**The trade-off to be honest about**: shipped creds get rate-limited per-app, not per-user. If RunnerOS becomes popular, your Google client ID is hitting Google's quota with every user. Mitigation: route popular services through your own backend proxy, or rotate client IDs, or push power users to BYO creds for high-volume work.

**Where this slots in Upgrade 12** (`packages/shared/src/sources/oauth-broker/`):

```
oauth-broker/
├── pkce-flow.ts                   # NEW — proper PKCE implementation for Google, Zoom
├── client-secret-flow.ts          # NEW — fallback for Slack/Notion/LinkedIn
├── embedded-creds.ts              # NEW — release-build credential map (build-time .env)
└── user-creds-override.ts         # NEW — user .env values override embedded
```

CraftBot's `decorators/` and `agent_core/` dirs are worth a read for their OAuth helpers — the PKCE flow with code-verifier hashing is implemented cleanly in ~80 LOC.

**Effort**: small if you were going to build OAuth anyway. This just specifies *how*.

---

### B. Daily midnight memory consolidation *(enhances Upgrade 13)*

CraftBot's memory pitch line: *"Distill and consolidate events that happened through the day at midnight."*

This is subtly different from continuous embedding. The pattern:

1. Throughout the day, raw events accumulate in a "today" buffer (chat turns, tool results, ingested chunks).
2. At a scheduled time (default midnight, user-configurable), a consolidation job runs:
   - Summarizes the day into a compact narrative
   - Extracts notable events as memory atoms
   - Folds new atoms into existing summary trees (per topic, per source)
   - Compacts/expires raw turns older than N days
3. The user gets a clean "yesterday" artifact in their Obsidian vault each morning.

**Why this is genuinely good**:
- Cheaper than continuous embedding for every turn
- Produces human-readable daily artifacts that double as activity logs
- The consolidation job IS a workflow — uses your existing automation engine, just on a cron trigger

**Where this slots in Upgrade 13**:

```
packages/shared/src/memory/
├── daily-consolidator.ts          # NEW — the consolidation job
├── consolidation-prompt.ts        # NEW — the summarization prompt template
└── day-buffer.ts                  # NEW — append-only buffer for today's raw events

packages/shared/src/workflows/
└── starter-templates.ts           # EXISTING — add `daily-consolidation` as a starter
```

**Default schedule**: `0 0 * * *` (midnight in user's local timezone), configurable in workspace settings. The user can disable it, change the time, or pick a different model hint (`hint:summarize` is the right call here).

**Effort**: small. The job is a prompt + a few storage calls. The infrastructure already exists in your cron + memory subsystems.

---

### C. OmniParser for desktop automation grounding *(complements your existing `tools/background-computer-use/`)*

You already have `tools/background-computer-use/` in your tree, which tells me you're at least exploring desktop automation. CraftBot's GUI mode uses **OmniParser** (Microsoft Research, MIT-licensed) as the grounding layer, running inside Docker for isolation.

**What OmniParser is**: a vision model that takes a screenshot and outputs structured UI element detection — buttons, text fields, icons, with bounding boxes and semantic labels. It's the SOTA open model for screen understanding. Built specifically for computer-use agents.

**The architecture CraftBot uses**:
```
agent → screenshot → OmniParser (Docker, GPU optional) → structured UI tree → action selection
```

This is a much more reliable foundation for desktop automation than coordinate-based screenshot interpretation by the chat model. Claude Sonnet 4.5 has computer-use built in, but it pays the price of vision tokens on every screenshot — OmniParser preprocesses the image into a compact JSON tree first, dramatically reducing the token cost per action.

**Where this slots in for RunnerOS**:

```
tools/background-computer-use/
├── grounding/                     # NEW
│   ├── omniparser-client.ts       # talks to OmniParser Docker container
│   ├── omniparser-server/         # Dockerfile + run scripts
│   └── ui-tree.ts                 # canonical UI tree type
└── actions/                       # NEW
    ├── click-element.ts           # uses UI tree, not raw coordinates
    ├── type-into-element.ts
    └── scroll-element.ts
```

**The opt-in / opt-out story**: ship this OFF by default. OmniParser is ~4 GB of model weights and requires Docker (and ideally GPU). Power users who want desktop automation opt in via Settings → Tools → Computer Use → Enable. Same UX pattern CraftBot uses.

**Honesty about effort**: this is the largest of the three CraftBot picks. Two weeks of focused work to get reliable. But if RunnerOS workflows can drive desktop apps reliably, that's a category-defining feature — no other OSS agent harness has this on macOS today (CraftBot only ships Windows + Linux for GUI mode).

**Cross-platform reality check**: OmniParser itself is platform-agnostic. The screenshot capture and event injection differ per OS. On macOS you'd need:
- Screen capture: `CGWindowListCreateImage` (Accessibility permission)
- Event injection: `CGEventCreateMouseEvent` / `CGEventPost` (Input Monitoring permission)
- Window targeting: `AXUIElement` accessibility tree as a complement to OmniParser

That last point — combining macOS Accessibility's structured UI tree with OmniParser's vision-based detection — would be the differentiator. Accessibility gives you the real DOM-equivalent; OmniParser fills in apps that have poor a11y. Belt + suspenders.

---

### Considered from CraftBot but NOT recommended

For transparency, here's what I looked at in CraftBot and decided wasn't worth your time:

- **ChromaDB for memory** — CraftBot uses ChromaDB for vector memory. SQLite-with-an-embedding-extension (sqlite-vec, libsql) is a simpler stack and matches the rest of your local-first story. Don't add a second database.
- **BytePlus LLM provider** — regional (China-facing), unlikely to be relevant for your users. Skip.
- **Two-stage Action Router + Action Manager pattern** — CraftBot splits "pick the action" and "fill in the params" into two LLM calls. Interesting but conflicts with how Claude Agent SDK handles tool use natively (the model picks tool + fills params in one structured call). Don't fight the SDK.
- **Textual TUI mode** — your CLI already covers headless / scripting needs, and your Electron app covers GUI. Adding a third Textual-based TUI is a UX-fragmentation cost without a clear user.
- **Docker-based GUI mode** — the Docker isolation is reasonable for Linux but pointless on macOS where the user's whole machine IS the target. Use OmniParser standalone (per Upgrade C above), skip the Docker wrapping unless you go sandbox-hosting later.
- **E2B sandbox integration** — interesting (E2B sponsors CraftBot, gives cloud-hosted sandboxed code execution). If RunnerOS ever wants a "hosted execution" tier this is worth looking at, but it's tangential to your core workflow story right now.

---

## Phase 3 — Voice as the primary interface, powered by Mikey's on-device Rust runtime

> **Implementation note — read before touching this phase.**
>
> Mikey (project owner) spent four months building the on-device Rust runtime that does the voice loop with effectively zero latency on-device. The runtime handles VAD, turn-taking, audio routing, dialog state, interrupt detection, and the integration with cloud STT/TTS/LLM providers. It is the **source of truth for everything voice-related**.
>
> **Before starting any work in Phase 3, the implementing agent MUST consult Mikey on:**
> - The runtime's existing IPC / RPC surface (how external processes talk to it)
> - The current STT, TTS, and LLM provider abstraction (what's pluggable, what's pinned)
> - The interrupt and cancellation contract
> - Audio session lifecycle on-device (start/stop/pause/resume)
> - Threading model and concurrency assumptions
> - Existing Electron SDK bindings, if any
> - Per-platform realities (macOS Intel vs Apple Silicon vs Windows vs Linux)
>
> **Do not invent the runtime API.** Spec the RunnerOS side of the boundary; ask Mikey for the runtime side. The doc below describes the *integration contract* from RunnerOS's perspective only.

### What this phase unlocks

Voice as a third UI mode alongside Electron and CLI — but it's not "talk to your text agent." It's a separate orchestration tier that *front-ends* the existing RunnerOS workflow engine. The runtime owns conversation timing; RunnerOS owns work execution. Cost story: no per-minute infrastructure cost, no concurrency limits, no live-session tier pricing, because every user runs their own runtime instance on their own hardware. STT/TTS/LLM cloud calls are the only ongoing variable cost — and those are pay-as-you-go to the user's chosen providers, not gated by RunnerOS.

### The two-tier architecture

```
                ┌─────────────────────────────────────┐
                │   Mikey's Rust Runtime (on-device)  │
                │   — VAD, turn-taking, audio I/O     │
                │   — Dialog state, interrupt handling│
                │   — Calls cloud STT/TTS/LLM         │
                │   — Owns conversation timing        │
                └──────────────┬──────────────────────┘
                               │  IPC (TBD with Mikey)
                               ▼
                ┌─────────────────────────────────────┐
                │  RunnerOS Orchestrator              │
                │  — Sessions, workflows, automations │
                │  — Tool execution, MCPs, connectors │
                │  — spawn_session, memory tree       │
                │  — Owns work execution              │
                └─────────────────────────────────────┘
```

The runtime sends a query when it decides RunnerOS needs to do something. RunnerOS streams progress events back. The runtime narrates progress to the user verbally while orchestrator work proceeds. User perceives responsiveness even when a workflow takes 30+ seconds.

### The integration contract — RunnerOS side

This is what the implementing agent must build on the RunnerOS side. The runtime side is Mikey's domain.

**1. Voice-session-as-RunnerOS-session.** A voice conversation is a first-class RunnerOS session. Reuses existing session persistence, history, status workflow, costs, automations. The voice runtime is just another *session source*, alongside Electron and CLI. New session source type:

```
packages/shared/src/sessions/
├── voice-session-source.ts            # NEW — voice session source adapter
└── session-source-types.ts            # EXISTING — add 'voice' to source enum
```

**2. The runtime-facing RPC surface.** RunnerOS exposes an RPC endpoint (same WebSocket server that the Electron thin client uses — `CRAFT_SERVER_*` env vars, but you should rename to `RUNNEROS_SERVER_*` per the legal scrub) with the voice-specific channels:

```
RPC channels (voice tier → RunnerOS):
- voice.dispatch(query, conversationContext, options) → sessionId
    # heavy lift, runtime expects progress events to follow
- voice.cancel(sessionId)
    # interrupt — user said "stop" or started talking again
- voice.continue(sessionId, userTurn)
    # follow-up turn in same workflow without reset
- voice.fastTool(name, args) → result
    # voice tier defers a tool call it can't handle locally

RPC channels (RunnerOS → voice tier):
- progress.update(sessionId, voiceFriendlyStatus)
    # natural-language progress, runtime voices it
- progress.tool(sessionId, toolName, summary)
    # optional fine-grained per-tool status
- result.final(sessionId, voiceFriendlyResult, structuredData?)
    # work done, runtime delivers to user
- error.recoverable(sessionId, voiceFriendlyError, suggestedRecovery)
    # something broke, runtime asks user how to proceed
```

The exact wire format (JSON-RPC? Custom binary? gRPC? WebSocket text frames?) is a runtime-side decision — **ask Mikey**. The semantics above are what RunnerOS needs to express, regardless of transport.

**3. Voice-friendly progress events.** This is critical and often skipped. The orchestrator emits structured progress that the voice tier can voice naturally. Not raw tool logs:

```
Bad (raw tool call):  "Calling browser.navigate with url=https://news.ycombinator.com"
Good (voice-friendly): "Pulling up Hacker News now."

Bad: "Executing workflow node 3 of 7"
Good: "I've found the article. Reading it now."
```

Two implementation paths:
- **Skill authors declare voice-friendly progress** in skill manifests. Cheap. Skills opt in.
- **Auto-generate from tool calls** using a small fast LLM (hint:fast). Pass it the tool name + args + a few prior progress events for tone consistency. ~50-100ms latency. Universal coverage.

Both can coexist — declared voice phrases override LLM-generated ones.

```
packages/shared/src/agent/
├── voice-progress.ts                  # NEW — voice-friendly progress emitter
└── progress-narrator.ts               # NEW — auto-narration via small LLM fallback
```

**4. Interrupt + cancellation.** When the runtime detects the user started talking, it must be able to *immediately* cancel:
- Any in-flight LLM call
- Any in-flight tool call (where cancellable — file_write probably runs to completion; web_research can abort)
- The progress event stream

`voice.cancel(sessionId)` on the RPC. Inside RunnerOS this needs proper AbortController propagation through `claude-agent.ts` and into the SDK calls. Tool-level cancellation needs an AbortSignal in each tool's contract — most tools don't have this today, so this is real work.

```
packages/shared/src/agent/
├── claude-agent.ts                    # EXISTING — add AbortSignal threading
└── tools/                             # EXISTING — add AbortSignal to tool contract
```

**5. Tool placement matrix.** Decide at workspace config level which tools live where:

| Tool category | Where | Reason |
| ------------- | ----- | ------ |
| `get_current_time`, `set_timer`, `volume_*` | Voice tier | Sub-50ms; no value in dispatching |
| `read_last_message`, `play_music`, simple lookups | Voice tier | Fast, conversational |
| `web_search`, `web_fetch`, `code_execution` | Orchestrator | Multi-second work; needs narration |
| `spawn_session`, `run_workflow` | Orchestrator | Defines orchestrator work |
| `compose_email`, `draft_post` | Orchestrator | Multi-turn reasoning |
| `connector.*` (Gmail, Slack, IG) | Orchestrator | Authorized actions; needs approval gating |

Workspace config:
```ts
{
  voice: {
    fastTools: ['get_current_time', 'set_timer', 'volume_set', ...],
    orchestratorTools: ['*']  // everything else
  }
}
```

**6. STT / TTS / LLM provider abstraction.** The runtime is the place these are configured (per Mikey's existing implementation), but RunnerOS workspace settings should *surface* them in the UI so users don't have to edit runtime config files. Settings → Voice:
- STT provider: Groq Whisper / Deepgram / Cartesia / OpenAI / local
- TTS provider: Cartesia / ElevenLabs / OpenAI / Kokoro / local
- LLM (for voice tier dialog model): Groq Llama / Cerebras / Anthropic Haiku / local
- LLM (for orchestrator) → reuses the existing model-connection settings

Each provider has a cost ceiling per session (defaults: $0.10 voice tier, $1.00 orchestrator) so a runaway loop can't drain the user's budget. Cost tracking ties into Upgrade 14.

**7. Electron UI surface.** Even when voice is the primary interaction, Electron should show:
- Live audio waveform / VAD indicator (so user can tell the agent heard them)
- Live STT transcript (so user can catch mishearings)
- Current orchestrator session ID and tool-call timeline
- Push-to-talk hotkey configurable (default: Fn or Right-Option, similar to OpenHuman / Hermes)
- "Mute" state visible in tray icon

```
apps/electron/src/renderer/
├── components/VoiceHUD/                # NEW
│   ├── WaveformIndicator.tsx
│   ├── TranscriptLiveView.tsx
│   ├── AgentStateBadge.tsx             # "listening" / "thinking" / "speaking"
│   └── PushToTalkButton.tsx
```

**8. Push-to-talk vs always-on.** Default to push-to-talk. Always-on (continuous VAD-driven listening) is a real privacy issue and must be explicitly opt-in, with a visible status indicator that can never be hidden, and a panic-stop hotkey (`Cmd+Shift+.` per OpenHuman convention). Always-on mode also needs:
- Per-app block list (don't listen during 1Password, video calls, etc.)
- Auto-pause when screen is locked
- Session TTL so a forgotten always-on session auto-ends

This is config; Mikey's runtime probably already has these primitives. Surface them in workspace settings.

**9. Privacy posture — explicit data flow.** Document this clearly because users will ask:

```
Audio (mic)        → Runtime (on-device, encrypted in-memory)
                   → STT cloud (transient, depends on provider's retention policy)
Transcript         → RunnerOS workspace storage (encrypted at rest, on-device)
                   → LLM cloud (transient, depends on provider)
TTS output text    → TTS cloud (transient)
                   → Runtime → speaker
Tool call payloads → only flow to the specific connector or service involved
```

Add a `docs/PRIVACY.md` and surface a "Privacy" link in voice settings.

### Phase 3 deliverables, in order

1. **Voice session as a first-class session source** — `voice-session-source.ts` + enum addition.
2. **RPC contract spec** — agree the channels with Mikey, document in `docs/VOICE_INTEGRATION.md`.
3. **Voice-friendly progress events** — `voice-progress.ts` + auto-narrator via `hint:fast` model.
4. **AbortSignal propagation through the agent loop** — so `voice.cancel` actually cancels.
5. **Workspace voice settings UI** — STT/TTS/LLM provider pickers, push-to-talk hotkey, cost ceilings.
6. **Electron VoiceHUD** — waveform, transcript, agent-state badge, PTT button.
7. **Tool placement config** — fast-tools allowlist in workspace settings.
8. **Skill manifest schema extension** — optional `voiceProgress` field for declared voice-friendly status phrases.
9. **Mute / always-on safety surfaces** — visible indicator, panic stop, per-app block list.
10. **Voice + cost telemetry integration** — every voice session shows up in cost reports (Upgrade 14).

### Phase 3 things considered but NOT recommended

- **Replacing Electron with voice-only.** Even excellent voice interfaces benefit from a visual surface for transcripts, errors, and complex artifacts (tables, code diffs, images). Keep Electron as the canonical UI; voice is a sibling.
- **On-device LLM for the orchestrator tier.** The runtime keeps the dialog loop snappy; the orchestrator can take its time and benefit from frontier models. Don't try to run a 70B model locally just for ideology — the bottleneck the runtime solves is *coordination latency*, not LLM cost.
- **Building voice provider clients in RunnerOS.** The runtime owns STT/TTS/LLM provider integrations. RunnerOS just configures which to use. Don't duplicate work.

---

## Phase 4 — Where voice unlocks new product categories

Lighter, more speculative. These are realistic in 12-month timeline only if Phase 3 lands cleanly. Each one inherits the two-tier architecture from Phase 3 and the integration contract Mikey defines.

### D. Voice memos → memory tree (Upgrade 13 extension)

Speak a thought; runtime captures it; STT converts; the memory-tree consolidator (Upgrade 13 + Addendum B) folds it into the Obsidian vault at the next consolidation tick. Optionally tag voice memos visually in the vault so the user can find audio-origin notes later.

**Why this is cohesive**: zero new infrastructure — uses existing runtime + STT + memory tree. Adds a 50-LOC voice command handler (`"remind me later" / "note that"`) and a memo-type field on memory atoms.

### E. Meeting agent powered by the runtime

OpenHuman has this; you can build it cleaner because Mikey's runtime already does the hard part (audio I/O + interrupt handling). Pattern:
- User pastes a Google Meet / Zoom link into RunnerOS
- Runtime joins the call as a participant (uses platform's audio bridge — needs platform-specific work per call provider)
- Real-time STT of all speakers, attributed
- Agent stays mostly silent, listens, takes notes into the memory tree
- User can address the agent during the call (wake-word or PTT); agent responds via TTS into the call audio
- On call end, agent generates a structured summary, action items, follow-up email drafts

**Honest caveat**: meeting recording / participation laws vary by jurisdiction. Two-party-consent states require all participants to know. RunnerOS should announce itself when joining and refuse to join calls where consent is unclear. Defer until you have legal review.

### F. Cross-device session continuity (laptop ↔ phone, same workspace)

User starts a voice conversation on their MacBook; switches to phone; conversation continues seamlessly. Architecturally:
- RunnerOS workspace state lives in the headless server mode you already built
- Both the laptop's runtime and the phone's runtime are thin clients
- Either device can be the active voice front-end at any time; the other becomes silent/observer
- Mobile builds (iOS Tauri / React Native + Mikey's runtime ported) are the heavy lift

**Why this is huge**: nobody else in OSS has this. Anthropic's app can't do it. OpenHuman's mascot is desktop-only. If RunnerOS lets you start a workflow on your laptop, walk to your car, finish the conversation on your phone — that's a Wow.

**Honest caveat**: porting Mikey's Rust runtime to mobile is months of work. Defer until you've validated the desktop voice experience.

### G. Voice-driven workflow authoring

"Hey, build me a workflow that watches my Linear board, and whenever an issue gets labelled 'urgent', drafts a Slack message to me with the assignee tagged."

The orchestrator (via existing automations DSL + workflows engine) constructs the workflow definition. Plays back a verbal confirmation: "Got it — every five minutes I'll check Linear for new urgent issues, and if I find one I'll draft a Slack message tagging the assignee. Want me to enable it now or just save the draft?"

**Why this is cohesive**: RunnerOS already has the typed workflow schema (Upgrade 8) and the automations DSL. Voice + LLM is just a different authoring surface for the same underlying objects.

**Effort**: surprisingly small once Phase 3 is done. Maybe two weeks of prompt engineering + workflow validation logic.

### Phase 4 things considered but NOT recommended (yet)

- **Always-on passive listening with wake word** — privacy minefield, especially with co-living households and minors. Hold until you have a real consent + indicator story.
- **Outbound voice calling (Twilio integration)** — agent makes phone calls on user's behalf. Triggers TCPA in the US, GDPR/PECR in EU. Cool demo, lawyer-attracting product. Defer.
- **Agent-to-agent voice between users' instances** — two RunnerOS users having a voice conversation via their agents. Cute but multi-user infrastructure is a different product.
- **Voice for non-conversational tasks** — generating reports purely by voice, etc. Visual artifacts beat voice for anything table-shaped or code-shaped. Keep voice for conversational and ambient.

---

## Suggested rollout order — all four phases

Stack Phase 1 first since it's safety + foundation. UX work in Phase 2 (Upgrades 9, 10, 11) can interleave earlier since it's frontend and doesn't block backend work. Phase 3 (voice) is gated by the consult-Mikey step. Phase 4 can only start when Phase 3 is stable.

**Phase 2 rollout (after Phase 1 ships):**
1. **Connector cards + permission modal** (Upgrades 9, 10) — biggest visible UX win, mostly frontend.
2. **MCP/skill card browser** (Upgrade 11) — reuses components from #9–10.
3. **Operational CLI** (Upgrade 16) — cheap polish; pays off the moment your first user files a bug.
4. **Hint-based model routing** (Upgrade 15) — small change, recurring cost savings.
5. **Cost accounting** (Upgrade 14) — ship this before you let workflows fan out at scale.
6. **OAuth broker via Klavis + PKCE-first flow (Addendum A)** (Upgrade 12) — week-long lift, unlocks 100+ integrations.
7. **Memory tree + Obsidian vault + daily consolidation (Addendum B)** (Upgrade 13) — the headline feature. Save for when you have a few weeks of focused time. Ship this and RunnerOS has a real moat.

**Phase 3 rollout (voice):**
1. **Consult Mikey first** — get the runtime's IPC surface, STT/TTS/LLM provider abstraction, interrupt contract, audio session lifecycle. Document in `docs/VOICE_INTEGRATION.md` before any code.
2. **Voice-session-as-RunnerOS-session** + RPC contract — the integration bones.
3. **AbortSignal propagation through the agent loop** — so `voice.cancel` actually works. This is the hidden hard part.
4. **Voice-friendly progress events** (declared in skill manifests + auto-narrator fallback) — without this, voice feels like silent dead-air.
5. **Workspace voice settings + VoiceHUD in Electron** — provider pickers, PTT button, transcript, agent-state badge.
6. **Tool placement matrix + cost ceilings** — fast tools at runtime, heavy at orchestrator; per-tier budget caps.
7. **Mute / panic-stop / per-app block list** — privacy plumbing before any always-on mode goes live.

**Phase 4 rollout (after Phase 3 is solid):**
1. **Voice memos → memory tree** (Phase 4 D) — smallest item; ships in days once Phase 3 is in.
2. **Voice-driven workflow authoring** (Phase 4 G) — leverages the existing automations DSL; ~two weeks of prompt engineering.
3. **Meeting agent** (Phase 4 E) — needs platform-specific audio bridge work + legal review on consent.
4. **Cross-device session continuity** (Phase 4 F) — mobile port of Mikey's runtime; months of work; only after the desktop voice experience is validated by real users.

**Phase 1 + the CraftBot OmniParser addendum (C)** is its own track and can run in parallel with Phase 2 work — it's gated by separate considerations (vision model integration, macOS permissions, Docker for non-Mac platforms), so don't make Phase 2 wait on it.

---

## Phase 5 — ARGO-inspired operator upgrades

Source project: `xark-argo/argo`, Apache-2.0. ARGO is closer to "free Manus" than a plain chat app because it productizes plan-first deep research, local model operations, knowledge-base admin, MCP setup, traceable agent thoughts, and report/artifact rendering.

Do not port ARGO's LangGraph backend into RunnerOS. RunnerOS already has the better native primitives: sessions, workflows, sources, outputs, automations, permission modes, and run history. Copy the product moves and rebuild them on RunnerOS architecture.

### H. Deep Research mode

**Why it matters**: this is the cleanest high-power addition. It turns RunnerOS from "run agents" into "run serious investigations."

**What to copy from ARGO**:
- planner -> human feedback -> researcher/coder loop -> reporter
- plan event streamed before execution
- user can edit/accept the plan
- auto mode can skip approval but still records the plan
- final report is the durable artifact, not just chat text

**RunnerOS shape**: a workflow-backed run mode, not a single giant agent. Use normal RunnerOS agents for planner, researcher, data analyst/coder, and reporter. Add a plan-review gate with two policies: `approve` and `auto`.

**Spec**: `docs/deep-research/01-spec.md`

### I. Knowledge-base admin

**What ARGO has**: knowledge bases with embedding provider/model, chunk size, overlap, top-k, similarity threshold, document status, URL ingestion, and folder sync.

**RunnerOS fit**: extend workspace context into real indexed knowledge collections. Keep docs/context as the simple layer; add knowledge bases for heavy RAG.

Suggested files:
```
packages/shared/src/knowledge/
packages/server-core/src/handlers/rpc/knowledge.ts
apps/electron/src/renderer/pages/KnowledgeBasePage.tsx
```

Hard rule: retrieved chunks must be traceable to source file, URL, page/section, and chunk id.

### J. Local model manager

**What ARGO has**: Ollama integration, popular model list, Hugging Face GGUF parsing, download progress, disk/memory checks, and model status.

**RunnerOS fit**: Settings -> Models becomes a real local model operations center. It should verify model availability before agents/workflows use a local model.

Do not block Deep Research on this, but Deep Research should be model-aware once this lands.

### K. Artifact/report sidecar

**What ARGO has**: report/artifact rendering with HTML, SVG, Mermaid, and KaTeX-style output.

**RunnerOS fit**: merge with the planned Visual Agent OS sidecar. Deep Research reports should open in an output/artifact panel, with citations and step trace linked back to source runs.

### L. MCP install and validate flow

**What ARGO has**: paste MCP JSON, configure stdio/SSE, validate, then enable.

**RunnerOS fit**: strengthen Sources UX around a three-step lifecycle:
1. install definition
2. validate transport/tools/auth
3. activate in workspace

Never call a source usable from file presence alone.

### M. Trace inspector

**What ARGO has**: persisted agent thoughts with tool, tool input, tool output, retriever chunks, latency, status, and metadata.

**RunnerOS fit**: a run inspector that answers "why did it do that?" without reading raw JSONL. This should sit beside workflow runs, deep research runs, and automation fires.

### N. Agent/import bundles

**What ARGO has**: share/import assistant packages.

**RunnerOS fit**: export/import bundles containing agents, skills, workflows, source declarations, and docs. Imports must show missing/auth-required sources before activation.

### O. Prompt debugger

**What ARGO has**: prompt logs.

**RunnerOS fit**: "View runtime prompt" on sessions/runs/agents. Redact secrets and credentials. This is critical for debugging agent quality.

### P. Browser-backed research as a first-class fallback

**What ARGO has**: local browser control and web crawling as built-in research tools.

**RunnerOS fit**: keep sources as the default for repeatable integrations, but give Deep Research a browser/web-fetch fallback path when a source is unavailable or a one-off web task is cheaper than installing a connector.

### Phase 5 rollout order

1. **Deep Research mode** — biggest product lift from existing RunnerOS primitives.
2. **Trace inspector** — required to trust long-running autonomous research.
3. **Artifact/report sidecar** — makes research output feel finished.
4. **MCP install validation flow** — reduces failed research runs.
5. **Knowledge-base admin** — heavier lift, but strong moat.
6. **Prompt debugger** — debugging multiplier.
7. **Local model manager** — major product win, but can ship independently.
8. **Agent/import bundles** — marketplace/shareability later.

---

## References

| File | What to read it for |
| ---- | ------------------- |
| `hermes-agent/acp_adapter/server.py` | ACP server entry pattern |
| `hermes-agent/acp_adapter/events.py` | Bridging agent events to ACP notifications across thread boundaries |
| `hermes-agent/tools/delegate_tool.py` | Subagent isolation, blocked-tools pattern, approval callback hardening |
| `hermes-agent/agent/shell_hooks.py` | Polyglot hook wire protocol, allowlist consent, shlex safety |
| `hermes-agent/cron/scheduler.py` | Prompt-injection scanning on assembled prompts; per-job toolset overrides |
| `openhuman/src/openhuman/heartbeat/engine.rs` | Hot-reload config every tick (concept only — GPL code, do not copy) |
| `openhuman/src/openhuman/subconscious/executor.rs` | UnapprovedWrite escalation pattern (concept only — GPL) |
| `openhuman/src/openhuman/scheduler_gate/` (referenced in config) | Battery/CPU-aware throttling (concept only — GPL) |
| `openhuman/src/openhuman/providers/router.rs` (referenced in docs) | Hint-based model routing pattern |
| `openhuman/src/openhuman/cost/` (referenced in config) | Per-model rate card + daily/monthly caps (concept only) |
| https://github.com/klavis-ai/klavis | MIT OSS OAuth broker — recommended for Upgrade 12 |
| https://agentskills.io | Open skill format standard — adopt for Upgrade 11 marketplace |
| https://x.com/karpathy/status/2039805659525644595 | Karpathy's obsidian-wiki workflow — inspiration for Upgrade 13 |
| https://github.com/CraftOS-dev/CraftBot | PKCE OAuth, daily memory consolidation, OmniParser GUI — Addendum A/B/C |
| https://github.com/microsoft/OmniParser | UI element detection model — Addendum C |
| https://github.com/pipecat-ai/pipecat | Voice agent pipeline patterns — Phase 3 prior art |
| https://github.com/livekit/agents | Real-time voice agent framework — Phase 3 prior art |
| (Mikey's Rust runtime — internal, see Phase 3 callout) | The voice tier itself; consult Mikey before specifying anything voice-related |
| https://github.com/xark-argo/argo | ARGO source — Deep Research, knowledge bases, local models, MCP validation, traceable agent thoughts |
| `xark-argo/argo/backend/core/agent/langgraph_agent/` | ARGO planner/researcher/coder/reporter loop; product pattern only |
| `xark-argo/argo/backend/services/doc/` | ARGO knowledge-base ingestion, vector indexing, folder sync patterns |
| `xark-argo/argo/backend/services/model/` | ARGO Ollama/Hugging Face model management patterns |
| `xark-argo/argo/backend/services/tool/mcp_server_service.py` | MCP JSON parsing, validation, enable lifecycle |

---

*Last updated: Phase 2 + CraftBot addendum + Phase 3 (voice) + Phase 4 (voice-unlocked categories) + Phase 5 (ARGO-inspired operator upgrades) added. Drop this in `docs/UPGRADES.md` and version-track it.*
