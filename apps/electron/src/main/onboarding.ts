/**
 * Onboarding IPC handlers for Electron main process
 *
 * Handles workspace setup and configuration persistence.
 */
import { ipcMain } from 'electron'
import { mainLog } from './logger'
import { getAuthState, getSetupNeeds } from '@craft-agent/shared/auth'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { saveConfig, loadStoredConfig, generateWorkspaceId, type AuthType, type StoredConfig } from '@craft-agent/shared/config'
import { debug } from '@craft-agent/shared/utils/debug'
import { getDefaultWorkspacesDir, generateUniqueWorkspacePath } from '@craft-agent/shared/workspaces'
import { CraftOAuth, getMcpBaseUrl } from '@craft-agent/shared/auth'
import { validateMcpConnection } from '@craft-agent/shared/mcp'
import { getExistingClaudeToken, getExistingClaudeCredentials, isClaudeCliInstalled, runClaudeSetupToken, startClaudeOAuth, exchangeClaudeCode, hasValidOAuthState, clearOAuthState, type ClaudeOAuthCredential } from '@craft-agent/shared/auth'
import { getCredentialManager as getCredentialManagerFn } from '@craft-agent/shared/credentials'
import {
  IPC_CHANNELS,
  type OnboardingSaveResult,
} from '../shared/types'
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
    credential?: string | ClaudeOAuthCredential  // API key, OAuth token string, or full OAuth credentials object
    mcpCredentials?: { accessToken: string; clientId?: string }
    anthropicBaseUrl?: string | null
    customModel?: string | null
  }): Promise<OnboardingSaveResult> => {
    mainLog.info('[Onboarding:Main] ONBOARDING_SAVE_CONFIG received', {
      authType: config.authType,
      hasWorkspace: !!config.workspace,
      workspaceName: config.workspace?.name,
      mcpUrl: config.workspace?.mcpUrl,
      hasCredential: !!config.credential,
      credentialIsObject: typeof config.credential === 'object',
      credentialLength: typeof config.credential === 'string' ? config.credential.length : undefined,
      hasMcpCredentials: !!config.mcpCredentials,
      anthropicBaseUrl: config.anthropicBaseUrl,
      customModel: config.customModel,
    })

    try {
      const manager = getCredentialManager()

      // 1. Save billing credential if provided (only when authType is specified)
      if (config.credential && config.authType) {
        mainLog.info('[Onboarding:Main] Saving credential for authType:', config.authType)
        if (config.authType === 'api_key') {
          // API key must be a string
          if (typeof config.credential !== 'string') {
            mainLog.error('[Onboarding:Main] Invalid credential type for api_key - expected string')
            return { success: false, error: 'Invalid credential type for API key' }
          }
          mainLog.info('[Onboarding:Main] Calling manager.setApiKey...')
          await manager.setApiKey(config.credential)
          mainLog.info('[Onboarding:Main] API key saved successfully')
        } else if (config.authType === 'oauth_token') {
          // OAuth token can be a string or full credentials object
          if (typeof config.credential === 'object') {
            // Full credentials object provided - save directly
            mainLog.info('[Onboarding:Main] Saving full Claude OAuth credentials object...', {
              hasAccessToken: !!config.credential.accessToken,
              hasRefreshToken: !!config.credential.refreshToken,
              refreshTokenLength: config.credential.refreshToken?.length,
              hasExpiresAt: !!config.credential.expiresAt,
              expiresAt: config.credential.expiresAt,
              expiresAtDate: config.credential.expiresAt ? new Date(config.credential.expiresAt).toISOString() : null,
            })
            await manager.setClaudeOAuthCredentials({
              accessToken: config.credential.accessToken,
              refreshToken: config.credential.refreshToken,
              expiresAt: config.credential.expiresAt,
            })
            // Verify credentials were saved correctly
            const savedCreds = await manager.getClaudeOAuthCredentials()
            mainLog.info('[Onboarding:Main] Claude OAuth credentials saved. Verification:', {
              saved: !!savedCreds,
              hasRefreshToken: !!savedCreds?.refreshToken,
              refreshTokenLength: savedCreds?.refreshToken?.length,
              hasExpiresAt: !!savedCreds?.expiresAt,
            })
            // Clear skipCliImportUntil flag after new authentication
            const currentConfig = loadStoredConfig()
            if (currentConfig && currentConfig.skipCliImportUntil !== undefined) {
              currentConfig.skipCliImportUntil = undefined
              saveConfig(currentConfig)
              debug('[auth] Cleared skipCliImportUntil flag after new authentication')
            }
          } else {
            // String token provided - check if we already have credentials (from OAuth exchange)
            // If credentials exist, use them instead of importing from CLI (which may have old incompatible token)
            const existingCreds = await manager.getClaudeOAuthCredentials()
            if (existingCreds) {
              mainLog.info('[Onboarding:Main] Token string provided, but credentials already exist from OAuth exchange - keeping existing credentials')
              // Clear skipCliImportUntil flag after new authentication
              const currentConfig = loadStoredConfig()
              if (currentConfig && currentConfig.skipCliImportUntil !== undefined) {
                currentConfig.skipCliImportUntil = undefined
                saveConfig(currentConfig)
                debug('[auth] Cleared skipCliImportUntil flag after new authentication')
              }
            } else {
              // No existing credentials - try to get full credentials from CLI, but only if skip flag isn't set
              const currentConfig = loadStoredConfig()
              if (currentConfig?.skipCliImportUntil && Date.now() < currentConfig.skipCliImportUntil) {
                mainLog.info('[Onboarding:Main] Token string provided, but skipping CLI import due to skipCliImportUntil flag')
                // Fallback to just saving the access token
                await manager.setClaudeOAuth(config.credential)
                mainLog.info('[Onboarding:Main] Claude OAuth saved (access token only - CLI import skipped)')
              } else {
                mainLog.info('[Onboarding:Main] Token string provided, attempting to import full Claude OAuth credentials from CLI...')
                const cliCreds = getExistingClaudeCredentials()
                if (cliCreds) {
                  await manager.setClaudeOAuthCredentials({
                    accessToken: cliCreds.accessToken,
                    refreshToken: cliCreds.refreshToken,
                    expiresAt: cliCreds.expiresAt,
                  })
                  mainLog.info('[Onboarding:Main] Claude OAuth credentials saved with refresh token from CLI')
                  // Clear skipCliImportUntil flag after new authentication
                  if (currentConfig && currentConfig.skipCliImportUntil !== undefined) {
                    currentConfig.skipCliImportUntil = undefined
                    saveConfig(currentConfig)
                    debug('[auth] Cleared skipCliImportUntil flag after new authentication')
                  }
                } else {
                  // Fallback to just saving the access token
                  await manager.setClaudeOAuth(config.credential)
                  mainLog.info('[Onboarding:Main] Claude OAuth saved (access token only - no refresh token available)')
                }
              }
            }
          }
        }
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
        authType: config.authType || 'api_key',
        workspaces: [],
        activeWorkspaceId: null,
        activeSessionId: null,
      }

      // 3. Update authType if provided
      if (config.authType) {
        mainLog.info('[Onboarding:Main] Updating authType from', newConfig.authType, 'to', config.authType)
        newConfig.authType = config.authType
      }

      // 3a. Update anthropicBaseUrl if provided
      if (config.anthropicBaseUrl !== undefined) {
        mainLog.info('[Onboarding:Main] Updating anthropicBaseUrl to', config.anthropicBaseUrl)
        if (config.anthropicBaseUrl) {
          newConfig.anthropicBaseUrl = config.anthropicBaseUrl
        } else {
          delete newConfig.anthropicBaseUrl
        }
      }

      // 3b. Update customModel if provided
      if (config.customModel !== undefined) {
        mainLog.info('[Onboarding:Main] Updating customModel to', config.customModel)
        if (config.customModel?.trim()) {
          newConfig.customModel = config.customModel.trim()
        } else {
          delete newConfig.customModel
        }
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
          rootPath: existingWorkspace?.rootPath ?? generateUniqueWorkspacePath(config.workspace.name, getDefaultWorkspacesDir()),
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
            name: 'My Workspace',
            rootPath: generateUniqueWorkspacePath('My Workspace', getDefaultWorkspacesDir()),
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
      // Check if we should skip CLI import due to recent refresh failure
      const config = loadStoredConfig()
      if (config?.skipCliImportUntil && Date.now() < config.skipCliImportUntil) {
        mainLog.info('[Onboarding] Skipping CLI credential check due to skipCliImportUntil flag', {
          skipUntil: config.skipCliImportUntil,
          now: Date.now(),
          remainingMs: config.skipCliImportUntil - Date.now(),
        })
        return null
      }

      mainLog.info('[Onboarding] Checking for existing Claude token...')
      const token = getExistingClaudeToken()
      mainLog.info('[Onboarding] Existing Claude token:', token ? `found (${token.length} chars)` : 'not found')
      return token
    } catch (error) {
      mainLog.error('[Onboarding] Get existing Claude token error:', error)
      return null
    }
  })

  // Get existing Claude OAuth credentials (full object with refresh token and expiry) from keychain/credentials file
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_GET_EXISTING_CLAUDE_CREDENTIALS, async () => {
    try {
      // Check if we should skip CLI import due to recent refresh failure
      const config = loadStoredConfig()
      if (config?.skipCliImportUntil && Date.now() < config.skipCliImportUntil) {
        mainLog.info('[Onboarding] Skipping CLI credential check due to skipCliImportUntil flag', {
          skipUntil: config.skipCliImportUntil,
          now: Date.now(),
          remainingMs: config.skipCliImportUntil - Date.now(),
        })
        return null
      }

      mainLog.info('[Onboarding] Checking for existing Claude credentials...')
      const creds = getExistingClaudeCredentials()
      mainLog.info('[Onboarding] Existing Claude credentials:', creds ? `found (has refreshToken: ${!!creds.refreshToken}, expiresAt: ${creds.expiresAt})` : 'not found')
      return creds
    } catch (error) {
      mainLog.error('[Onboarding] Get existing Claude credentials error:', error)
      return null
    }
  })

  // Check if Claude CLI is installed
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_IS_CLAUDE_CLI_INSTALLED, async () => {
    try {
      mainLog.info('[Onboarding] Checking if Claude CLI is installed...')
      mainLog.info('[Onboarding] Current PATH (first 300 chars):', (process.env.PATH || '').substring(0, 300))
      const installed = isClaudeCliInstalled()
      mainLog.info('[Onboarding] Claude CLI installed:', installed)
      return installed
    } catch (error) {
      mainLog.error('[Onboarding] Check Claude CLI error:', error)
      return false
    }
  })

  // Run claude setup-token to get OAuth token
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_RUN_CLAUDE_SETUP_TOKEN, async () => {
    try {
      mainLog.info('[Onboarding] Starting claude setup-token...')
      const result = await runClaudeSetupToken((status) => {
        mainLog.info('[Onboarding] Claude setup-token status:', status)
      })
      mainLog.info('[Onboarding] Claude setup-token result:', {
        success: result.success,
        hasToken: !!result.token,
        error: result.error,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      mainLog.error('[Onboarding] Run Claude setup-token error:', message, error)
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
  ipcMain.handle(IPC_CHANNELS.ONBOARDING_EXCHANGE_CLAUDE_CODE, async (_event, authorizationCode: string) => {
    try {
      mainLog.info('[Onboarding] Exchanging Claude authorization code...')

      // Check if we have valid state
      if (!hasValidOAuthState()) {
        mainLog.error('[Onboarding] No valid OAuth state found')
        return { success: false, error: 'OAuth session expired. Please start again.' }
      }

      const tokens = await exchangeClaudeCode(authorizationCode, (status) => {
        mainLog.info('[Onboarding] Claude code exchange status:', status)
      })

      // Save credentials with refresh token support
      const manager = getCredentialManagerFn()
      await manager.setClaudeOAuthCredentials({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      })

      // Clear skipCliImportUntil flag after new authentication
      const currentConfig = loadStoredConfig()
      if (currentConfig && currentConfig.skipCliImportUntil !== undefined) {
        currentConfig.skipCliImportUntil = undefined
        saveConfig(currentConfig)
        debug('[auth] Cleared skipCliImportUntil flag after new authentication')
      }

      mainLog.info('[Onboarding] Claude OAuth successful')
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
