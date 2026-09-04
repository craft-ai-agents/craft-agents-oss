/**
 * Centralized path configuration for Jonwork.
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

import { homedir } from 'os';
import { join } from 'path';
import { DESKTOP_RELEASE } from '../deployment';

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.craft-agent/ for production and non-numbered dev folders
// Production installs never implicitly open or overwrite the upstream profile.
// Legacy paths remain opt-in; migrating customer data requires a verified backup.
export const CONFIG_DIR = process.env.JONWORK_CONFIG_DIR || process.env.CRAFT_CONFIG_DIR
  || join(homedir(), DESKTOP_RELEASE.channel === 'production' ? '.jonwork' : '.craft-agent');
