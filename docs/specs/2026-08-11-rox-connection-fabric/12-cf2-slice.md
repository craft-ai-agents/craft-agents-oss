# Spec: CF-2 Local Store Quarantine and Write Fence

**Author:** Craft Agents session (ROX Connection Fabric)
**Date:** 2026-08-13
**Status:** Approved
**Reviewers:** Product owner — continue after CF-1; slice limited to quarantine / no-delete / write fence
**Related specs:** `00-decision.md` AC-5 / NFR-2, `08-migration-and-recovery.md`, `10-pr-dag-and-acceptance.md` (CF-2 row), `11-cf1-slice.md`

## Context

CF-1 added envelope classification on `CredentialManager.get`. The live local file backend still deletes `credentials.enc` when the header is short, the magic is wrong, or both key-derivation attempts fail (`handleCorruptedFile` unlinks the file). That violates AC-5: a decrypt/corruption failure must leave credentials recoverable.

CF-2 in the PR DAG is local-provider recovery. This slice implements the fail-closed quarantine path and a write fence. It does not introduce OS-wrapped DEK rotation, Infisical, or the broker.

## Functional Requirements

- FR-1: `SecureStorageBackend` MUST NOT unlink, truncate, or overwrite a store file because load/decrypt failed.
- FR-2: On malformed header, bad magic, undersized file, or decrypt failure the backend MUST copy the exact source bytes to a timestamped quarantine path with mode `0o600`.
- FR-3: The backend MUST verify SHA-256(quarantine copy) equals SHA-256(source) before moving the original file into the same quarantine directory.
- FR-4: After a successful quarantine the original store path MUST be absent, and the backend MUST NOT create an empty replacement file.
- FR-5: The backend MUST persist a metadata-only repair record (`digest`, `code`, `quarantinedAt`, `quarantineDir`) with no credential payload.
- FR-6: While a repair record exists, `set` / `delete` / `deleteSync` MUST throw and MUST NOT write `credentials.enc`.
- FR-7: `get` / `list` on a quarantined or missing-after-repair store MUST return empty (`null` / `[]`) without throwing a secret.
- FR-8: A successful decrypt with the current key MUST return the store and MUST NOT rewrite the file on get/list.
- FR-9: A successful decrypt only with the legacy hostname key MUST return the in-memory store (dual-read) and MUST NOT rewrite the file until a later explicit `set`.
- FR-10: A missing store and no repair record MUST still allow first-run `set` to create a new file.
- FR-11: Recovery event messages and repair records MUST NOT contain credential `value`, tokens, or plaintext store JSON.
- FR-12: CF-2 MUST NOT add `SecretProvider`, `CredentialBroker`, Infisical clients, MCP, or DEK/Keychain wrapping.

## Non-Functional Requirements

- NFR-1: Focused tests MUST pass: `bun test packages/shared/src/credentials`.
- NFR-2: `cd packages/shared && bun run tsc --noEmit` MUST succeed.
- NFR-3: Tests MUST use an isolated temp file path; they MUST NOT touch the user `~/.craft-agent/credentials.enc`.
- NFR-4: Quarantine + checksum of a 64 KiB fixture MUST finish in < 500 ms in the focused test.
- NFR-5: Source changes stay in `packages/shared/src/credentials/backends/**` plus this spec. No renderer or Electron packaging edits.

## Acceptance Criteria

### AC-1: Corrupt file is quarantined not deleted (FR-1, FR-2, FR-3, FR-4)

Given a store file whose magic bytes are wrong
When the backend loads it
Then the original path no longer exists
And a quarantine copy exists whose SHA-256 matches the bytes observed before the move
And no new empty `credentials.enc` was created

### AC-2: Decrypt failure preserves bytes (FR-1, FR-2, FR-5, FR-11)

Given a well-sized CRAFT01 file that cannot be decrypted with current or legacy keys
When the backend loads it
Then a repair record exists with a hex digest and code `decrypt_failed`
And the record JSON does not contain a credential payload

### AC-3: Writes are fenced after repair (FR-6, FR-7)

Given a repair record from AC-1 or AC-2
When `set` is called
Then it throws
And no `credentials.enc` is created
And `get` returns `null`

### AC-4: Healthy get does not rewrite (FR-8)

Given a store that decrypts with the current key
When `get` is called twice
Then the file bytes after the second get equal the bytes before the first get

### AC-5: Legacy-key decrypt is read-only (FR-9)

Given a store that decrypts only with the v1 hostname key
When `get` is called
Then the credential is returned
And the file bytes are unchanged

### AC-6: First-run write still works (FR-10)

Given no store file and no repair record
When `set` is called
Then a new encrypted store is written and `get` returns the value

### AC-7: Scope freeze (FR-12, NFR-5)

Given the CF-2 diff
When it is reviewed
Then it contains no Infisical client, broker, MCP server, or Keychain DEK wrap

## Edge Cases

- EC-1: Undersized file (< header+iv+tag) → quarantine with code `undersized`, not delete. (FR-1, FR-2)
- EC-2: Unreadable store path → return null; do not create a replacement. (FR-4, FR-7)
- EC-3: Quarantine copy checksum mismatch → leave the original file in place; do not unlink. (FR-3)
- EC-4: `set` during fence → throw; repair record unchanged. (FR-6)
- EC-5: `list` during fence → `[]`. (FR-7)
- EC-6: Recovery log/error text contains no `value` field from any credential. (FR-11)

## API Contracts

Contract notation: `POST /internal/credential-repair` is an IPC-equivalent name only; no HTTP endpoint is exposed.

```ts
export type CredentialRepairCode =
  | 'undersized'
  | 'bad_magic'
  | 'decrypt_failed'
  | 'checksum_mismatch'

export interface CredentialRepairRecord {
  readonly digest: string // SHA-256 hex of source bytes
  readonly code: CredentialRepairCode
  readonly quarantinedAt: number
  readonly quarantineDir: string
}

export class SecureStorageBackend {
  constructor(options?: { filePath?: string })
  get(id: CredentialId): Promise<StoredCredential | null>
  set(id: CredentialId, credential: StoredCredential): Promise<void>
  getRepairRecord(): CredentialRepairRecord | null
}
```

| Condition | Result |
| --- | --- |
| Healthy decrypt | store returned; file unchanged on get |
| Corrupt / undecryptable | quarantine + repair record; get null |
| set while repair record present | throw; no file write |
| Missing file, no repair record | get null; set creates store |

## Data Models

### CredentialRepairRecord

| Field | Type | Constraints |
| --- | --- | --- |
| digest | string | `^[0-9a-f]{64}$`, SHA-256 of source file bytes |
| code | enum | undersized / bad_magic / decrypt_failed / checksum_mismatch |
| quarantinedAt | number | finite unix ms |
| quarantineDir | string | absolute path, no payload files other than the quarantined store bytes |

### Quarantine directory

| Entry | Constraints |
| --- | --- |
| `credentials.enc` | exact source bytes, mode 0600 |
| sibling repair record | metadata only |

## Out of Scope

- OS-1: OS Keychain / DPAPI / Secret Service DEK wrapping — later CF-2 follow-up.
- OS-2: Migration manifest + staging namespace + atomic pointer cutover to `CredentialRef` — later CF-2 follow-up after this fence exists.
- OS-3: User-visible restore UI.
- OS-4: `SecretProvider`, importer, broker, leases — CF-3/CF-4.
- OS-5: Infisical adapter — CF-8.
- OS-6: Deleting a quarantined store automatically.
- OS-7: Changing envelope codec rules from CF-1.
