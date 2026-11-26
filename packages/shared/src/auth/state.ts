/**
 * Unified Auth State Management
 *
 * Provides a single source of truth for all authentication state:
 * - Billing configuration (api_key or oauth_token)
 * - Workspace/MCP configuration
 *
 * MIGRATION NOTE (v0.3.0+):
 * We no longer support tokens from Claude CLI / Claude Desktop.
 * Users with legacy tokens will be prompted to re-authenticate using
 * our native OAuth flow. This is a one-time migration.
 */

import { getCredentialManager } from '../credentials/index.ts';
import {
  loadStoredConfig,
  getActiveWorkspace,
  getDefaultLlmConnection,
  getLlmConnection,
  getLlmConnections,
  type AuthType,
  type Workspace,
} from '../config/storage.ts';
import { refreshClaudeToken, isTokenExpired } from './claude-token.ts';
import { debug } from '../utils/debug.ts';

function toLegacyBillingType(
  authType: NonNullable<ReturnType<typeof getLlmConnection>>['authType'],
): AuthType {
  switch (authType) {
    case 'oauth':
      return 'oauth_token'
    case 'api_key':
    case 'api_key_with_endpoint':
    case 'bearer_token':
    case 'iam_credentials':
    case 'service_account_file':
    case 'environment':
    case 'none':
      return 'api_key'
  }
}

// ============================================
// Types
// ============================================

/** Migration info when user needs to re-authenticate */
export interface MigrationInfo {
  reason: 'legacy_token';
  message: string;
}

/** Result of token validation/refresh operations */
export interface TokenResult {
  accessToken: string | null;
  migrationRequired?: MigrationInfo;
  /**
   * The token expired and refreshing it failed for a reason that may pass
   * (network, timeout, 429, 5xx), so the credentials were kept: the refresh error.
   */
  transientRefreshError?: string;
}

export interface AuthState {
  /** Claude API billing configuration */
  billing: {
    /** Configured billing type, or null if not yet configured */
    type: AuthType | null;
    /** True if we have the required credentials for the configured billing type */
    hasCredentials: boolean;
    /** Anthropic API key (if using api_key auth type) */
    apiKey: string | null;
    /** Claude Max OAuth token (if using oauth_token auth type) */
    claudeOAuthToken: string | null;
    /** Migration info if user needs to re-authenticate */
    migrationRequired?: MigrationInfo;
  };

  /** Workspace/MCP configuration */
  workspace: {
    hasWorkspace: boolean;
    active: Workspace | null;
  };
}

export interface SetupNeeds {
  /** No billing type configured → show billing picker */
  needsBillingConfig: boolean;
  /** Billing type set but missing credentials → show credential entry */
  needsCredentials: boolean;
  /** Everything complete → go straight to App */
  isFullyConfigured: boolean;
  /** User has legacy tokens that need migration */
  needsMigration?: MigrationInfo;
}

// ============================================
// Token Refresh Mutex
// ============================================

// Per-connection mutex to prevent concurrent token refresh attempts.
// When a refresh is in progress for a connection, other callers for that same
// connection wait for it to complete. Keyed by slug so two Claude accounts
// never wait on (or read back) each other's refresh.
const refreshInProgress = new Map<string, Promise<TokenResult>>();

// ============================================
// Per-connection credentials
// ============================================

/** The Claude OAuth connections, from config.json unless a test passes them. */
export interface ClaudeOAuthConnections {
  /** The default LLM connection, the only one the legacy slot can belong to. */
  defaultSlug: string | null;
  /** Every Claude OAuth connection (Anthropic provider, OAuth auth). */
  slugs: string[];
  /** The account each connection signed in to (`oauthAccountUuid`), where its sign-in said. */
  accountUuids?: Record<string, string>;
}

function readClaudeOAuthConnections(): ClaudeOAuthConnections {
  const connections = getLlmConnections()
    .filter((connection) => connection.providerType === 'anthropic' && connection.authType === 'oauth');
  return {
    defaultSlug: getDefaultLlmConnection(),
    slugs: connections.map((connection) => connection.slug),
    accountUuids: Object.fromEntries(connections
      .filter((connection) => connection.oauthAccountUuid)
      .map((connection) => [connection.slug, connection.oauthAccountUuid!])),
  };
}

interface ClaudeOAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  source?: 'native' | 'cli';
  /** Read from the legacy global slot, not the connection's own entry. */
  fromLegacySlot: boolean;
}

/**
 * Whether a connection without credentials of its own may use the legacy global
 * `claude_oauth` slot. The slot predates per-connection credentials and every
 * sign-in used to overwrite it, so it can hold any account. Only the default
 * connection uses it (installs from before per-connection credentials), and
 * only while no other Claude connection has credentials of its own, since the
 * slot may then hold that connection's account.
 */
export async function usesLegacyClaudeOAuthSlot(
  manager: ReturnType<typeof getCredentialManager>,
  connectionSlug: string,
  connections: ClaudeOAuthConnections = readClaudeOAuthConnections(),
): Promise<boolean> {
  if (connections.defaultSlug !== connectionSlug) return false;
  for (const slug of connections.slugs) {
    if (slug !== connectionSlug && (await manager.getLlmOAuth(slug))?.accessToken) return false;
  }
  return true;
}

/**
 * Resolve the Claude OAuth credentials for one connection: its own
 * `llm_oauth::<slug>` entry, else the legacy slot if it may use it
 * (usesLegacyClaudeOAuthSlot).
 */
async function readClaudeOAuthCredentials(
  manager: ReturnType<typeof getCredentialManager>,
  connectionSlug: string,
  connections: ClaudeOAuthConnections,
): Promise<ClaudeOAuthCredentials | null> {
  const own = await manager.getLlmOAuth(connectionSlug);
  if (own?.accessToken) {
    return {
      accessToken: own.accessToken,
      refreshToken: own.refreshToken,
      expiresAt: own.expiresAt,
      source: 'native',
      fromLegacySlot: false,
    };
  }

  if (!(await usesLegacyClaudeOAuthSlot(manager, connectionSlug, connections))) {
    return null;
  }
  const legacy = await manager.getClaudeOAuthCredentials();
  return legacy?.accessToken ? { ...legacy, fromLegacySlot: true } : null;
}

/**
 * Give Claude connections back the refresh token and expiry of their sign-in.
 *
 * The connection setup used to replace what the sign-in had stored on the
 * connection with the bare access token, so the refresh token and expiry were
 * kept only in the legacy slot, which every sign-in overwrote. The connection
 * whose access token is still the one in the slot gets them back; any other
 * connection keeps what it has and signs in again once its token expires.
 * Runs at startup (`migrateLegacyCredentials`).
 */
export async function restoreClaudeOAuthRefreshTokens(
  manager: ReturnType<typeof getCredentialManager>,
  connections: ClaudeOAuthConnections = readClaudeOAuthConnections(),
): Promise<void> {
  const legacy = await manager.getClaudeOAuthCredentials();
  if (!legacy?.accessToken || !legacy.refreshToken) return;

  for (const slug of connections.slugs) {
    const own = await manager.getLlmOAuth(slug);
    if (own?.accessToken === legacy.accessToken && !own.refreshToken) {
      await manager.setLlmOAuth(slug, {
        accessToken: own.accessToken,
        refreshToken: legacy.refreshToken,
        expiresAt: legacy.expiresAt,
      });
      debug(`[auth] Restored the refresh token of Claude connection ${slug}`);
    }
  }
}

/**
 * Whether a refresh failure means the stored refresh token can never succeed again,
 * so its credentials should be cleared and the user asked to sign in.
 * Be conservative - network errors, timeouts and unknown errors keep the credentials,
 * and so does a 429 or 5xx answer, whatever its body says.
 */
export function isDeadRefreshTokenError(errorMessage: string): boolean {
  const status = /^Token refresh failed: (\d{3}) - /.exec(errorMessage)?.[1];
  if (status === '429' || status?.startsWith('5')) return false;
  return (
    // RFC 6749 §5.2: the refresh token is invalid, expired or revoked
    errorMessage.includes('invalid_grant') ||
    errorMessage.includes('Refresh token not found or invalid') ||
    // a description sent without its code, e.g. "400 - Refresh token expired"
    errorMessage.includes('Refresh token expired') ||
    errorMessage.includes('invalid_refresh_token')
  );
}

/**
 * Whether a refresh failure means the stored refresh token can never succeed again,
 * so its credentials should be cleared and the user asked to sign in.
 * Be conservative - network errors, timeouts and unknown errors keep the credentials.
 */
export function isDeadRefreshTokenError(errorMessage: string): boolean {
  return (
    errorMessage.includes('invalid_grant') ||
    errorMessage.includes('Refresh token not found or invalid') ||
    // refreshClaudeToken reports the server's error_description, e.g. "400 - Refresh token expired"
    errorMessage.includes('Refresh token expired') ||
    errorMessage.includes('invalid_refresh_token')
  );
}

/**
 * Perform the actual token refresh (internal, called only when holding mutex)
 * Returns TokenResult with accessToken and optional migrationRequired info
 *
 * `slots`: the new tokens go to the connection's own entry, and back to the
 * legacy slot when they were read from it. Dead credentials are cleared from
 * the connection, and from the legacy slot for the default connection only.
 * Tokens of another account than the connection signed in to
 * (`expectedAccountUuid`) are cleared the same way.
 */
export async function performTokenRefresh(
  manager: ReturnType<typeof getCredentialManager>,
  refreshToken: string,
  originalSource: 'native' | 'cli' | undefined,
  connectionSlug: string,
  slots: { isDefaultConnection: boolean; fromLegacySlot: boolean; expectedAccountUuid?: string },
): Promise<TokenResult> {
  try {
    const refreshed = await refreshClaudeToken(refreshToken);

    // Earlier versions refreshed every Claude connection from the legacy slot and
    // stored the result on the connection too, so a connection can hold the
    // tokens of whichever account signed in last. Signed out, it asks to sign in
    // again instead of running on that account. As for dead credentials below,
    // the default connection's legacy slot goes too: earlier versions filled it
    // with the same account, and the connection would fall back to it.
    if (slots.expectedAccountUuid && refreshed.accountUuid && refreshed.accountUuid !== slots.expectedAccountUuid) {
      debug(`[auth] Claude connection ${connectionSlug} held another account's tokens - signing it out`);
      if (slots.isDefaultConnection) await manager.delete({ type: 'claude_oauth' });
      await manager.deleteLlmCredentials(connectionSlug);
      return { accessToken: null };
    }

    // Format expiry time for logging
    const expiresAtDate = refreshed.expiresAt ? new Date(refreshed.expiresAt).toISOString() : 'never';
    debug(`[auth] Successfully refreshed Claude OAuth token (expires: ${expiresAtDate})`);

    // Store the new credentials on the connection that was refreshed.
    await manager.setLlmOAuth(connectionSlug, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
    });

    // Credentials read from the legacy slot go back there (backwards
    // compatibility). Other tokens never do: the default connection's fallback
    // would pick them up.
    // If refresh succeeded with our native endpoint, mark as 'native'
    // (successful refresh proves compatibility with our OAuth system)
    if (slots.fromLegacySlot) {
      await manager.setClaudeOAuthCredentials({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        source: 'native',
      });
    }

    return { accessToken: refreshed.accessToken };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug('[auth] Failed to refresh Claude OAuth token:', errorMessage);

    const isIncompatibleToken = isDeadRefreshTokenError(errorMessage);

    let migrationRequired: MigrationInfo | undefined;

    if (isIncompatibleToken) {
      // Token refresh failed - could be legacy CLI token or expired/revoked
      debug('[auth] Token refresh failed - credentials will be cleared');

      // Check if this was from CLI based on stored source
      const isFromCLI = originalSource === 'cli' || !originalSource;
      if (isFromCLI) {
        debug('[auth] Token was from CLI or unknown source - migration required');
        migrationRequired = {
          reason: 'legacy_token',
          message:
            'Your Claude authentication needs to be refreshed. ' +
            'Please sign in again.',
        };
      }

      // Clear the incompatible credentials to force fresh authentication.
      // The legacy slot goes with the default connection, so its fallback can't
      // bring them back. It is never cleared for another connection, so a failed
      // refresh on one account never signs out another account. Deleting never
      // throws (a store that can't be written is logged), so the caller still
      // gets this result instead of an exception.
      if (slots.isDefaultConnection) {
        await manager.delete({ type: 'claude_oauth' });
      }

      await manager.deleteLlmCredentials(connectionSlug);
    }

    // Token refresh failed - return null token with optional migration info, or
    // the error when the credentials were kept (a later refresh may succeed)
    return isIncompatibleToken
      ? { accessToken: null, migrationRequired }
      : { accessToken: null, transientRefreshError: errorMessage };
  }
}

// ============================================
// Functions
// ============================================

/**
 * Get and refresh Claude OAuth token if needed
 *
 * This function:
 * 1. Checks if we have a token in our credential store
 * 2. Detects legacy tokens (from Claude CLI) and triggers migration
 * 3. If token is expired and we have a refresh token, refreshes it
 * 4. Returns TokenResult with valid access token and optional migration info
 *
 * MUTEX: Only one refresh per connection can happen at a time. If a refresh
 * is already in progress, other callers wait for it and then re-read credentials.
 *
 * MIGRATION (v0.3.0+):
 * - We NO LONGER import tokens from Claude CLI keychain
 * - Legacy tokens are detected and cleared, prompting re-authentication
 *
 * `manager` and `connections` default to the credential store and config.json;
 * tests pass them in.
 */
export async function getValidClaudeOAuthToken(
  connectionSlug: string,
  manager: ReturnType<typeof getCredentialManager> = getCredentialManager(),
  connections: ClaudeOAuthConnections = readClaudeOAuthConnections(),
): Promise<TokenResult> {
  // Read the credentials that belong to THIS connection. The legacy global slot
  // holds whichever account signed in last, so reading it for every connection
  // made all Claude connections resolve to the same account.
  const creds = await readClaudeOAuthCredentials(manager, connectionSlug, connections);

  if (!creds || !creds.accessToken) {
    return { accessToken: null };
  }

  // Check if token is expired or about to expire
  if (isTokenExpired(creds.expiresAt)) {
    const expiresAtDate = creds.expiresAt ? new Date(creds.expiresAt).toISOString() : 'unknown';
    debug(`[auth] Claude OAuth token expired (was: ${expiresAtDate}), attempting refresh`);

    // Try to refresh if we have a refresh token
    if (creds.refreshToken) {
      // Check if a refresh is already in progress for this connection
      const pendingRefresh = refreshInProgress.get(connectionSlug);
      if (pendingRefresh) {
        debug('[auth] Token refresh already in progress, waiting...');
        const other = await pendingRefresh.catch(() => null);
        // It refreshed this connection's token: a failure that may pass (credentials kept) or a
        // dead token is this caller's outcome too, or it would show Session Expired for a retry.
        if (other && !other.accessToken && (other.transientRefreshError || other.migrationRequired)) {
          return other;
        }
        // Re-read credentials after waiting (they may have been updated)
        const updatedCreds = await readClaudeOAuthCredentials(manager, connectionSlug, connections);
        if (updatedCreds?.accessToken && !isTokenExpired(updatedCreds.expiresAt)) {
          const expiresAtDate = updatedCreds.expiresAt ? new Date(updatedCreds.expiresAt).toISOString() : 'never';
          debug(`[auth] Got refreshed token from concurrent refresh (expires: ${expiresAtDate})`);
          return { accessToken: updatedCreds.accessToken };
        }
        // If still no valid token, return null (the other refresh may have failed)
        debug('[auth] Concurrent refresh did not produce valid token');
        return { accessToken: null };
      }

      // Start the refresh and set the mutex
      debug('[auth] Starting token refresh (holding mutex)');
      const refresh = performTokenRefresh(manager, creds.refreshToken, creds.source, connectionSlug, {
        isDefaultConnection: connections.defaultSlug === connectionSlug,
        fromLegacySlot: creds.fromLegacySlot,
        expectedAccountUuid: connections.accountUuids?.[connectionSlug],
      });
      refreshInProgress.set(connectionSlug, refresh);

      try {
        const result = await refresh;
        return result;
      } finally {
        // Release the mutex
        refreshInProgress.delete(connectionSlug);
      }
    } else {
      debug('[auth] No refresh token available, cannot refresh expired token');
      return { accessToken: null };
    }
  }

  return { accessToken: creds.accessToken };
}

/**
 * Get complete authentication state from all sources (config file + credential store)
 *
 * Uses LLM connections as the source of truth for auth type and credentials.
 * Falls back to legacy global credentials for backwards compatibility.
 */
export async function getAuthState(): Promise<AuthState> {
  const config = loadStoredConfig();
  const manager = getCredentialManager();
  const activeWorkspace = getActiveWorkspace();

  // Get the default LLM connection to determine auth type
  const defaultConnectionSlug = getDefaultLlmConnection();
  const connection = defaultConnectionSlug ? getLlmConnection(defaultConnectionSlug) : null;

  // Determine auth type from connection (no legacy fallback - migration ensures all users have connections)
  let effectiveAuthType: AuthType | null = null;
  if (connection) {
    // Any configured default connection counts as billing-configured,
    // including environment/IAM auth (Bedrock, Vertex).
    effectiveAuthType = toLegacyBillingType(connection.authType)
  }
  // No fallback to legacy config.authType - if no connection, return unauthenticated state

  // Check credentials based on the effective auth type and connection
  let hasCredentials = false;
  let apiKey: string | null = null;
  let claudeOAuthToken: string | null = null;
  let migrationRequired: MigrationInfo | undefined;

  if (connection && defaultConnectionSlug) {
    // Use LLM connection credentials
    // Pass providerType for OAuth routing (OpenAI OAuth needs idToken)
    hasCredentials = await manager.hasLlmCredentials(defaultConnectionSlug, connection.authType, connection.providerType);

    if (connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint' || connection.authType === 'bearer_token') {
      apiKey = await manager.getLlmApiKey(defaultConnectionSlug);
      // Keyless providers (Ollama) are valid when a custom base URL is configured
      if (!apiKey && connection.baseUrl) {
        hasCredentials = true;
      }
    } else if (connection.authType === 'oauth') {
      const llmOAuth = await manager.getLlmOAuth(defaultConnectionSlug);
      if (llmOAuth?.accessToken) {
        claudeOAuthToken = llmOAuth.accessToken;
      }
    }
    // Other auth types (iam_credentials, service_account_file, environment, none) are handled by hasLlmCredentials
    // OpenAI / ChatGPT OAuth credentials are handled inside PiAgent's auth path
  } else {
    // No connection configured - credentials not available
    // Legacy migration should have created a default connection
    hasCredentials = false;
  }

  return {
    billing: {
      type: effectiveAuthType,
      hasCredentials,
      apiKey,
      claudeOAuthToken,
      migrationRequired,
    },
    workspace: {
      hasWorkspace: !!activeWorkspace,
      active: activeWorkspace,
    },
  };
}

/**
 * Derive what setup steps are needed based on current auth state
 */
export function getSetupNeeds(state: AuthState, setupDeferred?: boolean): SetupNeeds {
  // Need billing config if no billing type is set
  const needsBillingConfig = state.billing.type === null;

  // Need credentials if billing type is set but credentials are missing
  const needsCredentials = state.billing.type !== null && !state.billing.hasCredentials;

  return {
    needsBillingConfig,
    needsCredentials,
    // Fully configured if setup is complete OR user chose "Setup later"
    isFullyConfigured: (!needsBillingConfig && !needsCredentials) || !!setupDeferred,
    needsMigration: state.billing.migrationRequired,
  };
}

// ============================================
// Test helpers (exported for testing only)
// ============================================

/**
 * Reset the refresh mutex (for testing only)
 * This allows tests to start with a clean state
 */
export function _resetRefreshMutex(): void {
  refreshInProgress.clear();
}
