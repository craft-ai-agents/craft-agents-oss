/**
 * The renderer may load modules that carry SDK tool declarations, but it must
 * never execute the Node-only Claude Agent SDK. These inert declarations allow
 * those modules to load; attempts to query the SDK fail at use time.
 */
export class AbortError extends Error {}

export const tool = (..._args: unknown[]) => ({})
export const createSdkMcpServer = (..._args: unknown[]) => ({})

export async function* query(): AsyncGenerator<never> {
  yield await Promise.reject(new Error('The Claude Agent SDK is unavailable in the Electron renderer'))
}

export default { AbortError, tool, createSdkMcpServer, query }
