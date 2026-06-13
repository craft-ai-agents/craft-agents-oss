import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const cli = resolve(import.meta.dirname, 'video-studio.mjs');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-video-edit-'));
  tempDirs.push(dir);
  const projectPath = join(dir, 'video.runner-video.json');
  run(['create', dir, '--title', 'Edit Test', '--json']);
  const project = JSON.parse(readFileSync(projectPath, 'utf-8'));
  project.timeline.tracks[0].clips = [
    { id: 'clip-a', type: 'video', startMs: 1000, durationMs: 1000, label: 'A' },
    { id: 'clip-b', type: 'video', startMs: 3000, durationMs: 1000, label: 'B' },
  ];
  project.timeline.durationMs = 4000;
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');
  return projectPath;
}

function run(args, options = {}) {
  const child = spawnSync('node', [cli, ...args], { encoding: 'utf-8' });
  if (options.expectFailure) return child;
  expect(child.status, child.stderr || child.stdout).toBe(0);
  return JSON.parse(child.stdout);
}

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' }).status === 0
    && spawnSync('ffprobe', ['-version'], { encoding: 'utf-8' }).status === 0;
}

function readProject(projectPath) {
  return JSON.parse(readFileSync(projectPath, 'utf-8'));
}

describe('video-studio edit commands', () => {
  test('packs timeline clips end-to-start', () => {
    const projectPath = tempProject();

    run(['edit', projectPath, '--action', 'pack', '--json']);

    const clips = readProject(projectPath).timeline.tracks[0].clips;
    expect(clips.map((clip) => clip.startMs)).toEqual([0, 1000]);
  });

  test('splits, duplicates, and deletes clips', () => {
    const projectPath = tempProject();

    const split = run(['edit', projectPath, '--action', 'split', '--clip-id', 'clip-a', '--at-ms', '1500', '--json']);
    expect(split.createdClipId).toBeString();

    const duplicate = run(['edit', projectPath, '--action', 'duplicate', '--clip-id', split.createdClipId, '--json']);
    expect(duplicate.createdClipId).toBeString();

    run(['edit', projectPath, '--action', 'delete', '--clip-id', duplicate.createdClipId, '--json']);

    const clips = readProject(projectPath).timeline.tracks[0].clips;
    expect(clips.some((clip) => clip.id === duplicate.createdClipId)).toBe(false);
    expect(clips).toHaveLength(3);
    expect(run(['inspect', projectPath, '--json']).ok).toBe(true);
  });

  test('inspect fails on overlapping clips', () => {
    const projectPath = tempProject();
    const project = readProject(projectPath);
    project.timeline.tracks[0].clips[1].startMs = 1200;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    const result = run(['inspect', projectPath, '--json'], { expectFailure: true });

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.issues.some((issue) => issue.type === 'overlap')).toBe(true);
  });

  test('duplicate ripples by timeline time even when clips are stored out of order', () => {
    const projectPath = tempProject();
    const project = readProject(projectPath);
    project.timeline.tracks[0].clips = [
      { id: 'late-array-first', type: 'video', startMs: 1000, durationMs: 1000, label: 'Later' },
      { id: 'selected-earlier', type: 'video', startMs: 0, durationMs: 1000, label: 'Earlier' },
    ];
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    run(['edit', projectPath, '--action', 'duplicate', '--clip-id', 'selected-earlier', '--json']);

    expect(run(['inspect', projectPath, '--json']).ok).toBe(true);
    expect(readProject(projectPath).timeline.tracks[0].clips.map((clip) => clip.startMs)).toEqual([0, 1000, 2000]);
  });

  test('simple MP4 export preserves audio from video clips', () => {
    if (!hasFfmpeg()) return;
    const projectPath = tempProject();
    const projectDir = projectPath.replace('/video.runner-video.json', '');
    const sourcePath = `${projectDir}/source.mp4`;
    const outputPath = `${projectDir}/out.mp4`;
    const fixture = spawnSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=160x90:rate=10',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=1',
      '-t', '1',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      sourcePath,
    ], { encoding: 'utf-8' });
    expect(fixture.status, fixture.stderr || fixture.stdout).toBe(0);
    const project = readProject(projectPath);
    project.media.push({ id: 'media-video', type: 'video', label: 'Source', path: sourcePath, source: { kind: 'user-import' } });
    project.timeline.tracks[0].clips = [{ id: 'clip-video', mediaId: 'media-video', type: 'video', startMs: 0, durationMs: 1000, label: 'Source' }];
    project.timeline.durationMs = 1000;
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    run(['export', projectPath, '--out', outputPath, '--json']);

    const audioProbe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', outputPath], { encoding: 'utf-8' });
    expect(audioProbe.status).toBe(0);
    expect(audioProbe.stdout.trim()).not.toBe('');
  });
});
