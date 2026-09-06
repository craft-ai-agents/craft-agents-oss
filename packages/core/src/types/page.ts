/**
 * Page Types
 *
 * Pages are workspace-scoped, agent-authored mini dashboards: static HTML/JS
 * rendered by the host in an opaque sandboxed iframe, backed by data that
 * refresh scripts write to disk, plus a mediated bridge for privileged
 * source actions (approved per-grant, executed by the host — never by
 * page JS directly).
 *
 * File structure:
 * {workspaceRootPath}/pages/{pageSlug}/
 *   ├── page.json       - PageConfig (metadata, refresh spec, grants, content digest).
 *   │                     Also the completion marker: refresh runs touch it last, and
 *   │                     the config watcher turns that into a `pages:changed` push.
 *   ├── index.html      - Page content (self-contained; rendered via srcDoc)
 *   └── data/
 *       ├── store.sqlite  - Script-private working store (bun:sqlite; never read cross-process)
 *       └── snapshot.json - PageDataSnapshot: the ONLY cross-process data contract,
 *                           written atomically by refresh scripts
 *
 * These types are environment-agnostic (renderer/main/webui safe). Storage,
 * validation, and execution live in @craft-agent/shared/pages.
 */

// ============================================================================
// Page kind
// ============================================================================

/**
 * Runtime capability class of a page:
 * - static      — no JavaScript; data must already be rendered into the HTML
 * - interactive — JS in the opaque sandbox; data from the injected snapshot
 * - live        — interactive + receives replacement snapshots while open
 */
export type PageKind = 'static' | 'interactive' | 'live';

// ============================================================================
// Refresh
// ============================================================================

/** Runtime a page refresh script executes under (resolved via resolveScriptRuntime) */
export type PageScriptRuntime = 'bun' | 'node' | 'python3';

/**
 * Scheduled refresh spec. Materialized as a synthetic cron automation matcher
 * with a single `script` action — never as an agent session.
 */
export interface PageRefreshSpec {
  /** 5-field cron expression evaluated once per minute */
  cron: string;
  /** IANA timezone for cron evaluation (falls back to system local) */
  timezone?: string;
  /** Script path relative to the workspace root (must stay within it) */
  script: string;
  /** Extra argv appended after the script path */
  args?: string[];
  /** Script runtime (default: 'bun' — required for the bun:sqlite data store) */
  runtime?: PageScriptRuntime;
  /** Per-run timeout in ms (default 60_000, clamped to [1_000, 900_000]) */
  timeoutMs?: number;
  /** Set to false to pause scheduling without deleting the spec */
  enabled?: boolean;
}

/** Outcome of the most recent refresh run (written by the executor, not the script) */
export interface PageRefreshStatus {
  /** Completion timestamp (epoch ms) */
  at: number;
  ok: boolean;
  durationMs: number;
  /** Truncated stderr/error when ok is false */
  error?: string;
}

// ============================================================================
// Data snapshot (cross-process contract)
// ============================================================================

/** One timeseries datapoint */
export interface PageSeriesPoint {
  /** Timestamp (epoch ms) */
  t: number;
  /** Numeric value */
  v: number;
}

/**
 * Contents of pages/{slug}/data/snapshot.json — the only page data read
 * outside the refresh script. Always written atomically (tmp + rename).
 */
export interface PageDataSnapshot {
  version: 1;
  /** When the snapshot was exported (epoch ms) */
  generatedAt: number;
  /** Key-value entries (values are JSON-serializable) */
  kv: Record<string, unknown>;
  /** Named timeseries, each ordered by ascending t */
  series: Record<string, PageSeriesPoint[]>;
}

// ============================================================================
// Mediated source actions (grants + leases + requests)
// ============================================================================

/** HTTP methods a page action may use against an API source */
export type PageActionHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * What a grant allows. Descriptors describe classes of calls (path regex),
 * requests carry the concrete invocation which must match the descriptor.
 */
export type PageActionDescriptor =
  | {
      kind: 'api';
      /** API source slug the call is executed against */
      sourceSlug: string;
      method: PageActionHttpMethod;
      /** Regex the request path must fully match (anchored by the broker) */
      pathPattern: string;
    }
  | {
      kind: 'mcp';
      /** MCP source slug the call is executed against */
      sourceSlug: string;
      /** Original (unprefixed) tool name on that server */
      toolName: string;
    }
  | {
      kind: 'script';
      /**
       * Workspace-relative path to the script to run (no leading slash, no ".."
       * segments). Executed via the same argv/no-shell runner as page refreshes.
       */
      script: string;
      /** Runtime used to execute the script (default: 'bun') */
      runtime?: PageScriptRuntime;
      /**
       * Fixed arguments passed to the script. Pinned at approval time — the
       * page cannot supply or alter args at call time, so approving a grant
       * approves an exact command, not a family of them.
       */
      args?: string[];
    };

/**
 * A user-approved capability persisted in page.json. Mirrors the
 * privileged-execution-broker commandHash pattern: bound to the page content
 * digest at approval time (content changes invalidate it) and to an expiry.
 */
export interface PageActionGrant {
  /** Stable id, e.g. grant_1a2b3c4d */
  id: string;
  /** Human-readable purpose shown at approval time */
  description?: string;
  action: PageActionDescriptor;
  /** sha256 hex of the page content this grant was approved for */
  contentDigest: string;
  createdAt: number;
  /** Hard expiry (epoch ms) — expired grants are rejected, never auto-renewed */
  expiresAt: number;
}

/**
 * Short-lived, in-memory authorization to act as one render of one page.
 * Issued when the host mounts the page; the nonce travels into the iframe
 * and must be echoed on every request (frame identity without an Origin).
 */
export interface PageRenderLease {
  leaseId: string;
  /** Random per-lease secret echoed by the page on every request */
  nonce: string;
  pageSlug: string;
  /** Content digest the lease was issued for — a content change ends the lease */
  contentDigest: string;
  issuedAt: number;
  expiresAt: number;
}

/** Concrete invocation carried by a request; must match the grant's descriptor */
export type PageActionInvocation =
  | {
      kind: 'api';
      method: PageActionHttpMethod;
      /** Path under the source's baseUrl (leading slash optional) */
      path: string;
      /** Query params (GET/DELETE) or JSON body (POST/PUT/PATCH) */
      params?: Record<string, unknown>;
    }
  | {
      kind: 'mcp';
      toolName: string;
      args?: Record<string, unknown>;
    }
  | {
      /**
       * Pure trigger: the script, runtime, and args all come from the matched
       * grant descriptor, never from the page. There is nothing to carry here.
       */
      kind: 'script';
    };

/** A page's request to execute a granted source action */
export interface PageActionRequest {
  /** Caller-minted unique id; replayed ids are rejected per lease */
  requestId: string;
  pageSlug: string;
  leaseId: string;
  /** Must equal the lease nonce */
  nonce: string;
  /** Grant that authorizes this invocation */
  grantId: string;
  invocation: PageActionInvocation;
}

/** Result returned to the page (never contains credentials) */
export interface PageActionResult {
  requestId: string;
  ok: boolean;
  /** HTTP status for api-kind invocations */
  status?: number;
  /** Parsed JSON body when possible, otherwise raw text (api) / tool result (mcp) */
  body?: unknown;
  error?: string;
  durationMs: number;
}

// ============================================================================
// Sharing (Cloudflare publication)
// ============================================================================

/**
 * Local pointer to a page's Cloudflare publication. Absent = private.
 *
 * This is display/bookkeeping state only — the remote D1 record stays
 * authoritative, and the admin token that authorizes update/unpublish lives
 * exclusively in the credential vault (`page_publish_token::{ws}::{pageId}`),
 * never here. The public `publicationId` is a view capability, not a
 * mutation credential.
 */
export interface PageShareInfo {
  /** Public publication id (random capability; identifies, never authorizes writes) */
  publicationId: string;
  /** Public URL of the trusted shell, e.g. https://thecraftagents.com/p/{id} */
  url: string;
  /** Remote revision id currently live */
  publishedRevision: string;
  /** sha256 hex of index.html at last successful publish (drift = "update available") */
  publishedContentDigest: string;
  /** Whether the data snapshot was included in the published bundle */
  includesData: boolean;
  /** First successful publish (epoch ms) */
  publishedAt: number;
  /** Last successful publish/update (epoch ms) */
  updatedAt: number;
  passwordProtected: boolean;
  /** Truncated error of the most recent failed publish attempt, if any */
  lastPublishError?: string;
}

// ============================================================================
// Preview thumbnail (cached poster)
// ============================================================================

/**
 * Pointer to a page's cached preview poster at pages/{slug}/thumbnail.jpg.
 *
 * Managed field (written only by `recordPageThumbnail`, excluded from
 * `updatePage`). The poster is generated by Electron's offscreen capture and
 * served as a flat image on every host. It is STALE when `digest` no longer
 * equals the page's current `contentDigest` — the grid then falls back to the
 * placeholder (data-only refreshes deliberately do not invalidate it in v1).
 */
export interface PageThumbnailInfo {
  /** contentDigest the poster was captured for (sha256 hex) */
  digest: string;
  /** Capture timestamp (epoch ms) */
  capturedAt: number;
  /** Stored image pixel dimensions */
  width: number;
  height: number;
}

// ============================================================================
// Page config
// ============================================================================

/**
 * Main page configuration (stored in page.json).
 *
 * page.json is deliberately the last file a refresh run touches: the config
 * watcher reacts to it (and only it) with a `pages:changed` push, so a
 * half-written data/ directory is never observed as "done".
 */
export interface PageConfig {
  schemaVersion: 1;
  /** Stable id, e.g. page_1a2b3c4d */
  id: string;
  slug: string;
  name: string;
  /** Short description shown in lists */
  description?: string;
  /** Runtime capability class (drives sandbox/CSP in the renderer) */
  kind: PageKind;
  /** Stable Project ID this page belongs to (never the project slug) */
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  /** Scheduled data refresh (absent = manual/agent-driven data only) */
  refresh?: PageRefreshSpec;
  /** Outcome of the most recent refresh run */
  lastRefresh?: PageRefreshStatus;
  /** sha256 hex of index.html; absent until content is first saved */
  contentDigest?: string;
  /** User-approved source-action grants (content-digest-bound) */
  grants?: PageActionGrant[];
  /** Cloudflare publication pointer (absent = private) */
  share?: PageShareInfo;
  /** Cached preview poster pointer (absent = none captured yet) */
  thumbnail?: PageThumbnailInfo;
}
