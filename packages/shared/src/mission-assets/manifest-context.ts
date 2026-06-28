import type { ContextDocMetadata } from '../workspace-context/types.ts';
import type { MissionAssetManifest, MissionAssetRecord } from './types.ts';
import { MISSION_ASSET_CONTEXT_SLUG } from './types.ts';

export function missionAssetContextMetadata(): ContextDocMetadata {
  return {
    name: 'Mission Assets',
    description: 'Local files attached to this creative mission.',
    routing: { mode: 'broadcast' },
    enabled: true,
    status: 'active',
    priority: 'normal',
  };
}

export function serializeMissionAssetContext(manifest: MissionAssetManifest): string {
  return [
    'This context lists local files attached to the current mission. Do not assume every file has been analyzed. Use tools to inspect files when needed.',
    '',
    '```json',
    JSON.stringify(manifest, null, 2),
    '```',
    '',
    '## Key Assets',
    '',
    ...keyAssetLines(manifest.files),
  ].join('\n');
}

export function missionAssetContextSlug(): string {
  return MISSION_ASSET_CONTEXT_SLUG;
}

function keyAssetLines(files: MissionAssetRecord[]): string[] {
  const master = firstPath(files, 'master');
  const lyrics = firstPath(files, 'lyrics');
  const cover = firstPath(files, 'cover-art');
  return [
    `- Master: ${master ?? 'missing'}`,
    `- Cover art: ${cover ?? 'missing'}`,
    `- Lyrics: ${lyrics ?? 'missing'}`,
  ];
}

function firstPath(files: MissionAssetRecord[], kind: MissionAssetRecord['kind']): string | null {
  const record = files.find((file) => file.kind === kind && file.status === 'available');
  return record?.relativePath ?? record?.absolutePath ?? null;
}
