/**
 * Native-only OpenClaw host controls. This is deliberately not part of the
 * shared ElectronAPI or routed RPC surface: a remote WebUI must never receive
 * either capability.
 */

export const OPENCLAW_HOST_CONTROL_CHANNELS = Object.freeze({
  OPEN_PANEL: '__openclaw-host:open-panel',
  COPY_SETUP_CREDENTIAL: '__openclaw-host:copy-setup-credential',
})

export interface OpenClawHostControlApi {
  openControlUi(input: { workspaceId: string }): Promise<void>
  copyGatewayTokenForSetup(input: { workspaceId: string }): Promise<void>
}

export interface OpenClawHostControlBridgeOptions {
  readonly isClientOnly: boolean
  readonly invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

/**
 * Returns no bridge at all for thin-client WebUI mode. The bridge passes only
 * a workspace identity and discards every main-process result, so secret data
 * cannot cross the preload boundary even if a handler were changed later.
 */
export function createOpenClawHostControlBridge(
  options: OpenClawHostControlBridgeOptions,
): OpenClawHostControlApi | undefined {
  if (options.isClientOnly) return undefined

  return Object.freeze({
    async openControlUi(input: { workspaceId: string }): Promise<void> {
      await options.invoke(OPENCLAW_HOST_CONTROL_CHANNELS.OPEN_PANEL, { workspaceId: input.workspaceId })
    },
    async copyGatewayTokenForSetup(input: { workspaceId: string }): Promise<void> {
      await options.invoke(OPENCLAW_HOST_CONTROL_CHANNELS.COPY_SETUP_CREDENTIAL, { workspaceId: input.workspaceId })
    },
  })
}

declare global {
  interface Window {
    /** Present only in a native Electron renderer attached to the local host. */
    openClawHostControl?: OpenClawHostControlApi
  }
}
