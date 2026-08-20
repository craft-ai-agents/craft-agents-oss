# ROX Notes: canonical root, consented imports, and fork boundary

- **Status:** Draft — product owner approved this design for implementation planning on 2026-08-10; implementation remains blocked pending formal security acceptance and release gates.
- **Date:** 2026-08-10
- **Author:** ROX desktop / Notes engineering
- **Scope owner:** ROX desktop / Notes engineering
- **Reviewers:** Product owner; security reviewer; release owner
- **Product decision:** The product owner approved this design, including the decision not to use raw OS symlinks, for creation of a separate implementation plan only. This does not authorize code changes, managed-engine distribution, or managed-engine start.
- **Related current design:** `docs/specs/2026-08-07-siyuan-integration/00-overview.md`, `07-connection-modes.md`, `08-licensing.md`, `g1-metrics.md`, `g2-decision-record.md`
- **Supersedes:** None. This document does not silently change the current G2 status.

## Context

ROX needs one user-owned, legible file hierarchy. The canonical content workspace is `~/ROX/Notes/`, not an opaque application-data directory and not PARA folders directly under `~/ROX`. The user-visible organization is PARA — Projects, Areas, Resources, Archive — plus Inbox, Daily Notes, and categorized Imports.

The current application instead derives global state from `CRAFT_CONFIG_DIR || ~/.craft-agent` at module evaluation (`packages/shared/src/config/paths.ts:17-19`). Default workspaces and Notes inherit that root (`packages/shared/src/workspaces/storage.ts:42,88-107`), while Notes RPCs fall back to `~/.craft-agent/workspaces/{workspaceId}/notes` (`packages/server-core/src/handlers/rpc/notes.ts:74-90`). Moving only one path would produce split state and incorrect write permissions.

Existing local Notes migration has bounded traversal, checkpointing, hashes, and atomic destination writes (`packages/server-core/src/knowledge/notes-migration.ts`), but generic local Sources are not a safe import model. A caller can register an arbitrary local path; generic indexing can persist source text and add it to agent context (`packages/server-core/src/sources/source-index.ts`; `packages/server-core/src/sessions/SessionManager.ts:4161-4166`). The current `knowledge:migrateNotes` channel is also remote-eligible despite accepting a local filesystem path (`packages/shared/src/protocol/routing.ts:495-496`; `packages/server-core/src/handlers/rpc/knowledge.ts:1620-1655`).

The selected future product direction is an AGPL-compatible ROX Notes fork, with a hidden local engine and native ROX UI. That direction does **not** authorize engine distribution today: G2 remains OPEN and G1 thresholds remain TBD (`g2-decision-record.md:1-33`; `g1-metrics.md:65-102`). This specification defines the required technical boundary and release evidence; it does not ship, vendor, download, or start a managed engine.

## Functional Requirements
Normative requirement index:

- FR-1: Canonical owned root
- FR-2: Visible Notes hierarchy
- FR-3: First-run discovery boundary
- FR-4: Per-source consent and provenance
- FR-5: Linked-source behavior
- FR-6: Materialized imports
- FR-7: Indexing and agent retrieval
- FR-8: Local ROX Notes engine boundary
- FR-9: AGPL-compatible release and update gate
- FR-10: Legacy migration
- FR-11: Product terminology and platform boundary


### FR-1: Canonical owned root

1. ROX MUST use `~/ROX` as the default owned root on macOS.
2. ROX MUST resolve all private ROX application state through one authoritative root policy before any module captures a config path.
3. The authoritative policy MUST map private application state to `~/ROX/.rox/` and visible canonical content to `~/ROX/Notes/`.
4. A fresh install MUST NOT create `~/.craft-agent`, `~/Library/Application Support/SiYuan`, `~/.config/siyuan`, or another ROX-owned data root as a fallback.
5. Explicit existing `Workspace.rootPath` and `WorkspaceConfig.notesPath` values MUST remain external user choices. ROX MUST NOT relocate, scan, or mutate them automatically.
6. All owned JSON/journal records MUST use the repository-native same-directory temporary-write-and-rename protocol (`packages/shared/src/utils/files.ts:1-58`).

### FR-2: Visible Notes hierarchy

On first creation, ROX MUST create exactly this owned hierarchy:

```text
~/ROX/
├── Notes/
│   ├── Projects/
│   ├── Areas/
│   ├── Resources/
│   ├── Archive/
│   ├── Inbox/
│   ├── Daily Notes/
│   └── Imports/
│       ├── CYN/
│       ├── Logseq/
│       ├── Obsidian/
│       ├── Agents/
│       ├── Browsers/
│       ├── Messengers/
│       └── Mail/
└── .rox/
    ├── engine/
    ├── consent/
    ├── discovery/
    ├── imports/
    ├── index/
    ├── snapshots/
    └── locks/
```

1. `Notes/` MUST be the default canonical Notes workspace.
2. `Projects/`, `Areas/`, `Resources/`, `Archive/`, `Inbox/`, and `Daily Notes/` MUST be user-visible folders, not virtual labels.
3. `Imports/` MUST be user-visible and contain its stable category folders even before any source is selected.

`RoxImportCategory` MUST resolve only through the exhaustive, immutable main-process `ROX_IMPORT_CATEGORY_FOLDERS` mapping defined in the API contracts. ROX MUST use the mapped `<category-folder>` rather than interpolate a category identifier into a visible path; unknown or unmapped categories MUST fail before any link, destination, provenance, or directory operation.
4. `.rox/` MUST NOT be shown as a Notes collection, added to ordinary Notes search, or become agent context.
5. ROX MUST create no user-visible Notes content, source record, imported file, release note, or generated note at first root initialization. It MAY atomically create only the private `.rox/root.json` root-policy record necessary to establish the owned canonical root; that record MUST contain no discovery, source, consent, import, index, or release state.

### FR-3: First-run discovery boundary

1. After the shell renders, ROX MAY perform the user-requested automatic **local metadata discovery** of supported known source classes: CYN/Logseq/Obsidian, agent sessions/workspaces from non-Craft connectors only, browser profiles/recent activity, messengers, and mail. Before any directory enumeration, candidate, ledger, or metadata record, Agents discovery MUST exclude the canonical configured legacy Craft state root (`CRAFT_CONFIG_DIR` when set, otherwise `~/.craft-agent`), every descendant, and every alias/reparse point resolving to either through no-follow stable-identity and canonical-containment checks; the exclusion check may inspect only metadata necessary to reject the root, never its contents. A CYN discovery is only a connector-specific bounded filesystem metadata inventory under this section; it MUST NOT invoke legacy-engine detection, connection, config/token access, process inspection, bootstrap, or start paths, and MUST NOT classify a candidate as an installed engine.
2. Discovery MUST be local-only. It MUST NOT issue a network request, invoke an external app, open a connection, access a credential backend, or send telemetry.
3. Discovery MUST NOT read source-file bytes. Its permitted observations are bounded directory entries and filesystem metadata necessary for the inventory: category, safe display label, entry name, file kind, byte count, modified time, and aggregate counts.
4. Discovery MUST reject or omit hidden paths, key material, credential stores, `.env` files, browser cookie databases, browser password stores, OAuth/token files, `.ssh`, keychain material, and all source types not explicitly supported by the category connector.
5. Discovery MUST cap one source root at 10,000 entries and depth 64. A bound breach MUST return `BOUND_EXCEEDED`, retain no partial candidate, and require a narrower user-selected root.
6. Absolute paths and source identity details MUST remain in private `.rox/discovery/` state. Only main-process-owned `RoxPrivateSourceIdentity` records may contain a canonical source root or stable platform identity; they MUST NOT be returned by a gateway or reach renderer, Notes, ordinary agent context, logs, telemetry, remote transports, or prompts. Those surfaces receive only opaque source IDs and safe labels.
7. Discovery output MUST NOT itself enable a source, create an OS link, copy a file, index content, or grant an agent filesystem capability.
8. The one-time post-render inventory is not source activation. `metadata` consent governs retaining and refreshing an individual candidate after that inventory; without it, ROX MUST not continue observing the candidate.
9. The full eligible-file metadata inventory MUST remain private and be paged only to the ROX Imports UI from the discovery ledger. Relative paths and names from that inventory MUST NOT enter Notes, generic Sources, logs, telemetry, remote transports, or agent prompts.
10. A full-source revocation MUST remove that source's private inventory, identity locator, pagination cursors, and index references; it MAY retain only a non-sensitive audit tombstone. A source-specific scope revocation MUST invalidate only the data and capabilities that scope controls.

### FR-4: Per-source consent and provenance

1. Every discovered or manually selected source MUST have a separate, explicit, revocable immutable `RoxConsentGrant` for each capability before ROX reads source bytes, creates a source link, copies a snapshot, indexes content, retrieves it for an agent, or sends an excerpt to a remote model backend.
2. Each grant MUST bind the authorized workspace, opaque source ID, canonical source identity and generation, exactly one permitted scope, destination category, UI actor/origin, issue time, expiry if any, and authorization generation.
3. Consent scopes MUST be independent: `metadata` (continued metadata refresh after the initial inventory), `open-external`, `snapshot`, `index`, `agent-retrieval`, and `agent-egress` (a separately visible authorization for a named remote model backend).
4. `snapshot` MUST NOT imply `index`, `agent-retrieval`, or `agent-egress`; `index` MUST NOT imply either retrieval scope; `agent-retrieval` MAY send excerpts only to a local backend unless a matching `agent-egress` grant is active.
5. Revoking one scope MUST atomically invalidate that scope's current authorization generation, cancel its active jobs, and prevent its next external read, index commit, cache hit, prompt dispatch, resumable materialization, or link resolution. A full-source revocation MUST additionally remove inventory, identity, cursors, and indexes while retaining only the minimum non-sensitive audit event needed to explain revocation.
6. Consent, provenance, revocation, and egress records MUST contain no credential value, file body, cookie, token, or prompt excerpt.
7. Only a main-process consent mediator may issue a grant, inspect a private candidate, enroll a manual source, open an external source, authorize egress, or resolve a materialized import preview. A `RoxDirectUserActionLease` is minted only in Electron main after it verifies a live direct action from the registered ROX shell; it is opaque, one-use, sender/workspace/surface/action/nonce-bound, expires no later than 60 seconds after minting, and is never caller-supplied. `REQUEST_USER_AUTHORIZATION`, `BEGIN_MANUAL_SOURCE_SELECTION`, `BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION`, and `OPEN_MATERIALIZED_PREVIEW` MUST consume that lease before acting. `REQUEST_USER_AUTHORIZATION` MUST open a main-process-owned confirmation for the named opaque source, source identity generation, action, and exact action-specific intent, then mint a one-use authorization that expires no later than 60 seconds after minting. `OPEN_MATERIALIZED_PREVIEW` MUST likewise consume a lease matching its exact source and preview action. A renderer-provided workspace ID, `clientId`, grant binding, agent tool, background task, other local webContents, and every remote caller MUST NOT be a consent authority.
8. `BEGIN_MANUAL_SOURCE_SELECTION` and `BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION` MUST run only in Electron main after consuming a verified direct-action lease from the registered ROX shell. The former invokes the native chooser for a requested category; the latter accepts only a known valid Craft Markdown root, fixes its category to `agents`, and records the closed private source kind `legacy-craft-markdown`. Each returns only a one-use opaque selection token plus a one-use enrollment authorization; both are bound to the sender, trusted workspace, category, selection, action, and nonce and expire no later than 60 seconds after minting. No raw absolute source locator may reach a renderer, preload, IPC payload, log, generic source record, consent/provenance/revocation/egress record, index, or prompt; it may exist only in private main-process memory and owner-only identity/journal state.
9. Enrollment consumes the selection token and enrollment authorization, validates its fixed category, canonical root, no-follow identity, bounds, sensitive-path exclusions, and, for `legacy-craft-markdown`, its known format, then creates an opaque discovery candidate before any consent can be granted. Existing raw-path folder chooser and migration callers MUST migrate to one of these opaque flows and MUST NOT remain as a fallback. A legacy Craft Markdown source is manual-only: after ordinary `snapshot` consent it materializes through the normal journal into `Notes/Imports/Agents/<workspace-import-namespace>/<sourceId>/`; it never becomes an unprovenanced direct Notes write.
10. A ROX source is the compound key `(workspaceId, sourceId)`. Discovery ledgers, candidates, pages, cursors, source records, grants, authority generations, revocations, journals, indexes, and tombstones MUST be logically and physically keyed by that pair; no source or authority record may be shared, overwritten, or revoked across workspaces.
11. Before every import or retrieval lookup can disclose a ledger, perform an external operation, use a cache or index, or dispatch a prompt, the main process MUST compare the persisted workspace ID with its trusted derived request or session context. A mismatch MUST fail as `WORKSPACE_FORBIDDEN` before disclosure or operation.
12. An `inspect-discovery` authorization authorizes exactly its first inventory page. The resulting `RoxDiscoveryCursor` is the only permitted continuation: it MUST be opaque, sender/workspace/source-identity-generation/authorization-expiry/sequence-bound, one-use, non-persisted, and expire no later than the consumed authorization's 60-second expiry. Each continuation consumes its cursor atomically and may issue only the next cursor for the same fixed private inventory; expiry, replay, identity change, revocation, sender/workspace mismatch, or any request to access another source MUST fail before disclosure and require a new direct inspection confirmation. A cursor grants no consent or authority beyond that inventory page chain.

### FR-5: Linked-source behavior

1. `Imports/<category-folder>/` MUST present a stable user-visible source entry after `open-external` consent.
2. ROX MUST NOT create POSIX symlinks, Finder aliases, junctions, or another filesystem indirection that the ROX process later dereferences.
3. A linked-source entry MUST be backed by an owner-only, main-process `RoxImportRecord` and its `(workspaceId, sourceId)` lookup into the private discovery identity ledger; its visible/IPC projection is `RoxImportSummary` with only an opaque ID, safe display label, consent state, category, and safe identity state, never an identity fingerprint. It MAY open the external location only through an explicit local UI action.
4. Before every permitted source operation, ROX MUST validate the stored canonical root and stable identity. Any changed identity, reparse point, symlink, parent substitution, or invalid containment MUST fail closed as `SOURCE_UNAVAILABLE`.
5. A failed link validation MUST NOT read external bytes, write an import checkpoint, or silently relink to a replacement path.

### FR-6: Materialized imports

1. A source may be materialized only after `snapshot` consent.
2. Materialization MUST copy into the selected `Notes/Imports/<category-folder>/<workspace-import-namespace>/<opaque-source-id>/` destination. `workspace-import-namespace` MUST be a globally unique, opaque, portable storage identifier assigned by the main process to exactly one trusted workspace; it MUST NOT derive from a user-visible workspace name or renderer input. Both path components MUST be verified safe before every destination operation. ROX MUST NOT rename, modify, or delete the source.
3. Materialization MUST apply bounded traversal, maximum note/assets/bytes limits, portable relative-path validation, hashes, resumable checkpoints, and atomic destination creation. Before any destination write, it MUST consume each eligible object's complete bytes through a bounded, deterministic, versioned local sensitive-content policy. If that policy classifies an object as containing credential, secret, cookie, or token material, ROX MUST reject the entire object as `SENSITIVE_CONTENT`; it MUST NOT redact or partially materialize it, and no matched value may enter a destination, journal, index, preview, retrieval result, egress payload, log, or error. The minimum policy corpus MUST cover private-key blocks, bearer/OAuth authorization values, browser-cookie serializations, secret-named environment/config assignments, and supported provider API-key formats. The current Notes migration primitives are the implementation precedent, not an authorization boundary.
4. Materialization MUST reject source-root symlinks, child symlinks, unsafe relative paths, duplicate target replacement, path traversal, and identity swaps. Any failure leaves the source as non-materialized or incomplete; it MUST NOT report success.
5. Imported source text remains untrusted data. A materialized source MUST include provenance sufficient to identify its category ID, fixed category folder, source ID, snapshot time, and consent grant ID without exposing an external absolute path in ordinary Notes content.
6. All materialized-import rendering MUST use a dedicated `RoxImportRenderPolicy` and untrusted-import component. It MUST render raw HTML and every file-, URL-, embed-, or preview-loading directive as inert text and MUST NOT invoke generic file IPC, `onReadFile*`, shell open, or network-capable rendering from imported content. The sole resolver is a main-created, source-scoped no-follow rendering capability bound to the verified workspace, source, destination, identity/authorization generation, and portable relative path; it has no generic filesystem callback, shell, network, or agent-context authority.
7. A separately user-initiated `openMaterializedPreview` MAY resolve only a portable relative path below that source's verified materialized destination through the source-scoped no-follow rendering capability. It MUST reject absolute paths, `file:` URLs, every other URI scheme, traversal, links, source identity or authority changes, and crossings into another import, `Notes/`, `.rox/`, or the home directory. It returns only an untrusted-import render model, never a path, file handle, or generic read capability.

### FR-7: Indexing and agent retrieval

1. Discovery and `open-external` consent MUST produce no content index.
2. ROX MUST NOT reuse generic `local` Source registration, its current SQLite index, generic source retrieval, or a generic prompt formatter as the authority or retrieval path for a ROX import.
3. `index` consent MUST be separate from all other consent scopes and may index only materialized owned files from the source's approved destination.
4. Indexing MUST exclude `.rox/`, all hidden/sensitive paths, revoked sources, and unapproved categories.
5. `agent-retrieval` consent MUST be separate from indexing. The sole local-only `retrieveForLocalAgent` service MUST validate the current source identity and authorization generations for both scopes, session/backend context, provenance filtering, and token limits; it MUST return structured excerpts with an `untrusted` trust level, never a system/developer instruction string.
6. Imported excerpts MAY leave the process only through a separately visible, source-scoped `agent-egress` grant bound to the selected remote provider/backend and its immutable `backendIdentityFingerprint`. That fingerprint MUST be a stable hash computed without persisting a raw URL from the canonical effective remote provider/origin, endpoint identity, transport protocol, selected model, and configuration generation. The trusted configuration generation MUST advance atomically whenever any effective destination input changes. The sole remote operation, `dispatchRemoteImportedExcerpts`, MUST resolve that trusted configuration, revalidate the source and egress authority generations, recompute and exactly compare the fingerprint, serialize the bounded prompt, and hand it directly to the exact provider dispatch in one main-process transaction. It MUST return no excerpt or prompt segment to a caller.
7. Materialized import data is never an agent-accessible workspace filesystem capability. No agent, planner, task/subagent, direct tool, tool registry/MCP handler, attachment processor, shell, script, document converter, or nested LLM may obtain an import's bytes, relative or absolute path, source ID, inventory, metadata, or provenance through direct filesystem access. A direct target MUST fail as `LOCAL_ONLY` before byte read, directory enumeration, converter launch, subprocess launch, tool-result construction, session persistence, log/event emission, renderer/remote-client serialization, or prompt delivery; a broad enumeration, search, or watch MUST omit an import-provenanced candidate before it is emitted. This is independent of backend, permission mode (`safe`, `ask`, or `allow-all`), user approval, tool alias, and whether the session uses a local or remote model. Only `retrieveForLocalAgent`, `dispatchRemoteImportedExcerpts`, and the separately user-activated local `OPEN_MATERIALIZED_PREVIEW` flow may consume import content through their respective source-scoped capabilities.
8. A trusted main-process `RoxImportToolFence` MUST make that decision before `shouldAllowToolInMode`, any permission/approval bypass, source activation/retry, handler dispatch, input transform, attachment read, or prompt build at every tool ingress. It MUST use the paired owner record and a no-follow canonical resolver rather than a renderer-, model-, or tool-supplied assertion. It MUST cover every declared filesystem operand, including `Read`, `Glob`, `Grep`, `Find`, `Ls`, write/edit paths, archive/image/document inputs, and `call_llm`/`mcp__session__call_llm` attachments. Shell commands and arbitrary script code MUST instead run with a filesystem sandbox that makes every `Notes/Imports/` subtree unavailable; recognizing `cat`-like command strings or validating only declared script input files is insufficient.
9. The same fence MUST be applied to all executor and result boundaries, including the shared Claude/Pi pre-tool pipeline, OMP host-tool dispatch, session-tool/MCP dispatch, native Pi tool execution, nested `processAttachment`, and script sandbox. It MUST also fail closed before any raw tool result can enter a provider request/history, mini-model summarizer, `host_tool_result`, session journal, renderer event, callback, queue, or external transport. Result enforcement MUST carry trusted executor provenance/capability state; it MUST NOT infer safety by scanning arbitrary result text. This result fence is defense in depth and never makes a missed pre-execution check permissible.
10. `SessionManager` and every agent/planner path MUST select either `retrieveForLocalAgent` for a local backend or `dispatchRemoteImportedExcerpts` for a remote backend rather than direct generic-index retrieval or a retrieve→format→dispatch split. Imported text MUST NOT be assembled into a prompt outside those services' structured untrusted-data envelope or sealed remote transaction.
11. Revoking `index`, `agent-retrieval`, or `agent-egress` MUST remove the corresponding future path before the next agent prompt is assembled. Already dispatched remote prompts cannot be recalled, but no further dispatch may occur after revocation.

### FR-8: Local ROX Notes engine boundary

1. ROX MUST own the user-facing shell, navigation, workspace selection, permissions, agent runtime, themes, and Imports UI.
2. The future engine MUST be a hidden local `rox-notes-engine` process with a narrow local-only bridge. It MUST NOT introduce a second application shell, cloud account, sync service, marketplace, plugin/Bazaar surface, model settings, or agent chat.
3. ROX MUST use user-visible terminology `ROX`, `Notes`, and `Brain`. Legacy engine naming may remain only in legally required notices, source attribution, and fork provenance.
4. The engine persistence model MUST route all engine configuration, locks, caches, temporary state, and Electron/desktop process state beneath `~/ROX/.rox/engine/`. Routing only `--workspace` to `~/ROX/Notes` is insufficient because upstream state otherwise remains outside the workspace.
5. ROX MUST NOT discover, probe, read tokens from, attach to, or auto-start an upstream user installation as a fallback. This prohibition does not include FR-3's connector-specific, bounded, metadata-only CYN import inventory, which MUST NOT use an engine detection, connection, configuration, token, process, bootstrap, or start path and MUST NOT establish an engine relationship.
6. In v1, managed engine distribution and start MUST remain disabled until FR-9's release gate is accepted and verified.
7. Until the release gate accepts a future ROX engine, the implementation MUST remove or hard-disable every upstream connection probe, bootstrap/start control, associated settings surface, renderer hook, RPC/preload/type mapping, and lifecycle handler. Startup MUST make no legacy engine network, filesystem, token, process, or UI call.

### FR-9: AGPL-compatible release and update gate

1. The selected future strategy is a ROX-owned, AGPL-compatible source fork. This is an engineering direction, not legal advice or present distribution authorization.
2. Before any release carries a managed engine, the release owner MUST publish immutable, hash-addressed artifacts for:
   - the exact Corresponding Source archive;
   - upstream revision and every local patch digest;
   - AGPL-3.0 text, ROX/engine NOTICE, and third-party inventory;
   - Source Offer;
   - SBOM or equivalent declared inventory;
   - release manifest with artifact hashes, source revision, legal-file hashes, and immutable URLs;
   - channel-compatibility evidence; and
   - tested rollback evidence.
3. A versioned `RoxEngineReleaseAuthorization` MUST be signed by a release key whose public key and key ID are compiled into the desktop release verifier. It MUST bind an exact candidate `RoxReleaseArtifactDescriptor`, a required canonical semantic `minimumVersion`, a complete immutable `authorizedRollback` descriptor, and an immutable owner-approved `RoxReleaseApprovalAnchor`. Candidate and rollback descriptors MUST each bind canonical engine version, engine revision, source-archive, artifact, legal-bundle, and provenance-manifest hashes, plus channel. The owner-approval signature, verified with its pinned owner key, MUST cover a versioned domain-separated canonical payload containing the canonical `candidateDescriptorSha256`, canonical `authorizedRollbackDescriptorSha256`, canonical `minimumVersion`, exact candidate source-artifact SHA-256, approval-evidence SHA-256, and approved G1/G2 decision SHA-256; the gate MUST recompute both descriptor hashes, require the source-artifact value to equal `candidate.sourceArchiveSha256`, verify the owner signature, then verify the release signature over the complete authorization. The approval anchor's owner identity/signature, approved G1/G2 decision digest, descriptor hashes, version floor, source-artifact SHA-256, approval-evidence SHA-256, candidate/rollback descriptors, and release authorization MUST be immutable and internally consistent.
4. One fail-closed release-gate verifier MUST validate that authorization and approval anchor before package inclusion, publication, latest-channel promotion, download, extraction, activation, recovery, and every managed spawn. The desktop artifact, release page, installer, and updater metadata MUST contain or link to the same Source Offer and immutable source artifact.
5. ROX release/update logic MUST resolve only ROX-owned artifact origins. It MUST NOT retain a fallback to Craft, SiYuan, an upstream engine updater, or an upstream sync endpoint.
6. A mutable `latest` pointer MUST NOT be promoted until immutable artifacts, source archive, legal bundle, integrity manifest, signed authorization, verified owner approval anchor, and rollback anchor already exist and verify.
7. A managed engine update MUST create a restorable pre-update snapshot, retain the prior verified engine, health-check the new engine before activation, and restore the previous state on failure only when the signed authorization's exact `authorizedRollback` descriptor and approval anchor still verify; a same-version artifact with any different descriptor hash is not an authorized rollback.
8. Current G2/G1 records remain binding until revised through their own approved decision process. If the authorization is absent, invalid, untrusted, or mismatched, the current unconditional managed-mode denial remains in force. No source, binary, vendor tree, downloader, installer payload, auto-update payload, or managed spawn is allowed merely because this specification exists.

### FR-10: Legacy migration

1. A raw remote filesystem path MUST be rejected before any filesystem operation.
2. Workspace authority MUST derive from the trusted request context, not a caller-provided workspace ID.
3. All discovery, consent, materialization, index, revoke, preview, local retrieval, and remote-dispatch paths MUST be `LOCAL_ONLY`.
4. User authorization MUST derive from a verified Electron-main direct action and main-owned confirmation, not a caller-provided workspace ID, `clientId`, path, opaque token, agent tool, or browser gesture claim.
5. ROX MUST preserve the current user-owned legacy source until a user explicitly chooses it through `BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION`; only the `legacy-craft-markdown-v1` format is eligible. It is recorded privately as source kind `legacy-craft-markdown` and fixed to the existing `Agents` import category, requires ordinary consent before source bytes are read, and materializes only under `Notes/Imports/Agents/`. The implementation MAY reuse current traversal/hash/checkpoint mechanics, but MUST NOT reuse `notes-migration.ts`'s raw `sourceRoot`/`destinationRoot` map schema or write `.craft/notes-migration-map.json`; all ROX state remains under `.rox/`.
6. `RPC_CHANNELS.knowledge.MIGRATE_NOTES` has no compatibility residence in the ROX cutover. The implementation MUST remove it from channel declarations, `REMOTE_ELIGIBLE_CHANNELS`, Electron channel maps/preload API/`ElectronAPI` types, remote routing, and server handlers; it MUST remove public raw `MigrateNotesArgs`/`MigrateNotesResult` fields and legacy map state that expose `sourceRoot`, `destinationRoot`, or `mapPath`. No alias, redirect, or unknown legacy invocation may serialize or invoke a raw source or destination locator; it MUST fail locally before a connection, remote dispatch, or filesystem operation.
7. Electron main's `LegacyCraftMarkdownValidator` MUST be the sole recognizer for `legacy-craft-markdown-v1`; it MUST NOT accept a renderer/caller `format` claim. Before consent, it may perform only a bounded no-follow metadata scan: the selected canonical root must be a regular directory under the chooser's verified identity, contain at least one non-hidden regular `.md` entry, and contain no followed alias/reparse-point/unsafe/sensitive object; `assets/` and `templates/` have only their documented bounded roles. The predicate recognizes a portable Markdown vault layout, not proof of Craft authorship; user selection is the sole provenance assertion. After `snapshot` consent and before copy, each selected note MUST be a regular no-follow UTF-8 `.md` file and every referenced asset MUST meet the same bounded safe-object rules; a mismatch fails `UNSUPPORTED_SOURCE` before destination write. No byte is read to establish eligibility before consent.

### FR-11: Product terminology and platform boundary

1. User-facing navigation, settings, empty states, errors, deep links, stable surface keys, release metadata, package identity, app ID, icon assets, installer copy, and localization MUST complete the ROX/Notes rebrand together.
2. Compatibility aliases that expose the old product identity in user-visible behavior MUST NOT survive the cutover.
3. The managed-engine release target is macOS-first. Linux and Windows MUST show a neutral manual-folder/unsupported-state experience until their independent engine/release support is approved.

## Non-Functional Requirements

### NFR-1: Authorization and locality

- Every `RoxImportGateway` operation, including `BEGIN_MANUAL_SOURCE_SELECTION`, `BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION`, `REQUEST_USER_AUTHORIZATION`, `OPEN_MATERIALIZED_PREVIEW`, and `LIST_SOURCES`, MUST be `LOCAL_ONLY`.
- A raw remote filesystem path or renderer/preload-provided source path MUST be rejected before any filesystem operation.
- Workspace authority MUST derive from the trusted request context, not a caller-provided workspace ID.
- Every ROX Imports operation MUST have a concrete `RPC_CHANNELS.roxImports.*` entry, an Electron channel-map/preload mapping, a local handler registration, and membership in `LOCAL_ONLY_CHANNELS`; `RoutedClient`, preload/bootstrap, and every thin-client `WsRpcClient` path MUST omit or reject every `roxImports` operation before a remote invoke, connection, or dispatch. Independently, every remote/headless `WsRpcServer` receive path MUST reject every `LOCAL_ONLY`/`roxImports` channel before handler lookup, argument deserialization, workspace derivation, or handler invocation; the implementation MUST NOT rely on client routing as the authority boundary. `LIST_SOURCES` MUST return only the workspace-scoped persisted safe `RoxImportSummary` projection and MUST NOT rescan a source. `RoxAgentRetrievalGateway` is an in-process trusted-session service, not an Electron IPC endpoint.
- `LOCAL_ONLY` is transport classification, not consent authority. The main process MUST derive workspace and sender identity from the registered ROX shell; it MUST reject forged client IDs, unregistered frames/webContents, agent-facing IPC callers, and local non-shell callers before discovery-ledger disclosure or source operation. Electron main alone may mint a direct-action lease from a verified current user action; a renderer may never mint, extend, or substitute one.

### NFR-2: Filesystem integrity

- Every ROX-owned path MUST be canonicalized and contained beneath the expected owned root.
- Source and destination traversal MUST use no-follow stable-identity checks or a platform-equivalent descriptor protocol.
- A deterministic post-validation replacement race MUST fail with no external read/write and no successful completion record.

### NFR-3: Privacy

- Discovery data, consent grants/revocations, source identities, and import journals MUST remain local beneath `.rox/`.
- On platforms with POSIX permissions, `.rox/` directories MUST be owner-only and files containing source identity, consent, or inventory metadata MUST be owner-read/write only; an ownership or permission mismatch MUST fail closed.
- No discovery or import metadata may reach remote clients, telemetry, generic source stores, or prompts without an explicit separately authorized pathway.
- Generic `notes:read`, `notes:list`, `notes:search`, `notes:watch`, generic source-index, and every remote/thin-client Notes projection MUST treat `Notes/Imports/` and every import-provenanced `NoteDocument` as non-exportable. A remote/headless request MUST fail as `LOCAL_ONLY` before source content load, index lookup, serialization, or response; list, search, watch, and generic indexing MUST omit it rather than disclose a path, identifier, provenance, metadata, or content. A local renderer may open import-provenanced content only through `OPEN_MATERIALIZED_PREVIEW` with its exact main-created preview capability and render policy; ordinary non-import Notes retain their existing routes.
- Credentials, secret material, cookies, and token values MUST never enter ROX import records, logs, Notes, indexes, or prompts.
- User-provided input, renderer/preload data, persisted external documents, external identities, and remote model output are untrusted. Imported content MUST be rendered only through `RoxImportRenderPolicy` and a main-created source-scoped no-follow rendering capability; it MUST NOT reach broad file IPC, shell-open, network-capable preview, source retrieval, or agent-context paths. All source identifiers, grants, selection/authorization/action-lease tokens, inventory cursors, and materialization ownership checks are opaque and sender/workspace/generation-bound. On platforms with POSIX permissions, `.rox/` directories MUST be owner-only and files containing source identities, consents, or inventory metadata MUST be owner-read/write only; an ownership or permission mismatch MUST fail closed.

### NFR-4: Bounded operation

- Per source: traversal entries <= 10,000, depth <= 64, notes <= 2,000, note bytes <= 2 MiB, assets <= 2,000, asset bytes <= 50 MiB, aggregate asset bytes <= 200 MiB.
- Over-limit sources MUST fail as `BOUND_EXCEEDED` without partial enabling, indexing, or completion state.
- A source mutation during an operation MUST fail as `SOURCE_CHANGED`; ROX MUST not silently use a new target.

### NFR-5: Resilience

- Owned records and consent transitions MUST be crash-safe and recoverable by atomic journal semantics.
- No source operation may mark a source `consented`, `materializing`, or `materialized`, or expose a scope in `activeScopes`, until its consent, identity, and destination conditions are validated.
- A failed engine/release update MUST preserve the currently working engine and the last verified ROX state. Every release gate, including recovery and managed spawn, MUST revalidate the release signature, the pinned-owner signature over the versioned domain-separated canonical approval payload, recomputed candidate and `authorizedRollback` descriptor hashes, the canonical minimum version, exact source-artifact and approval-evidence SHA-256 values, exact rollback artifact identity, and their required equality bindings; any failure leaves the prior verified engine or disabled state intact.

### NFR-6: Accessibility and localization

- The UI MUST express category, consent scope, source state, and error state in text in addition to color.
- All user-visible strings MUST use the repository `t()` localization convention and retain parity across supported locales.

## Acceptance Criteria

### AC-1: Fresh owned hierarchy (FR-1, FR-2)

**Given** a clean macOS home without a ROX root, **when** ROX initializes, **then** it creates exactly the required `~/ROX/Notes/...` and `~/ROX/.rox/...` directories and no Notes content, import records, generic source records, or legacy application root.

### AC-2: Default Notes root (FR-1, FR-2)

**Given** a newly created personal workspace with no explicit `notesPath`, **when** Notes saves a document, **then** the document resolves beneath `~/ROX/Notes/` and no fallback uses `.craft-agent/workspaces/{id}/notes`.

### AC-3: External-root preservation (FR-1, FR-10)

**Given** a workspace with an explicit external `rootPath` or `notesPath`, **when** ROX upgrades, **then** ROX does not relocate, scan, or mutate it until the user selects a specific migration action.

### AC-4: Metadata-only automatic discovery (FR-3)

**Given** an initialized ROX root, **when** the post-render local discovery runs and the user directly authorizes inventory inspection, **then** it writes only bounded supported-source metadata and a private filtered inventory that is paged solely to ROX Imports UI. Before enumeration, automatic Agents discovery excludes the canonical `CRAFT_CONFIG_DIR` (or `~/.craft-agent` when unset), every descendant, and all no-follow stable-identity/canonical aliases. The first page consumes the inspection authorization; each next page consumes and reissues only a sender/workspace/source/generation-bound cursor from that fixed inventory. It performs no network request, credential access, source-file byte read, index write, link creation, copy, or agent retrieval.

### AC-5: Sensitive-path exclusion (FR-3, NFR-3)

**Given** a supported candidate tree containing a hidden file, credential-like path, token store, cookie store, `.env`, or SSH material, **when** discovery runs, **then** no candidate row, private ledger value, index row, prompt block, or log reveals the excluded object.

### AC-6: Per-source consent isolation (FR-4)

**Given** two discovered sources, **when** the user grants `snapshot` only for the first, **then** the second remains unread and cannot be copied, linked, indexed, or retrieved.

### AC-7: Revocation (FR-4, FR-7)

**Given** an indexed source with `snapshot`, `index`, and `agent-retrieval` grants, **when** the user revokes only `agent-retrieval`, **then** snapshot and index retain only their stated authority, while retrieval, cache hits, and prompt assembly fail before a source byte read or prompt dispatch; when the user fully revokes the source, ROX additionally removes its inventory, cursors, identity locator, and index, retaining only a non-sensitive tombstone.

### AC-8: Local-only import authority (FR-4, NFR-1)

**Given** a raw remote request targeting any `roxImports` operation, **when** it reaches a remote/headless `WsRpcServer`, **then** that receive path rejects its `LOCAL_ONLY` channel before handler lookup, argument deserialization, workspace derivation, ledger disclosure, source stat/read, destination write, journal update, cache/index use, preview resolution, or prompt dispatch. **Given** a local import request with a caller-selected absolute source path, forged/replayed direct-action lease, chooser or consent authorization, unregistered local webContents/frame, agent-facing IPC caller, request-context/workspace mismatch, or the same opaque `sourceId` in two workspace contexts, **when** it targets a concrete `RPC_CHANNELS.roxImports.*` handler, **then** the handler reconstructs trusted sender/workspace context and rejects a mismatch as `WORKSPACE_FORBIDDEN` or `AUTHORIZATION_INVALID` before the same effects; grants and revocations for either compound `(workspaceId, sourceId)` remain independent.

### AC-9: Link substitution defense (FR-5, NFR-2)

**Given** a consented linked source, **when** its root, parent, or child is replaced with a symlink/alias or different identity after validation, **then** ROX reports `SOURCE_UNAVAILABLE` or `SOURCE_CHANGED`, reads no substituted content, and records no successful operation.

### AC-10: Safe materialization (FR-6, NFR-4)

**Given** a source with `snapshot` consent, **when** materialization completes within the limits, **then** copies exist only under the selected `Notes/Imports/<category-folder>/<workspace-import-namespace>/<opaque-source-id>/` destination, source files remain unmodified, and each resulting entry has a content hash and provenance record.
### AC-10a: Sensitive-content exclusion (FR-6, NFR-3)

**Given** an otherwise eligible visible source object containing credential, secret, cookie, or token material, **when** materialization runs, **then** it rejects the complete object as `SENSITIVE_CONTENT` before a destination write; no partial copy, journal entry containing the match, index row, preview, retrieval result, egress payload, log, or error exposes the matched value.


### AC-11: Index/prompt separation (FR-7)

**Given** a materialized source without `index` or `agent-retrieval` consent, **when** a user asks an agent a related question, **then** no source excerpt is indexed or inserted into the agent prompt.

### AC-12: Untrusted source behavior (FR-7)

**Given** a consented imported document containing adversarial instructions, **when** a local backend retrieves it, **then** `retrieveForLocalAgent` returns a provenance-labelled structured untrusted-data envelope and cannot grant tools, access another source, issue a network action, or cause a filesystem action without independent authorization. **Given** a remote backend, **then** the child can submit only an opaque `RoxRemoteImportDispatchRequest`; callers, formatters, generic provider clients, queues, callbacks, histories, retries, and provider adapters cannot obtain an envelope, source byte, prompt body, authority, endpoint, header, or credential. Only Electron-main may construct `RoxRemoteImportDispatchIntent`, bind a one-use body-digest authority, and send the matching sealed provider request.

### AC-13: No legacy engine escape (FR-8)

**Given** a device with an upstream CYN/SiYuan installation, **when** ROX starts, **then** ROX neither probes its data/config/token, invokes a legacy renderer hook or settings control, nor auto-starts it; a CYN candidate, if discovered, uses only FR-3's bounded metadata-only connector inventory and never an engine detection, connection, bootstrap, or start path. ROX uses only the future ROX engine boundary when that separately passes the release gate.

### AC-14: Release fail-closed (FR-9)

**Given** a release candidate with a missing, empty, malformed, unsigned, untrusted, noncanonical, or internally inconsistent required `minimumVersion`, candidate or `authorizedRollback` descriptor, descriptor canonicalization/domain tag, immutable owner approval anchor/payload, owner or release signature, candidate/rollback descriptor SHA-256, source-artifact SHA-256, approval-evidence SHA-256, or a mismatched candidate/rollback engine revision, source archive, artifact, legal bundle, provenance manifest, ROX-only origin, signed engine version, or approved G2/G1 decision digest, **when** package inclusion, packaging, publication, promotion, installer recovery, update, extraction, activation, or managed start is requested, **then** the sole release gate rejects it before artifact delivery, download, extraction, snapshot replacement, or spawn.

### AC-15: Update rollback (FR-9, NFR-5)

**Given** a verified old ROX engine and a candidate update that fails integrity, immutable approval-anchor verification, extraction, start, or health checks, **when** the update is attempted, **then** the previous engine and pre-update workspace snapshot remain usable and the new candidate is not activated; recovery may activate only the exact signed, anchor-verified `authorizedRollback` descriptor, and a same-version/different-hash artifact is rejected.

### AC-16: Full terminology cutover (FR-8, FR-11)

**Given** the ROX release surface, **when** users navigate Notes/Brain, restore a stable surface, read a local error, use an installer, or inspect updater metadata, **then** it uses ROX terminology and ROX-owned identities; only legal attribution retains historical engine names.

### AC-17: Accessible consent state (NFR-6)

**Given** a discovery or import source is shown in ROX, **when** its category, consent scope, identity state, or failure state changes, **then** the interface exposes the state in localized text as well as color and remains understandable without a visual-only cue.

### AC-18: macOS-first engine boundary (FR-11)

**Given** a future ROX release is opened on Linux or Windows before that platform's engine/release gate is approved, **when** the user opens Notes/Brain settings, **then** ROX presents a localized neutral manual-folder or unsupported state and does not download, discover, or start an engine.

### AC-19: Manual source enrollment and consent authority (FR-4, NFR-1)

**Given** a verified direct action from the registered ROX shell, **when** Electron main mints and consumes a one-use `RoxDirectUserActionLease` for `BEGIN_MANUAL_SOURCE_SELECTION` or `BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION`, **then** the native chooser returns only a one-use selection token and enrollment authorization bound to the sender, trusted workspace, category, selection/action, and nonce; the latter accepts only known Craft Markdown and fixes `agents`/`legacy-craft-markdown`. Every lease, selection, and authorization expires no later than 60 seconds after minting. No raw path reaches renderer or preload. **Given** a named opaque source/action/scope request, **when** `REQUEST_USER_AUTHORIZATION` consumes a direct-action lease and presents its main-owned confirmation, **then** it returns only a one-use, 60-second authorization bound to the exact source identity generation, action/scopes, sender/workspace, and nonce; raw paths, claims, synthetic gestures, stale/replayed tokens, wrong source/workspace/scope/action, and remote/local non-shell callers fail before chooser, inventory, authorization, source read, external open, materialization, index, preview, or egress.

### AC-20: Untrusted import rendering (FR-6, FR-7, NFR-3)

**Given** a materialized note containing `html-preview`, `markdown-preview`, datatable/spreadsheet, image, PDF, absolute-path, `file:`, traversal, symlink, or HTTP(S) directives, **when** Notes opens it, **then** the dedicated untrusted-import component renders all directives as inert text and causes zero generic file IPC, filesystem read, shell open, network call, path disclosure, or agent-context insertion. A separately initiated `openMaterializedPreview` may resolve only a regular no-follow file beneath the same verified import destination through its main-created source-scoped render capability and returns no path or generic read handle.

### AC-21: Agent retrieval and egress fence (FR-4, FR-7, NFR-3)

**Given** a source has `index` and `agent-retrieval` grants but no provider-bound `agent-egress` grant, **when** a session using a remote model asks for related content, **then** no imported byte, path, identity, or inventory metadata reaches that provider. With a valid matching egress grant, Electron main alone resolves the trusted destination and opaque source/turn references, creates `RoxRemoteImportDispatchIntent`, serializes one bounded provenance-labelled untrusted-data body, and binds `RoxRemoteImportDispatchAuthority` to the exact SHA-256 body digest, source/egress generations, provider/model/configuration/fingerprint, policy digest, nonce, and expiry. The authority is consumed durably before its single provider dispatch; it has no automatic retry, fallback, replay, redirect, or recovery dispatch. `retrieveForLocalAgent` remains the only operation that returns structured excerpts, while a remote child receives neither excerpts nor an authority. Direct generic-index, formatter, callback, queue, history/retry, result, child-provider, or generic provider-client paths return none.

**Given** a post-selection mutation of body bytes, endpoint, canonical effective provider/origin, transport, selected model, configuration generation, authority, source/egress generation, source selection, provenance commitment, or policy, **when** it occurs before terminal send, **then** digest or trusted-state comparison fails closed as `EGRESS_FORBIDDEN`, serializes zero imported bytes, emits only a non-sensitive audit result code, consumes the authority, and requires newly authorized direct egress. A retained backend ID, forged child intent/request, or chosen fallback does not weaken this check.

**Given** a local or remote-backed agent, planner, task/subagent, attachment, registry/MCP handler, OMP host tool, or script attempts a direct or broad filesystem operation that targets or could traverse a materialized `Notes/Imports/` subtree, **when** it invokes `Read`, `Glob`, `Grep`, `Find`, `Ls`, shell, converter, nested `call_llm`, or another filesystem-capable tool in any permission mode, **then** `RoxImportToolFence` blocks a direct target as `LOCAL_ONLY` or omits a broad import-provenanced candidate before byte read, execution, or result construction; the process sandbox denies arbitrary script reads. No import byte, path, source ID, provenance, inventory, or metadata reaches a tool transcript/history, mini-model, `host_tool_result`, session journal, renderer event, callback, queue, provider request, or remote transport other than the one sealed Electron-main transaction.

### AC-22: Scope-specific revocation fence (FR-4, FR-7, NFR-5)

**Given** a source with active `metadata`, `open-external`, `snapshot`, `index`, `agent-retrieval`, and `agent-egress` grants plus deterministic pre-operation barriers, **when** each scope is revoked independently, **then** only its corresponding refresh/page, external-open, source-read/copy, index/cache, retrieval, or remote-dispatch path is disabled at the final generation check; every unrelated active scope retains exactly its stated authority.

### AC-23: Workspace materialization isolation (FR-4, FR-6)

**Given** two trusted workspaces materialize sources with the same category and opaque source ID, **when** either materialization, preview, index, revocation, or cleanup runs, **then** each operation resolves only its own main-process-assigned `workspace-import-namespace`; it cannot collide with, overwrite, inspect, preview, index, revoke, or delete the other workspace's destination.

### AC-24: Manual legacy Craft Markdown migration (FR-4, FR-6, FR-10, NFR-1)

**Given** an explicit direct user action selecting a source whose main-process `legacy-craft-markdown-v1` metadata-only predicate passes, **when** it passes `BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION`, enrollment, and ordinary `snapshot` consent, **then** ROX materializes it only as a private `legacy-craft-markdown` source in `Notes/Imports/Agents/<workspace-import-namespace>/<sourceId>/` with normal provenance, bounds, hashes, UTF-8 Markdown validation, and `.rox/` journal state. A renderer/caller format claim, no eligible regular Markdown entry, malformed post-consent Markdown bytes, invalid format, cancel, expiry, replay, failure, or resume leaves source data untouched; no raw `sourceRoot`/`destinationRoot`, legacy `knowledge.migrateNotes` fallback, or `.craft/notes-migration-map.json` is created. **Given** any legacy `knowledge:MIGRATE_NOTES` invocation, **when** the ROX cutover is installed, **then** no declared/preload/remote/server route exists and it fails locally before connection, serialization, or filesystem access.

### AC-25: Import-provenanced Notes exposure fence (FR-4, FR-6, FR-7, NFR-1, NFR-3)

**Given** a materialized import under `Notes/Imports/` or an import-provenanced `NoteDocument`, **when** a remote/headless caller uses any generic `notes:read`, `notes:list`, `notes:search`, `notes:watch`, or generic source-index path, **then** it receives `LOCAL_ONLY` before a file/content load, index lookup, serialization, handler response, prompt dispatch, or disclosure of the path, source ID, provenance, metadata, or document body; list/search/watch/index results omit it. **Given** a local Notes open, **then** it reaches content only through `OPEN_MATERIALIZED_PREVIEW` with an exact main-created render policy and source-scoped preview capability; ordinary non-import Notes remain available through their existing routes.

## Edge Cases

- EC-1: **Condition:** `~/ROX` is a symlink, file, or inaccessible directory. **Required result:** Fail before creating state; do not fall back to another root.
- EC-2: **Condition:** `~/ROX/Notes` or `.rox` is replaced during initialization. **Required result:** Fail closed; leave no authoritative root record.
- EC-3: **Condition:** A supported location exists but exceeds discovery bounds. **Required result:** Return `BOUND_EXCEEDED`; no partial candidate or hidden recursive continuation.
- EC-4: **Condition:** A selected source disappears after consent. **Required result:** Mark only that source unavailable; retain no new source bytes; other sources remain unaffected.
- EC-5: **Condition:** A direct-action lease, chooser token, enrollment authorization, user authorization, or inventory cursor expires, is replayed, has the wrong sender/workspace/category/source generation/action/scope/nonce binding, contains a path claim, is presented outside its compound source workspace, or is used to continue a different/new/private inventory. **Required result:** Reject as `AUTHORIZATION_INVALID` or `WORKSPACE_FORBIDDEN` before private-ledger disclosure, source stat/read, index/materialization, external open, preview capability resolution, remote client invoke, cache/index use, or prompt dispatch; no next cursor is issued and a new direct local confirmation is required.
- EC-6: **Condition:** Materialization is interrupted after a destination write. **Required result:** Resume only from hash-verified pending checkpoint; never overwrite an existing user-edited destination.
- EC-7: **Condition:** A source contains unsupported, binary, oversized, or sensitive-content-classified data. **Required result:** Exclude the complete object, return a bounded non-sensitive failure (`SENSITIVE_CONTENT` for the latter), persist no matched value, and do not weaken limits.
- EC-8: **Condition:** A source contains hidden files or name-only sensitive paths. **Required result:** Exclude before creating a candidate, index, log, or visible import entry.
- EC-9: **Condition:** An imported document contains malicious instructions. **Required result:** Treat it as untrusted payload; no authority or tool scope changes.
- EC-10: **Condition:** Current Craft state exists but the user never starts migration. **Required result:** Leave it untouched; ROX operates from its own root.
- EC-11: **Condition:** The engine source/root is not legally releasable. **Required result:** Managed engine stays disabled; do not substitute an upstream installer/download path.
- EC-12: **Condition:** A release updater points to Craft/upstream origin. **Required result:** Fail release verification; do not ship a compatibility fallback.
- EC-13: **Condition:** Revocation occurs after an operation's initial authorization check but before source open/read, between copied files, before index/cache commit, before an inventory page returns, after local retrieval selection but before sealed provider handoff, or before prompt dispatch. **Required result:** The generation recheck fails; no later external read, completion, cache hit, page, remote handoff, or prompt is emitted.
- EC-14: **Condition:** A materialized note contains a source-controlled preview directive with an absolute path, `file:` URL, traversal, symlink, or HTTP(S) URL. **Required result:** The untrusted-import component renders it inert; `openMaterializedPreview` rejects it before issuing a source-scoped rendering capability, and no generic file IPC, filesystem read, shell-open, or network call occurs.
- EC-15: **Condition:** An agent uses a remote backend without an exact active `agent-egress` grant; a backend retains its configured ID while its canonical effective provider/origin, endpoint, transport, selected model, or configuration generation changes; an opaque child request is forged or cross-workspace; a source/retrieval/egress generation, source selection, provenance commitment, policy digest, authority nonce/expiry/consumption state, canonical body, endpoint, header, adapter, or destination is substituted after selection or authority issuance; a dispatch is replayed, retried, redirected, falls back, is canceled, fails transport, or crashes before/after its durable consumption point. **Required result:** The sealed Electron-main `dispatchRemoteImportedExcerpts` transaction recomputes every trusted value and `backendIdentityFingerprint` immediately before sealing and terminal send. Any mismatch or non-single-send condition returns `EGRESS_FORBIDDEN`, consumes/terminalizes the authority, emits only a non-sensitive audit code, sends zero imported bytes, paths, identity metadata, inventory, retrieval result, formatter input, callback value, queue payload, tool result, history/retry payload, renderer event, child/provider body, or generic provider-client request, and requires a new direct egress consent transaction.
- EC-16: **Condition:** A managed-engine action receives a self-consistent but unsigned authorization, unknown signer, absent/empty/malformed/incompatible/noncanonical/internally inconsistent required version floor, candidate or rollback descriptor, canonical descriptor encoding or domain tag, missing/mismatched immutable owner approval anchor/payload, owner signature, candidate/rollback descriptor SHA-256, source-artifact SHA-256, approval-evidence SHA-256, engine revision, artifact, legal, or provenance hash, G1/G2 digest, wrong channel, same-version/different-hash rollback, or unapproved downgrade. **Required result:** The release gate blocks package inclusion, download, extraction, activation, recovery, and spawn; the existing disabled state or prior verified engine remains intact.
- EC-17: **Condition:** The same opaque `sourceId` is independently authorized in two workspaces, then one workspace revokes it or presents it to the other workspace. **Required result:** The compound-key lookup rejects the cross-workspace request as `WORKSPACE_FORBIDDEN`; the revocation affects only its own `(workspaceId, sourceId)` records, cursors, indexes, journals, and tombstones. Unsafe, absent, or mismatched workspace materialization components remain rejected before destination creation or access.
- EC-18: **Condition:** Automatic Agents discovery encounters the configured legacy Craft root (`CRAFT_CONFIG_DIR` when set or `~/.craft-agent` otherwise), its descendant, or an alias/reparse point to either. **Required result:** Use only no-follow metadata to reject it before directory enumeration, candidate, ledger, or metadata record; do not fall back to legacy-agent scanning.
- EC-19: **Condition:** A user attempts legacy Craft Markdown migration with a renderer/caller format claim, no regular eligible Markdown entry, unsupported layout, malformed post-consent UTF-8 Markdown, canceled chooser, expired/replayed lease or selection, source swap, sensitive object, interrupted copy, an existing legacy `.craft/notes-migration-map.json`, or any `knowledge:MIGRATE_NOTES` invocation. **Required result:** Reject or resume only through the opaque `legacy-craft-markdown` source record and `.rox/` journal; do not read source bytes before consent or read/create the legacy map, do not retain a raw source/destination locator, and reject the retired legacy RPC locally before connection, remote dispatch, serialization, or filesystem access.
- EC-20: **Condition:** A remote/thin caller directly names, searches for, lists, watches, or indexes an import-provenanced note or a `Notes/Imports/` path through a generic Notes route. **Required result:** Reject as `LOCAL_ONLY` or omit it before source/index access, serialization, or response; return no path, source ID, provenance, metadata, or content and do not fall back to a generic renderer, file IPC, shell, network, or agent path.

## API Contracts

All contracts below are conceptual TypeScript interfaces. The implementation MUST use local-only transport and trusted request context; no method accepts a remote arbitrary filesystem path.

Network transport is deliberately absent: `POST /rox-import/*`, every other HTTP route, remote IPC, and the retired `knowledge:MIGRATE_NOTES` route MUST be rejected. The conceptual gateway names below are local Electron IPC channels only; ROX MUST remove rather than alias or redirect the former raw migration API.

```ts
type RoxImportCategory =
  | 'cyn'
  | 'logseq'
  | 'obsidian'
  | 'agents'
  | 'browsers'
  | 'messengers'
  | 'mail'

type RoxImportCategoryFolder =
  | 'CYN'
  | 'Logseq'
  | 'Obsidian'
  | 'Agents'
  | 'Browsers'
  | 'Messengers'
  | 'Mail'

const ROX_IMPORT_CATEGORY_FOLDERS: Readonly<Record<RoxImportCategory, RoxImportCategoryFolder>> = {
  cyn: 'CYN',
  logseq: 'Logseq',
  obsidian: 'Obsidian',
  agents: 'Agents',
  browsers: 'Browsers',
  messengers: 'Messengers',
  mail: 'Mail',
}
type RoxConsentScope =
  | 'metadata'
  | 'open-external'
  | 'snapshot'
  | 'index'
  | 'agent-retrieval'
  | 'agent-egress'

type RoxSourceState =
  | 'discovered'
  | 'consented'
  | 'materializing'
  | 'materialized'
  | 'unavailable'
  | 'revoked'
  | 'bound-exceeded'

type RoxDirectUserAction =
  | 'begin-manual-source-selection'
  | 'begin-legacy-craft-migration-selection'
  | 'request-user-authorization'
  | 'open-materialized-preview'

type RoxDirectUserActionLease = string & {
  readonly __brand: 'RoxDirectUserActionLease'
}

type RoxUserAuthorization = string & {
  readonly __brand: 'RoxUserAuthorization'
}

type RoxManualSourceSelection = string & {
  readonly __brand: 'RoxManualSourceSelection'
}

type RoxImportSourceKind = 'connector' | 'legacy-craft-markdown'
type RoxLegacyCraftMarkdownFormat = 'legacy-craft-markdown-v1'

type RoxUserAuthorizationAction =
  | 'enroll-manual-source'
  | 'inspect-discovery'
  | 'grant-consent'
  | 'revoke-consent'
  | 'open-external'

interface RoxManualSourceSelectionResult {
  selection: RoxManualSourceSelection // one-use; sender/workspace/category/nonce-bound; expires <= 60 seconds after minting
  authorization: RoxUserAuthorization // one-use enrollment authorization; expires <= 60 seconds after minting; never a path
}

type RoxAuthorizationRequest =
  | {
      action: 'inspect-discovery' | 'open-external'
      sourceId: string
      sourceIdentityGeneration: number
    }
  | {
      action: 'grant-consent'
      sourceId: string
      sourceIdentityGeneration: number
      grants: RoxConsentGrantRequest[] // nonempty; one exact request per independent scope
    }
  | {
      action: 'revoke-consent'
      sourceId: string
      sourceIdentityGeneration: number
      scopes?: RoxConsentScope[] // absent only for a full-source revocation; otherwise nonempty
    }

interface RoxRootPaths {
  root: string // ~/ROX; visible owned canonical root
  notesRoot: string // ~/ROX/Notes; canonical
  stateRoot: string // ~/ROX/.rox; canonical
}
interface RoxPrivateSourceIdentity {
  canonicalRoot: string // private owner-only locator in the discovery identity ledger only
  stableIdentity: string // private platform-stable identity; revalidated before source operations
  sourceKind: RoxImportSourceKind // private closed discriminator; never an arbitrary external-source kind
}


type RoxDiscoveryCursor = string & {
  readonly __brand: 'RoxDiscoveryCursor'
}

interface RoxDiscoveryInventoryEntry {
  relativePath: string // private, source-root-relative; excluded for hidden/sensitive paths
  kind: 'file' | 'directory'
  bytes?: number
  modifiedAt?: string
}

interface RoxDiscoveryInventoryPage {
  sourceId: string
  workspaceId: string
  sourceIdentityGeneration: number
  entries: RoxDiscoveryInventoryEntry[]
  nextCursor?: RoxDiscoveryCursor // one-use continuation bound to workspace/source/generation/sender/consumed authorization expiry/sequence
}

interface RoxDiscoveryCandidate {
  workspaceId: string // safe projection; never renderer authority
  sourceId: string // opaque within workspaceId
  category: RoxImportCategory
  displayLabel: string // safe label only
  metadata: {
    entryCount: number
    totalBytes: number
    newestModifiedAt?: string
  }
  state: Extract<RoxSourceState, 'discovered' | 'bound-exceeded'>
}

interface RoxEgressBinding {
  backendKind: 'remote-model'
  backendId: string // exact configured backend ID; no raw URL
  providerId: string
  modelId: string
  configurationGeneration: number // main-process-derived; advances atomically whenever an effective destination input changes
  backendIdentityFingerprint: string // stable hash of canonical effective provider/origin, endpoint identity, transport protocol, selected model, and configuration generation; no raw URL or credentials persist
}

interface RoxConsentGrantRequest {
  scope: RoxConsentScope
  egress?: RoxEgressBinding // required only for agent-egress
}

interface RoxConsentGrant {
  version: 1
  id: string
  workspaceId: string
  sourceId: string
  sourceIdentityFingerprint: string
  sourceIdentityGeneration: number
  category: RoxImportCategory
  scope: RoxConsentScope // exactly one independent authority
  egress?: RoxEgressBinding
  issuedAt: string
  expiresAt?: string
  authorizationGeneration: number // monotonically increases per source/scope; never resets
  actor: 'local-user'
  origin: 'rox-desktop'
}

interface RoxConsentRevocationEvent {
  version: 1
  id: string
  workspaceId: string
  sourceId: string
  grantId?: string // absent only for a full-source revocation
  scope?: RoxConsentScope
  invalidatedAuthorizationGeneration: number
  revokedAt: string
  actor: 'local-user'
  origin: 'rox-desktop'
}

interface RoxSourceRevocationTombstone {
  version: 1
  sourceId: string // opaque; no path, identity locator, hash, or inventory
  workspaceId: string
  revokedAt: string
  reason: 'user-requested'
}

interface RoxReleaseArtifactDescriptor {
  engineRevision: string
  engineVersion: string // canonical semantic version reported by the exact packaged engine
  sourceArchiveSha256: string
  artifactSha256: string
  legalBundleSha256: string
  provenanceManifestSha256: string
  channel: 'stable' | 'beta'
}

`canonicalSha256(descriptor)` is the SHA-256 of the UTF-8 RFC 8785 JSON Canonicalization Scheme serialization of exactly every `RoxReleaseArtifactDescriptor` field above, including `channel`. The owner-approval payload uses the same canonicalization, contains `version`, `domain`, `ownerApprovalKeyId`, and every non-signature anchor field, and is signed only for the exact domain `'rox-engine-owner-approval/v1'`; the release signature likewise covers the complete canonical `RoxEngineReleaseAuthorization` including that exact anchor and both descriptors.

interface RoxReleaseApprovalAnchor {
  version: 1
  domain: 'rox-engine-owner-approval/v1'
  ownerApprovalKeyId: string
  candidateDescriptorSha256: string // canonicalSha256(candidate)
  authorizedRollbackDescriptorSha256: string // canonicalSha256(authorizedRollback)
  minimumVersion: string // exact canonical authorization minimumVersion
  approvedG1G2DecisionSha256: string
  sourceArtifactSha256: string // must equal candidate.sourceArchiveSha256
  approvalEvidenceSha256: string
  ownerApprovalSignature: string // pinned owner key over this canonical payload excluding signature
}

interface RoxEngineReleaseAuthorization {
  version: 1
  signerKeyId: string
  candidate: RoxReleaseArtifactDescriptor
  minimumVersion: string // required, nonempty, canonical semantic version, and signature-covered
  authorizedRollback: RoxReleaseArtifactDescriptor // complete immutable descriptor, not a version-only reference
  approvalAnchor: RoxReleaseApprovalAnchor
  signature: string
}

interface RoxImportRecord {
  version: 1
  workspaceId: string
  workspaceImportNamespace: string // main-process-owned globally unique opaque portable path component
  sourceId: string
  category: RoxImportCategory
  sourceKind: RoxImportSourceKind // private; `legacy-craft-markdown` is valid only with category `agents`
  displayLabel: string
  state: RoxSourceState
  identityFingerprint: string
  identityGeneration: number
  destinationRelativePath?: string
  grantIds: string[]
  createdAt: string
  updatedAt: string
}

interface LocalWorkspaceContext {
  transport: 'local'
  workspaceId: string // main-process-derived; never caller authority
  sender: 'registered-rox-shell' // main-process-derived; not renderer input
}

interface RoxDirectActionContext extends LocalWorkspaceContext {
  directActionLease: RoxDirectUserActionLease // main-process-only, derived from an observed OS-originated input or native menu action
}

interface RoxTrustedLocalAgentContext {
  workspaceId: string // derived from the active trusted session
  sessionId: string
  backend: {
    kind: 'local-model'
    backendId: string // derived from the selected backend, never prompt input
  }
}

interface RoxTrustedRemoteAgentContext {
  workspaceId: string // derived from the active trusted session
  sessionId: string
  backend: {
    kind: 'remote-model'
    backendId: string
    providerId: string
    modelId: string
    configurationGeneration: number // main-process-derived current effective destination generation
    backendIdentityFingerprint: string // recomputed from the trusted canonical provider/origin, endpoint identity, protocol, model, and configuration generation immediately before sealed dispatch
  }
}

// Child processes can request only this opaque, main-owned turn/retrieval pair.
// They never receive an excerpt, prompt, provider body, authority, endpoint, or credential.
interface RoxRemoteImportDispatchRequest {
  sessionTurnRef: string // opaque; resolves only in Electron main to the immutable current turn snapshot
  retrievalRef: string // opaque, one-use, workspace/session/turn/source-generation-bound main-owned retrieval selection
}

// Electron-main-only input. No renderer, preload, agent child, remote RPC, or plugin can construct one.
interface RoxRemoteImportDispatchIntent {
  sessionId: string
  workspaceId: string
  providerId: string
  modelId: string
  configurationGeneration: number
  backendIdentityFingerprint: string
  sessionTurnRef: string
  excerptRefs: readonly string[] // opaque bounded references; source bytes remain main-only until sealing
  provenanceCommitment: string // SHA-256 of canonical source/generation/category/trust references
  policyDigest: string // SHA-256 of the versioned egress policy and all pre-dispatch authority generations
}

interface RoxRemoteImportDispatchAuthority {
  operationId: string // cryptographically random, one-use
  sessionId: string
  workspaceId: string
  providerId: string
  modelId: string
  configurationGeneration: number
  backendIdentityFingerprint: string
  provenanceCommitment: string
  policyDigest: string
  bodyDigest: string // SHA-256 of the single canonical wire-body string
  issuedAt: string
  expiresAt: string // no later than 60 seconds after issuance
  nonce: string
}

// Audit records contain no body, prompt, excerpt, URL, header, credential, or provider response.
type RoxRemoteEgressAuditResultCode =
  | 'DISPATCHED'
  | 'DENIED_AUTHORITY'
  | 'DENIED_BODY_MISMATCH'
  | 'DENIED_DESTINATION_CHANGED'
  | 'DENIED_EXPIRED_OR_REPLAYED'
  | 'DENIED_UNSUPPORTED_ADAPTER'
  | 'DENIED_TRANSPORT'
  | 'CONSUMED_WITHOUT_DISPATCH'

interface RoxRemoteImportDispatchResult {
  operationId: string
  status: 'dispatched' | 'denied'
  auditCode: RoxRemoteEgressAuditResultCode
  // Control-plane receipt only: never a tool result, managed message, renderer event,
  // history/retry payload, or container for provider completion or imported source data.
}

interface RoxRemoteImportEgressGateway {
  dispatch(intent: RoxRemoteImportDispatchIntent): Promise<RoxRemoteImportDispatchResult>
}

// Opaque at module boundaries. Its private closure holds the one canonical immutable
// body string; a provider adapter can only call send(), never inspect or modify bytes.
interface RoxSealedProviderRequest {
  readonly __brand: 'RoxSealedProviderRequest'
}

interface RoxSealedProviderAdapter {
  send(request: RoxSealedProviderRequest): Promise<RoxRemoteImportDispatchResult>
}


interface RoxUntrustedExcerpt {
  sourceId: string // scoped by the trusted local or remote session context
  sourceIdentityGeneration: number
  category: RoxImportCategory
  trust: 'untrusted'
  text: string
  tokenCount: number
}

type RoxImportPreviewCapability = string & {
  readonly __brand: 'RoxImportPreviewCapability'
}

interface RoxImportRenderPolicy {
  mode: 'untrusted-import'
  sourceId: string // workspace-scoped and main-derived
  sourceIdentityGeneration: number
  authorizationGeneration: number
  previewCapability: RoxImportPreviewCapability // opaque, source/path/generation-bound; no locator or generic file authority
}

interface RoxUntrustedImportRenderModel {
  policy: RoxImportRenderPolicy // main-derived from the materialized import record, never content/frontmatter/renderer-derived
  content: string
}

interface RoxImportSummary {
  sourceId: string // opaque within the sender-derived workspace
  category: RoxImportCategory
  displayLabel: string // safe label; never a locator or raw path
  state: RoxSourceState
  activeScopes: RoxConsentScope[]
  sourceIdentityGeneration: number // safe identity state; never an identity fingerprint
}

interface RoxImportGateway {
  discover(ctx: LocalWorkspaceContext): Promise<RoxDiscoveryCandidate[]>
  // RPC_CHANNELS.roxImports.BEGIN_MANUAL_SOURCE_SELECTION; Electron-main chooser only.
  beginManualSourceSelection(ctx: RoxDirectActionContext, input: {
    category: RoxImportCategory
  }): Promise<RoxManualSourceSelectionResult>
  // RPC_CHANNELS.roxImports.BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION; Electron-main chooser only.
  beginLegacyCraftMigrationSelection(ctx: RoxDirectActionContext): Promise<RoxManualSourceSelectionResult>
  // RPC_CHANNELS.roxImports.REQUEST_USER_AUTHORIZATION; Electron-main confirmation only.
  requestUserAuthorization(ctx: RoxDirectActionContext, input: RoxAuthorizationRequest): Promise<RoxUserAuthorization>
  // RPC_CHANNELS.roxImports.LIST_SOURCES; persisted safe state only, never a rescan.
  listSources(ctx: LocalWorkspaceContext): Promise<RoxImportSummary[]>
  enrollManualSource(ctx: LocalWorkspaceContext, input: {
    selection: RoxManualSourceSelection
    authorization: RoxUserAuthorization
  }): Promise<RoxDiscoveryCandidate>
  inspectDiscovery(ctx: LocalWorkspaceContext, input:
    | {
        sourceId: string
        authorization: RoxUserAuthorization // action must be inspect-discovery; consumed for first page
        limit?: number // implementation MUST cap at 200
      }
    | {
        cursor: RoxDiscoveryCursor // consumed and reissued only for the next page
        limit?: number // implementation MUST cap at 200
      }
  ): Promise<RoxDiscoveryInventoryPage>
  grantConsent(ctx: LocalWorkspaceContext, input: {
    sourceId: string
    grants: RoxConsentGrantRequest[]
    authorization: RoxUserAuthorization
  }): Promise<RoxConsentGrant[]>
  revokeConsent(ctx: LocalWorkspaceContext, input: {
    sourceId: string
    scopes?: RoxConsentScope[] // absent means full-source revocation
    authorization: RoxUserAuthorization
  }): Promise<RoxConsentRevocationEvent[]>
  openExternal(ctx: LocalWorkspaceContext, input: {
    sourceId: string
    authorization: RoxUserAuthorization
  }): Promise<void>
  // RPC_CHANNELS.roxImports.OPEN_MATERIALIZED_PREVIEW; specialized untrusted-import rendering only.
  openMaterializedPreview(ctx: RoxDirectActionContext, input: {
    previewCapability: RoxImportPreviewCapability // supplied only by a matching main-derived render policy
    relativePath: string // portable only; checked by the main-owned no-follow resolver
  }): Promise<RoxUntrustedImportRenderModel>
  materialize(ctx: LocalWorkspaceContext, input: {
    sourceId: string
  }): Promise<RoxImportSummary>
  index(ctx: LocalWorkspaceContext, input: {
    sourceId: string
  }): Promise<void>
}

interface RoxAgentRetrievalGateway {
  retrieveForLocalAgent(ctx: RoxTrustedLocalAgentContext, input: {
    query: string
    maxTokens: number
  }): Promise<RoxUntrustedExcerpt[]>
  // Electron-main-only. The agent child submits RoxRemoteImportDispatchRequest; main alone
  // constructs the typed intent, serializes one sealed provider body, and returns no excerpts.
  dispatchRemoteImportedExcerpts(
    ctx: RoxTrustedRemoteAgentContext,
    request: RoxRemoteImportDispatchRequest,
  ): Promise<RoxRemoteImportDispatchResult>
}

```

`RoxRemoteImportDispatchRequest` is the only cross-process request shape. Electron main resolves it to `RoxRemoteImportDispatchIntent` from the active trusted session and private retrieval ledger; every field in the intent is checked against that main-owned state, never trusted from a child. Before source-byte read, it atomically claims the matching one-use `(sessionTurnRef, retrievalRef)` selection; a missing, expired, replayed, cross-workspace, or already-claimed selection fails closed. The gateway then resolves the current canonical provider/origin, endpoint identity, transport protocol, selected model, and effective configuration immediately before sealing. It compares the recomputed fingerprint, configuration generation, source/retrieval/egress generations, opaque turn/retrieval bindings, bounds, provenance commitment, and policy digest before any excerpt byte is read.

`RoxRemoteImportDispatchIntent` and `RoxSealedProviderRequest` are conceptual types, not structural runtime capabilities. The implementation MUST mint them only inside a non-exported Electron-main factory backed by private fields or a module-private `WeakMap`; its terminal serializer MUST reject any object that was not minted by that factory. The intent/authority factory and dispatch-claim store are unavailable to preload, renderer, remote/headless server, plugin, generic provider, and child-process modules.

After its one-use selection claim, the gateway serializes the complete provider request exactly once as a canonical immutable string and calculates `bodyDigest`. It creates the random `operationId` at claim time and atomically/durably writes its body-bound terminal `consumed` authority record with exclusive-create semantics keyed by the canonical `(sessionTurnRef, retrievalRef)` claim before network I/O. An existing claim, failed durable write, or crash leaves the selection/operation terminally consumed. Immediately before its sole `fetch`, with no intervening `await`, callback, or mutable caller object, the terminal serializer revalidates the current canonical provider/origin, endpoint identity, transport, model, configuration/source/retrieval/egress generations, fingerprint, policy/provenance commitments, nonce/expiry/consumption state, and body digest. This is intentionally at-most-once: an expiry, mismatch, transport failure, redirect, cancellation, crash, or ambiguous result consumes the authority, records only a non-sensitive audit code, sends no fallback or automatic retry, and requires a new direct egress consent transaction. The terminal serializer snapshots endpoint, protocol, method, and headers from main-owned configuration, rejects redirects, and does not accept caller-provided URL, header, credential, callback, queue, or payload fields.

No generic `fetch`, provider client, `call_llm`, system-prompt formatter, history/retry serializer, callback, queue, or child-process environment may receive a ROX-import-provenanced request body. `RoxSealedProviderAdapter` receives only its opaque sealed request and returns the control-plane typed result; it cannot mutate the body, choose another destination/model, inject headers, initiate fallback, or surface a completion to a generic tool/result/history/renderer route. Any normal model-completion delivery remains a separately bounded main-session output path; it never carries the authority, request body, excerpt, source/provenance reference, endpoint, header, or credential and cannot seed a later remote-import dispatch. Unsupported provider forms fail closed as `EGRESS_FORBIDDEN`.

`RoxDirectUserActionLease`, `RoxUserAuthorization`, and `RoxManualSourceSelection` are opaque handles, never paths or browser-provided claims. Electron main may mint a direct-action lease only from an OS-originated input event it directly observes on the registered ROX shell or from a native menu action; it binds the observed webContents/frame, workspace, surface, exact `RoxDirectUserAction`, nonce, and expiry no later than 60 seconds after minting, and is consumed atomically. Every resulting selection or user authorization is likewise one-use and expires no later than 60 seconds after its minting. Renderer `userActivation`, client-ID, IPC, synthetic-event, or gesture claims MUST be rejected. `BEGIN_MANUAL_SOURCE_SELECTION` and `BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION` consume their corresponding lease, invoke the native chooser, and return only `RoxManualSourceSelectionResult`; the latter validates the known format and fixes `agents`/`legacy-craft-markdown`. The selected canonical path stays only in a private main-process in-memory record and MUST NOT reach renderer or preload. `REQUEST_USER_AUTHORIZATION` first consumes its corresponding lease, resolves the named opaque source in the trusted workspace, opens a main-process-owned confirmation for its source identity generation, action, and exact action-specific intent, then mints a one-use opaque authorization. `inspect-discovery` authorization is consumed by the first page only; subsequent pages require the one-use `RoxDiscoveryCursor` continuation model specified in FR-4.12, never a reusable authorization or cursor-only general ledger access.

The implementation MUST register exactly these local renderer channels: `RPC_CHANNELS.roxImports.DISCOVER`, `RPC_CHANNELS.roxImports.BEGIN_MANUAL_SOURCE_SELECTION`, `RPC_CHANNELS.roxImports.BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION`, `RPC_CHANNELS.roxImports.REQUEST_USER_AUTHORIZATION`, `RPC_CHANNELS.roxImports.ENROLL_MANUAL_SOURCE`, `RPC_CHANNELS.roxImports.LIST_SOURCES`, `RPC_CHANNELS.roxImports.INSPECT_DISCOVERY`, `RPC_CHANNELS.roxImports.GRANT_CONSENT`, `RPC_CHANNELS.roxImports.REVOKE_CONSENT`, `RPC_CHANNELS.roxImports.OPEN_EXTERNAL`, `RPC_CHANNELS.roxImports.OPEN_MATERIALIZED_PREVIEW`, `RPC_CHANNELS.roxImports.MATERIALIZE`, and `RPC_CHANNELS.roxImports.INDEX`. Each MUST be in `LOCAL_ONLY_CHANNELS`, the Electron channel map, preload allowlist, and a main-process handler; each handler MUST reconstruct `LocalWorkspaceContext` from the sender rather than accept it from the renderer. `RoutedClient` MUST reject all other `roxImports:*` names and all non-local dispatch before reaching a workspace client. Client-only preload/bootstrap, `buildClientApi`, and `WsRpcClient` construction MUST omit or locally fail every `LOCAL_ONLY`/`roxImports` operation before a remote invoke, connection, or serialization. `LIST_SOURCES` MUST provide restart-safe Imports UI only with the workspace-scoped persisted `RoxImportSummary` projection—opaque source ID, category, safe label, state, active scopes, and safe identity state—and MUST NOT rescan or disclose a locator, inventory, raw path, or source bytes. `RoxAgentRetrievalGateway` has no renderer, preload, RPC, remote-client, or provider-callback registration.
These channels MUST NOT be registered or dispatchable on any remote/headless `WsRpcServer`. `apps/electron/src/main/index.ts`, `packages/server/src/index.ts`, and `packages/server-core/src/handlers/rpc/index.ts` MUST use an explicit local-Electron versus remote/headless registration profile that excludes every `roxImports` handler from the latter; this exclusion is defense in depth, not a replacement for the receive-path fence. The generic inbound receive path MUST enforce `LOCAL_ONLY_CHANNELS` before handler lookup or argument deserialization, so a crafted direct WebSocket frame cannot bypass `RoutedClient` or preload restrictions.

Before any generic Notes route or source-index path loads, indexes, serializes, lists, searches, or watches a document, the main process MUST classify `Notes/Imports/` and import provenance from the paired owned record. Remote/headless and thin-client paths MUST reject an import-provenanced document as `LOCAL_ONLY`; their list/search/watch/index projections MUST omit it. Only the local `OPEN_MATERIALIZED_PREVIEW` flow may obtain the source-scoped rendering projection, and its policy/capability MUST be main-created and exact.

For a `RoxConsentGrantRequest`, `egress` MUST be present exactly when `scope` is `agent-egress` and MUST be absent otherwise. `grantConsent` MUST require the authorization's exact canonical grant-request list, including its complete trusted egress binding, with no added, removed, reordered, or substituted scope. `revokeConsent` MUST require the authorization's exact nonempty selected scope set, or the separately authorized full-source-revocation intent when `scopes` is absent. The main-process confirmation MUST resolve the egress binding from the trusted selected backend configuration and bind the exact resulting `backendIdentityFingerprint`, rather than trust a renderer-provided binding. A full-source revocation deletes every grant and durable source record except `RoxSourceRevocationTombstone`; it does not automatically delete a materialized copy, which becomes detached inert user-owned content and cannot be indexed, previewed as an external source, or retrieved until separately re-enrolled and consented. Every materialized `NoteDocument` read/open projection MUST carry a non-forgeable main-derived `RoxImportRenderPolicy`; `notes.ts`, DTO conversion, and renderer open paths MUST fail closed rather than route an import-provenanced note through a generic capability-bearing renderer when the policy is absent or mismatched.

For a remote backend, only Electron-main `RoxRemoteImportEgressGateway.dispatch` may obtain imported excerpts. A child may submit only `RoxRemoteImportDispatchRequest`; it cannot construct an intent, read an excerpt, serialize a prompt, invoke a provider, or receive an authority. Main resolves the typed intent from the trusted session and private retrieval selection, revalidates active source/retrieval/egress authority generations and `backendIdentityFingerprint` after selection and immediately before sealing, serializes one canonical body, binds a one-use `RoxRemoteImportDispatchAuthority` to its SHA-256, consumes that authority durably before transport, rehashes at the terminal serializer, and dispatches exactly once through the matching sealed provider adapter. A failed or absent comparison, replay, expiry, body mismatch, unsupported adapter, destination/model/configuration change, redirect, transport ambiguity, fallback, retry, or crash recovery MUST return `EGRESS_FORBIDDEN`, transmit zero imported data, and require a new direct egress consent; no generic source path, formatter, callback, queue, result, history/retry record, generic provider client, or child process may receive the excerpt or prompt segment.

`RoxImportToolFence` is a mandatory shared enforcement boundary, not a UI/permission setting. At cutover, `packages/shared/src/agent/core/pre-tool-use.ts` MUST invoke it before its current mode check and before its `call_llm` interception; `packages/shared/src/agent/claude-agent.ts` and `pi-agent.ts` MUST not have a preceding backend-specific bypass; `packages/shared/src/agent/omp-agent.ts` MUST invoke it before approval, `preExecuteCallLlm`, registry/MCP execution, and `host_tool_result`; `packages/shared/src/agent/llm-tool.ts::processAttachment` MUST invoke it before any `existsSync`, `statSync`, or `readFile`; `packages/pi-agent-server/src/index.ts` MUST enforce it before the native executor and before raw-result summarization; `packages/session-tools-core/src/handlers/script-sandbox.ts` and `runtime/filesystem-isolation.ts` MUST deny the import subtree at process level; and `packages/session-mcp-server/src/index.ts` MUST not directly invoke a filesystem-capable registry handler without it. The final provider-body serializer in `packages/shared/src/unified-network-interceptor.ts` MUST reject import-provenanced tool history before serialization. Every new backend, tool host, adapter, or result serializer inherits this requirement.

Every persisted source authority record and in-memory source handle is namespaced by the trusted compound `(workspaceId, sourceId)`. Before ledger disclosure, any external operation, cache/index use, or prompt dispatch, the lookup MUST compare the persisted workspace ID to the main-process-derived context; an opaque source ID, cursor, selection token, authorization, grant, journal, index row, or tombstone from another workspace MUST fail as `WORKSPACE_FORBIDDEN`.

Required error codes:

```ts
type RoxImportErrorCode =
  | 'LOCAL_ONLY'
  | 'WORKSPACE_FORBIDDEN'
  | 'CONSENT_REQUIRED'
  | 'CONSENT_EXPIRED'
  | 'CONSENT_REVOKED'
  | 'AUTHORIZATION_REQUIRED'
  | 'AUTHORIZATION_INVALID'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_CHANGED'
  | 'UNSAFE_PATH'
  | 'BOUND_EXCEEDED'
  | 'SENSITIVE_PATH'
  | 'SENSITIVE_CONTENT'
  | 'UNSUPPORTED_SOURCE'
  | 'MATERIALIZATION_FAILED'
  | 'EGRESS_FORBIDDEN'
  | 'UNTRUSTED_RENDERING_BLOCKED'
  | 'RELEASE_GATE_BLOCKED'

interface RoxImportFailure {
  code: RoxImportErrorCode
  messageKey: string // localized, non-sensitive
}
```

## Data Models

| Entity | Storage | Required fields | Constraints |
| Direct-action lease, user authorization, chooser selection, inventory cursor | main-process memory only | Direct-action lease: OS-observed registered-shell input/native menu witness, webContents/frame, workspace, surface, exact action, nonce, expiry <= 60 seconds; selection: sender, workspace ID, category, selection nonce, expiry <= 60 seconds; authorization: sender, workspace ID, source ID/generation or selection, action, scopes, nonce, expiry <= 60 seconds; cursor: sender, workspace ID, source ID/generation, consumed authorization expiry, fixed-inventory sequence/offset, nonce | Electron main alone mints the direct-action lease; renderer activation/client-ID/gesture claims cannot substitute it. Opaque values may traverse only verified local IPC and each is consumed/deleted atomically at first use or expiry. |
| Root policy | `.rox/root.json` | canonical root paths, schema version | Created atomically; all paths must be owned/canonical. |
| Import record | `.rox/imports/<workspaceId>/<sourceId>.json` | main-process-only `RoxImportRecord` with workspace ID, `workspaceImportNamespace`, private `RoxImportSourceKind`, and private `RoxLegacyCraftMarkdownFormat` when applicable | Exactly one current identity fingerprint per compound workspace/source key; `legacy-craft-markdown`/`legacy-craft-markdown-v1` is valid only for `Agents` after the main-only metadata predicate. Its source locator is resolved only through the paired private discovery identity ledger. It records grant IDs, not secret material; no gateway may return this record. |
| Consent grant | `.rox/consent/grants/<workspaceId>/<grantId>.json` | `RoxConsentGrant` | Immutable, one scope per grant, workspace-bound monotonic authorization generation; no secrets. |
| Scope authority state | `.rox/consent/current/<workspaceId>/<sourceId>/<scope>.json` | workspace ID, source ID, scope, active grant ID if any, current monotonic authorization generation | Atomically advances on grant/revocation; every source operation consults it at its final authorization boundary. |
| Revocation event | `.rox/consent/revocations/<workspaceId>/<revocationId>.json` | `RoxConsentRevocationEvent` | Immutable, append-only, workspace-bound, advances the affected authority generation atomically; no secrets. |
| Full-source tombstone | `.rox/consent/tombstones/<workspaceId>/<sourceId>.json` | `RoxSourceRevocationTombstone` | The only durable source-state record after full revocation; contains no source identity, location, hash, inventory, or content. |
| Materialization journal | `.rox/imports/<workspaceId>/<sourceId>.jsonl` | workspace-scoped source/destination relative paths, hashes, stage, grant generation, source kind | Atomic checkpoints; source never modified; destination must include the verified `workspaceImportNamespace`; no raw body, source locator, or legacy map schema; commit verifies current grant generation and workspace key. |
| Index | `.rox/index/<workspaceId>/` | workspace-scoped consented owned-document references, hashes, provenance, trust label, grant generation | Never ingest external link targets or `.rox`; delete/disable caches and rows on affected-scope revocation. |
| `RoxImportSummary` source projection | no separate storage; projected locally from workspace-bound source, consent, and authority records | opaque source ID, category, safe label, state, active scopes, safe identity state | `LIST_SOURCES` is local-only and restart-safe; it exposes no locator, inventory, raw path, source bytes, or rescan capability. |
| Materialized `NoteDocument` read/open projection | transient main-process projection | non-forgeable `RoxImportRenderPolicy` and opaque source-scoped preview capability for every import-provenanced note | Policy derives from the paired import record and verified provenance, never user-editable frontmatter or renderer state. No generic remote/headless/thin Notes read/list/search/watch/index projection may load, serialize, or disclose it; local content access is only through `OPEN_MATERIALIZED_PREVIEW`. Missing or mismatched policy fails closed before generic note, Tiptap, Markdown, preview, file-IPC, shell, network, or agent-context rendering. |
| Snapshot | `.rox/snapshots/` | release/migration snapshot identity, timestamp, checksum | Created before eligible engine release/migration; restore remains explicit. |
| Release manifest | release artifact + immutable archive | ROX version, canonical engine version/revision, patch hashes, artifact hashes, legal hashes, source URL | Required before promotion; belongs to ROX-owned origin only; not authorization by itself. |
| Release approval anchor | immutable release archive | version/domain, pinned owner approval key/signature, canonical candidate and rollback descriptor SHA-256, canonical minimum version, approved G1/G2 decision SHA-256, exact source-artifact SHA-256, approval-evidence SHA-256 | The owner signature covers the complete versioned domain-separated canonical anchor payload; the release signature separately covers it in the authorization. The gate recomputes both descriptor hashes, checks the source-artifact equality binding, verifies both signatures against compiled/pinned trust roots, and never resolves a mutable approval record. |
| Engine release authorization | immutable release archive | signed `RoxEngineReleaseAuthorization`: schema/key ID, candidate and complete immutable rollback descriptors (canonical engine version/revision, source/artifact/legal/provenance hashes, channel), minimum version, and owner-signed approval anchor | Verified only against the compiled/pinned release trust root after owner-anchor verification; the sole gate rejects absent, malformed, unsigned, noncanonical, inconsistent, or same-version/different-hash rollback descriptors before every managed-engine action. |

## Implementation boundaries and reuse

### Existing code to reuse

- `packages/shared/src/utils/files.ts::atomicWriteFileSync` for owned-record mutation.
- `packages/server-core/src/knowledge/notes-migration.ts` only for bounded traversal, portable relative paths, hashes, resumable checkpointing, and non-overwriting materialization; ROX MUST NOT reuse its raw `sourceRoot`/`destinationRoot` state shape or `.craft/notes-migration-map.json`.
- `packages/shared/src/credentials/` for the principle that metadata stores references rather than credential values; it is not an Import API.
- Existing local UI folder chooser as the starting interaction for a manual source; it is not a consent authority on its own.

### Existing code that MUST NOT define ROX Imports authority

- Generic `FolderSourceConfig.local.path` and `sources.UPDATE` path storage.
- Generic `source-index.ts` external-root walker, generic source retrieval, and generic prompt retrieval.
- `SessionManager` direct generic-index retrieval and `formatSourceRetrieveForPrompt` as a ROX-import path.
- `knowledge:migrateNotes`, `RPC_CHANNELS.knowledge.MIGRATE_NOTES`, its raw remote-eligible classification, renderer/preload API, server handler, public `MigrateNotesArgs`/`MigrateNotesResult` source/destination/map fields, and its legacy `.craft/notes-migration-map.json` as a ROX-import path.
- SiYuan/CYN installation discovery, token reading, plugin/Bazaar fallback, and automatic start/bootstrap.
- Generic `NoteDocument`/Tiptap/Markdown preview-block dispatch, renderer file-read callbacks, generic file IPC, shell/network callbacks, and home-directory file validators as an imported-content capability path.
- Lexical-only containment checks that can follow a root or parent substitution.

### Required clean-cutover callers

The future implementation must move the root policy together across current callers, including:

- `packages/shared/src/config/paths.ts` and `config/storage.ts`;
- `packages/shared/src/workspaces/storage.ts` default creation/discovery;
- `packages/server-core/src/handlers/rpc/notes.ts`, `sources.ts`, `projects.ts`, and `server.ts` Notes fallbacks; `packages/shared/src/protocol/routing.ts`; `packages/server-core/src/knowledge/source-index.ts`; generic Notes list/search/watch/read projections; and main-derived `RoxImportRenderPolicy` attachment to every import-provenanced `NoteDocument` read/open projection. Every generic route/index path MUST exclude `Notes/Imports/` and import-provenanced documents from remote/headless/thin serialization and return only the dedicated local `OPEN_MATERIALIZED_PREVIEW` projection after main classification;
- `packages/server-core/src/knowledge/notes-migration.ts` only as the bounded copy primitive behind `.rox/` journals and private identity ledgers, never as a destination fallback or raw-map writer; replace its caller-supplied `format` branch with the Electron-main `LegacyCraftMarkdownValidator` and its `legacy-craft-markdown-v1` no-follow metadata predicate, then apply post-consent UTF-8 Markdown validation before copy;
- `packages/shared/src/protocol/channels.ts`, `routing.ts`, `packages/server-core/src/transport/server.ts` (inbound `WsRpcServer` dispatch), `apps/electron/src/main/index.ts`, `packages/server/src/index.ts`, `packages/server-core/src/handlers/rpc/index.ts` (explicit local-Electron versus remote/headless registration profile), `apps/electron/src/transport/routed-client.ts`, `apps/electron/src/preload/bootstrap.ts`, `apps/electron/src/transport/build-api.ts`, client-only `WsRpcClient` construction, Electron channel maps, preload allowlists, and local handler registration for every `roxImports` channel, including `BEGIN_MANUAL_SOURCE_SELECTION`, `BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION`, `REQUEST_USER_AUTHORIZATION`, `OPEN_MATERIALIZED_PREVIEW`, and `LIST_SOURCES`; every client-only/remote path MUST omit or locally fail all `LOCAL_ONLY` channels before connection, serialization, or invoke, the remote/headless registration profile MUST exclude each `roxImports` handler, and the remote/headless server MUST reject every such inbound channel before lookup, decoding, workspace derivation, or handler dispatch;
- Electron main-process OS-input/native-menu direct-action lease issuer, native chooser, and consent mediator, plus all renderer Imports UI callers, so only main mints/consumes a direct-action lease and the new chooser and confirmation run only in main while Imports restores persisted safe state through `LIST_SOURCES`;
- Existing raw-path chooser/migration flows `apps/electron/src/renderer/knowledge/KnowledgeHome.tsx::handleMigrateNotes` and `apps/electron/src/renderer/pages/settings/KnowledgeSettingsPage.tsx` (`openFolderDialog()` → `knowledge.migrateNotes({ sourceRoot })`), `packages/server-core/src/handlers/rpc/settings.ts`, `packages/server-core/src/handlers/rpc/knowledge.ts`, `packages/shared/src/protocol/channels.ts`, `routing.ts`, `apps/electron/src/transport/channel-map.ts`, `apps/electron/src/preload/bootstrap.ts`, `apps/electron/src/transport/build-api.ts`, `apps/electron/src/shared/types.ts`, and every `knowledge:MIGRATE_NOTES` server/preload/type mapping; both renderer/UI flows MUST be removed or migrated to `BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION` → opaque enrollment → normal consent/materialization in fixed `Agents`, with private `legacy-craft-markdown` state under `.rox/`. `MIGRATE_NOTES`, raw `MigrateNotesArgs`/`MigrateNotesResult`, raw legacy map state, and all aliases MUST be removed rather than retained, redirected, or remotely rejected after serialization.
- `packages/server-core/src/sessions/SessionManager.ts`, generic source retrieval, and `packages/shared/src/prompts/system.ts` so ROX imports reach a local prompt only through `retrieveForLocalAgent` or a remote provider only through the main-process sealed `dispatchRemoteImportedExcerpts` transaction, with workspace-key, source/egress-generation, and final egress-fingerprint checks;
- `packages/shared/src/protocol/dto.ts`, `packages/server-core/src/handlers/rpc/notes.ts`, `apps/electron/src/renderer/pages/NotesPage.tsx`, Tiptap integration, `packages/ui/src/components/markdown/Markdown.tsx`, `MarkdownDocBlock`/preview-block components, `apps/electron/src/renderer/App.tsx`, generic file IPC handlers, shell/network callbacks, and file validators so an import-provenanced note is rejected if its main-derived render policy is absent/mismatched and otherwise uses only the dedicated untrusted-import component and scoped preview capability;
- `packages/server-core/src/handlers/rpc/knowledge.ts`, SiYuan/CYN bootstrap/detection code, `useSiyuanConnected`, settings surfaces, and every lifecycle/preload/type mapping that can probe or start an upstream installation;
- Electron first-run/workspace creation paths and literal `.craft-agent` render-side constructors;
- safe-mode root write hints in `packages/shared/src/agent/mode-manager.ts`;
- Electron window state, logging, release-note initialization, package identity, installers, updater, and release-gate verifier, which must recompute canonical candidate/rollback descriptor hashes, verify the versioned domain-separated pinned-owner approval payload and release signature, and validate the complete descriptors/anchor before every action.

## Out of Scope

- OS-1: Shipping, downloading, vendoring, or spawning a ROX Notes engine before the release gate is formally accepted.
- OS-2: Legal advice or a conclusion about AGPL scope, trademarks, OEM terms, or commercial distribution rights.
- OS-3: Automatic migration of legacy Craft, SiYuan/CYN, browser, messenger, mail, or agent data.
- OS-4: Remote import, remote filesystem browsing, cloud sync, Cloud identity, plugin/Bazaar marketplace, or upstream update integration.
- OS-5: Automatic content indexing, automatic agent retrieval, or source text as an authorization mechanism without an active per-source grant and the required trusted service path.
- OS-6: Supporting an arbitrary filesystem location as a trusted ROX import without a category connector, bounded discovery, stable identity, and consent.
- OS-7: Linux/Windows managed-engine distribution before a separate platform/release decision.
- OS-8: Visual redesign work outside the Notes/Imports/release boundaries defined here.

## Verification Plan

No implementation test is valid until the specification is approved. The future implementation plan MUST cover:

1. Root resolver and fresh-home filesystem smoke scenario.
2. All default Notes caller migration tests, explicit external-root non-migration tests, and retired legacy `knowledge:MIGRATE_NOTES` protocol tests: assert no channel declaration, remote-eligible membership, channel-map/preload/`ElectronAPI` entry, `buildClientApi` invoke, `RoutedClient` route, server handler, public raw source/destination/map result, or alias remains; an attempted legacy invocation fails locally before connection, serialization, or filesystem access.
3. Concrete `roxImports` channel, `LOCAL_ONLY_CHANNELS`, local handler, local-Electron versus remote/headless handler registration profile, `RoutedClient`, client-only preload/bootstrap, `buildClientApi`, `WsRpcClient`, and remote/headless `WsRpcServer` reject-by-default coverage for every gateway operation, including `BEGIN_MANUAL_SOURCE_SELECTION`, `BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION`, `REQUEST_USER_AUTHORIZATION`, `OPEN_MATERIALIZED_PREVIEW`, and `LIST_SOURCES`; prove no remote/headless registry contains a `roxImports` handler and both a client-only request and a crafted direct inbound WebSocket frame cause zero remote handler lookup/invoke, argument deserialization, workspace derivation, WebSocket response with source data, source read, prompt dispatch, or connection side effect. `LIST_SOURCES` and `materialize` return only safe persisted projections, and no projection contains a locator, private identity, inventory, or raw path.
4. Electron-main direct-action lease tests prove a lease can originate only from an OS-observed registered-shell input or native menu action, is one-use, expires no later than 60 seconds after minting, and is webContents/frame/workspace/surface/action/nonce-bound; selection and user-authorization tokens are likewise one-use and no more than 60 seconds old at consumption. Reject renderer `userActivation`, synthetic gesture/client-ID claims, programmatic registered-shell IPC, expired/replayed tokens, or any clock-boundary overrun. `BEGIN_MANUAL_SOURCE_SELECTION`, `BEGIN_LEGACY_CRAFT_MIGRATION_SELECTION`, `OPEN_MATERIALIZED_PREVIEW`, and `REQUEST_USER_AUTHORIZATION` must consume their exact lease; chooser/confirmation tests prove no raw path reaches renderer/preload. Cover forged sender/client ID, wrong frame/webContents, no lease or confirmation, wrong source/category/scope/workspace, exact egress-binding and scope/revocation-intent matching, path-bearing input, and both legacy raw-chooser/migration callers with no fallback.
5. Discovery no-byte-read/no-network/no-credential/no-telemetry test with hidden/sensitive-path fixtures, the canonical configured Craft root's descendant and alias fixtures, private-ledger paging, restart-safe private-identity validation, `LIST_SOURCES` safe-projection-only behavior, and post-revocation cursor invalidation. Verify first-page authorization consumption, one-use sender/workspace/source/generation/expiry-bound cursor continuation, no cursor reuse or cross-inventory access, zero private identity/locator disclosure through gateway/renderer/prompt paths, and new direct confirmation after expiry or replay.
6. Deterministic symlink/root/parent swap race tests.
7. Independent per-scope grant, expiration, revocation, resume, full-source purge, and cross-workspace isolation tests, including the same opaque `sourceId` independently authorized and revoked in two workspaces. Cover workspace comparison failures before ledger disclosure, source open/read, copy, index/cache commit, inventory return, preview capability resolution, sealed remote handoff, and prompt dispatch, plus barriers immediately before each operation.
8. Materialization bounds/hash/checkpoint/no-source-modification tests, including the versioned sensitive-content corpus: private-key, bearer/OAuth, cookie serialization, secret-named config, and provider-key fixtures must reject whole objects before destination write and prove zero matched-value persistence, index, preview, retrieval, egress, log, or error disclosure. Cover `legacy-craft-markdown-v1` metadata-only selection with no pre-consent byte read; rejection of caller `format`, no regular `.md`, unsafe aliases/sensitive paths, and malformed post-consent UTF-8 Markdown; source preservation, `.rox/`-only journal state, fixed `Agents` destination, interrupted resume, and non-use of `.craft/notes-migration-map.json`.
9. Imported-content rendering tests cover `html-preview`, `markdown-preview`, table/spreadsheet, image, PDF, absolute path, `file:`, traversal, symlink, and HTTP(S) directives. Prove every imported `NoteDocument` read/open projection has a main-derived `RoxImportRenderPolicy`; missing/forged/mismatched policy fails closed before `NotesPage`, Tiptap, Markdown/preview blocks, generic file IPC, shell, network, or agent-context path. With a valid opaque scoped preview capability, `openMaterializedPreview` may resolve only the same verified import's regular no-follow portable child and returns no locator or generic read handle.
10. `RoxAgentRetrievalGateway` provenance/untrusted-data/prompt-injection tests prove local `retrieveForLocalAgent` returns structured excerpts while stale generic index rows and direct `SessionManager`/formatter calls yield no ROX import content. Direct and broad-path agent tool tests in every permission mode (`safe`, `ask`, `allow-all`) cover `Read`, `Glob`, `Grep`, `Find`, `Ls`, shell commands, attachments, archive/image/document conversion, nested `call_llm`, task/subagent, registry/MCP, OMP host-tool, and script-sandbox routes against regular, symlinked, parent-swapped, and broad-enumeration `Notes/Imports/` fixtures. They prove the shared pre-tool fence runs before mode/approval/interception, the sandbox prevents undeclared direct reads, and no bytes, path, source ID, provenance, inventory, or metadata reach an executor, tool result, mini-model summary, provider history/body, host-tool response, session journal, callback, queue, renderer event, log, or remote transport; a trusted-provenance result-guard regression must reject a deliberately bypassed preflight result rather than scan its text. Prove remote callers cannot obtain an excerpt, formatter input, callback value, queue payload, or provider-client prompt segment; only sealed dispatch can transmit bounded excerpts.
11. Remote-provider sealed-egress tests with a mock remote and a local backend: without exact provider-bound consent, transmit zero imported bytes, paths, identities, or inventory; with it, only Electron main may build a typed intent and transmit one bounded structured excerpt body through a matching opaque sealed adapter. Assert that Pi and Claude child/provider paths, generic prompt/formatter paths, tool-result/session-history/retry serialization, callbacks, queues, direct `fetch`, generic provider clients, and adapter inputs cannot obtain a raw request body or excerpt. Independently mutate the canonical body after authority issuance; provider/origin/endpoint/transport/model/configuration generation; source/egress generations; source or provenance references; authority nonce/expiry/consumption state; and fixed endpoint/header policy. Each case must produce `EGRESS_FORBIDDEN`, zero serialized imported bytes, no network request, a non-sensitive audit code, and a consumed non-reusable authority. Prove no fallback, redirect, automatic retry, or crash recovery dispatch occurs; a simulated crash after durable consumption and before/after send is terminal and requires a new direct egress consent transaction. Verify the positive path recomputes the final body digest immediately before its sole send and preserves ordinary non-import local and remote agent behavior.
12. Full ROX terminology/localization/deep-link/stable-surface migration tests and a startup smoke proving no legacy SiYuan/CYN connection probe, token read, settings hook, or process start.
13. Release-gate tests reject a missing property, empty/malformed/noncanonical/internally inconsistent version guard, candidate or rollback descriptor, unsigned/tampered authorization, unknown signer, missing/mismatched immutable owner approval anchor or domain-separated canonical payload, invalid owner/release signature, wrong canonicalization test vector, candidate/rollback descriptor-hash mismatch, wrong channel, downgrade, and same-version/different-hash rollback substitution in package inclusion, publication, updater, extraction, activation, recovery, and direct-start paths. Preserve the source-archive SHA-256 and valid owner signature while changing candidate artifact/legal/provenance and, separately, rollback descriptor fields, then re-sign only the outer authorization: both cases MUST reject. Verify every candidate/rollback descriptor hash and approval-anchor field is signature-covered; the packaged engine equals the signed candidate descriptor; and source offer, notice, provenance, ROX-only channel, signing/notarization, failed-update rollback, and fresh-engine-state behavior remain valid.
14. Cross-workspace materialization tests with intentionally identical opaque source IDs: prove main-process-assigned namespace separation across materialization, preview, index, cleanup, and revocation, and reject unsafe/missing/mismatched destination components before any filesystem access.
15. Import-provenanced Notes exposure tests: a materialized `Notes/Imports/` file and a paired import-provenanced `NoteDocument` exercised through every remote/headless/thin `notes:read`, `notes:list`, `notes:search`, `notes:watch`, generic source-index, and direct WebSocket path must produce `LOCAL_ONLY` or an omitted result before file/content load, index lookup, serialization, response, or prompt dispatch, with zero path/source-ID/provenance/metadata/body disclosure. The local `OPEN_MATERIALIZED_PREVIEW` path alone returns the main-created scoped policy/capability projection; ordinary non-import Notes preserve their existing route behavior.
16. Category-folder mapping tests for every supported category, proving it resolves only to the exact pre-created `CYN`/`Logseq`/`Obsidian`/`Agents`/`Browsers`/`Messengers`/`Mail` folder and rejects unknown or unmapped values before any filesystem, provenance, or link operation.

## Approval prerequisites

Implementation may begin only when all of the following are true:

- The product owner approves this design document, including the decision not to use raw OS symlinks.
- Security review accepts the local-only consent/identity/indexing boundaries.
- The legal/release owner accepts an explicit update to G2/G1 or confirms that engine implementation remains disabled.
- A separate implementation plan maps every requirement and acceptance criterion to owned files and tests.
