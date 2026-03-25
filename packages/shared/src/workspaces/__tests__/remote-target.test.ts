import { describe, expect, it } from 'bun:test'
import {
  buildRemoteWorkspaceTargetId,
  isRemoteWorkspace,
  isRemoteWorkspaceTargetId,
  parseRemoteWorkspaceTargetId,
} from '../remote-target.ts'

describe('remote workspace target ids', () => {
  it('builds and parses stable remote target ids', () => {
    const targetId = buildRemoteWorkspaceTargetId('server-1', 'workspace-9')

    expect(targetId).toBe('remote:server-1:workspace-9')
    expect(isRemoteWorkspaceTargetId(targetId)).toBe(true)
    expect(parseRemoteWorkspaceTargetId(targetId)).toEqual({
      serverId: 'server-1',
      workspaceId: 'workspace-9',
    })
  })

  it('rejects malformed remote target ids', () => {
    expect(parseRemoteWorkspaceTargetId('workspace-9')).toBeNull()
    expect(parseRemoteWorkspaceTargetId('remote:')).toBeNull()
    expect(parseRemoteWorkspaceTargetId('remote:server-only')).toBeNull()
    expect(parseRemoteWorkspaceTargetId('remote::workspace-only')).toBeNull()
  })

  it('detects remote workspace metadata without changing local workspaces', () => {
    expect(isRemoteWorkspace({
      id: 'remote:server-1:workspace-9',
      name: 'Remote Workspace',
      rootPath: '/ignored',
      createdAt: Date.now(),
      isRemote: true,
      remoteServerId: 'server-1',
      remoteWorkspaceId: 'workspace-9',
    })).toBe(true)

    expect(isRemoteWorkspace({
      id: 'local-1',
      name: 'Local Workspace',
      rootPath: '/tmp/local',
      createdAt: Date.now(),
    })).toBe(false)
  })
})
