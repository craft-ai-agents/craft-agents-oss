# Hermes Backend Plugin Status

**Status:** Implemented and verified on 2026-04-03  
**Scope:** Hermes Phase 7 backend integration  
**Out of scope:** Voice, interactive MCP app UI, rich live tool telemetry

## What Hermes Is In Craft

Hermes is now implemented as a real external backend plugin, not a special-case runtime and not a CLI parsing hack.

Primary code paths:

- plugin package:
  - `plugins/hermes/plugin.json`
  - `plugins/hermes/main.mjs`
- managed runtime setup:
  - `packages/server-core/src/plugins/hermes-runtime.ts`
- plugin-host activation:
  - `packages/server-core/src/plugins/host.ts`
- backend/session bridge:
  - `packages/shared/src/agent/backend/factory.ts`
  - `packages/shared/src/agent/plugin-bridge-agent.ts`
  - `packages/server-core/src/sessions/SessionManager.ts`

## Final Phase 7 Contract

Hermes follows these rules in the shipped implementation:

- managed `craft-bridge` profile for local desktop use
- external mode for existing Hermes gateways
- API-first transport through `/v1/responses`
- CLI fallback reserved for debugging and emergency local execution
- Craft-owned session identity and transcript cache
- Hermes response ids stored as backend continuity pointers
- transcript-based retry when Hermes rejects `previous_response_id`
- Hermes-native skills remain native to Hermes
- model choice stays profile-default-first
- MCP config stays Craft-managed and restart-required when rewritten
- `supportsBranching=false`

## Managed And External Runtime Behavior

Managed mode prepares or reuses a stable Hermes profile and exports the environment needed by the helper runtime:

- `CRAFT_HERMES_MODE=managed`
- `CRAFT_HERMES_PROFILE`
- `CRAFT_HERMES_HOME`
- `CRAFT_HERMES_BASE_URL`
- `CRAFT_HERMES_API_KEY`
- `CRAFT_HERMES_TRANSPORT`

External mode does not mutate remote profile state. It requires:

- `CRAFT_HERMES_MODE=external`
- `CRAFT_HERMES_BASE_URL`
- `CRAFT_HERMES_API_KEY`

In both cases the host registers Hermes through the same external backend path so session handling stays consistent with other backends.

## Bridge And Recovery Semantics

The most important correctness rule from this phase is that backend continuity is not stored in Craft's local session id.

Hermes now uses backend-owned session state via the bridge path:

- Craft keeps the local session id and transcript cache.
- The bridge stores Hermes continuity in backend session state such as `sdkSessionId`.
- On continuity failure, Craft retries from its own normalized recovery transcript instead of assuming Hermes can always recover the turn chain itself.

This is the baseline pattern for future helper-backed backends.

## Verification That Passed

### Hermes-local gates

Passed:

- `packages/server-core` Hermes runtime and session tests
- `packages/server-core` plugin-host Hermes activation tests
- `packages/shared` Hermes helper API tests
- `packages/shared` Hermes transcript retry tests
- `packages/shared` Hermes CLI fallback tests
- bridge regression tests after session-pointer changes
- touched-package typechecks for `packages/shared` and `packages/server-core`
- `electron:build`

### Repo cleanup gates completed in the same pass

Passed on 2026-04-03:

- repo-wide `rtk bun run typecheck:all`
- repo-wide `rtk bun run test`

## Cleanup Work Completed During Hermes Hardening

The Hermes pass also closed the blocker set that had been preventing repo-wide green:

### Resolved during pass

- `apps/electron/src/transport/routed-client.ts`
  - fixed reconnect listener teardown bug during workspace/client swaps
- `packages/shared/src/agent/mode-manager.ts`
  - restored safe-mode allowance for developer feedback tool flow
- `packages/server/src/__tests__/smoke.test.ts`
  - isolated smoke tests from the real `~/.craft-agent` lock/config directory
- `apps/electron/src/__tests__/transport.test.ts`
  - aligned a disconnected-client expectation with current real transport wording
- `apps/electron/src/main/browser-pane-manager.ts`
  - hardened final cleanup so overlay/CDP teardown failures do not crash close flow
- `apps/electron/src/main/__tests__/browser-pane-manager.test.ts`
  - repaired test harness drift around toolbar load/state replay behavior
- `apps/electron/src/main/__tests__/session-branch-rollback.isolated.ts`
  - fixed shared-config module mocking drift
- `packages/session-tools-core/tsconfig.json`
  - fixed repo-wide typecheck inheritance path

## Remaining Limits

The following are intentionally still outside Hermes Phase 7:

- host-owned voice slot integration
- interactive MCP app surfaces
- richer backend-side live tool progress streaming
- Craft-to-Hermes skill copying or synchronization
- richer Craft-side per-turn model override policy

Those belong to later platform phases, not this backend cut.

## Why Hermes Matters To The Plugin Platform

Hermes is the first fully implemented proof that the Craft plugin platform can support an external runtime without special-casing the entire app.

It establishes the pattern for future runtimes:

- manifest-declared backend capability
- host-managed activation and quarantine
- helper/runtime boundary instead of renderer hacks
- backend continuity in backend state
- host-owned transcript recovery
- typed capability metadata instead of ad hoc app wiring
