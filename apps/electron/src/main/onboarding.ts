/**
 * Onboarding IPC handlers for Electron main process
 *
 * Handles Craft OAuth, workspace setup, and configuration persistence.
 */
import { ipcMain } from 'electron'
import crypto from 'crypto'
import open from 'open'
import { createCallbackServer } from '@craft-agent/shared/auth'
import { CraftApi, type ProfileResponse } from '@craft-agent/shared/clients'
import { getAuthState, getSetupNeeds } from '@craft-agent/shared/auth'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { saveConfig, loadStoredConfig, type AuthType, type StoredConfig } from '@craft-agent/shared/config'
import { randomUUID } from 'crypto'
import { CraftOAuth, getMcpBaseUrl } from '@craft-agent/shared/auth'
import { validateMcpConnection } from '@craft-agent/shared/mcp'
import { getExistingClaudeToken, isClaudeCliInstalled, runClaudeSetupToken } from '@craft-agent/shared/auth'
import {
  IPC_CHANNELS,
  type CraftOAuthResult,
  type CraftMcpLink,
  type OnboardingSaveResult,
} from '../shared/types'

// ============================================
// PKCE Generation
// ============================================

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  return { codeVerifier, codeChallenge }
}

function generateState(): string {
  return crypto.randomBytes(16).toString('base64url')
}

// ============================================
// IPC Handlers
// ============================================

export function registerOnboardingHandlers(): void {
  // Get current auth state
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_GET_AUTH_STATE, async () => {
    const authState = await getAuthState()
    const setupNeeds = getSetupNeeds(authState)
    return { authState, setupNeeds }
  })

  // Start Craft OAuth flow
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_START_CRAFT_OAUTH, async (): Promise<CraftOAuthResult> => {
    try {
      // Create callback server with Electron-specific labels and deeplink
      const callbackServer = await createCallbackServer({
        appType: 'electron',
        deeplinkUrl: 'craftagents://auth-complete',
      })
      const { codeVerifier, codeChallenge } = generatePKCE()
      const callbackUrl = `${callbackServer.url}/callback`
      const state = generateState()

      // Build login URL
      const platform = 'chaps'
      const domain = 'docs.craft.do'
      const loginUrl = `http://${domain}/login?platform=${encodeURIComponent(platform)}&code_challenge=${encodeURIComponent(codeChallenge)}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(callbackUrl)}`

      // Open browser
      await open(loginUrl)

      // Wait for callback
      const payload = await callbackServer.promise

      // Validate state
      if (payload.query.state !== state) {
        return { success: false, error: 'State mismatch - possible security issue' }
      }

      const code = payload.query.code
      if (!code) {
        return { success: false, error: 'No authorization code received' }
      }

      // Exchange code for token
      const craftApi = new CraftApi()
      const token = await craftApi.exchangeCodeForToken({
        code,
        redirectUri: callbackUrl,
        codeVerifier,
      })

      // Fetch profile
      const profile = await craftApi.getProfile(token)

      // Save token
      const manager = getCredentialManager()
      await manager.setCraftOAuth(token)

      return {
        success: true,
        token,
        profile: {
          userId: profile.userId,
          firstName: profile.firstName,
          lastName: profile.lastName,
          spaces: profile.spaces.map(s => ({
            id: s.id,
            name: s.name,
            teamId: s.teamId,
          })),
          teams: profile.teams.map(t => ({
            id: t.id,
            name: t.name,
            isPrivate: t.isPrivate,
            role: t.role,
            tier: t.tier,
          })),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Onboarding] Craft OAuth error:', message)
      return { success: false, error: message }
    }
  })

  // Get Craft profile using existing stored token (for add workspace flow)
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_GET_CRAFT_PROFILE, async (): Promise<CraftOAuthResult> => {
    try {
      const manager = getCredentialManager()
      const token = await manager.getCraftOAuth()

      if (!token) {
        return { success: false, error: 'No Craft token stored' }
      }

      // Fetch profile using existing token
      const craftApi = new CraftApi()
      const profile = await craftApi.getProfile(token)

      return {
        success: true,
        token,
        profile: {
          userId: profile.userId,
          firstName: profile.firstName,
          lastName: profile.lastName,
          spaces: profile.spaces.map(s => ({
            id: s.id,
            name: s.name,
            teamId: s.teamId,
          })),
          teams: profile.teams.map(t => ({
            id: t.id,
            name: t.name,
            isPrivate: t.isPrivate,
            role: t.role,
            tier: t.tier,
          })),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Onboarding] Get Craft profile error:', message)
      return { success: false, error: message }
    }
  })

  // Get MCP links for a space
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_GET_MCP_LINKS, async (_event, spaceId: string, authToken: string): Promise<CraftMcpLink[]> => {
    try {
      const craftApi = new CraftApi()
      const links = await craftApi.getWorkflowLinks({ authToken, spaceId })

      // Filter to only fullSpace MCP links
      return links
        .filter(link => link.type === 'mcp' && link.scope === 'fullSpace')
        .map(link => ({
          linkId: link.linkId,
          name: link.name,
          mcpUrl: link.urls?.mcp,
          scope: link.scope,
          enabled: link.enabled,
        }))
    } catch (error) {
      console.error('[Onboarding] Get MCP links error:', error)
      return []
    }
  })

  // Create a new MCP link for a space
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_CREATE_MCP_LINK, async (_event, spaceId: string, authToken: string): Promise<CraftMcpLink> => {
    try {
      const craftApi = new CraftApi()
      const link = await craftApi.createSpaceWorkflowLink({
        authToken,
        spaceId,
        name: 'Craft Agents MCP',
        type: 'mcp',
        scope: 'fullSpace',
      })

      return {
        linkId: link.linkId,
        name: link.name,
        mcpUrl: link.urls?.mcp,
        scope: link.scope,
        enabled: link.enabled,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Onboarding] Create MCP link error:', message)
      throw new Error(`Failed to create MCP link: ${message}`)
    }
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
    try {
      const baseUrl = getMcpBaseUrl(mcpUrl)
      const oauth = new CraftOAuth(
        { mcpBaseUrl: baseUrl },
        {
          onStatus: (msg) => console.log('[Onboarding] MCP OAuth:', msg),
          onError: (err) => console.error('[Onboarding] MCP OAuth error:', err),
        }
      )

      const { tokens, clientId } = await oauth.authenticate()

      return {
        success: true,
        accessToken: tokens.accessToken,
        clientId,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Onboarding] MCP OAuth error:', message)
      return { success: false, error: message }
    }
  })

  // Save onboarding configuration
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_SAVE_CONFIG, async (_event, config: {
    authType?: AuthType  // Optional - if not provided, preserves existing auth type
    workspace?: { name: string; mcpUrl: string }  // Optional - if not provided, only updates billing
    credential?: string
    mcpCredentials?: { accessToken: string; clientId?: string }
  }): Promise<OnboardingSaveResult> => {
    try {
      const manager = getCredentialManager()

      // 1. Save billing credential if provided (only when authType is specified)
      if (config.credential && config.authType) {
        if (config.authType === 'api_key') {
          await manager.setApiKey(config.credential)
        } else if (config.authType === 'oauth_token') {
          await manager.setClaudeOAuth(config.credential)
        }
        // craft_credits doesn't need additional credentials
      }

      // 2. Load or create config
      const existingConfig = loadStoredConfig()
      const newConfig: StoredConfig = existingConfig || {
        authType: config.authType || 'craft_credits', // Default to craft_credits for new configs
        workspaces: [],
        activeWorkspaceId: null,
        activeSessionId: null,
      }

      // 3. Update authType if provided
      if (config.authType) {
        newConfig.authType = config.authType
      }

      // 4. Create workspace only if workspace info is provided
      let workspaceId: string | undefined
      if (config.workspace) {
        workspaceId = randomUUID()
        const workspace = {
          id: workspaceId,
          name: config.workspace.name,
          mcpUrl: config.workspace.mcpUrl,
          mcpAuthType: (config.mcpCredentials ? 'workspace_oauth' : 'public') as 'workspace_oauth' | 'workspace_bearer' | 'public',
          createdAt: Date.now(),
        }

        // Save MCP credentials if provided
        if (config.mcpCredentials) {
          await manager.setWorkspaceOAuth(workspaceId, {
            accessToken: config.mcpCredentials.accessToken,
            tokenType: 'Bearer',
            clientId: config.mcpCredentials.clientId,
          })
        }

        newConfig.workspaces.push(workspace)
        newConfig.activeWorkspaceId = workspaceId
      }

      // 5. Save config
      saveConfig(newConfig)

      return {
        success: true,
        workspaceId,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Onboarding] Save config error:', message)
      return { success: false, error: message }
    }
  })

  // Get existing Claude OAuth token from keychain/credentials file
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_GET_EXISTING_CLAUDE_TOKEN, async () => {
    try {
      return getExistingClaudeToken()
    } catch (error) {
      console.error('[Onboarding] Get existing Claude token error:', error)
      return null
    }
  })

  // Check if Claude CLI is installed
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_IS_CLAUDE_CLI_INSTALLED, async () => {
    try {
      return isClaudeCliInstalled()
    } catch (error) {
      console.error('[Onboarding] Check Claude CLI error:', error)
      return false
    }
  })

  // Run claude setup-token to get OAuth token
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_RUN_CLAUDE_SETUP_TOKEN, async () => {
    try {
      const result = await runClaudeSetupToken((status) => {
        console.log('[Onboarding] Claude setup-token status:', status)
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Onboarding] Run Claude setup-token error:', message)
      return { success: false, error: message }
    }
  })
}
