import { describe, expect, it } from 'bun:test'
import type { Workspace } from '../../../../shared/types'
import { getTeamSpacesForOrganization } from '../organization-team-spaces'

const workspaces: Workspace[] = [
  {
    id: 'team-a',
    name: 'Team A',
    slug: 'team-a',
    rootPath: '/tmp/team-a',
    createdAt: 1,
    kind: 'team',
    orgId: 'org-a',
  },
  {
    id: 'team-b',
    name: 'Team B',
    slug: 'team-b',
    rootPath: '/tmp/team-b',
    createdAt: 1,
    kind: 'team',
    orgId: 'org-b',
  },
  {
    id: 'personal',
    name: 'Personal',
    slug: 'personal',
    rootPath: '/tmp/personal',
    createdAt: 1,
    kind: 'personal',
    orgId: 'org-a',
  },
]

describe('getTeamSpacesForOrganization', () => {
  it('shows only TeamSpaces atomically linked to the selected organization', () => {
    expect(getTeamSpacesForOrganization(workspaces, ' org-a ')).toEqual([workspaces[0]])
  })

  it('does not infer an organization relationship for personal or unselected workspaces', () => {
    expect(getTeamSpacesForOrganization(workspaces, null)).toEqual([])
    expect(getTeamSpacesForOrganization(workspaces, '   ')).toEqual([])
  })
})
