# SecretProvider and Import Contract

## Separation

`SecretProvider` resolves/stores provider-owned references. `CredentialImporter` discovers candidates from a source and converts them into a provider-neutral import plan. Neither interface is a renderer API.

```ts
export interface SecretProvider {
  readonly id: string
  readonly definition: IntegrationDefinition
  discoverAccount(input: AccountDiscoveryInput): Promise<ExternalAccount>
  inspect(ref: CredentialRef): Promise<ProviderCredentialMetadata>
  resolveForLease(input: ProviderLeaseInput): Promise<ProviderMaterialization>
  write(input: ProviderWriteInput): Promise<CredentialVersion>
  revoke(input: ProviderRevokeInput): Promise<void>
  rotate(input: ProviderRotateInput): Promise<CredentialVersion>
  health(input: ProviderHealthInput): Promise<HealthCheck>
}

export interface CredentialImporter {
  readonly id: string
  readonly sourceKind: string
  discover(input: ImportDiscoveryInput): Promise<ImportCandidate[]>
  preview(input: ImportPreviewInput): Promise<ImportPreview>
  validate(input: ImportValidationInput): Promise<ImportValidationResult>
  commit(input: ImportCommitInput): Promise<ImportCommitResult>
  rollback(input: ImportRollbackInput): Promise<void>
}

export interface ProviderCapabilities {
  readonly kinds: readonly CredentialKind[]
  readonly modes: readonly StorageMode[]
  readonly supportsRotation: boolean
  readonly supportsRevoke: boolean
  readonly supportsHealth: boolean
  readonly supportsVersioning: boolean
  readonly supportsReference: boolean
}
```

`ProviderMaterialization` is consumed only by `CredentialBroker`; it must not be serializable into renderer or WorkGraph responses.

## Capability matrix

| Provider | Profiles | reference | copy | mirror | managed | ephemeral | rotation | revoke | health | First phase |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Legacy/Local `credentials.enc` | local | yes | yes | no | no | yes | no | local-delete | local | migration only |
| macOS Keychain | local | yes | yes | no | no | yes | provider-dependent | provider-dependent | yes | P0 |
| Git credential helper | local | yes | copy | no | no | helper-dependent | no | helper-dependent | yes | P0 |
| Docker credential helper | local | yes | copy | no | no | helper-dependent | no | helper-dependent | yes | P0 |
| AWS shared profile/credential_process | local | yes | copy | no | no | yes | provider-dependent | provider-dependent | yes | P0 |
| Google ADC | local | yes | copy | no | no | yes | provider-dependent | provider-dependent | yes | P0 |
| SSH Agent | local | yes | no | no | no | yes | agent-managed | agent-managed | yes | P0 |
| Infisical | team/remote | yes | copy | mirror | managed by operator | yes | provider API | provider API | API | P1 |
| Vault/OpenBao | team/remote | yes | copy | mirror | operator-managed | yes | provider API | provider API | API | P1 |
| 1Password/Bitwarden | external | yes | copy | optional | no | yes | provider API | provider API | API | P1 |
| Browser session | local/external | provider-specific | no | no | no | isolated only | provider-specific | provider-specific | yes | P2 opt-in |

The matrix is a capability declaration, not permission. A connection still requires explicit grants and policy.

## Infisical adapter policy

Infisical is an optional `SecretProvider` for team/remote use cases. The adapter uses the official REST API and machine identity authentication from a user-configured external/self-hosted instance. Craft stores an opaque provider locator (`projectId`, environment, path, key) and provider account metadata, not raw Infisical secrets in ROX data.

The adapter MUST NOT:

- embed Infisical Web UI;
- launch PostgreSQL/Redis on each desktop;
- replace Infisical's PostgreSQL/Redis;
- copy Infisical's project/identity/secret tables into ROX;
- treat Infisical as Craft Identity Center or WorkGraph authority.

Universal Auth client secrets are provider credentials and must enter via a trusted main/import flow, then be broker-held. Short-lived provider access tokens are lease material, not canonical credentials.

## External provenance gate

Before shipping the Infisical adapter, pin an exact upstream commit/repository URL and record file-level license provenance. The current upstream `LICENSE` states that content outside `ee/` is MIT subject to third-party licenses; the current `ee/LICENSE` lookup returned not-found, so enterprise boundary and trademark/redistribution terms remain a legal/repository evidence gate, not a resolved fact.
