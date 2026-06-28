import type {
  ContextDocMetadata,
  MissionAssetManifest,
  MissionAssetRecord,
} from '../../shared/types'

export const MISSION_ASSET_CONTEXT_SLUG = 'mission-assets'

export function missionAssetContextMetadata(): ContextDocMetadata {
  return {
    name: 'Mission Assets',
    description: 'Local files attached to this creative mission.',
    routing: { mode: 'broadcast' },
    enabled: true,
    status: 'active',
    priority: 'normal',
  }
}

export function serializeMissionAssetContext(manifest: MissionAssetManifest): string {
  return [
    'This context lists local files attached to the current mission. These are mission vault copies unless a record says otherwise. Do not assume every file has been analyzed. Use tools to inspect files when needed.',
    '',
    '```json',
    JSON.stringify(manifest, null, 2),
    '```',
    '',
    '## Key Assets',
    '',
    ...keyAssetLines(manifest.files),
    '',
    '## Asset Buckets',
    '',
    ...bucketLines(manifest.files),
  ].join('\n')
}

function keyAssetLines(files: MissionAssetRecord[]): string[] {
  const master = firstPath(files, 'master')
  const lyrics = firstPath(files, 'lyrics')
  const cover = firstPath(files, 'cover-art')
  return [
    `- Master: ${master ?? 'missing'}`,
    `- Cover art: ${cover ?? 'missing'}`,
    `- Lyrics: ${lyrics ?? 'missing'}`,
  ]
}

function bucketLines(files: MissionAssetRecord[]): string[] {
  const available = files.filter((file) => file.status === 'available')
  return [
    `- Audio files: ${countKinds(available, ['master', 'demo', 'stem', 'audio-reference'])}`,
    `- Raw video: ${countKinds(available, ['raw-video'])}`,
    `- Finished video: ${countKinds(available, ['edited-video', 'final-video'])}`,
    `- Photos: ${countKinds(available, ['press-photo'])}`,
    `- Visual references: ${countKinds(available, ['moodboard-image'])}`,
    `- Documents: ${countKinds(available, ['lyrics', 'press-doc', 'note'])}`,
  ]
}

function countKinds(files: MissionAssetRecord[], kinds: MissionAssetRecord['kind'][]): number {
  return files.filter((file) => kinds.includes(file.kind)).length
}

function firstPath(files: MissionAssetRecord[], kind: MissionAssetRecord['kind']): string | null {
  const record = files.find((file) => file.kind === kind && file.status === 'available')
  return record?.relativePath ?? record?.absolutePath ?? null
}
