import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { PendingSkill, PendingSkillDiff } from '@craft-agent/shared/memory/types'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { SkillPendingQueue } from '../../memory/SkillPendingQueue'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skillsPending.LIST,
  RPC_CHANNELS.skillsPending.APPROVE,
  RPC_CHANNELS.skillsPending.DISMISS,
  RPC_CHANNELS.skillsPending.DIFF,
] as const

function queueFor(workspaceId: string) {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return null
  return new SkillPendingQueue(workspace.rootPath)
}

export function registerSkillsPendingHandlers(server: RpcServer, deps: HandlerDeps): void {
  const broadcastChanged = (workspaceId: string): void => {
    pushTyped(server, RPC_CHANNELS.skillsPending.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  }

  // List distilled skill candidates awaiting approval.
  server.handle(RPC_CHANNELS.skillsPending.LIST, async (_ctx, workspaceId: string): Promise<PendingSkill[]> => {
    const queue = queueFor(workspaceId)
    if (!queue) {
      deps.platform.logger?.error(`SKILLS_PENDING_LIST: Workspace not found: ${workspaceId}`)
      return []
    }
    return queue.list()
  })

  // Approve a candidate: moves it from skills/.pending/<slug>/ to skills/<slug>/,
  // or — for update candidates — snapshots the live skill into .versions/ and
  // overwrites its SKILL.md. S2: candidates with script-validation violations
  // are rejected unless force=true.
  server.handle(RPC_CHANNELS.skillsPending.APPROVE, async (_ctx, workspaceId: string, slug: string, force?: boolean) => {
    const queue = queueFor(workspaceId)
    if (!queue) throw new Error('Workspace not found')
    queue.approve(slug, { force: force === true })
    deps.platform.logger?.info(`SKILLS_PENDING_APPROVE: approved '${slug}' in ${workspaceId}`)
    broadcastChanged(workspaceId)
    return true
  })

  // Diff a candidate against the approved skill it updates (base is null for
  // brand-new candidates).
  server.handle(RPC_CHANNELS.skillsPending.DIFF, async (_ctx, workspaceId: string, slug: string): Promise<PendingSkillDiff> => {
    const queue = queueFor(workspaceId)
    if (!queue) throw new Error('Workspace not found')
    return queue.diff(slug)
  })

  // Dismiss a candidate: removes it and logs it for anti-repeat.
  server.handle(RPC_CHANNELS.skillsPending.DISMISS, async (_ctx, workspaceId: string, slug: string, description?: string) => {
    const queue = queueFor(workspaceId)
    if (!queue) throw new Error('Workspace not found')
    queue.dismiss(slug, description)
    deps.platform.logger?.info(`SKILLS_PENDING_DISMISS: dismissed '${slug}' in ${workspaceId}`)
    broadcastChanged(workspaceId)
    return true
  })
}
