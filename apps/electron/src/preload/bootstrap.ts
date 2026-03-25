/**
 * WS-mode preload — replaces the full IPC preload (index.ts).
 *
 * 1. Gets port + token from main via ipcRenderer.sendSync
 * 2. Creates WsRpcClient → connects to local WS server
 * 3. Builds the full ElectronAPI proxy via buildClientApi + CHANNEL_MAP
 * 4. Attaches performOAuth (multi-step orchestration, runs client-side)
 * 5. Exposes as window.electronAPI via contextBridge
 *
 * On localhost the WS handshake completes in <1ms. The React app takes >100ms
 * to initialise, so by the time any component calls an API method, the
 * connection is established.
 */

import '@sentry/electron/preload'
import { contextBridge, ipcRenderer, shell } from 'electron'
import { WsRpcClient, type TransportConnectionState } from '../transport/client'
import { buildClientApi } from '../transport/build-api'
import { CHANNEL_MAP } from '../transport/channel-map'
import { WorkspaceTransportBroker } from './workspace-transport-broker'
import type { WorkspaceCreationTarget } from '../shared/types'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  getRemoteServerProfiles as getLocalRemoteServerProfiles,
  saveRemoteServerProfile as saveLocalRemoteServerProfile,
  deleteRemoteServerProfile as deleteLocalRemoteServerProfile,
} from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { createCallbackServer } from '@craft-agent/shared/auth/callback-server'
import { CHATGPT_OAUTH_CONFIG } from '@craft-agent/shared/auth/chatgpt-oauth-config'
import {
  CLIENT_OPEN_EXTERNAL,
  CLIENT_OPEN_PATH,
  CLIENT_SHOW_IN_FOLDER,
  CLIENT_CONFIRM_DIALOG,
  CLIENT_OPEN_FILE_DIALOG,
  LOCAL_CLIENT_CAPABILITIES,
} from '@craft-agent/server-core/transport'
import type { ConfirmDialogSpec, FileDialogSpec } from '@craft-agent/server-core/transport'
import type { ElectronAPI } from '../shared/types'

// Connection details — from env (remote server) or main process (local)
let wsUrl: string
let wsToken: string
let webContentsId: number
let workspaceId: string
let wsMode: 'local' | 'remote'

if (process.env.CRAFT_SERVER_URL) {
  // Remote mode — connect to an external server
  wsMode = 'remote'
  wsUrl = process.env.CRAFT_SERVER_URL
  wsToken = process.env.CRAFT_SERVER_TOKEN ?? ''

  // Block unencrypted ws:// to non-localhost servers — tokens would be sent in cleartext
  const parsed = new URL(wsUrl)
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1'
  if (parsed.protocol === 'ws:' && !isLocalhost) {
    throw new Error(
      `Refusing to connect to remote server over unencrypted ws://. ` +
      `Use wss:// (TLS) for non-localhost connections. ` +
      `Set CRAFT_RPC_TLS_CERT/KEY on the server to enable TLS.`
    )
  }
  webContentsId = ipcRenderer.sendSync('__get-web-contents-id')
  workspaceId = process.env.CRAFT_WORKSPACE_ID ?? ipcRenderer.sendSync('__get-workspace-id')
} else {
  // Local mode — get connection details from main process (synchronous, runs during preload eval)
  wsMode = 'local'
  wsUrl = `ws://127.0.0.1:${ipcRenderer.sendSync('__get-ws-port')}`
  wsToken = ipcRenderer.sendSync('__get-ws-token')
  webContentsId = ipcRenderer.sendSync('__get-web-contents-id')
  workspaceId = ipcRenderer.sendSync('__get-workspace-id')
}

// Create WS client and connect immediately
const client = new WsRpcClient(wsUrl, {
  token: wsToken,
  workspaceId,
  webContentsId,
  autoReconnect: true,
  mode: wsMode,
  clientCapabilities: [...LOCAL_CLIENT_CAPABILITIES],
})

// Register client-side capability handlers (server can invoke these)
// shell.openExternal / openPath / showItemInFolder are available in both main and renderer.
// dialog / BrowserWindow are main-process-only — bridged via ipcRenderer.invoke.
client.handleCapability(CLIENT_OPEN_EXTERNAL, (url: string) => shell.openExternal(url))

client.handleCapability(CLIENT_OPEN_PATH, async (path: string) => {
  const error = await shell.openPath(path)
  return { error: error || undefined }
})

client.handleCapability(CLIENT_SHOW_IN_FOLDER, (path: string) => {
  shell.showItemInFolder(path)
})

client.handleCapability(CLIENT_CONFIRM_DIALOG, async (spec: ConfirmDialogSpec) => {
  // dialog.showMessageBox is main-process-only — bridge via ipcRenderer
  return await ipcRenderer.invoke('__dialog:showMessageBox', spec)
})

client.handleCapability(CLIENT_OPEN_FILE_DIALOG, async (spec: FileDialogSpec) => {
  // dialog.showOpenDialog is main-process-only — bridge via ipcRenderer
  return await ipcRenderer.invoke('__dialog:showOpenDialog', spec)
})

client.connect()

// Build the full ElectronAPI proxy — identical shape to the IPC preload.
// Methods return promises (via client.invoke), listeners return unsubscribe fns.
let api = buildClientApi(client, CHANNEL_MAP, (ch) => client.isChannelAvailable(ch))
let broker: WorkspaceTransportBroker | null = null
let validateDirectCreationTarget: ((target: WorkspaceCreationTarget, operation: string) => Promise<void>) | null = null

if (wsMode === 'local') {
  broker = new WorkspaceTransportBroker(api, client, workspaceId)
  api = broker.install()
}

if (!broker) {
  let matchedDirectRemoteServerIdPromise: Promise<string | null> | null = null
  const directRemoteServerListeners = new Set<() => void>()
  const emitDirectRemoteServersChanged = () => {
    for (const listener of directRemoteServerListeners) {
      try {
        listener()
      } catch {
        // Ignore renderer listener errors.
      }
    }
  }

  const getMatchedDirectRemoteServerId = async (): Promise<string | null> => {
    if (wsMode !== 'remote') return null
    if (!matchedDirectRemoteServerIdPromise) {
      matchedDirectRemoteServerIdPromise = (async () => {
        const normalizeUrl = (value: string) => {
          try {
            const parsed = new URL(value)
            parsed.hash = ''
            parsed.search = ''
            return parsed.toString().replace(/\/+$/, '')
          } catch {
            return value.replace(/\/+$/, '')
          }
        }

        const profiles = await (api as any).listRemoteServers()
        const currentUrl = normalizeUrl(wsUrl)
        return profiles.find((profile: { id: string; url: string }) => normalizeUrl(profile.url) === currentUrl)?.id ?? null
      })()
    }
    return matchedDirectRemoteServerIdPromise
  }

  const assertDirectTargetSupported = async (target: WorkspaceCreationTarget, operation: string): Promise<void> => {
    if (wsMode === 'local') {
      if (target.mode !== 'local') {
        throw new Error(`${operation} is only available for local targets in desktop mode`)
      }
      return
    }

    if (target.mode !== 'remote') {
      throw new Error(`${operation} is only available for the connected remote server in direct remote mode`)
    }

    if (!target.serverId) return

    const matchedServerId = await getMatchedDirectRemoteServerId()
    if (!matchedServerId || target.serverId !== matchedServerId) {
      throw new Error(`${operation} cannot target a different server in direct remote mode`)
    }
  }
  validateDirectCreationTarget = assertDirectTargetSupported

  ;(api as any).listRemoteServers = async () => {
    return await getLocalRemoteServerProfiles()
  }
  ;(api as any).saveRemoteServerProfile = async (input: any) => {
    const saved = await saveLocalRemoteServerProfile(input)
    matchedDirectRemoteServerIdPromise = null
    emitDirectRemoteServersChanged()
    return saved
  }
  ;(api as any).deleteRemoteServerProfile = async (serverId: string) => {
    const deleted = await deleteLocalRemoteServerProfile(serverId)
    matchedDirectRemoteServerIdPromise = null
    if (deleted) {
      emitDirectRemoteServersChanged()
    }
    return deleted
  }
  ;(api as any).saveRemoteServerToken = async (serverId: string, token: string) => {
    await getCredentialManager().setRemoteServerToken(serverId, token)
    matchedDirectRemoteServerIdPromise = null
    emitDirectRemoteServersChanged()
  }
  ;(api as any).clearRemoteServerToken = async (serverId: string) => {
    await getCredentialManager().deleteRemoteServerToken(serverId)
    matchedDirectRemoteServerIdPromise = null
    emitDirectRemoteServersChanged()
  }
  ;(api as any).getRemoteServerRuntimeStates = async () => ({})
  ;(api as any).onRemoteServersChanged = (callback: () => void) => {
    directRemoteServerListeners.add(callback)
    return () => {
      directRemoteServerListeners.delete(callback)
    }
  }

  ;(api as any).createWorkspaceAtTarget = async (target: WorkspaceCreationTarget, folderPath: string, name: string, options?: { managedByApp?: boolean }) => {
    await assertDirectTargetSupported(target, 'Workspace creation')
    return (api as any).createWorkspace(folderPath, name, options)
  }
  ;(api as any).checkWorkspaceSlugAtTarget = async (target: WorkspaceCreationTarget, slug: string) => {
    await assertDirectTargetSupported(target, 'Workspace slug validation')
    return (api as any).checkWorkspaceSlug(slug)
  }
  ;(api as any).getHomeDirForTarget = async (target: WorkspaceCreationTarget) => {
    await assertDirectTargetSupported(target, 'Home directory lookup')
    return (api as any).getHomeDir()
  }
  ;(api as any).listServerDirectoryForTarget = async (target: WorkspaceCreationTarget, dirPath: string) => {
    await assertDirectTargetSupported(target, 'Server directory browsing')
    return (api as any).listServerDirectory(dirPath)
  }
  ;(api as any).listLlmConnectionsForTarget = async (target: WorkspaceCreationTarget) => {
    await assertDirectTargetSupported(target, 'LLM connection listing')
    return (api as any).listLlmConnections()
  }
  ;(api as any).listLlmConnectionsWithStatusForTarget = async (target: WorkspaceCreationTarget) => {
    await assertDirectTargetSupported(target, 'LLM connection listing')
    return (api as any).listLlmConnectionsWithStatus()
  }
  ;(api as any).getLlmConnectionForTarget = async (target: WorkspaceCreationTarget, slug: string) => {
    await assertDirectTargetSupported(target, 'LLM connection lookup')
    return (api as any).getLlmConnection(slug)
  }
  ;(api as any).getLlmConnectionApiKeyForTarget = async (target: WorkspaceCreationTarget, slug: string) => {
    await assertDirectTargetSupported(target, 'LLM API key lookup')
    return (api as any).getLlmConnectionApiKey(slug)
  }
  ;(api as any).saveLlmConnectionForTarget = async (target: WorkspaceCreationTarget, connection: any) => {
    await assertDirectTargetSupported(target, 'LLM connection save')
    return (api as any).saveLlmConnection(connection)
  }
  ;(api as any).deleteLlmConnectionForTarget = async (target: WorkspaceCreationTarget, slug: string) => {
    await assertDirectTargetSupported(target, 'LLM connection delete')
    return (api as any).deleteLlmConnection(slug)
  }
  ;(api as any).testLlmConnectionForTarget = async (target: WorkspaceCreationTarget, slug: string) => {
    await assertDirectTargetSupported(target, 'LLM connection test')
    return (api as any).testLlmConnection(slug)
  }
  ;(api as any).setDefaultLlmConnectionForTarget = async (target: WorkspaceCreationTarget, slug: string) => {
    await assertDirectTargetSupported(target, 'LLM default selection')
    return (api as any).setDefaultLlmConnection(slug)
  }
  ;(api as any).getDefaultThinkingLevelForTarget = async (target: WorkspaceCreationTarget) => {
    await assertDirectTargetSupported(target, 'Default thinking level lookup')
    return (api as any).getDefaultThinkingLevel()
  }
  ;(api as any).setDefaultThinkingLevelForTarget = async (target: WorkspaceCreationTarget, level: any) => {
    await assertDirectTargetSupported(target, 'Default thinking level save')
    return (api as any).setDefaultThinkingLevel(level)
  }
  ;(api as any).shareLlmConnectionToTarget = async () => {
    throw new Error('Cross-target sharing is only available in desktop mode')
  }
  ;(api as any).shareSourceToWorkspace = async () => {
    throw new Error('Cross-target sharing is only available in desktop mode')
  }
  ;(api as any).shareSkillToWorkspace = async () => {
    throw new Error('Cross-target sharing is only available in desktop mode')
  }
}

const invokeTarget = (channel: string, ...args: any[]) => {
  if (broker) {
    return broker.invokeOnActiveTarget(channel, ...args)
  }
  return client.invoke(channel, ...args)
}

const invokeCreationTarget = async (target: WorkspaceCreationTarget, channel: string, ...args: any[]) => {
  if (broker) {
    return broker.invokeOnTarget(target, channel, ...args)
  }
  if (validateDirectCreationTarget) {
    await validateDirectCreationTarget(target, channel)
  }
  return client.invoke(channel, ...args)
}

const listenCreationTarget = async (
  target: WorkspaceCreationTarget,
  channel: string,
  callback: (...args: any[]) => void,
) => {
  if (broker) {
    return broker.listenOnTarget(target, channel, callback)
  }
  if (validateDirectCreationTarget) {
    await validateDirectCreationTarget(target, channel)
  }
  return client.on(channel, callback)
}

function formatTransportReason(state: TransportConnectionState): string {
  const err = state.lastError
  if (err) {
    const codePart = err.code ? ` [${err.code}]` : ''
    return `${err.kind}${codePart}: ${err.message}`
  }

  if (state.lastClose?.code != null) {
    const reason = state.lastClose.reason ? ` (${state.lastClose.reason})` : ''
    return `close ${state.lastClose.code}${reason}`
  }

  return 'no additional details'
}

if (wsMode === 'remote') {
  client.onConnectionStateChanged((state) => {
    const emitToMain = (level: 'info' | 'warn' | 'error', message: string) => {
      ipcRenderer.send('__transport:status', {
        level,
        message,
        status: state.status,
        attempt: state.attempt,
        nextRetryInMs: state.nextRetryInMs,
        error: state.lastError,
        close: state.lastClose,
        url: state.url,
      })
    }

    if (state.status === 'connected') {
      const message = `[transport] connected to ${state.url}`
      console.info(message)
      emitToMain('info', message)
      return
    }

    if (state.status === 'reconnecting') {
      const retry = state.nextRetryInMs != null ? ` retry in ${state.nextRetryInMs}ms` : ''
      const message = `[transport] reconnecting (attempt ${state.attempt})${retry} — ${formatTransportReason(state)}`
      console.warn(message)
      emitToMain('warn', message)
      return
    }

    if (state.status === 'failed' || state.status === 'disconnected') {
      const message = `[transport] ${state.status} — ${formatTransportReason(state)}`
      console.error(message)
      emitToMain('error', message)
    }
  })
  ;(api as any).getTransportConnectionState = async () => client.getConnectionState()
  ;(api as any).onTransportConnectionStateChanged = (callback: (state: TransportConnectionState) => void) => {
    return client.onConnectionStateChanged(callback)
  }
  ;(api as any).reconnectTransport = async () => {
    client.reconnectNow()
  }
}

// ── performOAuth ─────────────────────────────────────────────────────────
// Multi-step orchestration: callback server (local) → oauth:start (server) →
// open browser → wait for callback → oauth:complete (server).
// Runs client-side because the callback server must receive the redirect.
;(api as any).performOAuth = async (args: {
  sourceSlug: string
  sessionId?: string
  authRequestId?: string
}): Promise<{ success: boolean; error?: string; email?: string }> => {
  let callbackServer: Awaited<ReturnType<typeof createCallbackServer>> | null = null
  let flowId: string | undefined
  let state: string | undefined

  try {
    // 1. Start local callback server to receive OAuth redirect
    callbackServer = await createCallbackServer({ appType: 'electron' })
    const port = parseInt(new URL(callbackServer.url).port, 10)

    // 2. Ask server to prepare the flow (PKCE, auth URL, store in flow store)
    const startResult = await invokeTarget('oauth:start', {
      sourceSlug: args.sourceSlug,
      callbackPort: port,
      sessionId: args.sessionId,
      authRequestId: args.authRequestId,
    })
    flowId = startResult.flowId
    state = startResult.state

    // 3. Open browser for user consent (local — must open on the user's machine, not remote server)
    await shell.openExternal(startResult.authUrl)

    // 4. Wait for OAuth provider to redirect to our callback server
    const callback = await callbackServer.promise

    // 5. Check for errors from the provider
    if (callback.query.error) {
      const error = callback.query.error_description || callback.query.error
      await invokeTarget('oauth:cancel', { flowId, state })
      return { success: false, error }
    }

    const code = callback.query.code
    if (!code) {
      await invokeTarget('oauth:cancel', { flowId, state })
      return { success: false, error: 'No authorization code received' }
    }

    // 6. Send code to server for token exchange + credential storage
    const result = await invokeTarget('oauth:complete', { flowId, code, state })
    return { success: result.success, error: result.error, email: result.email }
  } catch (err) {
    // Clean up server-side flow on error
    if (flowId && state) {
      invokeTarget('oauth:cancel', { flowId, state }).catch(() => {})
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'OAuth flow failed',
    }
  } finally {
    callbackServer?.close()
  }
}

// ── startClaudeOAuth ─────────────────────────────────────────────────────
// Override the channel-map stub: the server now returns authUrl without opening
// the browser. We open it locally so it works in remote mode.
// Claude OAuth is two-step: browser opens → user copies code → pastes in UI.
;(api as any).startClaudeOAuthForTarget = async (
  target: WorkspaceCreationTarget,
): Promise<{
  success: boolean
  authUrl?: string
  error?: string
}> => {
  try {
    const result = await invokeCreationTarget(target, RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH)
    if (result.success && result.authUrl) {
      await shell.openExternal(result.authUrl)
    }
    return result
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Claude OAuth failed',
    }
  }
}
;(api as any).startClaudeOAuth = async (): Promise<{
  success: boolean
  authUrl?: string
  error?: string
}> => {
  try {
    const result = await invokeTarget(RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH)
    if (result.success && result.authUrl) {
      await shell.openExternal(result.authUrl)
    }
    return result
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Claude OAuth failed',
    }
  }
}
;(api as any).exchangeClaudeCodeForTarget = async (
  target: WorkspaceCreationTarget,
  code: string,
  connectionSlug: string,
) => invokeCreationTarget(target, RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE, code, connectionSlug)
;(api as any).clearClaudeOAuthStateForTarget = async (target: WorkspaceCreationTarget) => {
  return invokeCreationTarget(target, RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE)
}
;(api as any).setupLlmConnectionForTarget = async (target: WorkspaceCreationTarget, setup: any) => {
  return invokeCreationTarget(target, RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, setup)
}
;(api as any).testLlmConnectionSetupForTarget = async (target: WorkspaceCreationTarget, params: any) => {
  return invokeCreationTarget(target, RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, params)
}

// ── performChatGptOAuth ──────────────────────────────────────────────────
// Same shape as performOAuth: callback server (port 1455) → chatgpt:startOAuth →
// browser → callback → chatgpt:completeOAuth.
// Overrides the startChatGptOAuth API method so the renderer call is unchanged.
;(api as any).startChatGptOAuthForTarget = async (
  target: WorkspaceCreationTarget,
  connectionSlug: string,
): Promise<{ success: boolean; error?: string }> => {
  let callbackServer: Awaited<ReturnType<typeof createCallbackServer>> | null = null
  let flowId: string | undefined
  let state: string | undefined

  try {
    callbackServer = await createCallbackServer({
      appType: 'electron',
      port: CHATGPT_OAUTH_CONFIG.CALLBACK_PORT,
      callbackPaths: ['/auth/callback'],
    })

    const startResult = await invokeCreationTarget(target, RPC_CHANNELS.chatgpt.START_OAUTH, connectionSlug)
    flowId = startResult.flowId
    state = startResult.state

    await shell.openExternal(startResult.authUrl)

    const callback = await callbackServer.promise

    if (callback.query.error) {
      const error = callback.query.error_description || callback.query.error
      await invokeCreationTarget(target, RPC_CHANNELS.chatgpt.CANCEL_OAUTH, { state })
      return { success: false, error }
    }

    const code = callback.query.code
    if (!code) {
      await invokeCreationTarget(target, RPC_CHANNELS.chatgpt.CANCEL_OAUTH, { state })
      return { success: false, error: 'No authorization code received' }
    }

    const result = await invokeCreationTarget(target, RPC_CHANNELS.chatgpt.COMPLETE_OAUTH, { flowId, code, state })
    return { success: result.success, error: result.error }
  } catch (err) {
    if (state) {
      invokeCreationTarget(target, RPC_CHANNELS.chatgpt.CANCEL_OAUTH, { state }).catch(() => {})
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'ChatGPT OAuth flow failed',
    }
  } finally {
    callbackServer?.close()
  }
}
;(api as any).startChatGptOAuth = async (
  connectionSlug: string,
): Promise<{ success: boolean; error?: string }> => {
  let callbackServer: Awaited<ReturnType<typeof createCallbackServer>> | null = null
  let flowId: string | undefined
  let state: string | undefined

  try {
    // 1. Start callback server on ChatGPT's fixed port with /auth/callback path
    callbackServer = await createCallbackServer({
      appType: 'electron',
      port: CHATGPT_OAUTH_CONFIG.CALLBACK_PORT,
      callbackPaths: ['/auth/callback'],
    })

    // 2. Ask server to prepare the flow (PKCE, auth URL, store pending flow)
    const startResult = await invokeTarget('chatgpt:startOAuth', connectionSlug)
    flowId = startResult.flowId
    state = startResult.state

    // 3. Open browser for user consent
    await shell.openExternal(startResult.authUrl)

    // 4. Wait for OpenAI to redirect to our callback server
    const callback = await callbackServer.promise

    // 5. Check for errors from the provider
    if (callback.query.error) {
      const error = callback.query.error_description || callback.query.error
      await invokeTarget('chatgpt:cancelOAuth', { state })
      return { success: false, error }
    }

    const code = callback.query.code
    if (!code) {
      await invokeTarget('chatgpt:cancelOAuth', { state })
      return { success: false, error: 'No authorization code received' }
    }

    // 6. Send code to server for token exchange + credential storage
    const result = await invokeTarget('chatgpt:completeOAuth', { flowId, code, state })
    return { success: result.success, error: result.error }
  } catch (err) {
    if (state) {
      invokeTarget('chatgpt:cancelOAuth', { state }).catch(() => {})
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'ChatGPT OAuth flow failed',
    }
  } finally {
    callbackServer?.close()
  }
}
;(api as any).startCopilotOAuthForTarget = async (
  target: WorkspaceCreationTarget,
  connectionSlug: string,
  onDeviceCode?: (data: { userCode: string; verificationUri: string }) => void,
): Promise<{ success: boolean; error?: string }> => {
  const cleanup = await listenCreationTarget(target, RPC_CHANNELS.copilot.DEVICE_CODE, (data: { userCode: string; verificationUri: string }) => {
    onDeviceCode?.(data)
  })

  try {
    return await invokeCreationTarget(target, RPC_CHANNELS.copilot.START_OAUTH, connectionSlug)
  } finally {
    cleanup()
  }
}

// System warnings — expose env-based flags set during main process startup
// (preload-only: reads env var directly, no IPC round-trip needed)
;(api as ElectronAPI).getSystemWarnings = async () => ({
  vcredistMissing: process.env.CRAFT_VCREDIST_MISSING === '1',
  downloadUrl: process.env.CRAFT_VCREDIST_URL,
})

contextBridge.exposeInMainWorld('electronAPI', api)
