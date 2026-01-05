/**
 * Status Types
 *
 * Types for configurable session statuses.
 * Statuses are stored at {workspaceRootPath}/statuses/config.json
 */

/**
 * Status category determines filtering behavior:
 * - 'open': Appears in inbox (listInboxSessions)
 * - 'closed': Appears in archive (listCompletedSessions)
 */
export type StatusCategory = 'open' | 'closed';

/**
 * Status icon representation
 */
export interface StatusIcon {
  /**
   * Icon type:
   * - 'emoji': Unicode emoji character (e.g., "✅", "🔥")
   * - 'file': Filename in statuses/icons/ directory (e.g., "todo.svg", "custom.png")
   */
  type: 'emoji' | 'file';

  /**
   * Icon value:
   * - For emoji: the Unicode character
   * - For file: the filename (SVG, PNG, JPG, etc.)
   */
  value: string;
}

/**
 * Status configuration (stored in statuses/config.json)
 */
export interface StatusConfig {
  /** Unique ID (slug-style: 'todo', 'in-progress', 'my-custom-status') */
  id: string;

  /** Display name */
  label: string;

  /** Hex color code (e.g., '#3B82F6') */
  color: string;

  /** Icon configuration */
  icon: StatusIcon;

  /** Single char keyboard shortcut (optional) */
  shortcut?: string;

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
  color: string;
  icon: StatusIcon;
  shortcut?: string;
  category: StatusCategory;
}

/**
 * Input for updating an existing status
 */
export interface UpdateStatusInput {
  label?: string;
  color?: string;
  icon?: StatusIcon;
  shortcut?: string | null;  // null to remove
  category?: StatusCategory;
}
