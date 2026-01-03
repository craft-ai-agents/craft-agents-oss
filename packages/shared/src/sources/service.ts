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
import { CraftOAuth } from '../auth/oauth.ts';

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
 *
 * Note: This class is stateless - all credential lookups use `source.workspaceId`
 * from the LoadedSource objects passed to methods, not constructor parameters.
 */
export class SourceService {
  constructor() {}

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
            debug(`[SourceService] Built MCP server for ${source.config.slug}`);
            mcpServers[source.config.slug] = config;
          } else if (source.config.mcp?.authType !== 'none') {
            debug(`[SourceService] MCP server ${source.config.slug} needs auth (authType: ${source.config.mcp?.authType}, isAuthenticated: ${source.config.isAuthenticated})`);
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
   * For MCP sources, tries both OAuth and bearer credentials as fallback
   * (credentials may have been stored via source_credential_prompt with different mode than authType)
   */
  async getSourceToken(source: LoadedSource): Promise<string | null> {
    const manager = getCredentialManager();

    // For MCP sources, try both OAuth and bearer credentials
    // This handles cases where authType doesn't match the stored credential type
    if (source.config.type === 'mcp' && source.config.mcp?.authType !== 'none') {
      const baseId = {
        workspaceId: source.workspaceId,
        sourceId: source.config.slug,
        ...(source.agentSlug && { agentId: source.agentSlug }),
      };

      // Try OAuth first
      const oauthType = source.agentSlug ? 'agent_source_oauth' : 'source_oauth';
      const credentialId = { type: oauthType, ...baseId } as CredentialId;
      const oauthCreds = await manager.get(credentialId);
      if (oauthCreds?.value) {
        debug(`[SourceService] Found ${oauthType} token for ${source.config.slug}`);
        return this.checkAndRefreshToken(source, credentialId, oauthCreds);
      }

      // Fall back to bearer
      const bearerType = source.agentSlug ? 'agent_source_bearer' : 'source_bearer';
      const bearerCreds = await manager.get({ type: bearerType, ...baseId } as CredentialId);
      if (bearerCreds?.value) {
        debug(`[SourceService] Found ${bearerType} token for ${source.config.slug}`);
        return bearerCreds.value; // Bearer tokens don't expire
      }

      debug(`[SourceService] No OAuth or bearer token found for MCP source ${source.config.slug}`);
      return null;
    }

    // For non-MCP sources, use the credential ID based on authType
    const credentialId = this.getCredentialId(source);
    const creds = await manager.get(credentialId);

    if (!creds?.value) return null;

    return this.checkAndRefreshToken(source, credentialId, creds);
  }

  /**
   * Check if token needs refresh and attempt automatic refresh if possible.
   * Returns the token value if valid (possibly after refresh), or null if expired and can't refresh.
   */
  private async checkAndRefreshToken(
    source: LoadedSource,
    credentialId: CredentialId,
    creds: StoredCredential
  ): Promise<string | null> {
    // If no expiry set, assume token is valid
    if (!creds.expiresAt) {
      return creds.value;
    }

    const now = Date.now();
    const fiveMinutesFromNow = now + 5 * 60 * 1000;

    // Token is not expiring soon - return as is
    if (creds.expiresAt > fiveMinutesFromNow) {
      return creds.value;
    }

    debug(`[SourceService] Token for ${source.config.slug} expires soon or is expired, attempting refresh`);

    // Check if we can refresh (need refresh token, client ID, and MCP URL)
    const mcpUrl = source.config.mcp?.url;
    if (creds.refreshToken && creds.clientId && mcpUrl) {
      try {
        const oauth = new CraftOAuth(
          { mcpBaseUrl: mcpUrl },
          {
            onStatus: (msg) => debug(`[SourceService] OAuth refresh: ${msg}`),
            onError: (err) => debug(`[SourceService] OAuth refresh error: ${err}`),
          }
        );

        debug(`[SourceService] Refreshing token for ${source.config.slug}...`);
        const newTokens = await oauth.refreshAccessToken(creds.refreshToken, creds.clientId);

        // Update stored credentials with new tokens
        const manager = getCredentialManager();
        const updatedCreds: StoredCredential = {
          value: newTokens.accessToken,
          refreshToken: newTokens.refreshToken || creds.refreshToken,
          expiresAt: newTokens.expiresAt,
          clientId: creds.clientId,
          tokenType: newTokens.tokenType,
        };
        await manager.set(credentialId, updatedCreds);

        debug(`[SourceService] Token refreshed successfully for ${source.config.slug}`);
        return newTokens.accessToken;
      } catch (error) {
        debug(`[SourceService] Failed to refresh token for ${source.config.slug}: ${error}`);
        // Fall through to expiry check below
      }
    } else {
      debug(`[SourceService] Cannot refresh token for ${source.config.slug} - missing refresh token, client ID, or MCP URL`);
    }

    // If token is not yet expired, return it (even though it's expiring soon)
    if (creds.expiresAt > now) {
      debug(`[SourceService] Token for ${source.config.slug} is still valid (but expiring soon)`);
      return creds.value;
    }

    // Token is expired and we couldn't refresh
    debug(`[SourceService] Token for ${source.config.slug} is expired and could not be refreshed`);
    return null;
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
        } else if (api?.authType === 'bearer') {
          type = 'agent_source_bearer';
        } else if (api?.authType === 'basic') {
          type = 'agent_source_basic';
        } else {
          // header, query, or other → stored as apikey
          type = 'agent_source_apikey';
        }
      } else {
        type = 'agent_source_oauth';
      }

      return {
        type,
        workspaceId: source.workspaceId,
        agentId: source.agentSlug,
        sourceId: source.config.slug,
      };
    }

    // Workspace-scoped source
    if (source.config.type === 'mcp') {
      type = mcp?.authType === 'bearer' ? 'source_bearer' : 'source_oauth';
    } else if (source.config.type === 'api') {
      // Gmail always uses OAuth flow regardless of authType in config
      if (source.config.provider === 'gmail') {
        type = 'source_oauth';
      } else if (api?.authType === 'oauth') {
        type = 'source_oauth';
      } else if (api?.authType === 'bearer') {
        type = 'source_bearer';
      } else if (api?.authType === 'basic') {
        type = 'source_basic';
      } else {
        // header, query, or other → stored as apikey
        type = 'source_apikey';
      }
    } else {
      type = 'source_oauth';
    }

    return {
      type,
      workspaceId: source.workspaceId,
      sourceId: source.config.slug,
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
 * Create a SourceService instance
 */
export function createSourceService(): SourceService {
  return new SourceService();
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
