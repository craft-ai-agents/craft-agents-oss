import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addVideoProjectVersion,
  appendVideoAgentEvent,
  createRunnerVideoProject,
  readVideoProject,
  upsertVideoMediaAsset,
  validateRunnerVideoProject,
  writeVideoProject,
} from './index.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'runner-video-test-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Runner video project storage', () => {
  test('creates a valid default project', () => {
    const project = createRunnerVideoProject({ title: 'Launch Cut', workspaceId: 'workspace-1' });
    const validation = validateRunnerVideoProject(project);

    expect(validation.ok).toBe(true);
    expect(project.version).toBe(1);
    expect(project.settings.aspectRatio).toBe('9:16');
    expect(project.timeline.tracks.map((track) => track.id)).toEqual(['video-main', 'audio-main', 'captions-main']);
    expect(project.versions).toHaveLength(1);
  });

  test('writes and reads a valid project atomically', () => {
    const project = createRunnerVideoProject({ title: 'Saved Cut', workspaceId: 'workspace-1' });
    const projectPath = join(root, 'nested', 'video.runner-video.json');

    writeVideoProject(projectPath, project);
    const loaded = readVideoProject(projectPath);

    expect(loaded.id).toBe(project.id);
    expect(loaded.title).toBe('Saved Cut');
  });

  test('validates clip media references', () => {
    const project = createRunnerVideoProject({ title: 'Bad Ref', workspaceId: 'workspace-1' });
    project.timeline.tracks[0]!.clips.push({
      id: 'clip-1',
      type: 'video',
      mediaId: 'missing',
      startMs: 0,
      durationMs: 1000,
    });

    const validation = validateRunnerVideoProject(project);

    expect(validation.ok).toBe(false);
    expect(validation.errors[0]?.message).toContain('Referenced media');
  });

  test('tracks media, versions, and agent events', () => {
    const project = createRunnerVideoProject({ title: 'Agent Cut', workspaceId: 'workspace-1' });
    upsertVideoMediaAsset(project, {
      id: 'media-1',
      type: 'video',
      label: 'clip.mp4',
      path: '/tmp/clip.mp4',
      source: { kind: 'user-import' },
    });
    const version = addVideoProjectVersion(project, 'Imported media', 'agent', {
      agentSlug: 'video-editor-agent',
      sessionId: 'session-1',
    });
    const event = appendVideoAgentEvent(project, {
      agentSlug: 'video-editor-agent',
      sessionId: 'session-1',
      toolName: 'video_media_import',
      summary: 'Imported media',
      afterVersionId: version.id,
    });

    expect(project.media).toHaveLength(1);
    expect(project.versions.at(-1)?.summary).toBe('Imported media');
    expect(project.agentEvents.at(-1)?.id).toBe(event.id);
    expect(validateRunnerVideoProject(project).ok).toBe(true);
  });
});
