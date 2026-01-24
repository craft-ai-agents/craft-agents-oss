/**
 * God Mode - Dev-only self-building feature
 *
 * Allows the agent to modify Craft Agent's own source code
 * based on visual UI annotations via Agentation.
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import {
  getGodModeConfig,
  setGodModeConfig,
  addWorkspace,
  getWorkspaces,
} from '@craft-agent/shared/config/storage';
import {
  createWorkspaceAtPath,
  isValidWorkspace,
  loadWorkspaceConfig,
  saveWorkspaceConfig,
} from '@craft-agent/shared/workspaces/storage';
import type { GodModeConfig } from '@craft-agent/shared/config/types';
import type { Workspace } from '@craft-agent/core/types';

// Fixed God Mode workspace ID and path
export const GOD_MODE_WORKSPACE_ID = 'god-mode';
export const GOD_MODE_WORKSPACE_NAME = 'God Mode';
export const GOD_MODE_WORKSPACE_PATH = join(homedir(), '.craft-agent', 'workspaces', 'god-mode');

// Default context for the God Mode agent
export const DEFAULT_GOD_MODE_CONTEXT = `You are working in God Mode - a special self-building environment for Craft Agent.

Your working directory is the Craft Agent source code itself. You have the power to modify the application that you're running inside.

When you receive annotations from Agentation:
1. The user has clicked on a UI element and provided feedback
2. The annotation includes an HTML snapshot and CSS selectors
3. Use this information to locate the relevant React component
4. Make the requested changes to improve the UI/UX

Remember:
- This is an Electron + React monorepo
- UI components are in apps/electron/src/renderer/
- Be careful with changes - they affect the running application
- Test your changes by asking the user to reload the app
`;

/**
 * Check if God Mode is available (debug mode only)
 */
export function isGodModeAvailable(isDebugMode: boolean): boolean {
  return isDebugMode;
}

/**
 * Get the God Mode workspace if it exists
 */
export function getGodModeWorkspace(): Workspace | null {
  const workspaces = getWorkspaces();
  return workspaces.find(w => w.id === GOD_MODE_WORKSPACE_ID) || null;
}

/**
 * Initialize the God Mode workspace
 * Creates the workspace folder structure and adds it to the global config
 */
export function initializeGodModeWorkspace(sourcePath: string): { success: boolean; error?: string } {
  try {
    // Validate source path exists
    if (!existsSync(sourcePath)) {
      return { success: false, error: `Source path does not exist: ${sourcePath}` };
    }

    // Check if workspace already exists
    const existing = getGodModeWorkspace();
    if (existing) {
      // Update the workspace config to use the new source path
      const config = loadWorkspaceConfig(GOD_MODE_WORKSPACE_PATH);
      if (config) {
        config.defaults = {
          ...config.defaults,
          workingDirectory: sourcePath,
        };
        saveWorkspaceConfig(GOD_MODE_WORKSPACE_PATH, config);
      }
      return { success: true };
    }

    // Create workspace folder structure if needed
    if (!isValidWorkspace(GOD_MODE_WORKSPACE_PATH)) {
      createWorkspaceAtPath(GOD_MODE_WORKSPACE_PATH, GOD_MODE_WORKSPACE_NAME, {
        workingDirectory: sourcePath,
        permissionMode: 'allow-all', // God Mode needs full permissions
      });
    }

    // Update the workspace config with God Mode ID
    const config = loadWorkspaceConfig(GOD_MODE_WORKSPACE_PATH);
    if (config) {
      config.id = GOD_MODE_WORKSPACE_ID;
      config.name = GOD_MODE_WORKSPACE_NAME;
      config.defaults = {
        ...config.defaults,
        workingDirectory: sourcePath,
      };
      saveWorkspaceConfig(GOD_MODE_WORKSPACE_PATH, config);
    }

    // Add to global workspace list with fixed ID
    addWorkspace(
      {
        name: GOD_MODE_WORKSPACE_NAME,
        rootPath: GOD_MODE_WORKSPACE_PATH,
      },
      { id: GOD_MODE_WORKSPACE_ID }
    );

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get God Mode config from storage
 */
export function getGodModeConfigHandler(): GodModeConfig | null {
  return getGodModeConfig();
}

/**
 * Set God Mode config in storage
 */
export function setGodModeConfigHandler(config: GodModeConfig | null): void {
  setGodModeConfig(config);
}

/**
 * Format an Agentation annotation as a chat message
 */
export function formatAnnotationMessage(annotation: {
  selector: string;
  html: string;
  comment: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}): string {
  const { selector, html, comment, boundingBox } = annotation;

  let message = `## UI Annotation from Agentation

**User Comment:** ${comment}

**Target Element:**
- CSS Selector: \`${selector}\`
${boundingBox ? `- Position: ${boundingBox.x}, ${boundingBox.y} (${boundingBox.width}x${boundingBox.height})` : ''}

**HTML Snapshot:**
\`\`\`html
${html}
\`\`\`

Please help me improve this UI element based on my feedback. Locate the relevant React component and suggest or implement the changes.`;

  return message;
}
