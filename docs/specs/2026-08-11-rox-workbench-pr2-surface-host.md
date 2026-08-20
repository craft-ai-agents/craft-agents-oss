# PR-2 Workspace Surface Host and Rollout Adapter

## 1. Title and Metadata

- **Author:** Craft Agents maintainers
- **Date:** 2026-08-11
- **Status:** Approved
- **Reviewers:** Product owner approval recorded in the implementation session
- **Parent ADR:** `docs/specs/2026-08-10-rox-workbench-architecture-convergence.md`
- **Depends on:** PR-0 rollout contract; PR-1 WorkGraph foundation

## Context

The parent ADR locks URL state, `NavigationContext`, and the panel stack as the sole renderer layout/navigation authority. Current `NavigationContext` serializes the focused route, complete panel stack, focused index, sidebar, and workspace slug into URL parameters and restores them on browser history changes, reload, and workspace switches. Any new shell must consume this state rather than create a competing store.

The renderer already contains the W1 presentational hosts `ActivityRail`, `SurfaceTabs`, and `InspectorHost`, composed by `apps/electron/src/renderer/platform/index.tsx` through `UnifiedShellLayout`. Their existing gate is `featureUnifiedShellAtom`; the parent ADR requires a deterministic operator-capability AND explicit-user-preference rollout contract so renderer intent cannot bypass operator policy.

PR-2 makes that contract usable at the composition boundary and preserves a zero-delta legacy path. It does not provision or access WorkGraph, migrate Session data, or add a new RPC. PR-1 remains independently removable with the rollout disabled and without legacy-data transformation.

## Functional Requirements

- FR-1: Resolve rollout availability. The adapter MUST resolve availability through the existing `resolveWorkbenchAvailability(operatorCapability, userPreference)` contract. It MUST accept only an explicit boolean `true` for each positive key; all missing, malformed, or non-boolean values MUST fail closed according to the established truth table.

- FR-2: Enforce operator precedence. The adapter MUST treat an operator capability other than `true` as `unavailable`, regardless of user preference. A user preference MUST NOT elevate an unavailable capability.

- FR-3: Preserve legacy rendering. When availability is `unavailable` or `legacy`, the host MUST render the existing legacy children without adding Workbench chrome or invoking WorkGraph APIs. The `legacy` state MUST be distinguishable from `unavailable` in the adapter result even though both preserve the legacy shell.

- FR-4: Mount one Workbench boundary. When availability is `enabled`, the adapter MUST mount one `WorkspaceSurfaceHost` composition boundary around the existing panel-stack content. The boundary MUST compose the existing `ActivityRail`, `SurfaceTabs`, and `InspectorHost` hosts without duplicating their state or route logic.

- FR-5: Preserve URL and panel authority. The adapter and `WorkspaceSurfaceHost` MUST NOT write route, panel, focus, sidebar, workspace, or layout state directly. Navigation MUST continue through `NavigationContext`; panel focus/close MUST continue through the existing panel-stack atoms and their existing URL synchronization.

- FR-6: Read the explicit user preference. The adapter MUST expose a single Workbench user-preference key backed by the existing centralized local-storage utility. The migration MUST read the prior unified-shell preference only as a bounded compatibility fallback and MUST normalize invalid values to `false`. It MUST NOT create an indefinite dual-write scheme.

- FR-7: Keep WorkGraph out of the renderer gate. The rollout adapter and surface host MUST NOT open a database, call WorkGraph RPCs, perform migration/import/indexing, or mutate graph state. Enabling the renderer host is a presentation decision only; future main-process enforcement remains authoritative.

- FR-8: Keep the adapter injectable. The composition boundary MUST receive operator capability as an explicit input or provider-resolved value. PR-2 MUST NOT invent an environment-variable name, infer capability from arbitrary renderer environment state, or make renderer configuration authoritative over main-process policy.

## Non-Functional Requirements

- NFR-1: Legacy parity. With Workbench disabled, the adapter MUST add no DOM chrome and MUST preserve the existing child tree and navigation behavior. The feature-off parity test MUST execute without network, filesystem, database, or Electron main-process dependencies.

- NFR-2: Fail-closed security. Malformed persisted values and capability inputs MUST default to the non-enabled path. No user-controlled renderer value may authorize WorkGraph access or bypass an operator gate.

- NFR-3: Determinism. For identical capability and preference inputs, the adapter MUST return the same availability state without time, network, random, workspace, or panel-state dependencies.

- NFR-4: Performance. Availability resolution MUST be synchronous, side-effect free, and O(1). The disabled path MUST not add an asynchronous operation or more than one additional wrapper element to the rendered legacy tree.

- NFR-5: Accessibility. The enabled host MUST preserve the existing accessibility semantics of the three presentational hosts. PR-2 MUST NOT remove existing labels, keyboard focus behavior, or tooltip affordances.

- NFR-6: Testability. The truth table, preference normalization/migration, enabled composition, disabled parity, and non-authority behavior MUST be covered by deterministic focused tests in the renderer package.

## Acceptance Criteria

### AC-1: Operator-disabled truth table (FR-1, FR-2, NFR-2)

Given operator capability is `false`, missing, malformed, or any non-boolean value
When the adapter resolves any user preference
Then it returns `unavailable`
And no Workbench host or WorkGraph operation is reachable.

### AC-2: Operator-enabled legacy truth table (FR-1, FR-3)

Given operator capability is exactly `true`
When user preference is missing, malformed, `false`, or any non-boolean value
Then the adapter returns `legacy`
And renders the legacy children without Workbench chrome.

### AC-3: Both keys enabled (FR-1, FR-4, FR-7)

Given operator capability and user preference are exactly `true`
When the host renders
Then it returns `enabled`
And mounts one host containing the existing ActivityRail, SurfaceTabs, panel-stack children, and InspectorHost
And no WorkGraph operation is performed.

### AC-4: URL/panel authority remains unchanged (FR-5, NFR-1)

Given an enabled host with one or more existing panel-stack entries
When a user focuses, closes, resizes, or navigates a panel through the existing controls
Then the existing atoms and `NavigationContext` perform the operation
And URL synchronization remains the only route/layout persistence path.

### AC-5: Feature-off parity (FR-3, NFR-1, NFR-4)

Given availability is `unavailable` or `legacy`
When the same children are rendered through the adapter
Then the adapter produces the legacy child composition with no Workbench rail, tabs, inspector, database call, or new persistence write.

### AC-6: Preference migration (FR-6, NFR-2)

Given the new preference key is absent
And the bounded compatibility key contains a valid boolean
When the preference is read
Then the valid old value is used as the initial preference
And invalid old values resolve to `false`
And the implementation does not maintain two independently writable authorities.

### AC-7: Injection boundary (FR-8, NFR-3)

Given operator capability is supplied to the boundary through its declared input/provider
When the value changes between `true` and non-`true`
Then the resolved state follows the truth table
And arbitrary renderer environment/config values cannot elevate the state.

### AC-8: Accessibility preservation (NFR-5)

Given availability is `enabled`
When the existing rail, tabs, inspector, and panel controls are queried
Then their existing accessible names, selected/pressed states, and keyboard activation behavior remain present.

## Edge Cases

- EC-1: `localStorage` is unavailable or throws. The preference reader MUST use `false` and retain legacy parity.
- EC-2: Stored preference JSON is malformed, a string such as `"true"`, a number, `null`, or an object. It MUST normalize to `false`.
- EC-3: Operator capability is supplied as a string, number, object, or `undefined`. It MUST resolve to `unavailable`.
- EC-4: The compatibility key and new key disagree. The new explicit key is authoritative once present; the compatibility key is read only when the new key is absent.
- EC-5: The panel stack is empty during first render. The host MUST not manufacture a route or write URL state; existing initialization remains responsible for restoration.
- EC-6: A panel route is malformed or unsupported. Existing panel-stack/NavigationContext normalization remains responsible; the host MUST treat it as opaque and MUST NOT create a second parser.
- EC-7: An enabled host is mounted without the expected navigation/panel context. The adapter MUST fail through the existing context contract rather than silently creating fallback navigation state.
- EC-8: WorkGraph APIs are absent, unavailable, or throw. PR-2 MUST remain unaffected because the renderer gate does not call them.
- EC-9: A user turns the preference off after enabling the host. New renders MUST return to legacy composition without deleting graph data or rewriting legacy source data.

## API Contracts

```ts
export type WorkbenchAvailability = 'unavailable' | 'legacy' | 'enabled'

export function resolveWorkbenchAvailability(
  operatorCapability: unknown,
  userPreference: unknown,
): WorkbenchAvailability

export interface WorkbenchRolloutInput {
  operatorCapability: unknown
  userPreference: unknown
}

export interface WorkspaceSurfaceHostProps {
  children: React.ReactNode
  operatorCapability: unknown
  userPreference?: unknown
}

export interface WorkbenchPreferenceReader {
  /** Reads the new key, using the old key only when the new key is absent. */
  read(): boolean
}

export interface WorkspaceSurfaceHostResult {
  availability: WorkbenchAvailability
  rendered: React.ReactNode
}
```

The host has no HTTP endpoint, network endpoint, IPC channel, database contract, mutation response, or error payload in PR-2. The renderer MUST NOT expose `GET /api/workbench-rollout`; that path is intentionally absent because this is a renderer composition contract. WorkGraph access is explicitly not part of this API.

## Data Models

| Entity | Field | Type | Constraints |
| --- | --- | --- | --- |
| Rollout decision | `availability` | `'unavailable' \| 'legacy' \| 'enabled'` | Derived only; never persisted as an independent authority |
| Operator gate | `operatorCapability` | `unknown` input, normalized to boolean truth | Only exact `true` enables the operator side |
| User preference | `userPreference` | `unknown` input, normalized to boolean truth | Only exact `true` enables opt-in; missing/invalid defaults false |
| New preference record | centralized local-storage boolean | `boolean` | Stored under the new Workbench key; invalid storage is treated as false |
| Compatibility preference record | legacy unified-shell value | `unknown` | Read-only fallback while the new key is absent; no indefinite dual writes |
| Surface host | `children` | `ReactNode` | Existing panel-stack composition; opaque to the adapter |

No database table, WorkGraph entity, remote identity, secret, or persisted route snapshot is introduced by PR-2.

## Out of Scope

- OS-1: WorkGraph provisioning, migrations, materialization, indexing, queries, or mutations. These remain future vertical-slice work and main-process concerns.
- OS-2: Session JSONL compatibility reads and WorkItem materialization. Owned by PR-3.
- OS-3: TaskRunner and Cloud Run AgentRun adapters. Owned by PR-4.
- OS-4: Any new RPC, preload API, IPC channel, remote/headless capability, sync, identity, passkey, or encryption behavior.
- OS-5: Replacing `NavigationContext`, `panelStackAtom`, `workspaceUrl`, or existing URL codecs.
- OS-6: A second route/layout persistence store or indefinite dual writes.
- OS-7: New Workbench visual design, new domain surfaces, graph visualization, or WorkItem UI.
- OS-8: Inventing the final operator environment-variable/configuration name. The main-process enforcement and runtime wiring remain a later bounded integration.
- OS-9: Deleting or rewriting the existing unified-shell components or legacy navigation behavior.
