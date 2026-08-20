# Spec: CF-3 Provider Interfaces and Local Discovery

**Author:** Craft Agents session (ROX Connection Fabric)
**Date:** 2026-08-13
**Status:** Approved
**Reviewers:** Product owner — continue after CF-2; first P0 sources only
**Related specs:** `04-provider-contract.md`, `06-import-contract.md`, `10-pr-dag-and-acceptance.md` (CF-3 row), `11-cf1-slice.md`, `12-cf2-slice.md`

## Context

CF-1/CF-2 give a codec, registry, dual-read, and a quarantined local file. CF-3 must introduce `SecretProvider` and `CredentialImporter` as separate interfaces and prove discover → preview → validate → commit → rollback on a real local source. The P0 matrix lists many OS helpers; this slice lands the contracts plus the two sources that already exist in-process: `credentials.enc` and `.env` files. Keychain, git/docker helpers, AWS, ADC, SSH, and Infisical stay out.

## Functional Requirements

- FR-1: The system MUST export `SecretProvider` and `CredentialImporter` as separate TypeScript interfaces. Neither MAY be a renderer RPC type.
- FR-2: `ProviderMaterialization` MUST hold lease payload only in a non-enumerable / WeakMap slot so `JSON.stringify` does not include the secret.
- FR-3: `LocalFileSecretProvider` MUST implement inspect/write/revoke/health against an injected `CredentialBackend` and MUST register metadata-only `CredentialRef` / `CredentialVersion` records.
- FR-4: `resolveForLease` MUST return a `ProviderMaterialization` and MUST NOT be exported through renderer-facing modules in this slice.
- FR-5: `CredentialsEncImporter.discover` MUST list existing backend credential ids as candidates with `kind`, `label`, `conflictKey`, and MUST NOT include `value` / refresh tokens.
- FR-6: `EnvFileImporter.discover` MUST list variable names from an approved `.env` path and MUST NOT perform shell expansion. Discover MUST NOT return raw values.
- FR-7: `preview` MUST return `maskedSummary` (last 4 chars or `****`) and MUST NOT include the full secret.
- FR-8: `validate` MUST reject unknown candidate ids, unsupported modes other than `reference`/`copy`, and same-conflictKey/different-fingerprint without an explicit mode.
- FR-9: `commit` with `copy` MUST write through the provider and return a `CredentialRefId`. `commit` with `reference` MUST store only a locator and MUST NOT copy the payload into a second store record.
- FR-10: `rollback` after a successful commit MUST undo the provider write from that commit and MUST NOT delete the original discover source.
- FR-11: Same `conflictKey` and same fingerprint MUST reuse the existing ref and MUST NOT create a duplicate.
- FR-12: CF-3 MUST NOT add Infisical HTTP clients, `CredentialBroker`, MCP, or Keychain/git/docker/AWS/ADC/SSH adapters.

## Non-Functional Requirements

- NFR-1: `bun test packages/shared/src/credentials` MUST pass.
- NFR-2: `cd packages/shared && bun run tsc --noEmit` MUST pass.
- NFR-3: Tests MUST use temp files / memory backends; they MUST NOT read the user `~/.craft-agent/credentials.enc`.
- NFR-4: Source stays under `packages/shared/src/credentials/fabric/**` plus credentials index exports.

## Acceptance Criteria

### AC-1: Discover enc metadata only (FR-1, FR-5)

Given a memory backend with one `source_bearer` record `{ value: "super-secret" }`
When `CredentialsEncImporter.discover` runs
Then one candidate is returned
And `JSON.stringify(candidates)` does not contain `super-secret`

### AC-2: Env discover is names only (FR-6)

Given a temp `.env` containing `GH_TOKEN=super-secret`
When `EnvFileImporter.discover` runs
Then a candidate labeled `GH_TOKEN` exists
And the result JSON does not contain `super-secret`
And `$UNEXPANDED` in a value is not interpolated

### AC-3: Preview is masked (FR-7)

Given the env candidate from AC-2
When `preview` runs
Then `maskedSummary` does not contain `super-secret`
And it ends with at most four revealed characters or is fully masked

### AC-4: Copy commit and rollback (FR-1, FR-3, FR-8, FR-9, FR-10)

Given a discovered enc candidate
When `commit` runs with mode `copy`
Then a `cred_<uuid>` is returned and the provider can inspect it
And when `rollback` runs
Then provider inspect fails closed / revoke removed the copy
And the original backend record still exists

### AC-5: Duplicate fingerprint does not duplicate (FR-11)

Given a committed candidate
When `commit` is called again with the same candidate and same fingerprint
Then the same `CredentialRefId` is returned
And no second provider record is written

### AC-6: Materialization is not JSON-serializable (FR-2, FR-4)

Given `resolveForLease` on a copied ref
When the result is `JSON.stringify`'d
Then the secret value is absent

### AC-7: Scope freeze (FR-12, NFR-4)

Given the CF-3 diff
When reviewed
Then it has no Infisical client, broker, MCP server, or extra P0 OS adapters

## Edge Cases

- EC-1: Missing env file → discover returns `[]`. (FR-6)
- EC-2: Unknown candidateId on preview/commit → throw / fail closed. (FR-8)
- EC-3: `mirror` / `managed` mode on these importers → validate rejects. (FR-8)
- EC-4: Env line without `=` → ignored. (FR-6)
- EC-5: Rollback when nothing committed → no-op. (FR-10)
- EC-6: Repair-fenced backend on enc discover → discover returns `[]` or fail closed without writing. (FR-5)

## API Contracts

Contract notation: `POST /internal/credential-import` is an IPC-equivalent name only; no HTTP endpoint is exposed.

```ts
export interface SecretProvider {
  readonly id: string
  inspect(ref: CredentialRef): Promise<ProviderCredentialMetadata>
  resolveForLease(input: { credentialRef: CredentialRef }): Promise<ProviderMaterialization>
  write(input: { kind: CredentialKind; locator: ProviderLocator; payload: StoredCredential }): Promise<CredentialVersion>
  revoke(input: { credentialRef: CredentialRef }): Promise<void>
  health(): Promise<{ status: 'healthy' | 'repair_required' | 'unavailable' }>
}

export interface CredentialImporter {
  readonly id: string
  readonly sourceKind: string
  discover(input: ImportDiscoveryInput): Promise<ImportCandidate[]>
  preview(input: { candidateId: string }): Promise<ImportPreview>
  validate(input: ImportCommitInput): Promise<{ ok: true } | { ok: false; code: string }>
  commit(input: ImportCommitInput): Promise<{ credentialRefId: CredentialRefId }>
  rollback(input: { commitId?: string }): Promise<void>
}
```

| Condition | Result |
| --- | --- |
| discover | candidates, no payload |
| preview | maskedSummary only |
| commit copy | new or reused cred_uuid |
| rollback | copy removed; source intact |

## Data Models

### ImportCandidate

| Field | Type | Constraints |
| --- | --- | --- |
| id | string | non-empty |
| sourceId | string | importer id |
| kind | CredentialKind | required |
| label | string | metadata only |
| conflictKey | string | stable per source locator |
| fingerprint | string? | hex if known |
| locator | string? | non-secret |

### ProviderCredentialMetadata

| Field | Type | Constraints |
| --- | --- | --- |
| credentialRefId | CredentialRefId | required |
| kind | CredentialKind | required |
| fingerprint | string | hex |
| status | string | no payload |

## Out of Scope

- OS-1: macOS Keychain, git/docker helpers, AWS profiles, Google ADC, SSH Agent adapters — later CF-3 follow-up.
- OS-2: Infisical / Vault / 1Password — CF-8 / P1.
- OS-3: `CredentialBroker` and leases — CF-4.
- OS-4: WorkGraph Connection entities and native UI — CF-5/CF-6.
- OS-5: Renderer RPC for import.
- OS-6: Changing CF-2 quarantine behavior.
