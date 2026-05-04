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
