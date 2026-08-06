/**
 * Pi Backend Constants
 *
 * Shared constants used by the Pi agent and its event adapter.
 * Extracted here to avoid circular imports between pi-agent.ts and event-adapter.ts.
 */

import type { ThinkingLevel as PiThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ThinkingLevel } from '../../thinking-levels.ts';

/**
 * Map Craft's {@link ThinkingLevel} to Pi's `ThinkingLevel`.
 * All levels pass through 1:1 — Pi clamps per model internally
 * (`clampThinkingLevel` in pi-ai), so `max` degrades to the model's
 * ceiling on models without native max support (e.g. GPT-5.6 accepts
 * it natively, older GPT-5.x fall back to xhigh).
 */
export const THINKING_TO_PI: Record<ThinkingLevel, PiThinkingLevel> = {
  off: 'off',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
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
