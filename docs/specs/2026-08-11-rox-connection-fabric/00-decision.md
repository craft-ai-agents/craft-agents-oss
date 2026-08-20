# ROX Connection Fabric — Decision Record

- **Date:** 2026-08-11
- **Status:** Approved — product-owner approval recorded; contract frozen for the PR DAG
- **Scope:** native first-party connections, credentials, imports, policies, runtime leases, and audit in ROX Workbench
- **Implementation note:** CF-0 is documentation-only; implementation proceeds at CF-1 and later gates.

## Executive decision

ROX Connection Fabric is a provider-neutral domain and broker boundary inside the existing Craft Agents application. Infisical is one optional `SecretProvider` adapter for team/remote deployments; it is not the UI authority, Identity Center authority, WorkGraph authority, or canonical data model.

The local-first default remains a hardened local provider. External providers are selected per connection and deployment profile. A credential's stable logical identity (`cred_<uuid>`) is independent of provider, locator, and storage mode.

Runtime consumers request a bounded lease through `CredentialBroker.acquireLease(...)`; new consumers do not call `CredentialManager.getSecret()` or receive a canonical raw value. Delivery is mechanism-specific and is selected by the broker.

## Required product boundaries

1. No embedded upstream Infisical Web UI, iframe, or copied frontend.
2. No PostgreSQL/Redis dependency on every desktop.
3. No replacement of Infisical PostgreSQL/Redis internals.
4. No Infisical data model copied into ROX.
5. No raw secret in renderer, WorkGraph, `identity.json`, URL, argv, logs, telemetry, crash reports, agent context, prompt, plugin, MCP server, or remote/headless client.
6. No new account system beside Identity Center.
7. WorkGraph stores metadata, relationships, versions, affected-closure evidence, and audit digests only.
8. Agent Vault is a reference for broker/proxy behavior, not a mandatory local UI or sole local vault.
9. SecretSpec is a reference for declarative requirements, provider references, profiles, scopes, and fallback semantics; its format is not adopted as the canonical ROX schema without a later decision.

## Current repository evidence

- `packages/shared/src/credentials/backends/types.ts:10-34` defines the existing `CredentialBackend` seam (`isAvailable`, `get`, `set`, `delete`, `list`).
- `packages/shared/src/credentials/types.ts:101-152` defines `StoredCredential` with an overloaded raw `value: string` plus OAuth, AWS, GCP, and token fields.
- `packages/shared/src/credentials/manager.ts:14-141` exposes raw credential reads/writes through `CredentialManager`; current initialization installs only `SecureStorageBackend`.
- `packages/shared/src/credentials/backends/secure-storage.ts:4-24,66-99,320-363` uses an encrypted `credentials.enc`, machine-derived key material, and currently deletes files it classifies as corrupted.
- `packages/core/src/platform/identity/types.ts:31-78` already models `Profile`, `ServiceConnection`, `Entitlement`, and opaque `credentialRef` metadata.
- `packages/server-core/src/handlers/rpc/identity.ts:164-216` currently accepts `credentialValue` at the RPC boundary and persists it through `CredentialManager`; this is a migration seam, not the target contract.
- `packages/server-core/src/workgraph/index.ts:101-220,234-466` currently provides local libSQL graph objects, relations, immutable ledger rows, checksummed migrations, and fail-closed provisioning. It does not yet expose affected-closure queries or credential entities.
- `apps/electron/src/renderer/platform/WorkspaceSurfaceHost.tsx:9-38` composes native ActivityRail/SurfaceTabs/InspectorHost without introducing a second layout authority.
- `apps/electron/src/renderer/components/app-shell/nav-destinations.ts:41-139` is the single top-level navigation registry; Connections belongs there as a native destination.
- `apps/electron/src/preload/bootstrap.ts:52-170` exposes routed local/remote RPC clients and explicitly blocks non-localhost unencrypted `ws://`; broker operations must retain these transport boundaries.
- `apps/electron/src/main/index.ts:674-835` composes WorkGraph and registers core/GUI RPC in Electron main; headless and remote registration profiles are intentionally narrower.

## Decisions already locked

- Native UI is implemented inside the existing Workbench surface host.
- Identity Center remains the metadata/account surface; extend `ServiceConnection` rather than invent an account system.
- `CredentialManager` remains the migration seam; the old encrypted-file backend becomes the Legacy/Local provider.
- Local vault recovery is fail-closed and non-destructive: quarantine, backup, and repair precede cutover.
- First vertical slice is GitHub discovery/import/reference → native Connection → one agent/workflow lease → brokered GitHub API operation → revoke/rotation → affected closure → repair → consumer revalidation.

## Approval gate closed

Product-owner approval was recorded on 2026-08-11. The contract is frozen for the PR DAG; implementation starts at CF-1.
## Context
Craft Agents already has a metadata-only Identity Center, a priority-ordered credential backend seam, a local WorkGraph kernel, a main-owned RPC boundary, and a native Workbench composition host. The target is a provider-neutral ROX Connection Fabric that adds provider adapters and runtime brokering without creating competing authorities.
## Functional Requirements
- FR-1: The system MUST maintain stable `CredentialRef` identity while allowing provider, locator, and storage-mode replacement.
- FR-2: The system MUST store only metadata, version fingerprints, grants, leases, and audit digests outside provider/broker boundaries.
- FR-3: All new runtime consumers MUST use `CredentialBroker.acquireLease(...)`; no consumer may call a general raw-secret getter.
- FR-4: The model MUST support reference, copy, mirror, managed, and ephemeral modes.
- FR-5: `SecretProvider` and `CredentialImporter` MUST remain separate interfaces.
- FR-6: Connections MUST be a native surface through the existing Workbench host and navigation registry.
- FR-7: Revoke/rotation MUST invalidate active leases before affected-closure computation and consumer revalidation.
- FR-8: Infisical MUST remain an optional provider adapter for team/remote profiles only.
## Non-Functional Requirements

- NFR-1: The system MUST fail closed on malformed, unavailable, expired, ambiguous, unauthorized, or unsupported state.
- NFR-2: The system MUST preserve current credentials through dual-read/single-write migration and non-destructive recovery.
- NFR-3: Raw secret payload MUST NOT enter renderer, WorkGraph, identity metadata, URLs, argv, logs, telemetry, crash reports, prompts, agents, plugins, MCP, or remote clients.
- NFR-4: Personal Local MUST operate without PostgreSQL/Redis on each desktop.
- NFR-5: The implementation MUST preserve URL/NavigationContext/panel-stack authority and feature-off Workbench parity.
## Edge Cases

- EC-1: Provider unavailable during import or lease → fail closed with a stable redacted error code.
- EC-2: Expiring or revoked version → deny/invalidate; never broaden scope or select an older version silently.
- EC-3: Duplicate/conflicting candidate → same fingerprint may reference; different fingerprint requires explicit mode choice.
- EC-4: Corrupt store, unavailable OS key store, failed cutover, or partial provider write → preserve source and enter repair-required state.
- EC-5: Remote/headless client attempts local-only provider access → deny before provider dispatch.
- EC-6: Malformed rollout state or missing main-process capability → retain safe disabled/legacy path.
## Acceptance Criteria

### AC-1: GitHub import and stable identity (FR-1, FR-2, FR-5)

Given a discoverable GitHub credential, when the user previews and commits an import, then the result has a stable `cred_<uuid>` and no raw payload reaches renderer or metadata stores.

### AC-2: Brokered GitHub operation (FR-3, FR-4)

Given one named agent/workflow with an active grant, when it acquires a bounded lease, then one GitHub operation succeeds without the raw token entering agent context.

### AC-3: Authorization denial (FR-3, FR-7)

Given a wrong workspace, consumer, action, resource, audience, TTL, or approval state, when a lease is requested, then the broker denies it.

### AC-4: Revoke and affected closure (FR-2, FR-7)

Given an active connection, when its credential is revoked or rotated, then active leases become unusable, metadata-only audit is appended, affected closure is computed, and consumers are revalidated.

### AC-5: Legacy recovery (FR-2, NFR-2)

Given the current legacy store, when migration or decryption failure occurs, then credentials remain recoverable and the source is quarantined rather than deleted.

### AC-6: Native UI parity (FR-6, NFR-5)

Given Connections is enabled, when the user navigates it, then the existing Workbench host and URL/panel authorities remain in control; when disabled, legacy rendering is unchanged.

### AC-7: Infisical boundary (FR-8, NFR-4)

Given an Infisical provider adapter, when it is packaged, then pinned repository/license/tenant/TLS evidence exists and desktop PostgreSQL/Redis is not introduced.
## API Contracts
Contract notation: `POST /internal/credential-leases` is an IPC-equivalent operation name only; no network HTTP endpoint is exposed.

The detailed contracts are in `02-domain-model.md`, `04-provider-contract.md`, and `05-broker-and-leases.md`.

```ts
export interface CredentialBroker {
  acquireLease(input: {
    credentialRef: `cred_${string}`
    consumer: ConsumerIdentity
    purpose: string
    action: string
    resources: readonly string[]
    audience?: string
    ttl: number
  }): Promise<CredentialLease>
  revokeLease(leaseId: string, reason: string): Promise<void>
}
```

The normative operation is `acquireLease(...)`; a public `getSecret(ref)` API MUST NOT be introduced.
## Data Models

The normative entities are defined in `02-domain-model.md`.

| Entity | Authority | Secret payload allowed | Key invariant |
| --- | --- | --- | --- |
| `Connection` | Identity/Connection domain | No | Stable across provider moves |
| `CredentialRef` | Provider registry | No | Opaque `cred_<uuid>` |
| `CredentialVersion` | Provider/broker metadata | No | Fingerprint/version/expiry only |
| `AccessGrant` | Policy domain | No | Workspace/consumer/action/resource scoped |
| `CredentialLease` | Broker | No | Bounded TTL and delivery handle |
| `AuditEvent` | WorkGraph ledger | No | Immutable metadata and digest only |
## Out of Scope

- OS-1: Embedding or launching Infisical Web UI.
- OS-2: Running PostgreSQL/Redis per desktop or replacing Infisical storage.
- OS-3: Copying Infisical data model into ROX.
- OS-4: Building a second Identity Center/account system.
- OS-5: Browser-session import before P2 and explicit opt-in.
- OS-6: Provider adapters before broker/provider contracts are frozen.
- OS-7: Any code, migration, packaging, or runtime rollout before approval.
## Metadata
- Detailed threat model: `03-threat-model.md`.
- Import state machine and P0/P1/P2 matrix: `06-import-contract.md`.
- Native UI contract: `07-native-ui-ux.md`.
- Migration/recovery semantics: `08-migration-and-recovery.md`.
- Deployment profiles: `09-deployment-profiles.md`.
- PR DAG, first vertical slice, and test/acceptance matrix: `10-pr-dag-and-acceptance.md`.
