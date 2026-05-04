/**
 * WeChat adapter — skeleton.
 *
 * Stage 0/1 of the WeChat integration: the protocol layer
 * (`./protocol/{types,api,redact}.ts`) is in place and re-exported here for
 * the auth + adapter implementations that follow in subsequent PRs.
 *
 * No `WeChatAdapter` class yet — until the QR-login + getUpdates loop land,
 * the registry leaves the platform unconfigured and the Settings UI shows a
 * "Coming soon" affordance.
 */

export * from './protocol/types'
export * from './protocol/api'
export { redactToken, redactBody, redactUrl } from './protocol/redact'
export {
  WeChatLoginManager,
  WECHAT_QR_BASE_URL,
  DEFAULT_ILINK_BOT_TYPE,
  type WeChatLoginEvent,
  type WeChatLoginListener,
  type WeChatLoginOptions,
  type WeChatLoginResult,
} from './auth/login-qr'
export { WeChatAdapter, type WeChatAdapterConfig } from './adapter'
export { syncBufPath, loadSyncBuf, saveSyncBuf } from './sync-buf'

/**
 * Stored WeChat credential payload. Persisted as the JSON `value` of a
 * `messaging_bearer` row keyed by (workspaceId, name='wechat'). Mirrors the
 * Lark adapter's `JSON.stringify(creds)` pattern.
 */
export interface WeChatCredentials {
  /** iLink bot token returned by the QR confirmation step. */
  botToken: string
  /** Stable account id assigned by Tencent (`ilink_bot_id`). */
  ilinkBotId: string
  /** End-user id of the WeChat account that scanned the QR. */
  ilinkUserId?: string
  /** IDC-pinned base URL for `getupdates` / `sendmessage` calls. */
  baseUrl: string
}

export function parseWeChatCredentials(value: string | undefined): WeChatCredentials {
  if (!value) throw new Error('WeChat credentials are missing')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('WeChat credentials are malformed (not JSON)')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('WeChat credentials are malformed (not an object)')
  }
  const obj = parsed as Record<string, unknown>
  if (typeof obj.botToken !== 'string' || !obj.botToken) {
    throw new Error('WeChat credentials are missing botToken')
  }
  if (typeof obj.ilinkBotId !== 'string' || !obj.ilinkBotId) {
    throw new Error('WeChat credentials are missing ilinkBotId')
  }
  if (typeof obj.baseUrl !== 'string' || !obj.baseUrl) {
    throw new Error('WeChat credentials are missing baseUrl')
  }
  return {
    botToken: obj.botToken,
    ilinkBotId: obj.ilinkBotId,
    ilinkUserId: typeof obj.ilinkUserId === 'string' ? obj.ilinkUserId : undefined,
    baseUrl: obj.baseUrl,
  }
}
