# Spec: CF-6 Native Connections Surface

**Author:** Craft Agents session (ROX Connection Fabric)
**Date:** 2026-08-13
**Status:** Partial — CF-6.6 Connect control lists import sources; full create wizard stays out
**Reviewers:** Product owner — continue after CF-5
**Related specs:** `07-native-ui-ux.md`, `10-pr-dag-and-acceptance.md` (CF-6 row)

## Context

CF-5 persists metadata-only Connection rows. CF-6.1 already registered a wave-gated `connections` rail item (`route: null`) and localElectron WorkGraph RPC. This slice enables the native Workbench surface: a `connections` compound route, NavigationState, and a native page with Services/Credentials/Imports/Policies/Audit tabs. No iframe, no Infisical UI, no new AppShell `links[]` entry.

## Functional Requirements

- FR-1: `routes.view.connections()` MUST return `'connections'`.
- FR-2: Parsing `'connections'` MUST yield `{ navigator: 'connections', details: null }` and MUST round-trip through build.
- FR-3: `APP_NAV_DESTINATIONS` connections entry MUST set `route: () => routes.view.connections()` and `isActive: isConnectionsNavigation`. It MUST NOT keep `route: null`.
- FR-4: Legacy `AppShell.tsx` MUST NOT gain `id: "nav:connections"` or `handleConnectionsClick`.
- FR-5: `MainContentPanel` MUST render a native `ConnectionsPage` when `isConnectionsNavigation` is true.
- FR-6: `ConnectionsPage` MUST expose tabs Services, Credentials, Imports, Policies, Audit using existing UI primitives. It MUST NOT render an iframe or Infisical origin.
- FR-7: The page MUST NOT display fields named `value`, `payload`, `secret`, `token`, or `refreshToken`.
- FR-8: CF-6 MUST NOT add Infisical HTTP clients or broker `getSecret`.

## Non-Functional Requirements

- NFR-1: Focused tests MUST pass: nav, route-surfaces, workgraph handlers.
- NFR-2: No Electron packaging or icon changes.

## Acceptance Criteria

### AC-1: Route round-trip (FR-1, FR-2)

Given the route string `connections`
When it is parsed and rebuilt
Then the navigator is `connections` and the rebuilt string is `connections`

### AC-2: Rail destination is enabled (FR-3)

Given `APP_NAV_DESTINATIONS`
When the connections entry is read
Then `route` is a function that returns `connections`
And `disabledTooltipKey` is absent

### AC-3: Feature-off AppShell unchanged (FR-4)

Given `AppShell.tsx`
When searched
Then it does not contain `id: "nav:connections"` or `handleConnectionsClick`

### AC-4: Native page, no iframe (FR-5, FR-6, FR-7)

Given ConnectionsPage source
When inspected
Then it contains the five tab labels
And it does not contain `<iframe` or `infisical`
And it does not render a `value`/`payload`/`secret` field

### AC-5: Scope freeze (FR-8)

Given the CF-6 diff
When reviewed
Then it has no Infisical client and no `getSecret`

## Edge Cases

- EC-1: Unknown connections subpath → parse returns the bare connections navigator or null without throwing.
- EC-2: Feature-off Workbench (`WorkspaceSurfaceHost` disabled) still does not add an AppShell rail link.
- EC-3: Empty connection list renders a safe empty state.

## API Contracts

Contract notation: `GET /internal/connections-view` is IPC-equivalent only. Existing `workgraph:listConnections` remains localElectron.

```ts
routes.view.connections(): 'connections'
isConnectionsNavigation(state): state is ConnectionsNavigationState
```

## Data Models

### ConnectionsNavigationState

| Field | Type | Constraints |
| --- | --- | --- |
| navigator | `'connections'` | required |
| details | null | no secret payload |
| rightSidebar | optional | existing panel type |

## Out of Scope

- OS-1: Inspector host tabs beyond the page-local tab strip.
- OS-2: GitHub import vertical — CF-7.
- OS-3: Infisical adapter — CF-8.
- OS-4: New AppShell `links[]` item.
- OS-5: Preload channel-map expansion beyond what tests already cover.
