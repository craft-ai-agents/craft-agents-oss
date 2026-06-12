import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

type MediaType = 'video' | 'audio' | 'image' | 'caption' | 'svg' | 'lottie' | 'html' | 'unknown';
type TrackType = 'video' | 'audio' | 'image' | 'text' | 'caption' | 'effect' | 'adjustment';
type ClipType = 'video' | 'audio' | 'image' | 'text' | 'caption' | 'shape' | 'lottie' | 'html';

interface VideoProjectCreateInput {
  projectPath?: string;
  projectDir?: string;
  title: string;
  aspectRatio?: '9:16' | '1:1' | '16:9' | '4:5';
  width?: number;
  height?: number;
  fps?: number;
  overwrite?: boolean;
}

interface VideoMediaImportInput {
  projectPath: string;
  mediaPath: string;
  label?: string;
  mediaType?: MediaType;
}

interface VideoClipAddInput {
  projectPath: string;
  mediaId?: string;
  trackId?: string;
  type?: ClipType;
  startMs?: number;
  durationMs?: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  label?: string;
  text?: string;
}

interface VideoExportInput {
  projectPath: string;
  outputPath?: string;
  preset?: string;
  publishOutput?: boolean;
  showInCanvas?: boolean;
}

interface VideoProject {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  settings: Record<string, unknown>;
  media: Array<Record<string, unknown> & { id: string; type: MediaType; label: string; path: string }>;
  timeline: {
    durationMs: number;
    tracks: Array<{ id: string; type: TrackType; label: string; clips: Array<Record<string, unknown> & { id: string; type: ClipType; startMs: number; durationMs: number; mediaId?: string }> }>;
    markers: unknown[];
  };
  captions: unknown[];
  overlays: unknown[];
  effects: unknown[];
  templates: unknown[];
  exports: Array<Record<string, unknown>>;
  versions: Array<Record<string, unknown>>;
  agentEvents: Array<Record<string, unknown>>;
}

function baseDir(ctx: SessionToolContext): string {
  return ctx.workingDirectory || ctx.workspacePath;
}

function resolvePath(ctx: SessionToolContext, path: string): string {
  return isAbsolute(path) ? path : resolve(baseDir(ctx), path);
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveWorkspacePath(ctx: SessionToolContext, path: string, label: string): { ok: true; path: string } | { ok: false; error: string } {
  const resolved = resolvePath(ctx, path);
  const root = resolve(baseDir(ctx));
  if (!isPathInside(root, resolved)) {
    return { ok: false, error: `${label} must be inside the session working directory: ${root}` };
  }
  return { ok: true, path: resolved };
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return slug || 'video-project';
}

function aspectSettings(aspectRatio: string | undefined): { aspectRatio: string; width: number; height: number; fps: number } {
  if (aspectRatio === '16:9') return { aspectRatio, width: 1920, height: 1080, fps: 30 };
  if (aspectRatio === '1:1') return { aspectRatio, width: 1080, height: 1080, fps: 30 };
  if (aspectRatio === '4:5') return { aspectRatio, width: 1080, height: 1350, fps: 30 };
  return { aspectRatio: '9:16', width: 1080, height: 1920, fps: 30 };
}

function compactSettings(settings: Partial<{ aspectRatio: string; width: number; height: number; fps: number }>): Partial<{ aspectRatio: string; width: number; height: number; fps: number }> {
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) as Partial<{ aspectRatio: string; width: number; height: number; fps: number }>;
}

function createProject(title: string, workspaceId: string, settings: Partial<{ aspectRatio: string; width: number; height: number; fps: number }>): VideoProject {
  const now = new Date().toISOString();
  const defaults = aspectSettings(settings.aspectRatio);
  return {
    version: 1,
    id: randomUUID(),
    title: title.trim() || 'Untitled Video',
    createdAt: now,
    updatedAt: now,
    workspaceId,
    settings: { ...defaults, ...compactSettings(settings) },
    media: [],
    timeline: {
      durationMs: 0,
      tracks: [
        { id: 'video-main', type: 'video', label: 'Video', clips: [] },
        { id: 'audio-main', type: 'audio', label: 'Audio', clips: [] },
        { id: 'captions-main', type: 'caption', label: 'Captions', clips: [] },
      ],
      markers: [],
    },
    captions: [],
    overlays: [],
    effects: [],
    templates: [],
    exports: [],
    versions: [{ id: randomUUID(), createdAt: now, summary: 'Created video project', actor: 'system' }],
    agentEvents: [],
  };
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(tmp, path);
}

function readProject(projectPath: string): VideoProject {
  const project = JSON.parse(readFileSync(projectPath, 'utf-8')) as VideoProject;
  const errors = validateProject(project);
  if (errors.length > 0) throw new Error(errors[0]);
  return project;
}

function validateProject(project: VideoProject): string[] {
  const errors: string[] = [];
  if (!project || typeof project !== 'object') return ['Project must be an object.'];
  if (project.version !== 1) errors.push('version must be 1.');
  if (!project.id) errors.push('id is required.');
  if (!project.title) errors.push('title is required.');
  if (!project.workspaceId) errors.push('workspaceId is required.');
  if (!project.settings || typeof project.settings !== 'object') errors.push('settings is required.');
  if (!Array.isArray(project.media)) errors.push('media must be an array.');
  if (!project.timeline || !Array.isArray(project.timeline.tracks)) errors.push('timeline.tracks must be an array.');
  for (const key of ['captions', 'overlays', 'effects', 'templates', 'exports', 'versions', 'agentEvents'] as const) {
    if (!Array.isArray(project[key])) errors.push(`${key} must be an array.`);
  }
  const mediaIds = new Set((project.media || []).map((asset) => asset.id));
  for (const [trackIndex, track] of (project.timeline?.tracks || []).entries()) {
    if (!Array.isArray(track.clips)) errors.push(`timeline.tracks[${trackIndex}].clips must be an array.`);
    for (const [clipIndex, clip] of (track.clips || []).entries()) {
      const path = `timeline.tracks[${trackIndex}].clips[${clipIndex}]`;
      if (!clip.id) errors.push(`${path}.id is required.`);
      if (typeof clip.startMs !== 'number' || !Number.isFinite(clip.startMs) || clip.startMs < 0) errors.push(`${path}.startMs must be non-negative.`);
      if (typeof clip.durationMs !== 'number' || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0) errors.push(`${path}.durationMs must be positive.`);
      if (clip.mediaId && !mediaIds.has(clip.mediaId)) errors.push(`${path}.mediaId references missing media.`);
      const sourceInMs = clip.sourceInMs;
      const sourceOutMs = clip.sourceOutMs;
      if (sourceInMs !== undefined && (typeof sourceInMs !== 'number' || !Number.isFinite(sourceInMs) || sourceInMs < 0)) errors.push(`${path}.sourceInMs must be non-negative.`);
      if (sourceOutMs !== undefined && (typeof sourceOutMs !== 'number' || !Number.isFinite(sourceOutMs) || sourceOutMs < 0)) errors.push(`${path}.sourceOutMs must be non-negative.`);
      if (typeof sourceInMs === 'number' && typeof sourceOutMs === 'number' && sourceOutMs <= sourceInMs) errors.push(`${path}.sourceOutMs must be greater than sourceInMs.`);
    }
  }
  return errors;
}

function addVersion(project: VideoProject, summary: string, ctx: SessionToolContext, toolName: string): string {
  const now = new Date().toISOString();
  const versionId = randomUUID();
  project.versions.push({
    id: versionId,
    createdAt: now,
    summary,
    actor: 'agent',
    agentSlug: ctx.activeAgentSlug,
    sessionId: ctx.sessionId,
  });
  project.agentEvents.push({
    id: randomUUID(),
    createdAt: now,
    agentSlug: ctx.activeAgentSlug ?? 'unknown-agent',
    sessionId: ctx.sessionId,
    toolName,
    summary,
    afterVersionId: versionId,
  });
  project.updatedAt = now;
  return versionId;
}

function inferMediaType(path: string): MediaType {
  const ext = extname(path).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)) return 'audio';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext)) return 'image';
  if (['.srt', '.vtt'].includes(ext)) return 'caption';
  if (ext === '.svg') return 'svg';
  return 'unknown';
}

function isVideoOutputPath(path: string): boolean {
  return ['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(extname(path).toLowerCase());
}

function escapeDrawText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\r?\n/g, ' ')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .slice(0, 180);
}

function seconds(ms: number | undefined, fallbackMs = 0): number {
  return Math.max(0, (ms ?? fallbackMs) / 1000);
}

function ffmpegNumber(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function textForClip(clip: VideoProject['timeline']['tracks'][number]['clips'][number], fallback: string): string {
  const textPayload = clip.text;
  if (typeof textPayload === 'object' && textPayload && 'text' in textPayload && typeof textPayload.text === 'string') {
    return textPayload.text;
  }
  return typeof clip.label === 'string' ? clip.label : fallback;
}

function renderSimpleMp4(project: VideoProject, outputPath: string): void {
  const width = typeof project.settings.width === 'number' ? project.settings.width : 1080;
  const height = typeof project.settings.height === 'number' ? project.settings.height : 1920;
  const fps = typeof project.settings.fps === 'number' ? project.settings.fps : 30;
  const durationSeconds = Math.max(1, Math.ceil((project.timeline.durationMs || 3000) / 1000));
  const mediaById = new Map(project.media.map((media) => [media.id, media]));
  const clips = project.timeline.tracks.flatMap((track) => track.clips).sort((a, b) => a.startMs - b.startMs);
  const mediaClips = clips
    .map((clip) => ({ clip, media: clip.mediaId ? mediaById.get(clip.mediaId) : undefined }))
    .filter((item): item is { clip: typeof clips[number]; media: VideoProject['media'][number] } => Boolean(item.media));
  const unsupportedClips = mediaClips.filter(({ media }) => !['video', 'image', 'audio'].includes(media.type));
  if (unsupportedClips.length > 0) {
    const labels = unsupportedClips.slice(0, 3).map(({ clip }) => clip.label ?? clip.id).join(', ');
    throw new Error(`Simple MP4 renderer only supports video, image, audio, and text clips right now: ${labels}.`);
  }

  const args = ['-y', '-f', 'lavfi', '-i', `color=c=#111111:s=${width}x${height}:r=${fps}:d=${durationSeconds}`];
  const inputClips: Array<{ clip: typeof clips[number]; media: VideoProject['media'][number]; inputIndex: number }> = [];
  for (const { clip, media } of mediaClips) {
    if (!existsSync(media.path)) throw new Error(`Media file not found for clip "${clip.label ?? clip.id}": ${media.path}`);
    const clipDuration = ffmpegNumber(seconds(clip.durationMs, 1000));
    const sourceIn = seconds(typeof clip.sourceInMs === 'number' ? clip.sourceInMs : 0);
    if (media.type === 'image') {
      args.push('-loop', '1', '-t', clipDuration, '-i', media.path);
    } else {
      if (sourceIn > 0) args.push('-ss', ffmpegNumber(sourceIn));
      args.push('-t', clipDuration, '-i', media.path);
    }
    inputClips.push({ clip, media, inputIndex: inputClips.length + 1 });
  }

  const filters: string[] = [`[0:v]format=rgba[base0]`];
  let currentVideo = '[base0]';
  let overlayIndex = 0;
  for (const { clip, media, inputIndex } of inputClips.filter((item) => item.media.type === 'video' || item.media.type === 'image')) {
    const start = ffmpegNumber(seconds(clip.startMs));
    const end = ffmpegNumber(seconds(clip.startMs + clip.durationMs));
    const prepared = `v${overlayIndex}`;
    const next = `base${overlayIndex + 1}`;
    filters.push(
      `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,format=rgba,setpts=PTS-STARTPTS+${start}/TB[${prepared}]`,
    );
    filters.push(`${currentVideo}[${prepared}]overlay=0:0:enable='between(t,${start},${end})'[${next}]`);
    currentVideo = `[${next}]`;
    overlayIndex += 1;
  }

  const textClips = project.timeline.tracks
    .flatMap((track) => track.clips)
    .filter((clip) => clip.type === 'text' || clip.text || !clip.mediaId)
    .slice(0, 8);
  for (const [index, clip] of textClips.entries()) {
    const start = seconds(clip.startMs);
    const end = Math.max(start + 0.2, start + seconds(clip.durationMs, 3000));
    const y = Math.round(height * 0.42) + (index % 3) * 86;
    const next = `text${index}`;
    filters.push(
      `${currentVideo}drawtext=text='${escapeDrawText(textForClip(clip, project.title))}':fontcolor=white:fontsize=${Math.max(28, Math.round(width / 24))}:x=(w-text_w)/2:y=${y}:enable='between(t,${ffmpegNumber(start)},${ffmpegNumber(end)})'[${next}]`,
    );
    currentVideo = `[${next}]`;
  }
  if (textClips.length === 0 && inputClips.length === 0) {
    filters.push(`${currentVideo}drawtext=text='${escapeDrawText(project.title)}':fontcolor=white:fontsize=${Math.max(28, Math.round(width / 22))}:x=(w-text_w)/2:y=(h-text_h)/2[title0]`);
    currentVideo = '[title0]';
  }

  const audioLabels: string[] = [];
  inputClips.filter((item) => item.media.type === 'audio').forEach(({ clip, inputIndex }, index) => {
    const delayMs = Math.max(0, Math.round(clip.startMs ?? 0));
    const clipDuration = ffmpegNumber(seconds(clip.durationMs, 1000));
    const label = `a${index}`;
    filters.push(`[${inputIndex}:a]atrim=duration=${clipDuration},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1[${label}]`);
    audioLabels.push(`[${label}]`);
  });
  if (audioLabels.length > 0) {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0,atrim=duration=${durationSeconds}[aout]`);
  }

  filters.push(`${currentVideo}format=yuv420p[vout]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
  );
  if (audioLabels.length > 0) args.push('-map', '[aout]');
  args.push('-t', String(durationSeconds), '-r', String(fps), '-pix_fmt', 'yuv420p');
  if (['.mp4', '.mov', '.m4v'].includes(extname(outputPath).toLowerCase())) {
    args.push('-movflags', '+faststart');
  }
  args.push(outputPath);

  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'ffmpeg failed to render video.');
  }
}

function chooseTrack(project: VideoProject, mediaType: MediaType, requestedTrackId?: string): VideoProject['timeline']['tracks'][number] {
  if (requestedTrackId) {
    const found = project.timeline.tracks.find((track) => track.id === requestedTrackId);
    if (found) return found;
    const created = { id: requestedTrackId, type: mediaType === 'audio' ? 'audio' as const : 'video' as const, label: requestedTrackId, clips: [] };
    project.timeline.tracks.push(created);
    return created;
  }
  const preferred = mediaType === 'audio' ? 'audio-main' : mediaType === 'caption' ? 'captions-main' : 'video-main';
  return project.timeline.tracks.find((track) => track.id === preferred) ?? project.timeline.tracks[0]!;
}

function ok(text: string, structuredContent: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent, isError: false };
}

export async function handleVideoProjectCreate(ctx: SessionToolContext, args: VideoProjectCreateInput): Promise<ToolResult> {
  if (!args.title?.trim()) return errorResponse('title is required.');
  const projectPathResult = args.projectPath
    ? resolveWorkspacePath(ctx, args.projectPath, 'projectPath')
    : resolveWorkspacePath(ctx, join(args.projectDir ?? join('.runneros', 'video-projects', `${slugify(args.title)}-${Date.now()}`), 'video.runner-video.json'), 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (existsSync(projectPath) && !args.overwrite) {
    return errorResponse(`Video project already exists: ${projectPath}. Pass overwrite: true to replace it.`);
  }
  const project = createProject(args.title, basename(ctx.workspacePath), {
    aspectRatio: args.aspectRatio,
    width: args.width,
    height: args.height,
    fps: args.fps,
  });
  writeJsonAtomic(projectPath, project);
  return ok(`Created video project "${project.title}" at ${projectPath}.`, {
    ok: true,
    projectPath,
    projectId: project.id,
    versionId: project.versions[0]?.id,
  });
}

export async function handleVideoMediaImport(ctx: SessionToolContext, args: VideoMediaImportInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  if (!args.mediaPath) return errorResponse('mediaPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const mediaPathResult = resolveWorkspacePath(ctx, args.mediaPath, 'mediaPath');
  if (!mediaPathResult.ok) return errorResponse(mediaPathResult.error);
  const projectPath = projectPathResult.path;
  const mediaPath = mediaPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  if (!existsSync(mediaPath)) return errorResponse(`Media file not found: ${mediaPath}`);
  const project = readProject(projectPath);
  const stats = statSync(mediaPath);
  if (stats.isDirectory()) return errorResponse(`Media path must be a file: ${mediaPath}`);
  const mediaId = randomUUID();
  const mediaDir = join(dirname(projectPath), 'media');
  const ext = extname(mediaPath);
  const storedMediaPath = join(mediaDir, `${mediaId}${ext}`);
  mkdirSync(mediaDir, { recursive: true });
  copyFileSync(mediaPath, storedMediaPath);
  const media = {
    id: mediaId,
    type: args.mediaType ?? inferMediaType(mediaPath),
    label: args.label?.trim() || basename(mediaPath),
    path: storedMediaPath,
    sizeBytes: stats.size,
    originalPath: mediaPath,
    source: { kind: 'user-import' },
  };
  project.media.push(media);
  const versionId = addVersion(project, `Imported media ${media.label}`, ctx, 'video_media_import');
  writeJsonAtomic(projectPath, project);
  return ok(`Imported media "${media.label}" into ${project.title}.`, {
    ok: true,
    projectPath,
    mediaId: media.id,
    media,
    versionId,
  });
}

export async function handleVideoClipAdd(ctx: SessionToolContext, args: VideoClipAddInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  const project = readProject(projectPath);
  const media = args.mediaId ? project.media.find((asset) => asset.id === args.mediaId) : undefined;
  if (args.mediaId && !media) return errorResponse(`Media not found in project: ${args.mediaId}`);
  const clipType = args.type ?? (media?.type === 'audio' ? 'audio' : media?.type === 'image' ? 'image' : media?.type === 'caption' ? 'caption' : args.text ? 'text' : 'text');
  if (!media && ['video', 'audio', 'image'].includes(clipType)) {
    return errorResponse(`${clipType} clips require a mediaId. Use type: "text" for generated title/text clips.`);
  }
  const durationMs = args.durationMs ?? (clipType === 'image' || clipType === 'text' ? 3000 : 1000);
  if (durationMs <= 0) return errorResponse('durationMs must be positive.');
  const startMs = args.startMs ?? project.timeline.durationMs;
  if (startMs < 0) return errorResponse('startMs must be non-negative.');
  const track = chooseTrack(project, media?.type ?? (clipType === 'audio' ? 'audio' : clipType === 'caption' ? 'caption' : 'video'), args.trackId);
  const clip = {
    id: randomUUID(),
    mediaId: media?.id,
    type: clipType,
    startMs,
    durationMs,
    sourceInMs: args.sourceInMs,
    sourceOutMs: args.sourceOutMs,
    label: args.label?.trim() || media?.label || clipType,
    ...(args.text ? { text: { text: args.text, fontSize: 64, color: '#ffffff' } } : {}),
  };
  track.clips.push(clip);
  project.timeline.durationMs = Math.max(project.timeline.durationMs, startMs + durationMs);
  const errors = validateProject(project);
  if (errors.length) return errorResponse(errors[0] ?? 'Invalid video project.');
  const versionId = addVersion(project, `Added ${clip.label} clip`, ctx, 'video_clip_add');
  writeJsonAtomic(projectPath, project);
  return ok(`Added clip "${clip.label}" to track "${track.label}".`, {
    ok: true,
    projectPath,
    clipId: clip.id,
    trackId: track.id,
    versionId,
  });
}

export async function handleVideoExport(ctx: SessionToolContext, args: VideoExportInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  const project = readProject(projectPath);
  const outputPathResult = resolveWorkspacePath(ctx, args.outputPath ?? join(dirname(projectPath), 'renders', 'preview.placeholder.txt'), 'outputPath');
  if (!outputPathResult.ok) return errorResponse(outputPathResult.error);
  const outputPath = outputPathResult.path;
  mkdirSync(dirname(outputPath), { recursive: true });
  const createdAt = new Date().toISOString();
  const realVideo = isVideoOutputPath(outputPath);
  if (realVideo) {
    try {
      renderSimpleMp4(project, outputPath);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  } else {
    writeFileSync(outputPath, [
      'RunnerOS Video Studio placeholder export',
      `Project: ${project.title}`,
      `Project ID: ${project.id}`,
      `Created: ${createdAt}`,
      'This is not a playable MP4. Use an .mp4 output path for the simple FFmpeg renderer.',
      '',
    ].join('\n'), 'utf-8');
  }
  const receiptPath = `${outputPath}.receipt.json`;
  writeJsonAtomic(receiptPath, {
    ok: true,
    placeholder: !realVideo,
    rendered: realVideo,
    projectPath,
    outputPath,
    preset: args.preset ?? (realVideo ? 'simple-mp4' : 'placeholder'),
    createdAt,
  });
  project.exports.push({
    id: randomUUID(),
    createdAt,
    status: 'succeeded',
    path: outputPath,
    preset: args.preset ?? (realVideo ? 'simple-mp4' : 'placeholder'),
    placeholder: !realVideo,
    receiptPath,
  });
  const versionId = addVersion(project, `Exported ${realVideo ? 'video' : 'placeholder'} ${basename(outputPath)}`, ctx, 'video_export');
  writeJsonAtomic(projectPath, project);

  let outputId: string | undefined;
  if (args.publishOutput && ctx.createOutput) {
    const result = await ctx.createOutput({
      title: `${project.title} ${realVideo ? 'video export' : 'placeholder export'}`,
      kind: realVideo ? 'video' : 'receipt',
      summary: realVideo ? 'Video Studio simple MP4 render.' : 'Placeholder Video Studio export receipt.',
      files: [
        { path: outputPath, label: basename(outputPath), role: realVideo ? 'primary' : 'supporting' },
        { path: receiptPath, label: basename(receiptPath), role: realVideo ? 'supporting' : 'primary' },
        { path: projectPath, label: basename(projectPath), role: 'source' },
      ],
      receipts: [{
        provider: 'runner-video-studio',
        action: realVideo ? 'simple-mp4-export' : 'placeholder-export',
        status: 'succeeded',
        displayText: realVideo ? 'Playable MP4 export created.' : 'Placeholder export created.',
        metadata: { projectId: project.id, placeholder: !realVideo, rendered: realVideo },
      }],
      tags: ['video-studio', realVideo ? 'video-export' : 'placeholder-export'],
      showInCanvas: args.showInCanvas,
    });
    outputId = result.outputId;
  }

  return ok(`${realVideo ? 'Rendered video' : 'Created placeholder export'} at ${outputPath}.`, {
    ok: true,
    projectPath,
    outputPath,
    receiptPath,
    placeholder: !realVideo,
    rendered: realVideo,
    versionId,
    outputId,
  });
}
