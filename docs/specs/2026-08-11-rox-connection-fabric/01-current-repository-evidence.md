# Current Repository Evidence

## Status

Proposed evidence record. Paths and symbols below were read from the 2026-08-11 working tree. No code was changed for this specification.

## Existing primitives to reuse

| Surface | Evidence | Current role | Target role |
| --- | --- | --- | --- |
| Credential backend seam | `packages/shared/src/credentials/backends/types.ts:10-34` | Priority-ordered backend CRUD and list | Provider adapter seam; raw payload stays behind broker/provider boundary |
| Stored credential | `packages/shared/src/credentials/types.ts:101-152` | One overloaded raw `value` plus optional protocol fields | Legacy compatibility codec only; replace canonical model with versioned envelopes/codecs |
| Credential manager | `packages/shared/src/credentials/manager.ts:14-141` | Singleton manager; raw get/set/delete/list | Compatibility facade plus provider registry during migration; new consumers use broker leases |
| Encrypted local store | `packages/shared/src/credentials/backends/secure-storage.ts:4-24,112-190` | `credentials.enc`, AES-256-GCM, file CRUD | `LegacyLocalProvider`; add OS-wrapped DEK, quarantine, backup, and recovery |
| Identity metadata | `packages/core/src/platform/identity/types.ts:31-78` | `Profile`, `ServiceConnection`, `Entitlement`, opaque `credentialRef` | Extend connection metadata with provider/account/storage mode/grants/health references |
| Identity persistence | `packages/core/src/platform/identity/store.ts:1-21,88-138,205-246` | `identity.json`; secrets excluded from stored state | Continue metadata-only persistence; versioned migration required |
| Identity RPC | `packages/server-core/src/handlers/rpc/identity.ts:150-303` | Aggregates owned and read-only connections; currently accepts raw `credentialValue` | Replace raw credential input with provider-specific broker/import flow |
| WorkGraph kernel | `packages/server-core/src/workgraph/index.ts:101-220,234-466` | Local graph objects/relations/ledger; immutable digest ledger | Add metadata-only Connection graph relations and affected-closure queries |
| Native shell | `apps/electron/src/renderer/platform/WorkspaceSurfaceHost.tsx:9-38` | Composes rail/tabs/panel stack/inspector | Host Connections native surfaces |
| Navigation registry | `apps/electron/src/renderer/components/app-shell/nav-destinations.ts:41-139` | Single source for top-level destinations | Add `connections` entry once; no duplicate rail/link registry |
| Transport boundary | `apps/electron/src/preload/bootstrap.ts:52-170` | Routed local/remote RPC; TLS requirement for remote | Add capability-scoped Connection/Broker RPC; no secret-bearing renderer API |
| Main ownership | `apps/electron/src/main/index.ts:674-835` | Composes WorkGraph and registers RPC profiles | Compose broker/provider registry in trusted main/server-core boundary |

## Current gaps and weaknesses

1. `StoredCredential.value: string` conflates API keys, tokens, JSON bundles, AWS secrets, and service-account documents.
2. `CredentialBackend.get()` and `CredentialManager.get()` return full raw credentials; many consumers still call convenience getters directly. Examples include `packages/server-core/src/handlers/rpc/knowledge.ts:483-485`, `packages/server-core/src/handlers/rpc/plugin-bridge.ts:245-247`, `packages/server-core/src/handlers/rpc/llm-connections.ts:613-616`, `packages/shared/src/agent/pi-agent.ts:477-489,649-703`, and `packages/shared/src/agent/claude-agent.ts:893-896`.
3. `IdentityConnectArgs.credentialValue` crosses the RPC input boundary in `packages/server-core/src/handlers/rpc/identity.ts:37-43,164-201`; the target contract must accept an import/provider operation instead.
4. `SecureStorageBackend` derives the key from machine identity with a username/home fallback (`secure-storage.ts:66-99,320-348`) and deletes an unreadable/corrupt file (`secure-storage.ts:351-363`); this conflicts with required recovery semantics.
5. `IdentityStore.connect()` uses the connection id as the credential name (`identity/store.ts:205-246`); provider locators must be separate and replaceable.
6. WorkGraph schema includes relations and immutable ledger rows but currently lacks domain-level APIs for `Connection`, `AccessGrant`, `CredentialLease`, affected closure, or consumer revalidation.
7. The existing Workbench rollout contract deliberately does not open WorkGraph or add RPC (`docs/specs/2026-08-11-rox-workbench-pr2-surface-host.md:34-37,170-180`); Connections must preserve that authority split.
8. `apps/electron/src/main/index.ts:826-835` registers headless versus GUI handlers separately; remote/headless clients cannot implicitly gain local credential authority.

## Mainline versus local-only/spec state

The current mainline contains the WorkGraph foundation and renderer host, but their own records explicitly state that identity, encryption/recovery, migration, remote sync, and WorkGraph UI are outside those PRs (`docs/specs/2026-08-10-rox-workbench-architecture-convergence.md:548-564`). The Connection Fabric specification is therefore a new bounded program, not a claim that these capabilities already exist.

## Verification targets

- Contract tests prove no renderer/preload/RPC response contains raw payloads.
- Provider tests prove reference/copy/mirror/managed/ephemeral semantics and workspace/consumer scoping.
- Recovery tests preserve an unreadable legacy store in quarantine and prove atomic cutover.
- WorkGraph tests prove metadata-only writes, immutable audit rows, workspace isolation, closure determinism, and rollback.
- Main/preload routing tests prove local-only broker channels are not advertised to remote/headless clients unless explicitly capability-scoped.
