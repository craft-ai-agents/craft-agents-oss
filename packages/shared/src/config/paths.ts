/**
 * Centralized path configuration for Vesper.
 *
 * Supports multi-instance development via VESPER_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., craft-tui-agent-1), the detect-instance.sh
 * script sets VESPER_CONFIG_DIR to ~/.vesper-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.vesper/
 * Instance 1 (-1 suffix): ~/.vesper-1/
 * Instance 2 (-2 suffix): ~/.vesper-2/
 */

import { homedir } from 'os';
import { join } from 'path';

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.vesper/ for production and non-numbered dev folders
export const CONFIG_DIR = process.env.VESPER_CONFIG_DIR || join(homedir(), '.vesper');

// Global skills directory (where user-installed skills are stored)
export const GLOBAL_SKILLS_DIR = join(CONFIG_DIR, 'global-skills');

// Team skills directory (synced from private GitHub repo)
export const TEAM_SKILLS_DIR = join(CONFIG_DIR, 'team-skills');

// Claude Code skills directory (built-in skills)
export const CLAUDE_CODE_SKILLS_DIR = join(homedir(), '.claude', 'skills');

// Claude Code commands directory (where slash commands are stored)
// Commands at ~/.claude/commands/ will be auto-loaded as skills
export const CLAUDE_CODE_COMMANDS_DIR = join(homedir(), '.claude', 'commands');

// Plugin root directories (parent dirs that SDK receives as plugins)
// SDK expects: {plugin-root}/.claude-plugin/plugin.json and {plugin-root}/skills/
export const CLAUDE_CODE_PLUGIN_DIR = join(homedir(), '.claude');
