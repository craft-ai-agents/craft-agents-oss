/**
 * Safe Mode Configuration
 *
 * Allows customization of Safe Mode rules per workspace and per source.
 * Users can create permissions.json files to extend the default rules.
 *
 * File locations:
 * - Workspace: ~/.craft-agent/workspaces/{slug}/permissions.json
 * - Per-source: ~/.craft-agent/workspaces/{slug}/sources/{sourceSlug}/permissions.json
 *
 * Rules are additive - custom configs extend the defaults (more permissive).
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { debug } from '../utils/debug.ts';
import { CONFIG_DIR } from '../config/paths.ts';
import { getSourcePath } from '../sources/storage.ts';
import {
  SAFE_MODE_CONFIG,
  PermissionsConfigSchema,
  type ApiEndpointRule,
  type PermissionsConfigFile,
  type CompiledApiEndpointRule,
  type CompiledBashPattern,
  type PermissionPaths,
} from './mode-types.ts';

// ============================================================
// App-level Permissions Directory
// ============================================================

const APP_PERMISSIONS_DIR = join(CONFIG_DIR, 'permissions');

/**
 * Get the app-level permissions directory.
 * Default permissions are stored at ~/.craft-agent/permissions/
 */
export function getAppPermissionsDir(): string {
  return APP_PERMISSIONS_DIR;
}

/**
 * Ensure default permissions file exists.
 * Copies bundled default.json from the provided directory on first run.
 * Only copies if file doesn't exist (preserves user edits).
 * @param bundledPermissionsDir - Path to bundled permissions (e.g., Electron's resources/permissions)
 */
export function ensureDefaultPermissions(bundledPermissionsDir?: string): void {
  const permissionsDir = getAppPermissionsDir();

  // Create permissions directory if it doesn't exist
  if (!existsSync(permissionsDir)) {
    mkdirSync(permissionsDir, { recursive: true });
  }

  // If no bundled permissions directory provided, just ensure the directory exists
  if (!bundledPermissionsDir || !existsSync(bundledPermissionsDir)) {
    return;
  }

  // Copy default.json if it doesn't exist in app permissions dir
  const destPath = join(permissionsDir, 'default.json');
  if (!existsSync(destPath)) {
    const srcPath = join(bundledPermissionsDir, 'default.json');
    if (existsSync(srcPath)) {
      try {
        const content = readFileSync(srcPath, 'utf-8');
        writeFileSync(destPath, content, 'utf-8');
        debug('[Permissions] Copied bundled default.json to', destPath);
      } catch (error) {
        debug('[Permissions] Error copying bundled default.json:', error);
      }
    }
  }
}

/**
 * Load default permissions from ~/.craft-agent/permissions/default.json
 * Returns null if file doesn't exist or is invalid.
 */
export function loadDefaultPermissions(): PermissionsCustomConfig | null {
  const defaultPath = join(getAppPermissionsDir(), 'default.json');
  if (!existsSync(defaultPath)) {
    debug('[Permissions] No default.json found at', defaultPath);
    return null;
  }

  try {
    const content = readFileSync(defaultPath, 'utf-8');
    const config = parsePermissionsJson(content);
    debug('[Permissions] Loaded default permissions from', defaultPath);
    return config;
  } catch (error) {
    debug('[Permissions] Error loading default permissions:', error);
    return null;
  }
}

// Re-export types from mode-types for external consumers
export {
  PermissionsConfigSchema,
  type ApiEndpointRule,
  type PermissionsConfigFile,
  type CompiledApiEndpointRule,
  type CompiledBashPattern,
  type PermissionPaths,
};

// ============================================================
// Types
// ============================================================

/**
 * Pattern entry with optional comment for error messages.
 * Preserves the comment from permissions.json so we can show helpful hints.
 */
export interface PatternWithComment {
  pattern: string;
  comment?: string;
}

/**
 * Parsed and normalized permissions configuration
 *
 * Note: blockedTools (Write, Edit, MultiEdit, NotebookEdit) are hardcoded in
 * SAFE_MODE_CONFIG and not configurable here - they're fundamental write
 * operations that must always be blocked in Explore mode.
 */
export interface PermissionsCustomConfig {
  /** Additional bash patterns to allow (with optional comments for error messages) */
  allowedBashPatterns: PatternWithComment[];
  /** Additional MCP patterns to allow (as regex strings) */
  allowedMcpPatterns: string[];
  /** API endpoint rules for fine-grained control */
  allowedApiEndpoints: ApiEndpointRule[];
  /** File paths to allow writes in Explore mode (glob pattern strings) */
  allowedWritePaths: string[];
}

/**
 * Merged permissions config for runtime use
 */
export interface MergedPermissionsConfig {
  /** Blocked tools (Write, Edit, MultiEdit, NotebookEdit) - hardcoded, not configurable */
  blockedTools: Set<string>;
  /** Read-only bash patterns with metadata for helpful error messages */
  readOnlyBashPatterns: CompiledBashPattern[];
  readOnlyMcpPatterns: RegExp[];
  /** Fine-grained API endpoint rules */
  allowedApiEndpoints: CompiledApiEndpointRule[];
  /** File paths allowed for writes in Explore mode (glob patterns) */
  allowedWritePaths: string[];
  /** Display name for error messages */
  displayName: string;
  /** Keyboard shortcut hint */
  shortcutHint: string;
  /** Paths to permission files for actionable error messages */
  permissionPaths?: PermissionPaths;
}

/**
 * Context for permissions checking (includes workspace/source/agent info)
 */
export interface PermissionsContext {
  workspaceRootPath: string;
  /** Active source slugs for source-specific rules */
  activeSourceSlugs?: string[];
}

// ============================================================
// JSON Parser
// ============================================================

/**
 * Parse and validate permissions.json file
 */
export function parsePermissionsJson(content: string): PermissionsCustomConfig {
  const emptyConfig: PermissionsCustomConfig = {
    allowedBashPatterns: [],
    allowedMcpPatterns: [],
    allowedApiEndpoints: [],
    allowedWritePaths: [],
  };

  try {
    const json = JSON.parse(content);
    const result = PermissionsConfigSchema.safeParse(json);

    if (!result.success) {
      debug('[SafeMode] Validation errors:', result.error.issues);
      // Log specific errors for debugging
      for (const issue of result.error.issues) {
        debug(`[SafeMode]   - ${issue.path.join('.')}: ${issue.message}`);
      }
      return emptyConfig;
    }

    const data = result.data;

    // Normalize patterns (extract string from pattern objects, but NOT for bash - preserve comments)
    const normalizePatterns = (patterns: Array<string | { pattern: string; comment?: string }> | undefined): string[] => {
      if (!patterns) return [];
      return patterns.map(p => typeof p === 'string' ? p : p.pattern);
    };

    // For bash patterns, preserve comments for helpful error messages
    const normalizeBashPatterns = (patterns: Array<string | { pattern: string; comment?: string }> | undefined): PatternWithComment[] => {
      if (!patterns) return [];
      return patterns.map(p => {
        if (typeof p === 'string') {
          return { pattern: p };
        }
        return { pattern: p.pattern, comment: p.comment };
      });
    };

    return {
      allowedBashPatterns: normalizeBashPatterns(data.allowedBashPatterns),
      allowedMcpPatterns: normalizePatterns(data.allowedMcpPatterns),
      allowedApiEndpoints: data.allowedApiEndpoints ?? [],
      allowedWritePaths: normalizePatterns(data.allowedWritePaths),
    };
  } catch (error) {
    debug('[SafeMode] JSON parse error:', error);
    return emptyConfig;
  }
}

/**
 * Validate a regex pattern string, return null if invalid
 */
function validateRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/**
 * Validate permissions config and return errors
 */
export function validatePermissionsConfig(config: PermissionsConfigFile): string[] {
  const errors: string[] = [];

  // Validate regex patterns
  const checkPatterns = (patterns: Array<string | { pattern: string }> | undefined, name: string) => {
    if (!patterns) return;
    for (let i = 0; i < patterns.length; i++) {
      const p = patterns[i];
      if (!p) continue;
      const patternStr = typeof p === 'string' ? p : p.pattern;
      if (!validateRegex(patternStr)) {
        errors.push(`${name}[${i}]: Invalid regex pattern: ${patternStr}`);
      }
    }
  };

  checkPatterns(config.allowedBashPatterns, 'allowedBashPatterns');
  checkPatterns(config.allowedMcpPatterns, 'allowedMcpPatterns');

  // Validate API endpoint patterns
  if (config.allowedApiEndpoints) {
    for (let i = 0; i < config.allowedApiEndpoints.length; i++) {
      const rule = config.allowedApiEndpoints[i];
      if (rule && !validateRegex(rule.path)) {
        errors.push(`allowedApiEndpoints[${i}].path: Invalid regex pattern: ${rule.path}`);
      }
    }
  }

  return errors;
}

// ============================================================
// Storage Functions
// ============================================================

/**
 * Get path to workspace permissions.json
 */
export function getWorkspacePermissionsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'permissions.json');
}

/**
 * Get path to source permissions.json
 */
export function getSourcePermissionsPath(workspaceRootPath: string, sourceSlug: string): string {
  return join(getSourcePath(workspaceRootPath, sourceSlug), 'permissions.json');
}

/**
 * Load workspace-level permissions config
 */
export function loadWorkspacePermissionsConfig(workspaceRootPath: string): PermissionsCustomConfig | null {
  const path = getWorkspacePermissionsPath(workspaceRootPath);
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, 'utf-8');
    const config = parsePermissionsJson(content);
    debug(`[Permissions] Loaded workspace config from ${path}:`, config);
    return config;
  } catch (error) {
    debug(`[Permissions] Error loading workspace config:`, error);
    return null;
  }
}

/**
 * Load source-level permissions config
 */
export function loadSourcePermissionsConfig(
  workspaceRootPath: string,
  sourceSlug: string
): PermissionsCustomConfig | null {
  const path = getSourcePermissionsPath(workspaceRootPath, sourceSlug);
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, 'utf-8');
    const config = parsePermissionsJson(content);
    debug(`[Permissions] Loaded source config from ${path}:`, config);
    return config;
  } catch (error) {
    debug(`[Permissions] Error loading source config:`, error);
    return null;
  }
}

// ============================================================
// API Endpoint Checking
// ============================================================

/**
 * Check if an API call is allowed by endpoint rules
 */
export function isApiEndpointAllowed(
  method: string,
  path: string,
  config: MergedPermissionsConfig
): boolean {
  const upperMethod = method.toUpperCase();

  // GET is always allowed
  if (upperMethod === 'GET') return true;

  // Check fine-grained endpoint rules
  for (const rule of config.allowedApiEndpoints) {
    if (rule.method === upperMethod && rule.pathPattern.test(path)) {
      return true;
    }
  }

  return false;
}

// ============================================================
// Config Cache
// ============================================================

/**
 * In-memory cache for parsed permissions configs
 * Invalidated on file changes via ConfigWatcher
 */
class PermissionsConfigCache {
  private workspaceConfigs: Map<string, PermissionsCustomConfig | null> = new Map();
  private sourceConfigs: Map<string, PermissionsCustomConfig | null> = new Map();
  private mergedConfigs: Map<string, MergedPermissionsConfig> = new Map();

  // App-level default permissions (loaded from ~/.craft-agent/permissions/default.json)
  private defaultConfig: PermissionsCustomConfig | null | undefined = undefined; // undefined = not loaded yet

  /**
   * Get or load app-level default permissions
   * These come from ~/.craft-agent/permissions/default.json
   */
  private getDefaultConfig(): PermissionsCustomConfig | null {
    if (this.defaultConfig === undefined) {
      this.defaultConfig = loadDefaultPermissions();
    }
    return this.defaultConfig;
  }

  /**
   * Get or load workspace config
   */
  getWorkspaceConfig(workspaceRootPath: string): PermissionsCustomConfig | null {
    if (!this.workspaceConfigs.has(workspaceRootPath)) {
      this.workspaceConfigs.set(workspaceRootPath, loadWorkspacePermissionsConfig(workspaceRootPath));
    }
    return this.workspaceConfigs.get(workspaceRootPath) ?? null;
  }

  /**
   * Get or load source config
   */
  getSourceConfig(workspaceRootPath: string, sourceSlug: string): PermissionsCustomConfig | null {
    const key = `${workspaceRootPath}::${sourceSlug}`;
    if (!this.sourceConfigs.has(key)) {
      this.sourceConfigs.set(key, loadSourcePermissionsConfig(workspaceRootPath, sourceSlug));
    }
    return this.sourceConfigs.get(key) ?? null;
  }

  /**
   * Invalidate app-level default permissions (called by ConfigWatcher)
   * This clears all merged configs since defaults affect everything
   */
  invalidateDefaults(): void {
    debug('[Permissions] Invalidating app-level default permissions');
    this.defaultConfig = undefined;
    // Clear ALL merged configs since defaults affect everything
    this.mergedConfigs.clear();
  }

  /**
   * Invalidate workspace config (called by ConfigWatcher)
   */
  invalidateWorkspace(workspaceRootPath: string): void {
    debug(`[Permissions] Invalidating workspace config: ${workspaceRootPath}`);
    this.workspaceConfigs.delete(workspaceRootPath);
    // Clear all merged configs for this workspace
    for (const key of this.mergedConfigs.keys()) {
      if (key.startsWith(`${workspaceRootPath}::`)) {
        this.mergedConfigs.delete(key);
      }
    }
  }

  /**
   * Invalidate source config (called by ConfigWatcher)
   */
  invalidateSource(workspaceRootPath: string, sourceSlug: string): void {
    debug(`[Permissions] Invalidating source config: ${workspaceRootPath}/${sourceSlug}`);
    this.sourceConfigs.delete(`${workspaceRootPath}::${sourceSlug}`);
    // Clear merged configs that include this source
    // Cache key format: "{workspaceRootPath}::{source1},{source2},..."
    // Use precise matching to avoid false positives (e.g., "linear" matching "linear-triage")
    for (const key of this.mergedConfigs.keys()) {
      if (!key.startsWith(`${workspaceRootPath}::`)) continue;

      // Extract sources portion after the ::
      const sourcesStr = key.slice(workspaceRootPath.length + 2);
      if (!sourcesStr) continue;

      // Check for exact match: at start, end, or between commas
      const sources = sourcesStr.split(',');
      if (sources.includes(sourceSlug)) {
        this.mergedConfigs.delete(key);
      }
    }
  }


  /**
   * Get merged config for a context (workspace + active sources)
   * Uses additive merging: custom configs extend defaults
   */
  getMergedConfig(context: PermissionsContext): MergedPermissionsConfig {
    const cacheKey = this.buildCacheKey(context);

    if (!this.mergedConfigs.has(cacheKey)) {
      const merged = this.buildMergedConfig(context);
      this.mergedConfigs.set(cacheKey, merged);
    }

    return this.mergedConfigs.get(cacheKey)!;
  }

  private buildMergedConfig(context: PermissionsContext): MergedPermissionsConfig {
    const defaults = SAFE_MODE_CONFIG;

    // Start with hardcoded fallback defaults (blocked tools are fixed, display settings)
    // blockedTools (Write, Edit, MultiEdit, NotebookEdit) come from SAFE_MODE_CONFIG
    // and cannot be modified via permissions.json
    const merged: MergedPermissionsConfig = {
      blockedTools: new Set(defaults.blockedTools),
      readOnlyBashPatterns: [...defaults.readOnlyBashPatterns],
      readOnlyMcpPatterns: [...defaults.readOnlyMcpPatterns],
      allowedApiEndpoints: [],
      allowedWritePaths: [],
      displayName: defaults.displayName,
      shortcutHint: defaults.shortcutHint,
      // Add permission file paths for actionable error messages
      permissionPaths: {
        workspacePath: getWorkspacePermissionsPath(context.workspaceRootPath),
        appDefaultPath: join(getAppPermissionsDir(), 'default.json'),
        docsPath: join(CONFIG_DIR, 'docs', 'permissions.md'),
      },
    };

    // Load and apply app-level default permissions from JSON
    // This is where the actual bash/MCP patterns come from
    const defaultConfig = this.getDefaultConfig();
    if (defaultConfig) {
      this.applyDefaultConfig(merged, defaultConfig);
    }

    // Add workspace-level customizations
    const wsConfig = this.getWorkspaceConfig(context.workspaceRootPath);
    if (wsConfig) {
      this.applyCustomConfig(merged, wsConfig);
    }

    // Add source-level customizations (additive, with auto-scoped MCP patterns)
    if (context.activeSourceSlugs) {
      for (const sourceSlug of context.activeSourceSlugs) {
        const srcConfig = this.getSourceConfig(context.workspaceRootPath, sourceSlug);
        if (srcConfig) {
          // Use applySourceConfig which auto-scopes MCP patterns to this source
          this.applySourceConfig(merged, srcConfig, sourceSlug);
        }
      }
    }

    return merged;
  }

  /**
   * Apply app-level default config (from default.json)
   * This adds bash/MCP patterns from the JSON config. Blocked tools are hardcoded
   * in SAFE_MODE_CONFIG and not loaded from JSON.
   */
  private applyDefaultConfig(merged: MergedPermissionsConfig, config: PermissionsCustomConfig): void {
    // Add allowed bash patterns (as CompiledBashPattern with metadata for error messages)
    for (const patternEntry of config.allowedBashPatterns) {
      const regex = validateRegex(patternEntry.pattern);
      if (regex) {
        merged.readOnlyBashPatterns.push({
          regex,
          source: patternEntry.pattern,
          comment: patternEntry.comment,
        });
      } else {
        debug(`[Permissions] Invalid default bash pattern, skipping: ${patternEntry.pattern}`);
      }
    }

    // Add allowed MCP patterns
    for (const pattern of config.allowedMcpPatterns) {
      const regex = validateRegex(pattern);
      if (regex) {
        merged.readOnlyMcpPatterns.push(regex);
      } else {
        debug(`[Permissions] Invalid default MCP pattern, skipping: ${pattern}`);
      }
    }

    // Add allowed API endpoints
    for (const rule of config.allowedApiEndpoints) {
      const pathRegex = validateRegex(rule.path);
      if (pathRegex) {
        merged.allowedApiEndpoints.push({
          method: rule.method,
          pathPattern: pathRegex,
        });
      }
    }

    // Add allowed write paths
    for (const pattern of config.allowedWritePaths) {
      merged.allowedWritePaths.push(pattern);
    }
  }

  private applyCustomConfig(merged: MergedPermissionsConfig, custom: PermissionsCustomConfig): void {
    // Add allowed bash patterns (making config more permissive)
    for (const patternEntry of custom.allowedBashPatterns) {
      const regex = validateRegex(patternEntry.pattern);
      if (regex) {
        merged.readOnlyBashPatterns.push({
          regex,
          source: patternEntry.pattern,
          comment: patternEntry.comment,
        });
      } else {
        debug(`[Permissions] Invalid bash pattern, skipping: ${patternEntry.pattern}`);
      }
    }

    // Add allowed MCP patterns
    for (const pattern of custom.allowedMcpPatterns) {
      const regex = validateRegex(pattern);
      if (regex) {
        merged.readOnlyMcpPatterns.push(regex);
      } else {
        debug(`[Permissions] Invalid MCP pattern, skipping: ${pattern}`);
      }
    }

    // Add allowed API endpoints (fine-grained)
    for (const rule of custom.allowedApiEndpoints) {
      const pathRegex = validateRegex(rule.path);
      if (pathRegex) {
        merged.allowedApiEndpoints.push({
          method: rule.method,
          pathPattern: pathRegex,
        });
      } else {
        debug(`[Permissions] Invalid API endpoint path pattern, skipping: ${rule.path}`);
      }
    }

    // Add allowed write paths (glob patterns, stored as strings)
    for (const pattern of custom.allowedWritePaths) {
      merged.allowedWritePaths.push(pattern);
    }
  }

  /**
   * Apply source-specific config with auto-scoped MCP patterns.
   * MCP patterns in a source's permissions.json are automatically prefixed with
   * mcp__<sourceSlug>__ so they only apply to that source's tools.
   * This prevents cross-source leakage when using simple patterns like "list".
   */
  private applySourceConfig(
    merged: MergedPermissionsConfig,
    custom: PermissionsCustomConfig,
    sourceSlug: string
  ): void {
    // Write paths - apply normally (global effect)
    for (const pattern of custom.allowedWritePaths) {
      merged.allowedWritePaths.push(pattern);
    }

    // MCP patterns - AUTO-SCOPE to this source
    // User writes: "list" → becomes: "mcp__<sourceSlug>__.*list"
    // This ensures patterns only match tools from THIS source
    for (const pattern of custom.allowedMcpPatterns) {
      const scopedPattern = `mcp__${sourceSlug}__.*${pattern}`;
      const regex = validateRegex(scopedPattern);
      if (regex) {
        merged.readOnlyMcpPatterns.push(regex);
        debug(`[Permissions] Scoped MCP pattern for ${sourceSlug}: ${pattern} → ${scopedPattern}`);
      } else {
        debug(`[Permissions] Invalid MCP pattern after scoping, skipping: ${scopedPattern}`);
      }
    }

    // Bash patterns - apply normally (not source-specific)
    for (const patternEntry of custom.allowedBashPatterns) {
      const regex = validateRegex(patternEntry.pattern);
      if (regex) {
        merged.readOnlyBashPatterns.push({
          regex,
          source: patternEntry.pattern,
          comment: patternEntry.comment,
        });
      } else {
        debug(`[Permissions] Invalid bash pattern, skipping: ${patternEntry.pattern}`);
      }
    }

    // API endpoints - apply normally (API tools are already source-scoped as api_<slug>)
    for (const rule of custom.allowedApiEndpoints) {
      const pathRegex = validateRegex(rule.path);
      if (pathRegex) {
        merged.allowedApiEndpoints.push({
          method: rule.method,
          pathPattern: pathRegex,
        });
      } else {
        debug(`[Permissions] Invalid API endpoint path pattern, skipping: ${rule.path}`);
      }
    }
  }

  private buildCacheKey(context: PermissionsContext): string {
    const sources = context.activeSourceSlugs?.sort().join(',') ?? '';
    return `${context.workspaceRootPath}::${sources}`;
  }

  /**
   * Clear all cached configs
   */
  clear(): void {
    this.defaultConfig = undefined;
    this.workspaceConfigs.clear();
    this.sourceConfigs.clear();
    this.mergedConfigs.clear();
  }
}

// Singleton instance
export const permissionsConfigCache = new PermissionsConfigCache();
