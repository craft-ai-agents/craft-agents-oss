# Spec: CF-4 Credential Broker, Grants, and Leases

**Author:** Craft Agents session (ROX Connection Fabric)
**Date:** 2026-08-13
**Status:** Partial — CF-4.1 + CF-4.2 landed in-process; RPC, WorkGraph, and real delivery adapters stay out
**Reviewers:** Product owner — continue after CF-3; no Gate 0, no APPLY
**Related specs:** `05-broker-and-leases.md`, `02-domain-model.md`, `10-pr-dag-and-acceptance.md` (CF-4 row), `13-cf3-slice.md`

## Context

CF-3 gave `SecretProvider` / `CredentialImporter` and a local copy path. CF-4 must introduce the broker boundary: consumers request a lease, not a raw secret. This slice stays under `packages/shared/src/credentials/fabric/**`. It does not add WorkGraph Connection entities (CF-5), native UI/RPC (CF-6), GitHub vertical (CF-7), or Infisical (CF-8).

## What landed

### CF-4.1 — in-process broker

- `InProcessCredentialBroker` with deny-by-default grants
- `acquireLease` returns a payload-free lease (`broker-perform` by default)
- `perform(leaseId, op)` injects materialization once; second use is `lease_used`
- Wrong consumer / TTL / audience / extra resource throw `BrokerDenial` with a stable code
- Metadata-only in-memory audit via `listAudit()`
- `revokeLease` + `revalidateConsumer` (`ok` | `denied`)

### CF-4.2 — grant store, repair, delivery registry

- Injectable `AccessGrantStore` (`MemoryAccessGrantStore`, `JsonAccessGrantStore`)
- JSON grants are metadata only; files with `value` / `payload` / `secret` fail closed
- `revokeGrant` makes the next lease `grant_missing`
- `revalidateConsumer` returns `repair_required` when a grant remains but provider inspect is not active
- Delivery rank + selection; `env-legacy` only when the consumer or grant declares it
- Unsupported requested mechanism → `unsupported_delivery`
- Least-exposing pick when the grant lists more than one mechanism

## Functional Requirements

- FR-1: New consumers MUST call `acquireLease`; they MUST NOT receive a lease field named `payload` or `value`.
- FR-2: Missing grant, wrong workspace/consumer/action/resource, bad TTL, or disallowed audience MUST deny with a stable code and MUST NOT leak the secret into the denial or audit JSON.
- FR-3: `perform` MAY resolve materialization inside the broker boundary for `broker-perform`. Agent-visible lease JSON MUST NOT contain the secret.
- FR-4: Grant persistence MUST be metadata only. A grant file that contains a secret field MUST be rejected.
- FR-5: `revalidateConsumer` MUST return `repair_required` when an active grant's provider inspect is missing or revoked.
- FR-6: `env-legacy` MUST be denied unless `allowEnvLegacy` or the grant's `allowEnvLegacy` is set.
- FR-7: CF-4 MUST NOT add WorkGraph ledger tables, renderer RPC, Infisical clients, or actual git/docker/AWS/SSH helper binaries.

## Non-Functional Requirements

- NFR-1: `bun test packages/shared/src/credentials` MUST pass.
- NFR-2: `cd packages/shared && bun run tsc --noEmit` MUST pass.
- NFR-3: Source stays under `packages/shared/src/credentials/fabric/**` plus credentials index exports and this spec.

## Out of scope

- OS-1: WorkGraph Connection entities, immutable ledger, affected closure — CF-5
- OS-2: Native Connections UI and typed RPC — CF-6
- OS-3: GitHub importer → Connection → brokered API vertical — CF-7
- OS-4: Header injection, git/docker helpers, AWS `credential_process`, SSH agent, temp-file/FD cleanup
- OS-5: Hermes APPLY, Gate 0 microVM, `~/ROX` default flip

## Verification (this increment)

```text
bun test packages/shared/src/credentials
# 40 pass / 0 fail
cd packages/shared && bun run tsc --noEmit
# clean
```
