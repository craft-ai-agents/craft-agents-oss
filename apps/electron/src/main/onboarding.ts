/**
 * Onboarding IPC handlers for Electron main process
 *
 * Handles Craft OAuth, workspace setup, and configuration persistence.
 */
import { ipcMain } from 'electron'
import { mainLog } from './logger'
import crypto from 'crypto'
import open from 'open'
import { createCallbackServer } from '@craft-agent/shared/auth'
import { CraftApi, type ProfileResponse } from '@craft-agent/shared/clients'
import { getAuthState, getSetupNeeds } from '@craft-agent/shared/auth'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { saveConfig, loadStoredConfig, generateWorkspaceId, type AuthType, type StoredConfig } from '@craft-agent/shared/config'
import { getDefaultWorkspacesDir } from '@craft-agent/shared/workspaces'
import { CraftOAuth, getMcpBaseUrl } from '@craft-agent/shared/auth'
import { validateMcpConnection } from '@craft-agent/shared/mcp'
import { getExistingClaudeToken, isClaudeCliInstalled, runClaudeSetupToken } from '@craft-agent/shared/auth'
import {
  IPC_CHANNELS,
  type CraftOAuthResult,
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
      mainLog.error('[Onboarding] Craft OAuth error:', message)
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
      mainLog.error('[Onboarding] Get Craft profile error:', message)
      return { success: false, error: message }
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
    mainLog.info('[Onboarding:Main] ONBOARDING_START_MCP_OAUTH received', { mcpUrl })
    try {
      const baseUrl = getMcpBaseUrl(mcpUrl)
      mainLog.info('[Onboarding:Main] MCP OAuth baseUrl:', baseUrl)
      mainLog.info('[Onboarding:Main] Creating CraftOAuth instance...')

      const oauth = new CraftOAuth(
        { mcpBaseUrl: baseUrl },
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

  // Save onboarding configuration
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_SAVE_CONFIG, async (_event, config: {
    authType?: AuthType  // Optional - if not provided, preserves existing auth type
    workspace?: { name: string; iconUrl?: string; mcpUrl?: string }  // Optional - if not provided, only updates billing
    credential?: string
    mcpCredentials?: { accessToken: string; clientId?: string }
  }): Promise<OnboardingSaveResult> => {
    mainLog.info('[Onboarding:Main] ONBOARDING_SAVE_CONFIG received', {
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
        mainLog.info('[Onboarding:Main] Saving credential for authType:', config.authType)
        if (config.authType === 'api_key') {
          mainLog.info('[Onboarding:Main] Calling manager.setApiKey...')
          await manager.setApiKey(config.credential)
          mainLog.info('[Onboarding:Main] API key saved successfully')
        } else if (config.authType === 'oauth_token') {
          mainLog.info('[Onboarding:Main] Calling manager.setClaudeOAuth...')
          await manager.setClaudeOAuth(config.credential)
          mainLog.info('[Onboarding:Main] Claude OAuth saved successfully')
        }
        // craft_credits doesn't need additional credentials
      } else {
        mainLog.info('[Onboarding:Main] Skipping credential save', {
          hasCredential: !!config.credential,
          hasAuthType: !!config.authType,
        })
      }

      // 2. Load or create config
      mainLog.info('[Onboarding:Main] Loading existing config...')
      const existingConfig = loadStoredConfig()
      mainLog.info('[Onboarding:Main] Existing config:', existingConfig ? 'found' : 'not found')

      const newConfig: StoredConfig = existingConfig || {
        authType: config.authType || 'craft_credits', // Default to craft_credits for new configs
        workspaces: [],
        activeWorkspaceId: null,
        activeSessionId: null,
      }

      // 3. Update authType if provided
      if (config.authType) {
        mainLog.info('[Onboarding:Main] Updating authType from', newConfig.authType, 'to', config.authType)
        newConfig.authType = config.authType
      }

      // 4. Create workspace only if workspace info is provided
      let workspaceId: string | undefined
      if (config.workspace) {
        // Check if workspace with same name already exists
        const existingIndex = newConfig.workspaces.findIndex(w => w.name.toLowerCase() === config.workspace!.name.toLowerCase())
        const existingWorkspace = existingIndex !== -1 ? newConfig.workspaces[existingIndex] : null

        // Use existing ID if updating, otherwise generate new one
        workspaceId = existingWorkspace?.id ?? generateWorkspaceId()
        mainLog.info('[Onboarding:Main] Creating workspace:', workspaceId)

        const workspace = {
          id: workspaceId,
          name: config.workspace.name,
          rootPath: existingWorkspace?.rootPath ?? `${getDefaultWorkspacesDir()}/${workspaceId}`,
          createdAt: existingWorkspace?.createdAt ?? Date.now(), // Preserve original creation time
          iconUrl: config.workspace.iconUrl,
          mcpUrl: config.workspace.mcpUrl,
        }
        mainLog.info('[Onboarding:Main] Workspace config:', workspace, existingWorkspace ? '(updating existing)' : '(new)')

        // Save MCP credentials if provided
        if (config.mcpCredentials) {
          mainLog.info('[Onboarding:Main] Saving MCP credentials for workspace')
          await manager.setWorkspaceOAuth(workspaceId, {
            accessToken: config.mcpCredentials.accessToken,
            tokenType: 'Bearer',
            clientId: config.mcpCredentials.clientId,
          })
          mainLog.info('[Onboarding:Main] MCP credentials saved')
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
        mainLog.info('[Onboarding:Main] No workspace to create (billing-only update)')

        // 4b. Auto-create default workspace if no workspaces exist
        // This ensures users have a workspace to start with after billing-only onboarding
        if (newConfig.workspaces.length === 0) {
          workspaceId = generateWorkspaceId()
          mainLog.info('[Onboarding:Main] Auto-creating default workspace:', workspaceId)

          const defaultWorkspace = {
            id: workspaceId,
            name: 'Default',
            rootPath: `${getDefaultWorkspacesDir()}/${workspaceId}`,
            createdAt: Date.now(),
          }
          newConfig.workspaces.push(defaultWorkspace)
          newConfig.activeWorkspaceId = workspaceId
        }
      }

      // 5. Save config
      mainLog.info('[Onboarding:Main] Saving config to disk...')
      saveConfig(newConfig)
      mainLog.info('[Onboarding:Main] Config saved successfully')

      // 6. Reinitialize SessionManager auth to pick up new credentials
      try {
        mainLog.info('[Onboarding:Main] Reinitializing SessionManager auth...')
        await sessionManager.reinitializeAuth()
        mainLog.info('[Onboarding:Main] Reinitialized auth after config save')
      } catch (authError) {
        mainLog.error('[Onboarding:Main] Failed to reinitialize auth:', authError)
        // Don't fail the whole operation if auth reinit fails
      }

      mainLog.info('[Onboarding:Main] Returning success', { workspaceId })
      return {
        success: true,
        workspaceId,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      mainLog.error('[Onboarding:Main] Save config error:', message, error)
      return { success: false, error: message }
    }
  })

  // Get existing Claude OAuth token from keychain/credentials file
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_GET_EXISTING_CLAUDE_TOKEN, async () => {
    try {
      return getExistingClaudeToken()
    } catch (error) {
      mainLog.error('[Onboarding] Get existing Claude token error:', error)
      return null
    }
  })

  // Check if Claude CLI is installed
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_IS_CLAUDE_CLI_INSTALLED, async () => {
    try {
      return isClaudeCliInstalled()
    } catch (error) {
      mainLog.error('[Onboarding] Check Claude CLI error:', error)
      return false
    }
  })

  // Run claude setup-token to get OAuth token
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_RUN_CLAUDE_SETUP_TOKEN, async () => {
    try {
      const result = await runClaudeSetupToken((status) => {
        mainLog.info('[Onboarding] Claude setup-token status:', status)
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      mainLog.error('[Onboarding] Run Claude setup-token error:', message)
      return { success: false, error: message }
    }
  })
}
