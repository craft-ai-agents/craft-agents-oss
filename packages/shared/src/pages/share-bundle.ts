/**
 * Page Share Bundle
 *
 * Builds the sanitized public bundle for Cloudflare publication. The bundle is
 * constructed field-by-field — never by spreading PageConfig — so local-only
 * state (grants, refresh spec/script paths, store.sqlite, credential ids,
 * lastRefresh errors, project ids) cannot leak into the public copy by
 * accident. What ships is exactly:
 *
 *   - a public manifest (slug, title, description, kind, contentDigest)
 *   - the page's index.html content string
 *   - optionally the current data/snapshot.json (explicit opt-in, default off)
 *
 * "Sanitized" means field-allowlisted — index.html itself ships byte-for-byte,
 * NOT sanitized: XSS/egress containment for the public copy is the Worker's
 * CSP + iframe sandbox, never a transform here.
 *
 * A page with approved source-action grants publishes as a view-only copy:
 * the public shell answers bridge `action` messages with a disabled error and
 * never brokers into the publisher's local sources. Publishing such a page
 * requires an explicit acknowledgment flag.
 *
 * Script-action grants (host command execution) are the exception: such a page
 * cannot be published at all, even as an inert view-only copy. A host-exec
 * capability must never be associated with a public URL — we fail loud rather
 * than silently strip the grant.
 */

import { existsSync, readFileSync } from 'fs';
import type { PageKind } from '@craft-agent/core';
import { isPageGrantUsable } from './types.ts';
import { isSensitiveKeyName } from '../utils/redaction.ts';
import {
  computePageContentDigest,
  getPageSnapshotPath,
  loadPageConfig,
  loadPageContent,
} from './storage.ts';

/** Hard cap on the total published bundle (content + snapshot + manifest) */
export const PAGE_SHARE_MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
/** Hard cap on published index.html */
export const PAGE_SHARE_MAX_CONTENT_BYTES = 5 * 1024 * 1024;
/** Hard cap on the published data snapshot */
export const PAGE_SHARE_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

export type PageShareErrorCode =
  | 'PAGE_NOT_FOUND'
  | 'PAGE_NO_CONTENT'
  | 'PAGE_SHARE_TOO_LARGE'
  | 'PAGE_SHARE_SNAPSHOT_INVALID'
  | 'PAGE_SHARE_ACTIONS_ACK_REQUIRED'
  | 'PAGE_SHARE_SCRIPT_GRANT'
  | 'PAGE_SHARING_DISABLED'
  | 'PAGE_SHARE_TOKEN_MISSING'
  | 'PAGE_SHARE_ALREADY_PUBLISHED'
  | 'PAGE_SHARE_NOT_PUBLISHED'
  | 'PAGE_SHARE_REMOTE_ERROR'
  | 'PAGE_SHARE_VAULT_ERROR';

/** Typed error for the publish pipeline (code survives transport as message prefix) */
export class PageShareError extends Error {
  constructor(
    public readonly code: PageShareErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'PageShareError';
  }
}

/**
 * Sanitized manifest shipped inside the public bundle. Built exclusively from
 * the allowlisted fields below — extending it must stay a conscious decision.
 */
export interface PagePublicManifest {
  version: 1;
  slug: string;
  title: string;
  description?: string;
  kind: PageKind;
  /** sha256 hex of the published index.html */
  contentDigest: string;
  includesData: boolean;
}

export interface PageShareBundle {
  manifest: PagePublicManifest;
  /** Exact index.html string being published */
  content: string;
  /** Serialized snapshot JSON (present only when opted in and available) */
  snapshotJson?: string;
  /** sha256 hex of `content` (same digest family as PageConfig.contentDigest) */
  contentDigest: string;
  totalBytes: number;
}

export interface BuildPageShareBundleOptions {
  /** Publish the current data/snapshot.json alongside the HTML (default: false) */
  includeData: boolean;
  /**
   * Required when the page has approved source-action grants: the caller
   * confirms the user understands the public copy is view-only.
   */
  viewOnlyAcknowledged?: boolean;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf-8');
}

/** Human-readable size for user-facing limit errors ("2.3 MB"). */
function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/**
 * Build the sanitized public bundle for a page, enforcing exclusion and size
 * invariants. Throws PageShareError on any violation.
 */
export function buildPageShareBundle(
  workspaceRootPath: string,
  pageSlug: string,
  options: BuildPageShareBundleOptions,
): PageShareBundle {
  const config = loadPageConfig(workspaceRootPath, pageSlug);
  if (!config) {
    throw new PageShareError('PAGE_NOT_FOUND', `Page not found: ${pageSlug}`);
  }

  const content = loadPageContent(workspaceRootPath, pageSlug);
  if (content === null) {
    throw new PageShareError('PAGE_NO_CONTENT', `Page has no content to publish: ${pageSlug}`);
  }

  // Host command execution must never reach a public URL — refuse outright,
  // ahead of the softer view-only acknowledgment path below.
  if (config.grants?.some((grant) => grant.action.kind === 'script')) {
    throw new PageShareError(
      'PAGE_SHARE_SCRIPT_GRANT',
      'This page has permission to run a script on this computer, so it cannot be published — not even as a view-only copy.',
    );
  }

  // The ack explains a behavior difference: action buttons work locally but
  // not on the public copy. Stale/expired grants don't work locally either,
  // so only usable grants require it. (Script grants were refused above —
  // that check deliberately counts stale ones too.)
  const now = Date.now();
  const hasUsableGrants = (config.grants ?? []).some((grant) =>
    isPageGrantUsable(grant, config.contentDigest, now),
  );
  if (hasUsableGrants && options.viewOnlyAcknowledged !== true) {
    throw new PageShareError(
      'PAGE_SHARE_ACTIONS_ACK_REQUIRED',
      'This page has approved actions. Publishing needs confirmation that the public copy is view-only.',
    );
  }

  const contentBytes = byteLength(content);
  if (contentBytes > PAGE_SHARE_MAX_CONTENT_BYTES) {
    throw new PageShareError(
      'PAGE_SHARE_TOO_LARGE',
      `The page content is too large to publish (${formatMb(contentBytes)}, limit ${formatMb(PAGE_SHARE_MAX_CONTENT_BYTES)}).`,
    );
  }

  let snapshotJson: string | undefined;
  if (options.includeData) {
    const snapshotPath = getPageSnapshotPath(workspaceRootPath, pageSlug);
    if (existsSync(snapshotPath)) {
      const raw = readFileSync(snapshotPath, 'utf-8');
      try {
        JSON.parse(raw);
      } catch {
        throw new PageShareError(
          'PAGE_SHARE_SNAPSHOT_INVALID',
          "The page's data snapshot is damaged. Refresh the page's data, then publish again.",
        );
      }
      const snapshotBytes = byteLength(raw);
      if (snapshotBytes > PAGE_SHARE_MAX_SNAPSHOT_BYTES) {
        throw new PageShareError(
          'PAGE_SHARE_TOO_LARGE',
          `The page's data is too large to publish (${formatMb(snapshotBytes)}, limit ${formatMb(PAGE_SHARE_MAX_SNAPSHOT_BYTES)}).`,
        );
      }
      snapshotJson = raw;
    }
  }

  const contentDigest = computePageContentDigest(content);
  const manifest: PagePublicManifest = {
    version: 1,
    slug: config.slug,
    title: config.name,
    ...(config.description ? { description: config.description } : {}),
    kind: config.kind,
    contentDigest,
    includesData: snapshotJson !== undefined,
  };

  const totalBytes =
    contentBytes + (snapshotJson ? byteLength(snapshotJson) : 0) + byteLength(JSON.stringify(manifest));
  if (totalBytes > PAGE_SHARE_MAX_BUNDLE_BYTES) {
    throw new PageShareError(
      'PAGE_SHARE_TOO_LARGE',
      `The page and its data together are too large to publish (${formatMb(totalBytes)}, limit ${formatMb(PAGE_SHARE_MAX_BUNDLE_BYTES)}).`,
    );
  }

  return { manifest, content, snapshotJson, contentDigest, totalBytes };
}

/** Estimate the publishable snapshot size for UI display (null = no snapshot on disk) */
export function getShareSnapshotSizeBytes(workspaceRootPath: string, pageSlug: string): number | null {
  const snapshotPath = getPageSnapshotPath(workspaceRootPath, pageSlug);
  if (!existsSync(snapshotPath)) return null;
  try {
    return byteLength(readFileSync(snapshotPath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Cap on reported secret-candidate paths (the UI shows a few + a count) */
const MAX_SECRET_CANDIDATES = 20;
const SECRET_SCAN_MAX_DEPTH = 8;

/**
 * Best-effort scan of a snapshot for values that LOOK like secrets, by key
 * name only (same deliberately-broad heuristic as redaction.ts — one source
 * of truth, over-flagging is fine for a warning). Walks `kv` keys and nested
 * object keys plus series names. Returns unique dot-paths, capped. Never
 * throws — a malformed snapshot simply reports no candidates (the publish
 * path itself rejects malformed snapshots separately).
 */
export function scanSnapshotForSecretCandidates(snapshotJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshotJson);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const found = new Set<string>();
  const seen = new WeakSet<object>();

  const visit = (node: unknown, path: string, depth: number): void => {
    if (found.size >= MAX_SECRET_CANDIDATES) return;
    if (!node || typeof node !== 'object' || depth >= SECRET_SCAN_MAX_DEPTH) return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      // Array items keep the parent path — indices are noise in a warning.
      for (const item of node) visit(item, path, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const keyPath = path ? `${path}.${key}` : key;
      if (isSensitiveKeyName(key)) {
        found.add(keyPath);
        if (found.size >= MAX_SECRET_CANDIDATES) return;
      }
      visit(value, keyPath, depth + 1);
    }
  };

  const root = parsed as { kv?: unknown; series?: unknown };
  if (root.kv && typeof root.kv === 'object') visit(root.kv, 'kv', 1);
  if (root.series && typeof root.series === 'object' && !Array.isArray(root.series)) {
    for (const name of Object.keys(root.series)) {
      if (found.size >= MAX_SECRET_CANDIDATES) break;
      if (isSensitiveKeyName(name)) found.add(`series.${name}`);
    }
  }
  return [...found];
}

export interface PageShareDataScan {
  /** Byte size of the snapshot that would publish, or null when none exists */
  snapshotBytes: number | null;
  /** Key paths in the snapshot that look credential-bearing (capped) */
  secretCandidates: string[];
}

/**
 * One-read convenience for the Share dialog: what would `includeData` publish,
 * and does any of it look like a secret?
 */
export function scanPageShareData(workspaceRootPath: string, pageSlug: string): PageShareDataScan {
  const snapshotPath = getPageSnapshotPath(workspaceRootPath, pageSlug);
  if (!existsSync(snapshotPath)) return { snapshotBytes: null, secretCandidates: [] };
  let raw: string;
  try {
    raw = readFileSync(snapshotPath, 'utf-8');
  } catch {
    return { snapshotBytes: null, secretCandidates: [] };
  }
  return { snapshotBytes: byteLength(raw), secretCandidates: scanSnapshotForSecretCandidates(raw) };
}

/** Extract a PageShareErrorCode from any thrown value (transport-safe) */
export function pageShareErrorCode(err: unknown): PageShareErrorCode | null {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const match = message.match(/^(PAGE_[A-Z_]+):/);
  return match ? (match[1] as PageShareErrorCode) : null;
}
