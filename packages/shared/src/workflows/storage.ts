/**
 * Workflow Storage
 *
 * CRUD operations for workspace workflows.
 * Workflows are stored in {workspace}/workflows/{slug}/ directories.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type { LoadedWorkflow, WorkflowMetadata, WorkflowKnowledgeFile } from './types.ts';
import { getWorkspaceWorkflowsPath } from '../workspaces/storage.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
  isIconUrl,
} from '../utils/icon.ts';

// ============================================================
// Parsing
// ============================================================

/**
 * Parse WORKFLOW.md content and extract frontmatter + body
 */
function parseWorkflowFile(content: string): { metadata: WorkflowMetadata; body: string } | null {
  try {
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name || !parsed.data.description) {
      return null;
    }

    // Validate and extract optional icon field
    const icon = validateIconValue(parsed.data.icon, 'Workflows');

    return {
      metadata: {
        name: parsed.data.name as string,
        description: parsed.data.description as string,
        icon,
      },
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Knowledge Loading
// ============================================================

/**
 * Load all knowledge files from a workflow's knowledge/ subdirectory
 */
function loadWorkflowKnowledge(workflowDir: string): WorkflowKnowledgeFile[] {
  const knowledgeDir = join(workflowDir, 'knowledge');

  if (!existsSync(knowledgeDir) || !statSync(knowledgeDir).isDirectory()) {
    return [];
  }

  const files: WorkflowKnowledgeFile[] = [];

  try {
    const entries = readdirSync(knowledgeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      // Only load markdown files
      if (!entry.name.endsWith('.md')) continue;

      try {
        const content = readFileSync(join(knowledgeDir, entry.name), 'utf-8');
        files.push({ name: entry.name, content });
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Ignore errors reading knowledge directory
  }

  return files;
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single workflow from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Workflow directory name
 */
export function loadWorkflow(workspaceRoot: string, slug: string): LoadedWorkflow | null {
  const workflowsDir = getWorkspaceWorkflowsPath(workspaceRoot);
  const workflowDir = join(workflowsDir, slug);
  const workflowFile = join(workflowDir, 'WORKFLOW.md');

  // Check directory exists
  if (!existsSync(workflowDir) || !statSync(workflowDir).isDirectory()) {
    return null;
  }

  // Check WORKFLOW.md exists
  if (!existsSync(workflowFile)) {
    return null;
  }

  // Read and parse WORKFLOW.md
  let content: string;
  try {
    content = readFileSync(workflowFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseWorkflowFile(content);
  if (!parsed) {
    return null;
  }

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    knowledgeFiles: loadWorkflowKnowledge(workflowDir),
    iconPath: findIconFile(workflowDir),
    path: workflowDir,
  };
}

/**
 * Load all workflows from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadWorkspaceWorkflows(workspaceRoot: string): LoadedWorkflow[] {
  const workflowsDir = getWorkspaceWorkflowsPath(workspaceRoot);

  if (!existsSync(workflowsDir)) {
    return [];
  }

  const workflows: LoadedWorkflow[] = [];

  try {
    const entries = readdirSync(workflowsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const workflow = loadWorkflow(workspaceRoot, entry.name);
      if (workflow) {
        workflows.push(workflow);
      }
    }
  } catch {
    // Ignore errors reading workflows directory
  }

  return workflows;
}

/**
 * Get icon path for a workflow
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Workflow directory name
 */
export function getWorkflowIconPath(workspaceRoot: string, slug: string): string | null {
  const workflowsDir = getWorkspaceWorkflowsPath(workspaceRoot);
  const workflowDir = join(workflowsDir, slug);

  if (!existsSync(workflowDir)) {
    return null;
  }

  return findIconFile(workflowDir) || null;
}

// ============================================================
// Delete Operations
// ============================================================

/**
 * Delete a workflow from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Workflow directory name
 */
export function deleteWorkflow(workspaceRoot: string, slug: string): boolean {
  const workflowsDir = getWorkspaceWorkflowsPath(workspaceRoot);
  const workflowDir = join(workflowsDir, slug);

  if (!existsSync(workflowDir)) {
    return false;
  }

  try {
    rmSync(workflowDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Check if a workflow exists in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Workflow directory name
 */
export function workflowExists(workspaceRoot: string, slug: string): boolean {
  const workflowsDir = getWorkspaceWorkflowsPath(workspaceRoot);
  const workflowDir = join(workflowsDir, slug);
  const workflowFile = join(workflowDir, 'WORKFLOW.md');

  return existsSync(workflowDir) && existsSync(workflowFile);
}

/**
 * List workflow slugs in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function listWorkflowSlugs(workspaceRoot: string): string[] {
  const workflowsDir = getWorkspaceWorkflowsPath(workspaceRoot);

  if (!existsSync(workflowsDir)) {
    return [];
  }

  try {
    return readdirSync(workflowsDir, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        const workflowFile = join(workflowsDir, entry.name, 'WORKFLOW.md');
        return existsSync(workflowFile);
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// ============================================================
// Icon Download (uses shared utilities)
// ============================================================

/**
 * Download an icon from a URL and save it to the workflow directory.
 * Returns the path to the downloaded icon, or null on failure.
 */
export async function downloadWorkflowIcon(
  workflowDir: string,
  iconUrl: string
): Promise<string | null> {
  return downloadIcon(workflowDir, iconUrl, 'Workflows');
}

/**
 * Check if a workflow needs its icon downloaded.
 * Returns true if metadata has a URL icon and no local icon file exists.
 */
export function workflowNeedsIconDownload(workflow: LoadedWorkflow): boolean {
  return needsIconDownload(workflow.metadata.icon, workflow.iconPath);
}

// Re-export icon utilities for convenience
export { isIconUrl } from '../utils/icon.ts';
