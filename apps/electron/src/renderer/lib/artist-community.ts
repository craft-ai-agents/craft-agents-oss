import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_COMMUNITY_CONTEXT_SLUG = 'artist-community'

export type CommunitySegment = 'vip' | 'local' | 'buyers' | 'street-team' | 'general'
export type EmailJobStatus = 'draft' | 'needs-gmail' | 'queued' | 'sent'

export interface CommunityContact {
  id: string
  name: string
  email: string
  segment: CommunitySegment
  source?: string
  city?: string
  lastContacted?: string
  notes?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface CommunityEmailJob {
  id: string
  title: string
  audience: string
  status: EmailJobStatus
  scheduledFor?: string
  createdAt: string
  updatedAt: string
}

export interface ArtistCommunity {
  version: 1
  contacts: CommunityContact[]
  emailJobs: CommunityEmailJob[]
  updatedAt: string
}

export type ArtistCommunityParseResult =
  | { ok: true; community: ArtistCommunity }
  | { ok: false; community: ArtistCommunity; error: string }

export function artistCommunityMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Community',
    description: 'Fan contacts, email segments, and outreach queue for the artist.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function emptyArtistCommunity(): ArtistCommunity {
  return {
    version: 1,
    contacts: [],
    emailJobs: [],
    updatedAt: new Date().toISOString(),
  }
}

export function parseArtistCommunityDocResult(doc: ContextDocDTO | undefined): ArtistCommunityParseResult {
  if (!doc?.body.trim()) return { ok: true, community: emptyArtistCommunity() }
  const json = extractJson(doc.body)
  if (!json) {
    return {
      ok: false,
      community: emptyArtistCommunity(),
      error: 'Artist Community exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistCommunity>
    if (parsed.version !== 1 || !Array.isArray(parsed.contacts)) {
      return {
        ok: false,
        community: emptyArtistCommunity(),
        error: 'Artist Community JSON has an unsupported shape.',
      }
    }
    return {
      ok: true,
      community: {
        version: 1,
        contacts: parsed.contacts.filter(isCommunityContact).map(normalizeContact),
        emailJobs: Array.isArray(parsed.emailJobs) ? parsed.emailJobs.filter(isCommunityEmailJob).map(normalizeEmailJob) : [],
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      },
    }
  } catch {
    return {
      ok: false,
      community: emptyArtistCommunity(),
      error: 'Artist Community JSON is malformed.',
    }
  }
}

export function serializeArtistCommunityBody(community: ArtistCommunity): string {
  const sorted: ArtistCommunity = {
    version: 1,
    contacts: [...community.contacts].sort((a, b) => a.name.localeCompare(b.name)),
    emailJobs: [...community.emailJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    updatedAt: new Date().toISOString(),
  }
  return [
    'This is global artist community context: fans, email segments, and outreach jobs.',
    '',
    '```json',
    JSON.stringify(sorted, null, 2),
    '```',
  ].join('\n')
}

export function createCommunityContact(input: {
  name: string
  email: string
  segment: CommunitySegment
  source?: string
  city?: string
  notes?: string
  tags?: string
}): CommunityContact {
  const now = new Date().toISOString()
  return {
    id: `fan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim(),
    email: input.email.trim(),
    segment: input.segment,
    source: clean(input.source),
    city: clean(input.city),
    notes: clean(input.notes),
    tags: parseTags(input.tags),
    createdAt: now,
    updatedAt: now,
  }
}

export function createCommunityEmailJob(input: {
  title: string
  audience: string
  status?: EmailJobStatus
  scheduledFor?: string
}): CommunityEmailJob {
  const now = new Date().toISOString()
  return {
    id: `email-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: input.title.trim(),
    audience: input.audience.trim(),
    status: input.status ?? 'draft',
    scheduledFor: clean(input.scheduledFor),
    createdAt: now,
    updatedAt: now,
  }
}

export function segmentLabel(segment: CommunitySegment): string {
  switch (segment) {
    case 'vip':
      return 'VIP'
    case 'local':
      return 'Local'
    case 'buyers':
      return 'Buyer'
    case 'street-team':
      return 'Street'
    case 'general':
      return 'General'
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

function parseTags(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function normalizeContact(contact: CommunityContact): CommunityContact {
  return {
    ...contact,
    name: contact.name.trim(),
    email: contact.email.trim(),
    segment: normalizeSegment(contact.segment),
    source: clean(contact.source),
    city: clean(contact.city),
    lastContacted: clean(contact.lastContacted),
    notes: clean(contact.notes),
    tags: Array.isArray(contact.tags) ? contact.tags.map(String).map((tag) => tag.trim()).filter(Boolean) : [],
    createdAt: typeof contact.createdAt === 'string' ? contact.createdAt : new Date().toISOString(),
    updatedAt: typeof contact.updatedAt === 'string' ? contact.updatedAt : new Date().toISOString(),
  }
}

function normalizeEmailJob(job: CommunityEmailJob): CommunityEmailJob {
  return {
    ...job,
    title: job.title.trim(),
    audience: job.audience.trim(),
    status: normalizeEmailJobStatus(job.status),
    scheduledFor: clean(job.scheduledFor),
    createdAt: typeof job.createdAt === 'string' ? job.createdAt : new Date().toISOString(),
    updatedAt: typeof job.updatedAt === 'string' ? job.updatedAt : new Date().toISOString(),
  }
}

function normalizeSegment(segment: string): CommunitySegment {
  if (segment === 'vip' || segment === 'local' || segment === 'buyers' || segment === 'street-team' || segment === 'general') return segment
  return 'general'
}

function normalizeEmailJobStatus(status: string): EmailJobStatus {
  if (status === 'draft' || status === 'needs-gmail' || status === 'queued' || status === 'sent') return status
  return 'draft'
}

function isCommunityContact(value: unknown): value is CommunityContact {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as CommunityContact).name === 'string' &&
    typeof (value as CommunityContact).email === 'string',
  )
}

function isCommunityEmailJob(value: unknown): value is CommunityEmailJob {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as CommunityEmailJob).title === 'string' &&
    typeof (value as CommunityEmailJob).audience === 'string',
  )
}
