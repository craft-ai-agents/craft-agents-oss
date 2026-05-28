/**
 * Pi Backend Constants
 *
 * Shared constants used by the Pi agent and its event adapter.
 * Extracted here to avoid circular imports between pi-agent.ts and event-adapter.ts.
 */

import type { ThinkingEnabled } from '../../thinking-toggle.ts';
import type { ThinkingLevel as PiThinkingLevel } from '@mariozechner/pi-agent-core';

/**
 * Map Craft's boolean thinking toggle to Pi's reasoning setting.
 */
export const THINKING_ENABLED_TO_PI: Record<`${ThinkingEnabled}`, PiThinkingLevel> = {
  false: 'off',
  true: 'medium',
};

/**
 * Map Pi SDK lowercase tool names to PascalCase names used by our permission system.
 * Pi's built-in tools use lowercase names (e.g., 'read', 'bash') but
 * ALWAYS_ALLOWED_TOOLS and shouldAllowToolInMode expect PascalCase (e.g., 'Read', 'Bash').
 *
 * Used by PiAgent (permission enforcement) and PiEventAdapter (tool name normalization).
 */
export const PI_TOOL_NAME_MAP: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  grep: 'Grep',
  find: 'Find',
  ls: 'Ls',
  // Additional mappings for possible tool names
  multi_edit: 'MultiEdit',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  notebook_edit: 'NotebookEdit',
  glob: 'Glob',
  task: 'Task',
};
