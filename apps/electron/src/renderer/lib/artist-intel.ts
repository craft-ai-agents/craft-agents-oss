import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_INTEL_CONFIG_CONTEXT_SLUG = 'artist-intel-config'
export const ARTIST_INTEL_REPORT_CONTEXT_SLUG = 'artist-intel-report'

export interface ArtistIntelSource {
  id: string
  name: string
  url: string
  priority: 'high' | 'medium' | 'low'
  notes?: string
}

export interface ArtistIntelConfig {
  version: 1
  enabled: boolean
  cadence: 'manual' | 'weekly'
  maxPerChannel: number
  sinceDays: number
  sources: ArtistIntelSource[]
  updatedAt: string
}

export interface ArtistIntelReport {
  version: 1
  status: 'idle' | 'queued' | 'ready' | 'failed'
  title?: string
  summary?: string
  sessionId?: string
  generatedAt?: string
  sourceCount: number
  videoCount?: number
  updatedAt: string
}

export type ArtistIntelConfigParseResult =
  | { ok: true; config: ArtistIntelConfig }
  | { ok: false; config: ArtistIntelConfig; error: string }

export type ArtistIntelReportParseResult =
  | { ok: true; report: ArtistIntelReport }
  | { ok: false; report: ArtistIntelReport; error: string }

export const DEFAULT_ARTIST_INTEL_SOURCES: ArtistIntelSource[] = [
  {
    id: 'managers-playbook',
    name: 'Managers Playbook',
    url: 'https://www.youtube.com/@managersplaybook',
    priority: 'high',
    notes: 'Manager/operator intelligence for artist career strategy.',
  },
  {
    id: 'viral-vsn',
    name: 'Viral VSN',
    url: 'https://www.youtube.com/@Viralvsn',
    priority: 'high',
    notes: 'Viral trends, artist branding, social strategy, and campaign angles.',
  },
  {
    id: 'no-labels-necessary',
    name: 'No Labels Necessary',
    url: 'https://www.youtube.com/@NoLabelsNecessaryOfficial',
    priority: 'high',
    notes: 'Independent music marketing, release strategy, fan growth, and music-business operating plays.',
  },
  {
    id: 'neighborhood-art-supply',
    name: 'Neighborhood Art Supply',
    url: 'https://www.youtube.com/@NeighborhoodArtSupply',
    priority: 'high',
    notes: 'Artist branding and creative identity signals.',
  },
]

export function artistIntelConfigMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Intel Pulse Config',
    description: 'Standing YouTube channel watchlist and cadence for HQ Intel Pulse.',
    routing: { mode: 'targeted', agents: ['youtube-research-agent', 'youtube-intelligence-agent'] },
    enabled: true,
  }
}

export function artistIntelReportMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Intel Report',
    description: 'Latest HQ YouTube Intel Pulse run status and report summary.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function emptyArtistIntelConfig(): ArtistIntelConfig {
  return {
    version: 1,
    enabled: false,
    cadence: 'weekly',
    maxPerChannel: 3,
    sinceDays: 7,
    sources: DEFAULT_ARTIST_INTEL_SOURCES,
    updatedAt: new Date().toISOString(),
  }
}

export function emptyArtistIntelReport(): ArtistIntelReport {
  return {
    version: 1,
    status: 'idle',
    sourceCount: 0,
    updatedAt: new Date().toISOString(),
  }
}

export function parseArtistIntelConfigDocResult(doc: ContextDocDTO | undefined): ArtistIntelConfigParseResult {
  if (!doc?.body.trim()) return { ok: true, config: emptyArtistIntelConfig() }
  const json = extractJson(doc.body)
  if (!json) {
    return {
      ok: false,
      config: emptyArtistIntelConfig(),
      error: 'Artist Intel config exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistIntelConfig>
    if (parsed.version !== 1) {
      return {
        ok: false,
        config: emptyArtistIntelConfig(),
        error: 'Artist Intel config JSON has an unsupported shape.',
      }
    }
    return { ok: true, config: normalizeIntelConfig(parsed) }
  } catch {
    return {
      ok: false,
      config: emptyArtistIntelConfig(),
      error: 'Artist Intel config JSON is malformed.',
    }
  }
}

export function parseArtistIntelReportDocResult(doc: ContextDocDTO | undefined): ArtistIntelReportParseResult {
  if (!doc?.body.trim()) return { ok: true, report: emptyArtistIntelReport() }
  const json = extractJson(doc.body)
  if (!json) {
    return {
      ok: false,
      report: emptyArtistIntelReport(),
      error: 'Artist Intel report exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistIntelReport>
    if (parsed.version !== 1) {
      return {
        ok: false,
        report: emptyArtistIntelReport(),
        error: 'Artist Intel report JSON has an unsupported shape.',
      }
    }
    return { ok: true, report: normalizeIntelReport(parsed) }
  } catch {
    return {
      ok: false,
      report: emptyArtistIntelReport(),
      error: 'Artist Intel report JSON is malformed.',
    }
  }
}

export function serializeArtistIntelConfigBody(config: ArtistIntelConfig): string {
  return [
    'HQ Intel Pulse configuration. These are the standing YouTube sources the artist wants watched.',
    '',
    '```json',
    JSON.stringify(normalizeIntelConfig(config), null, 2),
    '```',
  ].join('\n')
}

export function serializeArtistIntelReportBody(report: ArtistIntelReport): string {
  return [
    'Latest HQ Intel Pulse report status. The linked session contains the full working run.',
    '',
    '```json',
    JSON.stringify(normalizeIntelReport(report), null, 2),
    '```',
  ].join('\n')
}

export function createIntelRunPrompt(config: ArtistIntelConfig, artistName: string): string {
  const sources = config.sources
    .filter((source) => source.name.trim() && source.url.trim())
    .map((source, index) => `${index + 1}. ${source.name} (${source.url}) - ${source.notes || source.priority}`)
    .join('\n')

  return [
    `Run the HQ YouTube Intel Pulse for ${artistName || 'this artist'}.`,
    '',
    'Watchlist:',
    sources || '- No configured sources. Ask the user to add YouTube channels first.',
    '',
    `Scan window: last ${config.sinceDays} days. Max videos per channel: ${config.maxPerChannel}.`,
    '',
    'Use the YouTube Research tool in read-only mode.',
    'For each configured channel, check recent uploads, pull transcripts where available, and write a concise artist-facing intel report.',
    '',
    'Report shape:',
    '1. What changed or is worth noticing',
    '2. Source/video links',
    '3. Why it matters for this artist',
    '4. Suggested campaign/content/brand moves',
    '5. Confidence and missing data',
    '',
    'Reject generic music-business filler. Do not publish, comment, upload, or modify any YouTube account.',
  ].join('\n')
}

function normalizeIntelConfig(config: Partial<ArtistIntelConfig>): ArtistIntelConfig {
  const maxPerChannel = Number.isInteger(config.maxPerChannel) ? Number(config.maxPerChannel) : 3
  const sinceDays = Number.isInteger(config.sinceDays) ? Number(config.sinceDays) : 7
  const sources = Array.isArray(config.sources)
    ? config.sources.map(normalizeSource).filter((source) => source.name && source.url)
    : DEFAULT_ARTIST_INTEL_SOURCES

  return {
    version: 1,
    enabled: Boolean(config.enabled),
    cadence: config.cadence === 'manual' ? 'manual' : 'weekly',
    maxPerChannel: clamp(maxPerChannel, 1, 10),
    sinceDays: clamp(sinceDays, 1, 30),
    sources: sources.length ? sources : DEFAULT_ARTIST_INTEL_SOURCES,
    updatedAt: clean(config.updatedAt) || new Date().toISOString(),
  }
}

function normalizeIntelReport(report: Partial<ArtistIntelReport>): ArtistIntelReport {
  const status = report.status === 'queued' || report.status === 'ready' || report.status === 'failed'
    ? report.status
    : 'idle'
  return {
    version: 1,
    status,
    title: clean(report.title),
    summary: clean(report.summary),
    sessionId: clean(report.sessionId),
    generatedAt: clean(report.generatedAt),
    sourceCount: Number.isInteger(report.sourceCount) ? Math.max(0, Number(report.sourceCount)) : 0,
    videoCount: Number.isInteger(report.videoCount) ? Math.max(0, Number(report.videoCount)) : undefined,
    updatedAt: clean(report.updatedAt) || new Date().toISOString(),
  }
}

function normalizeSource(source: Partial<ArtistIntelSource>, index: number): ArtistIntelSource {
  const name = clean(source.name) || ''
  const url = clean(source.url) || ''
  const priority = source.priority === 'medium' || source.priority === 'low' ? source.priority : 'high'
  return {
    id: clean(source.id) || slugify(name || url || `source-${index + 1}`),
    name,
    url,
    priority,
    notes: clean(source.notes),
  }
}

function extractJson(body: string): string | null {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return body.slice(start, end + 1)
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'source'
}
