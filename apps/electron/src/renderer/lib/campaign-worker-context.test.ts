import { describe, expect, test } from 'bun:test'
import type { MissionAssetManifest } from '../../shared/types'
import type { ArtistProfile } from './artist-profile'
import { buildMissionBrief } from './mission-brief'
import {
  campaignWorkerContextMetadata,
  getCampaignWorkerReadiness,
  serializeCampaignWorkerContext,
} from './campaign-worker-context'

const artistProfile: ArtistProfile = {
  version: 1,
  artistName: 'HNlC',
  sound: 'Dark pop with cinematic hooks.',
  audience: 'Heartbroken city kids who live on TikTok.',
  updatedAt: '2026-06-30T00:00:00.000Z',
}

function manifest(kinds: Array<'master' | 'lyrics' | 'cover-art'>): MissionAssetManifest {
  return {
    version: 1,
    workspaceId: 'workspace-1',
    assetsRoot: 'assets',
    storageMode: 'copied',
    files: kinds.map((kind) => ({
      id: `asset-${kind}`,
      kind,
      label: kind,
      relativePath: `assets/${kind}.txt`,
      source: 'copy',
      status: 'available',
      usableByAgents: true,
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
    })),
    updatedAt: '2026-06-30T00:00:00.000Z',
  }
}

describe('campaign worker context', () => {
  test('identifies the next practical missing step', () => {
    const mission = buildMissionBrief('workspace-1', {
      missionType: 'single',
      title: 'Night Drive',
      goal: 'Build presave momentum.',
      timeline: 'June 30',
    })

    const readiness = getCampaignWorkerReadiness({ mission, artistProfile, assetManifest: manifest([]) })

    expect(readiness.ready).toBe(false)
    expect(readiness.nextMove).toBe('Add the master or demo in Campaign Assets.')
    expect(readiness.missing).toContain('Master or demo')
    expect(readiness.missing).toContain('Cover art')
  })

  test('serializes campaign, artist, and asset context for workers', () => {
    const mission = buildMissionBrief('workspace-1', {
      missionType: 'single',
      title: 'Night Drive',
      goal: 'Build presave momentum.',
      timeline: 'June 30',
      targetListener: 'Night-drive pop fans.',
    })

    const body = serializeCampaignWorkerContext({
      mission,
      artistProfile,
      assetManifest: manifest(['master', 'lyrics', 'cover-art']),
    })
    const readiness = getCampaignWorkerReadiness({
      mission,
      artistProfile,
      assetManifest: manifest(['master', 'lyrics', 'cover-art']),
    })

    expect(readiness.ready).toBe(true)
    expect(campaignWorkerContextMetadata(readiness).routing).toEqual({ mode: 'broadcast' })
    expect(campaignWorkerContextMetadata(readiness).priority).toBe('high')
    expect(body).toContain('Next move: Ready to launch workers from this campaign context.')
    expect(body).toContain('"title": "Night Drive"')
    expect(body).toContain('"name": "HNlC"')
    expect(body).toContain('"master": "assets/master.txt"')
  })
})
