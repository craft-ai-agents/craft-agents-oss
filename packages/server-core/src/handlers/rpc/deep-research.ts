import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  deleteDeepResearchRun,
  listDeepResearchRuns,
  readDeepResearchRun,
  type DeepResearchRunSnapshot,
  type ReviseDeepResearchPlanInput,
  type StartDeepResearchRunInput,
} from '@craft-agent/shared/deep-research'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.deepResearch.START,
  RPC_CHANNELS.deepResearch.GET,
  RPC_CHANNELS.deepResearch.LIST,
  RPC_CHANNELS.deepResearch.APPROVE,
  RPC_CHANNELS.deepResearch.REVISE,
  RPC_CHANNELS.deepResearch.CANCEL,
  RPC_CHANNELS.deepResearch.DELETE,
] as const

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function requireRunner(deps: HandlerDeps) {
  if (!deps.getDeepResearchRunner) throw new Error('Deep research runner is not available on this host')
  return deps.getDeepResearchRunner()
}

export function registerDeepResearchHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.deepResearch.START,
    async (_ctx, workspaceId: string, input: StartDeepResearchRunInput): Promise<DeepResearchRunSnapshot> => {
      return requireRunner(deps).start(workspaceId, input)
    },
  )

  server.handle(
    RPC_CHANNELS.deepResearch.GET,
    async (_ctx, workspaceId: string, runId: string): Promise<DeepResearchRunSnapshot | null> => {
      return readDeepResearchRun(resolveRootPath(workspaceId), runId)
    },
  )

  server.handle(
    RPC_CHANNELS.deepResearch.LIST,
    async (_ctx, workspaceId: string): Promise<DeepResearchRunSnapshot[]> => {
      return listDeepResearchRuns(resolveRootPath(workspaceId))
    },
  )

  server.handle(
    RPC_CHANNELS.deepResearch.APPROVE,
    async (_ctx, workspaceId: string, runId: string): Promise<DeepResearchRunSnapshot> => {
      return requireRunner(deps).approvePlan(workspaceId, runId)
    },
  )

  server.handle(
    RPC_CHANNELS.deepResearch.REVISE,
    async (
      _ctx,
      workspaceId: string,
      runId: string,
      input: ReviseDeepResearchPlanInput,
    ): Promise<DeepResearchRunSnapshot> => {
      return requireRunner(deps).revisePlan(workspaceId, runId, input.feedback)
    },
  )

  server.handle(
    RPC_CHANNELS.deepResearch.CANCEL,
    async (_ctx, workspaceId: string, runId: string): Promise<DeepResearchRunSnapshot> => {
      return requireRunner(deps).cancel(workspaceId, runId)
    },
  )

  server.handle(
    RPC_CHANNELS.deepResearch.DELETE,
    async (_ctx, workspaceId: string, runId: string): Promise<boolean> => {
      const existing = readDeepResearchRun(resolveRootPath(workspaceId), runId)
      if (existing && existing.state === 'running') {
        throw new Error(`Cannot delete deep research run "${runId}" while it is running. Cancel it first.`)
      }
      return deleteDeepResearchRun(resolveRootPath(workspaceId), runId)
    },
  )
}
