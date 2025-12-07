/**
 * Sub-agent manager
 *
 * Manages the lifecycle of sub-agents:
 * - Discovery: Scan "Agents" folder via MCP
 * - Activation: Load and activate agents
 * - Self-modification: Update agent instructions
 */

import { CraftMcpClient } from '../mcp/client.ts';
import type {
  SubAgentMetadata,
  SubAgentDefinition,
  ActiveAgentState,
  AgentRegistry,
  McpServerConfig,
  ApiConfig,
} from './types.ts';
import { createApiServer } from './api-tools.ts';
import { normalizeAgentName } from './parser.ts';
import { extractAgentDefinition } from './extractor.ts';
import {
  loadRegistry,
  saveRegistry,
  loadDefinition,
  saveDefinition,
  invalidateDefinition,
  getServerCredentials,
  isCredentialExpired,
  saveServerCredentials,
} from './cache.ts';
import { CraftOAuth, getMcpBaseUrl } from '../auth/oauth.ts';
import { debug } from '../tui/utils/debug.ts';

/**
 * Configuration for SubAgentManager
 */
export interface SubAgentManagerConfig {
  model: string;
  mcpUrl: string;
  mcpToken?: string;
}

/**
 * MCP response types
 */
interface FolderInfo {
  id: string;
  name: string;
}

interface DocumentInfo {
  id: string;
  title: string;
}

interface BlocksResponse {
  content?: Array<{
    type: string;
    text?: string;
  }>;
}

/**
 * SubAgentManager handles discovery, activation, and management of sub-agents
 */
export class SubAgentManager {
  private workspaceId: string;
  private mcpClient: CraftMcpClient;
  private config: SubAgentManagerConfig;
  private activeAgent: ActiveAgentState = { type: 'main' };
  private registry: AgentRegistry | null = null;
  /** Cache for API servers (created once per agent activation) */
  private apiServerCache: Map<string, ReturnType<typeof createApiServer>> = new Map();

  constructor(workspaceId: string, mcpClient: CraftMcpClient, config: SubAgentManagerConfig) {
    this.workspaceId = workspaceId;
    this.mcpClient = mcpClient;
    this.config = config;

    // Try to load cached registry
    this.registry = loadRegistry(workspaceId);
  }

  /**
   * Check if agent definition needs fresh extraction (cache miss)
   * Used by UI to show extraction progress
   */
  needsFreshExtraction(agentId: string): boolean {
    const fileCached = loadDefinition(this.workspaceId, agentId);
    return !fileCached?.definition;
  }

  /**
   * Check if agent needs fresh extraction by name
   */
  async needsFreshExtractionByName(name: string): Promise<boolean> {
    const agents = await this.getAvailableAgents();
    const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (!agent) return false;
    return this.needsFreshExtraction(agent.id);
  }

  // ============================================================
  // Discovery
  // ============================================================

  /**
   * Discover agents from the "Agents" folder
   * Returns list of discovered agents
   * Throws on MCP errors (callers should handle)
   */
  async discoverAgents(): Promise<SubAgentMetadata[]> {
    // 1. List all folders to find "Agents" folder
    const foldersResult = await this.callMcpTool('folders_list', {});
    const folders = this.parseFolders(foldersResult);

    const agentsFolder = folders.find(
      (f) => f.name.toLowerCase() === 'agents'
    );

    if (!agentsFolder) {
      // No Agents folder found - not an error, just empty
      this.registry = {
        agents: [],
        lastRefreshed: Date.now(),
      };
      saveRegistry(this.workspaceId, this.registry);
      debug('[discoverAgents] No "Agents" folder found');
      return [];
    }

    // 2. List documents in the Agents folder
    const docsResult = await this.callMcpTool('documents_list', {
      location: { folderId: agentsFolder.id },
    });
    const documents = this.parseDocuments(docsResult);

    // 3. Create metadata for each document
    const agents: SubAgentMetadata[] = documents.map((doc) => ({
      id: doc.id,
      name: normalizeAgentName(doc.title),
      documentId: doc.id,
      workspaceId: this.workspaceId,
      createdAt: Date.now(),
    }));

    // Save to registry
    this.registry = {
      agents,
      agentsFolderId: agentsFolder.id,
      lastRefreshed: Date.now(),
    };
    saveRegistry(this.workspaceId, this.registry);

    debug('[discoverAgents] Found agents:', agents.map(a => a.name));
    return agents;
  }

  /**
   * Get list of available agents (from cache or discovery)
   */
  async getAvailableAgents(): Promise<SubAgentMetadata[]> {
    if (this.registry?.agents) {
      return this.registry.agents;
    }
    return this.discoverAgents();
  }

  /**
   * Refresh agent discovery
   */
  async refreshAgents(): Promise<SubAgentMetadata[]> {
    return this.discoverAgents();
  }

  // ============================================================
  // Definition Loading
  // ============================================================

  /**
   * Get full agent definition (from cache or fetch)
   */
  async getDefinition(agentId: string): Promise<SubAgentDefinition | null> {
    debug('[getDefinition] agentId:', agentId);

    // Check file cache
    const fileCached = loadDefinition(this.workspaceId, agentId);
    debug('[getDefinition] file cache:', fileCached ? 'HIT' : 'MISS');
    if (fileCached?.definition) {
      return fileCached.definition;
    }

    // Fetch from Craft
    const metadata = this.registry?.agents.find((a) => a.id === agentId);
    if (!metadata) {
      debug('[getDefinition] agent not found in registry');
      return null;
    }

    try {
      // Use agentic extraction - Claude will fetch the document using MCP tools
      debug('[getDefinition] starting agentic extraction for documentId:', metadata.documentId);
      const extracted = await extractAgentDefinition(
        metadata.documentId,
        metadata.name,
        this.config.model,
        this.config.mcpUrl,
        this.config.mcpToken,
      );

      // Check if extraction actually got content
      if (!extracted.instructions || extracted.instructions.trim().length === 0) {
        debug('[getDefinition] extraction returned empty instructions - treating as failure');
        return null;
      }

      const definition: SubAgentDefinition = {
        name: normalizeAgentName(metadata.name),
        instructions: extracted.instructions,
        instructionsBlockId: extracted.instructionsBlockId,
        mcpServers: extracted.mcpServers?.length ? extracted.mcpServers : undefined,
        apis: extracted.apis?.length ? extracted.apis : undefined,
        info: extracted.info?.length ? extracted.info : undefined,
        rawContent: extracted.instructions, // Use instructions as raw content since we don't have separate raw
        parsedAt: Date.now(),
      };

      debug('[getDefinition] extracted definition:', definition.name,
        'instructions:', definition.instructions?.length || 0, 'chars',
        'instructionsBlockId:', definition.instructionsBlockId || 'none',
        'mcpServers:', definition.mcpServers?.length || 0);

      // Cache the definition to file
      saveDefinition(this.workspaceId, metadata, definition);

      return definition;
    } catch (error) {
      debug('[getDefinition] failed to fetch agent definition:', error);
      return null;
    }
  }

  // ============================================================
  // Activation
  // ============================================================

  /**
   * Activate an agent by name
   * Returns the definition if successful, null otherwise
   */
  async activateAgent(name: string): Promise<SubAgentDefinition | null> {
    debug('[activateAgent] Activating agent:', name);
    const agents = await this.getAvailableAgents();
    debug('[activateAgent] Available agents:', agents.map(a => a.name));
    const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());

    if (!agent) {
      debug('[activateAgent] Agent not found in registry');
      return null;
    }

    debug('[activateAgent] Found agent:', agent.name, 'id:', agent.id);
    const definition = await this.getDefinition(agent.id);
    if (!definition) {
      debug('[activateAgent] Failed to get definition for agent');
      return null;
    }

    this.activeAgent = {
      type: 'sub-agent',
      agentId: agent.id,
      activatedAt: Date.now(),
    };

    debug('[activateAgent] Agent activated successfully');
    return definition;
  }

  /**
   * Deactivate current agent and return to main
   */
  deactivateAgent(): void {
    this.activeAgent = { type: 'main' };
  }

  /**
   * Get current active agent state
   */
  getActiveAgent(): ActiveAgentState {
    return this.activeAgent;
  }

  /**
   * Get active agent name (for UI display)
   */
  getActiveAgentName(): string | null {
    if (this.activeAgent.type !== 'sub-agent' || !this.activeAgent.agentId) {
      return null;
    }
    const agent = this.registry?.agents.find((a) => a.id === this.activeAgent.agentId);
    return agent?.name || null;
  }

  // ============================================================
  // Self-Modification
  // ============================================================

  /**
   * Update the active agent's instructions
   * Appends content to the Instructions subpage
   */
  async updateInstructions(content: string): Promise<boolean> {
    if (this.activeAgent.type !== 'sub-agent' || !this.activeAgent.agentId) {
      return false;
    }

    const definition = await this.getDefinition(this.activeAgent.agentId);
    if (!definition || !definition.instructionsBlockId) {
      return false;
    }

    try {
      // Append to the instructions block using markdown_add
      await this.callMcpTool('markdown_add', {
        documentId: this.registry?.agents.find((a) => a.id === this.activeAgent.agentId)?.documentId,
        blockId: definition.instructionsBlockId,
        content: `\n\n${content}`,
        position: 'end',
      });

      // Invalidate cache so next fetch gets updated content
      invalidateDefinition(this.workspaceId, this.activeAgent.agentId);

      return true;
    } catch (error) {
      debug('Failed to update agent instructions:', error);
      return false;
    }
  }

  // ============================================================
  // MCP Server Config
  // ============================================================

  /**
   * Build SDK-compatible MCP server config from agent definition
   * Automatically refreshes expired tokens if possible
   */
  async buildMcpServerConfig(
    definition: SubAgentDefinition
  ): Promise<Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>> {
    const servers: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }> = {};

    if (!definition.mcpServers || !this.activeAgent.agentId) {
      return servers;
    }

    for (const config of definition.mcpServers) {
      const name = config.name || this.extractNameFromUrl(config.url);
      debug('[manager.buildMcpServerConfig] Processing server:', name, 'requiresAuth:', config.requiresAuth);

      // Get credentials if auth required
      let headers: Record<string, string> | undefined;

      // Check for static bearer token first (no OAuth needed)
      if (config.bearerToken) {
        headers = {
          Authorization: `Bearer ${config.bearerToken}`,
        };
        debug('[manager.buildMcpServerConfig] Using static bearer token for', name);
      } else if (config.requiresAuth) {
        const creds = getServerCredentials(
          this.workspaceId,
          this.activeAgent.agentId,
          name
        );

        if (creds) {
          const isExpired = isCredentialExpired(this.workspaceId, this.activeAgent.agentId, name);
          debug('[manager.buildMcpServerConfig] Credentials found for', name, 'expired:', isExpired, 'hasClientId:', !!creds.clientId);

          if (isExpired) {
            // Token expired - try to refresh if we have refresh token and clientId
            if (creds.refreshToken && creds.clientId) {
              debug('[manager.buildMcpServerConfig] Attempting token refresh for', name);
              try {
                const oauth = new CraftOAuth(
                  { mcpBaseUrl: getMcpBaseUrl(config.url) },
                  { onStatus: () => {}, onError: () => {} }
                );
                const newTokens = await oauth.refreshAccessToken(creds.refreshToken, creds.clientId);

                // Save refreshed credentials
                saveServerCredentials(this.workspaceId, this.activeAgent.agentId, name, {
                  accessToken: newTokens.accessToken,
                  refreshToken: newTokens.refreshToken || creds.refreshToken,
                  expiresAt: newTokens.expiresAt,
                  clientId: creds.clientId,
                });

                headers = {
                  Authorization: `Bearer ${newTokens.accessToken}`,
                };
                debug('[manager.buildMcpServerConfig] Token refreshed successfully for', name);
              } catch (refreshError) {
                debug('[manager.buildMcpServerConfig] Token refresh failed for', name, ':', refreshError);
                debug('[manager.buildMcpServerConfig] User needs to re-authenticate via /auth');
              }
            } else {
              debug('[manager.buildMcpServerConfig] Token expired for', name, '- no refresh token or clientId, needs re-authentication via /auth');
            }
          } else {
            headers = {
              Authorization: `Bearer ${creds.accessToken}`,
            };
            debug('[manager.buildMcpServerConfig] Using valid token for', name);
          }
        } else {
          debug('[manager.buildMcpServerConfig] No credentials found for', name, '- needs authentication');
        }
      }

      servers[name] = {
        type: config.url.includes('/sse') ? 'sse' : 'http',
        url: config.url,
        ...(headers && { headers }),
      };
      debug('[manager.buildMcpServerConfig] Added server:', name, 'type:', servers[name].type, 'hasAuth:', !!headers);
    }

    return servers;
  }

  /**
   * Get MCP servers that require authentication
   */
  getMcpServersNeedingAuth(definition: SubAgentDefinition): McpServerConfig[] {
    if (!definition.mcpServers || !this.activeAgent.agentId) {
      return [];
    }

    return definition.mcpServers.filter((config) => {
      if (!config.requiresAuth) return false;

      const name = config.name || this.extractNameFromUrl(config.url);
      return isCredentialExpired(this.workspaceId, this.activeAgent.agentId!, name);
    });
  }

  // ============================================================
  // API Server Config
  // ============================================================

  /**
   * Get APIs that need authentication (have auth config but no stored key)
   */
  getApisNeedingAuth(definition: SubAgentDefinition): ApiConfig[] {
    if (!definition.apis || !this.activeAgent.agentId) {
      return [];
    }

    return definition.apis.filter((api) => {
      // No auth needed for this API
      if (!api.auth) return false;

      // Check if we have stored credentials
      const creds = getServerCredentials(
        this.workspaceId,
        this.activeAgent.agentId!,
        `api_${api.name}`
      );
      return !creds?.accessToken;
    });
  }

  /**
   * Build in-process MCP servers for all APIs with credentials
   * Returns servers keyed by `api_{name}`
   */
  buildApiServers(
    definition: SubAgentDefinition
  ): Record<string, ReturnType<typeof createApiServer>> {
    const servers: Record<string, ReturnType<typeof createApiServer>> = {};

    if (!definition.apis || !this.activeAgent.agentId) {
      return servers;
    }

    for (const api of definition.apis) {
      const serverKey = `api_${api.name}`;

      // Check cache first
      if (this.apiServerCache.has(serverKey)) {
        servers[serverKey] = this.apiServerCache.get(serverKey)!;
        debug(`[manager.buildApiServers] Using cached server for ${api.name}`);
        continue;
      }

      // Get API key (either stored or not needed)
      let apiKey = '';
      if (api.auth) {
        const creds = getServerCredentials(
          this.workspaceId,
          this.activeAgent.agentId,
          serverKey
        );
        if (!creds?.accessToken) {
          debug(`[manager.buildApiServers] No credentials for ${api.name}, skipping`);
          continue;
        }
        apiKey = creds.accessToken;
      }

      // Create and cache the server
      const server = createApiServer(api, apiKey);
      this.apiServerCache.set(serverKey, server);
      servers[serverKey] = server;

      debug(`[manager.buildApiServers] Created server for ${api.name} with ${api.endpoints.length} endpoints`);
    }

    return servers;
  }

  /**
   * Clear API server cache (called on agent deactivation)
   */
  clearApiServerCache(): void {
    debug(`[manager.clearApiServerCache] Clearing ${this.apiServerCache.size} cached servers`);
    this.apiServerCache.clear();
  }

  /**
   * Fetch tools from an MCP server
   * Creates a temporary connection to list available tools
   */
  async fetchMcpServerTools(
    definition: SubAgentDefinition
  ): Promise<McpServerConfig[]> {
    if (!definition.mcpServers || !this.activeAgent.agentId) {
      return [];
    }

    const results: McpServerConfig[] = [];

    for (const config of definition.mcpServers) {
      const name = config.name || this.extractNameFromUrl(config.url);
      const result: McpServerConfig = { ...config, name };

      try {
        // Get credentials if auth required
        let headers: Record<string, string> | undefined;

        // Check for static bearer token first (no credential lookup needed)
        if (config.bearerToken) {
          headers = {
            Authorization: `Bearer ${config.bearerToken}`,
          };
          debug('[manager.fetchMcpServerTools] Using static bearer token for', name);
        } else if (config.requiresAuth) {
          const creds = getServerCredentials(
            this.workspaceId,
            this.activeAgent.agentId,
            name
          );
          if (creds) {
            headers = { Authorization: `Bearer ${creds.accessToken}` };
          }
        }

        // Create temporary MCP client to list tools
        const client = new CraftMcpClient({
          url: config.url,
          headers,
        });

        await client.connect();
        const tools = await client.listTools();
        result.tools = tools.map(t => t.name);
        await client.close();

        debug('[manager.fetchMcpServerTools] Fetched', result.tools.length, 'tools from', name);
      } catch (err) {
        debug('[manager.fetchMcpServerTools] Failed to fetch tools from', name, ':', err);
        result.tools = [];
      }

      results.push(result);
    }

    return results;
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Call MCP tool via client
   */
  private async callMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.mcpClient.callTool(name, args);
  }

  /**
   * Parse folders from MCP response
   * Handles both array format and {folders: [...]} format
   * Flattens nested folders to find all folders at any level
   */
  private parseFolders(result: unknown): FolderInfo[] {
    // MCP returns { content: [{ type: 'text', text: JSON }] }
    const response = result as BlocksResponse;
    if (!response.content?.[0]?.text) {
      debug('[parseFolders] No content in response');
      return [];
    }

    try {
      const data = JSON.parse(response.content[0].text);

      // Handle both formats: array or {folders: [...]}
      let foldersArray: unknown[];
      if (Array.isArray(data)) {
        foldersArray = data;
      } else if (data && Array.isArray(data.folders)) {
        foldersArray = data.folders;
      } else {
        debug('[parseFolders] Data is neither array nor {folders: []}:', typeof data);
        return [];
      }

      // Recursively flatten nested folders
      const flattenFolders = (folders: unknown[]): FolderInfo[] => {
        const result: FolderInfo[] = [];
        for (const f of folders) {
          const folder = f as { id?: string; name?: string; folders?: unknown[] };
          result.push({
            id: String(folder.id || ''),
            name: String(folder.name || ''),
          });
          // Recursively add nested folders
          if (Array.isArray(folder.folders) && folder.folders.length > 0) {
            result.push(...flattenFolders(folder.folders));
          }
        }
        return result;
      };

      return flattenFolders(foldersArray);
    } catch (err) {
      debug('[parseFolders] JSON parse error:', err);
      return [];
    }
  }

  /**
   * Parse documents from MCP response
   * Handles both array format and {documents: [...]} format
   */
  private parseDocuments(result: unknown): DocumentInfo[] {
    const response = result as BlocksResponse;
    if (!response.content?.[0]?.text) {
      debug('[parseDocuments] No content in response');
      return [];
    }

    try {
      const data = JSON.parse(response.content[0].text);

      // Handle both formats: array or {documents: [...]}
      let docsArray: unknown[];
      if (Array.isArray(data)) {
        docsArray = data;
      } else if (data && Array.isArray(data.documents)) {
        docsArray = data.documents;
      } else {
        debug('[parseDocuments] Data is neither array nor {documents: []}:', typeof data);
        return [];
      }

      return docsArray.map((d) => {
        const doc = d as { id?: string; title?: string };
        return {
          id: String(doc.id || ''),
          title: String(doc.title || ''),
        };
      });
    } catch (err) {
      debug('[parseDocuments] JSON parse error:', err);
      return [];
    }
  }

  /**
   * Extract name from URL hostname
   */
  private extractNameFromUrl(url: string): string {
    try {
      const hostname = new URL(url).hostname;
      return hostname.replace(/^(mcp|api|www)\./, '').split('.')[0] || hostname;
    } catch {
      return 'unknown';
    }
  }
}
