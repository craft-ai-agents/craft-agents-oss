/**
 * Identity Center RPC handlers (S-07 / W4).
 *
 * Thin orchestration over IdentityStore + CredentialManager + existing
 * knowledge / LLM connection registries. Secrets only via CredentialManager.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { getLlmConnections } from '@craft-agent/shared/config'
import { getIdentityStore } from '@craft-agent/core/platform/identity/store'
import type {
  ConnectServiceInput,
  IdentityState,
  ServiceConnection,
  ServiceConnectionStatus,
  ServiceProvider,
  UpdateProfileInput,
} from '@craft-agent/core/platform/identity/types'
import { KnowledgeConnectionsStore } from '../../knowledge/connections-store'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.identity.GET_STATE,
  RPC_CHANNELS.identity.UPDATE_PROFILE,
  RPC_CHANNELS.identity.CONNECT,
  RPC_CHANNELS.identity.DISCONNECT,
  RPC_CHANNELS.identity.REFRESH_STATUS,
] as const

export interface IdentityGetStateArgs {
  workspaceId?: string
}

export interface IdentityConnectArgs {
  provider: ServiceProvider
  workspaceId: string
  accountLabel?: string
  credentialValue?: string
  connectionId?: string
}

export interface IdentityDisconnectArgs {
  connectionId: string
}

export interface IdentityRefreshArgs {
  workspaceId?: string
}

function knowledgeStatusToService(status: string): ServiceConnectionStatus {
  if (status === 'ok') return 'connected'
  if (status === 'needs_auth') return 'expired'
  if (status === 'failed') return 'error'
  return 'disconnected'
}

function mapLlmProvider(providerType: string, piAuthProvider?: string): ServiceProvider | null {
  const needle = `${providerType} ${piAuthProvider ?? ''}`.toLowerCase()
  if (needle.includes('openai') || needle.includes('chatgpt') || needle.includes('codex')) return 'openai'
  if (needle.includes('anthropic') || needle.includes('claude')) return 'anthropic'
  if (needle.includes('google') || needle.includes('gemini')) return 'google'
  if (needle.includes('github') || needle.includes('copilot')) return 'github'
  return null
}

/**
 * Build the aggregated IdentityState for the active (or given) workspace:
 * 1. Owned identity.json connections (siyuan-cloud, github, …)
 * 2. Knowledge connections → provider siyuan-local
 * 3. Optional LLM reflections (read-only openai/anthropic/google)
 */
export function buildAggregatedState(workspaceId?: string): IdentityState {
  const store = getIdentityStore(process.env.CRAFT_CONFIG_DIR || CONFIG_DIR)
  const base = store.getState()

  const owned = base.connections.filter((c) => !c.readOnly)
  const scopedOwned = workspaceId ? owned.filter((c) => c.workspaceId === workspaceId || !workspaceId) : owned

  const derived: ServiceConnection[] = []

  // Knowledge connections (siyuan-local)
  try {
    const knowledge = new KnowledgeConnectionsStore(process.env.CRAFT_CONFIG_DIR || CONFIG_DIR).list()
    for (const record of knowledge) {
      // credentialRef embeds workspaceId as source_bearer::{ws}::{id}
      const parts = record.credentialRef.split('::')
      const recordWs = parts.length === 3 ? parts[1] : undefined
      if (workspaceId && recordWs && recordWs !== workspaceId) continue
      derived.push({
        id: `knowledge:${record.id}`,
        workspaceId: recordWs || workspaceId || 'local',
        provider: 'siyuan-local',
        accountLabel: record.baseUrl,
        credentialRef: record.credentialRef,
        status: knowledgeStatusToService(record.status),
        readOnly: true,
      })
    }
  } catch {
    /* knowledge store optional on cold start */
  }

  // LLM reflections — presence of credential only; ownership stays in AI Settings
  try {
    const llms = getLlmConnections()
    for (const llm of llms) {
      const provider = mapLlmProvider(llm.providerType, llm.piAuthProvider)
      if (!provider) continue
      // Only reflect the three named providers from the contract
      if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'google') continue
      const ws = workspaceId || 'local'
      derived.push({
        id: `llm:${llm.slug}`,
        workspaceId: ws,
        provider,
        accountLabel: llm.name || llm.slug,
        status: 'connected',
        readOnly: true,
      })
    }
  } catch {
    /* LLM config optional */
  }

  // Prefer freshest owned + derived for response; do not persist derived rows
  // into identity.json on every get (avoids churn). Persist only owned.
  const connections = [
    ...(workspaceId ? scopedOwned : owned),
    ...derived,
  ]

  return {
    profile: base.profile,
    connections,
    entitlements: base.entitlements,
  }
}

function broadcastChanged(server: RpcServer): void {
  try {
    pushTyped(server, RPC_CHANNELS.identity.CHANGED, { to: 'all' })
  } catch {
    /* push optional */
  }
}

export function registerIdentityHandlers(server: RpcServer, deps: HandlerDeps): void {
  const configDir = () => process.env.CRAFT_CONFIG_DIR || CONFIG_DIR

  server.handle(RPC_CHANNELS.identity.GET_STATE, async (_ctx, args?: IdentityGetStateArgs) => {
    return buildAggregatedState(args?.workspaceId)
  })

  server.handle(RPC_CHANNELS.identity.UPDATE_PROFILE, async (_ctx, input: UpdateProfileInput = {}) => {
    const store = getIdentityStore(configDir())
    store.updateProfile(input ?? {})
    broadcastChanged(server)
    return buildAggregatedState()
  })

  server.handle(RPC_CHANNELS.identity.CONNECT, async (_ctx, args: IdentityConnectArgs) => {
    if (!args?.provider || !args?.workspaceId) {
      throw new Error('identity.connect: provider and workspaceId are required')
    }

    // Providers that authenticate via a caller-supplied token/credential must
    // not land as "connected" without one (siyuan-cloud service_oauth path).
    const requiresCredential = args.provider === 'siyuan-cloud'
    const credentialValue = args.credentialValue?.trim()
    if (requiresCredential && !credentialValue) {
      throw new Error('identity.connect: credentialValue is required for siyuan-cloud')
    }

    const store = getIdentityStore(configDir())
    const input: ConnectServiceInput = {
      provider: args.provider,
      workspaceId: args.workspaceId,
    }
    if (args.accountLabel !== undefined) input.accountLabel = args.accountLabel
    if (credentialValue) input.credentialValue = credentialValue
    if (args.connectionId !== undefined) input.connectionId = args.connectionId

    const connection = store.connect(input)

    // Persist service_oauth when a token is supplied (siyuan-cloud and peers).
    if (credentialValue) {
      const manager = getCredentialManager()
      await manager.set(
        {
          type: 'service_oauth',
          workspaceId: args.workspaceId,
          name: connection.id,
        },
        {
          value: credentialValue,
          tokenType: 'Bearer',
        },
      )
      // Ensure credentialRef points at the connection id used as name.
      if (connection.credentialRef !== connection.id) {
        store.setConnectionStatus(connection.id, 'connected')
      }
    }

    if (args.provider === 'siyuan-cloud') {
      // v1: no live SiYuan Cloud API — cache trial/active entitlement when connected.
      store.ensureSiyuanCloudEntitlement('trial')
    }

    deps.platform.logger.info(`[identity] connected ${connection.provider} (${connection.id})`)
    broadcastChanged(server)
    return buildAggregatedState(args.workspaceId)
  })

  server.handle(RPC_CHANNELS.identity.DISCONNECT, async (_ctx, args: IdentityDisconnectArgs) => {
    if (!args?.connectionId) {
      throw new Error('identity.disconnect: connectionId is required')
    }
    const store = getIdentityStore(configDir())
    const prior = store.getConnection(args.connectionId)
    if (!prior) {
      // Derived knowledge/llm rows cannot be disconnected here.
      if (args.connectionId.startsWith('llm:')) {
        throw new Error('identity.disconnect: LLM connections are managed in AI Settings')
      }
      if (args.connectionId.startsWith('knowledge:')) {
        throw new Error('identity.disconnect: knowledge connections are managed in Knowledge settings')
      }
      throw new Error(`identity.disconnect: connection not found: ${args.connectionId}`)
    }
    if (prior.readOnly) {
      throw new Error('identity.disconnect: read-only connection cannot be disconnected here')
    }

    const removed = store.disconnect(args.connectionId)
    if (removed?.credentialRef) {
      const manager = getCredentialManager()
      // Prefer service_oauth; also try legacy workspace_oauth name form fail-soft.
      try {
        await manager.delete({
          type: 'service_oauth',
          workspaceId: removed.workspaceId,
          name: removed.credentialRef,
        })
      } catch {
        /* missing credential is fine */
      }
    }

    deps.platform.logger.info(`[identity] disconnected ${args.connectionId}`)
    broadcastChanged(server)
    return buildAggregatedState(removed?.workspaceId)
  })

  server.handle(RPC_CHANNELS.identity.REFRESH_STATUS, async (_ctx, args?: IdentityRefreshArgs) => {
    const store = getIdentityStore(configDir())
    const workspaceId = args?.workspaceId
    const owned = store.listConnections().filter((c) => !c.readOnly)

    // Re-derive status for owned rows that have service_oauth credentials.
    const manager = getCredentialManager()
    for (const conn of owned) {
      if (workspaceId && conn.workspaceId !== workspaceId) continue
      if (!conn.credentialRef) {
        if (conn.status !== 'disconnected') {
          store.setConnectionStatus(conn.id, 'disconnected')
        }
        continue
      }
      try {
        const cred = await manager.get({
          type: 'service_oauth',
          workspaceId: conn.workspaceId,
          name: conn.credentialRef,
        })
        if (!cred?.value) {
          store.setConnectionStatus(conn.id, 'disconnected')
          continue
        }
        // Expired entitlement → surface expired on the siyuan-cloud connection
        if (conn.provider === 'siyuan-cloud') {
          const ent = store
            .listEntitlements()
            .find((e) => e.provider === 'siyuan-cloud' && e.product === 'cloud-sync')
          if (ent?.status === 'expired') {
            store.setConnectionStatus(conn.id, 'expired')
            continue
          }
        }
        if (conn.status === 'disconnected' || conn.status === 'error') {
          store.setConnectionStatus(conn.id, 'connected')
        }
      } catch {
        store.setConnectionStatus(conn.id, 'error')
      }
    }

    broadcastChanged(server)
    return buildAggregatedState(workspaceId)
  })
}
