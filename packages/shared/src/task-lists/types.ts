/**
 * Task Lists - Core Type Definitions
 *
 * Provides foundational types for the task list system, enabling structured
 * task management with dependencies, ownership, and metadata tracking.
 */

/**
 * Status of a task in its lifecycle.
 *
 * - `pending`: Task has not been started yet
 * - `in_progress`: Task is currently being worked on
 * - `completed`: Task has been finished
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

/**
 * Represents a single task within a task list.
 *
 * Tasks can have dependencies on other tasks (blockedBy), block other tasks (blocks),
 * and carry arbitrary metadata for extensibility.
 */
export interface Task {
  /**
   * Unique identifier for the task (UUID or similar)
   */
  id: string;

  /**
   * Brief, actionable title in imperative form
   *
   * @example "Fix authentication bug in login flow"
   */
  subject: string;

  /**
   * Detailed description of what needs to be done, including context and acceptance criteria
   */
  description: string;

  /**
   * Present continuous form shown in spinner when task is in_progress
   *
   * @example "Fixing authentication bug"
   */
  activeForm: string;

  /**
   * Current status of the task
   */
  status: TaskStatus;

  /**
   * Agent or user ID who owns/is assigned to this task (optional)
   */
  owner?: string;

  /**
   * Arbitrary metadata for extensibility (e.g., priority, labels, custom fields)
   */
  metadata?: Record<string, unknown>;

  /**
   * Task IDs that this task blocks (cannot start until this one completes)
   */
  blocks: string[];

  /**
   * Task IDs that block this task (must complete before this one can start)
   */
  blockedBy: string[];

  /**
   * Timestamp when the task was created (ISO 8601)
   */
  createdAt: string;

  /**
   * Timestamp when the task was last updated (ISO 8601)
   */
  updatedAt: string;
}

/**
 * Represents a complete task list with all tasks.
 *
 * Task lists organize related tasks and track their dependencies,
 * ownership, and progress.
 */
export interface TaskList {
  /**
   * Unique identifier for the task list (UUID or similar)
   */
  id: string;

  /**
   * Human-readable name for the task list
   *
   * @example "Q1 2026 Feature Development"
   */
  name: string;

  /**
   * Optional description providing context for the task list
   */
  description?: string;

  /**
   * All tasks in this list
   */
  tasks: Task[];

  /**
   * Timestamp when the task list was created (ISO 8601)
   */
  createdAt: string;

  /**
   * Timestamp when the task list was last updated (ISO 8601)
   */
  updatedAt: string;
}

/**
 * Lightweight task list metadata for list views.
 *
 * Omits the full task array for performance when displaying multiple lists.
 * Includes computed statistics for quick overview.
 */
export interface TaskListMeta {
  /**
   * Unique identifier for the task list (UUID or similar)
   */
  id: string;

  /**
   * Human-readable name for the task list
   */
  name: string;

  /**
   * Optional description providing context for the task list
   */
  description?: string;

  /**
   * Total number of tasks in the list
   */
  taskCount: number;

  /**
   * Number of tasks with status 'pending'
   */
  pendingCount: number;

  /**
   * Number of tasks with status 'in_progress'
   */
  inProgressCount: number;

  /**
   * Number of tasks with status 'completed'
   */
  completedCount: number;

  /**
   * Timestamp when the task list was created (ISO 8601)
   */
  createdAt: string;

  /**
   * Timestamp when the task list was last updated (ISO 8601)
   */
  updatedAt: string;
}
