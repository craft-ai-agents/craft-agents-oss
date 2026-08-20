import { describe, expect, it } from 'bun:test'
import type { WorkspaceCreationResult } from '../../../shared/types'
import {
  buildTeamSpaceCreateArguments,
  resolveWorkspaceCreation,
} from './workspace-creation-contract'

const workspace: WorkspaceCreationResult = {
  id: 'workspace_1',
  name: 'Design',
  slug: 'design',
  rootPath: '/tmp/design',
  createdAt: 1,
}

const activation = {
  workspaceId: workspace.id,
  activeWorkspaceId: workspace.id,
  session: {
    id: 'session_1',
    createdAt: 2,
    lastUsedAt: 2,
  },
}

describe('TeamSpace creation contract', () => {
  it('requires a nonblank organization and creates a local-only team request', () => {
    expect(() => buildTeamSpaceCreateArguments('/tmp/design', 'Design', '   ')).toThrow(
      'organization is required',
    )

    expect(buildTeamSpaceCreateArguments('/tmp/design', 'Design', ' org_123 ')).toEqual([
      '/tmp/design',
      'Design',
      undefined,
      { kind: 'team', orgId: 'org_123' },
    ])
  })

  it('only treats local creation as successful after activation commits', () => {
    expect(() => resolveWorkspaceCreation(workspace, true)).toThrow(
      'without activating the new workspace',
    )

    expect(resolveWorkspaceCreation({ ...workspace, activation }, true)).toEqual({
      workspace,
      activation,
    })
  })

  it('preserves the existing remote workspace response without claiming local activation', () => {
    expect(resolveWorkspaceCreation(workspace, false)).toEqual({ workspace })
  })
})
