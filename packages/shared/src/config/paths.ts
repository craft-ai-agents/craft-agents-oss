/**
 * Centralized path configuration for MDP.
 *
 * Supports multi-instance development via CRAFT_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., craft-tui-agent-1), the detect-instance.sh
 * script sets CRAFT_CONFIG_DIR to ~/.mdp-agent-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.mdp-agent/
 * Instance 1 (-1 suffix): ~/.mdp-agent-1/
 * Instance 2 (-2 suffix): ~/.mdp-agent-2/
 */

import { homedir } from 'os';
import { join } from 'path';

// Expand leading ~ in a path. On Windows, ~ is not expanded by the shell or Node.js,
// so a user-set CRAFT_CONFIG_DIR=~/.mdp-agent would create a literal "~" directory.
function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.mdp-agent/ for production and non-numbered dev folders
const rawConfigDir = process.env.CRAFT_CONFIG_DIR;
export const CONFIG_DIR = rawConfigDir
  ? expandTilde(rawConfigDir)
  : join(homedir(), '.mdp-agent');
