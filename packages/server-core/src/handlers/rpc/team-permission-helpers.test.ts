import { beforeEach, describe, expect, it, mock } from 'bun:test'

const getWorkspaceByNameOrId = mock((workspaceId: string) => workspaces.find((workspace) => workspace.id === workspaceId) ?? null)
const getWorkspaces = mock(() => workspaces)
const readGlobalSourcesManifest = mock((rootPath: string) => ({
  version: 1,
  activatedSlugs: manifests[rootPath] ?? [],
  lastModified: '2026-07-01T00:00:00.000Z',
}))
const assertTeamPermission = mock((rootPath: string, action: string) => {
  if (rootPath === deniedRootPath) {
    throw new Error(`Team permission denied for ${action}: owner-required`)
  }
  return { allowed: true, action, role: 'owner', machineId: 'machine-1' }
})

let workspaces: Array<{ id: string; name: string; slug: string; rootPath: string; createdAt: string }> = []
let manifests: Record<string, string[]> = {}
let deniedRootPath = ''

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId,
  getWorkspaces,
}))

mock.module('@craft-agent/shared/sources', () => ({
  readGlobalSourcesManifest,
}))

mock.module('@craft-agent/shared/workspaces', () => ({
  assertTeamPermission,
}))

const {
  assertGlobalSourceCredentialPermission,
  assertSessionFilesWritePermission,
  assertWorkspaceSecretsUpdatePermission,
} = await import('./team-permission-helpers')

beforeEach(() => {
  workspaces = [
    { id: 'origin', name: 'Origin', slug: 'origin', rootPath: '/origin', createdAt: '2026-07-01T00:00:00.000Z' },
    { id: 'active', name: 'Active', slug: 'active', rootPath: '/active', createdAt: '2026-07-01T00:00:00.000Z' },
    { id: 'inactive', name: 'Inactive', slug: 'inactive', rootPath: '/inactive', createdAt: '2026-07-01T00:00:00.000Z' },
  ]
  manifests = {
    '/active': ['github'],
    '/inactive': ['notion'],
  }
  deniedRootPath = ''
  getWorkspaceByNameOrId.mockClear()
  getWorkspaces.mockClear()
  readGlobalSourcesManifest.mockClear()
  assertTeamPermission.mockClear()
})

describe('assertGlobalSourceCredentialPermission', () => {
  it('requires secrets.update for the origin workspace and every workspace using the global source', () => {
    assertGlobalSourceCredentialPermission('origin', 'github')

    expect(assertTeamPermission).toHaveBeenCalledTimes(2)
    expect(assertTeamPermission).toHaveBeenNthCalledWith(1, '/origin', 'secrets.update')
    expect(assertTeamPermission).toHaveBeenNthCalledWith(2, '/active', 'secrets.update')
  })

  it('blocks global credential updates when an affected workspace denies secrets.update', () => {
    deniedRootPath = '/active'

    expect(() => assertGlobalSourceCredentialPermission('origin', 'github'))
      .toThrow('requires secrets.update in workspace active')
  })

  it('throws when the origin workspace does not exist', () => {
    expect(() => assertGlobalSourceCredentialPermission('missing', 'github'))
      .toThrow('Workspace not found: missing')
  })
})

describe('assertWorkspaceSecretsUpdatePermission', () => {
  it('returns the workspace after secrets.update passes', () => {
    const workspace = assertWorkspaceSecretsUpdatePermission('origin', 'Remote workspace credentials update')

    expect(workspace).toMatchObject({ id: 'origin', rootPath: '/origin' })
    expect(assertTeamPermission).toHaveBeenCalledWith('/origin', 'secrets.update')
  })

  it('blocks workspace secret updates when secrets.update is denied', () => {
    deniedRootPath = '/origin'

    expect(() => assertWorkspaceSecretsUpdatePermission('origin', 'Remote workspace credentials update'))
      .toThrow('Remote workspace credentials update requires secrets.update in workspace origin')
  })
})

describe('assertSessionFilesWritePermission', () => {
  it('requires files.write for the session workspace', async () => {
    const sessionManager = { getSession: mock(async () => ({ workspaceId: 'origin' })) }

    await expect(assertSessionFilesWritePermission(sessionManager, 's1', 'origin', 'Session model update'))
      .resolves.toEqual({ workspaceId: 'origin' })

    expect(assertTeamPermission).toHaveBeenCalledWith('/origin', 'files.write')
  })

  it('rejects workspace mismatch before checking permissions', async () => {
    const sessionManager = { getSession: mock(async () => ({ workspaceId: 'active' })) }

    await expect(assertSessionFilesWritePermission(sessionManager, 's1', 'origin', 'Session model update'))
      .rejects.toThrow('Session s1 does not belong to workspace origin')
    expect(assertTeamPermission).not.toHaveBeenCalled()
  })

  it('blocks session writes when files.write is denied', async () => {
    deniedRootPath = '/origin'
    const sessionManager = { getSession: mock(async () => ({ workspaceId: 'origin' })) }

    await expect(assertSessionFilesWritePermission(sessionManager, 's1', 'origin', 'Session model update'))
      .rejects.toThrow('Session model update requires files.write in workspace origin')
  })
})
