import { describe, expect, test } from 'bun:test'
import type { ContextDocDTO } from '../../shared/types'
import {
  createNetworkPerson,
  linkNetworkPersonToWorkspace,
  networkPeopleForWorkspace,
  parseArtistNetworkDocResult,
  serializeArtistNetworkBody,
} from './artist-network'

function makeDoc(body: string): ContextDocDTO {
  return {
    slug: 'artist-network',
    metadata: {
      name: 'Artist Network',
      routing: { mode: 'broadcast' },
      enabled: true,
    },
    body,
    path: '/tmp/context/artist-network',
    workspaceRootPath: '/tmp',
  } as ContextDocDTO
}

describe('artist network utilities', () => {
  test('backfills old people with workspace and google sync fields', () => {
    const result = parseArtistNetworkDocResult(makeDoc([
      '```json',
      JSON.stringify({
        version: 1,
        people: [{
          id: 'person-1',
          name: 'Sarah Kim',
          category: 'press',
          tags: ['pr'],
          createdAt: '2026-06-30T00:00:00.000Z',
          updatedAt: '2026-06-30T00:00:00.000Z',
        }],
        updatedAt: '2026-06-30T00:00:00.000Z',
      }),
      '```',
    ].join('\n')))

    expect(result.ok).toBe(true)
    expect(result.network.people[0]?.workspaceLinks).toEqual([])
    expect(result.network.people[0]?.relationship).toBe('new')
  })

  test('links people to campaign workspaces and round-trips Google People ids', () => {
    const person = linkNetworkPersonToWorkspace(createNetworkPerson({
      name: 'Sarah Kim',
      category: 'press',
      role: 'PR',
      tags: 'press, launch',
    }), {
      workspaceId: 'campaign-1',
      workspaceName: 'Midnight Sun',
      role: 'PR contact',
    })
    const body = serializeArtistNetworkBody({
      version: 1,
      categories: [{ id: 'press', label: 'Press' }],
      people: [{
        ...person,
        google: {
          resourceName: 'people/c123',
          syncStatus: 'synced',
          lastSyncedAt: '2026-06-30T00:00:00.000Z',
        },
      }],
      updatedAt: '2026-06-30T00:00:00.000Z',
    })

    const result = parseArtistNetworkDocResult(makeDoc(body))

    expect(result.ok).toBe(true)
    expect(networkPeopleForWorkspace(result.network.people, 'campaign-1')).toHaveLength(1)
    expect(result.network.people[0]?.workspaceLinks[0]?.role).toBe('PR contact')
    expect(result.network.people[0]?.google?.resourceName).toBe('people/c123')
  })

  test('normalizes workspace links on creation', () => {
    const person = createNetworkPerson({
      name: 'Sarah Kim',
      category: 'press',
      workspaceLink: {
        workspaceId: ' campaign-1 ',
        workspaceName: ' Midnight Sun ',
        role: ' PR contact ',
        notes: ' pitch first ',
      },
    })

    expect(person.workspaceLinks[0]).toMatchObject({
      workspaceId: 'campaign-1',
      workspaceName: 'Midnight Sun',
      role: 'PR contact',
      notes: 'pitch first',
    })
  })
})
