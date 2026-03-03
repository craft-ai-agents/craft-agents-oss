/**
 * Client capabilities — named actions a client can perform on behalf of the server.
 *
 * See docs/adr-transport-locality.md for the locality boundary definition.
 */

import type { RpcServer } from './types'

/** Capability: open a URL in the client's default browser. */
export const CLIENT_OPEN_EXTERNAL = 'client:openExternal'

/** All capabilities a local Electron client advertises on handshake. */
export const LOCAL_CLIENT_CAPABILITIES: readonly string[] = [CLIENT_OPEN_EXTERNAL]

/**
 * Ask a specific client to open a URL in its default browser.
 *
 * Returns `{ opened: true }` on success.
 * Returns `{ opened: false, error, authUrl }` on failure — caller can
 * show authUrl to user for manual "copy link / open" action.
 */
export async function requestClientOpenExternal(
  server: RpcServer,
  clientId: string,
  url: string,
): Promise<{ opened: boolean; error?: string; authUrl?: string }> {
  try {
    await server.invokeClient(clientId, CLIENT_OPEN_EXTERNAL, url)
    return { opened: true }
  } catch (err) {
    const code = (err as any)?.code
    const message = err instanceof Error ? err.message : String(err)
    return { opened: false, error: `${code ?? 'UNKNOWN'}: ${message}`, authUrl: url }
  }
}
