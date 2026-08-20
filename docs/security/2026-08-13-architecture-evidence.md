# Architecture evidence — four deepening candidates + Gate 0

**Date:** 2026-08-13  
**Mode:** read-only evidence collection (no implementation)  
**Vocabulary:** module, interface, seam, depth, adapter, leverage, locality  
**Status files:** G2 OPEN → `docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md`; G1 TBD → `docs/specs/2026-08-07-siyuan-integration/g1-metrics.md`  
**Gate 0 target (MISSING):** `docs/security/external-access-deployment-contract.md` (planned; directory created only by this memo)

---

## Candidate one-liners

1. **Root policy module-eval:** `CONFIG_DIR` is a single module-load const (`paths.ts:19`); workspace notes locality defaults under `CONFIG_DIR/workspaces/{id}/notes` via `storage.ts` + optional `WorkspaceConfig.notesPath` seam — no path-policy module evaluates caller intent before disk use.
2. **knowledge:migrateNotes remote-eligible local path:** `MIGRATE_NOTES` is REMOTE_ELIGIBLE (`routing.ts:500`) while the handler takes absolute `sourceRoot` and writes local notes (`knowledge.ts:1620–1643`, `notes-migration.ts:505–511,1207–1212`) — remote depth over a local-filesystem import adapter.
3. **Generic Sources index as agent-context ingress:** local path text is stored full-body in SQLite FTS (`source-index.ts:body_text`) and injected into agent system prompt at session start (`SessionManager.ts:4158–4166` → `retrieveSourcesForPrompt` / `formatSourceRetrieveForPrompt`).
4. **Credential/path policy:** secrets live only in `StoredCredential.value` (`types.ts:110–112`); identity keeps opaque `credentialRef` (`identity/types.ts:50–51`) while RPC accepts raw `credentialValue` and immediately `manager.set` (`identity.ts:37–42,171–200`).

---

## 1) Root policy module-eval

### Module: `packages/shared/src/config/paths.ts` (entire module = 20 lines)

```1:19:packages/shared/src/config/paths.ts
/**
 * Centralized path configuration for Craft Agent.
 * ...
 * Default (non-numbered folders): ~/.craft-agent/
 */
import { homedir } from 'os';
import { join } from 'path';

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.craft-agent/ for production and non-numbered dev folders
export const CONFIG_DIR = process.env.CRAFT_CONFIG_DIR || join(homedir(), '.craft-agent');
```

**Depth note:** single export const evaluated at module load. No interface for path allowlists, no adapter for multi-tenant locality. `CRAFT_CONFIG_DIR` is the only override seam.

### Who imports `CONFIG_DIR` (packages — non-exhaustive, high leverage)

| Importer | Use |
|---|---|
| `packages/shared/src/workspaces/storage.ts:31,42` | `DEFAULT_WORKSPACES_DIR = join(CONFIG_DIR, 'workspaces')` |
| `packages/shared/src/interceptor-common.ts:14,30,39` | `config.json`, logs under CONFIG_DIR |
| `packages/shared/src/release-notes/index.ts:14,16` | `join(CONFIG_DIR, 'release-notes')` |
| `packages/shared/src/docs/index.ts:15,17` | `join(CONFIG_DIR, 'docs')` |
| `packages/server/src/index.ts:41,224` | messaging paths under CONFIG_DIR |
| `packages/server-core/src/handlers/rpc/identity.ts:9` | Identity store + knowledge connections under CONFIG_DIR |
| `apps/electron/src/main/index.ts` | WorkGraph kernel `configDir: CONFIG_DIR` |
| `apps/electron/src/main/window-state.ts` | `window-state.json` under CONFIG_DIR |
| `apps/electron/src/main/handlers/extension-host.ts` | URL allowlist locality under CONFIG_DIR |

Scripts (`runtime-context-smoke.ts`, `marketplace-smoke.ts`, `toolchain-*-smoke.ts`) require external `CRAFT_CONFIG_DIR` under `/tmp` before dynamic import — documents that CONFIG_DIR is frozen at module evaluation.

### Notes path seam — first 40 lines of `storage.ts` + notes seed

```1:42:packages/shared/src/workspaces/storage.ts
/**
 * Workspace Storage
 * ...
 * Default location: ~/.craft-agent/workspaces/
 */
// ...
import { CONFIG_DIR } from '../config/paths.ts';
// ...
const DEFAULT_WORKSPACES_DIR = join(CONFIG_DIR, 'workspaces');
```

```395:399:packages/shared/src/workspaces/storage.ts
  // Seed credentialed API templates as disabled; they are never workspace defaults.
  ensureBuiltinSources(rootPath);

  // The default Notes source must exist before a session resolves these defaults.
  ensureLocalNotesSource(rootPath, join(DEFAULT_WORKSPACES_DIR, config.id, 'notes'));
```

### `WorkspaceConfig.notesPath` interface

```68:72:packages/shared/src/workspaces/types.ts
  /**
   * Custom notes storage path. When set, notes are stored here instead of the
   * default ~/.craft-agent/workspaces/{id}/notes/. Points at an Obsidian vault
   * or any existing markdown directory.
   */
  notesPath?: string;
```

### Local Notes source adapter writes path into source config

```194:210:packages/shared/src/sources/builtin-sources.ts
export function ensureLocalNotesSource(workspaceRootPath: string, notesPath: string): void {
  // ...
  local: {
    path: toPortablePath(notesPath),
    format: 'craft-markdown',
  },
```

### Resolution locality (server-core, not shared)

| Module | Lines | Behavior |
|---|---|---|
| `handlers/rpc/notes.ts` | 81–88 | `config?.notesPath` else `join(getDefaultWorkspacesDir(), workspaceId, NOTES_DIR)` |
| `handlers/rpc/sources.ts` | 29–30 | same default; calls `ensureLocalNotesSource` |
| `handlers/rpc/settings.ts` | 144,159,192–197 | `notesPath` is a writable workspace setting key |
| `knowledge/notes-migration.ts` | 505–511 | `resolveWorkspaceNotesRoot` duplicates notes.ts priority |

**Leverage gap:** path policy is spread across config const + workspace config field + multiple resolve helpers; no single root policy module evaluates absolute paths before import/index/credential disk use.

---

## 2) `knowledge:migrateNotes` — remote-eligible local path

### Routing seam — REMOTE_ELIGIBLE

```490:501:packages/shared/src/protocol/routing.ts
  // knowledge — P5 saved views + work envelopes ...
  RPC_CHANNELS.knowledge.WATCH,
  RPC_CHANNELS.knowledge.UNWATCH,
  RPC_CHANNELS.knowledge.MIGRATE_NOTES,
  RPC_CHANNELS.knowledge.METRICS_GET,
```

Channel id: `packages/shared/src/protocol/channels.ts:183` → `'knowledge:migrateNotes'`.

Test assertion:

```133:137:packages/shared/src/protocol/__tests__/routing.test.ts
  test('knowledge P4.4 migrateNotes is REMOTE_ELIGIBLE', () => {
    for (const ch of P4_MIGRATE_CHANNELS) {
      expect(REMOTE_ELIGIBLE_CHANNELS.has(ch)).toBe(true)
      expect(LOCAL_ONLY_CHANNELS.has(ch)).toBe(false)
    }
  })
```

Contrast: `ENGINE_STATUS` / `DETECT_ENGINE` / `ENGINE_START` are LOCAL_ONLY (same test file:140–147).

### Handler — accepts absolute `sourceRoot`, local destination

```1620:1643:packages/server-core/src/handlers/rpc/knowledge.ts
  // ——— MIGRATE_NOTES({workspaceId, sourceRoot, format?}) → MigrateNotesResult ———
  // User-initiated local import into the Markdown Notes store. It has no
  // knowledge-provider, credential, or network dependency.
  server.handle(
    RPC_CHANNELS.knowledge.MIGRATE_NOTES,
    async (_ctx, args: MigrateNotesArgs): Promise<MigrateNotesResult> => {
      // ...
      const rootPath = requireWorkspaceRoot(args.workspaceId)
      const notesRoot = resolveWorkspaceNotesRoot(args.workspaceId)
      try {
        const result = await importNotes({
          workspaceRoot: rootPath,
          sourceRoot: args.sourceRoot,
          destinationRoot: notesRoot,
          format: args.format,
        })
```

Handler comment claims local-only semantics; routing classifies channel as workspace-owner remote depth.

### Entry module — `notes-migration.ts`

Header + map locality:

```1:19:packages/server-core/src/knowledge/notes-migration.ts
/**
 * Local Craft Markdown Notes import.
 *
 * Import state is stored at `{workspaceRoot}/.craft/notes-migration-map.json`.
 * The importer only reads the selected source vault and writes into the existing
 * local Markdown Notes root. ...
 */
export const NOTES_MIGRATION_MAP_RELATIVE = join('.craft', 'notes-migration-map.json')
export const CRAFT_MARKDOWN_IMPORT_FORMAT = 'craft-markdown' as const
```

Args interface (absolute path required at resolve):

```115:121:packages/server-core/src/knowledge/notes-migration.ts
export interface MigrateNotesArgs {
  workspaceId: string
  /** Absolute source vault root chosen by the user. */
  sourceRoot: string
  /** Defaults to the only supported local format, `craft-markdown`. */
  format?: string
}
```

Destination resolve (notesPath override seam):

```505:511:packages/server-core/src/knowledge/notes-migration.ts
export function resolveWorkspaceNotesRoot(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (config?.notesPath) return config.notesPath
  return join(getDefaultWorkspacesDir(), workspaceId, NOTES_DIR)
}
```

Absolute-path check on import root:

```513:527:packages/server-core/src/knowledge/notes-migration.ts
async function resolveSelectedImportRoot(sourceRoot: string): Promise<string> {
  if (!sourceRoot || !isAbsolute(sourceRoot)) {
    throw new NotesImportError('Selected notes import root must be an absolute path')
  }
  // realpath + isDirectory ...
}
```

Public entry:

```1203:1212:packages/server-core/src/knowledge/notes-migration.ts
/**
 * Generic import entry point. It deliberately accepts only Craft Markdown;
 * unsupported formats fail before the filesystem is touched.
 */
export async function importNotes(options: ImportNotesOptions): Promise<MigrateNotesResult> {
  const format = options.format?.trim() || CRAFT_MARKDOWN_IMPORT_FORMAT
  if (format !== CRAFT_MARKDOWN_IMPORT_FORMAT) {
    throw new NotesImportError(`Unsupported notes import format: ${format}`)
  }
  return importCraftMarkdownNotes(options)
}
```

Limits (depth bound on traversal, not remote policy): `NOTES_IMPORT_LIMITS` at lines 37–45 (`maxTraversalEntries: 10_000`, `maxDepth: 64`, etc.).

**Deepening risk:** REMOTE_ELIGIBLE + absolute `sourceRoot` means the workspace-owning host's local filesystem is the adapter; a remote client can drive import against host paths if transport auth only checks workspace ownership.

---

## 3) Generic Sources index as agent-context ingress

### Storage module — full body text in SQLite

```1:8:packages/server-core/src/sources/source-index.ts
/**
 * source-index — per-workspace SQLite FTS index for local source folders.
 *
 * Path: {workspaceRoot}/.craft/source-index.sqlite
 * Table files(path UNIQUE, hash, chars, tokens, mtime, body_text)
 * Optional FTS5 virtual table files_fts when available; LIKE fallback otherwise.
 */
```

Schema + upsert of full body:

```172:180:packages/server-core/src/sources/source-index.ts
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY NOT NULL,
        hash TEXT NOT NULL,
        chars INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        mtime INTEGER NOT NULL DEFAULT 0,
        body_text TEXT NOT NULL DEFAULT ''
      )
```

```291:336:packages/server-core/src/sources/source-index.ts
/**
 * Index one root directory into the workspace source index.
 * Paths are stored as `{sourceSlug}/{relPath}` when sourceSlug is provided, ...
 */
export function indexSourceTree(...) {
  // walkSourceTree reads file bodies; upsert:
  INSERT INTO files (path, hash, chars, tokens, mtime, body_text)
  VALUES (?, ?, ?, ?, ?, ?)
  // body_text = f.body
}
```

Caps: `MAX_FILES=2000`, `MAX_FILE_BYTES=512KiB`, `MAX_TOTAL_BYTES=32MiB`, `MAX_BODY_CHARS=200_000` (lines 77–80). Text extensions include source + config-like files (`.env.example` exception for hidden; lines 32–62, 244–246).

### Retrieve interface for prompt injection

```116:134:packages/server-core/src/sources/source-index.ts
/** Retrieved hit with a budgeted excerpt for system-prompt injection. */
export interface SourceRetrieveHit {
  path: string
  excerpt: string
  rank: number
  tokens: number
}
/** Default token budget for source docs injected into the agent system prompt. */
export const SOURCE_RETRIEVE_MAX_TOKENS = 2000
```

```551:571:packages/server-core/src/sources/source-index.ts
/**
 * Ranked source retrieve for agent system-prompt injection.
 * Greedy-fills hit excerpts by search rank until SOURCE_RETRIEVE_MAX_TOKENS
 * ... Fail-soft: missing index / blank query / errors → empty hits
 */
export function retrieveSourcesForPrompt(
  workspaceRoot: string,
  query: string,
  options: { limit?: number; maxTokens?: number } = {},
): SourceRetrieveResult {
```

### SessionManager seam (~4161 still present)

```4155:4169:packages/server-core/src/sessions/SessionManager.ts
      let memoryBlocks = managed.memoryMode === 'temporary'
        ? undefined
        : await this.memoryServiceFor(managed.workspace)?.buildMemoryBlocks(...)
      // P2.7: FTS-retrieve local source docs into the same memoryBlocks payload
      // (sourcesBlock). Same memoryQuery as lessons; fail-soft on missing index.
      if (memoryQuery && managed.workspace?.rootPath) {
        try {
          const retrieved = retrieveSourcesForPrompt(managed.workspace.rootPath, memoryQuery)
          const sourcesBlock = formatSourceRetrieveForPrompt(retrieved.hits)
          if (sourcesBlock) {
            memoryBlocks = { ...(memoryBlocks ?? {}), sourcesBlock }
          }
        } catch (err) {
          sessionLog.warn(`Failed to retrieve sources for prompt (${managed.id}):`, err)
        }
      }
```

Formatter adapter:

```566:583:packages/shared/src/prompts/system.ts
/**
 * Format FTS-retrieved source docs for system-prompt injection.
 */
export function formatSourceRetrieveForPrompt(hits: SourceRetrieveHit[]): string {
  // emits "[Retrieved source docs]" + "### {path}" + excerpt
}
```

`memoryBlocks` (including `sourcesBlock`) is passed into `createBackendFromResolvedContext` at `SessionManager.ts:4189–4194`.

**Leverage:** one index module + one session-start seam; any local path that gets indexed becomes agent-visible context without a separate consent interface.

---

## 4) Credential / path policy

### Manager get/set interface

```108:142:packages/shared/src/credentials/manager.ts
  /**
   * Get a credential by ID, trying all backends.
   */
  async get(id: CredentialId): Promise<StoredCredential | null> {
    await this.ensureInitialized();
    for (const backend of this.backends) {
      // backend.get(id) → return first hit
    }
    return null;
  }

  /**
   * Set a credential using the write backend.
   */
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    await this.ensureInitialized();
    if (!this.writeBackend) {
      throw new Error('No writable credential backend available');
    }
    await this.writeBackend.set(id, credential);
  }
```

Backend: `SecureStorageBackend` only (manager.ts:55–60, 68–70) — encrypted file locality under craft config, not OS keychain.

### Secret field — `StoredCredential.value`

```110:112:packages/shared/src/credentials/types.ts
export interface StoredCredential {
  /** The secret value (API key, access token, or primary credential) */
  value: string;
```

Credential types include `source_*`, `service_oauth`, `ssh_managed_token`, `openclaw_gateway_token` (types.ts:19–42). Key format comment: `"{type}::{scope...}"` (types.ts:7–14). Source credential path comment: `~/.craft-agent/workspaces/{ws}/sources/{slug}/` (types.ts:30).

### Identity RPC — raw `credentialValue` ingress

```37:42:packages/server-core/src/handlers/rpc/identity.ts
export interface IdentityConnectArgs {
  provider: ServiceProvider
  workspaceId: string
  accountLabel?: string
  credentialValue?: string
  connectionId?: string
}
```

```169:200:packages/server-core/src/handlers/rpc/identity.ts
    const requiresCredential = args.provider === 'siyuan-cloud'
    const credentialValue = args.credentialValue?.trim()
    if (requiresCredential && !credentialValue) {
      throw new Error('identity.connect: credentialValue is required for siyuan-cloud')
    }
    // ...
    if (credentialValue) {
      const manager = getCredentialManager()
      await manager.set(
        {
          type: 'service_oauth',
          workspaceId: args.workspaceId,
          name: connection.id,
        },
        {
          value: credentialValue,
          tokenType: 'Bearer',
        },
      )
```

Uses `CONFIG_DIR` for identity store locality (`identity.ts:9,86`).

### Domain interface — opaque `credentialRef` (no secret)

```1:6:packages/core/src/platform/identity/types.ts
/**
 * Identity Center domain contracts (S-07).
 * ...
 * Cloud) attach as ServiceConnection via credentialRef. Secrets never live here.
 */
```

```45:51:packages/core/src/platform/identity/types.ts
export interface ServiceConnection {
  id: string;
  workspaceId: string;
  provider: ServiceProvider;
  accountLabel?: string;
  /** Opaque ref into CredentialManager — never a secret value. */
  credentialRef?: string;
```

Store adapter sets `credentialRef = connection id` when `credentialValue` present (`store.ts:212–230`); never persists the secret in identity JSON.

**Seam summary:** RPC wire may carry secret once (`credentialValue`); durable identity holds only `credentialRef`; secret depth is CredentialManager encrypted store. No path-policy coupling beyond CONFIG_DIR locality for the identity file.

---

## Gate 0 — Security / External Access (EXISTS vs MISSING)

**Planned contract path (MISSING on disk):**  
`docs/security/external-access-deployment-contract.md`  
Cited as create-target in `docs/superpowers/plans/2026-08-11-security-external-access-implementation-plan.md:36–45` and Task B0 in `docs/superpowers/plans/2026-08-13-post-research-program-plan.md:74–76`.

**Design / plan docs (EXIST — not deploy facts):**

| Artifact | Path | Role |
|---|---|---|
| Design | `docs/superpowers/specs/2026-08-11-security-external-access-design.md` | Logical origins, microVM, WebAuthn, DeviceRecord sketch |
| Implementation plan | `docs/superpowers/plans/2026-08-11-security-external-access-implementation-plan.md` | Gate 0 steps unchecked |
| Program | `docs/superpowers/specs/2026-08-13-post-research-program.md:15,51` | Gate 0 listed as ask-first |

### Fact hunt

| Term | EXISTS (code) | EXISTS (docs only) | MISSING (code + contract) |
|---|---|---|---|
| `APP_ORIGIN` | — | design:24; plan:14 | No `.ts`/`.tsx`/config match |
| `SHARE_ORIGIN` | — | design:25; plan:14 | No code match |
| `app.rox.one` | — | design:24 (v1 target table) | No code match |
| `share.rox.one` | — | design:25 | No code match |
| microVM | — | design:98–117; plan:7,17,31,85–87,398–404 | No `SandboxExecutionRunner` / `microvm-runner` module under packages |
| Firecracker | — | (not named in design; plan stack is Docker/VF) | No code match |
| WebAuthn | — | design:155–163; plan:9,511–540 | No WebAuthn module in packages |
| DeviceRecord / device store | — | design:160; plan:52–63,470–485 | `packages/server-core/src/webui/` has password JWT auth only (`auth.ts:1–8,18–22`); no `device-store.ts` |
| SPKI pin | **YES** — `packages/shared/src/config/remote-tls-trust.ts:41–83`; type `RemoteTlsTrust` in `packages/core/src/types/workspace.ts:18–35`; tests + storage normalize | design §3 remote trust | App-local enrollment UI/handshake depth may be partial; pin **policy module exists** for remote workspace TLS |
| sandbox image digest | — | plan Gate 0 step 3 (image digest/signer) | No image digest constant or verifier module |
| Catalog SPKI (unrelated) | **YES** — marketplace catalog signing SPKI (`catalog-signing.ts:14–21`) | — | Not Gate 0 device/TLS pin |

### Existing webui auth depth (not DeviceRecord)

```1:8:packages/server-core/src/webui/auth.ts
/**
 * Web UI session authentication.
 * Cookie-based JWT session auth for the browser-served web UI.
 * - Login: verify password → issue signed JWT → set HttpOnly cookie
 */
```

JWT claims: `sub`, `iat`, `exp` only (`auth.ts:18–22`) — no `deviceId` / `sessionVersion` from Gate 0 design.

### Sandbox runtime today

`packages/session-tools-core/src/runtime/` contains `filesystem-isolation`, `network-isolation`, `path-security`, `sandbox-env`, `resolve-script-runtime` — **no** `sandbox-execution.ts` / `microvm-runner.ts` (those are plan create-targets at plan:346–403).

---

## G2 / G1 status (binding product blocks)

| Gate | Path | Status quote |
|---|---|---|
| **G2** | `/Users/marklindgreen/Projects/craft-agents/docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md` | L3: `Status: OPEN — blocked on legal/commercial decision`; L33: `Until then, **P7 managed does not start.**` |
| **G1** | `/Users/marklindgreen/Projects/craft-agents/docs/specs/2026-08-07-siyuan-integration/g1-metrics.md` | L66–73: all thresholds **TBD**; L75: `P7 managed is blocked` until thresholds filled **and** G2 ACCEPTED |

Cross-ref: `docs/specs/2026-08-10-rox-notes-root-imports-design.md:20` — G2 OPEN + G1 TBD block engine distribution.

---

## Gate 0 missing list (compact)

1. `docs/security/external-access-deployment-contract.md` — not filled (Gate 0 deliverable absent).  
2. Named durable **device-record datastore** owner + transaction model — not in repo.  
3. **APP_ORIGIN / SHARE_ORIGIN** ownership + live hostname binding — design only; zero code.  
4. **app.rox.one / share.rox.one** — design targets only; zero code.  
5. **WebAuthn** / passkey pairing modules — design/plan only.  
6. **DeviceRecord** interface implementation + `device-store` adapter — plan paths not present under `webui/`.  
7. **microVM** / **Firecracker** / Virtualization.framework runner + **sandbox image digest/signer** — plan only; runtime has env/path isolation, not microVM.  
8. **SandboxExecutionRunner** interface module — plan create-target missing.  
9. Share-management capability issuer / public verification material — Gate 0 step 2 unchecked.  
10. Reverse-proxy / secret-authority ownership records — Gate 0 step 1–4 unchecked.

**EXISTS partial (do not invent completeness):** remote workspace **SPKI pin** normalize/persist policy (`remote-tls-trust.ts`); marketplace catalog SPKI (orthogonal); password JWT webui (`webui/auth.ts`).

---

## Return summary

**4 candidate one-liners:** see top of memo.  
**Gate 0 missing list:** items 1–10 above.  
**G2 path:** `docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md` (OPEN).  
**G1 path:** `docs/specs/2026-08-07-siyuan-integration/g1-metrics.md` (thresholds TBD).
