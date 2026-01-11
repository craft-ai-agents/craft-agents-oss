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

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { debug } from '../utils/debug.ts';
import { getSourcePath } from '../sources/storage.ts';
import { SAFE_MODE_CONFIG } from './mode-manager.ts';

// ============================================================
// Zod Schemas
// ============================================================

/**
 * API endpoint rule - method + path pattern
 */
const ApiEndpointRuleSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  path: z.string().describe('Regex pattern for API path'),
  comment: z.string().optional(),
});

export type ApiEndpointRule = z.infer<typeof ApiEndpointRuleSchema>;

/**
 * Pattern with optional comment
 */
const PatternSchema = z.union([
  z.string(),
  z.object({
    pattern: z.string(),
    comment: z.string().optional(),
  }),
]);

/**
 * Permissions JSON configuration schema
 */
export const PermissionsConfigSchema = z.object({
  /** Additional tools to block */
  blockedTools: z.array(z.string()).optional(),
  /** Bash command patterns to allow (regex strings) */
  allowedBashPatterns: z.array(PatternSchema).optional(),
  /** MCP tool patterns to allow (regex strings) */
  allowedMcpPatterns: z.array(PatternSchema).optional(),
  /** API endpoint rules - method + path pattern */
  allowedApiEndpoints: z.array(ApiEndpointRuleSchema).optional(),
  /** File paths to allow writes in Explore mode (glob patterns) */
  allowedWritePaths: z.array(PatternSchema).optional(),
});

export type PermissionsConfigFile = z.infer<typeof PermissionsConfigSchema>;

// ============================================================
// Types
// ============================================================

/**
 * Parsed and normalized permissions configuration
 */
export interface PermissionsCustomConfig {
  /** Additional tools to block */
  blockedTools: string[];
  /** Additional bash patterns to allow (as regex strings) */
  allowedBashPatterns: string[];
  /** Additional MCP patterns to allow (as regex strings) */
  allowedMcpPatterns: string[];
  /** API endpoint rules for fine-grained control */
  allowedApiEndpoints: ApiEndpointRule[];
  /** File paths to allow writes in Explore mode (glob pattern strings) */
  allowedWritePaths: string[];
}

/**
 * Compiled API endpoint rule for runtime
 */
export interface CompiledApiEndpointRule {
  method: string;
  pathPattern: RegExp;
}

/**
 * Merged permissions config for runtime use
 */
export interface MergedPermissionsConfig {
  /** All blocked tools (safe mode defaults + custom) - used in safe mode */
  blockedTools: Set<string>;
  /** Only tools blocked via permissions.json - used in ask/allow-all modes */
  customBlockedTools: Set<string>;
  readOnlyBashPatterns: RegExp[];
  readOnlyMcpPatterns: RegExp[];
  /** Fine-grained API endpoint rules */
  allowedApiEndpoints: CompiledApiEndpointRule[];
  /** File paths allowed for writes in Explore mode (glob patterns) */
  allowedWritePaths: string[];
  /** Display name for error messages */
  displayName: string;
  /** Keyboard shortcut hint */
  shortcutHint: string;
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
    blockedTools: [],
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

    // Normalize patterns (extract string from pattern objects)
    const normalizePatterns = (patterns: Array<string | { pattern: string; comment?: string }> | undefined): string[] => {
      if (!patterns) return [];
      return patterns.map(p => typeof p === 'string' ? p : p.pattern);
    };

    return {
      blockedTools: data.blockedTools ?? [],
      allowedBashPatterns: normalizePatterns(data.allowedBashPatterns),
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
    for (const key of this.mergedConfigs.keys()) {
      if (key.startsWith(`${workspaceRootPath}::`) && key.includes(sourceSlug)) {
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

    // Start with defaults
    const merged: MergedPermissionsConfig = {
      blockedTools: new Set(defaults.blockedTools),
      customBlockedTools: new Set(), // Empty - only from permissions.json
      readOnlyBashPatterns: [...defaults.readOnlyBashPatterns],
      readOnlyMcpPatterns: [...defaults.readOnlyMcpPatterns],
      allowedApiEndpoints: [],
      allowedWritePaths: [],
      displayName: defaults.displayName,
      shortcutHint: defaults.shortcutHint,
    };

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

  private applyCustomConfig(merged: MergedPermissionsConfig, custom: PermissionsCustomConfig): void {
    // Add blocked tools to both sets (blockedTools for safe mode, customBlockedTools for ask/allow-all)
    for (const tool of custom.blockedTools) {
      merged.blockedTools.add(tool);
      merged.customBlockedTools.add(tool);
    }

    // Add allowed bash patterns (making config more permissive)
    for (const pattern of custom.allowedBashPatterns) {
      const regex = validateRegex(pattern);
      if (regex) {
        merged.readOnlyBashPatterns.push(regex);
      } else {
        debug(`[Permissions] Invalid bash pattern, skipping: ${pattern}`);
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
    // Blocked tools and write paths - apply normally (global effect)
    for (const tool of custom.blockedTools) {
      merged.blockedTools.add(tool);
      merged.customBlockedTools.add(tool);
    }

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
    for (const pattern of custom.allowedBashPatterns) {
      const regex = validateRegex(pattern);
      if (regex) {
        merged.readOnlyBashPatterns.push(regex);
      } else {
        debug(`[Permissions] Invalid bash pattern, skipping: ${pattern}`);
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
    this.workspaceConfigs.clear();
    this.sourceConfigs.clear();
    this.mergedConfigs.clear();
  }
}

// Singleton instance
export const permissionsConfigCache = new PermissionsConfigCache();
