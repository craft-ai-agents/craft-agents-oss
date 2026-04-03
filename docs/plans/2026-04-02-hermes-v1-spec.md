# Hermes V1 Backend Plugin Spec

> Historical planning document. For the implemented baseline and final status, use [../hermes-backend-status.md](../hermes-backend-status.md).

**Status:** Historical draft used to drive the implemented Phase 7 work  
**Scope:** Hermes backend integration for Craft Agents  
**Out of scope:** Interactive MCP app UI surfaces, Hermes voice mode, rich live tool telemetry

## Executive Summary

Hermes should integrate into Craft as a **Craft-managed external backend**, not as an embedded subsystem and not as a CLI stdout parser. The strongest production seam currently available is Hermes' API server, exposed through `hermes gateway`, backed by a dedicated Hermes profile such as `craft-bridge`.

Craft remains the source of truth for session identity, transcript recovery, routing, UI, permissions, and host-owned capability exposure. Hermes remains responsible for its own runtime, prompt assembly internals, native skills, and tool execution within the boundaries Craft sets.

This spec locks the Hermes v1 approach before implementation so the Phase 7 work can proceed without re-litigating transport, state ownership, or skill boundaries on every change.

## Goal

Add Hermes as the second real backend plugin in the unified plugin platform, using a safe, host-owned integration model that:

- supports managed local Hermes runtime or connection to an existing Hermes server
- preserves Hermes-native skills without copying Craft skills into Hermes
- keeps Craft in control of session state, MCP exposure, permissions, and UI
- avoids fragile CLI parsing as the primary protocol

## Non-Goals

This phase explicitly does **not** include:

- Hermes voice integration
- syncing or copying Craft skills into Hermes
- using Hermes as Craft's only durable conversation store
- structured live tool telemetry in the initial release unless spike tests prove it is reliable
- interactive MCP app rendering inside Craft
- Hermes multi-agent or worktree orchestration as a first-class Craft feature

## Architecture Decision

### Primary transport

Use Hermes' API server through:

```bash
hermes -p craft-bridge gateway
```

with API-server configuration enabled.

This is an **API primary + CLI fallback** design:

- API server is the primary production transport.
- CLI remains a secondary fallback and debug path.

### Modes

The Craft Hermes plugin should support two connection modes:

1. **Managed mode**
   Craft launches and supervises `hermes -p craft-bridge gateway`, waits for health checks, and connects through a configured base URL and API key.

2. **External mode**
   Craft connects to an already-running Hermes API server using a supplied base URL and API key.

Managed mode should be the default local desktop path. External mode should exist for advanced users, shared runtimes, and debugging.

### Profile boundary

Hermes should run under one dedicated profile:

- `craft-bridge`

That profile owns Hermes-side state:

- `config.yaml`
- `.env`
- `SOUL.md`
- Hermes-native skills
- Hermes-side plugins/hooks
- Hermes MCP configuration
- Hermes SQLite state

Craft owns the surrounding app contract:

- Craft session identity
- normalized Craft transcript
- routing and backend selection
- runtime/system instructions passed per session
- permissions and trust UI
- UI cards, session actions, composer actions, and recovery flows

### CLI fallback role

Craft should keep a narrow CLI fallback/debug lane built around:

```bash
hermes --profile craft-bridge chat -Q -q "..."
```

plus structured post-run inspection via:

```bash
hermes --profile craft-bridge sessions export - --session-id <id>
```

This fallback exists for:

- local debugging when gateway startup or auth fails
- emergency local execution when API transport is unavailable
- structured post-run inspection and replay
- validating profile setup, native skills, and MCP exposure outside the API path

It should **not** own normal production turns.

## Confirmed Hermes Runtime Contract

These points are treated as current working assumptions because they are backed by repo research:

- Hermes API server is exposed through `hermes gateway`, not a separate standalone API command.
- API-server startup is controlled by environment/config values such as:
  - `API_SERVER_ENABLED`
  - `API_SERVER_KEY`
  - `API_SERVER_PORT`
  - `API_SERVER_HOST`
  - `API_SERVER_CORS_ORIGINS`
- `GET /health` and `GET /v1/health` exist for health checking.
- `GET /v1/models` exists and is a good authenticated sanity check.
- `/v1/responses` is the strongest stateful JSON contract.
- `/v1/chat/completions` is the strongest currently available streaming contract.
- Hermes-native skills remain available without Craft copying files into Hermes.
- Hermes MCP tools are loaded from profile config and exposed with deterministic names of the form:
  - `mcp_<server>_<tool>`
- `hermes sessions export - --session-id <id>` is a strong public structured export seam for debugging, reconciliation, and post-run inspection.

## Request/Response Contract

### Primary API: `/v1/responses`

Craft should use `/v1/responses` as the primary turn API for Hermes v1.

Why:

- JSON request and response contract
- stateful chaining through `previous_response_id`
- explicit `instructions` field for per-session Craft runtime control
- cleaner contract than CLI quiet mode

Craft should maintain:

- `craft_session_id -> latest_response_id`
- `craft_session_id -> normalized Craft transcript cache`

Craft may also assign a conversation alias such as:

- `craft:<session_id>`

but should not rely on that alias alone for continuity.

### Streaming API: `/v1/chat/completions`

Craft may use `/v1/chat/completions` with `stream=true` for streamed assistant text.

Important limitation:

- stream events appear to be assistant text deltas, not a structured tool-activity protocol

So Hermes v1 streaming should be treated as:

- text streaming only
- not structured live tool progress

### CLI debug/export path

CLI mode should be documented as a secondary operational path, not a peer-primary transport.

The useful public CLI/debug pattern is:

1. run `hermes --profile craft-bridge chat -Q -q "..."`
2. capture the trailing `session_id: ...`
3. inspect or reconcile with:
   - `hermes --profile craft-bridge sessions export - --session-id <id>`

This is valuable for diagnostics and recovery work, but it should not replace the API server as Craft's main request/response contract.

## State Ownership And Recovery

Craft must remain the durable recovery layer.

### Why Craft must keep its own transcript

Repo research indicates Hermes' response store is not durable enough to be Craft's only conversation source:

- response storage is capped
- old responses may be evicted
- named conversations may orphan when their backing response disappears

That means Craft should never assume Hermes can always reconstruct a long-lived session from server-side state alone.

### Recovery model

Normal path:

- send turn through `/v1/responses`
- store returned `response_id`
- keep normalized transcript on Craft side

Recovery path:

- if Hermes rejects `previous_response_id`
- or named conversation lookup fails
- rebuild continuity from Craft's own transcript and continue from there

This is a hard v1 requirement, not an enhancement.

## Prompt And Instruction Model

Craft should inject session-specific runtime behavior through API request fields, not by mutating Hermes identity files.

### Allowed Craft injection points

- `/v1/responses.instructions`
- `system` messages on `/v1/chat/completions`

### Not allowed as normal session control

- rewriting Hermes `SOUL.md` per session
- mutating Hermes profile identity to emulate Craft session state
- copying Craft skills into Hermes skill directories

### Working rule

Hermes owns its durable identity and skill environment. Craft owns per-session runtime intent.

## Skills Model

### Settled decision

Hermes keeps its own curated native skills and must remain useful when run alone.

Craft does **not** copy or sync Craft skills into Hermes.

### V1 behavior

- Hermes-native skills remain installed and available under the `craft-bridge` profile.
- Craft may pass runtime hints or capability framing through `instructions`.
- Request-scoped skill preload should not be treated as part of the API contract in v1.

### Future direction

Later, Craft may support `@skill`-style routing that decides among:

- a Craft-native skill
- a Craft-exposed capability/tool for Hermes
- a Hermes-native skill activation path

That mapping logic is explicitly deferred beyond the first Hermes backend cut.

## MCP Control Plane Model

Craft remains the MCP control plane.

### V1 contract

- Craft owns the `mcp_servers` configuration for the `craft-bridge` profile.
- Hermes consumes those MCP servers through its normal profile config.
- Craft reasons about available Hermes MCP tools through deterministic names:
  - `mcp_<server>_<tool>`

### Operational rule

For v1, MCP configuration changes should be treated as **restart-required** unless spike tests prove otherwise.

That means:

- write profile config
- restart managed Hermes gateway if needed
- reconnect and re-verify health/tools

No hot-reload guarantee should be assumed in the initial implementation.

Because the shared `craft-bridge` profile is mutable state, MCP config edits must also be treated as **serialized operations**. Craft should avoid overlapping config rewrites while active Hermes runs are using the same profile.

## Telemetry And Streaming Boundaries

Hermes appears to expose useful hook points, but the current evidence does not justify making rich live telemetry a v1 requirement.

### V1 expectation

- streamed assistant text is acceptable
- final responses are required
- structured live tool rows are deferred unless a spike proves the hook path is reliable and correlatable

### Reason

The current hook/event picture appears to have a correlation gap:

- no guaranteed request-level response ID in hook payloads
- no guaranteed Craft session identifier in hook payloads
- no proven structured tool stream over the public API

So v1 should not promise tool-progress cards from Hermes.

## Managed Process Model

When Craft runs Hermes itself, the plugin should:

1. prepare or validate the `craft-bridge` profile
2. ensure required API-server settings exist
3. launch `hermes -p craft-bridge gateway`
4. poll `/health`
5. verify authenticated access with `/v1/models`
6. begin turn traffic

Managed mode should also own:

- shutdown
- restart after config changes
- restart after crash
- degraded-state detection for unavailable backend

## External Process Model

When Hermes is already running elsewhere, the plugin should:

- connect using explicit base URL and API key
- verify health/auth before exposing the backend as available
- avoid mutating remote profile state unless explicitly supported later

External mode should be treated as connection-only in v1.

## Transport Policy

### Primary mode

The default production path is:

- managed or external Hermes API server
- `/v1/responses` for normal stateful turns
- `/v1/chat/completions?stream=true` only when Craft needs streamed text

### Fallback mode

The fallback/debug path is:

- CLI one-turn execution
- `sessions export` for structured history inspection

Fallback mode should be used for:

- debugging
- operator workflows
- diagnosis when API startup, auth, or port binding fails
- post-run reconciliation

Fallback mode should not be treated as the normal desktop-plugin conversation transport.

## Risks

### High risk

- Hermes response-store eviction breaking `previous_response_id`
- named conversation alias pointing at evicted response state
- `/v1/chat/completions` continuity features not being reliable enough for Craft session ownership

### Medium risk

- MCP changes requiring full gateway restart more often than expected
- docs/code drift around API-server config
- weak correlation for Hermes hook-based telemetry
- shared-profile concurrency hazards if MCP config is rewritten while overlapping runs are active

### Low risk

- managed gateway startup and health verification
- preserving Hermes-native skills under a dedicated profile

## Required Spike Tests Before Full Implementation

These should be treated as blocking validation tasks before the Hermes backend is declared complete.

### 1. Response-store durability spike

Verify:

- eviction behavior after more than 100 stored responses
- behavior of old `previous_response_id`
- behavior of named `conversation` aliases after eviction

### 2. SSE parsing spike

Verify `/v1/chat/completions?stream=true` under:

- plain text response
- tool-using response
- interrupted/disconnected response

Craft needs exact chunk behavior before we wire streaming UI.

### 3. Session-header continuity spike

Verify whether any session-header continuity on `/v1/chat/completions` is real enough to trust. Assume "not safe yet" unless proven.

### 4. MCP restart semantics spike

Verify whether changing `mcp_servers` under the `craft-bridge` profile requires:

- no restart
- soft reload
- full gateway restart

The spec currently assumes restart-required.

This spike should also confirm whether restart-required changes can be safely serialized under a single shared `craft-bridge` profile without stepping on overlapping runs.

### 5. Hook telemetry spike

Build a tiny Hermes-side plugin that logs hook payloads and confirm:

- payload shapes
- API-mode firing behavior
- whether request/session correlation is good enough for future telemetry

This spike informs v2, not baseline v1 completion.

## Acceptance Criteria

Hermes v1 is done when all of the following are true:

- Craft can launch Hermes gateway in managed mode under `craft-bridge`.
- Craft can connect to an external Hermes API server in external mode.
- Craft can send turns through `/v1/responses`.
- Craft persists `latest_response_id` and its own transcript cache.
- Craft can recover from lost Hermes response-chain continuity by rebuilding from its own transcript.
- Craft can pass runtime instructions without mutating Hermes profile identity.
- Hermes-native skills remain usable without any Craft-to-Hermes skill copying.
- Craft can manage Hermes MCP exposure through profile config.
- Craft treats MCP config rewrites as serialized, restart-required operations under the shared profile.
- Craft degrades cleanly when Hermes is unavailable, misconfigured, or restarted.

## Explicit V2 Deferrals

These should remain out of scope unless a later phase explicitly pulls them forward:

- structured live tool telemetry from Hermes
- request-scoped skill preload over the API
- hot MCP reload without restart
- trusting Hermes response storage as Craft's only long-term conversation memory
- Hermes voice mode
- Hermes-native multi-agent/worktree orchestration as a Craft feature
- interactive MCP app UI surfaces
- treating CLI stdout parsing as a peer-primary production transport

## Relationship To Remaining Phases

### Phase 7

This spec is the working contract for:

- Hermes backend plugin
- managed/external runtime wiring
- Craft-owned state recovery
- host-owned voice slots on the Craft side only

### Phase 8

Phase 8 remains separate and should focus on:

- interactive MCP app surfaces
- sandboxed host-rendered app cards, panes, and deck projections
- richer recovery and degraded-state UX

Hermes backend integration should not be allowed to sprawl into Phase 8 concerns.
