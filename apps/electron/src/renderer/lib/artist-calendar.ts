import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_CALENDAR_CONTEXT_SLUG = 'artist-calendar'

export interface ArtistWorkspaceLink {
  workspaceId: string
  workspaceName?: string
  role?: string
  notes?: string
  linkedAt: string
}

export interface GoogleCalendarSyncState {
  calendarId?: string
  eventId?: string
  htmlLink?: string
  etag?: string
  syncStatus?: 'not-synced' | 'synced' | 'local-change' | 'remote-change' | 'conflict' | 'error'
  lastSyncedAt?: string
  error?: string
}

export interface ArtistCalendarEvent {
  id: string
  date: string
  title: string
  time?: string
  notes?: string
  workspaceLinks: ArtistWorkspaceLink[]
  relatedPersonIds: string[]
  google?: GoogleCalendarSyncState
  createdAt: string
  updatedAt: string
}

export interface ArtistCalendar {
  version: 1
  events: ArtistCalendarEvent[]
  updatedAt: string
}

export type ArtistCalendarParseResult =
  | { ok: true; calendar: ArtistCalendar }
  | { ok: false; calendar: ArtistCalendar; error: string }

export function artistCalendarMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Calendar',
    description: 'Global dates, deadlines, meetings, releases, and reminders for the artist.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function emptyArtistCalendar(): ArtistCalendar {
  return {
    version: 1,
    events: [],
    updatedAt: new Date().toISOString(),
  }
}

export function parseArtistCalendarDocResult(doc: ContextDocDTO | undefined): ArtistCalendarParseResult {
  if (!doc?.body.trim()) return { ok: true, calendar: emptyArtistCalendar() }
  const json = extractJson(doc.body)
  if (!json) {
    return {
      ok: false,
      calendar: emptyArtistCalendar(),
      error: 'Artist Calendar exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistCalendar>
    if (parsed.version !== 1 || !Array.isArray(parsed.events)) {
      return {
        ok: false,
        calendar: emptyArtistCalendar(),
        error: 'Artist Calendar JSON has an unsupported shape.',
      }
    }
    return {
      ok: true,
      calendar: {
        version: 1,
        events: parsed.events.filter(isCalendarEvent).map(normalizeCalendarEvent),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      },
    }
  } catch {
    return {
      ok: false,
      calendar: emptyArtistCalendar(),
      error: 'Artist Calendar JSON is malformed.',
    }
  }
}

export function serializeArtistCalendarBody(calendar: ArtistCalendar): string {
  const sorted = {
    version: 1,
    events: [...calendar.events].sort((a, b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`)),
    updatedAt: new Date().toISOString(),
  }
  return [
    'This is global artist calendar context. Treat it as long-term creator context, not one-campaign context.',
    '',
    '```json',
    JSON.stringify(sorted, null, 2),
    '```',
  ].join('\n')
}

export function createCalendarEvent(input: {
  date: string
  title: string
  time?: string
  notes?: string
  workspaceLink?: Omit<ArtistWorkspaceLink, 'linkedAt'>
  relatedPersonIds?: string[]
}): ArtistCalendarEvent {
  const now = new Date().toISOString()
  return {
    id: `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date: input.date,
    title: input.title.trim(),
    time: clean(input.time),
    notes: clean(input.notes),
    workspaceLinks: input.workspaceLink ? normalizeWorkspaceLinks([{ ...input.workspaceLink, linkedAt: now }]) : [],
    relatedPersonIds: normalizeIds(input.relatedPersonIds),
    createdAt: now,
    updatedAt: now,
  }
}

export function linkCalendarEventToWorkspace(
  event: ArtistCalendarEvent,
  link: Omit<ArtistWorkspaceLink, 'linkedAt'>,
): ArtistCalendarEvent {
  const nextLinks = upsertWorkspaceLink(event.workspaceLinks, link)
  return {
    ...event,
    workspaceLinks: nextLinks,
    updatedAt: new Date().toISOString(),
  }
}

export function unlinkCalendarEventFromWorkspace(
  event: ArtistCalendarEvent,
  workspaceId: string,
): ArtistCalendarEvent {
  return {
    ...event,
    workspaceLinks: event.workspaceLinks.filter((link) => link.workspaceId !== workspaceId),
    updatedAt: new Date().toISOString(),
  }
}

export function calendarEventsForWorkspace(events: ArtistCalendarEvent[], workspaceId: string): ArtistCalendarEvent[] {
  return events.filter((event) => event.workspaceLinks.some((link) => link.workspaceId === workspaceId))
}

export function attachPersonToCalendarEvent(event: ArtistCalendarEvent, personId: string): ArtistCalendarEvent {
  return {
    ...event,
    relatedPersonIds: normalizeIds([...event.relatedPersonIds, personId]),
    updatedAt: new Date().toISOString(),
  }
}

function extractJson(body: string): string | null {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1]
  const firstBrace = body.indexOf('{')
  const lastBrace = body.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace <= firstBrace) return null
  return body.slice(firstBrace, lastBrace + 1)
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  return trimmed || undefined
}

function normalizeCalendarEvent(event: ArtistCalendarEvent): ArtistCalendarEvent {
  return {
    ...event,
    title: event.title.trim(),
    time: clean(event.time),
    notes: clean(event.notes),
    workspaceLinks: normalizeWorkspaceLinks(event.workspaceLinks),
    relatedPersonIds: normalizeIds(event.relatedPersonIds),
    google: normalizeGoogleSync(event.google),
    updatedAt: typeof event.updatedAt === 'string' ? event.updatedAt : new Date().toISOString(),
    createdAt: typeof event.createdAt === 'string' ? event.createdAt : new Date().toISOString(),
  }
}

function upsertWorkspaceLink(
  links: ArtistWorkspaceLink[],
  link: Omit<ArtistWorkspaceLink, 'linkedAt'>,
): ArtistWorkspaceLink[] {
  const now = new Date().toISOString()
  const cleanLink = normalizeWorkspaceLinks([{ ...link, linkedAt: now }])[0]
  if (!cleanLink) return links
  const next = links.filter((existing) => existing.workspaceId !== cleanLink.workspaceId)
  return [...next, cleanLink]
}

function normalizeWorkspaceLinks(value: unknown): ArtistWorkspaceLink[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((link): link is ArtistWorkspaceLink => typeof link?.workspaceId === 'string' && Boolean(link.workspaceId.trim()))
    .map((link) => ({
      workspaceId: link.workspaceId.trim(),
      workspaceName: clean(link.workspaceName),
      role: clean(link.role),
      notes: clean(link.notes),
      linkedAt: typeof link.linkedAt === 'string' ? link.linkedAt : new Date().toISOString(),
    }))
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))]
}

function normalizeGoogleSync(value: unknown): GoogleCalendarSyncState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as GoogleCalendarSyncState
  return {
    calendarId: clean(candidate.calendarId),
    eventId: clean(candidate.eventId),
    htmlLink: clean(candidate.htmlLink),
    etag: clean(candidate.etag),
    syncStatus: normalizeSyncStatus(candidate.syncStatus),
    lastSyncedAt: clean(candidate.lastSyncedAt),
    error: clean(candidate.error),
  }
}

function normalizeSyncStatus(value: unknown): GoogleCalendarSyncState['syncStatus'] {
  return value === 'not-synced'
    || value === 'synced'
    || value === 'local-change'
    || value === 'remote-change'
    || value === 'conflict'
    || value === 'error'
    ? value
    : undefined
}

function isCalendarEvent(value: unknown): value is ArtistCalendarEvent {
  const candidate = value as Partial<ArtistCalendarEvent>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.date) &&
    typeof candidate.title === 'string'
  )
}
