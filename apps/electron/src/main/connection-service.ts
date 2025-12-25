/**
 * ConnectionService - Builds MCP and API server configs from connections
 *
 * Similar to SubAgentManager but for user-defined connections.
 * Handles credential lookup and server config building.
 */

import { createApiServer } from '@craft-agent/shared/agents/api-tools'
import { createGmailServer } from '@craft-agent/shared/agents/gmail-tools'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { refreshGmailToken } from '@craft-agent/shared/auth'
import type { ApiConfig } from '@craft-agent/shared/agents/types'
import type { ConnectionConfig } from '../shared/types'

// Buffer time before expiration to refresh (5 minutes)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

// Type for MCP server config (matches SDK expectations)
export type McpServerConfig = {
  type: 'http' | 'sse'
  url: string
  headers?: Record<string, string>
}

// Type for API server (in-process MCP server)
export type ApiServer = ReturnType<typeof createApiServer>

// Type for Gmail server (in-process MCP server)
export type GmailServer = ReturnType<typeof createGmailServer>

export class ConnectionService {
  /**
   * Build MCP server config from connection (with auth headers)
   * Automatically refreshes expired tokens using the stored refresh token
   * Returns null if token is expired and cannot be refreshed
   */
  async buildMcpServerConfig(connection: ConnectionConfig): Promise<McpServerConfig | null> {
    if (connection.type !== 'mcp') {
      throw new Error(`Not an MCP connection: ${connection.name}`)
    }

    if (!connection.mcpUrl) {
      throw new Error(`MCP connection ${connection.name} missing URL`)
    }

    const config: McpServerConfig = {
      type: connection.mcpUrl.includes('/sse') ? 'sse' : 'http',
      url: connection.mcpUrl,
    }

    // Retrieve OAuth token from CredentialManager
    if (connection.isAuthenticated) {
      try {
        const manager = getCredentialManager()
        const credentialId = { type: 'connection_oauth' as const, connectionId: connection.id }
        const creds = await manager.get(credentialId)

        if (!creds?.value) {
          console.warn(`[ConnectionService] No stored token for MCP connection: ${connection.name}`)
          return null
        }

        let accessToken = creds.value
        const now = Date.now()

        // Determine token state
        const isActuallyExpired = creds.expiresAt && creds.expiresAt < now
        const isWithinRefreshBuffer = creds.expiresAt && creds.expiresAt < now + TOKEN_REFRESH_BUFFER_MS
        // For legacy credentials without expiresAt, try refresh if we have refresh token and clientId
        const shouldAttemptRefresh = creds.refreshToken && creds.clientId &&
          (isWithinRefreshBuffer || !creds.expiresAt)

        if (shouldAttemptRefresh) {
          console.log(`[ConnectionService] Refreshing MCP token for: ${connection.name}`)
          try {
            const { CraftOAuth, getMcpBaseUrl } = await import('@craft-agent/shared/auth/oauth')
            const oauth = new CraftOAuth(
              { mcpBaseUrl: getMcpBaseUrl(connection.mcpUrl) },
              { onStatus: () => {}, onError: () => {} }
            )
            const refreshResult = await oauth.refreshAccessToken(creds.refreshToken!, creds.clientId!)
            accessToken = refreshResult.accessToken
            console.log(`[ConnectionService] MCP token refreshed successfully for: ${connection.name}`)

            // Try to persist the new token, but don't fail if storage fails
            try {
              await manager.set(credentialId, {
                value: refreshResult.accessToken,
                refreshToken: refreshResult.refreshToken || creds.refreshToken,
                expiresAt: refreshResult.expiresAt,
                clientId: creds.clientId,
              })
            } catch (storageError) {
              // Log but continue - we still have a valid refreshed token in memory
              console.warn(`[ConnectionService] Failed to persist refreshed MCP token for ${connection.name}:`, storageError)
            }
          } catch (refreshError) {
            console.error(`[ConnectionService] Failed to refresh MCP token for ${connection.name}:`, refreshError)
            // Only fail if token is actually expired (not just within buffer)
            if (isActuallyExpired) {
              console.warn(`[ConnectionService] Cannot use expired MCP token, refresh failed: ${connection.name}`)
              return null
            }
            // Token still valid (just within buffer), continue with existing token
            console.log(`[ConnectionService] Using existing MCP token (still valid) for: ${connection.name}`)
          }
        } else if (isActuallyExpired && (!creds.refreshToken || !creds.clientId)) {
          // Token is actually expired and we can't refresh (missing refresh token or clientId)
          const reason = !creds.refreshToken ? 'no refresh token' : 'no clientId'
          console.warn(`[ConnectionService] MCP token expired and cannot refresh (${reason}): ${connection.name}`)
          return null
        } else if (isActuallyExpired) {
          // Token is expired but we have refresh credentials - this shouldn't happen
          // (shouldAttemptRefresh should have been true), but guard against it
          console.warn(`[ConnectionService] MCP token expired, refresh not attempted: ${connection.name}`)
          return null
        }

        config.headers = {
          Authorization: `Bearer ${accessToken}`,
        }
        console.log(`[ConnectionService] Added auth header for MCP connection: ${connection.name}`)
      } catch (error) {
        console.error(`[ConnectionService] Failed to get credentials for ${connection.name}:`, error)
        return null
      }
    }

    return config
  }

  /**
   * Build API server from connection
   */
  buildApiServer(connection: ConnectionConfig): ApiServer {
    if (connection.type !== 'api') {
      throw new Error(`Not an API connection: ${connection.name}`)
    }

    if (!connection.apiUrl) {
      throw new Error(`API connection ${connection.name} missing URL`)
    }

    const apiConfig: ApiConfig = {
      name: connection.name,
      baseUrl: connection.apiUrl,
      auth: { type: 'bearer' },
      documentation: '', // User can add documentation later
    }

    // Use the stored bearer token
    const credential = connection.apiBearerToken || ''

    return createApiServer(apiConfig, credential)
  }

  /**
   * Build Gmail server from connection
   * Returns a server with a token getter that refreshes expired tokens per-request
   */
  async buildGmailServer(connection: ConnectionConfig): Promise<GmailServer | null> {
    if (connection.type !== 'gmail') {
      throw new Error(`Not a Gmail connection: ${connection.name}`)
    }

    // Verify we have credentials before creating the server
    const manager = getCredentialManager()
    const credentialId = { type: 'gmail_oauth' as const, connectionId: connection.id }
    const initialCreds = await manager.get(credentialId)

    if (!initialCreds?.value) {
      console.warn(`[ConnectionService] No stored token for Gmail connection: ${connection.name}`)
      return null
    }

    // In-memory cache for refreshed tokens (prevents repeated refresh if persistence fails)
    let cachedToken: { accessToken: string; expiresAt: number } | null = null

    // Create a token getter that refreshes on each request if needed
    const getToken = async (): Promise<string> => {
      const now = Date.now()

      // Check in-memory cache first (handles case where persistence failed)
      if (cachedToken && cachedToken.expiresAt > now + TOKEN_REFRESH_BUFFER_MS) {
        return cachedToken.accessToken
      }

      const creds = await manager.get(credentialId)

      if (!creds?.value) {
        throw new Error(`No stored token for Gmail connection: ${connection.name}`)
      }

      // Determine token state
      const isActuallyExpired = creds.expiresAt && creds.expiresAt < now
      const isWithinRefreshBuffer = creds.expiresAt && creds.expiresAt < now + TOKEN_REFRESH_BUFFER_MS
      // For legacy credentials without expiresAt, try refresh if we have a refresh token
      const shouldAttemptRefresh = creds.refreshToken && (isWithinRefreshBuffer || !creds.expiresAt)

      if (shouldAttemptRefresh) {
        console.log(`[ConnectionService] Refreshing Gmail token for: ${connection.name}`)
        try {
          const refreshResult = await refreshGmailToken(creds.refreshToken!)
          console.log(`[ConnectionService] Gmail token refreshed successfully for: ${connection.name}`)

          // Cache in memory to prevent repeated refresh calls
          // Default to 1 hour expiry if Google doesn't return expires_in
          cachedToken = {
            accessToken: refreshResult.accessToken,
            expiresAt: refreshResult.expiresAt ?? (Date.now() + 3600 * 1000),
          }

          // Try to persist the new token, but don't fail if storage fails
          try {
            await manager.set(credentialId, {
              value: refreshResult.accessToken,
              refreshToken: creds.refreshToken,
              expiresAt: refreshResult.expiresAt,
            })
          } catch (storageError) {
            // Log but continue - we have the token cached in memory
            console.warn(`[ConnectionService] Failed to persist refreshed token for ${connection.name}:`, storageError)
          }

          return refreshResult.accessToken
        } catch (refreshError) {
          console.error(`[ConnectionService] Failed to refresh Gmail token for ${connection.name}:`, refreshError)
          // Only fail if token is actually expired (not just within buffer)
          if (isActuallyExpired) {
            throw new Error(`Gmail token expired and refresh failed: ${connection.name}`)
          }
          // Token still valid (just within buffer), continue with existing token
          console.log(`[ConnectionService] Using existing token (still valid) for: ${connection.name}`)
          return creds.value
        }
      } else if (isActuallyExpired && !creds.refreshToken) {
        // Token is actually expired and we have no way to refresh
        throw new Error(`Gmail token expired and no refresh token available: ${connection.name}`)
      }

      return creds.value
    }

    console.log(`[ConnectionService] Creating Gmail server for connection: ${connection.name}`)
    return createGmailServer(getToken)
  }

  /**
   * Build all server configs for selected connections
   */
  async buildServerConfigs(connections: ConnectionConfig[]): Promise<{
    mcpServers: Record<string, McpServerConfig>
    apiServers: Record<string, ApiServer | GmailServer>
  }> {
    const mcpServers: Record<string, McpServerConfig> = {}
    const apiServers: Record<string, ApiServer | GmailServer> = {}

    for (const conn of connections) {
      if (!conn.enabled) continue

      try {
        if (conn.type === 'mcp') {
          const mcpConfig = await this.buildMcpServerConfig(conn)
          if (mcpConfig) {
            mcpServers[conn.name] = mcpConfig
          } else {
            // Connection is enabled in UI but couldn't be configured (expired/missing creds)
            console.warn(`[ConnectionService] Skipping MCP connection '${conn.name}' - credentials unavailable or expired (needs re-auth)`)
          }
        } else if (conn.type === 'api') {
          apiServers[`api_${conn.name}`] = this.buildApiServer(conn)
        } else if (conn.type === 'gmail') {
          const gmailServer = await this.buildGmailServer(conn)
          if (gmailServer) {
            apiServers[`gmail_${conn.id}`] = gmailServer
          } else {
            // Connection is enabled in UI but couldn't be configured (expired/missing creds)
            console.warn(`[ConnectionService] Skipping Gmail connection '${conn.name}' - credentials unavailable or expired (needs re-auth)`)
          }
        }
      } catch (error) {
        console.error(`[ConnectionService] Failed to build config for ${conn.name}:`, error)
        // Skip this connection but continue with others
      }
    }

    return { mcpServers, apiServers }
  }
}

// Singleton instance
let connectionServiceInstance: ConnectionService | null = null

export function getConnectionService(): ConnectionService {
  if (!connectionServiceInstance) {
    connectionServiceInstance = new ConnectionService()
  }
  return connectionServiceInstance
}
