import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SessionToolContext } from '../context.ts';
import {
  handleVideoClipAdjust,
  handleVideoClipAdd,
  handleVideoClipEdit,
  handleVideoExport,
  handleVideoMediaImport,
  handleVideoProjectCreate,
  handleVideoProjectUpdate,
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

function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' }).status === 0
    && spawnSync('ffprobe', ['-version'], { encoding: 'utf-8' }).status === 0;
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

  test('video_project_update changes aspect ratio and output settings', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Aspect Cut' });
    const clip = await handleVideoClipAdd(ctx, {
      projectPath,
      type: 'text',
      text: 'Title',
      startMs: 0,
      durationMs: 1000,
    });
    const clipId = (clip.structuredContent as { clipId: string }).clipId;

    const updated = await handleVideoProjectUpdate(ctx, {
      projectPath,
      aspectRatio: '16:9',
      fps: 60,
    });

    expect(updated.isError).toBe(false);
    const project = JSON.parse(readFileSync(projectPath, 'utf-8')) as {
      settings: { aspectRatio: string; width: number; height: number; fps: number };
      timeline: { tracks: Array<{ clips: Array<{ id: string; startMs: number; durationMs: number }> }> };
      agentEvents: Array<{ toolName?: string }>;
    };
    expect(project.settings).toMatchObject({ aspectRatio: '16:9', width: 1920, height: 1080, fps: 60 });
    expect(project.timeline.tracks[0]!.clips).toContainEqual(expect.objectContaining({ id: clipId, startMs: 0, durationMs: 1000 }));
    expect(project.agentEvents.some((event) => event.toolName === 'video_project_update')).toBe(true);
  });

  test('video_project_update marks inconsistent preset dimensions as custom', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Custom Cut' });

    const updated = await handleVideoProjectUpdate(ctx, {
      projectPath,
      aspectRatio: '16:9',
      width: 1000,
      height: 1000,
    });

    expect(updated.isError).toBe(false);
    const project = JSON.parse(readFileSync(projectPath, 'utf-8')) as {
      settings: { aspectRatio: string; width: number; height: number };
    };
    expect(project.settings).toMatchObject({ aspectRatio: 'custom', width: 1000, height: 1000 });
  });

  test('video_export preserves audio from video clips', async () => {
    if (!hasFfmpeg()) return;
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Audio Export' });
    const mediaPath = join(root, 'source.mp4');
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
      mediaPath,
    ], { encoding: 'utf-8' });
    expect(fixture.status, fixture.stderr || fixture.stdout).toBe(0);
    const imported = await handleVideoMediaImport(ctx, { projectPath, mediaPath });
    const clip = await handleVideoClipAdd(ctx, {
      projectPath,
      mediaId: (imported.structuredContent as { mediaId: string }).mediaId,
      startMs: 0,
      durationMs: 1000,
    });
    expect(clip.isError).toBe(false);
    const outputPath = join(root, 'project', 'renders', 'with-audio.mp4');

    const exported = await handleVideoExport(ctx, { projectPath, outputPath });

    expect(exported.isError).toBe(false);
    const audioProbe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', outputPath], { encoding: 'utf-8' });
    expect(audioProbe.status).toBe(0);
    expect(audioProbe.stdout.trim()).not.toBe('');
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

  test('video_clip_edit moves with snap and trims clips', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Edit Clip' });
    const first = await handleVideoClipAdd(ctx, {
      projectPath,
      type: 'text',
      text: 'A',
      startMs: 0,
      durationMs: 1000,
      label: 'A',
    });
    const second = await handleVideoClipAdd(ctx, {
      projectPath,
      type: 'text',
      text: 'B',
      startMs: 3000,
      durationMs: 1000,
      label: 'B',
    });

    const firstClipId = (first.structuredContent as { clipId: string }).clipId;
    const secondClipId = (second.structuredContent as { clipId: string }).clipId;
    const moved = await handleVideoClipEdit(ctx, {
      projectPath,
      clipId: secondClipId,
      action: 'move',
      startMs: 1100,
      snap: true,
    });
    expect(moved.isError).toBe(false);
    expect((moved.structuredContent as { startMs: number }).startMs).toBe(1000);

    const trimmed = await handleVideoClipEdit(ctx, {
      projectPath,
      clipId: firstClipId,
      action: 'trim',
      durationMs: 750,
      sourceInMs: 100,
      sourceOutMs: 850,
    });
    expect(trimmed.isError).toBe(false);

    const project = JSON.parse(readFileSync(projectPath, 'utf-8')) as {
      timeline: { tracks: Array<{ clips: Array<{ id: string; startMs: number; durationMs: number; sourceInMs?: number; sourceOutMs?: number }> }> };
      agentEvents: Array<{ toolName?: string }>;
    };
    expect(project.timeline.tracks[0]!.clips.find((clip) => clip.id === secondClipId)?.startMs).toBe(1000);
    expect(project.timeline.tracks[0]!.clips.find((clip) => clip.id === firstClipId)).toMatchObject({ durationMs: 750, sourceInMs: 100, sourceOutMs: 850 });
    expect(project.agentEvents.some((event) => event.toolName === 'video_clip_edit')).toBe(true);
  });

  test('video_clip_edit rejects moves and trims that create overlaps', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Overlap Guard' });
    const first = await handleVideoClipAdd(ctx, {
      projectPath,
      type: 'text',
      text: 'A',
      startMs: 0,
      durationMs: 1000,
      label: 'A',
    });
    const second = await handleVideoClipAdd(ctx, {
      projectPath,
      type: 'text',
      text: 'B',
      startMs: 1500,
      durationMs: 500,
      label: 'B',
    });
    const firstClipId = (first.structuredContent as { clipId: string }).clipId;
    const secondClipId = (second.structuredContent as { clipId: string }).clipId;

    const moved = await handleVideoClipEdit(ctx, {
      projectPath,
      clipId: secondClipId,
      action: 'move',
      startMs: 500,
      snap: false,
    });
    const trimmed = await handleVideoClipEdit(ctx, {
      projectPath,
      clipId: firstClipId,
      action: 'trim',
      durationMs: 1600,
    });

    expect(moved.isError).toBe(true);
    expect(trimmed.isError).toBe(true);
    expect(moved.content[0]?.type === 'text' ? moved.content[0].text : '').toContain('overlaps');
    expect(trimmed.content[0]?.type === 'text' ? trimmed.content[0].text : '').toContain('overlaps');
  });

  test('video_clip_adjust stores presets and clamps manual values', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Look Test' });
    const mediaPath = join(root, 'still.png');
    writeFileSync(mediaPath, 'fake image media', 'utf-8');
    const imported = await handleVideoMediaImport(ctx, { projectPath, mediaPath });
    const mediaId = (imported.structuredContent as { mediaId: string }).mediaId;
    const clip = await handleVideoClipAdd(ctx, {
      projectPath,
      mediaId,
      startMs: 0,
      durationMs: 1000,
    });
    const clipId = (clip.structuredContent as { clipId: string }).clipId;

    const cinematic = await handleVideoClipAdjust(ctx, {
      projectPath,
      clipId,
      preset: 'cinematic',
    });
    const clean = await handleVideoClipAdjust(ctx, {
      projectPath,
      clipId,
      preset: 'clean',
    });
    const cleanProject = JSON.parse(readFileSync(projectPath, 'utf-8')) as {
      timeline: { tracks: Array<{ clips: Array<{ id: string; adjustments?: { preset?: string; exposure?: number; contrast?: number; saturation?: number; highlights?: number; shadows?: number; grain?: number } }> }> };
    };
    const cleanStored = cleanProject.timeline.tracks[0]!.clips.find((item) => item.id === clipId)?.adjustments;
    const neutral = await handleVideoClipAdjust(ctx, {
      projectPath,
      clipId,
      preset: 'neutral',
    });
    const neutralProject = JSON.parse(readFileSync(projectPath, 'utf-8')) as {
      timeline: { tracks: Array<{ clips: Array<{ id: string; adjustments?: { preset?: string; exposure?: number; grain?: number } }> }> };
    };
    const neutralStored = neutralProject.timeline.tracks[0]!.clips.find((item) => item.id === clipId)?.adjustments;
    const adjusted = await handleVideoClipAdjust(ctx, {
      projectPath,
      clipId,
      exposure: 2,
      grain: 2,
    });

    expect(cinematic.isError).toBe(false);
    expect(clean.isError).toBe(false);
    expect(neutral.isError).toBe(false);
    expect(adjusted.isError).toBe(false);
    expect(cleanStored).toEqual({ preset: 'clean', exposure: 0.03, contrast: 1.05, saturation: 1.04, grain: 0 });
    expect(neutralStored).toEqual({ preset: 'neutral' });
    const project = JSON.parse(readFileSync(projectPath, 'utf-8')) as {
      timeline: { tracks: Array<{ clips: Array<{ id: string; adjustments?: { preset?: string; exposure?: number; contrast?: number; saturation?: number; highlights?: number; shadows?: number; grain?: number } }> }> };
      agentEvents: Array<{ toolName?: string }>;
    };
    const stored = project.timeline.tracks[0]!.clips.find((item) => item.id === clipId)?.adjustments;
    expect(stored).toEqual({ preset: 'manual', exposure: 1, grain: 1 });
    expect(project.agentEvents.some((event) => event.toolName === 'video_clip_adjust')).toBe(true);
  });

  test('video_clip_adjust rejects clips that cannot render look adjustments', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Text Look Test' });
    const clip = await handleVideoClipAdd(ctx, {
      projectPath,
      type: 'text',
      text: 'A',
      startMs: 0,
      durationMs: 1000,
    });

    const adjusted = await handleVideoClipAdjust(ctx, {
      projectPath,
      clipId: (clip.structuredContent as { clipId: string }).clipId,
      exposure: 0.2,
    });

    expect(adjusted.isError).toBe(true);
    expect(adjusted.content[0]?.type === 'text' ? adjusted.content[0].text : '').toContain('not a video or image clip');
  });

  test('video_clip_edit packs, splits, duplicates, and deletes clips', async () => {
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Advanced Edits' });
    const first = await handleVideoClipAdd(ctx, {
      projectPath,
      type: 'text',
      text: 'A',
      startMs: 1000,
      durationMs: 1000,
      label: 'A',
    });
    const second = await handleVideoClipAdd(ctx, {
      projectPath,
      type: 'text',
      text: 'B',
      startMs: 3500,
      durationMs: 1000,
      label: 'B',
    });
    const firstClipId = (first.structuredContent as { clipId: string }).clipId;
    const secondClipId = (second.structuredContent as { clipId: string }).clipId;

    const packed = await handleVideoClipEdit(ctx, { projectPath, action: 'pack' });
    expect(packed.isError).toBe(false);
    expect((packed.structuredContent as { changed: number }).changed).toBe(2);

    const split = await handleVideoClipEdit(ctx, {
      projectPath,
      clipId: firstClipId,
      action: 'split',
      atMs: 500,
    });
    expect(split.isError).toBe(false);
    const splitClipId = (split.structuredContent as { createdClipId: string }).createdClipId;
    expect(splitClipId).toBeTruthy();

    const duplicated = await handleVideoClipEdit(ctx, {
      projectPath,
      clipId: splitClipId,
      action: 'duplicate',
    });
    expect(duplicated.isError).toBe(false);
    const duplicatedClipId = (duplicated.structuredContent as { createdClipId: string }).createdClipId;
    expect(duplicatedClipId).toBeTruthy();

    const deleted = await handleVideoClipEdit(ctx, {
      projectPath,
      clipId: duplicatedClipId,
      action: 'delete',
      ripple: true,
    });
    expect(deleted.isError).toBe(false);

    const project = JSON.parse(readFileSync(projectPath, 'utf-8')) as {
      timeline: { durationMs: number; tracks: Array<{ clips: Array<{ id: string; startMs: number; durationMs: number }> }> };
      agentEvents: Array<{ toolName?: string }>;
    };
    const clips = project.timeline.tracks[0]!.clips;
    expect(clips.find((clip) => clip.id === firstClipId)).toMatchObject({ startMs: 0, durationMs: 500 });
    expect(clips.find((clip) => clip.id === splitClipId)).toMatchObject({ startMs: 500, durationMs: 500 });
    expect(clips.find((clip) => clip.id === duplicatedClipId)).toBeUndefined();
    expect(clips.find((clip) => clip.id === secondClipId)).toMatchObject({ startMs: 1000, durationMs: 1000 });
    expect(project.timeline.durationMs).toBe(2000);
    expect(project.agentEvents.filter((event) => event.toolName === 'video_clip_edit')).toHaveLength(4);
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

  test('renders adjusted video media into a playable mp4', async () => {
    const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' });
    if (ffmpeg.status !== 0) return;
    const ctx = makeCtx();
    const projectPath = join(root, 'project', 'video.runner-video.json');
    await handleVideoProjectCreate(ctx, { projectPath, title: 'Adjusted Media' });
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
    const clip = await handleVideoClipAdd(ctx, {
      projectPath,
      mediaId,
      startMs: 0,
      durationMs: 1000,
    });
    await handleVideoClipAdjust(ctx, {
      projectPath,
      clipId: (clip.structuredContent as { clipId: string }).clipId,
      preset: 'punchy',
      sharpen: 0.4,
      vignette: 0.2,
    });

    const result = await handleVideoExport(ctx, {
      projectPath,
      outputPath: join(root, 'project', 'renders', 'adjusted.mp4'),
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
