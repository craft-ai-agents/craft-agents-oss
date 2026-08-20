import { describe, expect, it } from 'bun:test'
import {
  createOpenClawHostControlBridge,
  OPENCLAW_HOST_CONTROL_CHANNELS,
} from './openclaw-host-control.ts'

describe('OpenClaw host-control preload bridge', () => {
  it('is absent in thin-client WebUI mode', () => {
    const invoke = async () => undefined

    expect(createOpenClawHostControlBridge({ isClientOnly: true, invoke })).toBeUndefined()
  })

  it('uses direct IPC with workspace-only payloads and discards every handler result', async () => {
    const setupCredential = 'gateway-token-must-never-cross-ipc'
    const calls: unknown[][] = []
    const invoke = async (...args: unknown[]) => {
      calls.push(args)
      return setupCredential
    }
    const bridge = createOpenClawHostControlBridge({ isClientOnly: false, invoke })

    expect(bridge).toBeDefined()
    await expect(bridge!.openControlUi({ workspaceId: 'workspace-1' })).resolves.toBeUndefined()
    await expect(bridge!.copyGatewayTokenForSetup({ workspaceId: 'workspace-1' })).resolves.toBeUndefined()

    expect(calls).toEqual([
      [OPENCLAW_HOST_CONTROL_CHANNELS.OPEN_PANEL, { workspaceId: 'workspace-1' }],
      [OPENCLAW_HOST_CONTROL_CHANNELS.COPY_SETUP_CREDENTIAL, { workspaceId: 'workspace-1' }],
    ])
    expect(JSON.stringify(calls)).not.toContain(setupCredential)
  })
})
