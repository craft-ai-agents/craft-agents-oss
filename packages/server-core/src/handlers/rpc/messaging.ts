/**
 * Messaging RPC handlers — UI ↔ Server communication for messaging config and bindings.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import type {
  MessagingBindingAccessMode,
  MessagingPendingRejectReason,
  MessagingPlatformAccessMode,
  MessagingPlatformOwnerInfo,
} from '../messaging-registry-interface'

export function registerMessagingHandlers(server: RpcServer, deps: HandlerDeps): void {
  const registry = deps.messagingRegistry
  if (!registry) return

  server.handle(RPC_CHANNELS.messaging.GET_CONFIG, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    return registry.getConfig(ctx.workspaceId)
  })

  server.handle(RPC_CHANNELS.messaging.UPDATE_CONFIG, async (ctx, config: Record<string, unknown>) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.updateConfig(ctx.workspaceId, config)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.TEST_TELEGRAM, async (_ctx, token: string) => {
    return registry.testTelegramToken(token)
  })

  server.handle(RPC_CHANNELS.messaging.SAVE_TELEGRAM, async (ctx, token: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.saveTelegramToken(ctx.workspaceId, token)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.TEST_LARK, async (
    _ctx,
    creds: { appId: string; appSecret: string; domain: 'lark' | 'feishu' },
  ) => {
    return registry.testLarkCredentials(creds)
  })

  server.handle(RPC_CHANNELS.messaging.SAVE_LARK, async (
    ctx,
    creds: { appId: string; appSecret: string; domain: 'lark' | 'feishu' },
  ) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.saveLarkCredentials(ctx.workspaceId, creds)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.DISCONNECT, async (ctx, platform: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.disconnectPlatform(ctx.workspaceId, platform)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.FORGET, async (ctx, platform: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.forgetPlatform(ctx.workspaceId, platform)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.GET_BINDINGS, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    return registry.getBindings(ctx.workspaceId)
  })

  server.handle(RPC_CHANNELS.messaging.GENERATE_CODE, async (ctx, sessionId: string, platform: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    return registry.generatePairingCode(ctx.workspaceId, sessionId, platform)
  })

  server.handle(RPC_CHANNELS.messaging.UNBIND, async (ctx, sessionId: string, platform?: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    registry.unbindSession(ctx.workspaceId, sessionId, platform)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.UNBIND_BINDING, async (ctx, bindingId: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    return { success: registry.unbindBinding(ctx.workspaceId, bindingId) }
  })

  // Workspace-supergroup pairing (Telegram forum support — Phase A)
  server.handle(RPC_CHANNELS.messaging.GENERATE_SUPERGROUP_CODE, async (ctx, platform: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    return registry.generateSupergroupPairingCode(ctx.workspaceId, platform)
  })

  server.handle(RPC_CHANNELS.messaging.GET_SUPERGROUP, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    return registry.getWorkspaceSupergroup(ctx.workspaceId)
  })

  server.handle(RPC_CHANNELS.messaging.UNBIND_SUPERGROUP, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.unbindWorkspaceSupergroup(ctx.workspaceId)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.WA_START_CONNECT, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.startWhatsAppConnect(ctx.workspaceId)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.WA_SUBMIT_PHONE, async (ctx, phoneNumber: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.submitWhatsAppPhone(ctx.workspaceId, phoneNumber)
    return { success: true }
  })

  // -------------------------------------------------------------------------
  // Access control
  // -------------------------------------------------------------------------

  server.handle(
    RPC_CHANNELS.messaging.GET_PLATFORM_OWNERS,
    async (ctx, platform: string) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      return registry.getPlatformOwners(ctx.workspaceId, platform)
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.SET_PLATFORM_OWNERS,
    async (ctx, platform: string, owners: MessagingPlatformOwnerInfo[]) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      return registry.setPlatformOwners(ctx.workspaceId, platform, owners)
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.GET_PLATFORM_ACCESS_MODE,
    async (ctx, platform: string) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      return registry.getPlatformAccessMode(ctx.workspaceId, platform)
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.SET_PLATFORM_ACCESS_MODE,
    async (ctx, platform: string, mode: MessagingPlatformAccessMode) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      registry.setPlatformAccessMode(ctx.workspaceId, platform, mode)
      return { success: true }
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.GET_PENDING_SENDERS,
    async (ctx, platform?: string) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      return registry.getPendingSenders(ctx.workspaceId, platform)
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.DISMISS_PENDING_SENDER,
    async (ctx, platform: string, userId: string) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      return { success: registry.dismissPendingSender(ctx.workspaceId, platform, userId) }
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.ALLOW_PENDING_SENDER,
    async (
      ctx,
      platform: string,
      userId: string,
      entryKey?: { reason?: MessagingPendingRejectReason; bindingId?: string },
    ) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      return registry.allowPendingSender(ctx.workspaceId, platform, userId, entryKey)
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.SET_BINDING_ACCESS,
    async (
      ctx,
      bindingId: string,
      access: { mode: MessagingBindingAccessMode; allowedSenderIds?: string[] },
    ) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      registry.setBindingAccess(ctx.workspaceId, bindingId, access)
      return { success: true }
    },
  )
}
