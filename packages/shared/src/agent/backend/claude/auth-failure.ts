/**
 * Failing closed when a Claude connection's credentials can't be resolved.
 *
 * `ClaudeAgent.postInit()` puts the connection's credentials into the
 * environment the Claude Code CLI starts with. When it can't, the CLI would
 * still start and sign in with whatever it finds: a token another session left
 * in `process.env`, or the user's own Claude Code login, billed to an account
 * the user never picked (craft-agents-oss#1129). ClaudeAgent records the
 * failure instead, and a turn ends with {@link authFailureError} without
 * starting the CLI.
 */

import { createAgentError, parseError, type AgentError } from '../../errors.ts';

/** Why `postInit()` could not give the CLI this connection's credentials. */
export interface ClaudeAuthFailure {
  /**
   * What is missing: the Claude account sign-in, the API key, or the connection itself.
   * `unavailable`: resolving them threw (e.g. the credential store can't be read or
   * written), so the stored credentials may be fine and a retry can succeed.
   */
  kind: 'oauth' | 'api_key' | 'connection' | 'unavailable';
  /** postInit's warning, e.g. "Failed to get OAuth token for: claude-max". */
  warning: string;
  /**
   * Refreshing the expired sign-in failed for a reason that may pass (offline,
   * timeout, 429, 5xx). The credentials are kept, so a retry can succeed.
   */
  transientRefreshError?: string;
}

/**
 * The error a turn ends with when its connection's credentials can't be resolved.
 *
 * A sign-in that is kept after a refresh that may work later gets the refresh
 * failure's own retryable error: "Session Expired" would send the user to sign
 * in again for nothing. Otherwise the connection has nothing usable: Session
 * Expired (Re-authenticate) for a Claude account, Invalid API Key for a key, and
 * Invalid Credentials when no connection is set up.
 */
export function authFailureError(failure: ClaudeAuthFailure): AgentError {
  if (failure.transientRefreshError) {
    const parsed = parseError(new Error(failure.transientRefreshError));
    const error = parsed.canRetry && parsed.code !== 'unknown_error'
      ? parsed
      : createAgentError('network_error', failure.transientRefreshError);
    return { ...error, details: [failure.warning] };
  }

  // Signing in again can't fix a store that can't be read: offer Retry, with the reason.
  if (failure.kind === 'unavailable') {
    return { ...createAgentError('unknown_error', failure.warning), details: [failure.warning] };
  }

  const code = failure.kind === 'oauth'
    ? 'expired_oauth_token'
    : failure.kind === 'api_key' ? 'invalid_api_key' : 'invalid_credentials';
  return createAgentError(code, failure.warning);
}
