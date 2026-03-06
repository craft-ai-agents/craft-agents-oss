import { randomUUID } from 'node:crypto'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { loadSource, loadWorkspaceSources, getSourceCredentialManager } from '@craft-agent/shared/sources'
import { createPendingFlow } from '@craft-agent/shared/auth'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.oauth.START,
  RPC_CHANNELS.oauth.COMPLETE,
  RPC_CHANNELS.oauth.CANCEL,
  RPC_CHANNELS.oauth.REVOKE,
] as const

export function registerOAuthHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger
  const flowStore = deps.oauthFlowStore
  const credManager = getSourceCredentialManager()

  // ── oauth:start ──────────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.START, async (ctx, args: {
    sourceSlug: string
    callbackPort: number
    sessionId?: string
    authRequestId?: string
  }) => {
    const { sourceSlug, callbackPort, sessionId, authRequestId } = args

    if (!ctx.workspaceId) {
      throw new Error('No workspace bound to this client')
    }

    const workspace = getWorkspaceByNameOrId(ctx.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${ctx.workspaceId}`)
    }

    const source = loadSource(workspace.rootPath, sourceSlug)
    if (!source) {
      throw new Error(`Source not found: ${sourceSlug}`)
    }

    const prepared = await credManager.prepareOAuth(source, callbackPort)

    const flowId = randomUUID()
    flowStore.store(createPendingFlow({
      flowId,
      state: prepared.state,
      codeVerifier: prepared.codeVerifier,
      redirectUri: prepared.redirectUri,
      source,
      clientId: prepared.clientId,
      clientSecret: prepared.clientSecret,
      tokenEndpoint: prepared.tokenEndpoint,
      provider: prepared.provider,
      ownerClientId: ctx.clientId,
      workspaceId: ctx.workspaceId,
      sourceSlug,
      sessionId,
      authRequestId,
    }))

    log.info(`[OAuth] Flow started for ${sourceSlug} (flow=${flowId})`)
    return { authUrl: prepared.authUrl, state: prepared.state, flowId }
  })

  // ── oauth:complete ───────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.COMPLETE, async (ctx, args: {
    flowId: string
    code: string
    state: string
  }) => {
    const { flowId, code, state } = args

    const flow = flowStore.getByState(state)
    if (!flow) throw new Error('Unknown or expired OAuth flow')
    if (flow.flowId !== flowId) throw new Error('Flow ID mismatch')
    if (flow.ownerClientId !== ctx.clientId) throw new Error('OAuth flow owned by different client')
    if (flow.workspaceId !== ctx.workspaceId) throw new Error('Workspace mismatch')

    const result = await credManager.exchangeAndStore(flow.source, flow.provider, {
      code,
      codeVerifier: flow.codeVerifier,
      tokenEndpoint: flow.tokenEndpoint,
      clientId: flow.clientId,
      clientSecret: flow.clientSecret,
      redirectUri: flow.redirectUri,
    })

    flowStore.remove(state)

    // If this was triggered from a session auth card, complete it
    if (flow.sessionId && flow.authRequestId) {
      await deps.sessionManager.completeAuthRequest(flow.sessionId, {
        requestId: flow.authRequestId,
        sourceSlug: flow.sourceSlug,
        success: result.success,
        email: result.email,
        error: result.error,
      })
    }

    // Push source status update to all clients in this workspace
    const completeWorkspace = getWorkspaceByNameOrId(flow.workspaceId)
    const completeSources = completeWorkspace ? loadWorkspaceSources(completeWorkspace.rootPath) : []
    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId: flow.workspaceId }, flow.workspaceId, completeSources)

    log.info(`[OAuth] Flow complete for ${flow.sourceSlug} (success=${result.success})`)
    return result
  })

  // ── oauth:cancel ─────────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.CANCEL, async (ctx, args: {
    flowId: string
    state: string
  }) => {
    const { flowId, state } = args
    const flow = flowStore.getByState(state)
    if (flow && flow.flowId === flowId && flow.ownerClientId === ctx.clientId) {
      flowStore.remove(state)
      log.info(`[OAuth] Flow cancelled for ${flow.sourceSlug}`)
    }
  })

  // ── oauth:revoke ─────────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.REVOKE, async (ctx, args: {
    sourceSlug: string
  }) => {
    const { sourceSlug } = args

    if (!ctx.workspaceId) {
      throw new Error('No workspace bound to this client')
    }

    const workspace = getWorkspaceByNameOrId(ctx.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${ctx.workspaceId}`)
    }

    const source = loadSource(workspace.rootPath, sourceSlug)
    if (!source) {
      throw new Error(`Source not found: ${sourceSlug}`)
    }

    await credManager.delete(source)
    credManager.markSourceNeedsReauth(source, 'Signed out by user')

    // Push source status update
    const revokeSources = loadWorkspaceSources(workspace.rootPath)
    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId: ctx.workspaceId }, ctx.workspaceId, revokeSources)

    log.info(`[OAuth] Revoked credentials for ${sourceSlug}`)
    return { success: true }
  })
}
