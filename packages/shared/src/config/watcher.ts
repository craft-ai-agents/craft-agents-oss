/**
 * Config File Watcher
 *
 * Watches configuration files for changes and triggers callbacks.
 * Uses recursive directory watching for simplicity and reliability.
 *
 * Watched paths:
 * - ~/.craft-agent/config.json - Main app configuration
 * - ~/.craft-agent/preferences.json - User preferences
 * - ~/.craft-agent/theme.json - App-level theme overrides
 * - ~/.craft-agent/workspaces/{slug}/ - Workspace directory (recursive)
 *   - theme.json - Workspace-level theme overrides
 *   - sources/{slug}/config.json, guide.md, permissions.json
 *   - agents/{slug}/config.json, instructions.md, theme.json
 *   - permissions.json
 */

import { watch, existsSync, readdirSync, statSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname, basename, relative } from 'path';
import { homedir } from 'os';
import type { FSWatcher } from 'fs';
import { debug } from '../utils/debug.ts';
import { loadStoredConfig, type StoredConfig } from './storage.ts';
import {
  validateConfig,
  validatePreferences,
  validateSource,
  validateAgent,
  type ValidationResult,
} from './validators.ts';
import type { LoadedSource, SourceGuide } from '../sources/types.ts';
import type { LoadedAgent } from '../agents/folder-types.ts';
import { loadSource, loadWorkspaceSources, loadSourceGuide } from '../sources/storage.ts';
import { loadAgent, loadWorkspaceAgents, loadAgentInstructions } from '../agents/folder-storage.ts';
import { permissionsConfigCache } from '../agent/permissions-config.ts';
import { getWorkspacePath, getWorkspaceSourcesPath, getWorkspaceAgentsPath } from '../workspaces/storage.ts';
import { loadAppTheme, loadWorkspaceTheme, loadAgentTheme } from './storage.ts';
import type { ThemeOverrides } from './theme.ts';

// ============================================================
// Constants
// ============================================================

const CONFIG_DIR = join(homedir(), '.craft-agent');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const PREFERENCES_FILE = join(CONFIG_DIR, 'preferences.json');

// Debounce delay in milliseconds
const DEBOUNCE_MS = 100;

// ============================================================
// Types
// ============================================================

/**
 * User preferences structure (mirrors UserPreferencesSchema)
 */
export interface UserPreferences {
  name?: string;
  timezone?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
  };
  language?: string;
  notes?: string;
  updatedAt?: number;
}

/**
 * Callbacks for config changes
 */
export interface ConfigWatcherCallbacks {
  /** Called when config.json changes */
  onConfigChange?: (config: StoredConfig) => void;
  /** Called when preferences.json changes */
  onPreferencesChange?: (prefs: UserPreferences) => void;

  // Source callbacks
  /** Called when a specific source config changes (null if deleted) */
  onSourceChange?: (slug: string, source: LoadedSource | null) => void;
  /** Called when a source's guide.md changes */
  onSourceGuideChange?: (slug: string, guide: SourceGuide) => void;
  /** Called when the sources list changes (add/remove folders) */
  onSourcesListChange?: (sources: LoadedSource[]) => void;

  // Agent callbacks
  /** Called when a specific agent config changes (null if deleted) */
  onAgentChange?: (slug: string, agent: LoadedAgent | null) => void;
  /** Called when an agent's instructions.md changes */
  onAgentInstructionsChange?: (slug: string, instructions: string) => void;
  /** Called when the agents list changes (add/remove folders) */
  onAgentsListChange?: (agents: LoadedAgent[]) => void;

  // Permissions callbacks
  /** Called when workspace permissions.json changes */
  onWorkspacePermissionsChange?: (workspaceId: string) => void;
  /** Called when a source's permissions.json changes */
  onSourcePermissionsChange?: (sourceSlug: string) => void;

  // Status callbacks
  /** Called when statuses config.json changes */
  onStatusConfigChange?: (workspaceId: string) => void;
  /** Called when a status icon file changes */
  onStatusIconChange?: (workspaceId: string, iconFilename: string) => void;

  // Theme callbacks
  /** Called when app-level theme.json changes */
  onAppThemeChange?: (theme: ThemeOverrides | null) => void;
  /** Called when workspace-level theme.json changes */
  onWorkspaceThemeChange?: (theme: ThemeOverrides | null) => void;
  /** Called when agent-level theme.json changes */
  onAgentThemeChange?: (agentSlug: string, theme: ThemeOverrides | null) => void;

  // Error callbacks
  /** Called when a validation error occurs */
  onValidationError?: (file: string, result: ValidationResult) => void;
  /** Called when an error occurs reading/parsing a file */
  onError?: (file: string, error: Error) => void;
}

// ============================================================
// Preferences Loading
// ============================================================

/**
 * Load preferences from file
 */
export function loadPreferences(): UserPreferences | null {
  if (!existsSync(PREFERENCES_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(PREFERENCES_FILE, 'utf-8');
    return JSON.parse(content) as UserPreferences;
  } catch (error) {
    debug('[ConfigWatcher] Error loading preferences', error);
    return null;
  }
}

// ============================================================
// ConfigWatcher Class
// ============================================================

/**
 * Watches config files and triggers callbacks on changes.
 * Uses recursive directory watching for workspace files.
 */
export class ConfigWatcher {
  private workspaceId: string;
  private callbacks: ConfigWatcherCallbacks;
  private watchers: FSWatcher[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  // Track known items for detecting adds/removes
  private knownSources: Set<string> = new Set();
  private knownAgents: Set<string> = new Set();

  // Computed paths
  private workspaceDir: string;
  private sourcesDir: string;
  private agentsDir: string;

  constructor(workspaceIdOrPath: string, callbacks: ConfigWatcherCallbacks) {
    this.callbacks = callbacks;
    // Support both workspace ID and workspace root path
    // Paths contain '/' while IDs don't
    if (workspaceIdOrPath.includes('/')) {
      this.workspaceDir = workspaceIdOrPath;
      // Extract workspace ID from path (last segment)
      this.workspaceId = workspaceIdOrPath.split('/').pop() || workspaceIdOrPath;
    } else {
      this.workspaceId = workspaceIdOrPath;
      this.workspaceDir = getWorkspacePath(workspaceIdOrPath);
    }
    this.sourcesDir = getWorkspaceSourcesPath(this.workspaceDir);
    this.agentsDir = getWorkspaceAgentsPath(this.workspaceDir);
  }

  /**
   * Get the workspace slug this watcher is scoped to
   */
  getWorkspaceSlug(): string {
    return this.workspaceId;
  }

  /**
   * Start watching config files
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    debug('[ConfigWatcher] Starting for workspace:', this.workspaceId);

    // Ensure workspace directory exists
    if (!existsSync(this.workspaceDir)) {
      mkdirSync(this.workspaceDir, { recursive: true });
    }

    // Watch global config files
    this.watchGlobalConfigs();

    // Watch workspace directory recursively
    this.watchWorkspaceDir();

    // Initial scan to populate known sources/agents
    this.scanSources();
    this.scanAgents();

    debug('[ConfigWatcher] Started watching files');
  }

  /**
   * Stop watching all files
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close all watchers
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    this.knownSources.clear();
    this.knownAgents.clear();

    debug('[ConfigWatcher] Stopped');
  }

  /**
   * Watch global config files (config.json, preferences.json)
   */
  private watchGlobalConfigs(): void {
    // Ensure config directory exists
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }

    try {
      // Watch the config directory for changes to config.json, preferences.json, and theme.json
      const watcher = watch(CONFIG_DIR, (eventType, filename) => {
        if (!filename) return;

        if (filename === 'config.json') {
          this.debounce('config.json', () => this.handleConfigChange());
        } else if (filename === 'preferences.json') {
          this.debounce('preferences.json', () => this.handlePreferencesChange());
        } else if (filename === 'theme.json') {
          this.debounce('app-theme', () => this.handleAppThemeChange());
        }
      });

      this.watchers.push(watcher);
      debug('[ConfigWatcher] Watching global configs:', CONFIG_DIR);
    } catch (error) {
      debug('[ConfigWatcher] Error watching global configs:', error);
    }
  }

  /**
   * Watch workspace directory recursively
   */
  private watchWorkspaceDir(): void {
    try {
      const watcher = watch(this.workspaceDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Normalize path separators
        const normalizedPath = filename.replace(/\\/g, '/');
        this.handleWorkspaceFileChange(normalizedPath, eventType);
      });

      this.watchers.push(watcher);
      debug('[ConfigWatcher] Watching workspace recursively:', this.workspaceDir);
    } catch (error) {
      debug('[ConfigWatcher] Error watching workspace directory:', error);
    }
  }

  /**
   * Handle a file change within the workspace directory
   */
  private handleWorkspaceFileChange(relativePath: string, eventType: string): void {
    const parts = relativePath.split('/');

    // Workspace-level permissions.json
    if (relativePath === 'permissions.json') {
      this.debounce('workspace-permissions', () => this.handleWorkspacePermissionsChange());
      return;
    }

    // Workspace-level theme.json
    if (relativePath === 'theme.json') {
      this.debounce('workspace-theme', () => this.handleWorkspaceThemeChange());
      return;
    }

    // Sources changes: sources/{slug}/...
    if (parts[0] === 'sources' && parts.length >= 2) {
      const slug = parts[1]!;  // Safe: checked parts.length >= 2
      const file = parts[2];

      // Directory-level changes (new/removed source folders)
      if (parts.length === 2) {
        this.debounce('sources-dir', () => this.handleSourcesDirChange());
        return;
      }

      // File-level changes
      if (file === 'config.json') {
        this.debounce(`source-config:${slug}`, () => this.handleSourceConfigChange(slug));
      } else if (file === 'guide.md') {
        this.debounce(`source-guide:${slug}`, () => this.handleSourceGuideChange(slug));
      } else if (file === 'permissions.json') {
        this.debounce(`source-permissions:${slug}`, () => this.handleSourcePermissionsChange(slug));
      }
      return;
    }

    // Agents changes: agents/{slug}/...
    if (parts[0] === 'agents' && parts.length >= 2) {
      const slug = parts[1]!;  // Safe: checked parts.length >= 2
      const file = parts[2];

      // Directory-level changes (new/removed agent folders)
      if (parts.length === 2) {
        this.debounce('agents-dir', () => this.handleAgentsDirChange());
        return;
      }

      // File-level changes
      if (file === 'config.json') {
        this.debounce(`agent-config:${slug}`, () => this.handleAgentConfigChange(slug));
      } else if (file === 'instructions.md') {
        this.debounce(`agent-instructions:${slug}`, () => this.handleAgentInstructionsChange(slug));
      } else if (file === 'theme.json') {
        this.debounce(`agent-theme:${slug}`, () => this.handleAgentThemeChange(slug));
      }
      return;
    }

    // Statuses changes: statuses/...
    if (parts[0] === 'statuses' && parts.length >= 2) {
      const file = parts[1];

      // config.json change
      if (file === 'config.json') {
        this.debounce('statuses-config', () => this.handleStatusConfigChange());
        return;
      }

      // Icon file changes: statuses/icons/*.svg, *.png, etc.
      if (file === 'icons' && parts.length >= 3) {
        const iconFilename = parts[2];
        if (iconFilename) {
          this.debounce(`statuses-icon:${iconFilename}`, () => {
            this.handleStatusIconChange(iconFilename);
          });
        }
        return;
      }
    }
  }

  /**
   * Debounce a handler by key
   */
  private debounce(key: string, handler: () => void): void {
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      handler();
    }, DEBOUNCE_MS);

    this.debounceTimers.set(key, timer);
  }

  // ============================================================
  // Sources Handlers
  // ============================================================

  /**
   * Scan sources directory to populate known sources
   */
  private scanSources(): void {
    if (!existsSync(this.sourcesDir)) {
      mkdirSync(this.sourcesDir, { recursive: true });
      return;
    }

    try {
      const entries = readdirSync(this.sourcesDir);

      for (const entry of entries) {
        const entryPath = join(this.sourcesDir, entry);
        if (statSync(entryPath).isDirectory()) {
          this.knownSources.add(entry);
        }
      }

      debug('[ConfigWatcher] Known sources:', Array.from(this.knownSources));
    } catch (error) {
      debug('[ConfigWatcher] Error scanning sources:', error);
    }
  }

  /**
   * Handle sources directory change (add/remove folders)
   */
  private handleSourcesDirChange(): void {
    debug('[ConfigWatcher] Sources directory changed');

    if (!existsSync(this.sourcesDir)) {
      // Directory was deleted
      const removed = Array.from(this.knownSources);
      this.knownSources.clear();

      for (const slug of removed) {
        this.callbacks.onSourceChange?.(slug, null);
      }

      this.callbacks.onSourcesListChange?.([]);
      return;
    }

    try {
      const entries = readdirSync(this.sourcesDir);
      const currentFolders = new Set<string>();

      for (const entry of entries) {
        const entryPath = join(this.sourcesDir, entry);
        if (statSync(entryPath).isDirectory()) {
          currentFolders.add(entry);
        }
      }

      // Find added folders
      for (const folder of currentFolders) {
        if (!this.knownSources.has(folder)) {
          debug('[ConfigWatcher] New source folder:', folder);
          this.knownSources.add(folder);

          const source = loadSource(this.workspaceDir, folder);
          if (source) {
            this.callbacks.onSourceChange?.(folder, source);
          }
        }
      }

      // Find removed folders
      for (const folder of this.knownSources) {
        if (!currentFolders.has(folder)) {
          debug('[ConfigWatcher] Removed source folder:', folder);
          this.knownSources.delete(folder);
          this.callbacks.onSourceChange?.(folder, null);
        }
      }

      // Notify list change
      const allSources = loadWorkspaceSources(this.workspaceDir);
      this.callbacks.onSourcesListChange?.(allSources);
    } catch (error) {
      debug('[ConfigWatcher] Error handling sources dir change:', error);
      this.callbacks.onError?.('sources/', error as Error);
    }
  }

  /**
   * Handle source config.json change
   */
  private handleSourceConfigChange(slug: string): void {
    debug('[ConfigWatcher] Source config changed:', slug);

    const validation = validateSource(this.workspaceId, slug);
    if (!validation.valid) {
      debug('[ConfigWatcher] Source validation failed:', slug, validation.errors);
      this.callbacks.onValidationError?.(`sources/${slug}/config.json`, validation);
      return;
    }

    const source = loadSource(this.workspaceDir, slug);
    this.callbacks.onSourceChange?.(slug, source);
  }

  /**
   * Handle source guide.md change
   */
  private handleSourceGuideChange(slug: string): void {
    debug('[ConfigWatcher] Source guide changed:', slug);

    const guide = loadSourceGuide(this.workspaceDir, slug);
    if (guide) {
      this.callbacks.onSourceGuideChange?.(slug, guide);
    }

    // Also emit full source change
    const source = loadSource(this.workspaceDir, slug);
    if (source) {
      this.callbacks.onSourceChange?.(slug, source);
    }
  }

  /**
   * Handle source permissions.json change
   */
  private handleSourcePermissionsChange(slug: string): void {
    debug('[ConfigWatcher] Source permissions.json changed:', slug);

    // Invalidate cache
    permissionsConfigCache.invalidateSource(this.workspaceId, slug);

    // Notify callback
    this.callbacks.onSourcePermissionsChange?.(slug);
  }

  // ============================================================
  // Agents Handlers
  // ============================================================

  /**
   * Scan agents directory to populate known agents
   */
  private scanAgents(): void {
    if (!existsSync(this.agentsDir)) {
      mkdirSync(this.agentsDir, { recursive: true });
      return;
    }

    try {
      const entries = readdirSync(this.agentsDir);

      for (const entry of entries) {
        const entryPath = join(this.agentsDir, entry);
        if (statSync(entryPath).isDirectory()) {
          this.knownAgents.add(entry);
        }
      }

      debug('[ConfigWatcher] Known agents:', Array.from(this.knownAgents));
    } catch (error) {
      debug('[ConfigWatcher] Error scanning agents:', error);
    }
  }

  /**
   * Handle agents directory change (add/remove folders)
   */
  private handleAgentsDirChange(): void {
    debug('[ConfigWatcher] Agents directory changed');

    if (!existsSync(this.agentsDir)) {
      // Directory was deleted
      const removed = Array.from(this.knownAgents);
      this.knownAgents.clear();

      for (const slug of removed) {
        this.callbacks.onAgentChange?.(slug, null);
      }

      this.callbacks.onAgentsListChange?.([]);
      return;
    }

    try {
      const entries = readdirSync(this.agentsDir);
      const currentFolders = new Set<string>();

      for (const entry of entries) {
        const entryPath = join(this.agentsDir, entry);
        if (statSync(entryPath).isDirectory()) {
          currentFolders.add(entry);
        }
      }

      // Find added folders
      for (const folder of currentFolders) {
        if (!this.knownAgents.has(folder)) {
          debug('[ConfigWatcher] New agent folder:', folder);
          this.knownAgents.add(folder);

          const agent = loadAgent(this.workspaceDir, folder);
          if (agent) {
            this.callbacks.onAgentChange?.(folder, agent);
          }
        }
      }

      // Find removed folders
      for (const folder of this.knownAgents) {
        if (!currentFolders.has(folder)) {
          debug('[ConfigWatcher] Removed agent folder:', folder);
          this.knownAgents.delete(folder);
          this.callbacks.onAgentChange?.(folder, null);
        }
      }

      // Notify list change
      const allAgents = loadWorkspaceAgents(this.workspaceDir);
      this.callbacks.onAgentsListChange?.(allAgents);
    } catch (error) {
      debug('[ConfigWatcher] Error handling agents dir change:', error);
      this.callbacks.onError?.('agents/', error as Error);
    }
  }

  /**
   * Handle agent config.json change
   */
  private handleAgentConfigChange(slug: string): void {
    debug('[ConfigWatcher] Agent config changed:', slug);

    const validation = validateAgent(this.workspaceId, slug);
    if (!validation.valid) {
      debug('[ConfigWatcher] Agent validation failed:', slug, validation.errors);
      this.callbacks.onValidationError?.(`agents/${slug}/config.json`, validation);
      return;
    }

    const agent = loadAgent(this.workspaceDir, slug);
    this.callbacks.onAgentChange?.(slug, agent);
  }

  /**
   * Handle agent instructions.md change
   */
  private handleAgentInstructionsChange(slug: string): void {
    debug('[ConfigWatcher] Agent instructions changed:', slug);

    const instructions = loadAgentInstructions(this.workspaceDir, slug);
    if (instructions !== null) {
      this.callbacks.onAgentInstructionsChange?.(slug, instructions);
    }

    // Also emit full agent change
    const agent = loadAgent(this.workspaceDir, slug);
    if (agent) {
      this.callbacks.onAgentChange?.(slug, agent);
    }
  }

  // ============================================================
  // Safe Mode & Config Handlers
  // ============================================================

  /**
   * Handle workspace permissions.json change
   */
  private handleWorkspacePermissionsChange(): void {
    debug('[ConfigWatcher] Workspace permissions.json changed:', this.workspaceId);

    // Invalidate cache
    permissionsConfigCache.invalidateWorkspace(this.workspaceId);

    // Notify callback
    this.callbacks.onWorkspacePermissionsChange?.(this.workspaceId);
  }

  /**
   * Handle config.json change
   */
  private handleConfigChange(): void {
    debug('[ConfigWatcher] config.json changed');

    const validation = validateConfig();
    if (!validation.valid) {
      debug('[ConfigWatcher] Config validation failed:', validation.errors);
      this.callbacks.onValidationError?.('config.json', validation);
      return;
    }

    const config = loadStoredConfig();
    if (config) {
      this.callbacks.onConfigChange?.(config);
    } else {
      this.callbacks.onError?.('config.json', new Error('Failed to load config'));
    }
  }

  /**
   * Handle preferences.json change
   */
  private handlePreferencesChange(): void {
    debug('[ConfigWatcher] preferences.json changed');

    const validation = validatePreferences();
    if (!validation.valid) {
      debug('[ConfigWatcher] Preferences validation failed:', validation.errors);
      this.callbacks.onValidationError?.('preferences.json', validation);
      return;
    }

    const prefs = loadPreferences();
    if (prefs) {
      this.callbacks.onPreferencesChange?.(prefs);
    }
  }

  // ============================================================
  // Statuses Handlers
  // ============================================================

  /**
   * Handle statuses config.json change
   */
  private handleStatusConfigChange(): void {
    debug('[ConfigWatcher] Statuses config.json changed:', this.workspaceId);
    this.callbacks.onStatusConfigChange?.(this.workspaceId);
  }

  /**
   * Handle status icon file change
   */
  private handleStatusIconChange(iconFilename: string): void {
    debug('[ConfigWatcher] Status icon changed:', this.workspaceId, iconFilename);
    this.callbacks.onStatusIconChange?.(this.workspaceId, iconFilename);
  }

  // ============================================================
  // Theme Handlers
  // ============================================================

  /**
   * Handle app-level theme.json change
   */
  private handleAppThemeChange(): void {
    debug('[ConfigWatcher] App theme.json changed');
    const theme = loadAppTheme();
    this.callbacks.onAppThemeChange?.(theme);
  }

  /**
   * Handle workspace-level theme.json change
   */
  private handleWorkspaceThemeChange(): void {
    debug('[ConfigWatcher] Workspace theme.json changed:', this.workspaceId);
    const theme = loadWorkspaceTheme(this.workspaceDir);
    this.callbacks.onWorkspaceThemeChange?.(theme);
  }

  /**
   * Handle agent-level theme.json change
   */
  private handleAgentThemeChange(agentSlug: string): void {
    debug('[ConfigWatcher] Agent theme.json changed:', agentSlug);
    const theme = loadAgentTheme(this.workspaceDir, agentSlug);
    this.callbacks.onAgentThemeChange?.(agentSlug, theme);
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create and start a config watcher for a specific workspace.
 * Returns the watcher instance for later cleanup.
 */
export function createConfigWatcher(
  workspaceId: string,
  callbacks: ConfigWatcherCallbacks
): ConfigWatcher {
  const watcher = new ConfigWatcher(workspaceId, callbacks);
  watcher.start();
  return watcher;
}
