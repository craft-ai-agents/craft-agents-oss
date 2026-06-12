import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SessionToolContext } from '../context.ts';
import {
  handleVideoClipAdd,
  handleVideoExport,
  handleVideoMediaImport,
  handleVideoProjectCreate,
} from './video-tools.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'runner-video-tools-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<SessionToolContext> = {}): SessionToolContext {
  return {
    sessionId: 'session-1',
    workspacePath: root,
    workingDirectory: root,
    get sourcesPath() {
      return join(root, 'sources');
    },
    get skillsPath() {
      return join(root, 'skills');
    },
    plansFolderPath: join(root, 'plans'),
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: existsSync,
      readFile: (path: string) => readFileSync(path, 'utf-8'),
      readFileBuffer: (path: string) => readFileSync(path),
      writeFile: (path: string, content: string) => writeFileSync(path, content),
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    ...overrides,
  } as SessionToolContext;
}

describe('video studio session tools', () => {
  test('create -> import -> add clip -> export placeholder', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');

    const created = await handleVideoProjectCreate(ctx, {
      projectPath,
      title: 'Launch Cut',
      aspectRatio: '16:9',
    });
    expect(created.isError).toBe(false);
    expect(existsSync(projectPath)).toBe(true);

    const mediaPath = join(root, 'clip.mp4');
    writeFileSync(mediaPath, 'fake fixture media', 'utf-8');

    const imported = await handleVideoMediaImport(ctx, { projectPath, mediaPath });
    expect(imported.isError).toBe(false);
    const mediaId = (imported.structuredContent as { mediaId: string }).mediaId;
    expect(mediaId).toBeTruthy();

    const clip = await handleVideoClipAdd(ctx, {
      projectPath,
      mediaId,
      startMs: 0,
      durationMs: 1500,
    });
    expect(clip.isError).toBe(false);
    expect((clip.structuredContent as { clipId: string }).clipId).toBeTruthy();

    const outputPath = join(root, 'project', 'renders', 'preview.placeholder.txt');
    const exported = await handleVideoExport(ctx, { projectPath, outputPath });
    expect(exported.isError).toBe(false);
    expect(existsSync(outputPath)).toBe(true);
    expect(existsSync(`${outputPath}.receipt.json`)).toBe(true);

    const project = JSON.parse(readFileSync(projectPath, 'utf-8')) as {
      media: Array<{ path: string; originalPath?: string }>;
      timeline: { tracks: Array<{ clips: unknown[] }> };
      exports: unknown[];
      agentEvents: unknown[];
    };
    expect(project.media).toHaveLength(1);
    expect(project.media[0]!.path).toContain(`${join('project', 'media')}`);
    expect(project.media[0]!.originalPath).toBe(mediaPath);
    expect(existsSync(project.media[0]!.path)).toBe(true);
    expect(project.timeline.tracks[0]!.clips).toHaveLength(1);
    expect(project.exports).toHaveLength(1);
    expect(project.agentEvents.length).toBeGreaterThanOrEqual(3);
  });

  test('video_export can publish an output receipt when context supports it', async () => {
    let publishedTitle = '';
    const ctx = makeCtx({
      createOutput: async (input) => {
        publishedTitle = input.title;
        return { ok: true, outputId: 'output-1', route: '/outputs/output-1' };
      },
    });
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Publish Cut' });

    const result = await handleVideoExport(ctx, {
      projectPath,
      publishOutput: true,
      showInCanvas: true,
    });

    expect(result.isError).toBe(false);
    expect(publishedTitle).toContain('Publish Cut');
    expect((result.structuredContent as { outputId?: string }).outputId).toBe('output-1');
  });

  test('rejects project and export paths outside the working directory', async () => {
    const ctx = makeCtx();
    const outside = mkdtempSync(join(tmpdir(), 'runner-video-outside-'));
    const outsideProjectPath = join(outside, 'video.runner-video.json');

    const created = await handleVideoProjectCreate(ctx, {
      projectPath: outsideProjectPath,
      title: 'Escape',
    });
    expect(created.isError).toBe(true);
    expect(existsSync(outsideProjectPath)).toBe(false);

    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Inside' });
    const exported = await handleVideoExport(ctx, {
      projectPath,
      outputPath: join(outside, 'preview.placeholder.txt'),
    });
    expect(exported.isError).toBe(true);

    rmSync(outside, { recursive: true, force: true });
  });

  test('rejects media imports from outside the working directory', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Import Guard' });

    const outside = mkdtempSync(join(tmpdir(), 'runner-video-outside-media-'));
    const mediaPath = join(outside, 'private.mp4');
    writeFileSync(mediaPath, 'private', 'utf-8');

    const imported = await handleVideoMediaImport(ctx, { projectPath, mediaPath });
    expect(imported.isError).toBe(true);
    expect(existsSync(join(dirname(projectPath), 'media'))).toBe(false);

    rmSync(outside, { recursive: true, force: true });
  });

  test('rejects invalid source trim ranges', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Bad Trim' });
    const mediaPath = join(root, 'clip.mp4');
    writeFileSync(mediaPath, 'fake fixture media', 'utf-8');
    const imported = await handleVideoMediaImport(ctx, { projectPath, mediaPath });

    const result = await handleVideoClipAdd(ctx, {
      projectPath,
      mediaId: (imported.structuredContent as { mediaId: string }).mediaId,
      sourceInMs: 2000,
      sourceOutMs: 1000,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('sourceOutMs');
  });

  test('rejects media clip types when mediaId is missing', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Missing Media' });

    const result = await handleVideoClipAdd(ctx, {
      projectPath,
      type: 'video',
      startMs: 0,
      durationMs: 1000,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('require a mediaId');
  });

  test('renders a playable mp4 when output path uses a video extension', async () => {
    const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' });
    if (ffmpeg.status !== 0) return;
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Real MP4' });
    const textClip = await handleVideoClipAdd(ctx, {
      projectPath,
      type: 'text',
      text: 'Launch',
      startMs: 0,
      durationMs: 1000,
    });
    expect(textClip.isError).toBe(false);

    const outputPath = join(root, 'project', 'renders', 'preview.mp4');
    const result = await handleVideoExport(ctx, {
      projectPath,
      outputPath,
    });

    expect(result.isError).toBe(false);
    expect((result.structuredContent as { rendered?: boolean; placeholder?: boolean }).rendered).toBe(true);
    expect((result.structuredContent as { rendered?: boolean; placeholder?: boolean }).placeholder).toBe(false);
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath).subarray(4, 8).toString()).toBe('ftyp');
  });

  test('renders imported video media into a playable mp4', async () => {
    const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' });
    if (ffmpeg.status !== 0) return;
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Media Backed' });
    const mediaPath = join(root, 'clip.mp4');
    const fixture = spawnSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=320x180:rate=30',
      '-t', '1',
      '-pix_fmt', 'yuv420p',
      mediaPath,
    ], { encoding: 'utf-8' });
    if (fixture.status !== 0) throw new Error(fixture.stderr || fixture.stdout || 'failed to create fixture video');
    const imported = await handleVideoMediaImport(ctx, { projectPath, mediaPath });
    const mediaId = (imported.structuredContent as { mediaId: string }).mediaId;
    await handleVideoClipAdd(ctx, {
      projectPath,
      mediaId,
      startMs: 0,
      durationMs: 1000,
    });

    const result = await handleVideoExport(ctx, {
      projectPath,
      outputPath: join(root, 'project', 'renders', 'preview.mp4'),
    });

    expect(result.isError).toBe(false);
    const outputPath = (result.structuredContent as { outputPath: string }).outputPath;
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath).subarray(4, 8).toString()).toBe('ftyp');
  });

  test('rejects unsupported media-backed clips for real mp4 export', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Unsupported Media' });
    const mediaPath = join(root, 'shape.svg');
    writeFileSync(mediaPath, '<svg xmlns="http://www.w3.org/2000/svg" />', 'utf-8');
    const imported = await handleVideoMediaImport(ctx, { projectPath, mediaPath });
    const mediaId = (imported.structuredContent as { mediaId: string }).mediaId;
    await handleVideoClipAdd(ctx, {
      projectPath,
      mediaId,
      startMs: 0,
      durationMs: 1000,
    });

    const result = await handleVideoExport(ctx, {
      projectPath,
      outputPath: join(root, 'project', 'renders', 'preview.mp4'),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('only supports video, image, audio, and text');
  });
});
