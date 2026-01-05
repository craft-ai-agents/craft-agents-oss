/**
 * Agent discovery service for Electron app
 * Uses FolderAgentManager from core to discover and manage agents
 */

import { getWorkspaceByNameOrId, loadStoredConfig, type Workspace } from '@craft-agent/shared/config'
import { agentLog } from './logger'
import { DEFAULT_MODEL } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { CraftMcpClient } from '@craft-agent/shared/mcp'
import { FolderAgentManager, type LoadedAgent, ensureBuiltinAgent as ensureBuiltin } from '@craft-agent/shared/agents'
import type { SubAgentMetadata, SubAgentDefinition, McpServerConfig, ApiConfig } from '@craft-agent/shared/agents'
import { CraftOAuth, getMcpBaseUrl } from '@craft-agent/shared/auth'
import { validateMcpConnection } from '@craft-agent/shared/mcp'
import type { AgentAuthRequirements, AgentSetupStatus, AgentAuthStatus, OAuthResult, McpValidationResult } from '../shared/types'

export class AgentService {
  private agentManagers: Map<string, FolderAgentManager> = new Map()

  /**
   * Get or create an agent manager for a workspace
   */
  private getAgentManager(workspaceRootPath: string): FolderAgentManager {
    let manager = this.agentManagers.get(workspaceRootPath)
    if (!manager) {
      manager = new FolderAgentManager(workspaceRootPath)
      this.agentManagers.set(workspaceRootPath, manager)
    }
    return manager
  }

  /**
   * Get workspace root path from workspace ID
   */
  private getWorkspaceRootPath(workspaceId: string): string {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`)
    }
    return workspace.rootPath
  }

  /**
   * Get available agents
   * Returns all enabled agents from the agent folder
   * Note: slug is the unique identifier (no separate id field)
   */
  async getAgents(workspaceId: string): Promise<SubAgentMetadata[]> {
    try {
      const workspaceRootPath = this.getWorkspaceRootPath(workspaceId)
      const agentManager = this.getAgentManager(workspaceRootPath)
      const agents = agentManager.getAvailableAgents()
      return agents.map((agent: LoadedAgent) => ({
        id: agent.config.slug, // slug IS the id
        name: agent.config.name,
        documentId: agent.config.slug,
        workspaceId: workspaceId,
        createdAt: agent.config.createdAt,
      }))
    } catch (error) {
      agentLog.error('Error discovering agents:', error)
      return []
    }
  }

  /**
   * Force refresh agent discovery
   */
  async refreshAgents(workspaceId: string): Promise<SubAgentMetadata[]> {
    try {
      const workspaceRootPath = this.getWorkspaceRootPath(workspaceId)
      const agentManager = this.getAgentManager(workspaceRootPath)
      agentManager.reload()
      return this.getAgents(workspaceId)
    } catch (error) {
      agentLog.error('Error refreshing agents:', error)
      return []
    }
  }

  /**
   * Clear cached manager for a workspace
   */
  clearCache(workspaceId: string): void {
    try {
      const workspaceRootPath = this.getWorkspaceRootPath(workspaceId)
      this.agentManagers.delete(workspaceRootPath)
    } catch {
      // Ignore if workspace not found
    }
  }

  /**
   * Clear all cached managers
   */
  clearAllCaches(): void {
    this.agentManagers.clear()
  }

  /**
   * Ensure a builtin agent exists in the workspace
   * Creates the agent if it doesn't exist, returns the agent slug
   * Note: Returns slug (not ID) because agent activation uses slugs
   */
  async ensureBuiltinAgent(workspaceId: string, slug: string): Promise<string | null> {
    try {
      const workspaceRootPath = this.getWorkspaceRootPath(workspaceId)
      const config = ensureBuiltin(workspaceRootPath, slug)
      if (config) {
        // Reload the agent manager to pick up the new agent
        const agentManager = this.getAgentManager(workspaceRootPath)
        agentManager.reload()
        // Return slug, not ID - agent activation uses slugs for folder lookups
        return config.slug
      }
      return null
    } catch (error) {
      agentLog.error('Error ensuring builtin agent:', error)
      return null
    }
  }

  /**
   * Check if an agent needs authentication
   * Note: agentSlug is the unique identifier (slug IS the id)
   */
  async checkAgentAuthStatus(workspaceId: string, agentSlug: string): Promise<{
    needsAuth: boolean
    reason?: string
  }> {
    try {
      const workspaceRootPath = this.getWorkspaceRootPath(workspaceId)
      const agentManager = this.getAgentManager(workspaceRootPath)
      const definition = agentManager.getAgentDefinition(agentSlug)

      if (!definition) {
        return { needsAuth: false }
      }

      // Check MCP servers needing auth
      const mcpNeedingAuth = (definition.mcpServers || []).filter((s: McpServerConfig) => s.requiresAuth)
      // Check APIs needing auth
      const apisNeedingAuth = (definition.apis || []).filter((a: ApiConfig) => a.auth && a.auth.type !== 'none')

      if (mcpNeedingAuth.length > 0 || apisNeedingAuth.length > 0) {
        const services = [
          ...mcpNeedingAuth.map((s: McpServerConfig) => s.name || 'MCP Server'),
          ...apisNeedingAuth.map((a: ApiConfig) => a.name || 'API')
        ]
        return {
          needsAuth: true,
          reason: `Requires authentication: ${services.join(', ')}`
        }
      }

      return { needsAuth: false }
    } catch (error) {
      agentLog.error('Error checking auth status:', error)
      return { needsAuth: false }
    }
  }

  /**
   * Get setup status for an agent
   * For folder-based agents, needsSetup is always false (they're ready immediately)
   * Only needsAuth matters if sources require authentication
   * Note: agentSlug is the unique identifier (slug IS the id)
   */
  async getAgentSetupStatus(workspaceId: string, agentSlug: string): Promise<AgentSetupStatus> {
    try {
      const workspaceRootPath = this.getWorkspaceRootPath(workspaceId)
      const agentManager = this.getAgentManager(workspaceRootPath)
      const definition = agentManager.getAgentDefinition(agentSlug)

      if (!definition) {
        // Agent not found or no definition - still return ready state
        return { needsSetup: false, needsAuth: false }
      }

      // Check if sources need authentication
      const mcpNeedingAuth = (definition.mcpServers || []).filter((s: McpServerConfig) => s.requiresAuth)
      const apisNeedingAuth = (definition.apis || []).filter((a: ApiConfig) => a.auth && a.auth.type !== 'none')

      if (mcpNeedingAuth.length > 0 || apisNeedingAuth.length > 0) {
        const services = [
          ...mcpNeedingAuth.map((s: McpServerConfig) => s.name || 'MCP Server'),
          ...apisNeedingAuth.map((a: ApiConfig) => a.name || 'API')
        ]
        return {
          needsSetup: false,
          needsAuth: true,
          reason: `Requires authentication: ${services.join(', ')}`
        }
      }

      // Folder agent is ready - no setup needed
      return { needsSetup: false, needsAuth: false }
    } catch (error) {
      agentLog.error('Error getting setup status:', error)
      return { needsSetup: false, needsAuth: false }
    }
  }

  /**
   * Get auth status for all MCP servers and APIs in an agent
   * Note: agentSlug is the unique identifier (slug IS the id)
   */
  async getAgentAuthStatus(workspaceId: string, agentSlug: string): Promise<AgentAuthStatus> {
    try {
      const workspaceRootPath = this.getWorkspaceRootPath(workspaceId)
      const agentManager = this.getAgentManager(workspaceRootPath)
      const definition = agentManager.getAgentDefinition(agentSlug)

      if (!definition) {
        return { mcpServers: [], apis: [] }
      }

      // For now, return servers/apis with their auth status based on requiresAuth
      const mcpServers = (definition.mcpServers || []).map((s: McpServerConfig) => ({
        name: s.name,
        url: s.url,
        hasAuth: !s.requiresAuth, // If it doesn't require auth, we consider it authed
      }))

      const apis = (definition.apis || []).map((a: ApiConfig) => ({
        name: a.name,
        baseUrl: a.baseUrl,
        auth: a.auth,
        hasAuth: !a.auth || a.auth.type === 'none', // If no auth or type is none, we consider it authed
      }))

      return { mcpServers, apis }
    } catch (error) {
      agentLog.error('Error getting auth status:', error)
      return { mcpServers: [], apis: [] }
    }
  }

  /**
   * Get full agent definition for Info display
   * Note: agentSlug is the unique identifier (slug IS the id)
   */
  async getAgentDefinition(workspaceId: string, agentSlug: string): Promise<SubAgentDefinition | null> {
    try {
      const workspaceRootPath = this.getWorkspaceRootPath(workspaceId)
      const agentManager = this.getAgentManager(workspaceRootPath)
      return agentManager.getAgentDefinition(agentSlug)
    } catch (error) {
      agentLog.error('Error getting agent definition:', error)
      return null
    }
  }

  /**
   * Reload agent: re-read from disk
   * Note: agentSlug is the unique identifier (slug IS the id)
   */
  async reloadAgent(workspaceId: string, agentSlug: string): Promise<boolean> {
    try {
      const workspaceRootPath = this.getWorkspaceRootPath(workspaceId)
      const agentManager = this.getAgentManager(workspaceRootPath)
      agentManager.reload()
      const definition = agentManager.getAgentDefinition(agentSlug)
      return definition !== null
    } catch (error) {
      agentLog.error('Error reloading agent:', error)
      return false
    }
  }

  /**
   * Get detailed auth requirements for an agent
   * Note: agentSlug is the unique identifier (slug IS the id)
   */
  async getAuthRequirements(workspaceId: string, agentSlug: string): Promise<AgentAuthRequirements> {
    try {
      const workspaceRootPath = this.getWorkspaceRootPath(workspaceId)
      const agentManager = this.getAgentManager(workspaceRootPath)
      const definition = agentManager.getAgentDefinition(agentSlug)

      if (!definition) {
        return { mcpServers: [], apis: [] }
      }

      const mcpServers = (definition.mcpServers || []).filter((s: McpServerConfig) => s.requiresAuth)
      const apis = (definition.apis || []).filter((a: ApiConfig) => a.auth && a.auth.type !== 'none')

      return {
        mcpServers: mcpServers.map((s: McpServerConfig) => ({ name: s.name, url: s.url, requiresAuth: s.requiresAuth })),
        apis: apis.map((a: ApiConfig) => ({ name: a.name, auth: a.auth }))
      }
    } catch (error) {
      agentLog.error('Error getting auth requirements:', error)
      return { mcpServers: [], apis: [] }
    }
  }

  /**
   * Start OAuth flow for an MCP server
   */
  async startMcpOAuth(_workspaceId: string, _agentId: string, serverUrl: string, serverName: string): Promise<OAuthResult> {
    try {
      const mcpBaseUrl = getMcpBaseUrl(serverUrl)
      const oauth = new CraftOAuth(
        { mcpBaseUrl },
        {
          onStatus: (msg) => agentLog.info('OAuth:', msg),
          onError: (err) => agentLog.error('OAuth error:', err),
        }
      )

      const { tokens, clientId } = await oauth.authenticate()

      // TODO: Save credentials to source-based credential store
      agentLog.info(`OAuth successful for ${serverName}`)
      return { success: true }
    } catch (error) {
      agentLog.error('OAuth failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth failed'
      }
    }
  }

  /**
   * Save bearer token for an MCP server
   */
  async saveMcpBearer(_workspaceId: string, _agentId: string, serverName: string, token: string): Promise<void> {
    // TODO: Save to source-based credential store
    agentLog.info(`Saved bearer token for ${serverName}`)
  }

  /**
   * Save API credentials
   */
  async saveApiCredentials(_workspaceId: string, _agentId: string, apiName: string, credential: string): Promise<void> {
    // TODO: Save to source-based credential store
    agentLog.info(`Saved credentials for API ${apiName}`)
  }

  /**
   * Validate MCP connection with optional access token
   */
  async validateMcpConnectionStatus(serverUrl: string, accessToken?: string): Promise<McpValidationResult> {
    try {
      const credManager = getCredentialManager()
      await credManager.initialize()

      const result = await validateMcpConnection({
        mcpUrl: serverUrl,
        mcpAccessToken: accessToken,
        claudeApiKey: await credManager.getApiKey() || undefined,
        claudeOAuthToken: await credManager.getClaudeOAuth() || undefined,
      })

      return {
        success: result.success,
        error: result.error,
        tools: result.tools,
      }
    } catch (error) {
      agentLog.error('Validation error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Validation failed'
      }
    }
  }

}

// Singleton instance
export const agentService = new AgentService()
