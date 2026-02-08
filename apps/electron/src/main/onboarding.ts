/**
 * Onboarding IPC handlers for Electron main process
 *
 * Handles workspace setup and configuration persistence.
 */
import { ipcMain } from 'electron'
import { mainLog } from './logger'
import { getAuthState, getSetupNeeds } from '@craft-agent/shared/auth'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { CraftOAuth, getMcpBaseUrl, startClaudeOAuth, exchangeClaudeCode, hasValidOAuthState, clearOAuthState } from '@craft-agent/shared/auth'
import { validateMcpConnection } from '@craft-agent/shared/mcp'
import { IPC_CHANNELS } from '../shared/types'
import type { SessionManager } from './sessions'

// ============================================
// IPC Handlers
// ============================================

export function registerOnboardingHandlers(sessionManager: SessionManager): void {
  // Get current auth state
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_GET_AUTH_STATE, async () => {
    const authState = await getAuthState()
    const setupNeeds = getSetupNeeds(authState)
    return { authState, setupNeeds }
  })

  // Validate MCP connection
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_VALIDATE_MCP, async (_event, mcpUrl: string, accessToken?: string) => {
    try {
      const result = await validateMcpConnection({
        mcpUrl,
        mcpAccessToken: accessToken,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Start MCP server OAuth
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_START_MCP_OAUTH, async (_event, mcpUrl: string) => {
    mainLog.info('[Onboarding:Main] ONBOARDING_START_MCP_OAUTH received', { mcpUrl })
    try {
      const baseUrl = getMcpBaseUrl(mcpUrl)
      mainLog.info('[Onboarding:Main] MCP OAuth baseUrl:', baseUrl)
      mainLog.info('[Onboarding:Main] Creating CraftOAuth instance...')

      const oauth = new CraftOAuth(
        { mcpUrl: baseUrl },
        {
          onStatus: (msg) => mainLog.info('[Onboarding:Main] MCP OAuth status:', msg),
          onError: (err) => mainLog.error('[Onboarding:Main] MCP OAuth error:', err),
        }
      )

      mainLog.info('[Onboarding:Main] Calling oauth.authenticate() - this may open browser and wait...')
      const { tokens, clientId } = await oauth.authenticate()
      mainLog.info('[Onboarding:Main] MCP OAuth completed successfully')

      return {
        success: true,
        accessToken: tokens.accessToken,
        clientId,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      mainLog.error('[Onboarding:Main] MCP OAuth failed:', message, error)
      return { success: false, error: message }
    }
  })

  // Start Claude OAuth flow (opens browser, returns URL)
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_START_CLAUDE_OAUTH, async () => {
    try {
      mainLog.info('[Onboarding] Starting Claude OAuth flow...')

      const authUrl = await startClaudeOAuth((status) => {
        mainLog.info('[Onboarding] Claude OAuth status:', status)
      })

      mainLog.info('[Onboarding] Claude OAuth URL generated, browser opened')
      return { success: true, authUrl }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      mainLog.error('[Onboarding] Start Claude OAuth error:', message)
      return { success: false, error: message }
    }
  })

  // Exchange authorization code for tokens
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_EXCHANGE_CLAUDE_CODE, async (_event, authorizationCode: string, connectionSlug: string) => {
    try {
      mainLog.info(`[Onboarding] Exchanging Claude authorization code for connection: ${connectionSlug}`)

      // Check if we have valid state
      if (!hasValidOAuthState()) {
        mainLog.error('[Onboarding] No valid OAuth state found')
        return { success: false, error: 'OAuth session expired. Please start again.' }
      }

      const tokens = await exchangeClaudeCode(authorizationCode, (status) => {
        mainLog.info('[Onboarding] Claude code exchange status:', status)
      })

      // Save credentials with refresh token support
      const manager = getCredentialManager()

      // Save to new LLM connection system
      await manager.setLlmOAuth(connectionSlug, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      })

      // Also save to legacy key for validation compatibility
      // (matches dual-write pattern in performTokenRefresh)
      await manager.setClaudeOAuthCredentials({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        source: 'native',
      })

      const expiresAtDate = tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : 'never'
      mainLog.info(`[Onboarding] Claude OAuth saved to LLM connection (expires: ${expiresAtDate})`)
      return { success: true, token: tokens.accessToken }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      mainLog.error('[Onboarding] Exchange Claude code error:', message)
      return { success: false, error: message }
    }
  })

  // Check if there's a valid OAuth state in progress
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_HAS_CLAUDE_OAUTH_STATE, async () => {
    return hasValidOAuthState()
  })

  // Clear OAuth state (for cancel/reset)
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_CLEAR_CLAUDE_OAUTH_STATE, async () => {
    clearOAuthState()
    return { success: true }
  })
}
