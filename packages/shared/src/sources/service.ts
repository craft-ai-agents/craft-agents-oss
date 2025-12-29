/**
 * SourceService
 *
 * Builds MCP server configs and API servers from LoadedSource objects.
 * Handles credential lookup, token refresh, and URL normalization.
 */

import type { LoadedSource } from './types.ts';
import type { CredentialId, StoredCredential } from '../credentials/types.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { debug } from '../utils/debug.ts';
import { createGmailServer } from '../agents/gmail-tools.ts';
import { createApiServer, type ApiCredential, type BasicAuthCredential } from '../agents/api-tools.ts';
import type { ApiConfig } from '../agents/types.ts';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

/**
 * MCP server configuration compatible with Claude Agent SDK
 */
export interface McpServerConfig {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

/**
 * Result of building servers from sources
 */
export interface BuiltServers {
  /** MCP server configs keyed by source slug */
  mcpServers: Record<string, McpServerConfig>;
  /** In-process API servers (Gmail, etc.) keyed by source slug */
  apiServers: Record<string, ReturnType<typeof createSdkMcpServer>>;
  /** Sources that failed to build (missing auth, etc.) */
  errors: Array<{ sourceSlug: string; error: string }>;
}

/**
 * SourceService - builds MCP/API servers from workspace sources
 */
export class SourceService {
  constructor(private workspaceSlug: string) {}

  /**
   * Build MCP server config from a source
   */
  async buildMcpServerConfig(source: LoadedSource): Promise<McpServerConfig | null> {
    if (source.config.type !== 'mcp' || !source.config.mcp) {
      return null;
    }

    const mcp = source.config.mcp;
    const url = this.normalizeMcpUrl(mcp.url);

    const config: McpServerConfig = {
      type: url.includes('/sse') ? 'sse' : 'http',
      url,
    };

    // Handle authentication
    if (mcp.authType !== 'none') {
      const token = await this.getSourceToken(source);
      if (token) {
        config.headers = { Authorization: `Bearer ${token}` };
      } else if (source.config.isAuthenticated) {
        // Expected token but not found - needs re-auth
        debug(`[SourceService] Source ${source.config.slug} needs re-authentication`);
        return null;
      }
    }

    return config;
  }

  /**
   * Build all MCP and API servers for enabled sources
   */
  async buildAllServers(sources: LoadedSource[]): Promise<BuiltServers> {
    const mcpServers: Record<string, McpServerConfig> = {};
    const apiServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};
    const errors: BuiltServers['errors'] = [];

    for (const source of sources) {
      if (!source.config.enabled) continue;

      try {
        if (source.config.type === 'mcp') {
          const config = await this.buildMcpServerConfig(source);
          if (config) {
            mcpServers[source.config.slug] = config;
          } else if (source.config.mcp?.authType !== 'none') {
            errors.push({
              sourceSlug: source.config.slug,
              error: 'Authentication required',
            });
          }
        } else if (source.config.type === 'api') {
          // Build API servers for authenticated sources
          const server = await this.buildApiServer(source);
          if (server) {
            apiServers[source.config.slug] = server;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debug(`[SourceService] Failed to build server for ${source.config.slug}: ${message}`);
        errors.push({ sourceSlug: source.config.slug, error: message });
      }
    }

    return { mcpServers, apiServers, errors };
  }

  /**
   * Build an in-process API server for a source (Gmail, generic APIs, etc.)
   */
  async buildApiServer(source: LoadedSource): Promise<ReturnType<typeof createSdkMcpServer> | null> {
    if (source.config.type !== 'api') return null;
    if (!source.config.api) {
      debug(`[SourceService] API source ${source.config.slug} missing api config`);
      return null;
    }

    // Gmail special handling - uses OAuth tokens with dedicated Gmail tools
    if (source.config.provider === 'gmail') {
      if (!source.config.isAuthenticated) {
        debug(`[SourceService] Gmail source ${source.config.slug} not authenticated`);
        return null;
      }
      debug(`[SourceService] Building Gmail server for ${source.config.slug}`);
      const getToken = async () => {
        const token = await this.getSourceToken(source);
        if (!token) throw new Error('Gmail token not found or expired');
        return token;
      };
      return createGmailServer(getToken);
    }

    // Generic API sources - use createApiServer with credentials
    const apiConfig = source.config.api;
    const authType = apiConfig.authType;

    // Public APIs (no auth) can be used immediately
    if (authType === 'none') {
      debug(`[SourceService] Building public API server for ${source.config.slug}`);
      const config: ApiConfig = {
        name: source.config.slug,
        baseUrl: apiConfig.baseUrl,
        auth: { type: 'none' },
        documentation: source.guide?.raw || '',
      };
      return createApiServer(config, '');
    }

    // OAuth APIs need to be authenticated
    if (authType === 'oauth') {
      if (!source.config.isAuthenticated) {
        debug(`[SourceService] OAuth API source ${source.config.slug} not authenticated`);
        return null;
      }
      const token = await this.getSourceToken(source);
      if (!token) {
        debug(`[SourceService] OAuth API source ${source.config.slug} token not found`);
        return null;
      }
      debug(`[SourceService] Building OAuth API server for ${source.config.slug}`);
      const config: ApiConfig = {
        name: source.config.slug,
        baseUrl: apiConfig.baseUrl,
        auth: { type: 'bearer', authScheme: apiConfig.authScheme || 'Bearer' },
        documentation: source.guide?.raw || '',
      };
      return createApiServer(config, token);
    }

    // API key/bearer/header/query/basic auth - get credential
    const credential = await this.getApiCredential(source);
    if (!credential) {
      debug(`[SourceService] API source ${source.config.slug} needs credentials`);
      return null;
    }

    debug(`[SourceService] Building API server for ${source.config.slug} (auth: ${authType})`);
    const config: ApiConfig = this.buildApiConfig(source);
    return createApiServer(config, credential);
  }

  /**
   * Get API credential for a source (API key, bearer token, or basic auth)
   */
  async getApiCredential(source: LoadedSource): Promise<ApiCredential | null> {
    const credentialId = this.getCredentialId(source);
    const manager = getCredentialManager();
    const creds = await manager.get(credentialId);

    if (!creds?.value) return null;

    // Check for basic auth (JSON with username/password)
    if (source.config.api?.authType === 'basic') {
      try {
        const parsed = JSON.parse(creds.value);
        if (parsed.username && parsed.password) {
          return parsed as BasicAuthCredential;
        }
      } catch {
        // Not JSON, treat as regular credential
      }
    }

    return creds.value;
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
   * Get token for a source
   */
  async getSourceToken(source: LoadedSource): Promise<string | null> {
    const credentialId = this.getCredentialId(source);
    const manager = getCredentialManager();
    const creds = await manager.get(credentialId);

    if (!creds?.value) return null;

    // Check if refresh needed (within 5 min of expiry)
    if (creds.expiresAt && creds.expiresAt < Date.now() + 5 * 60 * 1000) {
      debug(`[SourceService] Token for ${source.config.slug} needs refresh`);
      // Token refresh is handled by the OAuth flow, not here
      // The UI should detect expired tokens and trigger re-auth
      if (creds.expiresAt < Date.now()) {
        return null; // Token is expired
      }
    }

    return creds.value;
  }

  /**
   * Check if a source has valid credentials
   */
  async hasValidCredentials(source: LoadedSource): Promise<boolean> {
    const token = await this.getSourceToken(source);
    return token !== null;
  }

  /**
   * Get the credential ID for a source
   */
  getCredentialId(source: LoadedSource): CredentialId {
    const mcp = source.config.mcp;
    const api = source.config.api;

    // Determine credential type based on source type and auth type
    let type: CredentialId['type'];

    if (source.agentSlug) {
      // Agent-scoped source
      if (source.config.type === 'mcp') {
        type = mcp?.authType === 'bearer' ? 'agent_source_bearer' : 'agent_source_oauth';
      } else if (source.config.type === 'api') {
        if (api?.authType === 'oauth') {
          type = 'agent_source_oauth';
        } else if (api?.authType === 'bearer' || api?.authType === 'header') {
          type = 'agent_source_bearer';
        } else if (api?.authType === 'basic') {
          type = 'agent_source_basic';
        } else {
          type = 'agent_source_apikey';
        }
      } else {
        type = 'agent_source_oauth';
      }

      return {
        type,
        workspaceSlug: source.workspaceSlug,
        agentSlug: source.agentSlug,
        sourceSlug: source.config.slug,
      };
    }

    // Workspace-scoped source
    if (source.config.type === 'mcp') {
      type = mcp?.authType === 'bearer' ? 'source_bearer' : 'source_oauth';
    } else if (source.config.type === 'api') {
      if (api?.authType === 'oauth') {
        type = 'source_oauth';
      } else if (api?.authType === 'bearer' || api?.authType === 'header') {
        type = 'source_bearer';
      } else if (api?.authType === 'basic') {
        type = 'source_basic';
      } else {
        type = 'source_apikey';
      }
    } else {
      type = 'source_oauth';
    }

    return {
      type,
      workspaceSlug: source.workspaceSlug,
      sourceSlug: source.config.slug,
    };
  }

  /**
   * Normalize MCP URL to standard format
   * - Removes trailing slashes
   * - Converts /sse to /mcp for http type
   * - Ensures /mcp suffix for http type
   */
  private normalizeMcpUrl(url: string): string {
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
}

/**
 * Create a SourceService for a workspace
 */
export function createSourceService(workspaceSlug: string): SourceService {
  return new SourceService(workspaceSlug);
}

/**
 * Get sources from a list that need authentication
 * Returns sources that are enabled, require auth, and are not yet authenticated
 */
export function getSourcesNeedingAuth(sources: LoadedSource[]): LoadedSource[] {
  return sources.filter((source) => {
    if (!source.config.enabled) return false;

    const mcp = source.config.mcp;
    const api = source.config.api;

    // MCP sources with oauth/bearer auth
    if (source.config.type === 'mcp' && mcp) {
      if (mcp.authType !== 'none' && !source.config.isAuthenticated) {
        return true;
      }
    }

    // API sources with auth requirements
    if (source.config.type === 'api' && api) {
      if (api.authType !== 'none' && api.authType !== undefined && !source.config.isAuthenticated) {
        return true;
      }
    }

    return false;
  });
}
