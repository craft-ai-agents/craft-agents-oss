# Spec: CF-5 WorkGraph Connection Metadata and Closure

**Author:** Craft Agents session (ROX Connection Fabric)
**Date:** 2026-08-13
**Status:** Partial — schema v2 + connection rows + CF-5.2 revoke/closure landed; UI/RPC stay out
**Reviewers:** Product owner — continue after CF-4
**Related specs:** `02-domain-model.md`, `10-pr-dag-and-acceptance.md` (CF-5 row), `14-cf4-slice.md`

## Context

CF-4 issues in-memory leases. CF-5 must persist Connection metadata, bindings, and immutable audit in the existing WorkGraph kernel without payload columns. Affected closure is workspace-scoped. Renderer UI and Infisical stay out.

## Functional Requirements

- FR-1: WorkGraph MUST apply schema version 2 on provision and on reopen of a v1 database.
- FR-2: `createConnection` MUST persist workspaceId, integrationId, credentialRefId, storageMode, and scopes only.
- FR-3: Connection / binding / audit rows MUST NOT have columns named `value`, `payload`, `secret`, `token`, or `refresh_token`.
- FR-4: `createConnection` MUST reject input that includes a `value` or `payload` field.
- FR-5: `bindConsumer` MUST store consumerId, purpose, allowedActions, and resources for that connection in the same workspace.
- FR-6: `appendConnectionAudit` MUST insert an immutable ledger row with credentialRefId digest fields only (no secret).
- FR-7: `affectedClosure(workspaceId, connectionId)` MUST return binding consumer ids in that workspace and MUST NOT return consumers from another workspace.
- FR-8: `getConnection` with the wrong workspace MUST return null.
- FR-9: Ledger update/delete MUST still abort.
- FR-10: CF-5 MUST NOT add Infisical, broker RPC, or Connections UI.

## Non-Functional Requirements

- NFR-1: `bun test packages/server-core/src/workgraph` MUST pass on darwin/arm64.
- NFR-2: `cd packages/server-core && bun run tsc --noEmit` MUST pass.
- NFR-3: Tests use temp configDir only.

## Acceptance Criteria

### AC-1: Create metadata-only connection (FR-2, FR-3, FR-4)

Given a provisioned WorkGraph
When `createConnection` is called with a cred_uuid and mode `copy`
Then the stored connection has that ref and mode
And calling create with `{ value: "secret" }` throws
And `JSON.stringify(connection)` does not contain a secret

### AC-2: Bind and close over one workspace (FR-5, FR-7, FR-8)

Given connection A in workspace_a bound to agent-a
And connection B in workspace_b bound to agent-b
When `affectedClosure('workspace_a', A.id)` runs
Then the result contains `agent-a` and not `agent-b`
And `getConnection('workspace_b', A.id)` is null

### AC-3: Audit is immutable and redacted (FR-6, FR-9)

Given a connection
When an allow audit is appended
Then a ledger row exists with outcome `committed`
And updating that ledger row fails
And the digest/JSON does not contain a raw secret

### AC-4: Schema v2 (FR-1)

Given a newly provisioned kernel
When `getHealth` is called
Then `schemaVersion` is 2

### AC-5: Scope freeze (FR-10)

Given the CF-5 diff
When reviewed
Then it has no Infisical client or renderer Connections UI

## Edge Cases

- EC-1: Invalid storageMode → throw. (FR-2)
- EC-2: Invalid credentialRefId → throw. (FR-2)
- EC-3: Bind unknown connection → throw. (FR-5)
- EC-4: Empty scopes allowed (empty array). (FR-2)
- EC-5: Duplicate connection id not generated; ids are unique. (FR-2)

## API Contracts

Contract notation: `POST /internal/workgraph-connections` is IPC-equivalent only.

```ts
interface CreateConnectionInput {
  workspaceId: string
  integrationId: string
  credentialRefId: `cred_${string}`
  storageMode: StorageMode
  scopes?: readonly string[]
}

interface ConnectionRecord {
  id: string
  workspaceId: string
  integrationId: string
  credentialRefId: string
  storageMode: StorageMode
  scopes: readonly string[]
}

class WorkGraphKernel {
  createConnection(input: CreateConnectionInput): Promise<ConnectionRecord>
  bindConsumer(input: { workspaceId: string; connectionId: string; consumerId: string; purpose: string; allowedActions: readonly string[]; resources: readonly string[] }): Promise<{ id: string }>
  getConnection(workspaceId: string, connectionId: string): Promise<ConnectionRecord | null>
  appendConnectionAudit(input: { workspaceId: string; connectionId: string; credentialRefId?: string; consumer?: string; action: string; decision: 'allow' | 'deny'; versionFingerprint?: string }): Promise<void>
  affectedClosure(workspaceId: string, connectionId: string): Promise<readonly string[]>
}
```

## Data Models

### workgraph_connections

| Field | Type | Constraints |
| --- | --- | --- |
| id | text | PK |
| workspace_id | text | not null |
| integration_id | text | not null |
| credential_ref_id | text | cred_uuid |
| storage_mode | text | enum |
| scopes_json | text | JSON array |
| created_at / updated_at | int | epoch ms |

No payload columns.

## Out of Scope

- OS-1: Native Connections UI — CF-6.
- OS-2: GitHub brokered HTTP — CF-7.
- OS-3: Infisical — CF-8.
- OS-4: Changing work_item semantics.
- OS-5: Renderer RPC.
