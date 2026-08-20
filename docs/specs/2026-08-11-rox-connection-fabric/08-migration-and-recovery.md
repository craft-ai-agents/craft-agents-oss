# Migration and Recovery

## Local vault target

- Generate a random data-encryption key (DEK).
- Wrap the DEK with OS-native protection: macOS Keychain, Windows DPAPI, Linux Secret Service.
- Store only wrapped DEK metadata and provider metadata in the ROX config root.
- Keep raw payloads inside the local provider boundary.
- Support an explicit recovery mechanism with user-visible backup/recovery records.

The existing `CRAFT01` file is a legacy provider during migration. Do not reinterpret its payload as the new canonical domain model in place.

## Dual-read, single-write migration

1. Detect current legacy store without mutating it.
2. Verify magic/header/decryption and classify each entry through a versioned credential codec.
3. Write a migration manifest containing source digest, entry ids, codec status, and counts; it contains no payload.
4. Create target provider records in a staging namespace.
5. Verify each staged record by provider-native metadata/fingerprint and required health check.
6. Atomically commit metadata pointers from old key to new `CredentialRef`/version records.
7. Keep the original legacy store and backup until the verification gate passes.
8. Remove old store only in a separate explicit cleanup operation after backup and user-visible confirmation.

There is no indefinite dual-write. Compatibility reads end after all consumers have moved to broker leases and the migration marker is verified.

## Corruption and decryption failure

Current evidence: `packages/shared/src/credentials/backends/secure-storage.ts:351-363` deletes the file after failed decryption. Target behavior:

1. Stop all writes to the affected provider.
2. Copy the exact source bytes to a timestamped quarantine path with restrictive permissions.
3. Record a redacted recovery event with source digest and failure code.
4. Preserve the original path until quarantine checksum verification succeeds; then move it atomically to quarantine.
5. Do not create an empty replacement that could be mistaken for a valid store.
6. Offer restore from verified backup or explicit re-import.
7. Keep affected Connections in `repair_required`; deny new leases.
8. Revalidate consumers only after a provider version is verified.

## Key loss and rotation

- Keychain/DPAPI/Secret Service unavailable → provider is unavailable; no machine-id fallback for new writes.
- Key rotation creates a new wrapped DEK and rewrites through an atomic temp file; old key remains only for bounded recovery.
- Recovery requires explicit user action and records a recovery audit event.
- Backups are encrypted, integrity-checked, and never logged or uploaded implicitly.

## Failure matrix

| Failure | Preserve source | New writes | Lease behavior | User action |
| --- | --- | --- | --- | --- |
| malformed header | yes/quarantine | blocked | deny | repair/import |
| decrypt failure | yes/quarantine | blocked | deny | restore/recover |
| provider unavailable | yes | blocked | deny or existing lease until TTL | reconnect |
| partial import | yes | rollback target | deny affected ref | retry/repair |
| fingerprint conflict | yes | no implicit overwrite | existing version unchanged | choose mode |
| expired version | yes | provider-dependent | deny/refresh via new authorization | reauth/rotate |
