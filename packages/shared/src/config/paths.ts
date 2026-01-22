/**
 * Centralized path configuration for Vesper.
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

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.craft-agent/ for production and non-numbered dev folders
export const CONFIG_DIR = process.env.CRAFT_CONFIG_DIR || join(homedir(), '.craft-agent');

// Global skills directories (where skills are stored)
export const GLOBAL_SKILLS_DIR = join(CONFIG_DIR, 'global-skills');
export const CLAUDE_CODE_SKILLS_DIR = join(homedir(), '.claude', 'skills');

// Claude Code commands directory (where slash commands are stored)
// Commands at ~/.claude/commands/ will be auto-loaded as skills
export const CLAUDE_CODE_COMMANDS_DIR = join(homedir(), '.claude', 'commands');

// Plugin root directories (parent dirs that SDK receives as plugins)
// SDK expects: {plugin-root}/.claude-plugin/plugin.json and {plugin-root}/skills/
export const CLAUDE_CODE_PLUGIN_DIR = join(homedir(), '.claude');
