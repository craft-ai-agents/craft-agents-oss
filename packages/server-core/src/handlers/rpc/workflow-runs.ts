/**
 * RPC handlers for workflow runs.
 *
 * Run state is owned by the `WorkflowRunner` (in-memory + persisted to
 * `<workspaceRoot>/runs/<runId>/run.json`). These handlers are thin
 * façades over the runner + the run-storage helpers.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  loadGlobalWorkflow,
  readActivatedWorkflows,
  readRun,
  listRuns,
  deleteRun,
  type WorkflowRunSnapshot,
  normalizeWorkflowTriggerInputs,
} from '@craft-agent/shared/workflows'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

const WORKFLOW_RUNS_RESUME =
  (RPC_CHANNELS.workflowRuns as { RESUME?: string; RERUN_FROM_STEP?: string }).RESUME ??
  (RPC_CHANNELS.workflowRuns as { RESUME?: string; RERUN_FROM_STEP?: string }).RERUN_FROM_STEP ??
  'workflow-runs:resume'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workflowRuns.START,
  RPC_CHANNELS.workflowRuns.GET,
  RPC_CHANNELS.workflowRuns.LIST,
  RPC_CHANNELS.workflowRuns.CANCEL,
  WORKFLOW_RUNS_RESUME,
  RPC_CHANNELS.workflowRuns.DELETE,
] as const

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function requireRunner(deps: HandlerDeps) {
  if (!deps.getWorkflowRunner) throw new Error('Workflow runner is not available on this host')
  return deps.getWorkflowRunner()
}

export function registerWorkflowRunsHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.workflowRuns.START,
    async (
      _ctx,
      workspaceId: string,
      workflowSlug: string,
      triggerInputs: Record<string, unknown>,
    ): Promise<WorkflowRunSnapshot> => {
      const workspaceRoot = resolveRootPath(workspaceId)
      if (!readActivatedWorkflows(workspaceRoot).active.includes(workflowSlug)) {
        throw new Error(`Workflow "${workflowSlug}" is not active in this workspace.`)
      }
      const workflow = loadGlobalWorkflow(workflowSlug)
      if (!workflow) throw new Error(`Workflow not found: ${workflowSlug}`)
      const runner = requireRunner(deps)
      return runner.start({ workflow, workspaceId, triggerInputs: normalizeWorkflowTriggerInputs(workflow, triggerInputs) })
    },
  )

  server.handle(
    RPC_CHANNELS.workflowRuns.GET,
    async (_ctx, workspaceId: string, runId: string): Promise<WorkflowRunSnapshot | null> => {
      return readRun(resolveRootPath(workspaceId), runId)
    },
  )

  server.handle(
    RPC_CHANNELS.workflowRuns.LIST,
    async (_ctx, workspaceId: string): Promise<WorkflowRunSnapshot[]> => {
      return listRuns(resolveRootPath(workspaceId))
    },
  )

  server.handle(
    RPC_CHANNELS.workflowRuns.CANCEL,
    async (_ctx, workspaceId: string, runId: string): Promise<WorkflowRunSnapshot> => {
      const runner = requireRunner(deps)
      return runner.cancel(workspaceId, runId)
    },
  )

  server.handle(
    WORKFLOW_RUNS_RESUME,
    async (
      _ctx,
      workspaceId: string,
      runId: string,
      stepId?: string,
    ): Promise<WorkflowRunSnapshot> => {
      const runner = requireRunner(deps)
      return runner.rerunFromStep({ workspaceId, runId, stepId })
    },
  )

  server.handle(
    RPC_CHANNELS.workflowRuns.DELETE,
    async (_ctx, workspaceId: string, runId: string): Promise<boolean> => {
      const rootPath = resolveRootPath(workspaceId)
      const existing = readRun(rootPath, runId)
      if (existing && existing.state === 'running') {
        throw new Error(`Cannot delete run "${runId}" while it is still running. Cancel it first.`)
      }
      return deleteRun(rootPath, runId)
    },
  )
}
