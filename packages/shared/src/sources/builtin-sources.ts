/**
 * Built-in Sources
 *
 * Project-level sources that ship with RunnerOS.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LoadedSource, FolderSourceConfig } from './types.ts';

const COMPUTER_USE_SLUG = 'computer-use';
const FIELD_THEORY_SLUG = 'field-theory';
const PRINTING_PRESS_SOCIAL_SLUG = 'printing-press-social';

function firstExistingPath(candidates: string[], fallback: string): string {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return resolve(candidate);
  }
  return resolve(candidates.find(Boolean) ?? fallback);
}

function getResourceScriptPath(scriptName: string): string {
  const scriptsRoot = process.env.CRAFT_SCRIPTS;
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      scriptsRoot ? join(scriptsRoot, scriptName) : '',
      resourcesBase ? join(resourcesBase, 'resources', 'scripts', scriptName) : '',
      join(appRoot, 'apps', 'electron', 'resources', 'scripts', scriptName),
      join(appRoot, 'resources', 'scripts', scriptName),
      join(process.cwd(), 'apps', 'electron', 'resources', 'scripts', scriptName),
    ],
    join('apps', 'electron', 'resources', 'scripts', scriptName)
  );
}

function getComputerUseScriptPath(): string {
  return getResourceScriptPath('background-computer-use-mcp.ts');
}

function getFieldTheoryScriptPath(): string {
  return getResourceScriptPath('field-theory-mcp.ts');
}

function getPrintingPressSocialPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'printing-press-social') : '',
      join(appRoot, 'tools', 'printing-press-social'),
      join(process.cwd(), 'tools', 'printing-press-social'),
    ],
    join('tools', 'printing-press-social')
  );
}

/**
 * Get all built-in sources for a workspace.
 *
 * @param workspaceId - The workspace ID
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @returns Built-in project-tier sources
 */
export function getBuiltinSources(workspaceId: string, workspaceRootPath: string): LoadedSource[] {
  return [
    getComputerUseSource(workspaceId, workspaceRootPath),
    getFieldTheorySource(workspaceId, workspaceRootPath),
    getPrintingPressSocialSource(workspaceId, workspaceRootPath),
  ];
}

/**
 * Built-in source for the local BackgroundComputerUse runtime.
 *
 * It is globally available as a project source, but it only becomes part of a
 * session when an agent/session explicitly enables the `computer-use` source.
 */
export function getComputerUseSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-computer-use',
    name: 'Computer Use',
    slug: COMPUTER_USE_SLUG,
    enabled: true,
    provider: 'background-computer-use',
    type: 'mcp',
    mcp: {
      transport: 'stdio',
      command: process.env.CRAFT_BUN || 'bun',
      args: ['run', getComputerUseScriptPath()],
      authType: 'none',
    },
    tagline: 'Inspect and control local macOS app windows with screenshot-backed tools.',
    icon: '🖥️',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Computer Use',
        '',
        'Use this source when the user explicitly wants a local desktop app controlled or inspected.',
        '',
        'Workflow:',
        '1. Call `computer_use_status` first.',
        '2. Call `computer_use_list_apps` and `computer_use_list_windows` to find the target.',
        '3. Call `computer_use_observe_window` before every meaningful UI action.',
        '4. Prefer semantic targets from the observed accessibility tree. Use coordinates only when needed.',
        '5. Ask the user before submit, send, purchase, delete, credential entry, or any irreversible action.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for Field Theory local X/Twitter bookmarks and Library notes.
 *
 * This source intentionally exposes read/search tools only. Sync, auth,
 * mutation, and Library write operations stay out of the agent tool surface.
 */
export function getFieldTheorySource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-field-theory',
    name: 'Field Theory',
    slug: FIELD_THEORY_SLUG,
    enabled: true,
    provider: 'field-theory',
    type: 'mcp',
    mcp: {
      transport: 'stdio',
      command: process.env.CRAFT_BUN || 'bun',
      args: ['run', getFieldTheoryScriptPath()],
      authType: 'none',
    },
    tagline: 'Search local X/Twitter bookmarks, Library notes, and portable commands.',
    icon: '🔖',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Field Theory',
        '',
        'Use this source when the user mentions Field Theory, X/Twitter bookmarks, saved tweets, Library notes, or portable commands.',
        '',
        'Use read-only tools only:',
        '- `field_theory_status` and `field_theory_stats` for setup and archive overview.',
        '- `field_theory_search_bookmarks`, `field_theory_list_bookmarks`, and `field_theory_show_bookmark` for saved X/Twitter posts.',
        '- `field_theory_search_library` and `field_theory_show_library_page` for durable local notes.',
        '- `field_theory_list_commands` and `field_theory_show_command` for portable command context.',
        '',
        'Do not dump raw results. Summarize findings and connect them to the user’s current task.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for bundled direct-browser social media CLIs.
 *
 * This is intentionally a local CLI source, not MCP/API. Live account setup
 * still belongs to the user because Instagram/TikTok/X/YouTube sessions cannot
 * be pre-shipped.
 */
export function getPrintingPressSocialSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getPrintingPressSocialPath();
  const config: FolderSourceConfig = {
    id: 'builtin-printing-press-social',
    name: 'Printing Press Social',
    slug: PRINTING_PRESS_SOCIAL_SLUG,
    enabled: true,
    provider: 'printing-press-clis',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Direct-browser CLIs for Instagram, TikTok, X, and YouTube channel work.',
    icon: '📣',
    isAuthenticated: true,
    connectionStatus: existsSync(toolPath) ? 'connected' : 'failed',
    connectionError: existsSync(toolPath) ? undefined : 'Bundled Printing Press Social tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Printing Press Social',
        '',
        'Use this source for agent-operated social channel work through the bundled local CLI harness.',
        '',
        'Workflow:',
        '1. Use the displayed local path as the working directory.',
        '2. Run `node src/social.mjs doctor --json` before channel work.',
        '3. Run `node src/social.mjs doctor --live --json` before claiming a profile is ready.',
        '4. Default engine is `runner-cdp`: use CLI output as the action contract/plan, then execute through Runner native browser tools.',
        '5. Dry-run posts, comments, and DMs with `--dry-run --json` before live execution.',
        '6. Ask for explicit approval before any live post, comment, or DM.',
        '',
        'Supported platforms: instagram, tiktok, x, youtube.',
        'Do not use Computer Use for these flows unless the user explicitly asks. Prefer Runner browser/CDP tools; Playwright is fallback-only.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Get the built-in Runner docs source.
 *
 * @deprecated docs are now provided by an optional configured MCP server
 * configured directly in craft-agent.ts. This function is kept for
 * backwards compatibility but returns a placeholder.
 */
export function getDocsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  // Return a placeholder - this shouldn't be called anymore
  const placeholderConfig: FolderSourceConfig = {
    id: 'builtin-runner-docs',
    name: 'Runner Docs',
    slug: 'runner-docs',
    enabled: false,
    provider: 'mintlify',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: process.env.RUNNER_DOCS_MCP_URL?.trim() || '',
      authType: 'none',
    },
    tagline: 'Search Runner documentation and source setup guides',
    icon: '📚',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config: placeholderConfig,
    guide: { raw: '' },
    isBuiltin: true,
  };
}

/**
 * Check if a source slug is a built-in source.
 *
 * @param slug - Source slug to check
 * @returns true when the slug is reserved by a built-in source
 */
export function isBuiltinSource(slug: string): boolean {
  return slug === COMPUTER_USE_SLUG || slug === FIELD_THEORY_SLUG || slug === PRINTING_PRESS_SOCIAL_SLUG;
}
