import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type {
  CreateCommunityEmailJobInput,
  CommunitySuppressionRecord,
  ImportCommunityCsvInput,
  UpsertCommunityContactInput,
} from '@craft-agent/shared/community'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.community.GET,
  RPC_CHANNELS.community.ADD_CONTACT,
  RPC_CHANNELS.community.IMPORT_CSV,
  RPC_CHANNELS.community.CREATE_EMAIL_JOB,
  RPC_CHANNELS.community.SUPPRESS,
] as const

function resolveWorkspace(workspaceId: string): { rootPath: string } {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace
}

function normalizeMachineId(machineId: string): string {
  return machineId.trim() || 'local-machine'
}

export function registerCommunityHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.community.GET, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ getTeamModeStatus }, { loadCommunityState }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/community'),
    ])
    const status = getTeamModeStatus(workspace.rootPath)
    return loadCommunityState(workspace.rootPath, normalizeMachineId(status.machine.machineId))
  })

  server.handle(RPC_CHANNELS.community.ADD_CONTACT, async (_ctx, workspaceId: string, input: UpsertCommunityContactInput) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }, { upsertCommunityContact, loadCommunityState }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/community'),
    ])
    assertTeamPermission(workspace.rootPath, 'records.write')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)
    upsertCommunityContact(workspace.rootPath, machineId, input)
    return loadCommunityState(workspace.rootPath, machineId)
  })

  server.handle(RPC_CHANNELS.community.IMPORT_CSV, async (_ctx, workspaceId: string, input: Omit<ImportCommunityCsvInput, 'assertedBy'> & { assertedBy?: string }) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }, { importCommunityCsv, loadCommunityState }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/community'),
    ])
    assertTeamPermission(workspace.rootPath, 'records.write')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)
    importCommunityCsv(workspace.rootPath, machineId, {
      ...input,
      assertedBy: machineId,
    })
    return loadCommunityState(workspace.rootPath, machineId)
  })

  server.handle(RPC_CHANNELS.community.CREATE_EMAIL_JOB, async (_ctx, workspaceId: string, input: CreateCommunityEmailJobInput) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }, { createCommunityEmailJob, loadCommunityState }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/community'),
    ])
    assertTeamPermission(workspace.rootPath, 'community.email.draft')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)
    createCommunityEmailJob(workspace.rootPath, machineId, input)
    return loadCommunityState(workspace.rootPath, machineId)
  })

  server.handle(RPC_CHANNELS.community.SUPPRESS, async (_ctx, workspaceId: string, email: string, reason?: CommunitySuppressionRecord['reason']) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }, { suppressCommunityContact, loadCommunityState }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/community'),
    ])
    assertTeamPermission(workspace.rootPath, 'records.write')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)
    suppressCommunityContact(workspace.rootPath, machineId, email, reason)
    return loadCommunityState(workspace.rootPath, machineId)
  })
}
