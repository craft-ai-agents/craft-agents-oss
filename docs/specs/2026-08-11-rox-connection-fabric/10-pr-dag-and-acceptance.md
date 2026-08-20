# PR DAG and Acceptance

## PR sequence

| PR | Purpose | Depends on | Main surfaces | Gate |
| --- | --- | --- | --- | --- |
| CF-0 | Freeze domain, threat model, provider/broker contracts and no-raw-secret invariants | current tree | this spec folder | owner approval; spec validator clean |
| CF-1 | Introduce versioned credential envelopes/codecs and `CredentialRef` metadata registry; keep legacy read path | CF-0 | `packages/shared`, `packages/core/platform/identity` | codec/property tests; no payload in metadata |
| CF-2 | Harden local provider migration/recovery | CF-1 | `secure-storage.ts`, local provider, backup/quarantine | dual-read/single-write; corruption preserved; atomic recovery |
| CF-3 | Introduce provider/import interfaces plus P0 local discovery adapters | CF-1 | shared provider package, main-only import services | discover/preview/commit/rollback matrix |
| CF-4 | Introduce `CredentialBroker`, grants, leases and delivery mechanism registry | CF-1, CF-3 | server-core/main, transport routing | deny-by-default authorization and no raw response contract |
| CF-5 | Add metadata-only WorkGraph Connection entities, audit events, closure/revalidation service | CF-4, existing WorkGraph | server-core WorkGraph | transaction/ledger/closure/rollback tests; no payload columns |
| CF-6 | Native Connections UI and typed RPC | CF-5, existing Workbench host | renderer platform/AppShell/nav registry | feature-off parity; accessible native surface; no iframe |
| CF-7 | First vertical: GitHub importer/reference → Connection → one consumer lease → brokered API op | CF-2, CF-4, CF-5, CF-6 | GitHub adapter, one agent/workflow seam | end-to-end redaction + revoke/rotation + closure + repair |
| CF-8 | Infisical provider adapter | CF-7 | provider package, external account flow | pinned upstream provenance, TLS/auth/tenant tests, provider contract conformance |
| CF-9 | P1 providers and remote-agent broker integration | CF-8 | provider adapters/sidecar | independent ADR/security review per provider |

Only the next uncompleted PR in this table may be implemented after CF-0 approval. PRs that do not depend on each other may be reviewed in parallel, but no shared contract may drift.

## First vertical slice

1. Discover GitHub credential metadata from a supported local source.
2. Show masked candidates and request OS/provider access only after selection.
3. Import as `reference` or `copy` into a provider; create stable `CredentialRef` and `Connection` metadata.
4. Create one `AccessGrant` for one explicitly named agent/workflow consumer.
5. Consumer requests `acquireLease({ credentialRef, consumer, purpose, action, resources, audience, ttl })`.
6. Broker performs one GitHub API operation through a trusted header/proxy/helper delivery mechanism; agent context receives no token.
7. Revoke/rotate the credential; active lease becomes unusable.
8. WorkGraph computes affected closure and revalidates the named consumer.
9. Repair/reconnect once; all affected consumers revalidate automatically.
10. Audit records contain only reference/consumer/action/target/time/decision/version fingerprint.

## Acceptance gates

### Security gate

- Static and runtime evidence that raw payload cannot enter renderer, WorkGraph, identity file, URL, argv, logs, telemetry, crash reports, agent prompts, or RPC responses.
- Every lease request enforces workspace, consumer, action, resource, audience, TTL, and approval policy.
- Provider and importer errors fail closed.

### Persistence/recovery gate

- Existing credentials survive migration.
- Legacy store remains recoverable and is never deleted on first corruption/decryption failure.
- DEK wrapping and atomic cutover work on supported platforms.
- No indefinite dual-write.

### Domain/WorkGraph gate

- Connection/credential entities contain metadata only.
- Immutable audit ledger records digests and decisions.
- Workspace isolation and deterministic affected closure are tested.
- Revoke/rotation invalidates leases before revalidation.

### UI/transport gate

- Native Connections surface uses existing Workbench host and navigation registry.
- Feature-off path is byte-for-byte behaviorally legacy-compatible.
- Remote/headless channels do not expose local-only provider authority.
- Accessibility names/focus/keyboard semantics remain intact.

### Provider gate

- Infisical adapter is not started until the provider contract is stable.
- Exact repo URL, commit, license files, EE boundary, third-party notices, trademark terms, endpoint TLS/auth/tenant behavior are recorded.
- No desktop PostgreSQL/Redis stack is introduced.

## Test matrix

| Area | Required behavior |
| --- | --- |
| codec | kind-specific validation; reject mappings/lists where scalar is required; stable fingerprints |
| provider | reference/copy/mirror/managed/ephemeral; version and expiry |
| broker | allow/deny matrix; wrong workspace/consumer/action/resource; TTL and audience |
| delivery | header/proxy/helper/FD/temp-file cleanup; env only explicit legacy fallback |
| importer | discovery, masked preview, conflict, atomic commit, rollback |
| recovery | quarantine, backup, restore, key unavailability, cutover |
| WorkGraph | metadata-only schema, transaction, immutable ledger, closure, cross-workspace isolation |
| transport | local-only routing, remote/headless denial, TLS requirement |
| UI | feature-off parity, native route, inspector metadata, no raw secret rendering |
| E2E | GitHub operation with agent context free of raw token; revoke/rotate/repair revalidation |
