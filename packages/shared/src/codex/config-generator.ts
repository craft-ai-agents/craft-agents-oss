/**
 * Codex Config Generator
 *
 * Generates config.toml files from Craft Agent sources for per-session Codex configuration.
 * This enables MCP and API source support in Codex by:
 * 1. Converting MCP sources → [mcp_servers.{slug}] sections
 * 2. Configuring the Bridge MCP Server for API sources
 *
 * The generated config is written to the session's CODEX_HOME directory.
 */

import type { LoadedSource } from '../sources/types.ts';
import type { SdkMcpServerConfig } from '../agent/backend/types.ts';
import { isSourceUsable } from '../sources/storage.ts';

// ============================================================
// Custom Model Provider Configuration
// ============================================================

/**
 * Custom model provider preset IDs.
 * These map to pre-configured endpoints for popular OpenAI-compatible services.
 */
export type ModelProviderPreset = 'openai' | 'openrouter' | 'vercel-ai' | 'custom';

/**
 * Configuration for a custom model provider in Codex.
 * Used to route requests to OpenAI-compatible APIs.
 */
export interface ModelProviderConfig {
  /** Provider ID for TOML section name */
  id: string;
  /** Human-readable name */
  name: string;
  /** Base URL for the API */
  baseUrl: string;
  /** Environment variable name for API key */
  envKey: string;
  /** Wire API format (usually 'chat' for OpenAI-compatible) */
  wireApi?: 'chat' | 'completions' | 'responses';
  /** Default model to use with this provider */
  defaultModel?: string;
}

/**
 * Pre-configured model provider presets for common services.
 */
export const MODEL_PROVIDER_PRESETS: Record<string, ModelProviderConfig> = {
  // OpenRouter - aggregates multiple AI providers
  'openrouter': {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    wireApi: 'chat',
    defaultModel: 'openai/gpt-4.1',
  },
  // Vercel AI Gateway - managed AI infrastructure
  'vercel-ai': {
    id: 'vercel-ai',
    name: 'Vercel AI Gateway',
    baseUrl: 'https://gateway.ai.vercel.sh/v1',
    envKey: 'VERCEL_AI_KEY',
    wireApi: 'chat',
    defaultModel: 'gpt-4.1',
  },
};

/**
 * Options for config generation
 */
export interface CodexConfigGeneratorOptions {
  /**
   * Enabled sources to include in the config.
   * Only sources with type 'mcp' will be converted to [mcp_servers.*] sections.
   * API sources require the bridge server to be configured.
   */
  sources: LoadedSource[];

  /**
   * Pre-built MCP server configs (already has credentials injected).
   * Keys are source slugs, values are SDK-compatible server configs.
   */
  mcpServerConfigs?: Record<string, SdkMcpServerConfig>;

  /**
   * Path to the Bridge MCP Server executable.
   * Required if any API sources are included.
   */
  bridgeServerPath?: string;

  /**
   * Path to the API sources config JSON file for the bridge server.
   * The bridge server reads this file to know which API sources to expose.
   */
  bridgeConfigPath?: string;

  /**
   * Session path for the bridge server (used for response storage).
   */
  sessionPath?: string;

  /**
   * Workspace ID for credential lookups.
   */
  workspaceId?: string;

  /**
   * Custom model provider configuration.
   * If set, generates [model_providers.*] and [profiles.*] sections.
   * Used for OpenRouter, Vercel AI Gateway, or custom OpenAI-compatible endpoints.
   */
  modelProvider?: ModelProviderConfig;

  /**
   * Path to the Session MCP Server executable.
   * Provides session-scoped tools (SubmitPlan, config_validate, etc.) to Codex.
   */
  sessionServerPath?: string;

  /**
   * Path to Node.js executable for running MCP helper servers.
   * Defaults to "node" if not provided.
   */
  nodePath?: string;

  /**
   * Session ID for the session MCP server.
   * Used to identify callbacks from the session server.
   */
  sessionId?: string;

  /**
   * Workspace root path for the session MCP server.
   * Used for config validation and source operations.
   */
  workspaceRootPath?: string;

  /**
   * Plans folder path for the session MCP server.
   * Where plan files are stored for SubmitPlan tool.
   */
  plansFolderPath?: string;
}

/**
 * Warning about a source configuration issue
 */
export interface ConfigWarning {
  /** Source slug that has the issue */
  sourceSlug: string;
  /** Type of warning */
  type: 'missing_server_config' | 'slug_validation_failed' | 'bridge_not_configured';
  /** Human-readable message */
  message: string;
}

/**
 * Result of config generation
 */
export interface CodexConfigResult {
  /** Generated TOML config content */
  toml: string;

  /** List of MCP sources included */
  mcpSources: string[];

  /** List of API sources that need the bridge server */
  apiSources: string[];

  /** Whether the bridge server is needed */
  needsBridge: boolean;

  /** Warnings about sources that couldn't be configured */
  warnings: ConfigWarning[];
}

/**
 * Valid slug pattern: lowercase alphanumeric with hyphens only.
 * Matches schema validation but enforced again at TOML generation as defense-in-depth.
 */
const VALID_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/**
 * Characters that are dangerous in TOML section names.
 * Dots create nested tables, brackets break syntax, quotes need escaping.
 */
const DANGEROUS_SLUG_CHARS = /[.\[\]"'\\=\s\n\r]/;

/**
 * Validate and sanitize a slug for use as a TOML section name.
 * Returns sanitized slug or throws if slug cannot be safely used.
 *
 * Defense-in-depth: Schema validation catches most issues, but this
 * provides additional protection at the point of TOML generation.
 *
 * @param slug - Source slug to validate
 * @returns Sanitized slug safe for TOML section names
 * @throws Error if slug contains dangerous characters
 */
export function validateSlugForToml(slug: string): string {
  // Check for dangerous characters that could cause TOML injection
  if (DANGEROUS_SLUG_CHARS.test(slug)) {
    throw new Error(
      `Invalid slug for TOML config: "${slug}" contains dangerous characters. ` +
      `Slugs must only contain lowercase letters, numbers, and hyphens.`
    );
  }

  // Verify matches expected pattern
  if (!VALID_SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Invalid slug for TOML config: "${slug}" does not match expected pattern. ` +
      `Slugs must start and end with alphanumeric characters.`
    );
  }

  return slug;
}

/**
 * Escape a string for TOML (handles quotes and special characters)
 */
function escapeTomlString(str: string): string {
  // Use basic strings with escaping for most cases
  // Escape backslash, quotes, and control characters
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Format a value for TOML output
 */
function formatTomlValue(value: unknown): string {
  if (typeof value === 'string') {
    return `"${escapeTomlString(value)}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    // Format as inline array
    return `[${value.map(formatTomlValue).join(', ')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    // Format as inline table
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k} = ${formatTomlValue(v)}`)
      .join(', ');
    return `{ ${entries} }`;
  }
  return '""';
}

/**
 * Generate a TOML section for an MCP server
 */
function generateMcpServerSection(
  slug: string,
  config: SdkMcpServerConfig
): string {
  // Validate slug before using in TOML section name (defense-in-depth)
  const safeSlug = validateSlugForToml(slug);

  const lines: string[] = [];
  lines.push(`[mcp_servers.${safeSlug}]`);

  if (config.type === 'stdio') {
    // Stdio transport (local subprocess)
    lines.push(`command = ${formatTomlValue(config.command)}`);

    if (config.args && config.args.length > 0) {
      lines.push(`args = ${formatTomlValue(config.args)}`);
    }

    if (config.env && Object.keys(config.env).length > 0) {
      lines.push(`env = ${formatTomlValue(config.env)}`);
    }

    if (config.cwd) {
      lines.push(`cwd = ${formatTomlValue(config.cwd)}`);
    }
  } else {
    // HTTP/SSE transport (remote server)
    lines.push(`url = ${formatTomlValue(config.url)}`);

    if (config.headers && Object.keys(config.headers).length > 0) {
      lines.push(`headers = ${formatTomlValue(config.headers)}`);
    }

    // Add bearer token env var if present (Codex-specific auth pattern)
    if (config.bearerTokenEnvVar) {
      lines.push(`bearer_token_env_var = ${formatTomlValue(config.bearerTokenEnvVar)}`);
    }
  }

  // Add reasonable timeouts
  lines.push('startup_timeout_sec = 15');
  lines.push('tool_timeout_sec = 120');

  return lines.join('\n');
}

/**
 * Generate a TOML section for the Bridge MCP Server
 */
function generateBridgeServerSection(
  bridgeServerPath: string,
  bridgeConfigPath: string,
  nodeCommand: string,
  sessionPath?: string,
  workspaceId?: string
): string {
  const lines: string[] = [];
  lines.push('[mcp_servers.api-bridge]');
  lines.push(`command = ${formatTomlValue(nodeCommand)}`);

  // Build args array
  const args: string[] = [bridgeServerPath];
  args.push('--config', bridgeConfigPath);

  if (sessionPath) {
    args.push('--session', sessionPath);
  }

  if (workspaceId) {
    args.push('--workspace', workspaceId);
  }

  lines.push(`args = ${formatTomlValue(args)}`);

  // Bridge server may need longer timeouts for API calls
  lines.push('startup_timeout_sec = 10');
  lines.push('tool_timeout_sec = 180');

  return lines.join('\n');
}

/**
 * Generate a TOML section for the Session MCP Server.
 * Provides session-scoped tools (SubmitPlan, config_validate, etc.) to Codex.
 */
function generateSessionServerSection(
  sessionServerPath: string,
  sessionId: string,
  workspaceRootPath: string,
  plansFolderPath: string,
  nodeCommand: string
): string {
  const lines: string[] = [];
  lines.push('[mcp_servers.session]');
  lines.push(`command = ${formatTomlValue(nodeCommand)}`);

  // Build args array
  const args: string[] = [sessionServerPath];
  args.push('--session-id', sessionId);
  args.push('--workspace-root', workspaceRootPath);
  args.push('--plans-folder', plansFolderPath);

  lines.push(`args = ${formatTomlValue(args)}`);

  // Session server should start quickly
  lines.push('startup_timeout_sec = 10');
  // Some tools (like config validation) may take time
  lines.push('tool_timeout_sec = 60');

  return lines.join('\n');
}

/**
 * Generate TOML sections for a custom model provider.
 * Creates both [model_providers.*] and [profiles.*] sections.
 *
 * @param provider - Model provider configuration
 * @returns TOML string with provider and profile sections
 */
function generateModelProviderSection(provider: ModelProviderConfig): string {
  const lines: string[] = [];

  // Model provider section
  lines.push(`[model_providers.${provider.id}]`);
  lines.push(`name = ${formatTomlValue(provider.name)}`);
  lines.push(`base_url = ${formatTomlValue(provider.baseUrl)}`);
  lines.push(`env_key = ${formatTomlValue(provider.envKey)}`);
  if (provider.wireApi) {
    lines.push(`wire_api = ${formatTomlValue(provider.wireApi)}`);
  }
  lines.push('');

  // Default profile section to use this provider
  lines.push(`[profiles.${provider.id}]`);
  if (provider.defaultModel) {
    lines.push(`model = ${formatTomlValue(provider.defaultModel)}`);
  }
  lines.push(`model_provider = ${formatTomlValue(provider.id)}`);

  return lines.join('\n');
}

/**
 * Generate Codex config.toml content from sources.
 *
 * @param options - Configuration options
 * @returns Generated TOML and metadata
 */
export function generateCodexConfig(options: CodexConfigGeneratorOptions): CodexConfigResult {
  const {
    sources,
    mcpServerConfigs = {},
    bridgeServerPath,
    bridgeConfigPath,
    sessionPath,
    workspaceId,
    modelProvider,
    sessionServerPath,
    sessionId,
    workspaceRootPath,
    plansFolderPath,
    nodePath,
  } = options;

  const mcpSources: string[] = [];
  const apiSources: string[] = [];
  const warnings: ConfigWarning[] = [];
  const sections: string[] = [];

  // Header comment
  sections.push('# Generated by Craft Agent - DO NOT EDIT');
  sections.push(`# Generated at: ${new Date().toISOString()}`);
  sections.push('# Regenerated when sources are toggled');
  sections.push('');

  // Add custom model provider if configured (OpenRouter, Vercel AI Gateway, etc.)
  if (modelProvider) {
    sections.push('# Custom Model Provider');
    sections.push(generateModelProviderSection(modelProvider));
    sections.push('');
  }

  // Process each source
  for (const source of sources) {
    if (!isSourceUsable(source)) continue;

    const slug = source.config.slug;

    if (source.config.type === 'mcp') {
      // MCP source - use pre-built config if available
      const serverConfig = mcpServerConfigs[slug];
      if (serverConfig) {
        // Validate slug before using (may throw for invalid slugs)
        try {
          sections.push(generateMcpServerSection(slug, serverConfig));
          sections.push('');
          mcpSources.push(slug);
        } catch (error) {
          // Slug validation failed - add warning and skip this source
          warnings.push({
            sourceSlug: slug,
            type: 'slug_validation_failed',
            message: error instanceof Error ? error.message : `Invalid slug: ${slug}`,
          });
        }
      } else {
        // Enabled MCP source without server config - likely auth missing
        warnings.push({
          sourceSlug: slug,
          type: 'missing_server_config',
          message: `MCP source "${slug}" is enabled but has no server config (missing credentials?)`,
        });
      }
    } else if (source.config.type === 'api') {
      // API source - needs bridge server
      apiSources.push(slug);
    }
    // Local sources are not currently supported via Codex config
  }

  // Add bridge server if we have API sources
  const needsBridge = apiSources.length > 0 && !!bridgeServerPath && !!bridgeConfigPath;
  if (apiSources.length > 0 && !needsBridge) {
    // API sources exist but bridge is not configured
    for (const slug of apiSources) {
      warnings.push({
        sourceSlug: slug,
        type: 'bridge_not_configured',
        message: `API source "${slug}" cannot be used - bridge server not configured`,
      });
    }
  }

  if (needsBridge) {
    const nodeCommand = nodePath || 'node';
    sections.push(generateBridgeServerSection(
      bridgeServerPath,
      bridgeConfigPath,
      nodeCommand,
      sessionPath,
      workspaceId
    ));
    sections.push('');
  }

  // Add session server for session-scoped tools (SubmitPlan, config_validate, etc.)
  // This is always included when the session server path is provided
  if (sessionServerPath && sessionId && workspaceRootPath && plansFolderPath) {
    const nodeCommand = nodePath || 'node';
    sections.push('# Session-scoped tools (SubmitPlan, config_validate, mermaid_validate, etc.)');
    sections.push(generateSessionServerSection(
      sessionServerPath,
      sessionId,
      workspaceRootPath,
      plansFolderPath,
      nodeCommand
    ));
    sections.push('');
  }

  return {
    toml: sections.join('\n'),
    mcpSources,
    apiSources,
    needsBridge,
    warnings,
  };
}

/**
 * Credential cache entry for the bridge server.
 * Written by the main process, read by the bridge.
 */
export interface CredentialCacheEntry {
  value: string;
  expiresAt?: number;
}

/**
 * Get the path to a source's credential cache file.
 * The bridge server reads these files to get decrypted credentials.
 */
export function getCredentialCachePath(
  workspaceRootPath: string,
  sourceSlug: string
): string {
  return `${workspaceRootPath}/sources/${sourceSlug}/.credential-cache.json`;
}

/**
 * Generate a JSON config file for the Bridge MCP Server.
 * This file tells the bridge which API sources to expose and how to authenticate.
 *
 * @param sources - API sources to include
 * @returns JSON string for the bridge config
 */
export function generateBridgeConfig(sources: LoadedSource[]): string {
  const apiSources = sources.filter(
    s => s.config.enabled && s.config.type === 'api'
  );

  const config = {
    sources: apiSources.map(source => ({
      slug: source.config.slug,
      name: source.config.name,
      provider: source.config.provider,
      baseUrl: source.config.api?.baseUrl,
      authType: source.config.api?.authType,
      headerName: source.config.api?.headerName,
      queryParam: source.config.api?.queryParam,
      authScheme: source.config.api?.authScheme,
      defaultHeaders: source.config.api?.defaultHeaders,
      // Include workspace info for credential lookups
      workspaceId: source.workspaceId,
      // Guide content for tool description
      guideRaw: source.guide?.raw,
    })),
  };

  return JSON.stringify(config, null, 2);
}
