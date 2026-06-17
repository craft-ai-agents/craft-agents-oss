import { createHash } from 'node:crypto'
import type { Workspace } from '@craft-agent/core/types'
import { getRegisteredUserWorkspaceOwnerByWorkspaceId } from '@craft-agent/shared/config'

export interface TurnTraceContext {
  schemaVersion: 1
  userId: string
  userIdSource: 'user_workspace_registry' | 'workspace_fallback'
  authProvider?: 'feishu'
  feishuOpenId?: string
  feishuOpenIdHash?: string
  workspaceId: string
  workspaceRootHash: string
  sessionId: string
  sessionName?: string
  turnId: string
  userMessageId: string
  model?: string
  connectionSlug?: string
}

export interface BuildTurnTraceContextInput {
  workspace: Workspace
  sessionId: string
  sessionName?: string
  userMessageId: string
  model?: string
  connectionSlug?: string
}

function hashStable(value: string, length = 16): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

export function buildTurnTraceContext(input: BuildTurnTraceContextInput): TurnTraceContext {
  const owner = getRegisteredUserWorkspaceOwnerByWorkspaceId(input.workspace.id)
  const workspaceRootHash = hashStable(input.workspace.rootPath)

  if (owner) {
    const openIdHash = hashStable(owner.openId)
    return {
      schemaVersion: 1,
      userId: `feishu:${openIdHash}`,
      userIdSource: 'user_workspace_registry',
      authProvider: 'feishu',
      feishuOpenId: owner.openId,
      feishuOpenIdHash: openIdHash,
      workspaceId: input.workspace.id,
      workspaceRootHash,
      sessionId: input.sessionId,
      sessionName: input.sessionName,
      turnId: input.userMessageId,
      userMessageId: input.userMessageId,
      model: input.model,
      connectionSlug: input.connectionSlug,
    }
  }

  return {
    schemaVersion: 1,
    userId: `workspace:${hashStable(input.workspace.id)}`,
    userIdSource: 'workspace_fallback',
    workspaceId: input.workspace.id,
    workspaceRootHash,
    sessionId: input.sessionId,
    sessionName: input.sessionName,
    turnId: input.userMessageId,
    userMessageId: input.userMessageId,
    model: input.model,
    connectionSlug: input.connectionSlug,
  }
}
