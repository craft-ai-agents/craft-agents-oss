# Local product-security slices — 2026-08-13 continue

No APPLY. No Gate 0. No `~/ROX` default flip.

## migrateNotes is LOCAL_ONLY

`knowledge:migrateNotes` imports a host vault into local Notes. It is no longer `REMOTE_ELIGIBLE`.

- `packages/shared/src/protocol/routing.ts`
- test: `knowledge P4.4 migrateNotes is LOCAL_ONLY`

## OwnedRootPolicy (partial)

| Export | Role |
|---|---|
| `getConfigDir()` | Resolves after boot; tests inject `setOwnedRootAdapter` |
| `CONFIG_DIR` | Eager snapshot kept for existing importers |
| `assertNotesImportPaths` | Relative source/destination fail before import |

Default owned state remains `~/.craft-agent`. Changing it to `~/ROX` still needs an owner pick.

`importNotes()` calls `assertNotesImportPaths` before format/FS work.

## CF-5 WorkGraph connections (partial)

Schema v2 stores Connection + bindings without payload columns. `revokeConnectionAndRevalidate` invalidates broker leases, revokes the provider copy, appends a metadata-only `connection-revoked` ledger row, then revalidates only that workspace.

```text
bun test packages/server-core/src/workgraph
# 18 pass / 0 fail
```

## CF-5 / CF-6.1

CF-5 WorkGraph connections, bindings, immutable audit, workspace-scoped closure, and revoke/revalidate are in tree. CF-6.1 adds LOCAL_ONLY list/get/create RPC. CF-6.2 enables the Workbench Connections rail, route, and native tabbed page. CF-6.3 lists metadata via `workgraph.listConnections` and rejects secret fields. CF-7.1 imports `GH_TOKEN`/`GITHUB_TOKEN`, brokers GitHub `/user` inside `perform`, then revoke kills unused leases. CF-7.2 previews/imports those tokens from the Connections Imports tab. CF-9.2 does the same for a local gitconfig helper path. CF-7.3 revokes a listed connection after confirm. Tests inject `fetch`/helper fill; they do not call api.github.com or spawn git. Legacy AppShell `links[]` stays unchanged.

## CF-4 broker (partial)

CF-4.1 in-process broker + CF-4.2 grant store / repair / delivery registry. Still no RPC, WorkGraph, or helper binaries.

| Surface | Role |
|---|---|
| `InProcessCredentialBroker` | deny-by-default leases; `perform` once; metadata audit |
| `JsonAccessGrantStore` | metadata-only grant file; secret fields fail closed |
| `selectDeliveryMechanism` | least-exposing pick; `env-legacy` opt-in only |
| `revalidateConsumer` | `ok` / `denied` / `repair_required` |

## Verification

```text
bun test packages/shared/src/protocol/__tests__/routing.test.ts
         packages/shared/src/config/__tests__/owned-root-policy.test.ts
         packages/server-core/src/knowledge/__tests__/notes-migration.test.ts
# 29 pass / 0 fail

bun test packages/shared/src/credentials
# 40 pass / 0 fail
cd packages/shared && bun run tsc --noEmit
```
