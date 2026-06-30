import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_CALENDAR_CONTEXT_SLUG = 'artist-calendar'

export interface ArtistCalendarEvent {
  id: string
  date: string
  title: string
  time?: string
  notes?: string
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
        events: parsed.events.filter(isCalendarEvent),
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
}): ArtistCalendarEvent {
  const now = new Date().toISOString()
  return {
    id: `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date: input.date,
    title: input.title.trim(),
    time: clean(input.time),
    notes: clean(input.notes),
    createdAt: now,
    updatedAt: now,
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

function isCalendarEvent(value: unknown): value is ArtistCalendarEvent {
  const candidate = value as Partial<ArtistCalendarEvent>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.date) &&
    typeof candidate.title === 'string'
  )
}
