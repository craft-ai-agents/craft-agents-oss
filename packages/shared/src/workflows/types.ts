/**
 * Workflow Types
 *
 * Type definitions for workspace workflows.
 * Workflows are reusable, named instruction sets that users invoke via /slug.
 */

/**
 * Workflow metadata from WORKFLOW.md YAML frontmatter
 */
export interface WorkflowMetadata {
  /** Display name for the workflow */
  name: string;
  /** Brief description shown in workflow list */
  description: string;
  /**
   * Optional icon - emoji or URL only.
   * - Emoji: rendered directly in UI (e.g., "⚖️")
   * - URL: auto-downloaded to icon.{ext} file
   */
  icon?: string;
}

/**
 * A knowledge file bundled with a workflow
 */
export interface WorkflowKnowledgeFile {
  /** Filename (e.g., "contract-review.md") */
  name: string;
  /** Full file content */
  content: string;
}

/**
 * A loaded workflow with parsed content
 */
export interface LoadedWorkflow {
  /** Directory name (slug) */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: WorkflowMetadata;
  /** Full WORKFLOW.md content (without frontmatter) */
  content: string;
  /** Knowledge files from knowledge/ subdirectory */
  knowledgeFiles: WorkflowKnowledgeFile[];
  /** Absolute path to icon file if exists */
  iconPath?: string;
  /** Absolute path to workflow directory */
  path: string;
}
