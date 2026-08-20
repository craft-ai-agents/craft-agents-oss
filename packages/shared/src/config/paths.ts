/**
 * Centralized path configuration for Craft Agent.
 *
 * Supports multi-instance development via CRAFT_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., craft-tui-agent-1), the detect-instance.sh
 * script sets CRAFT_CONFIG_DIR to ~/.craft-agent-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.craft-agent/
 * Instance 1 (-1 suffix): ~/.craft-agent-1/
 * Instance 2 (-2 suffix): ~/.craft-agent-2/
 */

import { getConfigDir } from './owned-root-policy.ts';

export { getConfigDir, setOwnedRootAdapter } from './owned-root-policy.ts';

// Eager snapshot kept for existing importers. New code should call getConfigDir().
export const CONFIG_DIR = getConfigDir();
