import type { OutputAssetDTO, OutputManifestDTO } from '@/hooks/useOutputs'

export interface VideoProjectSummary {
  title: string
  aspectRatio?: string
  width?: number
  height?: number
  fps?: number
  mediaCount: number
  trackCount: number
  clipCount: number
  durationMs: number
  versionCount: number
  latestEvent?: string
}

export function isVideoProjectAsset(asset: OutputAssetDTO | undefined): asset is OutputAssetDTO {
  const path = asset?.path.toLowerCase() ?? ''
  const label = asset?.label.toLowerCase() ?? ''
  return path.endsWith('video.runner-video.json')
    || path.endsWith('.runner-video.json')
    || label.includes('video.runner-video.json')
}

export function findVideoProjectAsset(manifest: OutputManifestDTO): OutputAssetDTO | undefined {
  return manifest.assets.find(isVideoProjectAsset)
}

export function summarizeVideoProject(value: unknown): VideoProjectSummary | null {
  if (!value || typeof value !== 'object') return null
  const project = value as {
    title?: unknown
    settings?: { aspectRatio?: unknown; width?: unknown; height?: unknown; fps?: unknown }
    media?: unknown[]
    timeline?: { durationMs?: unknown; tracks?: Array<{ clips?: unknown[] }> }
    versions?: unknown[]
    agentEvents?: Array<{ summary?: unknown }>
  }
  if (typeof project.title !== 'string') return null
  const tracks = Array.isArray(project.timeline?.tracks) ? project.timeline.tracks : []
  const clipCount = tracks.reduce((sum, track) => sum + (Array.isArray(track.clips) ? track.clips.length : 0), 0)
  const latestEventValue = [...(project.agentEvents ?? [])].reverse().find((event) => typeof event.summary === 'string')?.summary
  return {
    title: project.title,
    aspectRatio: typeof project.settings?.aspectRatio === 'string' ? project.settings.aspectRatio : undefined,
    width: typeof project.settings?.width === 'number' ? project.settings.width : undefined,
    height: typeof project.settings?.height === 'number' ? project.settings.height : undefined,
    fps: typeof project.settings?.fps === 'number' ? project.settings.fps : undefined,
    mediaCount: Array.isArray(project.media) ? project.media.length : 0,
    trackCount: tracks.length,
    clipCount,
    durationMs: typeof project.timeline?.durationMs === 'number' ? project.timeline.durationMs : 0,
    versionCount: Array.isArray(project.versions) ? project.versions.length : 0,
    latestEvent: typeof latestEventValue === 'string' ? latestEventValue : undefined,
  }
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
