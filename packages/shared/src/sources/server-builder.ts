/**
 * SourceServerBuilder
 *
 * Builds MCP and API server configurations from LoadedSource objects.
 * This module handles URL normalization and server config creation,
 * but does NOT fetch credentials - credentials are passed in.
 *
 * This replaces SourceService's server building logic with a cleaner
 * separation of concerns:
 * - SourceCredentialManager: handles credentials
 * - SourceServerBuilder: handles server configuration
 */

import type { LoadedSource } from './types.ts';
import type { ApiConfig } from '../agents/types.ts';
import type { ApiCredential } from './credential-manager.ts';
import { createGmailServer } from '../agents/gmail-tools.ts';
import { createApiServer } from '../agents/api-tools.ts';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { debug } from '../utils/debug.ts';

/**
 * MCP server configuration compatible with Claude Agent SDK
 */
export interface McpServerConfig {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

/**
 * Source with its credential pre-loaded
 */
export interface SourceWithCredential {
  source: LoadedSource;
  /** Token for MCP sources, or ApiCredential for API sources */
  token?: string | null;
  credential?: ApiCredential | null;
}

/**
 * Result of building servers from sources
 */
export interface BuiltServers {
  /** MCP server configs keyed by source slug */
  mcpServers: Record<string, McpServerConfig>;
  /** In-process API servers keyed by source slug */
  apiServers: Record<string, ReturnType<typeof createSdkMcpServer>>;
  /** Sources that failed to build (missing auth, etc.) */
  errors: Array<{ sourceSlug: string; error: string }>;
}

/**
 * SourceServerBuilder - builds server configs from sources
 *
 * Usage:
 * ```typescript
 * const builder = new SourceServerBuilder();
 *
 * // Build MCP server config
 * const mcpConfig = builder.buildMcpServer(source, token);
 *
 * // Build all servers from sources with credentials
 * const { mcpServers, apiServers, errors } = await builder.buildAll([
 *   { source, token: 'abc123' },
 *   { source: apiSource, credential: 'api-key' },
 * ]);
 * ```
 */
export class SourceServerBuilder {
  /**
   * Build MCP server config from a source
   *
   * @param source - The source configuration
   * @param token - Authentication token (null for public sources)
   */
  buildMcpServer(source: LoadedSource, token: string | null): McpServerConfig | null {
    if (source.config.type !== 'mcp' || !source.config.mcp) {
      return null;
    }

    const mcp = source.config.mcp;
    const url = normalizeMcpUrl(mcp.url);

    const config: McpServerConfig = {
      type: url.includes('/sse') ? 'sse' : 'http',
      url,
    };

    // Handle authentication
    if (mcp.authType !== 'none') {
      if (token) {
        config.headers = { Authorization: `Bearer ${token}` };
      } else if (source.config.isAuthenticated) {
        // Expected token but not provided - needs re-auth
        debug(`[SourceServerBuilder] Source ${source.config.slug} needs re-authentication`);
        return null;
      }
    }

    return config;
  }

  /**
   * Build API server from a source
   *
   * @param source - The source configuration
   * @param credential - API credential (null for public APIs)
   * @param getToken - Token getter for OAuth APIs (Gmail, etc.)
   */
  async buildApiServer(
    source: LoadedSource,
    credential: ApiCredential | null,
    getToken?: () => Promise<string>
  ): Promise<ReturnType<typeof createSdkMcpServer> | null> {
    if (source.config.type !== 'api') return null;
    if (!source.config.api) {
      debug(`[SourceServerBuilder] API source ${source.config.slug} missing api config`);
      return null;
    }

    // Gmail special handling - uses OAuth tokens with dedicated Gmail tools
    if (source.config.provider === 'gmail') {
      if (!source.config.isAuthenticated || !getToken) {
        debug(`[SourceServerBuilder] Gmail source ${source.config.slug} not authenticated`);
        return null;
      }
      debug(`[SourceServerBuilder] Building Gmail server for ${source.config.slug}`);
      return createGmailServer(getToken);
    }

    const apiConfig = source.config.api;
    const authType = apiConfig.authType;

    // Public APIs (no auth) can be used immediately
    if (authType === 'none') {
      debug(`[SourceServerBuilder] Building public API server for ${source.config.slug}`);
      const config = this.buildApiConfig(source);
      return createApiServer(config, '');
    }

    // OAuth APIs - use token getter
    if (authType === 'oauth') {
      if (!source.config.isAuthenticated || !getToken) {
        debug(`[SourceServerBuilder] OAuth API source ${source.config.slug} not authenticated`);
        return null;
      }
      const token = await getToken();
      debug(`[SourceServerBuilder] Building OAuth API server for ${source.config.slug}`);
      const config = this.buildApiConfig(source);
      return createApiServer(config, token);
    }

    // API key/bearer/header/query/basic auth - use credential
    if (!credential) {
      debug(`[SourceServerBuilder] API source ${source.config.slug} needs credentials`);
      return null;
    }

    debug(`[SourceServerBuilder] Building API server for ${source.config.slug} (auth: ${authType})`);
    const config = this.buildApiConfig(source);
    return createApiServer(config, credential);
  }

  /**
   * Build ApiConfig from a LoadedSource
   */
  buildApiConfig(source: LoadedSource): ApiConfig {
    const api = source.config.api!;

    const config: ApiConfig = {
      name: source.config.slug,
      baseUrl: api.baseUrl,
      documentation: source.guide?.raw || '',
    };

    // Map auth type
    switch (api.authType) {
      case 'bearer':
        config.auth = { type: 'bearer', authScheme: api.authScheme || 'Bearer' };
        break;
      case 'header':
        config.auth = { type: 'header', headerName: api.headerName || 'x-api-key' };
        break;
      case 'query':
        config.auth = { type: 'query', queryParam: api.queryParam || 'api_key' };
        break;
      case 'basic':
        config.auth = { type: 'basic' };
        break;
      case 'none':
      default:
        config.auth = { type: 'none' };
    }

    return config;
  }

  /**
   * Build all MCP and API servers for enabled sources
   *
   * @param sourcesWithCredentials - Sources with their pre-loaded credentials
   * @param getTokenForSource - Function to get token getter for OAuth sources
   */
  async buildAll(
    sourcesWithCredentials: SourceWithCredential[],
    getTokenForSource?: (source: LoadedSource) => (() => Promise<string>) | undefined
  ): Promise<BuiltServers> {
    const mcpServers: Record<string, McpServerConfig> = {};
    const apiServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};
    const errors: BuiltServers['errors'] = [];

    for (const { source, token, credential } of sourcesWithCredentials) {
      if (!source.config.enabled) continue;

      try {
        if (source.config.type === 'mcp') {
          const config = this.buildMcpServer(source, token ?? null);
          if (config) {
            debug(`[SourceServerBuilder] Built MCP server for ${source.config.slug}`);
            mcpServers[source.config.slug] = config;
          } else if (source.config.mcp?.authType !== 'none') {
            debug(`[SourceServerBuilder] MCP server ${source.config.slug} needs auth`);
            errors.push({
              sourceSlug: source.config.slug,
              error: 'Authentication required',
            });
          }
        } else if (source.config.type === 'api') {
          const getToken = getTokenForSource?.(source);
          const server = await this.buildApiServer(source, credential ?? null, getToken);
          if (server) {
            apiServers[source.config.slug] = server;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debug(`[SourceServerBuilder] Failed to build server for ${source.config.slug}: ${message}`);
        errors.push({ sourceSlug: source.config.slug, error: message });
      }
    }

    return { mcpServers, apiServers, errors };
  }
}

/**
 * Normalize MCP URL to standard format
 * - Removes trailing slashes
 * - Preserves /sse suffix for SSE type detection
 * - Ensures /mcp suffix for HTTP type
 */
export function normalizeMcpUrl(url: string): string {
  url = url.replace(/\/+$/, '');

  // If URL ends with /sse, keep it for SSE type detection
  if (url.endsWith('/sse')) {
    return url;
  }

  // Ensure /mcp suffix for HTTP type
  if (!url.endsWith('/mcp')) {
    url = url + '/mcp';
  }

  return url;
}

// Singleton instance
let instance: SourceServerBuilder | null = null;

/**
 * Get shared SourceServerBuilder instance
 */
export function getSourceServerBuilder(): SourceServerBuilder {
  if (!instance) {
    instance = new SourceServerBuilder();
  }
  return instance;
}
