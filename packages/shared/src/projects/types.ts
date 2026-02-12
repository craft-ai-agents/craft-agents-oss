/**
 * Project Types
 *
 * Projects are the primary organizational unit between workspaces and sessions.
 * A project groups related sessions and files together.
 *
 * Directory structure:
 * ~/.craft-agent/workspaces/{workspace-slug}/projects/{project-slug}/
 *   ├── config.json      - Project settings
 *   ├── files/            - User-managed project files
 *   └── guidelines.md     - Optional natural language instructions for AI
 */

/**
 * Project configuration (stored in config.json)
 */
export interface ProjectConfig {
  id: string;                    // e.g., "proj_a1b2c3d4"
  name: string;
  slug: string;                  // URL-safe folder name
  description?: string;          // Optional project description
  guidelines?: string;           // Natural language instructions for AI (inline, short)
  createdAt: number;
  updatedAt: number;
  /** Which workspace sources are enabled for this project's sessions */
  enabledSourceSlugs?: string[];
}

/**
 * Project creation input
 */
export interface CreateProjectInput {
  name: string;
  description?: string;
  guidelines?: string;
  enabledSourceSlugs?: string[];
}

/**
 * Project summary for listing (lightweight)
 */
export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  description?: string;
  sessionCount: number;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
}
