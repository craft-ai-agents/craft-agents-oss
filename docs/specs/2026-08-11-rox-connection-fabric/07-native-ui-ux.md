# Native UI/UX

## Composition authority

Connections is a native Workbench surface. It is mounted through the existing `WorkspaceSurfaceHost` composition boundary and uses `NavigationContext` plus the panel stack as the only route/layout authorities. No iframe, upstream Infisical frontend, second route store, or provider-specific shell is allowed.

## Navigation

Add one `connections` entry to `apps/electron/src/renderer/components/app-shell/nav-destinations.ts`. The entry is the sole registry record consumed by AppShell and ActivityRail. Surface tabs and inspector content are derived from the focused route/panel; they do not persist a competing state model.

## Surface tabs

- **Services:** `IntegrationDefinition`, `ExternalAccount`, `Connection`, health, provider and tenant metadata.
- **Credentials:** stable `CredentialRef`, kind, provider, locator summary, storage mode, versions, expiry, fingerprint, and provenance. Never show payload.
- **Imports:** source discovery, candidate list, masked preview, conflict resolution, commit/rollback status.
- **Policies:** grants, consumer scopes, action/resource allowlists, approval policy, TTL and rotation behavior.
- **Audit:** metadata-only events, decision, consumer, action, target, timestamp, version fingerprint, repair state.

## Inspector fields

Provider, external account, tenant, storage mode, scopes, consumers, health, expiry, rotation policy, provenance, versions, audit. Locator fields are masked or rendered as structured metadata, never as a secret value.

## Required actions

- Connect
- Import existing
- Test
- Repair
- Rotate
- Revoke
- Move backend
- Convert copy to reference
- Change grants
- Show affected consumers

Destructive actions require explicit confirmation at the point of action. Confirmations name the exact Connection/CredentialRef, affected consumers, and whether active leases will be invalidated.

## UI state rules

- `unknown`, malformed, unavailable, expired, or denied state renders a safe unavailable state with a stable explanation; it never enables a fallback operation implicitly.
- Renderer mutations call typed RPC commands; the main/broker boundary revalidates workspace, consumer, action, target, and approval.
- Renderer can request discovery and preview, but provider access is delayed until user selection and main-process approval.
- Health and expiry are metadata; an expired provider must not expose a raw refresh token to the UI.
- Workbench feature-off parity remains unchanged per `docs/specs/2026-08-11-rox-workbench-pr2-surface-host.md:20-37`.

## Accessibility and visual scope

Reuse existing rail, tabs, panel stack, inspector, labels, keyboard navigation, and focus semantics. This feature needs no visual companion or new shell design; the architectural decision is textual and repository-grounded. The first implementation should use existing UI primitives and prove accessibility through focused renderer tests plus a desktop smoke after the rollout gate is enabled.
