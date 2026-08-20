# Spec: CF-1 Credential Envelope and Metadata Registry

**Author:** Craft Agents session (ROX Connection Fabric)
**Date:** 2026-08-13
**Status:** Approved
**Reviewers:** Product owner — approved 2026-08-13 including FR-16 (siyuan-cloud `credentialValue` stays; no new call sites)
**Related specs:** `00-decision.md` (Approved CF-0), `02-domain-model.md`, `08-migration-and-recovery.md`, `10-pr-dag-and-acceptance.md` (CF-1 row)

## Context

CF-0 froze ROX Connection Fabric: Infisical is an optional later adapter, not the identity or data model. CF-1 is the first implementation gate: versioned credential envelopes/codecs, a metadata-only `CredentialRef` registry, and a live legacy read path that classifies existing `StoredCredential` records without rewriting them.

The tree already has isolated units — `packages/shared/src/credentials/envelope.ts` and `packages/core/src/platform/identity/credential-types.ts` — plus focused tests. They are not a closed CF-1. `CredentialManager.get` / `set` still traffic raw `StoredCredential`. No production caller invokes encode/decode. `IdentityStore` still stores `credentialRef = connection.id` and `identity.connect` still accepts `credentialValue` over RPC. `StorageMode` is exported and unused. Kind is a label on a single overloaded payload.

This slice exists so CF-2 recovery and CF-3 providers have a real codec and a stable `cred_<uuid>` to point at. Without a live dual-read seam, later PRs will invent a second read path or keep calling `CredentialManager.get` as a raw-secret getter.

Parent product AC-1…AC-7 (GitHub import, brokered lease, Infisical packaging) remain owned by CF-7/CF-8. They are not CF-1 exit criteria.

## Functional Requirements

- FR-1: `CredentialManager.get` MUST return a value only after classifying the stored record as a current envelope or as a legacy `StoredCredential` object wrapped in memory.
- FR-2: Legacy classification MUST NOT rewrite, delete, rename, or truncate the backing store file or the stored record.
- FR-3: `encodeCredentialEnvelope` / `decodeCredentialEnvelope` MUST be the only functions that create or parse `rox-credential-envelope` v1 with codec `stored-credential/v1`.
- FR-4: Envelope encode MUST reject a payload whose `value` is not a non-empty JSON string, and MUST reject mappings or lists in any field that the kind requires to be a scalar.
- FR-5: Envelope fingerprint MUST be SHA-256 hex (`^[0-9a-f]{64}$`) over `kind` plus a canonicalized normalized payload; key order MUST NOT change the fingerprint.
- FR-6: Kind validation MUST be kind-specific: `api_key` and `bearer_token` MUST allow only `value` plus optional `expiresAt`/`source`/`tokenType`; `oauth2_token_set` MUST require `value` and MAY include `refreshToken`/`expiresAt`/`clientId`/`clientSecret`/`idToken`/`tokenType`/`source`; `aws_credential_source` MUST require `value` and `awsAccessKeyId`; `gcp_adc` MUST require `value`. Other listed kinds MUST accept only the scalar `value` plus optional `expiresAt`/`source` until a later spec names more fields.
- FR-7: `decodeCredentialEnvelope` MUST return `null` for tampered fingerprints, wrong format/version/codec, or malformed JSON. It MUST NOT throw into callers as an untyped exception that contains payload text.
- FR-8: `decodeCredentialEnvelopeOrLegacy` MUST wrap a well-formed legacy object in memory and MUST return `null` for a non-object raw string that is not a valid envelope (legacy stores objects, not bare token strings).
- FR-9: `CredentialRefRegistry.register` MUST create an opaque id matching `cred_<uuid>` and MUST persist only metadata fields defined on `CredentialRef`.
- FR-10: `updateProvider` MUST keep `CredentialRef.id` unchanged when `providerId` and `locator` change.
- FR-11: `registerVersion` MUST store `codec`, hex `fingerprint`, timestamps, and status only. It MUST reject unknown fields including `value`/`payload`/`secret`.
- FR-12: An active version MUST supersede the previous active version. `setVersionStatus` MUST reject any status not in `active | superseded | revoked | invalid`, and MUST reject a transition from `revoked` or `invalid` back to `active` on the same version id.
- FR-13: `register` MUST reject `currentVersionId` unless that version id already exists for the same ref.
- FR-14: Registry list/get clones MUST NOT contain a secret payload field, and `JSON.stringify` of registry output MUST NOT contain the literal stored secret from a rejected register attempt.
- FR-15: New Identity Center writes in this slice MUST store `ServiceConnection.credentialRef` as a `CredentialRefId` (`cred_<uuid>`), not as `connection.id`.
- FR-16: `identity.connect` MUST NOT persist `credentialValue` for a new CF-1 path. Existing siyuan-cloud callers MAY keep the legacy RPC field until a later identity-import spec; the CF-1 path MUST NOT add new call sites that pass `credentialValue`.
- FR-17: `storageMode` MUST NOT be stored on `CredentialRef` or on the envelope. CF-1 MUST keep `StorageMode` as an exported type only; Connection-owned mode lands in CF-5.
- FR-18: CF-1 MUST NOT add `getSecret(ref)`, `SecretProvider`, `CredentialBroker`, MCP tools, or Infisical HTTP clients.

## Non-Functional Requirements

- NFR-1: Focused verification MUST complete via `bun test packages/shared/src/credentials packages/core/src/platform/identity` with zero failures, and `bun run tsc --noEmit` in `packages/shared` and `packages/core`.
- NFR-2: A get-only dual-read of an existing on-disk store MUST leave file bytes unchanged (byte-identical `credentials.enc` or the test double used in the focused test).
- NFR-3: Decode/encode error messages MUST NOT include the credential `value`, `refreshToken`, `clientSecret`, `idToken`, or `awsSessionToken`.
- NFR-4: CF-1 source changes MUST stay inside `packages/shared/src/credentials/**` and `packages/core/src/platform/identity/**` plus this spec and the CF-1 task files. Renderer, Electron packaging, OpenClaw types, and Infisical clients MUST NOT change.
- NFR-5: Dual-read classification of a 1 000-entry in-memory fixture MUST finish in < 100 ms on the development machine used for verification (wall-clock of the focused test).
- NFR-6: Implementation MUST fail closed: unknown kind, empty locator fields, non-hex fingerprint, and orphan `currentVersionId` throw or return `null` as specified; they MUST NOT coerce defaults that hide the error.

## Acceptance Criteria

### AC-1: Live get classifies a current envelope (FR-1, FR-3, FR-5)

Given a backend record whose stored JSON is a valid `rox-credential-envelope` v1
When `CredentialManager.get` is called with that credential id
Then the returned object exposes the decoded payload fields the current manager callers already read
And the returned metadata includes codec `stored-credential/v1` and a matching SHA-256 hex fingerprint
And `encodeCredentialEnvelope` / `decodeCredentialEnvelope` ran on that path

### AC-2: Live get wraps legacy object without rewrite (FR-1, FR-2, FR-8, NFR-2)

Given a backend record that is a legacy `StoredCredential` object `{ value: "legacy-token" }`
When `CredentialManager.get` is called
Then the caller still receives `value: "legacy-token"`
And `decodeCredentialEnvelopeOrLegacy` produced an in-memory wrap with codec `stored-credential/v1`
And the backing store bytes are unchanged
And no `set`/`saveStore` occurs

### AC-3: Tampered envelope fails closed (FR-7, NFR-3, NFR-6)

Given a stored envelope whose payload was edited so the fingerprint no longer matches
When `CredentialManager.get` is called
Then the get returns `null` or a typed failure without throwing the secret
And the error or log text does not contain the original `value`

### AC-4: Kind-specific encode rejects illegal fields (FR-4, FR-6)

Given an `api_key` payload whose `value` is a mapping or list
When `encodeCredentialEnvelope` is called
Then it throws
And given an `api_key` payload that also sets `awsAccessKeyId`
When `encodeCredentialEnvelope` is called
Then it throws

### AC-5: Fingerprint is stable and hex (FR-5)

Given two `StoredCredential` objects that differ only in key insertion order
When `credentialPayloadFingerprint` is computed for the same kind
Then both results are identical
And both match `^[0-9a-f]{64}$`

### AC-6: Registry identity survives provider move (FR-9, FR-10, FR-14)

Given a registered `CredentialRef` with a local locator
When `updateProvider` moves it to an `infisical` locator
Then `id` is unchanged
And `JSON.stringify` of `get`/`list` contains no secret payload field

### AC-7: Version graph and orphan pointer (FR-11, FR-12, FR-13)

Given a ref with one active version
When a second active version is registered
Then the first version status is `superseded`
And given `register({ currentVersionId: "ver_missing" })`
When that call runs
Then it throws
And given `setVersionStatus(id, "revoked")` then `setVersionStatus(id, "active")`
When the second call runs
Then it throws

### AC-8: Identity ref is a cred uuid on the CF-1 write path (FR-15, FR-16)

Given a CF-1 helper that attaches a registry ref to a `ServiceConnection`
When the connection is written
Then `credentialRef` matches `^cred_[0-9a-f-]{36}$`
And the helper does not call `CredentialManager.set` with a raw `credentialValue`

### AC-9: Scope freeze (FR-17, FR-18, NFR-4)

Given the CF-1 diff
When it is reviewed
Then it contains no `SecretProvider`, `CredentialBroker`, `acquireLease`, Infisical HTTP client, MCP server, or `getSecret`
And `CredentialRef` has no `storageMode` field

## Edge Cases

- EC-1: Empty `value` on encode → throw; do not write. (FR-4)
- EC-2: Legacy object with extra unknown field → wrap fails closed (`null` or throw at manager); do not persist a repaired object. (FR-8, FR-2)
- EC-3: Bare string token in the store → treat as undecodable (`null`); do not coerce into `{ value: thatString }`. (FR-8)
- EC-4: Corrupt JSON in an envelope-shaped string → `decodeCredentialEnvelope` returns `null`; manager get returns `null`; store untouched. (FR-7, FR-2)
- EC-5: Duplicate `CredentialRef.id` on register → throw; first record remains. (FR-9)
- EC-6: Infisical locator with empty `projectId`/`secretKey` → `register`/`updateProvider` throw. (FR-10, NFR-6)
- EC-7: `setVersionStatus` with `"unknown"` → throw; stored status unchanged. (FR-12)
- EC-8: Backend `get` throws → manager must not write and must not encode a fallback secret. (FR-1, FR-2)
- EC-9: 1 000 legacy records classified in memory → finishes under NFR-5; no file writes. (NFR-5, FR-2)

## API Contracts

Contract notation: `POST /internal/credential-read` is an IPC-equivalent operation name only; no network HTTP endpoint is exposed. The live operation is `CredentialManager.get` / `inspect`.

```ts
// packages/shared/src/credentials/envelope.ts (normative names)

export const CREDENTIAL_ENVELOPE_FORMAT = 'rox-credential-envelope'
export const CREDENTIAL_ENVELOPE_VERSION = 1
export const CREDENTIAL_ENVELOPE_CODEC = 'stored-credential/v1'

export interface CredentialEnvelopeV1 {
  readonly format: typeof CREDENTIAL_ENVELOPE_FORMAT
  readonly version: typeof CREDENTIAL_ENVELOPE_VERSION
  readonly codec: typeof CREDENTIAL_ENVELOPE_CODEC
  readonly kind: CredentialKind
  readonly payload: StoredCredential
  readonly fingerprint: string // SHA-256 hex
}

export function encodeCredentialEnvelope(input: {
  kind: CredentialKind
  payload: StoredCredential
}): string

export function decodeCredentialEnvelope(serialized: string): CredentialEnvelopeV1 | null

export function decodeCredentialEnvelopeOrLegacy(
  raw: unknown,
  kind: CredentialKind,
): CredentialEnvelopeV1 | null

export function credentialPayloadFingerprint(
  kind: CredentialKind,
  payload: StoredCredential,
): string
```

```ts
// Live read seam (new, manager-internal or exported for tests)

export interface CredentialReadResult {
  readonly credential: StoredCredential
  readonly encoding: 'envelope-v1' | 'legacy-object'
  readonly fingerprint?: string
  readonly codec?: typeof CREDENTIAL_ENVELOPE_CODEC
}

// CredentialManager.get keeps its current return type StoredCredential | null
// so existing callers compile. Classification is observable via a test-only
// or sibling method:

export interface CredentialManagerReadSeam {
  get(id: CredentialId): Promise<StoredCredential | null>
  inspect?(id: CredentialId): Promise<CredentialReadResult | null>
}
```

```ts
// packages/core/src/platform/identity/credential-types.ts

export class CredentialRefRegistry {
  register(input: RegisterCredentialRefInput): CredentialRef
  get(id: CredentialRefId): CredentialRef | undefined
  list(): CredentialRef[]
  updateProvider(id: CredentialRefId, providerId: string, locator: ProviderLocator, now?: number): CredentialRef
  registerVersion(input: RegisterCredentialVersionInput): CredentialVersion
  getVersion(id: string): CredentialVersion | undefined
  listVersions(credentialRefId: CredentialRefId): CredentialVersion[]
  setVersionStatus(id: string, status: CredentialVersionStatus): CredentialVersion
}
```

Error contract (in-process):

| Condition | Result |
| --- | --- |
| Illegal encode payload | throw; message names the field, not the secret |
| Tampered / unknown envelope | `null` from decode; get returns `null` |
| Invalid kind on legacy wrap | `null` |
| Invalid registry metadata | throw `Invalid credential metadata: <field>` |
| Illegal version transition | throw `Invalid credential version status` or transition error |
| Orphan `currentVersionId` | throw |

## Data Models

### CredentialEnvelopeV1

| Field | Type | Constraints |
| --- | --- | --- |
| format | `'rox-credential-envelope'` | required, exact |
| version | `1` | required, exact |
| codec | `'stored-credential/v1'` | required, exact |
| kind | `CredentialKind` | required, one of the published union |
| payload | `StoredCredential` | kind-normalized scalars only; `value` non-empty string |
| fingerprint | string | `^[0-9a-f]{64}$`, SHA-256 of kind + canonical payload |

### CredentialRef

| Field | Type | Constraints |
| --- | --- | --- |
| id | `cred_<uuid>` | immutable, opaque |
| kind | `CredentialKind` | required |
| providerId | string | non-empty |
| locator | `ProviderLocator` | validated per discriminant |
| currentVersionId | string? | must exist if set |
| createdAt | number | finite, >= 0 |
| updatedAt | number | finite, >= 0 |

`storageMode` is not a column on this entity in CF-1.

### CredentialVersion

| Field | Type | Constraints |
| --- | --- | --- |
| id | string | non-empty, unique |
| credentialRefId | `CredentialRefId` | must exist |
| codec | string | non-empty |
| fingerprint | string | `^[0-9a-f]{64}$` |
| providerVersion | string? | non-empty if present |
| createdAt | number | finite, >= 0 |
| expiresAt | number? | finite, >= 0 if present |
| status | `active \| superseded \| revoked \| invalid` | required |

### ServiceConnection.credentialRef (CF-1 write path)

| Field | Type | Constraints |
| --- | --- | --- |
| credentialRef | `CredentialRefId` | `cred_<uuid>` only; never a raw secret; never `connection.id` on the new path |

### StoredCredential (legacy payload, unchanged columns)

Existing fields remain. CF-1 does not add columns. Kind rules restrict which fields may be present inside an envelope.

## Out of Scope

- OS-1: `SecretProvider` / `CredentialImporter` interfaces and adapters — CF-3.
- OS-2: `CredentialBroker`, grants, leases, delivery mechanisms — CF-4.
- OS-3: WorkGraph Connection entities, audit ledger, affected closure — CF-5.
- OS-4: Native Connections UI and new renderer RPC — CF-6.
- OS-5: GitHub import vertical and brokered GitHub HTTP — CF-7.
- OS-6: Infisical adapter, pinned upstream, TLS/tenant packaging — CF-8.
- OS-7: Codex/OMP MCP `rox-connection-broker` registration — depends on CF-4/CF-7.
- OS-8: Dual-write, DEK wrap, quarantine, non-deletion of corrupt `credentials.enc` — CF-2. CF-1 only forbids rewrite on get.
- OS-9: Removing `identity.connect` `credentialValue` for siyuan-cloud — later identity-import spec. CF-1 MUST NOT add new uses.
- OS-10: Persisting `storageMode` on `CredentialRef` — rejected for this slice; belongs on Connection in CF-5 (FR-17).
- OS-11: OpenClaw `openClawGatewayCredentialId` and unrelated dirty-tree WIP.
- OS-12: Public `getSecret(ref)` — forbidden by CF-0.
