/**
 * Team Knowledge Refresh Loop
 *
 * Periodically fetches configured Markdown documents, computes content
 * hashes for change detection, and marks documents stale on failure.
 * Knowledge entries older than 24 hours (staleAt) are excluded from
 * trigger/prefetch results.
 */

import { createHash } from 'crypto';
import type { KnowledgeRefreshSummary } from './types.ts';
import { STALE_TTL_MS } from './types.ts';
import { loadTeamKnowledgeConfig, saveTeamKnowledgeConfig } from './storage.ts';

/**
 * Default fetch function used by refreshTeamKnowledge.
 * Exported so tests can override it.
 */
let _fetch: typeof globalThis.fetch = globalThis.fetch;

/**
 * Override the fetch function used by refreshTeamKnowledge.
 * Intended for tests to avoid real HTTP calls.
 */
export function setFetch(fn: typeof globalThis.fetch): void {
  _fetch = fn;
}

/**
 * Reset fetch back to the default global fetch.
 */
export function resetFetch(): void {
  _fetch = globalThis.fetch;
}

/**
 * Refresh all configured team knowledge documents for a workspace.
 *
 * For each document:
 * 1. Fetches the URL
 * 2. Computes SHA-256 content hash
 * 3. Updates cached content, hash, and fresh/stale metadata
 * 4. On failure: marks the document stale immediately
 *
 * Returns a KnowledgeRefreshSummary with counts of:
 *  - added: first successful fetch for a document
 *  - updated: content hash changed (and doc wasn't previously stale)
 *  - stale: refresh failed (newly stale)
 *  - conflicts: stale doc refreshed successfully but content changed
 *
 * The summary is designed for debug/UI surfaces and is NOT injected
 * into model context.
 */
export async function refreshTeamKnowledge(
  workspaceRootPath: string,
): Promise<KnowledgeRefreshSummary> {
  const config = loadTeamKnowledgeConfig(workspaceRootPath);

  if (!config.enabled) {
    return { added: 0, updated: 0, removed: 0, stale: 0, conflicts: 0, timestamp: Date.now() };
  }

  const now = Date.now();
  const summary: KnowledgeRefreshSummary = {
    added: 0,
    updated: 0,
    removed: 0,
    stale: 0,
    conflicts: 0,
    timestamp: now,
  };

  for (const doc of config.documents) {
    const wasStale = doc.staleAt !== undefined && doc.staleAt < now;
    const previousHash = doc.contentHash;

    try {
      const response = await _fetch(doc.url, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text') && !contentType.includes('markdown') && contentType && !contentType.includes('plain')) {
        // Non-text responses are treated as failures
        throw new Error(`Unexpected content type: ${contentType}`);
      }

      const content = await response.text();
      const contentHash = createHash('sha256').update(content, 'utf-8').digest('hex');

      doc.content = content;
      doc.contentHash = contentHash;
      doc.lastFetchedAt = now;
      doc.staleAt = now + STALE_TTL_MS;
      doc.refreshError = undefined;

      if (!previousHash) {
        // First time this document has been successfully fetched
        summary.added++;
      } else if (previousHash !== contentHash) {
        // Content changed
        if (wasStale) {
          // Was stale and content changed — conflict
          summary.conflicts++;
        } else {
          summary.updated++;
        }
      }
    } catch (error) {
      // Mark as stale immediately
      doc.refreshError = error instanceof Error ? error.message : String(error);
      doc.staleAt = now - 1; // Immediately stale

      if (!wasStale) {
        // Previously fresh, now failing = newly stale
        summary.stale++;
      }
    }
  }

  saveTeamKnowledgeConfig(workspaceRootPath, config);
  return summary;
}
