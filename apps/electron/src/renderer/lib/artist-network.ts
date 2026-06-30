import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_NETWORK_CONTEXT_SLUG = 'artist-network'

export type ArtistNetworkCategory = string

export interface ArtistNetworkCategoryDefinition {
  id: ArtistNetworkCategory
  label: string
}

export interface ArtistWorkspaceLink {
  workspaceId: string
  workspaceName?: string
  role?: string
  notes?: string
  linkedAt: string
}

export interface GooglePeopleSyncState {
  resourceName?: string
  etag?: string
  syncStatus?: 'not-synced' | 'synced' | 'local-change' | 'remote-change' | 'conflict' | 'error'
  lastSyncedAt?: string
  error?: string
}

export interface ArtistNetworkPerson {
  id: string
  name: string
  category: ArtistNetworkCategory
  role?: string
  contact?: string
  socials?: string
  location?: string
  relationship?: 'new' | 'warm' | 'strong' | 'vip'
  lastTouch?: string
  canHelpWith?: string
  tags: string[]
  notes?: string
  workspaceLinks: ArtistWorkspaceLink[]
  google?: GooglePeopleSyncState
  createdAt: string
  updatedAt: string
}

export interface ArtistNetwork {
  version: 1
  categories: ArtistNetworkCategoryDefinition[]
  people: ArtistNetworkPerson[]
  updatedAt: string
}

export type ArtistNetworkParseResult =
  | { ok: true; network: ArtistNetwork }
  | { ok: false; network: ArtistNetwork; error: string }

export const NETWORK_CATEGORIES: ArtistNetworkCategoryDefinition[] = [
  { id: 'key', label: 'Key' },
  { id: 'music', label: 'Music' },
  { id: 'collaborators', label: 'Collaborators' },
  { id: 'djs', label: 'DJs' },
  { id: 'producers', label: 'Producers' },
  { id: 'press', label: 'Press' },
  { id: 'playlist-curators', label: 'Playlist Curators' },
  { id: 'influencers', label: 'Influencers' },
  { id: 'design', label: 'Design' },
  { id: 'video', label: 'Video' },
  { id: 'venues', label: 'Venues' },
  { id: 'brands', label: 'Brands' },
  { id: 'fans-vips', label: 'Fans / VIPs' },
  { id: 'other', label: 'Other' },
]

export function artistNetworkMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Network',
    description: 'Global people, contacts, and relationship context for the artist.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function emptyArtistNetwork(): ArtistNetwork {
  return {
    version: 1,
    categories: NETWORK_CATEGORIES,
    people: [],
    updatedAt: new Date().toISOString(),
  }
}

export function parseArtistNetworkDoc(doc: ContextDocDTO | undefined): ArtistNetwork {
  return parseArtistNetworkDocResult(doc).network
}

export function parseArtistNetworkDocResult(doc: ContextDocDTO | undefined): ArtistNetworkParseResult {
  if (!doc?.body.trim()) return { ok: true, network: emptyArtistNetwork() }
  const json = extractJson(doc.body)
  if (!json) {
    return {
      ok: false,
      network: emptyArtistNetwork(),
      error: 'Artist Network exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistNetwork>
    if (parsed.version !== 1 || !Array.isArray(parsed.people)) {
      return {
        ok: false,
        network: emptyArtistNetwork(),
        error: 'Artist Network JSON has an unsupported shape.',
      }
    }
    return {
      ok: true,
      network: {
        version: 1,
        categories: normalizeCategories(parsed.categories),
        people: parsed.people.filter(isPerson).map(normalizePerson),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      },
    }
  } catch {
    return {
      ok: false,
      network: emptyArtistNetwork(),
      error: 'Artist Network JSON is malformed.',
    }
  }
}

export function updateNetworkPerson(
  person: ArtistNetworkPerson,
  input: {
    name: string
    category: ArtistNetworkCategory
    role?: string
    contact?: string
    notes?: string
    canHelpWith?: string
    tags?: string
    workspaceLink?: Omit<ArtistWorkspaceLink, 'linkedAt'>
  },
): ArtistNetworkPerson {
  const workspaceLinks = input.workspaceLink
    ? upsertWorkspaceLink(person.workspaceLinks, input.workspaceLink)
    : person.workspaceLinks
  return {
    ...person,
    name: input.name.trim(),
    category: input.category,
    role: clean(input.role),
    contact: clean(input.contact),
    notes: clean(input.notes),
    canHelpWith: clean(input.canHelpWith),
    tags: parseTags(input.tags),
    workspaceLinks,
    updatedAt: new Date().toISOString(),
  }
}

export function createNetworkCategory(label: string, existingCategories: ArtistNetworkCategoryDefinition[]): ArtistNetworkCategoryDefinition {
  const cleanLabel = label.replace(/\s+/g, ' ').trim()
  const base = slugify(cleanLabel || 'category')
  const existingIds = new Set(existingCategories.map((category) => category.id))
  let id = base
  let count = 2
  while (existingIds.has(id)) {
    id = `${base}-${count}`
    count += 1
  }
  return {
    id,
    label: cleanLabel || 'Category',
  }
}

export function createNetworkPerson(input: {
  name: string
  category: ArtistNetworkCategory
  role?: string
  contact?: string
  notes?: string
  canHelpWith?: string
  tags?: string
  workspaceLink?: Omit<ArtistWorkspaceLink, 'linkedAt'>
}): ArtistNetworkPerson {
  const now = new Date().toISOString()
  return {
    id: `person-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim(),
    category: input.category,
    role: clean(input.role),
    contact: clean(input.contact),
    notes: clean(input.notes),
    canHelpWith: clean(input.canHelpWith),
    relationship: 'new',
    tags: parseTags(input.tags),
    workspaceLinks: input.workspaceLink ? normalizeWorkspaceLinks([{ ...input.workspaceLink, linkedAt: now }]) : [],
    createdAt: now,
    updatedAt: now,
  }
}

export function linkNetworkPersonToWorkspace(
  person: ArtistNetworkPerson,
  link: Omit<ArtistWorkspaceLink, 'linkedAt'>,
): ArtistNetworkPerson {
  return {
    ...person,
    workspaceLinks: upsertWorkspaceLink(person.workspaceLinks, link),
    updatedAt: new Date().toISOString(),
  }
}

export function unlinkNetworkPersonFromWorkspace(
  person: ArtistNetworkPerson,
  workspaceId: string,
): ArtistNetworkPerson {
  return {
    ...person,
    workspaceLinks: person.workspaceLinks.filter((link) => link.workspaceId !== workspaceId),
    updatedAt: new Date().toISOString(),
  }
}

export function networkPeopleForWorkspace(people: ArtistNetworkPerson[], workspaceId: string): ArtistNetworkPerson[] {
  return people.filter((person) => person.workspaceLinks.some((link) => link.workspaceId === workspaceId))
}

function normalizeNetwork(network: ArtistNetwork): ArtistNetwork {
  return {
    version: 1,
    categories: normalizeCategories(network.categories),
    people: network.people,
    updatedAt: new Date().toISOString(),
  }
}

export function serializeArtistNetworkBody(network: ArtistNetwork): string {
  const sorted = {
    ...normalizeNetwork(network),
    people: [...network.people].sort((a, b) => a.name.localeCompare(b.name)),
  }
  return [
    'This is global artist relationship context. Treat it as long-term creator context, not one-campaign context.',
    '',
    '```json',
    JSON.stringify(sorted, null, 2),
    '```',
  ].join('\n')
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

function normalizePerson(person: ArtistNetworkPerson): ArtistNetworkPerson {
  return {
    ...person,
    name: person.name.trim(),
    role: clean(person.role),
    contact: clean(person.contact),
    socials: clean(person.socials),
    location: clean(person.location),
    relationship: normalizeRelationship(person.relationship),
    lastTouch: clean(person.lastTouch),
    canHelpWith: clean(person.canHelpWith),
    tags: Array.isArray(person.tags) ? person.tags.map(String).map((tag) => tag.trim()).filter(Boolean) : [],
    notes: clean(person.notes),
    workspaceLinks: normalizeWorkspaceLinks(person.workspaceLinks),
    google: normalizeGoogleSync(person.google),
    createdAt: typeof person.createdAt === 'string' ? person.createdAt : new Date().toISOString(),
    updatedAt: typeof person.updatedAt === 'string' ? person.updatedAt : new Date().toISOString(),
  }
}

function upsertWorkspaceLink(
  links: ArtistWorkspaceLink[],
  link: Omit<ArtistWorkspaceLink, 'linkedAt'>,
): ArtistWorkspaceLink[] {
  const cleanLink = normalizeWorkspaceLinks([{ ...link, linkedAt: new Date().toISOString() }])[0]
  if (!cleanLink) return links
  return [...links.filter((existing) => existing.workspaceId !== cleanLink.workspaceId), cleanLink]
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

function normalizeGoogleSync(value: unknown): GooglePeopleSyncState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as GooglePeopleSyncState
  return {
    resourceName: clean(candidate.resourceName),
    etag: clean(candidate.etag),
    syncStatus: normalizeSyncStatus(candidate.syncStatus),
    lastSyncedAt: clean(candidate.lastSyncedAt),
    error: clean(candidate.error),
  }
}

function normalizeSyncStatus(value: unknown): GooglePeopleSyncState['syncStatus'] {
  return value === 'not-synced'
    || value === 'synced'
    || value === 'local-change'
    || value === 'remote-change'
    || value === 'conflict'
    || value === 'error'
    ? value
    : undefined
}

function normalizeRelationship(value: unknown): ArtistNetworkPerson['relationship'] {
  return value === 'new' || value === 'warm' || value === 'strong' || value === 'vip' ? value : 'new'
}

function normalizeCategories(categories: unknown): ArtistNetworkCategoryDefinition[] {
  const customCategories = Array.isArray(categories)
    ? categories.filter(isCategory).map((category) => ({
      id: slugify(category.id),
      label: category.label.replace(/\s+/g, ' ').trim(),
    }))
    : []

  const merged = new Map<string, ArtistNetworkCategoryDefinition>()
  for (const category of [...NETWORK_CATEGORIES, ...customCategories]) {
    if (!category.id || !category.label) continue
    merged.set(category.id, category)
  }
  return [...merged.values()]
}

function isCategory(value: unknown): value is ArtistNetworkCategoryDefinition {
  const candidate = value as Partial<ArtistNetworkCategoryDefinition>
  return typeof candidate.id === 'string' && typeof candidate.label === 'string'
}

function isPerson(value: unknown): value is ArtistNetworkPerson {
  const candidate = value as Partial<ArtistNetworkPerson>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.category === 'string' &&
    Array.isArray(candidate.tags)
  )
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'category'
}
