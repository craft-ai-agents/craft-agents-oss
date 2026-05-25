/**
 * Team Knowledge Types
 *
 * Team public knowledge is a workspace-scoped feature that lets teams
 * define a fixed list of Markdown documents (conventions, rules, processes,
 * warnings, background context) that are periodically fetched and cached.
 *
 * Directory structure:
 * ~/.mdp-agent/workspaces/{slug}/
 *   └── teamKnowledge/
 *       └── config.json    - TeamKnowledgeConfig
 */

/**
 * A single team knowledge document.
 * The `id`, `title`, `url`, and `priority` fields are set by config.
 * The remaining fields are populated by the refresh loop.
 */
export interface TeamKnowledgeDoc {
  /** Stable identifier for the document */
  id: string;
  /** Human-readable title */
  title: string;
  /** URL to fetch the Markdown content from */
  url: string;
  /** Priority order (lower = higher priority) */
  priority: number;
  /** SHA-256 hash of the last successfully fetched content */
  contentHash?: string;
  /** Cached Markdown content from the last successful fetch */
  content?: string;
  /** Timestamp of the last successful fetch (epoch ms) */
  lastFetchedAt?: number;
  /** When this entry becomes stale (epoch ms). Entries past this time are excluded from trigger/prefetch results. */
  staleAt?: number;
  /** Error message from the last failed refresh attempt */
  refreshError?: string;
}

/**
 * Workspace configuration for team public knowledge.
 * Stored in teamKnowledge/config.json.
 */
export interface TeamKnowledgeConfig {
  /** Schema version for migrations */
  version: number;
  /** Whether team public knowledge is enabled for this workspace */
  enabled: boolean;
  /** The fixed list of documents to fetch and cache */
  documents: TeamKnowledgeDoc[];
}

/**
 * Summary returned by the refresh loop for debug/UI surfaces.
 * NOT injected into model context.
 */
export interface KnowledgeRefreshSummary {
  /** Number of new documents that were fetched for the first time */
  added: number;
  /** Number of documents whose content hash changed since last refresh */
  updated: number;
  /** Number of documents removed from the config (always 0 — fixed document list) */
  removed: number;
  /** Number of documents that failed to refresh and are now stale */
  stale: number;
  /** Number of stale documents whose content changed when finally fetched — a conflict */
  conflicts: number;
  /** Timestamp of the refresh (epoch ms) */
  timestamp: number;
}

/**
 * A resolved knowledge entry suitable for trigger/prefetch.
 * Only includes documents that have been successfully fetched and are not stale.
 */
export interface TeamKnowledgeEntry {
  id: string;
  title: string;
  url: string;
  priority: number;
  content: string;
  contentHash: string;
  lastFetchedAt: number;
}

/** Current schema version for team knowledge config */
export const TEAM_KNOWLEDGE_CONFIG_VERSION = 1;

/** Default config used when no config file exists */
export const DEFAULT_TEAM_KNOWLEDGE_CONFIG: TeamKnowledgeConfig = {
  version: TEAM_KNOWLEDGE_CONFIG_VERSION,
  enabled: false,
  documents: [],
};

/** Refresh interval: 30 minutes */
export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

/** Stale TTL: 24 hours — cache entries past this age are excluded */
export const STALE_TTL_MS = 24 * 60 * 60 * 1000;
