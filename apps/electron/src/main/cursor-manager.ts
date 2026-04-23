/**
 * Cursor Manager
 *
 * Owns the Cursor provider's lifecycle in the Electron main process:
 *   1. Starts the local OpenAI-compatible proxy on demand (single shared
 *      instance, lazily bound to the first port available on 127.0.0.1).
 *   2. Holds the current Cursor OAuth access token in memory and refreshes
 *      it via api2.cursor.sh/auth/exchange_user_api_key when it expires.
 *   3. Handles the PKCE OAuth flow end-to-end — generating the auth URL,
 *      opening it in the user's browser, polling /auth/poll for tokens,
 *      and persisting tokens via the shared CredentialManager.
 *   4. Registers the proxy's base URL and token provider so Craft's
 *      `cursor` connection can reach Cursor's gRPC through the proxy.
 *
 * The ported provider internals live in @craft-agent/cursor-provider and
 * are deliberately self-contained: auth.ts, proxy.ts, and h2-bridge.mjs
 * have no dependency on Electron, Craft's RPC layer, or any "pi"
 * extension API — they are plain Node/Bun modules.
 */

import { shell } from 'electron'
import {
  generateCursorAuthParams,
  pollCursorAuth,
  refreshCursorToken,
  getTokenExpiry,
  startProxy,
  stopProxy,
  getProxyPort,
  getCursorModels,
  cleanupAllSessionState,
  cleanupSessionState,
  processModels,
  buildModelDefinitions,
  FALLBACK_MODELS,
} from '@craft-agent/cursor-provider'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import {
  addLlmConnection,
  getLlmConnection,
  updateLlmConnection,
} from '@craft-agent/shared/config'
import type { ModelDefinition } from '@craft-agent/shared/config/models'
import { createBuiltInConnection } from '@craft-agent/server-core/domain'
import log from './logger'

/** Stable slug used by the built-in Cursor connection. */
export const CURSOR_CONNECTION_SLUG = 'cursor'

/** Active PKCE flow, tracked so callers can cancel mid-browse. */
interface PendingFlow {
  uuid: string
  verifier: string
  loginUrl: string
  abort: AbortController
}

let proxyReady: Promise<number> | null = null
let currentAccessToken = ''
let currentRefreshToken = ''
let currentExpiresAt = 0
let pendingFlow: PendingFlow | null = null
let credsLoaded = false

/** True once a valid access token is held in memory. */
export function hasCursorAccessToken(): boolean {
  return currentAccessToken !== ''
}

/**
 * Start (or reuse) the local Cursor proxy.
 * Returns the bound 127.0.0.1 port. The proxy is lazy — it only touches
 * Cursor's API when a request arrives, so it's safe to eagerly start it
 * before OAuth completes.
 */
export async function ensureCursorProxyStarted(): Promise<number> {
  if (!proxyReady) {
    proxyReady = startProxy(async () => {
      await ensureValidAccessToken()
      if (!currentAccessToken) {
        throw new Error('Not logged in to Cursor — complete the Cursor OAuth flow first.')
      }
      return currentAccessToken
    })
  }
  return proxyReady
}

/** Base URL the connection template should point at (http://127.0.0.1:<port>/v1). */
export async function getCursorProxyBaseUrl(): Promise<string> {
  const port = await ensureCursorProxyStarted()
  return `http://127.0.0.1:${port}/v1`
}

/** Best-effort — returns undefined if the proxy hasn't been started yet. */
export function getCursorProxyBaseUrlSync(): string | undefined {
  const port = getProxyPort()
  return port ? `http://127.0.0.1:${port}/v1` : undefined
}

/**
 * Called from the Electron main process on boot. If the user is already
 * logged in, make sure the `cursor` connection is present and pointing at
 * a freshly-started proxy (the port is chosen each run).
 */
export async function initCursorOnStartup(): Promise<void> {
  try {
    await loadCredentialsFromStore()
    if (!currentAccessToken) return
    await ensureCursorProxyStarted()
    await upsertCursorConnection()
  } catch (err) {
    log.warn('[cursor] Startup init failed (non-fatal):', err)
  }
}

// ── Credential hydration ──

async function loadCredentialsFromStore(): Promise<void> {
  if (credsLoaded) return
  try {
    const creds = await getCredentialManager().getLlmOAuth(CURSOR_CONNECTION_SLUG)
    if (creds?.accessToken) {
      currentAccessToken = creds.accessToken
      currentRefreshToken = creds.refreshToken ?? ''
      currentExpiresAt = creds.expiresAt ?? getTokenExpiry(creds.accessToken)
    }
  } catch (err) {
    log.warn('[cursor] Failed to hydrate credentials from store:', err)
  } finally {
    credsLoaded = true
  }
}

async function persistCredentials(): Promise<void> {
  try {
    await getCredentialManager().setLlmOAuth(CURSOR_CONNECTION_SLUG, {
      accessToken: currentAccessToken,
      refreshToken: currentRefreshToken || undefined,
      expiresAt: currentExpiresAt || undefined,
    })
  } catch (err) {
    log.warn('[cursor] Failed to persist credentials:', err)
  }
}

/**
 * Create or refresh the `cursor` LlmConnection so it's picked up by the
 * connection selector. Always sets baseUrl to the currently-running proxy
 * URL because the port is dynamic (OS-assigned at listen time).
 */
async function upsertCursorConnection(): Promise<void> {
  const baseUrl = await getCursorProxyBaseUrl()

  const existing = getLlmConnection(CURSOR_CONNECTION_SLUG)
  if (!existing) {
    const connection = createBuiltInConnection(CURSOR_CONNECTION_SLUG, baseUrl)
    try {
      const models = await listCursorModels()
      connection.models = models
      if (models.length > 0 && !connection.defaultModel) {
        connection.defaultModel = models[0]!.id
      }
    } catch (err) {
      log.warn('[cursor] Could not fetch models when creating connection:', err)
    }
    connection.baseUrl = baseUrl
    addLlmConnection(connection)
    log.info(`[cursor] Added built-in connection at ${baseUrl}`)
    return
  }

  const updates: Record<string, unknown> = { baseUrl }
  try {
    const models = await listCursorModels()
    if (models.length > 0) {
      updates.models = models
      if (!existing.defaultModel) updates.defaultModel = models[0]!.id
    }
  } catch (err) {
    log.warn('[cursor] Could not refresh models on connection update:', err)
  }
  updateLlmConnection(CURSOR_CONNECTION_SLUG, updates as any)
}

async function ensureValidAccessToken(): Promise<void> {
  await loadCredentialsFromStore()

  const now = Date.now()
  const needsRefresh =
    currentAccessToken && currentExpiresAt > 0 && now >= currentExpiresAt

  if (!needsRefresh) return
  if (!currentRefreshToken) return

  try {
    const refreshed = await refreshCursorToken(currentRefreshToken)
    currentAccessToken = refreshed.access
    currentRefreshToken = refreshed.refresh
    currentExpiresAt = refreshed.expires
    await persistCredentials()
    log.info('[cursor] Refreshed access token via exchange_user_api_key')
  } catch (err) {
    log.warn('[cursor] Token refresh failed:', err)
  }
}

// ── OAuth flow (public API used by RPC handlers) ──

export interface CursorOAuthStartResult {
  loginUrl: string
  flowId: string
}

/**
 * Begin an OAuth flow: generate PKCE params, open the browser to Cursor's
 * login page, and return the URL so the renderer can also surface a link.
 * A second call cancels any flow already in progress.
 */
export async function startCursorOAuth(): Promise<CursorOAuthStartResult> {
  cancelCursorOAuth()

  const { verifier, uuid, loginUrl } = await generateCursorAuthParams()
  const flow: PendingFlow = { uuid, verifier, loginUrl, abort: new AbortController() }
  pendingFlow = flow

  try {
    await shell.openExternal(loginUrl)
  } catch (err) {
    log.warn('[cursor] Failed to open browser for OAuth:', err)
  }

  // Poll in the background. pollCursorAuth retries with backoff for up to
  // ~25 minutes; the result is surfaced via getCursorAuthStatus().
  void (async () => {
    try {
      const tokens = await pollCursorAuth(uuid, verifier)
      if (flow.abort.signal.aborted) return
      currentAccessToken = tokens.accessToken
      currentRefreshToken = tokens.refreshToken
      currentExpiresAt = getTokenExpiry(tokens.accessToken)
      await persistCredentials()
      log.info('[cursor] OAuth completed — credentials stored')

      try {
        await upsertCursorConnection()
      } catch (err) {
        log.warn('[cursor] Failed to upsert connection after OAuth:', err)
      }
    } catch (err) {
      if (flow.abort.signal.aborted) return
      log.warn('[cursor] OAuth polling failed:', err)
    } finally {
      if (pendingFlow === flow) pendingFlow = null
    }
  })()

  return { loginUrl, flowId: uuid }
}

export function cancelCursorOAuth(): void {
  if (pendingFlow) {
    pendingFlow.abort.abort()
    pendingFlow = null
  }
}

export interface CursorAuthStatus {
  authenticated: boolean
  expiresAt?: number
  hasRefreshToken?: boolean
  pendingLoginUrl?: string
}

export async function getCursorAuthStatus(): Promise<CursorAuthStatus> {
  await loadCredentialsFromStore()
  return {
    authenticated: !!currentAccessToken,
    expiresAt: currentExpiresAt || undefined,
    hasRefreshToken: !!currentRefreshToken,
    pendingLoginUrl: pendingFlow?.loginUrl,
  }
}

export async function logoutCursor(): Promise<void> {
  cancelCursorOAuth()
  currentAccessToken = ''
  currentRefreshToken = ''
  currentExpiresAt = 0
  try {
    await getCredentialManager().deleteLlmCredentials(CURSOR_CONNECTION_SLUG)
  } catch (err) {
    log.warn('[cursor] Failed to delete credentials on logout:', err)
  }
  cleanupAllSessionState()
}

// ── Model discovery (used by model fetcher) ──

/**
 * Return Cursor's full model catalog as Craft `ModelDefinition` entries.
 * Falls back to the bundled snapshot when the user is not yet
 * authenticated or model discovery fails.
 */
export async function listCursorModels(): Promise<ModelDefinition[]> {
  await loadCredentialsFromStore()
  const raw = currentAccessToken
    ? (await getCursorModels(currentAccessToken).catch(() => [])) || []
    : []
  const source = raw.length > 0 ? raw : FALLBACK_MODELS
  return buildModelDefinitions(processModels(source)).map((m) => ({
    id: m.id,
    name: m.name,
    shortName: m.shortName,
    description: `${m.name} via Cursor`,
    provider: 'pi',
    contextWindow: m.contextWindow,
    // Only advertise thinking support when the model was dedup-collapsed
    // from multiple effort variants (m.supportsReasoningEffort tracks that
    // exact condition in cursor-provider/models.ts — it mirrors the
    // internal supportsEffort flag the dedup sets when ≥2 effort levels
    // were collapsed into one logical ID). Using m.supportsReasoning here
    // was too loose: it's true for any model in a reasoning-family prefix
    // (claude/gpt/gemini/grok/kimi) regardless of whether Cursor actually
    // exposes effort-suffixed variants. Single-variant entries like
    // gemini-3-flash and composer-2 are valid bare IDs in Cursor's
    // catalog; advertising thinking support on them made Pi send
    // reasoning_effort, which made the proxy rewrite to a non-existent
    // "gemini-3-flash-high" / "composer-2-medium", and Cursor returned
    // "not_found". Keeping supportsThinking aligned with "has an actual
    // reasoningEffortMap" keeps the request shape honest per model.
    supportsThinking: m.supportsReasoningEffort,
    ...(m.reasoningEffortMap
      ? { reasoningEffortMap: m.reasoningEffortMap }
      : {}),
  }))
}

// ── Lifecycle ──

export function shutdownCursorManager(): void {
  cancelCursorOAuth()
  try {
    stopProxy()
  } catch (err) {
    log.warn('[cursor] Failed to stop proxy cleanly:', err)
  }
  proxyReady = null
}

export { cleanupSessionState as cleanupCursorSession }
