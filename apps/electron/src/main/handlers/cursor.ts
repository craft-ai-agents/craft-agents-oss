/**
 * Cursor RPC handlers
 *
 * Exposes the Cursor manager's OAuth + proxy lifecycle to the renderer.
 * Mirrors the existing chatgpt/copilot handler shape so the UI can reuse
 * the same "click button → open browser → poll → done" flow.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import {
  startCursorOAuth,
  cancelCursorOAuth,
  getCursorAuthStatus,
  logoutCursor,
  getCursorProxyBaseUrl,
} from '../cursor-manager'

export const CURSOR_HANDLED_CHANNELS = [
  RPC_CHANNELS.cursor.START_OAUTH,
  RPC_CHANNELS.cursor.CANCEL_OAUTH,
  RPC_CHANNELS.cursor.GET_AUTH_STATUS,
  RPC_CHANNELS.cursor.LOGOUT,
  RPC_CHANNELS.cursor.GET_PROXY_URL,
] as const

export function registerCursorHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.cursor.START_OAUTH, async () => {
    const { loginUrl, flowId } = await startCursorOAuth()
    return { loginUrl, flowId, authUrl: loginUrl }
  })

  server.handle(RPC_CHANNELS.cursor.CANCEL_OAUTH, async () => {
    cancelCursorOAuth()
    return { success: true }
  })

  server.handle(RPC_CHANNELS.cursor.GET_AUTH_STATUS, async () => {
    return getCursorAuthStatus()
  })

  server.handle(RPC_CHANNELS.cursor.LOGOUT, async () => {
    await logoutCursor()
    return { success: true }
  })

  server.handle(RPC_CHANNELS.cursor.GET_PROXY_URL, async () => {
    const baseUrl = await getCursorProxyBaseUrl()
    return { baseUrl }
  })
}
