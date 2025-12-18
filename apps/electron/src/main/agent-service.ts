/**
 * Agent discovery service for Electron app
 * Uses SubAgentManager from core to discover and manage agents
 */

import { getWorkspaceByNameOrId, loadStoredConfig, type Workspace } from '@craft-agent/shared/config'
import { DEFAULT_MODEL } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { CraftMcpClient } from '@craft-agent/shared/mcp'
import { SubAgentManager, type SubAgentManagerConfig } from '@craft-agent/shared/agents'
import type { SubAgentMetadata, SubAgentDefinition } from '@craft-agent/shared/agents'
import { clearDefinition, clearAgentCredentialsAsync, saveServerCredentialsAsync, saveApiKeyCredentialAsync } from '@craft-agent/shared/agents'
import { CraftOAuth, getMcpBaseUrl } from '@craft-agent/shared/auth'
import { validateMcpConnection } from '@craft-agent/shared/mcp'
import type { AgentAuthRequirements, AgentSetupStatus, AgentAuthStatus, OAuthResult, McpValidationResult } from '../shared/types'

/**
 * Cached agent manager per workspace
 */
interface CachedAgentManager {
  manager: SubAgentManager
  lastAccess: number
}

export class AgentService {
  private managerCache: Map<string, CachedAgentManager> = new Map()

  /**
   * Get or create a SubAgentManager for a workspace
   */
  private async getManager(workspaceId: string): Promise<SubAgentManager> {
    // Check cache
    const cached = this.managerCache.get(workspaceId)
    if (cached) {
      cached.lastAccess = Date.now()
      return cached.manager
    }

    // Get workspace
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    // Get access token for MCP based on auth type
    const credManager = getCredentialManager()
    await credManager.initialize()

    let token: string | undefined
    const mcpAuthType = workspace.mcpAuthType || 'workspace_oauth'

    if (mcpAuthType === 'workspace_oauth') {
      const oauth = await credManager.getWorkspaceOAuth(workspaceId)
      token = oauth?.accessToken
    } else if (mcpAuthType === 'workspace_bearer') {
      token = await credManager.getWorkspaceBearer(workspaceId) || undefined
    }
    // 'public' type doesn't need a token

    // Create MCP client with appropriate headers
    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    const mcpClient = new CraftMcpClient({
      url: workspace.mcpUrl,
      headers: Object.keys(headers).length > 0 ? headers : undefined
    })
    await mcpClient.connect()

    // Create manager config
    const config = loadStoredConfig()
    const managerConfig: SubAgentManagerConfig = {
      model: config?.model || DEFAULT_MODEL,
      mcpUrl: workspace.mcpUrl,
      mcpToken: token,
    }

    // Create and cache manager
    const manager = new SubAgentManager(workspaceId, mcpClient, managerConfig)
    this.managerCache.set(workspaceId, {
      manager,
      lastAccess: Date.now()
    })

    return manager
  }

  /**
   * Discover agents for a workspace
   * Returns cached list if available, otherwise discovers fresh
   */
  async getAgents(workspaceId: string): Promise<SubAgentMetadata[]> {
    try {
      const manager = await this.getManager(workspaceId)
      return await manager.getAvailableAgents()
    } catch (error) {
      console.error('[AgentService] Error discovering agents:', error)
      return []
    }
  }

  /**
   * Force refresh agent discovery for a workspace
   */
  async refreshAgents(workspaceId: string): Promise<SubAgentMetadata[]> {
    try {
      const manager = await this.getManager(workspaceId)
      return await manager.refreshAgents()
    } catch (error) {
      console.error('[AgentService] Error refreshing agents:', error)
      return []
    }
  }

  /**
   * Clear cached manager for a workspace (e.g., on workspace switch)
   */
  clearCache(workspaceId: string): void {
    this.managerCache.delete(workspaceId)
  }

  /**
   * Clear all cached managers
   */
  clearAllCaches(): void {
    this.managerCache.clear()
  }

  /**
   * Check if an agent needs authentication (MCP servers or APIs without credentials)
   * Returns { needsAuth: boolean, reason?: string }
   */
  async checkAgentAuthStatus(workspaceId: string, agentId: string): Promise<{
    needsAuth: boolean
    reason?: string
  }> {
    try {
      const manager = await this.getManager(workspaceId)
      const definition = await manager.getDefinition(agentId)

      if (!definition) {
        return { needsAuth: false }
      }

      // Check MCP servers needing auth
      const mcpNeedingAuth = await manager.getMcpServersNeedingAuth(definition)
      // Check APIs needing auth
      const apisNeedingAuth = await manager.getApisNeedingAuth(definition)

      if (mcpNeedingAuth.length > 0 || apisNeedingAuth.length > 0) {
        const services = [
          ...mcpNeedingAuth.map(s => s.name || 'MCP Server'),
          ...apisNeedingAuth.map(a => a.name || 'API')
        ]
        return {
          needsAuth: true,
          reason: `Requires authentication: ${services.join(', ')}`
        }
      }

      return { needsAuth: false }
    } catch (error) {
      console.error('[AgentService] Error checking auth status:', error)
      return { needsAuth: false }
    }
  }

  /**
   * Get detailed setup status for an agent
   * Distinguishes between "needs setup" (no definition extracted) and "needs auth" (definition exists but missing credentials)
   */
  async getAgentSetupStatus(workspaceId: string, agentId: string): Promise<AgentSetupStatus> {
    try {
      const manager = await this.getManager(workspaceId)

      // Check if definition exists in cache (needsSetup = no cached definition)
      const needsSetup = manager.needsFreshExtraction(agentId)

      if (needsSetup) {
        return {
          needsSetup: true,
          needsAuth: false,
          reason: 'Agent needs initial setup'
        }
      }

      // Definition exists, check if auth is needed
      const definition = await manager.getDefinition(agentId)
      if (!definition) {
        // Failed to load definition
        return {
          needsSetup: true,
          needsAuth: false,
          reason: 'Failed to load agent definition'
        }
      }

      // Check MCP servers and APIs needing auth (pass agentId since agent isn't activated)
      const mcpNeedingAuth = await manager.getMcpServersNeedingAuth(definition, agentId)
      const apisNeedingAuth = await manager.getApisNeedingAuth(definition, agentId)

      if (mcpNeedingAuth.length > 0 || apisNeedingAuth.length > 0) {
        const services = [
          ...mcpNeedingAuth.map(s => s.name || 'MCP Server'),
          ...apisNeedingAuth.map(a => a.name || 'API')
        ]
        return {
          needsSetup: false,
          needsAuth: true,
          reason: `Requires authentication: ${services.join(', ')}`
        }
      }

      return { needsSetup: false, needsAuth: false }
    } catch (error) {
      console.error('[AgentService] Error getting setup status:', error)
      return { needsSetup: false, needsAuth: false }
    }
  }

  /**
   * Get auth status for all MCP servers and APIs in an agent
   * Used by Info dialog to show which have auth configured
   */
  async getAgentAuthStatus(workspaceId: string, agentId: string): Promise<AgentAuthStatus> {
    try {
      const manager = await this.getManager(workspaceId)
      const definition = await manager.getDefinition(agentId)

      if (!definition) {
        return { mcpServers: [], apis: [] }
      }

      const mcpServers = await manager.getMcpServersWithAuthStatus(definition, agentId)
      const apis = await manager.getApisWithAuthStatus(definition, agentId)

      return {
        mcpServers: mcpServers.map(s => ({
          name: s.name,
          url: s.url,
          requiresAuth: s.requiresAuth,
          hasAuth: s.hasAuth,
          tools: s.tools,
        })),
        apis: apis.map(a => ({
          name: a.name,
          baseUrl: a.baseUrl,
          auth: a.auth,
          hasAuth: a.hasAuth,
        })),
      }
    } catch (error) {
      console.error('[AgentService] Error getting auth status:', error)
      return { mcpServers: [], apis: [] }
    }
  }

  /**
   * Get full agent definition for Info display
   * Returns cached definition if available, otherwise extracts fresh
   */
  async getAgentDefinition(workspaceId: string, agentId: string): Promise<SubAgentDefinition | null> {
    try {
      const manager = await this.getManager(workspaceId)
      return await manager.getDefinition(agentId)
    } catch (error) {
      console.error('[AgentService] Error getting agent definition:', error)
      return null
    }
  }

  /**
   * Reload agent: clear definition cache, re-extract from Craft
   * Does not clear credentials
   */
  async reloadAgent(workspaceId: string, agentId: string): Promise<boolean> {
    try {
      // Clear definition cache
      clearDefinition(workspaceId, agentId)
      console.log(`[AgentService] Cleared definition cache for agent ${agentId}`)

      // Force re-extraction by requesting definition
      const manager = await this.getManager(workspaceId)
      const definition = await manager.getDefinition(agentId)
      return definition !== null
    } catch (error) {
      console.error('[AgentService] Error reloading agent:', error)
      return false
    }
  }

  /**
   * Reset agent: clear ALL cached data (definition + credentials)
   * User will need to re-authenticate on next activation
   */
  async resetAgent(workspaceId: string, agentId: string): Promise<boolean> {
    try {
      // Clear definition cache
      clearDefinition(workspaceId, agentId)
      console.log(`[AgentService] Cleared definition cache for agent ${agentId}`)

      // Clear all credentials for this agent
      await clearAgentCredentialsAsync(workspaceId, agentId)
      console.log(`[AgentService] Cleared credentials for agent ${agentId}`)

      return true
    } catch (error) {
      console.error('[AgentService] Error resetting agent:', error)
      return false
    }
  }

  /**
   * Get detailed auth requirements for an agent
   * Returns list of MCP servers and APIs that need credentials
   */
  async getAuthRequirements(workspaceId: string, agentId: string): Promise<AgentAuthRequirements> {
    try {
      const manager = await this.getManager(workspaceId)
      const definition = await manager.getDefinition(agentId)

      if (!definition) {
        return { mcpServers: [], apis: [] }
      }

      // Pass agentId since agent isn't activated yet
      const mcpServers = await manager.getMcpServersNeedingAuth(definition, agentId)
      const apis = await manager.getApisNeedingAuth(definition, agentId)

      return {
        mcpServers: mcpServers.map(s => ({ name: s.name, url: s.url, requiresAuth: s.requiresAuth })),
        apis: apis.map(a => ({ name: a.name, auth: a.auth }))
      }
    } catch (error) {
      console.error('[AgentService] Error getting auth requirements:', error)
      return { mcpServers: [], apis: [] }
    }
  }

  /**
   * Start OAuth flow for an MCP server
   * Opens browser and waits for OAuth callback
   */
  async startMcpOAuth(workspaceId: string, agentId: string, serverUrl: string, serverName: string): Promise<OAuthResult> {
    try {
      const mcpBaseUrl = getMcpBaseUrl(serverUrl)
      const oauth = new CraftOAuth(
        { mcpBaseUrl },
        {
          onStatus: (msg) => console.log('[AgentService] OAuth:', msg),
          onError: (err) => console.error('[AgentService] OAuth error:', err),
        }
      )

      const { tokens, clientId } = await oauth.authenticate()

      // Save credentials
      await saveServerCredentialsAsync(workspaceId, agentId, serverName, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        clientId,
      })

      console.log(`[AgentService] OAuth successful for ${serverName}`)
      return { success: true }
    } catch (error) {
      console.error('[AgentService] OAuth failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth failed'
      }
    }
  }

  /**
   * Save bearer token for an MCP server (fallback when OAuth fails)
   */
  async saveMcpBearer(workspaceId: string, agentId: string, serverName: string, token: string): Promise<void> {
    await saveServerCredentialsAsync(workspaceId, agentId, serverName, {
      accessToken: token,
    })
    console.log(`[AgentService] Saved bearer token for ${serverName}`)
  }

  /**
   * Save API credentials (API key or basic auth JSON)
   */
  async saveApiCredentials(workspaceId: string, agentId: string, apiName: string, credential: string): Promise<void> {
    await saveApiKeyCredentialAsync(workspaceId, agentId, apiName, credential)
    console.log(`[AgentService] Saved credentials for API ${apiName}`)
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
      console.error('[AgentService] Validation error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Validation failed'
      }
    }
  }
}

// Singleton instance
export const agentService = new AgentService()
