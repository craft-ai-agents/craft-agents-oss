import { describe, expect, test } from 'bun:test'
import type { ContextDocDTO } from '../../shared/types'
import {
  calendarEventsForWorkspace,
  createCalendarEvent,
  linkCalendarEventToWorkspace,
  parseArtistCalendarDocResult,
  serializeArtistCalendarBody,
} from './artist-calendar'

function makeDoc(body: string): ContextDocDTO {
  return {
    slug: 'artist-calendar',
    metadata: {
      name: 'Artist Calendar',
      routing: { mode: 'broadcast' },
      enabled: true,
    },
    body,
    path: '/tmp/context/artist-calendar',
    workspaceRootPath: '/tmp',
  } as ContextDocDTO
}

describe('artist calendar utilities', () => {
  test('backfills old events with link and google sync fields', () => {
    const result = parseArtistCalendarDocResult(makeDoc([
      '```json',
      JSON.stringify({
        version: 1,
        events: [{
          id: 'event-1',
          date: '2026-07-01',
          title: 'Cover deadline',
          createdAt: '2026-06-30T00:00:00.000Z',
          updatedAt: '2026-06-30T00:00:00.000Z',
        }],
        updatedAt: '2026-06-30T00:00:00.000Z',
      }),
      '```',
    ].join('\n')))

    expect(result.ok).toBe(true)
    expect(result.calendar.events[0]?.workspaceLinks).toEqual([])
    expect(result.calendar.events[0]?.relatedPersonIds).toEqual([])
  })

  test('links events to campaign workspaces and round-trips Google sync ids', () => {
    const event = linkCalendarEventToWorkspace(createCalendarEvent({
      date: '2026-07-01',
      title: 'Cover deadline',
      relatedPersonIds: ['person-1'],
    }), {
      workspaceId: 'campaign-1',
      workspaceName: 'Midnight Sun',
      role: 'release deadline',
    })
    const body = serializeArtistCalendarBody({
      version: 1,
      events: [{
        ...event,
        google: {
          calendarId: 'primary',
          eventId: 'google-event-1',
          syncStatus: 'synced',
          lastSyncedAt: '2026-06-30T00:00:00.000Z',
        },
      }],
      updatedAt: '2026-06-30T00:00:00.000Z',
    })

    const result = parseArtistCalendarDocResult(makeDoc(body))

    expect(result.ok).toBe(true)
    expect(calendarEventsForWorkspace(result.calendar.events, 'campaign-1')).toHaveLength(1)
    expect(result.calendar.events[0]?.workspaceLinks[0]?.workspaceName).toBe('Midnight Sun')
    expect(result.calendar.events[0]?.google?.eventId).toBe('google-event-1')
    expect(result.calendar.events[0]?.relatedPersonIds).toEqual(['person-1'])
  })

  test('normalizes workspace links on creation', () => {
    const event = createCalendarEvent({
      date: '2026-07-01',
      title: 'Cover deadline',
      workspaceLink: {
        workspaceId: ' campaign-1 ',
        workspaceName: ' Midnight Sun ',
        role: ' release deadline ',
        notes: ' lock assets ',
      },
    })

    expect(event.workspaceLinks[0]).toMatchObject({
      workspaceId: 'campaign-1',
      workspaceName: 'Midnight Sun',
      role: 'release deadline',
      notes: 'lock assets',
    })
  })
})
