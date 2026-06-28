import { describe, expect, test } from 'bun:test'
import {
  buildMissionBrief,
  extractMissionBrief,
  hasSaveableMissionBrief,
  parseMissionBriefDoc,
  serializeMissionBriefBody,
} from './mission-brief'
import type { ContextDocDTO } from '../../shared/types'

describe('mission brief utilities', () => {
  test('extracts a usable brief from casual artist context', () => {
    const result = extractMissionBrief(
      'It is a dark pop single called "Night Drive" releasing June 30. The goal is to push presaves and make people feel freedom mixed with withdrawal. Visuals look like neon, empty rooms, and late night highways. References like The Weeknd, Lorde, and Drive. This is for heartbroken city kids on TikTok and Spotify.',
    )

    expect(result.brief.missionType).toBe('single')
    expect(result.brief.title).toBe('Night Drive')
    expect(result.brief.timeline).toBe('June 30')
    expect(result.brief.mood).toContain('freedom')
    expect(result.brief.visualWorld).toContain('neon')
    expect(result.brief.references?.map((ref) => ref.value)).toContain('The Weeknd')
    expect(result.brief.channels).toContain('tiktok')
    expect(result.brief.completeness).toBeGreaterThanOrEqual(70)
  })

  test('round-trips through a workspace context doc body', () => {
    const brief = buildMissionBrief('workspace-1', {
      missionType: 'single',
      title: 'Night Drive',
      goal: 'Build release-week momentum.',
      timeline: 'June 30',
      mood: 'dark pop tension',
    })
    const body = serializeMissionBriefBody(brief)
    const parsed = parseMissionBriefDoc({
      slug: 'mission-brief',
      metadata: {
        name: 'Mission Brief: Night Drive',
        routing: { mode: 'broadcast' },
        enabled: true,
      },
      body,
      path: '/tmp/context/mission-brief',
      workspaceRootPath: '/tmp/workspace',
    } as ContextDocDTO)

    expect(parsed?.title).toBe('Night Drive')
    expect(parsed?.workspaceId).toBe('workspace-1')
    expect(parsed?.status).toBe('full')
  })

  test('keeps mission type focused on release format', () => {
    const result = extractMissionBrief(
      'This campaign needs merch, a video, tour content, and rollout support for the release.',
    )

    expect(result.brief.missionType).toBeUndefined()
  })

  test('does not allow saving a brief with only a release type', () => {
    expect(hasSaveableMissionBrief({ missionType: 'single' })).toBe(false)
    expect(hasSaveableMissionBrief({ title: 'Night Drive' })).toBe(true)
    expect(hasSaveableMissionBrief({ goal: 'Plan the release week.' })).toBe(true)
  })
})
