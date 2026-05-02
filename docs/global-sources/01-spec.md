# Global Sources — File Format & Schema Spec

## Directory layout

### Global tier (new)

```
~/.agents/
├── sources/                       <- new directory; mirrors ~/.agents/skills/
│   ├── notion/
│   │   ├── config.json            <- the SourceConfig (canonical definition)
│   │   ├── guide.md               <- optional, same as workspace today
│   │   ├── icon.png               <- optional, downloaded once
│   │   └── credentials.json       <- global creds (encrypted via existing manager)
│   ├── github/
│   │   └── ...
│   └── linear/
│       └── ...
```

The directory is created lazily on first global-source write. `~/.agents/skills/` already
exists alongside it; the parent directory is shared.

### Workspace tier (extended)

```
<workspace>/
├── sources/
│   ├── <slug>/                    <- existing workspace-defined sources (unchanged)
│   │   ├── config.json
│   │   ├── guide.md
│   │   └── credentials.json       <- workspace override creds (when present)
│   └── .global-sources.json       <- NEW: activation manifest (list of activated global slugs)
```

Note: `.global-sources.json` lives **inside `<workspace>/sources/`**, mirroring the skills
manifest path convention (`<workspace>/skills/.global-skills.json`). This keeps source-related
state co-located.

## Source-config compatibility

The `config.json` schema for a global source is **identical to a workspace source**. Same
shape, same fields, same validators. The only difference is the directory it sits in.

This is intentional: a workspace source can be promoted to global by literally `mv`'ing the
directory (plus updating credential keying — see [03-credentials.md](03-credentials.md)). And
the loader can union the two tiers without translation.

Existing schema (unchanged, recap):

```typescript
interface FolderSourceConfig {
  slug: string;
  name: string;
  type: 'mcp' | 'api' | 'local';
  enabled: boolean;
  provider: KnownProvider | 'custom';
  mcp?: McpConfig;
  api?: ApiConfig;
  local?: LocalConfig;
  isAuthenticated?: boolean;
  // ... icon, tagline, permissions, etc.
}
```

### What `enabled` means at the global tier

`enabled: false` on a global source means **the source is broken / paused at the library
level** — no workspace can activate it until it's re-enabled. Useful for "this source is
known broken, don't let people turn it on."

This is **separate from per-workspace activation**, which is governed by the manifest. The
two-gate model:

| Global `config.enabled` | In workspace manifest? | Spawned in session? |
|---|---|---|
| true | yes | **yes** (if creds OK) |
| true | no | no |
| false | yes | no — globally paused |
| false | no | no |

A workspace cannot resurrect a globally-paused source by activating it. That's a feature.

## Activation manifest schema

### `<workspace>/sources/.global-sources.json`

```json
{
  "version": 1,
  "activatedSlugs": ["notion", "github", "linear"],
  "lastModified": "2026-05-02T18:30:00Z"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | int | yes | Schema version. Today: `1`. Bump for breaking changes. |
| `activatedSlugs` | string[] | yes | Slugs of global sources activated in this workspace. Order matters for nothing; deduped on read. |
| `lastModified` | ISO8601 | yes | Updated on every write. Used for change detection / sync. |

### Validation

- Unknown slugs in `activatedSlugs` are tolerated on read (logged at warn) but excluded from
  load results — a global source could have been deleted after a workspace activated it.
- Duplicate slugs are deduped silently on read.
- File missing → treat as `{ activatedSlugs: [] }`. No errors. Lazy-create on first activation.
- Malformed JSON → treat as missing, log error. Never throw upward.

### Atomic writes

All writes use the canonical pattern from [packages/shared/src/skills/storage.ts](packages/shared/src/skills/storage.ts):

1. Stage to `<file>.<pid>.<rand>.tmp`
2. `renameSync` into place
3. Cleanup tmp on failure

This protects against concurrent writers (UI activate + watcher mirror + RPC) and
half-written manifests on crash.

## Credentials file schema

### `~/.agents/sources/<slug>/credentials.json` (global)

Format identical to today's per-workspace credentials. The existing `CredentialManager` ABI
is reused; only the keying scheme and storage location change. See [03-credentials.md § Storage](03-credentials.md#storage).

### `<workspace>/sources/<slug>/credentials.json` (workspace override)

Identical format. When present, it shadows the global. Resolution order: workspace → global →
null.

## Loaded source shape (runtime)

The existing `LoadedSource` type is extended with one new field:

```typescript
type SourceTier = 'workspace' | 'global' | 'global-dormant' | 'project';

interface LoadedSource {
  // ... existing fields ...
  tier: SourceTier;     // NEW
}
```

| `tier` | Meaning |
|---|---|
| `workspace` | Defined in `<workspace>/sources/<slug>/`. Highest priority. |
| `global` | Defined in `~/.agents/sources/<slug>/` AND activated in this workspace's manifest. |
| `global-dormant` | Defined globally but **not** activated in this workspace. Loaded for UI listing only; never spawned, never bundled into agent prompts. |
| `project` | Defined in the current project root (existing concept, unchanged). |

When the same slug exists at multiple tiers, **workspace wins**. The loader emits a single
`LoadedSource` per slug with `tier` reflecting the source-of-truth path.

## What does NOT change

These remain untouched in this feature:

- The `SourceConfig` validator (`packages/shared/src/sources/types.ts`)
- The MCP server-builder (`packages/shared/src/sources/server-builder.ts`)
- The token-refresh manager keying (already slug-only, not workspace-keyed)
- The OAuth flow itself (`oauth.ts` RPC handlers) — only the credential lookup inside it changes
- Source guide.md format and rendering
- Source icon download/storage logic
- The `enabled` boolean semantics on the source config itself

## Path helpers (new exports from `packages/shared/src/sources/storage.ts`)

```typescript
// Constants
export const GLOBAL_AGENT_SOURCES_DIR: string;
export const WORKSPACE_GLOBAL_SOURCES_MANIFEST: string; // '.global-sources.json'

// Path helpers
export function getGlobalSourcePath(slug: string): string;
export function getWorkspaceGlobalSourcesManifestPath(workspaceRoot: string): string;

// Manifest I/O
export function readGlobalSourcesManifest(workspaceRoot: string): { activatedSlugs: string[]; version: number };
export function writeGlobalSourcesManifest(workspaceRoot: string, slugs: string[]): void;
export function isGlobalSourceActivatedInWorkspace(workspaceRoot: string, slug: string): boolean;
export function activateGlobalSourceInWorkspace(workspaceRoot: string, slug: string): void;
export function deactivateGlobalSourceInWorkspace(workspaceRoot: string, slug: string): void;

// Loaders
export function loadGlobalSource(slug: string): LoadedSource | null;
export function loadGlobalSources(): LoadedSource[];
export function listGlobalSourceSlugs(): string[];

// Mirror (promote workspace → global)
export interface MirrorSourceOptions { overwrite?: boolean; includeCredentials?: boolean }
export function mirrorSourceToGlobal(workspaceRoot: string, slug: string, opts?: MirrorSourceOptions): { mirrored: boolean; path: string };

// Combined loader (extended)
// loadAllSources(workspaceRoot) signature unchanged but now unions: workspace + activated globals + project + (optionally) global-dormant
export interface LoadAllSourcesOptions { includeDormant?: boolean }
export function loadAllSources(workspaceRoot: string, opts?: LoadAllSourcesOptions): LoadedSource[];
```

The shape mirrors `packages/shared/src/skills/storage.ts` 1:1. Use that file as the implementation
template.

## Identity & equality

A source's identity is **`(tier, slug)`**, not `slug` alone, for dormant entries (which a UI
might want to render alongside their active counterparts when a slug exists at multiple
tiers — e.g., a workspace override of a global).

For runtime spawning, a source's identity is **`slug`** — only one effective `LoadedSource`
per slug exists in the spawn list (workspace wins per the priority order).
