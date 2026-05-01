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
  readRun,
  listRuns,
  deleteRun,
  type WorkflowRunSnapshot,
  type LoadedWorkflow,
} from '@craft-agent/shared/workflows'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workflowRuns.START,
  RPC_CHANNELS.workflowRuns.GET,
  RPC_CHANNELS.workflowRuns.LIST,
  RPC_CHANNELS.workflowRuns.CANCEL,
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

function normalizeTriggerInputs(
  workflow: LoadedWorkflow,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const inputDefs = workflow.metadata.trigger.inputs ?? []
  if (inputDefs.length === 0) return {}
  const out: Record<string, unknown> = {}
  for (const def of inputDefs) {
    let value = raw?.[def.name]
    if (value === undefined) value = def.default
    if (def.required && (value === undefined || value === null || value === '')) {
      throw new Error(`Missing required workflow input: ${def.name}`)
    }
    if (value === undefined || value === null || value === '') {
      continue
    }
    if (def.type === 'string') {
      if (typeof value !== 'string') throw new Error(`Workflow input "${def.name}" must be a string.`)
      out[def.name] = value
    } else if (def.type === 'number') {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error(`Workflow input "${def.name}" must be a number.`)
      }
      out[def.name] = value
    } else if (def.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Workflow input "${def.name}" must be a boolean.`)
      out[def.name] = value
    }
  }
  return out
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
      const workflow = loadGlobalWorkflow(workflowSlug)
      if (!workflow) throw new Error(`Workflow not found: ${workflowSlug}`)
      const runner = requireRunner(deps)
      return runner.start({ workflow, workspaceId, triggerInputs: normalizeTriggerInputs(workflow, triggerInputs) })
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
    async (_ctx, workspaceId: string, runId: string): Promise<void> => {
      const runner = requireRunner(deps)
      await runner.cancel(workspaceId, runId)
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
