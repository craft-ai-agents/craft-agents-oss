/**
 * Status Types
 *
 * Types for configurable session statuses.
 * Statuses are stored at {workspaceRootPath}/statuses/config.json
 *
 * Icon format: Simple string (emoji or URL)
 * - Emoji: "✅", "🔥" - rendered as text
 * - URL: "https://..." - auto-downloaded to statuses/icons/{id}.{ext}
 * - Local files: Stored in statuses/icons/{id}.svg (auto-discovered)
 *
 * Priority: local file > URL (downloaded) > emoji
 */

/**
 * Status category determines filtering behavior:
 * - 'open': Appears in inbox (listInboxSessions)
 * - 'closed': Appears in archive (listCompletedSessions)
 */
export type StatusCategory = 'open' | 'closed';

/**
 * Status configuration (stored in statuses/config.json)
 */
export interface StatusConfig {
  /** Unique ID (slug-style: 'todo', 'in-progress', 'my-custom-status') */
  id: string;

  /** Display name */
  label: string;

  /** Optional color (hex code or Tailwind class). If omitted, uses design system defaults. */
  color?: string;

  /**
   * Icon: emoji or URL (auto-downloaded)
   * - Emoji: "✅", "🔥" - rendered as text
   * - URL: "https://..." - auto-downloaded to statuses/icons/{id}.{ext}
   * - Omit to use auto-discovered local file (statuses/icons/{id}.svg)
   */
  icon?: string;

  /** Category (open = inbox, closed = archive) */
  category: StatusCategory;

  /** If true, cannot be deleted/renamed (todo, done, cancelled) */
  isFixed: boolean;

  /** If true, can be modified but not deleted (in-progress, needs-review) */
  isDefault: boolean;

  /** Display order in UI (lower = first) */
  order: number;
}

/**
 * Complete status configuration for a workspace
 */
export interface WorkspaceStatusConfig {
  /** Schema version for migrations (start at 1) */
  version: number;

  /** Array of status configurations */
  statuses: StatusConfig[];

  /** Default status ID for new sessions (typically 'todo') */
  defaultStatusId: string;
}

/**
 * Input for creating a new status (via CRUD operations)
 */
export interface CreateStatusInput {
  label: string;
  color?: string;
  icon?: string; // Emoji or URL
  category: StatusCategory;
}

/**
 * Input for updating an existing status
 */
export interface UpdateStatusInput {
  label?: string;
  color?: string;
  icon?: string; // Emoji or URL
  category?: StatusCategory;
}
