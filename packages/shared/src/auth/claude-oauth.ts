/**
 * Native Claude OAuth with PKCE
 *
 * Implements browser-based OAuth using PKCE (Proof Key for Code Exchange) -
 * the standard secure flow for public clients (desktop/mobile apps) that
 * does not require a client secret.
 *
 * Based on: https://github.com/grll/claude-code-login
 */
import { randomBytes, createHash } from 'node:crypto'
import { CLAUDE_OAUTH_CONFIG } from './claude-oauth-config'

// Dynamic import for 'open' to handle ESM/CJS interop in bundled code
async function openUrl(url: string): Promise<void> {
  const open = await import('open')
  const openFn = open.default || open
  await openFn(url)
}

// OAuth configuration from shared config
const CLAUDE_CLIENT_ID = CLAUDE_OAUTH_CONFIG.CLIENT_ID
const CLAUDE_AUTH_URL = CLAUDE_OAUTH_CONFIG.AUTH_URL
const CLAUDE_TOKEN_URL = CLAUDE_OAUTH_CONFIG.TOKEN_URL
const REDIRECT_URI = CLAUDE_OAUTH_CONFIG.REDIRECT_URI
const OAUTH_SCOPES = CLAUDE_OAUTH_CONFIG.SCOPES
const STATE_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes

export interface ClaudeTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scopes?: string[]
}

export interface ClaudeOAuthState {
  state: string
  codeVerifier: string
  timestamp: number
  expiresAt: number
}

// In-memory state storage for the current OAuth flow
let currentOAuthState: ClaudeOAuthState | null = null

/**
 * Generate a secure random state parameter
 */
function generateState(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  return { codeVerifier, codeChallenge }
}

/**
 * Start the OAuth flow by generating the login URL and opening the browser
 *
 * Returns the authorization URL that was opened. The user will authenticate
 * and then need to copy the authorization code from the callback page.
 */
export async function startClaudeOAuth(
  onStatus?: (message: string) => void
): Promise<string> {
  onStatus?.('Generating authentication URL...')

  // Generate secure random values
  const state = generateState()
  const { codeVerifier, codeChallenge } = generatePKCE()

  // Store state for later verification
  const now = Date.now()
  currentOAuthState = {
    state,
    codeVerifier,
    timestamp: now,
    expiresAt: now + STATE_EXPIRY_MS,
  }

  // Build OAuth URL
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLAUDE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: OAUTH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  })

  const authUrl = `${CLAUDE_AUTH_URL}?${params.toString()}`

  // Open browser
  onStatus?.('Opening browser for authentication...')
  await openUrl(authUrl)

  onStatus?.('Waiting for you to copy the authorization code...')

  return authUrl
}

/**
 * Check if there is a valid OAuth state in progress
 */
export function hasValidOAuthState(): boolean {
  if (!currentOAuthState) return false
  return Date.now() < currentOAuthState.expiresAt
}

/**
 * Get the current OAuth state (for debugging/display)
 */
export function getCurrentOAuthState(): ClaudeOAuthState | null {
  return currentOAuthState
}

/**
 * Clear the current OAuth state
 */
export function clearOAuthState(): void {
  currentOAuthState = null
}

/**
 * Exchange an authorization code for tokens
 *
 * Call this after the user has authenticated and copied the authorization code
 * from the callback page.
 */
export async function exchangeClaudeCode(
  authorizationCode: string,
  onStatus?: (message: string) => void
): Promise<ClaudeTokens> {
  // Verify we have valid state
  if (!currentOAuthState) {
    throw new Error('No OAuth state found. Please start the authentication flow again.')
  }

  if (Date.now() > currentOAuthState.expiresAt) {
    clearOAuthState()
    throw new Error('OAuth state expired (older than 10 minutes). Please try again.')
  }

  // Clean up the authorization code in case it has URL fragments
  const cleanedCode = authorizationCode.split('#')[0]?.split('&')[0] ?? authorizationCode

  onStatus?.('Exchanging authorization code for tokens...')

  const params = {
    grant_type: 'authorization_code',
    client_id: CLAUDE_CLIENT_ID,
    code: cleanedCode,
    redirect_uri: REDIRECT_URI,
    code_verifier: currentOAuthState.codeVerifier,
    state: currentOAuthState.state,
  }

  try {
    const response = await fetch(CLAUDE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://claude.ai/',
        Origin: 'https://claude.ai',
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage: string
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.error_description || errorJson.error || errorText
      } catch {
        errorMessage = errorText
      }
      throw new Error(`Token exchange failed: ${response.status} - ${errorMessage}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      scope?: string
    }

    // Clear state after successful exchange
    clearOAuthState()

    onStatus?.('Authentication successful!')

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      scopes: data.scope ? data.scope.split(' ') : ['user:inference', 'user:profile'],
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error(`Token exchange failed: ${String(error)}`)
  }
}

/**
 * Convenience function that combines startClaudeOAuth and exchangeClaudeCode
 * for use cases where the code is provided via a callback
 *
 * @deprecated Use startClaudeOAuth and exchangeClaudeCode separately
 */
export async function authenticateWithClaude(options?: {
  onStatus?: (message: string) => void
  getAuthorizationCode: () => Promise<string>
}): Promise<ClaudeTokens> {
  const onStatus = options?.onStatus
  const getAuthorizationCode = options?.getAuthorizationCode

  if (!getAuthorizationCode) {
    throw new Error('getAuthorizationCode callback is required')
  }

  await startClaudeOAuth(onStatus)
  const code = await getAuthorizationCode()
  return exchangeClaudeCode(code, onStatus)
}
