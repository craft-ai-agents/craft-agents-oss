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
import { saveConfig, loadStoredConfig, generateWorkspaceId, type AuthType, type StoredConfig } from '@craft-agent/shared/config'
import { CraftOAuth, getMcpBaseUrl } from '@craft-agent/shared/auth'
import { validateMcpConnection } from '@craft-agent/shared/mcp'
import { getExistingClaudeToken, isClaudeCliInstalled, runClaudeSetupToken } from '@craft-agent/shared/auth'
import {
  IPC_CHANNELS,
  type CraftOAuthResult,
  type CraftMcpLink,
  type OnboardingSaveResult,
} from '../shared/types'
import type { SessionManager } from './sessions'

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

export function registerOnboardingHandlers(sessionManager: SessionManager): void {
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
            iconUrl: s.logoUrl,  // API returns logoUrl, UI uses iconUrl
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
            iconUrl: s.logoUrl,  // API returns logoUrl, UI uses iconUrl
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
    console.log('[Onboarding:Main] ONBOARDING_START_MCP_OAUTH received', { mcpUrl })
    try {
      const baseUrl = getMcpBaseUrl(mcpUrl)
      console.log('[Onboarding:Main] MCP OAuth baseUrl:', baseUrl)
      console.log('[Onboarding:Main] Creating CraftOAuth instance...')

      const oauth = new CraftOAuth(
        { mcpBaseUrl: baseUrl },
        {
          onStatus: (msg) => console.log('[Onboarding:Main] MCP OAuth status:', msg),
          onError: (err) => console.error('[Onboarding:Main] MCP OAuth error:', err),
        }
      )

      console.log('[Onboarding:Main] Calling oauth.authenticate() - this may open browser and wait...')
      const { tokens, clientId } = await oauth.authenticate()
      console.log('[Onboarding:Main] MCP OAuth completed successfully')

      return {
        success: true,
        accessToken: tokens.accessToken,
        clientId,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Onboarding:Main] MCP OAuth failed:', message, error)
      return { success: false, error: message }
    }
  })

  // Save onboarding configuration
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_SAVE_CONFIG, async (_event, config: {
    authType?: AuthType  // Optional - if not provided, preserves existing auth type
    workspace?: { name: string; mcpUrl: string; iconUrl?: string }  // Optional - if not provided, only updates billing
    credential?: string
    mcpCredentials?: { accessToken: string; clientId?: string }
  }): Promise<OnboardingSaveResult> => {
    console.log('[Onboarding:Main] ONBOARDING_SAVE_CONFIG received', {
      authType: config.authType,
      hasWorkspace: !!config.workspace,
      workspaceName: config.workspace?.name,
      mcpUrl: config.workspace?.mcpUrl,
      hasCredential: !!config.credential,
      credentialLength: config.credential?.length,
      hasMcpCredentials: !!config.mcpCredentials,
    })

    try {
      const manager = getCredentialManager()

      // 1. Save billing credential if provided (only when authType is specified)
      if (config.credential && config.authType) {
        console.log('[Onboarding:Main] Saving credential for authType:', config.authType)
        if (config.authType === 'api_key') {
          console.log('[Onboarding:Main] Calling manager.setApiKey...')
          await manager.setApiKey(config.credential)
          console.log('[Onboarding:Main] API key saved successfully')
        } else if (config.authType === 'oauth_token') {
          console.log('[Onboarding:Main] Calling manager.setClaudeOAuth...')
          await manager.setClaudeOAuth(config.credential)
          console.log('[Onboarding:Main] Claude OAuth saved successfully')
        }
        // craft_credits doesn't need additional credentials
      } else {
        console.log('[Onboarding:Main] Skipping credential save', {
          hasCredential: !!config.credential,
          hasAuthType: !!config.authType,
        })
      }

      // 2. Load or create config
      console.log('[Onboarding:Main] Loading existing config...')
      const existingConfig = loadStoredConfig()
      console.log('[Onboarding:Main] Existing config:', existingConfig ? 'found' : 'not found')

      const newConfig: StoredConfig = existingConfig || {
        authType: config.authType || 'craft_credits', // Default to craft_credits for new configs
        workspaces: [],
        activeWorkspaceId: null,
        activeSessionId: null,
      }

      // 3. Update authType if provided
      if (config.authType) {
        console.log('[Onboarding:Main] Updating authType from', newConfig.authType, 'to', config.authType)
        newConfig.authType = config.authType
      }

      // 4. Create workspace only if workspace info is provided
      let workspaceId: string | undefined
      if (config.workspace) {
        workspaceId = generateWorkspaceId(config.workspace.mcpUrl)
        console.log('[Onboarding:Main] Creating workspace:', workspaceId)

        // Check if workspace with this ID already exists (same MCP URL)
        const existingIndex = newConfig.workspaces.findIndex(w => w.id === workspaceId)
        const existingWorkspace = existingIndex !== -1 ? newConfig.workspaces[existingIndex] : null

        const workspace = {
          id: workspaceId,
          name: config.workspace.name,
          mcpUrl: config.workspace.mcpUrl,
          mcpAuthType: (config.mcpCredentials ? 'workspace_oauth' : 'public') as 'workspace_oauth' | 'workspace_bearer' | 'public',
          createdAt: existingWorkspace?.createdAt ?? Date.now(), // Preserve original creation time
          iconUrl: config.workspace.iconUrl,
        }
        console.log('[Onboarding:Main] Workspace config:', workspace, existingWorkspace ? '(updating existing)' : '(new)')

        // Save MCP credentials if provided
        if (config.mcpCredentials) {
          console.log('[Onboarding:Main] Saving MCP credentials for workspace')
          await manager.setWorkspaceOAuth(workspaceId, {
            accessToken: config.mcpCredentials.accessToken,
            tokenType: 'Bearer',
            clientId: config.mcpCredentials.clientId,
          })
          console.log('[Onboarding:Main] MCP credentials saved')
        }

        if (existingIndex !== -1) {
          // Update existing workspace
          newConfig.workspaces[existingIndex] = workspace
        } else {
          // Add new workspace
          newConfig.workspaces.push(workspace)
        }
        newConfig.activeWorkspaceId = workspaceId
      } else {
        console.log('[Onboarding:Main] No workspace to create (billing-only update)')
      }

      // 5. Save config
      console.log('[Onboarding:Main] Saving config to disk...')
      saveConfig(newConfig)
      console.log('[Onboarding:Main] Config saved successfully')

      // 6. Reinitialize SessionManager auth to pick up new credentials
      try {
        console.log('[Onboarding:Main] Reinitializing SessionManager auth...')
        await sessionManager.reinitializeAuth()
        console.log('[Onboarding:Main] Reinitialized auth after config save')
      } catch (authError) {
        console.error('[Onboarding:Main] Failed to reinitialize auth:', authError)
        // Don't fail the whole operation if auth reinit fails
      }

      console.log('[Onboarding:Main] Returning success', { workspaceId })
      return {
        success: true,
        workspaceId,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Onboarding:Main] Save config error:', message, error)
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
