/**
 * Slack IPC Handlers
 *
 * Registers IPC handlers for Slack OAuth integration, enabling renderer
 * to communicate with Slack OAuth flows in the main process.
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import { getCredentialManager, type CredentialId } from '@craft-agent/shared/credentials'
import { startSlackOAuth, isSlackOAuthConfigured } from '@craft-agent/shared/auth/slack-oauth'

interface SlackConnection {
  isConnected: boolean
  isConnecting: boolean
  teamName?: string
  teamId?: string
  userId?: string
  connectedAt?: number
}

interface SlackWorkspaceInfo {
  teamId: string
  teamName: string
  userId: string
  connectedAt: number
}

/**
 * Register Slack IPC handlers
 */
export function registerSlackHandlers(): void {
  const credentialManager = getCredentialManager()

  /**
   * Start Slack OAuth flow
   * Opens browser for OAuth authorization and stores credentials
   */
  ipcMain.handle(
    IPC_CHANNELS.SLACK_START_OAUTH,
    async (_event, workspaceId: string) => {
      try {
        // Start OAuth flow
        const result = await startSlackOAuth({
          service: 'full', // Full access (channels, messages, files, etc.)
          appType: 'electron',
        })

        if (!result.success || !result.accessToken) {
          return {
            success: false,
            error: result.error || 'OAuth failed',
          }
        }

        // Store credentials with proper CredentialId format
        const credentialId: CredentialId = {
          type: 'slack_oauth',
          workspaceId,
          sourceId: 'slack', // Use 'slack' as sourceId for workspace-level Slack auth
        }

        await credentialManager.set(credentialId, {
          value: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt,
          // Store Slack-specific metadata
          metadata: {
            teamId: result.teamId,
            teamName: result.teamName,
            userId: result.userId,
            connectedAt: Date.now(),
          },
        })

        // Return connection status
        const connection: SlackConnection = {
          isConnected: true,
          isConnecting: false,
          teamName: result.teamName,
          teamId: result.teamId,
          userId: result.userId,
          connectedAt: Date.now(),
        }

        const workspaces: SlackWorkspaceInfo[] = result.teamId && result.teamName && result.userId
          ? [{
              teamId: result.teamId,
              teamName: result.teamName,
              userId: result.userId,
              connectedAt: Date.now(),
            }]
          : []

        return {
          success: true,
          connection,
          workspaces,
        }
      } catch (error) {
        console.error('[Slack IPC] OAuth error:', error)
        return {
          success: false,
          error: (error as Error).message,
        }
      }
    }
  )

  /**
   * Get Slack connection status
   * Returns current connection state and stored credentials
   */
  ipcMain.handle(
    IPC_CHANNELS.SLACK_GET_STATUS,
    async (_event, workspaceId: string) => {
      try {
        const credentialId: CredentialId = {
          type: 'slack_oauth',
          workspaceId,
          sourceId: 'slack',
        }

        const credentials = await credentialManager.get(credentialId)

        if (!credentials) {
          return {
            success: true,
            connection: {
              isConnected: false,
              isConnecting: false,
            },
            workspaces: [],
          }
        }

        // Check if credentials are valid (not expired)
        const isExpired = credentials.expiresAt && credentials.expiresAt < Date.now()

        // Extract metadata
        const metadata = credentials.metadata || {}
        const teamName = metadata.teamName as string | undefined
        const teamId = metadata.teamId as string | undefined
        const userId = metadata.userId as string | undefined
        const connectedAt = metadata.connectedAt as number | undefined

        const connection: SlackConnection = {
          isConnected: !isExpired,
          isConnecting: false,
          teamName,
          teamId,
          userId,
          connectedAt,
        }

        const workspaces: SlackWorkspaceInfo[] = teamId
          ? [{
              teamId,
              teamName: teamName || 'Slack Workspace',
              userId: userId || '',
              connectedAt: connectedAt || Date.now(),
            }]
          : []

        return {
          success: true,
          connection,
          workspaces,
        }
      } catch (error) {
        console.error('[Slack IPC] Get status error:', error)
        return {
          success: false,
          error: (error as Error).message,
        }
      }
    }
  )

  /**
   * Disconnect Slack
   * Removes stored OAuth credentials
   */
  ipcMain.handle(
    IPC_CHANNELS.SLACK_DISCONNECT,
    async (_event, workspaceId: string, _teamId?: string) => {
      try {
        const credentialId: CredentialId = {
          type: 'slack_oauth',
          workspaceId,
          sourceId: 'slack',
        }

        await credentialManager.delete(credentialId)

        return { success: true }
      } catch (error) {
        console.error('[Slack IPC] Disconnect error:', error)
        return {
          success: false,
          error: (error as Error).message,
        }
      }
    }
  )

  /**
   * Check if Slack OAuth credentials are configured
   * Returns true if SLACK_OAUTH_CLIENT_ID and SLACK_OAUTH_CLIENT_SECRET are set
   */
  ipcMain.handle(
    IPC_CHANNELS.SLACK_HAS_OAUTH_CREDENTIALS,
    async (_event) => {
      return isSlackOAuthConfigured()
    }
  )
}
