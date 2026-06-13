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
});
