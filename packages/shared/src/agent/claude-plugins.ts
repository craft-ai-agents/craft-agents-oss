import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { debug } from '../utils/debug.ts';

type SdkPluginConfig = NonNullable<Options['plugins']>[number];

interface InstalledPluginEntry {
  scope: 'user' | 'project';
  installPath: string;
  version: string;
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, InstalledPluginEntry[]>;
}

interface ClaudeSettingsFile {
  enabledPlugins?: Record<string, boolean>;
}

/**
 * Discover plugins installed via the Claude Code CLI marketplace.
 *
 * Reads:
 *   $CLAUDE_CONFIG_DIR/plugins/installed_plugins.json  (install paths)
 *   $CLAUDE_CONFIG_DIR/settings.json                   (enabledPlugins map)
 *
 * Returns SdkPluginConfig[] suitable for the SDK's `plugins` option.
 * Silently returns [] on any read/parse error so the agent still boots.
 *
 * Set CRAFT_DISABLE_CLAUDE_PLUGINS=1 to force-disable (CI / multi-tenant).
 */
export function discoverEnabledClaudePlugins(): SdkPluginConfig[] {
  if (process.env.CRAFT_DISABLE_CLAUDE_PLUGINS === '1') {
    debug('[claude-plugins] disabled by CRAFT_DISABLE_CLAUDE_PLUGINS=1');
    return [];
  }

  try {
    const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
    const installedFile = join(claudeHome, 'plugins', 'installed_plugins.json');
    const settingsFile = join(claudeHome, 'settings.json');

    if (!existsSync(installedFile)) {
      debug('[claude-plugins] no installed_plugins.json — skipping plugin load');
      return [];
    }

    const installed = JSON.parse(readFileSync(installedFile, 'utf8')) as InstalledPluginsFile;
    const enabled: Record<string, boolean> = existsSync(settingsFile)
      ? (JSON.parse(readFileSync(settingsFile, 'utf8')) as ClaudeSettingsFile).enabledPlugins ?? {}
      : {};

    const result: SdkPluginConfig[] = [];
    for (const [pluginKey, entries] of Object.entries(installed.plugins ?? {})) {
      if (enabled[pluginKey] !== true) continue;
      const entry = entries[0];
      if (!entry?.installPath) continue;
      if (!existsSync(join(entry.installPath, '.claude-plugin', 'plugin.json'))) {
        debug(`[claude-plugins] manifest missing for ${pluginKey} at ${entry.installPath}`);
        continue;
      }
      result.push({ type: 'local', path: entry.installPath });
    }

    debug(`[claude-plugins] loading ${result.length} enabled plugins: ${result.map(p => p.path).join(', ')}`);
    return result;
  } catch (err) {
    debug('[claude-plugins] discovery failed:', err);
    return [];
  }
}
