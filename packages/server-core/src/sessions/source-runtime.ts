import type { AgentBackend, SdkMcpServerConfig } from '@archstudio/shared/agent/backend'
import {
  SERVER_BUILD_ERRORS,
  TokenRefreshManager,
  createTokenGetter,
  getSourceCredentialManager,
  getSourceServerBuilder,
  hasRenewEndpoint,
  isApiOAuthProvider,
  type LoadedSource,
  type SourceWithCredential,
  type SummarizeCallback,
} from '@archstudio/shared/sources'
import { perf } from '@archstudio/shared/utils'
import type { Logger } from '@archstudio/server-core/runtime'

export async function buildServersFromSources(
  sources: LoadedSource[],
  logger: Logger,
  sessionPath?: string,
  tokenRefreshManager?: TokenRefreshManager,
  summarize?: SummarizeCallback,
) {
  const span = perf.span('sources.buildServers', { count: sources.length })
  const credManager = getSourceCredentialManager()
  const serverBuilder = getSourceServerBuilder()

  const sourcesWithCreds: SourceWithCredential[] = await Promise.all(
    sources.map(async source => ({
      source,
      token: await credManager.getToken(source),
      credential: await credManager.getApiCredential(source),
    })),
  )
  span.mark('credentials.loaded')

  const getTokenForSource = (source: LoadedSource) => {
    const isOAuth = isApiOAuthProvider(source.config.provider) || source.config.api?.authType === 'oauth'
    if (!isOAuth && !hasRenewEndpoint(source)) return undefined

    const manager = tokenRefreshManager ?? new TokenRefreshManager(credManager, {
      log: message => logger.debug(message),
    })
    return createTokenGetter(manager, source)
  }

  const getCredentialForSource = (source: LoadedSource) => {
    if (source.config.type !== 'api') return undefined
    if (source.config.api?.authType === 'none') return undefined
    if (isApiOAuthProvider(source.config.provider)) return undefined
    if (source.config.api?.authType === 'oauth') return undefined
    if (hasRenewEndpoint(source)) return undefined
    return async () => credManager.getApiCredential(source)
  }

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

  for (const error of result.errors) {
    if (error.error !== SERVER_BUILD_ERRORS.AUTH_REQUIRED) continue
    const source = sources.find(candidate => candidate.config.slug === error.sourceSlug)
    if (!source) continue

    const credential = await credManager.load(source)
    const isExpiredRefreshable =
      credential &&
      (credManager.isExpired(credential) || credManager.needsRefresh(credential)) &&
      (credential.refreshToken || hasRenewEndpoint(source))

    if (isExpiredRefreshable) {
      error.error = SERVER_BUILD_ERRORS.TOKEN_EXPIRED
      logger.debug(`Source ${error.sourceSlug}: TOKEN_EXPIRED — refresh cycle will handle`)
      continue
    }

    credManager.markSourceNeedsReauth(source, 'Token missing or expired')
    logger.info(`Marked source ${error.sourceSlug} as needing re-auth`)
  }

  span.end()
  return result
}

export interface RefreshExpiredCredentialsResult {
  refreshedCount: number
  failedSources: Array<{ slug: string; reason: string }>
}

export async function refreshExpiredCredentials(
  sources: LoadedSource[],
  tokenRefreshManager: TokenRefreshManager,
  logger: Logger,
): Promise<RefreshExpiredCredentialsResult> {
  logger.debug('[OAuth] Checking if any tokens need refresh')

  const needRefresh = await tokenRefreshManager.getSourcesNeedingRefresh(sources)
  if (needRefresh.length === 0) return { refreshedCount: 0, failedSources: [] }

  logger.debug(`[OAuth] Refreshing ${needRefresh.length} source(s): ${needRefresh.map(source => source.config.slug).join(', ')}`)
  const { refreshed, failed } = await tokenRefreshManager.refreshSources(needRefresh)

  return {
    refreshedCount: refreshed.length,
    failedSources: failed.map(({ source, reason }) => ({ slug: source.config.slug, reason })),
  }
}

export async function applyBridgeUpdates(
  agent: AgentBackend,
  sessionPath: string,
  enabledSources: LoadedSource[],
  mcpServers: Record<string, SdkMcpServerConfig>,
  sessionId: string,
  workspaceRootPath: string,
  context: string,
  poolServerUrl?: string,
): Promise<void> {
  await agent.applyBridgeUpdates({
    sessionPath,
    enabledSources,
    mcpServers,
    sessionId,
    workspaceRootPath,
    context,
    poolServerUrl,
  })
}
