/**
 * Slack IPC Handlers
 *
 * Registers IPC handlers for Slack OAuth integration, enabling renderer
 * to communicate with Slack OAuth flows in the main process.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import { getCredentialManager, type CredentialId } from '@vesper/shared/credentials'
import { startSlackOAuth, isSlackOAuthConfigured } from '@vesper/shared/auth/slack-oauth'
import {
  createSlackService,
  stopSlackService,
  getSlackService,
  processSlackMessageWithSession,
  type SlackService,
} from './slack-service'
import type {
  SlackAccountConfig,
  SlackOutboundMessage,
  SlackInboundMessage,
} from '@vesper/shared/slack'
import { routeSlackMessage, type MessageRouterConfig } from '@vesper/shared/slack/message-router'
import type { SessionManager } from './sessions'

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
export function registerSlackHandlers(sessionManager: SessionManager): void {
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

  /**
   * Connect to Slack service (start listening for messages)
   */
  ipcMain.handle(IPC_CHANNELS.SLACK_CONNECT, async (_, { workspaceId, accountId = 'default', config }: {
    workspaceId: string
    accountId?: string
    config?: Partial<SlackAccountConfig>
  }) => {
    try {
      // Get stored OAuth credentials
      const credentialId: CredentialId = {
        type: 'slack_oauth',
        workspaceId,
        sourceId: 'slack',
      }

      const credentials = await credentialManager.get(credentialId)

      if (!credentials?.value) {
        return { success: false, error: 'No Slack credentials found. Please authenticate first.' }
      }

      // Get app token from env or credentials
      const appToken = process.env.SLACK_APP_TOKEN || (credentials.metadata?.appToken as string | undefined)

      if (!appToken) {
        return { success: false, error: 'No app token found. Socket Mode requires SLACK_APP_TOKEN.' }
      }

      // Default config
      const accountConfig: SlackAccountConfig = {
        accountId,
        enabled: true,
        mode: 'socket',
        dmPolicy: 'open',
        groupPolicy: 'open',
        replyToMode: 'all',
        ...config,
      }

      // Create and start service
      const service = await createSlackService({
        workspaceId,
        accountId,
        botToken: credentials.value,
        appToken,
        config: accountConfig,
        onMessage: async (message) => {
          // Route the message
          const routerConfig: MessageRouterConfig = {
            accountConfig,
            botUserId: service.getState().botUserId,
          }

          const routeResult = routeSlackMessage(message, routerConfig)

          if (!routeResult.shouldProcess) {
            console.log(`[Slack] Skipped message: ${routeResult.reason}`)
            return
          }

          // Emit to renderer
          BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('slack:message-received', {
              workspaceId,
              accountId,
              message: {
                ...message,
                text: routeResult.cleanedText ?? message.text,
              },
              sessionKey: routeResult.sessionKey,
              permissionMode: routeResult.permissionMode,
            })
          })

          // Process with session integration
          try {
            await processSlackMessageWithSession({
              service,
              message: {
                ...message,
                text: routeResult.cleanedText ?? message.text,
              },
              sessionKey: routeResult.sessionKey!,
              permissionMode: routeResult.permissionMode!,
              workspaceId,
              sessionManager,
            })
          } catch (error) {
            console.error('[Slack] Session processing error:', error)
          }
        },
        onStatusChange: (status) => {
          BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('slack:status-changed', {
              workspaceId,
              accountId,
              status,
            })
          })
        },
        onError: (error) => {
          BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('slack:error', {
              workspaceId,
              accountId,
              error,
            })
          })
        },
      })

      await service.start()
      const state = service.getState()

      return {
        success: true,
        state,
      }
    } catch (error) {
      console.error('[SlackIPC] Connect error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  /**
   * Disconnect Slack service (stop listening)
   */
  ipcMain.handle(IPC_CHANNELS.SLACK_DISCONNECT_SERVICE, async (_, { workspaceId, accountId = 'default' }: {
    workspaceId: string
    accountId?: string
  }) => {
    try {
      await stopSlackService(workspaceId, accountId)
      return { success: true }
    } catch (error) {
      console.error('[SlackIPC] Disconnect service error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  /**
   * Send message to Slack
   */
  ipcMain.handle(IPC_CHANNELS.SLACK_SEND_MESSAGE, async (_, { workspaceId, accountId = 'default', message }: {
    workspaceId: string
    accountId?: string
    message: SlackOutboundMessage
  }) => {
    try {
      const service = await getSlackService(workspaceId, accountId)

      if (!service) {
        return { success: false, error: 'Slack service not connected' }
      }

      const result = await service.sendMessage(message)

      if (result.error) {
        return { success: false, error: result.error.message }
      }

      return { success: true, ts: result.ts }
    } catch (error) {
      console.error('[SlackIPC] Send message error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  /**
   * Get service status
   */
  ipcMain.handle(IPC_CHANNELS.SLACK_GET_SERVICE_STATUS, async (_, { workspaceId, accountId = 'default' }: {
    workspaceId: string
    accountId?: string
  }) => {
    try {
      const service = await getSlackService(workspaceId, accountId)

      if (!service) {
        return { connected: false, state: null }
      }

      return { connected: true, state: service.getState() }
    } catch (error) {
      console.error('[SlackIPC] Get status error:', error)
      return { connected: false, state: null }
    }
  })
}
