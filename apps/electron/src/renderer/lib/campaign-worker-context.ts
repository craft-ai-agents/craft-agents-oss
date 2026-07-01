import type { ContextDocMetadata, MissionAssetManifest, MissionAssetRecord } from '../../shared/types'
import type { ArtistProfile } from './artist-profile'
import type { MissionBrief } from './mission-brief'

export const CAMPAIGN_WORKER_CONTEXT_SLUG = 'campaign-worker-context'

export interface CampaignWorkerReadiness {
  ready: boolean
  nextMove: string
  missing: string[]
  essentials: {
    campaignBrief: boolean
    artistProfile: boolean
    master: boolean
    lyrics: boolean
    coverArt: boolean
  }
}

export interface CampaignWorkerContextInput {
  mission: MissionBrief
  artistProfile?: ArtistProfile | null
  assetManifest?: MissionAssetManifest | null
}

export function campaignWorkerContextMetadata(readiness: CampaignWorkerReadiness): ContextDocMetadata {
  return {
    name: 'Campaign Worker Context',
    description: 'Worker-ready digest of campaign brief, artist profile, and mission assets.',
    routing: { mode: 'broadcast' },
    enabled: true,
    status: readiness.ready ? 'active' : undefined,
    priority: readiness.ready ? 'high' : 'normal',
  }
}

export function getCampaignWorkerReadiness(input: CampaignWorkerContextInput): CampaignWorkerReadiness {
  const files = availableFiles(input.assetManifest)
  const essentials = {
    campaignBrief: input.mission.status !== 'empty' && Boolean(input.mission.title || input.mission.goal),
    artistProfile: Boolean(input.artistProfile?.artistName || input.artistProfile?.bio || input.artistProfile?.sound),
    master: hasKind(files, ['master', 'demo']),
    lyrics: hasKind(files, ['lyrics']),
    coverArt: hasKind(files, ['cover-art']),
  }
  const missing = [
    essentials.campaignBrief ? null : 'Campaign brief',
    essentials.artistProfile ? null : 'Artist profile',
    essentials.master ? null : 'Master or demo',
    essentials.coverArt ? null : 'Cover art',
    input.mission.targetListener || input.artistProfile?.audience ? null : 'Target listener',
  ].filter((value): value is string => Boolean(value))

  return {
    ready: missing.length === 0,
    nextMove: nextMove(essentials, input),
    missing,
    essentials,
  }
}

export function serializeCampaignWorkerContext(input: CampaignWorkerContextInput): string {
  const readiness = getCampaignWorkerReadiness(input)
  const files = availableFiles(input.assetManifest)
  const payload = {
    campaign: {
      type: input.mission.missionType ?? null,
      title: input.mission.title ?? null,
      goal: input.mission.goal ?? null,
      releaseTarget: input.mission.timeline ?? input.mission.releaseDate ?? null,
      promoBudget: input.mission.promoBudget ?? null,
      mood: input.mission.mood ?? null,
      visualWorld: input.mission.visualWorld ?? null,
      targetListener: input.mission.targetListener ?? input.artistProfile?.audience ?? null,
      references: input.mission.references ?? [],
      channels: input.mission.channels ?? [],
    },
    artist: {
      name: input.artistProfile?.artistName ?? null,
      aliases: input.artistProfile?.aliases ?? null,
      sound: input.artistProfile?.sound ?? null,
      visualWorld: input.artistProfile?.visualWorld ?? null,
      audience: input.artistProfile?.audience ?? null,
      similarArtists: input.artistProfile?.similarArtists ?? null,
      priorityMarkets: input.artistProfile?.priorityMarkets ?? null,
      rules: input.artistProfile?.rules ?? null,
    },
    assets: {
      master: firstPath(files, ['master', 'demo']),
      lyrics: firstPath(files, ['lyrics']),
      coverArt: firstPath(files, ['cover-art']),
      rawVideoCount: countKinds(files, ['raw-video']),
      finalVideoCount: countKinds(files, ['edited-video', 'final-video']),
      photoCount: countKinds(files, ['press-photo']),
      referenceCount: countKinds(files, ['moodboard-image', 'audio-reference']),
    },
    readiness,
  }

  return [
    'Use this as the compact handoff before workers act. It combines the campaign brief, artist identity, and available mission assets.',
    '',
    `Next move: ${readiness.nextMove}`,
    readiness.missing.length ? `Missing: ${readiness.missing.join(', ')}` : 'Missing: none',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n')
}

function nextMove(essentials: CampaignWorkerReadiness['essentials'], input: CampaignWorkerContextInput): string {
  if (!essentials.campaignBrief) return 'Create the campaign brief.'
  if (!essentials.artistProfile) return 'Add the artist profile in HQ.'
  if (!essentials.master) return 'Add the master or demo in Campaign Assets.'
  if (!essentials.coverArt) return 'Add cover art in Campaign Assets.'
  if (!input.mission.targetListener && !input.artistProfile?.audience) return 'Add the target listener.'
  if (!essentials.lyrics) return 'Add lyrics when available.'
  return 'Ready to launch workers from this campaign context.'
}

function availableFiles(manifest: MissionAssetManifest | null | undefined): MissionAssetRecord[] {
  return manifest?.files.filter((file) => file.status === 'available') ?? []
}

function hasKind(files: MissionAssetRecord[], kinds: MissionAssetRecord['kind'][]): boolean {
  return files.some((file) => kinds.includes(file.kind))
}

function firstPath(files: MissionAssetRecord[], kinds: MissionAssetRecord['kind'][]): string | null {
  const file = files.find((record) => kinds.includes(record.kind))
  return file?.relativePath ?? file?.absolutePath ?? null
}

function countKinds(files: MissionAssetRecord[], kinds: MissionAssetRecord['kind'][]): number {
  return files.filter((file) => kinds.includes(file.kind)).length
}
