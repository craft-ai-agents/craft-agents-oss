import { existsSync, mkdirSync, mkdtempSync, readdirSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  classifyMissionAsset,
  getMissionAssetManifestPath,
  importMissionAssets,
  importMissionAssetsAsync,
  loadMissionAssetManifest,
  missionAssetContextMetadata,
  planMissionAssetImports,
  serializeMissionAssetContext,
} from './index.ts';

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'runner-mission-assets-'));
}

describe('mission assets', () => {
  test('classifies common artist asset filenames', () => {
    expect(classifyMissionAsset('/tmp/final-master.wav').kind).toBe('master');
    expect(classifyMissionAsset('/tmp/vocal-stem.wav').kind).toBe('stem');
    expect(classifyMissionAsset('/tmp/cover-art-v4.png').kind).toBe('cover-art');
    expect(classifyMissionAsset('/tmp/lyrics-final.txt').kind).toBe('lyrics');
    expect(classifyMissionAsset('/tmp/studio-bts.mov').kind).toBe('raw-video');
  });

  test('plans destination paths and avoids collisions within one import batch', () => {
    const workspace = tempWorkspace();
    const first = join(workspace, 'source-master.wav');
    const second = join(workspace, 'other', 'source-master.wav');
    mkdirSync(join(workspace, 'other'), { recursive: true });
    writeFileSync(first, 'audio-one');
    writeFileSync(second, 'audio-two');

    const plan = planMissionAssetImports(workspace, [first, second], { kindHint: 'master' });

    expect(plan.skipped).toEqual([]);
    expect(plan.candidates.map((candidate) => candidate.destinationRelativePath)).toEqual([
      'assets/audio/masters/source-master.wav',
      'assets/audio/masters/source-master-2.wav',
    ]);
  });

  test('copies files, writes manifest, and emits compact agent context', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'night-drive-final.wav');
    writeFileSync(source, 'fake audio');

    const result = importMissionAssets(workspace, 'workspace-1', [source], { kindHint: 'master' });
    const loaded = loadMissionAssetManifest(workspace, 'workspace-1');
    const body = serializeMissionAssetContext(loaded);

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].relativePath).toBe('assets/audio/masters/night-drive-final.wav');
    expect(getMissionAssetManifestPath(workspace)).toContain('assets/manifest.json');
    expect(loaded.files[0].kind).toBe('master');
    expect(body).toContain('"kind": "master"');
    expect(body).toContain('Master: assets/audio/masters/night-drive-final.wav');
    expect(body).toContain('Audio files: 1');
    expect(body).toContain('Raw video: 0');
    expect(missionAssetContextMetadata().routing).toEqual({ mode: 'broadcast' });
  });

  test('does not hash very large media into memory', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'huge-video.mov');
    writeFileSync(source, '');
    truncateSync(source, 257 * 1024 * 1024);

    const result = importMissionAssets(workspace, 'workspace-1', [source]);

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].sizeBytes).toBe(257 * 1024 * 1024);
    expect(result.imported[0].sha256).toBeUndefined();
  });

  test('async import copies media and writes manifest', async () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'cover-art.png');
    writeFileSync(source, 'fake image');

    const result = await importMissionAssetsAsync(workspace, 'workspace-1', [source], { kindHint: 'cover-art' });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].relativePath).toBe('assets/images/cover-art/cover-art.png');
    expect(existsSync(join(workspace, 'assets/images/cover-art/cover-art.png'))).toBe(true);
  });

  test('refuses to import over an invalid manifest and preserves a backup', () => {
    const workspace = tempWorkspace();
    const assetsDir = join(workspace, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, 'manifest.json'), '{broken');
    const source = join(workspace, 'night-drive.wav');
    writeFileSync(source, 'audio');

    expect(() => importMissionAssets(workspace, 'workspace-1', [source], { kindHint: 'master' })).toThrow(/manifest is invalid/i);
    expect(existsSync(join(assetsDir, 'manifest.json'))).toBe(true);
    expect(readdirSync(assetsDir).some((file) => file.startsWith('manifest.json.invalid-'))).toBe(true);
    expect(existsSync(join(workspace, 'assets/audio/masters/night-drive.wav'))).toBe(false);
  });
});
