import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const MISSION_BRIEF_CONTEXT_SLUG = 'mission-brief'

export type MissionStatus = 'empty' | 'light' | 'full'
export type MissionType = 'single' | 'ep' | 'album' | 'other'

export interface MissionReference {
  type: 'artist' | 'song' | 'visual' | 'brand' | 'other'
  value: string
}

export interface MissionBrief {
  id: string
  workspaceId: string
  status: MissionStatus
  completeness: number
  missionType?: MissionType
  title?: string
  goal?: string
  timeline?: string
  releaseDate?: string
  promoBudget?: string
  mood?: string
  visualWorld?: string
  references?: MissionReference[]
  targetListener?: string
  channels?: string[]
  openQuestions?: string[]
  rawNotes?: string
  confirmedAt?: string
  updatedAt: string
}

export interface MissionExtraction {
  brief: Partial<MissionBrief>
  missing: string[]
  enhancedSummary: string
}

const REQUIRED_FIELDS: Array<keyof MissionBrief> = ['missionType', 'title', 'goal', 'timeline']
const RECOMMENDED_FIELDS: Array<keyof MissionBrief> = ['promoBudget', 'mood', 'visualWorld', 'references', 'targetListener', 'channels']

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  return trimmed || undefined
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function inferMissionType(text: string): MissionType | undefined {
  const lower = text.toLowerCase()
  if (/\b(ep)\b/.test(lower)) return 'ep'
  if (/\balbum\b/.test(lower)) return 'album'
  if (/\bsingle\b|\bsong\b|\btrack\b/.test(lower)) return 'single'
  return undefined
}

function inferTitle(text: string): string | undefined {
  const quoted = text.match(/["']([^"']{2,80})["']/)
  if (quoted?.[1]) return clean(quoted[1])

  const named = text.match(/\b(?:called|named|titled|title is|song is|single is|ep is|album is)\s+([A-Z0-9][A-Za-z0-9 '&!-]{1,80})/i)
  if (named?.[1]) {
    return clean(named[1].replace(/\b(?:and|with|for|about|on|by)\b.*$/i, ''))
  }

  return undefined
}

function inferTimeline(text: string): string | undefined {
  const date = text.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\b/i)
    ?? text.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/)
    ?? text.match(/\b\d{4}-\d{2}-\d{2}\b/)
  if (date?.[0]) return clean(date[0])

  const relative = text.match(/\b(?:next week|this week|next month|this month|in \d+ weeks?|in \d+ days?|release week|pre-save|presave)\b/i)
  return clean(relative?.[0])
}

function inferGoal(text: string): string | undefined {
  const goal = text.match(/\b(?:goal is|trying to|want to|need to|mission is|focus is)\s+([^.!?]{8,180})/i)
  if (goal?.[1]) return clean(goal[1])
  if (text.length > 18) return clean(text.slice(0, 180))
  return undefined
}

function inferMood(text: string): string | undefined {
  const mood = text.match(/\b(?:feels like|mood is|vibe is|about|ethos is|make people feel|should feel like)\s+([^.!?]{5,160})/i)
  return clean(mood?.[1])
}

function inferVisualWorld(text: string): string | undefined {
  const visual = text.match(/\b(?:visuals?|looks like|world is|aesthetic is|imagery is)\s+([^.!?]{5,180})/i)
  return clean(visual?.[1])
}

function inferReferences(text: string): MissionReference[] | undefined {
  const refMatch = text.match(/\b(?:references?|similar to|inspired by)\s+([^.!?]{3,180})/i)
    ?? text.match(/\blike\s+([^.!?]{3,180})/i)
  const raw = refMatch?.[1]
  if (!raw) return undefined
  const values = unique(
    raw
      .split(/,| and | plus |\/|\s\+\s/i)
      .map((value) => value.replace(/^(?:like|similar to|inspired by)\s+/i, ''))
      .slice(0, 6),
  )
  if (values.length === 0) return undefined
  return values.map((value) => ({ type: 'other', value }))
}

function inferTargetListener(text: string): string | undefined {
  const target = text.match(/\b(?:for|target listener is|audience is|listener is)\s+([^.!?]{8,160})/i)
  return clean(target?.[1])
}

function inferChannels(text: string): string[] | undefined {
  const channels = unique(
    ['tiktok', 'instagram', 'youtube', 'spotify', 'apple music', 'x', 'twitter', 'soundcloud']
      .filter((channel) => text.toLowerCase().includes(channel)),
  )
  return channels.length > 0 ? channels : undefined
}

export function calculateMissionCompleteness(brief: Partial<MissionBrief>): number {
  const requiredScore = REQUIRED_FIELDS.filter((field) => Boolean(brief[field])).length / REQUIRED_FIELDS.length
  const recommendedScore = RECOMMENDED_FIELDS.filter((field) => {
    const value = brief[field]
    return Array.isArray(value) ? value.length > 0 : Boolean(value)
  }).length / RECOMMENDED_FIELDS.length
  return Math.round((requiredScore * 0.7 + recommendedScore * 0.3) * 100)
}

export function getMissionStatus(brief: Partial<MissionBrief>): MissionStatus {
  const completeness = calculateMissionCompleteness(brief)
  if (completeness >= 70) return 'full'
  if (completeness > 0) return 'light'
  return 'empty'
}

export function hasSaveableMissionBrief(brief: Partial<MissionBrief>): boolean {
  return Boolean(clean(brief.title) || clean(brief.goal))
}

export function extractMissionBrief(text: string, existing: Partial<MissionBrief> = {}): MissionExtraction {
  const extracted: Partial<MissionBrief> = {
    ...existing,
    missionType: existing.missionType ?? inferMissionType(text),
    title: existing.title ?? inferTitle(text),
    goal: existing.goal ?? inferGoal(text),
    timeline: existing.timeline ?? inferTimeline(text),
    releaseDate: existing.releaseDate ?? inferTimeline(text),
    mood: existing.mood ?? inferMood(text),
    visualWorld: existing.visualWorld ?? inferVisualWorld(text),
    references: existing.references?.length ? existing.references : inferReferences(text),
    targetListener: existing.targetListener ?? inferTargetListener(text),
    channels: existing.channels?.length ? existing.channels : inferChannels(text),
    rawNotes: clean([existing.rawNotes, text].filter(Boolean).join('\n\n')),
  }
  const completeness = calculateMissionCompleteness(extracted)
  const status = getMissionStatus(extracted)
  const missing = [...REQUIRED_FIELDS, ...RECOMMENDED_FIELDS]
    .filter((field) => {
      const value = extracted[field]
      return Array.isArray(value) ? value.length === 0 : !value
    })
    .map((field) => field.toString())

  return {
    brief: {
      ...extracted,
      completeness,
      status,
    },
    missing,
    enhancedSummary: buildEnhancedSummary(extracted, missing),
  }
}

export function buildMissionBrief(workspaceId: string, input: Partial<MissionBrief>): MissionBrief {
  const now = new Date().toISOString()
  const completeness = calculateMissionCompleteness(input)
  const releaseDate = clean(input.releaseDate) ?? normalizeDeadline(input.timeline)
  return {
    id: input.id || MISSION_BRIEF_CONTEXT_SLUG,
    workspaceId,
    status: getMissionStatus(input),
    completeness,
    missionType: input.missionType,
    title: clean(input.title),
    goal: clean(input.goal),
    timeline: clean(input.timeline),
    releaseDate,
    promoBudget: clean(input.promoBudget),
    mood: clean(input.mood),
    visualWorld: clean(input.visualWorld),
    references: input.references?.filter((ref) => clean(ref.value)),
    targetListener: clean(input.targetListener),
    channels: input.channels?.filter(Boolean),
    openQuestions: input.openQuestions?.filter(Boolean),
    rawNotes: clean(input.rawNotes),
    confirmedAt: input.confirmedAt || now,
    updatedAt: now,
  }
}

export function missionBriefMetadata(brief: MissionBrief): ContextDocMetadata {
  return {
    name: brief.title ? `Mission Brief: ${brief.title}` : 'Mission Brief',
    description: 'Current creative mission context for command center and agents.',
    routing: { mode: 'broadcast' },
    enabled: true,
    status: brief.status === 'empty' ? undefined : 'active',
    priority: brief.status === 'full' ? 'high' : 'normal',
    deadline: normalizeDeadline(brief.releaseDate) ?? normalizeDeadline(brief.timeline),
  }
}

export function serializeMissionBriefBody(brief: MissionBrief): string {
  return [
    'This context is the current creative mission brief. Treat it as mission-scoped context, not global creator identity.',
    '',
    '```json',
    JSON.stringify(brief, null, 2),
    '```',
    '',
    '## Working Summary',
    '',
    buildEnhancedSummary(brief, brief.openQuestions ?? []),
  ].join('\n')
}

export function missionBriefContentKey(brief: MissionBrief): string {
  return JSON.stringify({
    missionType: brief.missionType ?? null,
    title: brief.title ?? null,
    goal: brief.goal ?? null,
    timeline: brief.timeline ?? null,
    releaseDate: brief.releaseDate ?? null,
    promoBudget: brief.promoBudget ?? null,
    mood: brief.mood ?? null,
    visualWorld: brief.visualWorld ?? null,
    references: brief.references ?? [],
    targetListener: brief.targetListener ?? null,
    channels: brief.channels ?? [],
    openQuestions: brief.openQuestions ?? [],
    rawNotes: brief.rawNotes ?? null,
  })
}

export function parseMissionBriefDoc(doc: ContextDocDTO | undefined | null): MissionBrief | null {
  if (!doc) return null
  const fenced = doc.body.match(/```json\s*([\s\S]*?)\s*```/i)
  const raw = fenced?.[1]
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<MissionBrief>
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.workspaceId || !parsed.updatedAt) return null
    return buildMissionBrief(parsed.workspaceId, parsed)
  } catch {
    return null
  }
}

export function emptyMissionBrief(workspaceId: string): MissionBrief {
  return buildMissionBrief(workspaceId, {
    status: 'empty',
    completeness: 0,
    openQuestions: ['What are we building toward?'],
  })
}

function normalizeDeadline(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return undefined
}

function buildEnhancedSummary(brief: Partial<MissionBrief>, missing: string[]): string {
  const lines = [
    brief.title ? `Mission: ${brief.title}` : 'Mission: untitled',
    brief.missionType ? `Type: ${brief.missionType}` : null,
    brief.goal ? `Goal: ${brief.goal}` : null,
    brief.timeline ? `Release target: ${brief.timeline}` : null,
    brief.promoBudget ? `Promo budget: ${brief.promoBudget}` : null,
    brief.mood ? `Mood: ${brief.mood}` : null,
    brief.visualWorld ? `Visual world: ${brief.visualWorld}` : null,
    brief.targetListener ? `Target listener: ${brief.targetListener}` : null,
    brief.references?.length ? `References: ${brief.references.map((ref) => ref.value).join(', ')}` : null,
    missing.length ? `Missing: ${missing.slice(0, 5).join(', ')}` : 'Missing: none blocking',
  ].filter(Boolean)
  return lines.join('\n')
}
