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
  /** Telegram supergroup forum topic id; undefined for DMs / non-Telegram. */
  threadId?: number
  channelName?: string
  enabled: boolean
  createdAt: number
}

/**
 * Workspace-level Telegram supergroup configuration. Set by pairing the
 * workspace to a supergroup via the new `/pair <code>` workspace flow;
 * unset via `unbindWorkspaceSupergroup`.
 */
export interface MessagingSupergroupInfo {
  chatId: string
  title: string
  capturedAt: number
}

export interface MessagingPlatformRuntimeInfo {
  platform: string
  configured: boolean
  connected: boolean
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnect_required' | 'error'
  identity?: string
  lastError?: string
  updatedAt: number
}

export interface MessagingConfigInfo {
  enabled: boolean
  /**
   * Per-platform config. Telegram may carry an optional `supergroup` field
   * once the user has paired a supergroup; other platforms (WhatsApp) only
   * use `enabled`.
   */
  platforms: Record<
    string,
    | {
        enabled: boolean
        supergroup?: MessagingSupergroupInfo
      }
    | undefined
  >
  runtime: Record<string, MessagingPlatformRuntimeInfo | undefined>
}

export interface IMessagingGatewayRegistry {
  /** Get bindings for a workspace. */
  getBindings(workspaceId: string): MessagingBindingInfo[]

  /** Get messaging config and runtime state for a workspace. */
  getConfig(workspaceId: string): MessagingConfigInfo | null

  /** Update messaging config for a workspace. */
  updateConfig(workspaceId: string, config: Partial<MessagingConfigInfo>): Promise<void>

  /** Generate a pairing code for binding a session to a chat. */
  generatePairingCode(workspaceId: string, sessionId: string, platform: string): { code: string; expiresAt: number; botUsername?: string }

  /**
   * Generate a pairing code that, when typed in a Telegram supergroup,
   * registers that supergroup at the workspace level. Phase A of the topics
   * feature — currently Telegram-only.
   */
  generateSupergroupPairingCode(
    workspaceId: string,
    platform: string,
  ): { code: string; expiresAt: number; botUsername?: string }

  /** Read the workspace's currently paired Telegram supergroup, if any. */
  getWorkspaceSupergroup(workspaceId: string): MessagingSupergroupInfo | null

  /** Unbind the workspace from its currently paired Telegram supergroup. */
  unbindWorkspaceSupergroup(workspaceId: string): Promise<void>

  /**
   * Bind a freshly-spawned automation session to a Telegram forum topic in
   * the paired supergroup (creating the topic if it doesn't exist yet).
   * Best-effort — returns a discriminated result instead of throwing so
   * callers can log + continue without blocking the session.
   */
  bindAutomationSession(args: {
    workspaceId: string
    sessionId: string
    topicName: string
  }): Promise<
    | { ok: true; chatId: string; threadId: number; reused: boolean }
    | {
        ok: false
        reason: 'invalid-name' | 'no-supergroup' | 'no-adapter' | 'topic-create-failed'
        error?: string
      }
  >

  /**
   * Drop a cached automation topic entry. Does not delete the Telegram topic
   * itself. Useful when an automation is renamed/removed and the user wants
   * the next use of the same name to create a fresh topic.
   */
  removeAutomationTopic(workspaceId: string, topicName: string): Promise<void>

  /** Unbind all bindings for a session, optionally limited to one platform. */
  unbindSession(workspaceId: string, sessionId: string, platform?: string): void

  /** Unbind one specific binding row by ID. */
  unbindBinding(workspaceId: string, bindingId: string): boolean

  /** Test a Telegram bot token. */
  testTelegramToken(token: string): Promise<{ success: boolean; botName?: string; botUsername?: string; error?: string }>

  /** Save Telegram token and (re)initialize the adapter. */
  saveTelegramToken(workspaceId: string, token: string): Promise<void>

  /**
   * Test Lark/Feishu credentials by exchanging them for a tenant access
   * token. Domain selects which Open Platform to talk to.
   */
  testLarkCredentials(creds: {
    appId: string
    appSecret: string
    domain: 'lark' | 'feishu'
  }): Promise<{ success: boolean; botName?: string; error?: string }>

  /** Save Lark/Feishu credentials and (re)initialize the adapter. */
  saveLarkCredentials(workspaceId: string, creds: {
    appId: string
    appSecret: string
    domain: 'lark' | 'feishu'
  }): Promise<void>

  /** Disable a platform for a workspace, preserving WhatsApp auth state unless forgotten separately. */
  disconnectPlatform(workspaceId: string, platform: string): Promise<void>

  /** Disable a platform and forget its local auth/device state when supported. */
  forgetPlatform(workspaceId: string, platform: string): Promise<void>

  /**
   * Start the WhatsApp connect flow (spawns the worker, emits QR or pairing-code
   * prompts via WA_UI_EVENT). Throws if WhatsApp support is not configured.
   */
  startWhatsAppConnect(workspaceId: string): Promise<void>

  /**
   * Submit a phone number to the running WhatsApp worker to request a pairing
   * code. Must be called after startWhatsAppConnect.
   */
  submitWhatsAppPhone(workspaceId: string, phoneNumber: string): Promise<void>
}
