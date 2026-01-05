/**
 * FolderAgentManager
 *
 * Manages agents from filesystem folders.
 * Replaces SubAgentManager for the new folder-based architecture.
 * No Craft document extraction - reads directly from files.
 *
 * Workspace-scoped: All operations require a workspaceId.
 */

import type {
  FolderAgentConfig,
  LoadedAgent,
  AgentDefinition,
  CreateAgentInput,
} from './folder-types.ts';
import type { LoadedSource, LocalSourceConfig } from '../sources/types.ts';
import type { McpServerConfig, ApiConfig } from './types.ts';
import { resolveSourceIconUrl } from '../utils/icon.ts';
import { getLogoUrl } from '../utils/logo.ts';
import {
  loadAgent,
  loadWorkspaceAgents,
  getEnabledAgents,
  loadAgentConfig,
  saveAgentConfig,
  saveAgentInstructions,
  createAgent,
  deleteAgent,
  resolveAgentSources,
} from './folder-storage.ts';

/**
 * FolderAgentManager - manages agents from filesystem
 *
 * Requires a workspaceRootPath for all operations since agents
 * are stored at {rootPath}/agents/
 */
export class FolderAgentManager {
  private workspaceRootPath: string;
  private activeAgentSlug: string | null = null;

  constructor(workspaceRootPath: string) {
    this.workspaceRootPath = workspaceRootPath;
  }

  /**
   * Get the workspace root path this manager is scoped to
   */
  getWorkspaceRootPath(): string {
    return this.workspaceRootPath;
  }

  /**
   * Get all available agents
   */
  getAvailableAgents(): LoadedAgent[] {
    return loadWorkspaceAgents(this.workspaceRootPath);
  }

  /**
   * Get enabled agents only
   */
  getEnabledAgents(): LoadedAgent[] {
    return getEnabledAgents(this.workspaceRootPath);
  }

  /**
   * Find agent by slug
   */
  getAgentBySlug(slug: string): LoadedAgent | null {
    return loadAgent(this.workspaceRootPath, slug);
  }

  /**
   * Find agent by @mention (handles with/without @ prefix)
   */
  getAgentByMention(mention: string): LoadedAgent | null {
    const normalized = mention.toLowerCase().replace(/^@/, '');
    const agents = this.getAvailableAgents();
    return agents.find((a) => a.config.slug === normalized) || null;
  }

  /**
   * Activate an agent by slug
   */
  activateAgent(slug: string): AgentDefinition | null {
    const agent = loadAgent(this.workspaceRootPath, slug);
    if (!agent || !agent.config.enabled) {
      return null;
    }

    this.activeAgentSlug = slug;
    return this.buildDefinition(agent);
  }

  /**
   * Deactivate current agent
   */
  deactivateAgent(): void {
    this.activeAgentSlug = null;
  }

  /**
   * Get agent definition by slug (used by AgentStateManager)
   */
  getAgentDefinition(slug: string): AgentDefinition | null {
    const agent = loadAgent(this.workspaceRootPath, slug);
    if (!agent || !agent.config.enabled) {
      return null;
    }
    return this.buildDefinition(agent);
  }

  /**
   * Reload all agents from disk
   */
  reload(): void {
    // Force re-read from disk by clearing any potential future caches
    // Currently stateless, but this method exists for API compatibility
  }

  /**
   * Get active agent slug
   */
  getActiveAgentSlug(): string | null {
    return this.activeAgentSlug;
  }

  /**
   * Get active agent
   */
  getActiveAgent(): LoadedAgent | null {
    if (!this.activeAgentSlug) return null;
    return loadAgent(this.workspaceRootPath, this.activeAgentSlug);
  }

  /**
   * Build AgentDefinition from LoadedAgent
   * Converts sources to McpServerConfig/ApiConfig for compatibility
   */
  buildDefinition(agent: LoadedAgent): AgentDefinition {
    const mcpServers: McpServerConfig[] = [];
    const apis: ApiConfig[] = [];
    const localSources: LocalSourceConfig[] = [];

    for (const source of agent.sources) {
      if (!source.config.enabled) continue;

      switch (source.config.type) {
        case 'mcp':
          if (source.config.mcp) {
            mcpServers.push(this.sourceToMcpConfig(source));
          }
          break;
        case 'api':
          if (source.config.api) {
            apis.push(this.sourceToApiConfig(source));
          }
          break;
        case 'local':
          if (source.config.local) {
            localSources.push(source.config.local);
          }
          break;
      }
    }

    return {
      name: agent.config.name,
      instructions: agent.instructions || '',
      mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
      apis: apis.length > 0 ? apis : undefined,
      localSources: localSources.length > 0 ? localSources : undefined,
      rawContent: agent.instructions || '',
      parsedAt: Date.now(),
    };
  }

  /**
   * Convert LoadedSource to McpServerConfig
   */
  private sourceToMcpConfig(source: LoadedSource): McpServerConfig {
    const mcp = source.config.mcp!;
    // Resolve icon: explicit iconUrl → derive from MCP URL (for http/sse) → undefined
    const logo = resolveSourceIconUrl(source.config.iconUrl, source.folderPath)
      ?? (mcp.url ? getLogoUrl(mcp.url) : undefined)
      ?? undefined;

    // Base config with common fields
    const config: McpServerConfig = {
      name: source.config.slug,
      transport: mcp.transport,
      description: source.guide?.scope,
      logo,
      // Pass through for credential lookup
      agentSlug: source.agentSlug,
      workspaceId: source.workspaceId,
    };

    // Add transport-specific fields
    if (mcp.transport === 'stdio') {
      config.command = mcp.command;
      config.args = mcp.args;
      config.env = mcp.env;
    } else {
      // HTTP/SSE transport
      config.url = mcp.url;
      config.requiresAuth = mcp.authType !== 'none';
      config.bearerToken = undefined; // Looked up from CredentialManager at runtime
    }

    return config;
  }

  /**
   * Convert LoadedSource to ApiConfig
   */
  private sourceToApiConfig(source: LoadedSource): ApiConfig {
    const api = source.config.api!;

    // Map ApiAuthType to the subset expected by ApiConfig
    // The ApiConfig auth.type doesn't include 'oauth' - it's handled differently
    let authType: 'none' | 'header' | 'bearer' | 'query' | 'basic' = 'none';
    switch (api.authType) {
      case 'bearer':
        authType = 'bearer';
        break;
      case 'header':
        authType = 'header';
        break;
      case 'query':
        authType = 'query';
        break;
      case 'basic':
        authType = 'basic';
        break;
      case 'oauth':
        // OAuth APIs use bearer tokens after auth
        authType = 'bearer';
        break;
      case 'none':
      default:
        authType = 'none';
    }

    // Resolve icon: explicit iconUrl → derive from API URL → undefined
    const logo = resolveSourceIconUrl(source.config.iconUrl, source.folderPath)
      ?? getLogoUrl(api.baseUrl)
      ?? undefined;
    return {
      name: source.config.slug,
      baseUrl: api.baseUrl,
      auth: {
        type: authType,
        headerName: api.headerName,
        queryParam: api.queryParam,
        authScheme: api.authScheme,
      },
      documentation: this.buildApiDocumentation(source),
      logo,
      // Pass through for credential lookup
      agentSlug: source.agentSlug,
      workspaceId: source.workspaceId,
    };
  }

  /**
   * Build API documentation from guide.md
   */
  private buildApiDocumentation(source: LoadedSource): string {
    if (!source.guide) return '';

    const parts: string[] = [];

    if (source.guide.scope) {
      parts.push(`## Scope\n${source.guide.scope}`);
    }
    if (source.guide.guidelines) {
      parts.push(`## Guidelines\n${source.guide.guidelines}`);
    }
    if (source.guide.apiNotes) {
      parts.push(`## API Notes\n${source.guide.apiNotes}`);
    }
    if (source.guide.cache) {
      parts.push(`## Cached Data\n\`\`\`json\n${JSON.stringify(source.guide.cache, null, 2)}\n\`\`\``);
    }

    return parts.join('\n\n');
  }

  /**
   * Create a new agent
   */
  createAgent(input: CreateAgentInput): FolderAgentConfig {
    return createAgent(this.workspaceRootPath, input);
  }

  /**
   * Update agent instructions
   */
  updateInstructions(slug: string, instructions: string): void {
    saveAgentInstructions(this.workspaceRootPath, slug, instructions);

    // Update timestamp
    const config = loadAgentConfig(this.workspaceRootPath, slug);
    if (config) {
      config.updatedAt = Date.now();
      saveAgentConfig(this.workspaceRootPath, config);
    }
  }

  /**
   * Update agent config
   */
  updateConfig(slug: string, updates: Partial<FolderAgentConfig>): void {
    const config = loadAgentConfig(this.workspaceRootPath, slug);
    if (config) {
      Object.assign(config, updates);
      config.updatedAt = Date.now();
      saveAgentConfig(this.workspaceRootPath, config);
    }
  }

  /**
   * Enable an agent
   */
  enableAgent(slug: string): void {
    this.updateConfig(slug, { enabled: true });
  }

  /**
   * Disable an agent
   */
  disableAgent(slug: string): void {
    this.updateConfig(slug, { enabled: false });
    if (this.activeAgentSlug === slug) {
      this.deactivateAgent();
    }
  }

  /**
   * Delete an agent
   */
  deleteAgent(slug: string): void {
    if (this.activeAgentSlug === slug) {
      this.deactivateAgent();
    }
    deleteAgent(this.workspaceRootPath, slug);
  }

  /**
   * Get sources for an agent
   */
  getAgentSources(slug: string): LoadedSource[] {
    const config = loadAgentConfig(this.workspaceRootPath, slug);
    if (!config) return [];
    return resolveAgentSources(this.workspaceRootPath, config);
  }

  /**
   * Add a global source reference to an agent
   */
  addSourceToAgent(agentSlug: string, sourceSlug: string): void {
    const config = loadAgentConfig(this.workspaceRootPath, agentSlug);
    if (!config) return;

    const useSources = config.useSources || [];
    if (!useSources.includes(sourceSlug)) {
      useSources.push(sourceSlug);
      config.useSources = useSources;
      config.updatedAt = Date.now();
      saveAgentConfig(this.workspaceRootPath, config);
    }
  }

  /**
   * Remove a global source reference from an agent
   */
  removeSourceFromAgent(agentSlug: string, sourceSlug: string): void {
    const config = loadAgentConfig(this.workspaceRootPath, agentSlug);
    if (!config || !config.useSources) return;

    const index = config.useSources.indexOf(sourceSlug);
    if (index > -1) {
      config.useSources.splice(index, 1);
      config.updatedAt = Date.now();
      saveAgentConfig(this.workspaceRootPath, config);
    }
  }
}

/**
 * Create a FolderAgentManager for a specific workspace
 */
export function createFolderAgentManager(workspaceRootPath: string): FolderAgentManager {
  return new FolderAgentManager(workspaceRootPath);
}
