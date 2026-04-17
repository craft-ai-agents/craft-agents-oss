/**
 * IMessagingGatewayRegistry — abstract interface for messaging gateway access.
 *
 * RPC handlers in server-core program against this interface;
 * the concrete MessagingGatewayRegistry satisfies it at runtime.
 */

export interface MessagingBindingInfo {
  id: string
  workspaceId: string
  sessionId: string
  platform: string
  channelId: string
  channelName?: string
  enabled: boolean
  createdAt: number
}

export interface MessagingConfigInfo {
  enabled: boolean
  platforms: Record<string, { enabled: boolean } | undefined>
}

export interface IMessagingGatewayRegistry {
  /** Get bindings for a workspace. */
  getBindings(workspaceId: string): MessagingBindingInfo[]

  /** Get messaging config for a workspace. */
  getConfig(workspaceId: string): MessagingConfigInfo | null

  /** Update messaging config for a workspace. */
  updateConfig(workspaceId: string, config: Partial<MessagingConfigInfo>): Promise<void>

  /** Generate a pairing code for binding a session to a chat. */
  generatePairingCode(workspaceId: string, sessionId: string, platform: string): { code: string; expiresAt: number; botUsername?: string }

  /** Unbind a session from messaging. */
  unbindSession(workspaceId: string, sessionId: string, platform?: string): void

  /** Test a Telegram bot token. */
  testTelegramToken(token: string): Promise<{ success: boolean; botName?: string; botUsername?: string; error?: string }>

  /** Save Telegram token and (re)initialize the adapter. */
  saveTelegramToken(workspaceId: string, token: string): Promise<void>

  /** Disconnect a platform for a workspace. */
  disconnectPlatform(workspaceId: string, platform: string): Promise<void>
}
