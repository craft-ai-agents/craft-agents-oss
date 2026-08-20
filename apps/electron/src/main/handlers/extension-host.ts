/**
 * Extension Host RPC handlers (S-05 §3.5 / W6 + capability broker).
 *
 * LOCAL_ONLY lifecycle + craft-sandbox load/call over ExtensionHostManager.
 * Capability mint/revoke/proxyFetch never return raw secrets to callers.
 * Does not execute SiYuan plugins (executesSiyuanPlugins always false).
 *
 * Per-workspace hosts: optional workspaceId on args selects the manager key.
 * URL allowlist is durable per extensionId under configDir/extensions/.
 *
 * LOAD grants are resolved solely from workspace permissions.json — renderer
 * cannot self-supply grantedPermissions.
 */

import { RPC_CHANNELS } from '../../shared/types'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import {
  getExtensionHostManager,
  listExtensionHostStatuses,
} from '../extension-host-manager'
import {
  getUrlAllowlist,
  setUrlAllowlist,
} from '../extension-host/extension-url-allowlist'
import type { ExtensionHostStatus } from '@craft-agent/shared/extensions'
import { CONFIG_DIR, getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { loadRawWorkspacePermissions } from '@craft-agent/shared/agent'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.extensionHost.STATUS,
  RPC_CHANNELS.extensionHost.STATUS_ALL,
  RPC_CHANNELS.extensionHost.START,
  RPC_CHANNELS.extensionHost.STOP,
  RPC_CHANNELS.extensionHost.RESTART,
  RPC_CHANNELS.extensionHost.LOAD,
  RPC_CHANNELS.extensionHost.CALL,
  RPC_CHANNELS.extensionHost.LIST_COMMANDS,
  RPC_CHANNELS.extensionHost.MINT_CAPABILITY,
  RPC_CHANNELS.extensionHost.REVOKE_CAPABILITY,
  RPC_CHANNELS.extensionHost.PROXY_FETCH,
  RPC_CHANNELS.extensionHost.GET_URL_ALLOWLIST,
  RPC_CHANNELS.extensionHost.SET_URL_ALLOWLIST,
] as const

type WorkspaceArgs = { workspaceId?: string | null }

/**
 * Resolve effective extension grants from workspace permissions.json.
 * grants = entry.granted filtered by not-in entry.revoked.
 * Missing workspace / missing entry → [].
 */
export function resolveExtensionGrantsFromPermissions(
  workspaceId: string | null | undefined,
  extensionId: string,
): string[] {
  const id = typeof extensionId === 'string' ? extensionId.trim() : ''
  if (!id) return []
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) return []
  try {
    const workspace = getWorkspaceByNameOrId(workspaceId.trim())
    if (!workspace?.rootPath) return []
    const raw = loadRawWorkspacePermissions(workspace.rootPath)
    const entry = raw?.extensions?.[id]
    if (!entry) return []
    const revoked = new Set(entry.revoked ?? [])
    return (entry.granted ?? []).filter((g) => typeof g === 'string' && !revoked.has(g))
  } catch {
    return []
  }
}


export function registerExtensionHostHandlers(
  server: RpcServer,
  _deps: HandlerDeps,
): void {
  server.handle(
    RPC_CHANNELS.extensionHost.STATUS,
    async (_ctx, args?: WorkspaceArgs): Promise<ExtensionHostStatus> => {
      return getExtensionHostManager(args?.workspaceId).getStatus()
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.STATUS_ALL,
    async (): Promise<Array<{ workspaceId: string } & ExtensionHostStatus>> => {
      return listExtensionHostStatuses()
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.START,
    async (_ctx, args?: WorkspaceArgs): Promise<ExtensionHostStatus> => {
      return getExtensionHostManager(args?.workspaceId).start()
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.STOP,
    async (_ctx, args?: WorkspaceArgs): Promise<ExtensionHostStatus> => {
      return getExtensionHostManager(args?.workspaceId).stop()
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.RESTART,
    async (_ctx, args?: WorkspaceArgs): Promise<ExtensionHostStatus> => {
      return getExtensionHostManager(args?.workspaceId).restart()
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.LOAD,
    async (
      _ctx,
      args: {
        extensionId: string
        entryPath: string
        /** Ignored — grants come from workspace permissions.json only. */
        grantedPermissions?: string[]
        workspaceId?: string | null
      },
    ): Promise<{ ok: true }> => {
      if (!args || typeof args.extensionId !== 'string' || typeof args.entryPath !== 'string') {
        throw new Error('extensionHost.load requires { extensionId, entryPath }')
      }
      // Never trust renderer-supplied grantedPermissions.
      const grants = resolveExtensionGrantsFromPermissions(args.workspaceId, args.extensionId)
      await getExtensionHostManager(args.workspaceId).loadExtension(
        args.extensionId,
        args.entryPath,
        grants,
      )
      return { ok: true }
    },
  )


  server.handle(
    RPC_CHANNELS.extensionHost.CALL,
    async (
      _ctx,
      args: {
        extensionId: string
        method: string
        args?: unknown[]
        permissions?: string[]
        workspaceId?: string | null
      },
    ): Promise<unknown> => {
      if (!args || typeof args.extensionId !== 'string' || typeof args.method !== 'string') {
        throw new Error('extensionHost.call requires { extensionId, method }')
      }
      return getExtensionHostManager(args.workspaceId).callExtension(
        args.extensionId,
        args.method,
        args.args,
        args.permissions,
      )
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.LIST_COMMANDS,
    async (
      _ctx,
      args: { extensionId: string; workspaceId?: string | null },
    ): Promise<Array<{
      id: string
      title: string
      when?: string
      defaultHotkey?: string
      keywords?: string[]
    }>> => {
      if (!args || typeof args.extensionId !== 'string') {
        throw new Error('extensionHost.listCommands requires { extensionId }')
      }
      return getExtensionHostManager(args.workspaceId).listExtensionCommands(args.extensionId)
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.MINT_CAPABILITY,
    async (
      _ctx,
      args: {
        extensionId: string
        permission: string
        ttlMs?: number
        singleUse?: boolean
        workspaceId?: string | null
      },
    ): Promise<{ token: string; expiresAt: number; permission: string }> => {
      if (
        !args ||
        typeof args.extensionId !== 'string' ||
        typeof args.permission !== 'string'
      ) {
        throw new Error(
          'extensionHost.mintCapability requires { extensionId, permission }',
        )
      }
      // Never trust renderer-supplied grantedPermissions — loadExtension only.
      return getExtensionHostManager(args.workspaceId).mintCapability({
        extensionId: args.extensionId,
        permission: args.permission,
        ttlMs: args.ttlMs,
        singleUse: args.singleUse,
      })
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.REVOKE_CAPABILITY,
    async (
      _ctx,
      args: { token?: string; extensionId?: string; workspaceId?: string | null },
    ): Promise<{ ok: true }> => {
      if (!args || (typeof args.token !== 'string' && typeof args.extensionId !== 'string')) {
        throw new Error(
          'extensionHost.revokeCapability requires { token } or { extensionId }',
        )
      }
      const mgr = getExtensionHostManager(args.workspaceId)
      if (typeof args.token === 'string') mgr.revokeCapability(args.token)
      if (typeof args.extensionId === 'string') {
        mgr.revokeExtensionCapabilities(args.extensionId)
      }
      return { ok: true }
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.PROXY_FETCH,
    async (
      _ctx,
      args: {
        token: string
        url: string
        method?: string
        headers?: Record<string, string>
        body?: string
        allowedUrlPrefixes?: string[]
        workspaceId?: string | null
      },
    ): Promise<{ status: number; body: string; headers: Record<string, string> }> => {
      if (!args || typeof args.token !== 'string' || typeof args.url !== 'string') {
        throw new Error('extensionHost.proxyFetch requires { token, url }')
      }
      // Manager merges durable store allowlist; do not trust renderer alone.
      return getExtensionHostManager(args.workspaceId).proxyFetch({
        token: args.token,
        url: args.url,
        method: args.method,
        headers: args.headers,
        body: args.body,
        allowedUrlPrefixes: args.allowedUrlPrefixes,
      })
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.GET_URL_ALLOWLIST,
    async (
      _ctx,
      args: { extensionId: string },
    ): Promise<{ prefixes: string[] }> => {
      if (!args || typeof args.extensionId !== 'string') {
        throw new Error('extensionHost.getUrlAllowlist requires { extensionId }')
      }
      return {
        prefixes: getUrlAllowlist(args.extensionId, CONFIG_DIR),
      }
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.SET_URL_ALLOWLIST,
    async (
      _ctx,
      args: { extensionId: string; prefixes: string[] },
    ): Promise<{ prefixes: string[] }> => {
      if (!args || typeof args.extensionId !== 'string' || !Array.isArray(args.prefixes)) {
        throw new Error(
          'extensionHost.setUrlAllowlist requires { extensionId, prefixes }',
        )
      }
      return {
        prefixes: setUrlAllowlist(args.extensionId, args.prefixes, CONFIG_DIR),
      }
    },
  )
}
