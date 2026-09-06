/**
 * Source → server-config builder, shared by session startup and the pages
 * action executor.
 *
 * Turns LoadedSources into connectable MCP / in-process API server configs
 * with credentials resolved at build time and refresh wired for OAuth /
 * renew-endpoint sources. Extracted verbatim from SessionManager so pages
 * (which have no session) reuse the exact same credential path — one
 * implementation, no drift.
 */

import { createScopedLogger, CONSOLE_LOGGER, type Logger } from '@craft-agent/server-core/runtime'
import {
  getSourceCredentialManager,
  getSourceServerBuilder,
  isApiOAuthProvider,
  hasRenewEndpoint,
  SERVER_BUILD_ERRORS,
  TokenRefreshManager,
  createTokenGetter,
  type LoadedSource,
  type SourceWithCredential,
  type SummarizeCallback,
} from '@craft-agent/shared/sources'
import { perf } from '@craft-agent/shared/utils'

const defaultLog = createScopedLogger(CONSOLE_LOGGER, 'sources')

export async function buildServersFromSources(
  sources: LoadedSource[],
  sessionPath?: string,
  tokenRefreshManager?: TokenRefreshManager,
  summarize?: SummarizeCallback,
  log: Logger = defaultLog
) {
  const span = perf.span('sources.buildServers', { count: sources.length })
  const credManager = getSourceCredentialManager()
  const serverBuilder = getSourceServerBuilder()

  // Load credentials for all sources
  const sourcesWithCreds: SourceWithCredential[] = await Promise.all(
    sources.map(async (source) => ({
      source,
      token: await credManager.getToken(source),
      credential: await credManager.getApiCredential(source),
    }))
  )
  span.mark('credentials.loaded')

  // Build token getter for refreshable sources (OAuth + renew-endpoint)
  // Uses TokenRefreshManager for unified refresh logic (DRY principle)
  const getTokenForSource = (source: LoadedSource) => {
    const provider = source.config.provider
    // Provider-specific OAuth (Google, Slack, Microsoft) or generic OAuth (authType: 'oauth')
    if (isApiOAuthProvider(provider) || source.config.api?.authType === 'oauth') {
      const manager = tokenRefreshManager ?? new TokenRefreshManager(credManager, {
        log: (msg) => log.debug(msg),
      })
      return createTokenGetter(manager, source)
    }
    // API renew endpoint — non-OAuth token refresh
    if (hasRenewEndpoint(source)) {
      const manager = tokenRefreshManager ?? new TokenRefreshManager(credManager, {
        log: (msg) => log.debug(msg),
      })
      return createTokenGetter(manager, source)
    }
    return undefined
  }

  // Per-request credential getter for non-OAuth / non-renew API sources
  // (bearer / header / query / basic auth).
  //
  // Without this, the in-process API tool captures the credential as a static
  // string at build time and keeps using it forever — meaning a fresh JWT
  // entered via source_credential_prompt is ignored until session restart.
  //
  // With this getter, every API call reads the latest credential from the
  // vault, so credential updates take effect on the next call. OAuth and
  // renew-endpoint sources have their own refresh logic via TokenRefreshManager
  // and are skipped here.
  const getCredentialForSource = (source: LoadedSource) => {
    if (source.config.type !== 'api') return undefined
    if (source.config.api?.authType === 'none') return undefined
    if (isApiOAuthProvider(source.config.provider)) return undefined
    if (source.config.api?.authType === 'oauth') return undefined
    if (hasRenewEndpoint(source)) return undefined
    return async () => credManager.getApiCredential(source)
  }

  // Pass sessionPath to enable saving large API responses to session folder
  const result = await serverBuilder.buildAll(
    sourcesWithCreds,
    getTokenForSource,
    sessionPath,
    summarize,
    getCredentialForSource,
  )
  span.mark('servers.built')
  span.setMetadata('mcpCount', Object.keys(result.mcpServers).length)
  span.setMetadata('apiCount', Object.keys(result.apiServers).length)

  // Update source configs for auth errors so UI reflects actual state.
  // Re-classify AUTH_REQUIRED → TOKEN_EXPIRED when the credential is merely
  // expired-but-refreshable; in that case the refresh cycle handles recovery
  // and we must NOT prematurely mark the source as needing re-auth (#710).
  for (const error of result.errors) {
    if (error.error !== SERVER_BUILD_ERRORS.AUTH_REQUIRED) continue
    const source = sources.find(s => s.config.slug === error.sourceSlug)
    if (!source) continue

    const cred = await credManager.load(source)
    const isExpiredRefreshable =
      cred &&
      (credManager.isExpired(cred) || credManager.needsRefresh(cred)) &&
      (cred.refreshToken || hasRenewEndpoint(source))

    if (isExpiredRefreshable) {
      error.error = SERVER_BUILD_ERRORS.TOKEN_EXPIRED
      log.debug(`Source ${error.sourceSlug}: TOKEN_EXPIRED — refresh cycle will handle`)
      continue
    }

    credManager.markSourceNeedsReauth(source, 'Token missing or expired')
    log.info(`Marked source ${error.sourceSlug} as needing re-auth`)
  }

  span.end()
  return result
}
