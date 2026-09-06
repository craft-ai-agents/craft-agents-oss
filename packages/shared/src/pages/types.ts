/**
 * Page Types (shared layer)
 *
 * The domain/protocol types live in @craft-agent/core (renderer-safe); this
 * module re-exports them and adds the storage-layer shapes that carry
 * absolute paths or creation inputs.
 *
 * File structure: see the docblock in @craft-agent/core types/page.ts.
 */

import type { PageActionGrant, PageConfig, PageKind, PageRefreshSpec } from '@craft-agent/core';

// Re-export the core page types so consumers can import everything from
// '@craft-agent/shared/pages' (mirrors how sources/projects expose types).
export type {
  PageKind,
  PageScriptRuntime,
  PageRefreshSpec,
  PageRefreshStatus,
  PageSeriesPoint,
  PageDataSnapshot,
  PageActionHttpMethod,
  PageActionDescriptor,
  PageActionGrant,
  PageRenderLease,
  PageActionInvocation,
  PageActionRequest,
  PageActionResult,
  PageShareInfo,
  PageThumbnailInfo,
  PageConfig,
} from '@craft-agent/core';

/**
 * Whether a grant is currently usable: bound to the given content digest and
 * not expired. The single definition of "usable"/"stale" — the render frame,
 * the publish ack requirement, and the get_page stale flag must all agree.
 * Pure and browser-safe (this module is imported by the renderer).
 */
export function isPageGrantUsable(
  grant: Pick<PageActionGrant, 'contentDigest' | 'expiresAt'>,
  contentDigest: string | undefined,
  now: number,
): boolean {
  return contentDigest !== undefined && grant.contentDigest === contentDigest && grant.expiresAt > now;
}

/**
 * Whether a request path contains a directory-traversal segment. Page API
 * invocations are matched against an anchored grant pattern and then handed to
 * fetch, which normalizes `..` — so a grant for `/repos/.*` could otherwise be
 * abused to reach `/repos/../../admin`. Reject such paths before the match so
 * match and execution can never disagree. Decodes one percent-layer first so
 * encoded forms (`%2e%2e`, `..%2f`) are caught too; a malformed encoding is
 * treated as unsafe. Pure and browser-safe — the server-side PageActionBroker
 * (authoritative) and the renderer page-bridge (defense-in-depth) both call it.
 */
export function hasPathTraversal(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true; // malformed percent-encoding — treat as unsafe
  }
  return decoded.split(/[/\\]/).includes('..');
}

/**
 * Page creation input (without auto-generated fields)
 */
export interface CreatePageInput {
  name: string;
  description?: string;
  /** Runtime capability class (default: 'interactive') */
  kind?: PageKind;
  /** Stable Project ID to bind this page to */
  projectId?: string;
  /** Initial index.html content (sets contentDigest when provided) */
  content?: string;
  refresh?: PageRefreshSpec;
}

/**
 * Fully loaded page (config + folder paths)
 */
export interface LoadedPage {
  config: PageConfig;
  /** Absolute path to the page folder */
  folderPath: string;
  /** Absolute path to index.html (may not exist yet) */
  contentPath: string;
  /** Absolute path to the data/ folder */
  dataPath: string;
  /** Absolute path to data/snapshot.json (may not exist yet) */
  snapshotPath: string;
  /** Absolute path to workspace folder */
  workspaceRootPath: string;
  /** Workspace this page belongs to (derived from basename of workspaceRootPath) */
  workspaceId: string;
}
