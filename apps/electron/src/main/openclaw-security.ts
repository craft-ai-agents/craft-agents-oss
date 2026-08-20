import { join } from 'node:path'

import { getCredentialManager } from '@craft-agent/shared/credentials'
import { CONFIG_DIR, getServerConfig, getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import { getToolchain } from '@craft-agent/shared/toolchain-runtime'
import {
  CraftSecurityCollector,
  OpenClawOperationError,
  OpenClawRuntimeManager,
  OpenClawSecurityAuditService,
  OpenClawSecurityCollector,
} from '@craft-agent/server-core/openclaw'
import type { OpenClawSecurityService } from '@craft-agent/server-core/handlers'
import type { AcceptSecurityRiskRequest, OpenClawRuntimeStatus } from '@craft-agent/shared/openclaw'
import type { ManagedOpenClawLauncher, ToolStatus } from '@craft-agent/shared/toolchain'

export interface OpenClawSecurityComposition {
  readonly runtimeManager: OpenClawRuntimeManager
  readonly auditService: OpenClawSecurityAuditService
  readonly service: OpenClawSecurityService
}

/**
 * Minimal runtime surface used by the managed-install transition. It excludes
 * start and every process-launching capability by construction.
 */
export interface ManagedOpenClawRuntime {
  getRuntimeStatus(workspaceId: string): Promise<OpenClawRuntimeStatus>
  provisionRuntime(workspaceId: string): Promise<OpenClawRuntimeStatus>
}

/**
 * Ensures the pinned managed Node before installing a missing OpenClaw launcher,
 * then provisions it. The caller must authorize the workspace before entry.
 */
export async function installManagedOpenClawRuntime(
  workspaceId: string,
  runtimeManager: ManagedOpenClawRuntime,
  resolveManagedLauncher: () => Promise<ManagedOpenClawLauncher | null>,
  ensureManagedNode: () => Promise<Pick<ToolStatus, 'phase'>>,
  installManagedToolchain: () => Promise<Pick<ToolStatus, 'phase'>>,
): Promise<OpenClawRuntimeStatus> {
  const launcher = await resolveManagedLauncher()
  if (!launcher) {
    const node = await ensureManagedNode()
    if (node.phase !== 'ready') {
      return runtimeManager.getRuntimeStatus(workspaceId)
    }

    const installation = await installManagedToolchain()
    if (installation.phase !== 'ready' || !(await resolveManagedLauncher())) {
      return runtimeManager.getRuntimeStatus(workspaceId)
    }
  }
  return runtimeManager.provisionRuntime(workspaceId)
}

/**
 * Creates the Electron host's concrete OpenClaw services. All paths are rooted
 * under Craft's config directory; RPC inputs are accepted only after they map
 * to an existing Craft workspace identity.
 */
export function createOpenClawSecurityComposition(): OpenClawSecurityComposition {
  const credentialManager = getCredentialManager()
  const resolveManagedLauncher = () => getToolchain().resolver.resolveOpenClawLauncher()
  const ensureManagedNode = async (): Promise<Pick<ToolStatus, 'phase'>> => {
    const manager = getToolchain().manager
    const node = (await manager.status()).find(status => status.name === 'node')
    return node?.phase === 'ready' ? node : manager.update('node')
  }

  const runtimeManager = new OpenClawRuntimeManager({
    runtimeRoot: join(CONFIG_DIR, 'openclaw'),
    credentialStore: credentialManager,
    resolveManagedLauncher,
  })

  const craftCollector = new CraftSecurityCollector({
    inspect: async workspaceId => {
      const workspace = requireCraftWorkspace(workspaceId)
      const workspaceConfig = loadWorkspaceConfig(workspace.rootPath)
      const [credentialHealth, launcher] = await Promise.all([
        credentialManager.checkHealth(),
        resolveManagedLauncher(),
      ])
      const server = getServerConfig()
      const tls = Boolean(server.tlsCertPath && server.tlsKeyPath)

      return {
        permissionMode: workspaceConfig?.defaults?.permissionMode,
        // The host-extension inventory has no safe, persisted capability
        // projection yet. Do not infer grants from renderer input or read raw
        // manifests here; that future integration can populate this field.
        extensions: [],
        credentialHealth: {
          healthy: credentialHealth.healthy,
          issues: credentialHealth.issues.map(issue => ({ type: issue.type })),
        },
        server: {
          bind: server.enabled ? 'all' : 'loopback',
          tls,
          insecure: server.enabled && !tls,
        },
        toolchain: { openclaw: launcher ? 'ready' : 'missing' },
      }
    },
  })
  const openClawCollector = new OpenClawSecurityCollector({
    runtimeProvider: runtimeManager,
    resolveManagedLauncher,
  })
  const auditService = new OpenClawSecurityAuditService({
    runtimeProvider: runtimeManager,
    craftCollector,
    openClawCollector,
  })

  const requireWorkspace = <T>(workspaceId: string, operation: () => Promise<T>): Promise<T> => {
    requireCraftWorkspace(workspaceId)
    return operation()
  }

  const service: OpenClawSecurityService = {
    getRuntimeStatus: ({ workspaceId }) => requireWorkspace(
      workspaceId,
      () => runtimeManager.getRuntimeStatus(workspaceId),
    ),
    // A missing launcher first requires pinned managed Node, then pinned OpenClaw.
    // Any unsuccessful install returns a safe runtime projection without provisioning.
    installRuntime: ({ workspaceId }) => requireWorkspace(
      workspaceId,
      () => installManagedOpenClawRuntime(
        workspaceId,
        runtimeManager,
        resolveManagedLauncher,
        ensureManagedNode,
        () => getToolchain().manager.update('openclaw'),
      ),
    ),
    provisionRuntime: ({ workspaceId }) => requireWorkspace(
      workspaceId,
      () => runtimeManager.provisionRuntime(workspaceId),
    ),
    startRuntime: ({ workspaceId }) => requireWorkspace(
      workspaceId,
      () => runtimeManager.startRuntime(workspaceId),
    ),
    stopRuntime: ({ workspaceId }) => requireWorkspace(
      workspaceId,
      () => runtimeManager.stopRuntime(workspaceId),
    ),
    runAudit: ({ workspaceId, mode }) => requireWorkspace(
      workspaceId,
      () => auditService.runAudit(workspaceId, mode),
    ),
    getLatestAudit: ({ workspaceId }) => requireWorkspace(
      workspaceId,
      () => auditService.getLatestAudit(workspaceId),
    ),
    acceptRisk: (input: AcceptSecurityRiskRequest) => requireWorkspace(
      input.workspaceId,
      () => auditService.acceptRisk(input),
    ),
    revokeRiskAcceptance: ({ workspaceId, fingerprint }) => requireWorkspace(
      workspaceId,
      () => auditService.revokeRiskAcceptance(workspaceId, fingerprint),
    ),
  }

  return { runtimeManager, auditService, service }
}

function requireCraftWorkspace(workspaceId: string): { readonly id: string; readonly rootPath: string } {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace || workspace.id !== workspaceId || !workspace.rootPath) {
    throw new OpenClawOperationError('RUNTIME_MISSING', false)
  }
  return workspace
}
