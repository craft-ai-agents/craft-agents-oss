/**
 * Built-in Sources
 *
 * Project-level sources that ship with RunnerOS.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LoadedSource, FolderSourceConfig } from './types.ts';

const COMPUTER_USE_SLUG = 'computer-use';

function firstExistingPath(candidates: string[]): string {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return resolve(candidate);
  }
  return resolve(candidates.find(Boolean) ?? 'apps/electron/resources/scripts/background-computer-use-mcp.ts');
}

function getComputerUseScriptPath(): string {
  const scriptName = 'background-computer-use-mcp.ts';
  const scriptsRoot = process.env.CRAFT_SCRIPTS;
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath([
    scriptsRoot ? join(scriptsRoot, scriptName) : '',
    resourcesBase ? join(resourcesBase, 'resources', 'scripts', scriptName) : '',
    join(appRoot, 'apps', 'electron', 'resources', 'scripts', scriptName),
    join(appRoot, 'resources', 'scripts', scriptName),
    join(process.cwd(), 'apps', 'electron', 'resources', 'scripts', scriptName),
  ]);
}

/**
 * Get all built-in sources for a workspace.
 *
 * @param workspaceId - The workspace ID
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @returns Built-in project-tier sources
 */
export function getBuiltinSources(workspaceId: string, workspaceRootPath: string): LoadedSource[] {
  return [getComputerUseSource(workspaceId, workspaceRootPath)];
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
 * Get the built-in Craft Agents docs source.
 *
 * @deprecated craft-agents-docs is now an always-available MCP server
 * configured directly in craft-agent.ts. This function is kept for
 * backwards compatibility but returns a placeholder.
 */
export function getDocsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  // Return a placeholder - this shouldn't be called anymore
  const placeholderConfig: FolderSourceConfig = {
    id: 'builtin-craft-agents-docs',
    name: 'Craft Agents Docs',
    slug: 'craft-agents-docs',
    enabled: false,
    provider: 'mintlify',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: 'https://agents.craft.do/docs/mcp',
      authType: 'none',
    },
    tagline: 'Search Craft Agents documentation and source setup guides',
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
  return slug === COMPUTER_USE_SLUG;
}
