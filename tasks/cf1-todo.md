# Todo: CF-1 slice

Spec: `docs/specs/2026-08-11-rox-connection-fabric/11-cf1-slice.md` (Draft)
Plan: `tasks/cf1-plan.md`
Do not start Tasks 1–5 until the spec status is Approved.

## Task 1: Kind-specific codec + hex fingerprint

**Description:** Tighten `envelope.ts` so kind selects allowed scalar fields and fingerprints are SHA-256 hex. Existing round-trip and tamper tests stay. Add failing tests first.
**Acceptance criteria:**
- [x] AC-4 and AC-5 pass
- [x] EC-1 (empty value) throws without writing
- [x] `api_key` + `awsAccessKeyId` encode throws
- [x] OAuth encode still accepts `refreshToken`/`expiresAt`
**Verification:**
- [ ] Tests pass: `bun test packages/shared/src/credentials/__tests__/envelope.test.ts`
- [ ] Build succeeds: `cd packages/shared && bun run tsc --noEmit`
- [ ] Manual check: N/A — codec is in-process

**Dependencies:** None (blocked only on spec approval)
**Files likely touched:**
- `packages/shared/src/credentials/__tests__/envelope.test.ts`
- `packages/shared/src/credentials/envelope.ts`
**Estimated scope:** Small: 1-2 files

## Task 2: Registry invariants

**Description:** Reject non-hex fingerprints, orphan `currentVersionId`, and revive-from-revoked. Provider move and metadata-only tests remain.

**Acceptance criteria:**
- [ ] AC-6 and AC-7 pass
- [ ] EC-5, EC-6, EC-7 pass
- [ ] `JSON.stringify(registry.list())` has no payload/value field

**Verification:**
- [ ] Tests pass: `bun test packages/core/src/platform/identity/credential-types.test.ts`
- [ ] Build succeeds: `cd packages/core && bun run tsc --noEmit`
- [ ] Manual check: N/A

**Dependencies:** None (parallel with Task 1 after approval)
**Files likely touched:**
- `packages/core/src/platform/identity/credential-types.ts`
- `packages/core/src/platform/identity/credential-types.test.ts`
**Estimated scope:** Small: 1-2 files

## Checkpoint: Foundation

- [ ] Envelope + registry focused tests green
- [ ] Both package typechecks green
- [ ] Manager still unwired (intentional)

## Task 3: Live dual-read

**Description:** `CredentialManager.get` classifies via decode/wrap. Add `inspect` for encoding/fingerprint. Get-only MUST NOT call `set` or rewrite the store. Failing tests first against a fake backend.

**Acceptance criteria:**
- [ ] AC-1, AC-2, AC-3 pass
- [ ] EC-3, EC-4, EC-8 pass
- [ ] NFR-2: fixture file or serialized store bytes unchanged after get
- [ ] NFR-3: failure text has no secret

**Verification:**
- [ ] Tests pass: `bun test packages/shared/src/credentials`
- [ ] Build succeeds: `cd packages/shared && bun run tsc --noEmit`
- [ ] Manual check: test asserts no `set` on the fake backend after get

**Dependencies:** Task 1
**Files likely touched:**
- `packages/shared/src/credentials/manager.ts`
- `packages/shared/src/credentials/__tests__/manager-dual-read.test.ts` (new)
- `packages/shared/src/credentials/index.ts` (export inspect types only if required)
**Estimated scope:** Medium: 3-5 files

## Task 4: Identity cred_uuid helper

**Description:** Add a small helper that sets `ServiceConnection.credentialRef` from `createCredentialRefId()` / registry.register. Do not persist `credentialValue`. Do not change siyuan-cloud RPC behavior except to avoid new call sites.

**Acceptance criteria:**
- [ ] AC-8 passes
- [ ] Helper never calls `CredentialManager.set`
- [ ] Existing `store.test.ts` siyuan-cloud cases still pass unless they assert the new path

**Verification:**
- [ ] Tests pass: `bun test packages/core/src/platform/identity`
- [ ] Build succeeds: `cd packages/core && bun run tsc --noEmit`
- [ ] Manual check: grep CF-1 diff for `credentialValue` — no new writes

**Dependencies:** Task 2
**Files likely touched:**
- `packages/core/src/platform/identity/credential-types.ts` or new `attach-credential-ref.ts`
- `packages/core/src/platform/identity/store.ts` (only if a narrow helper fits without breaking siyuan-cloud)
- `packages/core/src/platform/identity/*.test.ts`
**Estimated scope:** Small: 1-2 files (stop and split if store.ts behavior for siyuan-cloud must change)

## Checkpoint: Core Features

- [ ] `bun test packages/shared/src/credentials packages/core/src/platform/identity`
- [ ] Dual-read does not rewrite
- [ ] Human review before CF-2

## Task 5: Scope freeze and redaction

**Description:** Confirm the CF-1 diff matches OS/FR-18/NFR-4. Add or adjust one test if error messages leak secrets. No extra features.

**Acceptance criteria:**
- [ ] AC-9 passes (review + optional grep test)
- [ ] NFR-3 covered
- [ ] OpenClaw / renderer / Infisical / broker symbols absent from the CF-1 file set

**Verification:**
- [ ] Tests pass: `bun test packages/shared/src/credentials packages/core/src/platform/identity`
- [ ] Build succeeds: shared + core `tsc --noEmit`
- [ ] Manual check: `git diff --stat` limited to NFR-4 paths plus this spec/plan

**Dependencies:** Tasks 3 and 4
**Files likely touched:**
- test files only unless a message leak is confirmed
**Estimated scope:** XS: 1 file

## Checkpoint: Complete

- [ ] AC-1…AC-9 mapped to passing tests
- [ ] Spec still Approved and unchanged except status notes
- [ ] Ready for review
