import { describe, expect, it, mock } from 'bun:test'
import type { OpenClawRuntimeStatus } from '@craft-agent/shared/openclaw'
import type { ManagedOpenClawLauncher } from '@craft-agent/shared/toolchain'
import { installManagedOpenClawRuntime } from './openclaw-security.ts'

const WORKSPACE_ID = 'workspace-openclaw'
const managedLauncher: ManagedOpenClawLauncher = {
  executablePath: '/managed/toolchain/node/current/bin/node',
  argsPrefix: ['/managed/toolchain/openclaw/current/package/openclaw.mjs'],
  version: '2026.7.1-2',
}

function runtimeStatus(
  workspaceId: string,
  state: 'unavailable' | 'provisioned' | 'unsupported' | 'running',
): OpenClawRuntimeStatus {
  return {
    runtimeId: 'managed-openclaw-runtime',
    workspaceId,
    state,
    managed: true as const,
    ...(state === 'unavailable' ? { safeError: 'RUNTIME_MISSING' as const } : {}),
    ...(state === 'unsupported' ? { safeError: 'UNSUPPORTED' as const } : {}),
  }
}

describe('installManagedOpenClawRuntime', () => {
  it('ensures a missing managed Node before installing OpenClaw and provisioning', async () => {
    const calls: string[] = []
    let launcher: ManagedOpenClawLauncher | null = null
    const resolveManagedLauncher = mock(async () => {
      calls.push('resolve-launcher')
      return launcher
    })
    const nodeStatus = mock(async (): Promise<{ readonly phase: 'missing' | 'ready' }> => {
      calls.push('node-status')
      return { phase: 'missing' }
    })
    const updateNode = mock(async () => {
      calls.push('update-node')
      return { phase: 'ready' as const }
    })
    const ensureManagedNode = mock(async () => {
      const node = await nodeStatus()
      return node.phase === 'ready' ? node : updateNode()
    })
    const installManagedToolchain = mock(async () => {
      calls.push('install-openclaw')
      launcher = managedLauncher
      return { phase: 'ready' as const }
    })
    const getRuntimeStatus = mock(async (workspaceId: string) => runtimeStatus(workspaceId, 'unavailable'))
    const provisionRuntime = mock(async (workspaceId: string) => {
      const resolvedLauncher = await resolveManagedLauncher()
      calls.push('provision')
      return runtimeStatus(workspaceId, resolvedLauncher ? 'provisioned' : 'unsupported')
    })
    const startRuntime = mock(async (workspaceId: string) => runtimeStatus(workspaceId, 'running'))
    const runtimeManager = { getRuntimeStatus, provisionRuntime, startRuntime }

    const result = await installManagedOpenClawRuntime(
      WORKSPACE_ID,
      runtimeManager,
      resolveManagedLauncher,
      ensureManagedNode,
      installManagedToolchain,
    )

    expect(ensureManagedNode).toHaveBeenCalledTimes(1)
    expect(installManagedToolchain).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      'resolve-launcher',
      'node-status',
      'update-node',
      'install-openclaw',
      'resolve-launcher',
      'resolve-launcher',
      'provision',
    ])
    expect(startRuntime).not.toHaveBeenCalled()
    expect(result).toMatchObject({ state: 'provisioned', managed: true })
  })

  it('does not install OpenClaw, provision, or start after managed Node installation fails', async () => {
    const calls: string[] = []
    const nodeInstallFailure = 'NODE_INSTALL_FAILED'
    const resolveManagedLauncher = mock(async () => {
      calls.push('resolve-launcher')
      return null
    })
    const ensureManagedNode = mock(async () => {
      calls.push('ensure-managed-node')
      return { phase: 'error' as const, error: nodeInstallFailure }
    })
    const installManagedToolchain = mock(async () => {
      calls.push('install-openclaw')
      return { phase: 'ready' as const }
    })
    const getRuntimeStatus = mock(async (workspaceId: string) => {
      calls.push('runtime-status')
      return runtimeStatus(workspaceId, 'unavailable')
    })
    const provisionRuntime = mock(async (workspaceId: string) => runtimeStatus(workspaceId, 'provisioned'))
    const startRuntime = mock(async (workspaceId: string) => runtimeStatus(workspaceId, 'running'))
    const runtimeManager = { getRuntimeStatus, provisionRuntime, startRuntime }

    const result = await installManagedOpenClawRuntime(
      WORKSPACE_ID,
      runtimeManager,
      resolveManagedLauncher,
      ensureManagedNode,
      installManagedToolchain,
    )

    expect(installManagedToolchain).not.toHaveBeenCalled()
    expect(provisionRuntime).not.toHaveBeenCalled()
    expect(startRuntime).not.toHaveBeenCalled()
    expect(calls).toEqual([
      'resolve-launcher',
      'ensure-managed-node',
      'runtime-status',
    ])
    expect(result).toEqual(runtimeStatus(WORKSPACE_ID, 'unavailable'))
    expect(JSON.stringify(result)).not.toContain(nodeInstallFailure)
  })

  it('does not provision or start after managed OpenClaw installation fails', async () => {
    const calls: string[] = []
    const openClawInstallFailure = 'OPENCLAW_INSTALL_FAILED'
    const resolveManagedLauncher = mock(async () => {
      calls.push('resolve-launcher')
      return null
    })
    const ensureManagedNode = mock(async () => {
      calls.push('ensure-managed-node')
      return { phase: 'ready' as const }
    })
    const installManagedToolchain = mock(async () => {
      calls.push('install-openclaw')
      return { phase: 'error' as const, error: openClawInstallFailure }
    })
    const getRuntimeStatus = mock(async (workspaceId: string) => {
      calls.push('runtime-status')
      return runtimeStatus(workspaceId, 'unavailable')
    })
    const provisionRuntime = mock(async (workspaceId: string) => runtimeStatus(workspaceId, 'provisioned'))
    const startRuntime = mock(async (workspaceId: string) => runtimeStatus(workspaceId, 'running'))
    const runtimeManager = { getRuntimeStatus, provisionRuntime, startRuntime }

    const result = await installManagedOpenClawRuntime(
      WORKSPACE_ID,
      runtimeManager,
      resolveManagedLauncher,
      ensureManagedNode,
      installManagedToolchain,
    )

    expect(provisionRuntime).not.toHaveBeenCalled()
    expect(startRuntime).not.toHaveBeenCalled()
    expect(calls).toEqual([
      'resolve-launcher',
      'ensure-managed-node',
      'install-openclaw',
      'runtime-status',
    ])
    expect(result).toEqual(runtimeStatus(WORKSPACE_ID, 'unavailable'))
    expect(JSON.stringify(result)).not.toContain(openClawInstallFailure)
  })

  it('does not provision when the launcher remains absent after a ready OpenClaw install', async () => {
    const calls: string[] = []
    const resolveManagedLauncher = mock(async () => {
      calls.push('resolve-launcher')
      return null
    })
    const ensureManagedNode = mock(async () => {
      calls.push('ensure-managed-node')
      return { phase: 'ready' as const }
    })
    const installManagedToolchain = mock(async () => {
      calls.push('install-openclaw')
      return { phase: 'ready' as const }
    })
    const getRuntimeStatus = mock(async (workspaceId: string) => {
      calls.push('runtime-status')
      return runtimeStatus(workspaceId, 'unavailable')
    })
    const provisionRuntime = mock(async (workspaceId: string) => runtimeStatus(workspaceId, 'provisioned'))
    const startRuntime = mock(async (workspaceId: string) => runtimeStatus(workspaceId, 'running'))
    const runtimeManager = { getRuntimeStatus, provisionRuntime, startRuntime }

    const result = await installManagedOpenClawRuntime(
      WORKSPACE_ID,
      runtimeManager,
      resolveManagedLauncher,
      ensureManagedNode,
      installManagedToolchain,
    )

    expect(installManagedToolchain).toHaveBeenCalledTimes(1)
    expect(provisionRuntime).not.toHaveBeenCalled()
    expect(startRuntime).not.toHaveBeenCalled()
    expect(calls).toEqual([
      'resolve-launcher',
      'ensure-managed-node',
      'install-openclaw',
      'resolve-launcher',
      'runtime-status',
    ])
    expect(result).toEqual(runtimeStatus(WORKSPACE_ID, 'unavailable'))
  })

  it('provisions an already verified managed launcher without installing Node or OpenClaw', async () => {
    const resolveManagedLauncher = mock(async () => managedLauncher)
    const ensureManagedNode = mock(async () => ({ phase: 'ready' as const }))
    const installManagedToolchain = mock(async () => ({ phase: 'ready' as const }))
    const getRuntimeStatus = mock(async (workspaceId: string) => runtimeStatus(workspaceId, 'unavailable'))
    const provisionRuntime = mock(async (workspaceId: string) => runtimeStatus(workspaceId, 'provisioned'))
    const startRuntime = mock(async (workspaceId: string) => runtimeStatus(workspaceId, 'running'))
    const runtimeManager = { getRuntimeStatus, provisionRuntime, startRuntime }

    const result = await installManagedOpenClawRuntime(
      WORKSPACE_ID,
      runtimeManager,
      resolveManagedLauncher,
      ensureManagedNode,
      installManagedToolchain,
    )

    expect(ensureManagedNode).not.toHaveBeenCalled()
    expect(installManagedToolchain).not.toHaveBeenCalled()
    expect(provisionRuntime).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(startRuntime).not.toHaveBeenCalled()
    expect(result).toEqual(runtimeStatus(WORKSPACE_ID, 'provisioned'))
  })
})
