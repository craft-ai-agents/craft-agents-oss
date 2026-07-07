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

let workspaces: Array<{ id: string; rootPath: string }> = []
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

const { assertGlobalSourceCredentialPermission } = await import('./team-permission-helpers')

beforeEach(() => {
  workspaces = [
    { id: 'origin', rootPath: '/origin' },
    { id: 'active', rootPath: '/active' },
    { id: 'inactive', rootPath: '/inactive' },
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
