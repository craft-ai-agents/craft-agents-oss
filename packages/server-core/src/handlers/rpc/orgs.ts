import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  acceptInvite,
  createOrganization,
  getLocalIdentity,
  inviteToOrganization,
  listOrgMembers,
  listOrganizations,
} from '@craft-agent/shared/orgs'
import type {
  AcceptInviteInput,
  CreateOrganizationInput,
  InviteToOrgInput,
  OrgRole,
} from '@craft-agent/shared/orgs'
import { setWorkspaceOrganization } from '@craft-agent/shared/config'
import {
  ensureLocalUserIdentity,
  loadPreferences,
  updatePreferences,
} from '@craft-agent/shared/config/preferences'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.orgs.LIST,
  RPC_CHANNELS.orgs.CREATE,
  RPC_CHANNELS.orgs.INVITE,
  RPC_CHANNELS.orgs.ACCEPT,
  RPC_CHANNELS.orgs.LIST_MEMBERS,
  RPC_CHANNELS.orgs.GET_IDENTITY,
  RPC_CHANNELS.orgs.UPDATE_IDENTITY,
  RPC_CHANNELS.orgs.SET_WORKSPACE_ORG,
] as const

/**
 * Prefer CRAFT_SERVER_URL server-side invite redemption when present.
 * Local single-device path is the default implementation below.
 */
function serverModeEnabled(): boolean {
  return Boolean(process.env.CRAFT_SERVER_URL && process.env.CRAFT_SERVER_URL.trim())
}

export function registerOrgsHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Ensure local identity exists early so profile/orgs share the same userId.
  ensureLocalUserIdentity()

  server.handle(RPC_CHANNELS.orgs.LIST, async () => {
    return listOrganizations()
  })

  server.handle(RPC_CHANNELS.orgs.CREATE, async (_ctx, input: CreateOrganizationInput) => {
    const org = createOrganization(input ?? { name: '' })
    deps.platform.logger.info?.(`Created organization "${org.name}" (${org.id})`)
    return org
  })

  server.handle(RPC_CHANNELS.orgs.INVITE, async (_ctx, input: InviteToOrgInput) => {
    // Server mode: still write local invite bookkeeping; remote multi-user
    // redemption can proxy later. Local-first always persists.
    const invite = inviteToOrganization(input)
    if (serverModeEnabled()) {
      deps.platform.logger.info?.(
        `Invite created for org ${invite.orgId} (server mode active; local token stored)`,
      )
    }
    return invite
  })

  server.handle(RPC_CHANNELS.orgs.ACCEPT, async (_ctx, input: AcceptInviteInput) => {
    // Prefer server path when CRAFT_SERVER_URL is set — currently local accept
    // is the only implemented redeemer; keep the branch for ops visibility.
    if (serverModeEnabled()) {
      deps.platform.logger.info?.('Accepting invite via local store (server redeem not yet remote)')
    }
    return acceptInvite(input)
  })

  server.handle(RPC_CHANNELS.orgs.LIST_MEMBERS, async (_ctx, orgId: string) => {
    return listOrgMembers(orgId)
  })

  server.handle(RPC_CHANNELS.orgs.GET_IDENTITY, async () => {
    return getLocalIdentity()
  })

  server.handle(
    RPC_CHANNELS.orgs.UPDATE_IDENTITY,
    async (
      _ctx,
      updates: { username?: string; email?: string; name?: string },
    ) => {
      ensureLocalUserIdentity()
      const patch: { username?: string; email?: string; name?: string } = {}
      if (typeof updates?.username === 'string') {
        const v = updates.username.trim()
        if (v) patch.username = v
      }
      if (typeof updates?.email === 'string') {
        const v = updates.email.trim()
        if (v) patch.email = v
      }
      if (typeof updates?.name === 'string') {
        const v = updates.name.trim()
        if (v) patch.name = v
      }
      if (Object.keys(patch).length > 0) updatePreferences(patch)
      // Touch load so callers see merged file
      loadPreferences()
      return getLocalIdentity()
    },
  )

  server.handle(
    RPC_CHANNELS.orgs.SET_WORKSPACE_ORG,
    async (_ctx, workspaceId: string, orgId: string | null) => {
      if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
        throw new Error('workspaceId is required')
      }
      if (orgId !== null && typeof orgId !== 'string') {
        throw new Error('orgId must be a string or null')
      }

      // The storage lifecycle resolves the local server identity and requires
      // durable membership before it writes either folder or registry metadata.
      return setWorkspaceOrganization(workspaceId.trim(), orgId)
    },
  )
}

// Silence unused type import if tree-shaken oddly
export type { OrgRole }
