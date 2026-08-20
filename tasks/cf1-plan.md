# Implementation Plan: CF-1 Envelope Dual-Read and Registry Invariants

## Overview

Close CF-1 as a live dual-read seam plus a fail-closed metadata registry. Isolated `envelope.ts` / `CredentialRefRegistry` already exist; this plan wires get-only classification, kind-specific codec rules, registry invariants, and a `cred_<uuid>` identity helper. No broker, Infisical adapter, MCP, UI, or recovery rewrite.

**Spec:** `docs/specs/2026-08-11-rox-connection-fabric/11-cf1-slice.md` (Draft — do not implement until Approved).

## Architecture Decisions

- One in-process read seam: `CredentialManager.get` classifies via `decodeCredentialEnvelopeOrLegacy` and returns the existing `StoredCredential` shape so callers do not change.
- Observability for tests: add `inspect` (or equivalent) that reports `encoding` + fingerprint without exposing a new raw-secret API.
- Get never writes. Dual-write and quarantine stay CF-2.
- `storageMode` stays an exported type only. Connection owns mode in CF-5.
- Identity CF-1 path is a helper that assigns `credentialRef: CredentialRefId`. Do not add `credentialValue` call sites. Do not rip out siyuan-cloud legacy RPC in this slice.
- Do not touch OpenClaw types, renderer, or `tasks/plan.md` (unrelated A+B+C WIP).

## Task List

### Phase 1: Foundation

- [ ] Task 1: Kind-specific codec + hex fingerprint (failing tests first)
- [ ] Task 2: Registry invariants (orphan pointer, hex fingerprint, illegal revive)

### Checkpoint: Foundation

- [ ] `bun test packages/shared/src/credentials/__tests__/envelope.test.ts packages/core/src/platform/identity/credential-types.test.ts`
- [ ] `cd packages/shared && bun run tsc --noEmit` and `cd packages/core && bun run tsc --noEmit`
- [ ] No manager wiring yet

### Phase 2: Core Features

- [ ] Task 3: Live dual-read on `CredentialManager.get` (failing tests first)
- [ ] Task 4: CF-1 identity helper writes `cred_<uuid>` only

### Checkpoint: Core Features

- [ ] `bun test packages/shared/src/credentials packages/core/src/platform/identity`
- [ ] Byte-identical store after get-only (AC-2 / NFR-2)
- [ ] Review with human before any CF-2 talk

### Phase 3: Polish

- [ ] Task 5: Scope freeze and redaction check

### Checkpoint: Complete

- [ ] All AC-1…AC-9 have a passing focused test
- [ ] Diff stays inside NFR-4 paths
- [ ] Ready for review; no implementation before spec approval

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Existing get callers assume no classification cost / throw | High | Keep `get` return type; return `null` on undecodable envelope |
| Kind rules break legitimate oauth/aws fixtures | High | Port existing credential tests; only tighten encode, not raw set |
| Dirty worktree mixes OpenClaw into CF-1 | Med | Explicit file allow-list; do not stage `types.ts` OpenClaw hunk unless already required by compile |
| `inspect` becomes a secret oracle | High | `inspect` returns encoding + fingerprint + the same payload `get` already returns; no new field dump |
| Owner wants storageMode on CredentialRef | Med | Frozen as OS-10 / FR-17; escalate, do not add |

## Open Questions

- Approve `11-cf1-slice.md` as-is, including FR-16 (legacy siyuan-cloud `credentialValue` stays until a later spec)?
