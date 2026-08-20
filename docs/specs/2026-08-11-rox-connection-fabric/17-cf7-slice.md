# Spec: CF-7.1 GitHub Import-to-Lease Vertical

**Author:** Craft Agents session (ROX Connection Fabric)
**Date:** 2026-08-13
**Status:** Approved for this increment
**Reviewers:** Product owner — continue after CF-6
**Related specs:** `10-pr-dag-and-acceptance.md` (CF-7 row), `06-import-contract.md`, `05-broker-and-leases.md`

## Context

CF-3–CF-6 give import, broker, WorkGraph, and a native Connections surface. CF-7 is the first vertical: a local GitHub token candidate becomes a Connection, one named consumer gets a grant, the broker performs one GitHub user fetch, then revoke makes the lease unusable. No live GitHub in tests — `fetch` is injected. No Infisical, no renderer iframe.

## Functional Requirements

- FR-1: Discover MUST treat `GH_TOKEN` / `GITHUB_TOKEN` env names as GitHub candidates and MUST NOT include the raw token in discover JSON.
- FR-2: Preview MUST be masked (`****` or last 4 only).
- FR-3: Commit `copy` MUST return a `cred_<uuid>` and create a WorkGraph Connection with `integrationId: 'github'`.
- FR-4: One grant for one named consumer MUST allow `github.api` on a declared resource.
- FR-5: `performGithubUser` MUST send `Authorization: Bearer <token>` inside the broker `perform` callback and MUST return only `{ login }`.
- FR-6: JSON of discover/preview/connection/lease/result MUST NOT contain the raw token.
- FR-7: After `revokeConnectionAndRevalidate`, a second `perform` on that lease MUST fail `lease_revoked`.
- FR-8: CF-7.1 MUST NOT add Infisical clients or renderer GitHub UI.

## Non-Functional Requirements

- NFR-1: `bun test packages/server-core/src/workgraph` MUST pass on darwin/arm64.
- NFR-2: Tests use temp `.env` + injected fetch; they MUST NOT call api.github.com.

## Out of Scope

- OS-1: Real network GitHub, OAuth device flow, GitHub App.
- OS-2: Connections page import wizard.
- OS-3: Infisical — CF-8.
- OS-4: Repair/reconnect UI.
