import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectImportableVideoStudioFiles } from './video-studio';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-video-folder-'));
  tempDirs.push(dir);
  return dir;
}

describe('collectImportableVideoStudioFiles', () => {
  test('recursively collects export-safe media files from a folder', () => {
    const root = makeTempDir();
    const nested = join(root, 'nested');
    mkdirSync(nested);
    const video = join(root, 'clip.mp4');
    const image = join(nested, 'frame.png');
    const audio = join(nested, 'track.wav');
    const caption = join(root, 'captions.srt');
    const note = join(root, 'notes.txt');
    for (const path of [video, image, audio, caption, note]) writeFileSync(path, 'x');

    const result = collectImportableVideoStudioFiles([root]);

    expect(result.files.sort()).toEqual([audio, image, video].sort());
    expect(result.skipped).toBe(2);
  });

  test('caps collected files and counts overflow as skipped', () => {
    const root = makeTempDir();
    const first = join(root, 'a.mp4');
    const second = join(root, 'b.mp4');
    writeFileSync(first, 'x');
    writeFileSync(second, 'x');

    const result = collectImportableVideoStudioFiles([root], 1);

    expect(result.files).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });
});
