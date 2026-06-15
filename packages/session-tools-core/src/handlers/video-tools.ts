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
type AspectRatio = '9:16' | '1:1' | '16:9' | '4:5' | 'custom';

interface VideoProjectCreateInput {
  projectPath?: string;
  projectDir?: string;
  title: string;
  aspectRatio?: AspectRatio;
  width?: number;
  height?: number;
  fps?: number;
  overwrite?: boolean;
}

interface VideoProjectUpdateInput {
  projectPath: string;
  title?: string;
  aspectRatio?: AspectRatio;
  width?: number;
  height?: number;
  fps?: number;
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

interface VideoClipEditInput {
  projectPath: string;
  clipId?: string;
  action: 'move' | 'trim' | 'pack' | 'split' | 'delete' | 'duplicate';
  startMs?: number;
  durationMs?: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  atMs?: number;
  ripple?: boolean;
  snap?: boolean;
}

interface VideoClipAdjustInput {
  projectPath: string;
  clipId: string;
  preset?: 'neutral' | 'clean' | 'cinematic' | 'warm' | 'punchy' | 'black-and-white';
  exposure?: number;
  contrast?: number;
  saturation?: number;
  highlights?: number;
  shadows?: number;
  temperature?: number;
  tint?: number;
  sharpen?: number;
  vignette?: number;
  grain?: number;
  reset?: boolean;
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
    tracks: Array<{ id: string; type: TrackType; label: string; clips: Array<Record<string, unknown> & { id: string; type: ClipType; startMs: number; durationMs: number; mediaId?: string; adjustments?: VideoClipAdjustments }> }>;
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

interface VideoClipAdjustments {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  highlights?: number;
  shadows?: number;
  temperature?: number;
  tint?: number;
  sharpen?: number;
  vignette?: number;
  grain?: number;
  preset?: string;
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

function aspectSettings(aspectRatio: string | undefined): { aspectRatio: AspectRatio; width: number; height: number; fps: number } {
  if (aspectRatio === '16:9') return { aspectRatio, width: 1920, height: 1080, fps: 30 };
  if (aspectRatio === '1:1') return { aspectRatio, width: 1080, height: 1080, fps: 30 };
  if (aspectRatio === '4:5') return { aspectRatio, width: 1080, height: 1350, fps: 30 };
  return { aspectRatio: '9:16', width: 1080, height: 1920, fps: 30 };
}

function aspectMatchesDimensions(aspectRatio: string | undefined, width: number | undefined, height: number | undefined): boolean {
  if (!aspectRatio || aspectRatio === 'custom' || width === undefined || height === undefined) return true;
  const preset = aspectSettings(aspectRatio);
  return preset.width === width && preset.height === height;
}

function normalizeAspectRatio(aspectRatio: string | undefined, width: number | undefined, height: number | undefined): AspectRatio {
  if (aspectRatio === '16:9' || aspectRatio === '1:1' || aspectRatio === '4:5' || aspectRatio === '9:16') {
    return aspectMatchesDimensions(aspectRatio, width, height) ? aspectRatio : 'custom';
  }
  return 'custom';
}

function compactSettings(settings: Partial<{ aspectRatio: AspectRatio; width: number; height: number; fps: number }>): Partial<{ aspectRatio: AspectRatio; width: number; height: number; fps: number }> {
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) as Partial<{ aspectRatio: AspectRatio; width: number; height: number; fps: number }>;
}

function createProject(title: string, workspaceId: string, settings: Partial<{ aspectRatio: AspectRatio; width: number; height: number; fps: number }>): VideoProject {
  const now = new Date().toISOString();
  const defaults = aspectSettings(settings.aspectRatio);
  const compacted = compactSettings(settings);
  const mergedSettings = { ...defaults, ...compacted };
  mergedSettings.aspectRatio = normalizeAspectRatio(mergedSettings.aspectRatio, mergedSettings.width, mergedSettings.height);
  return {
    version: 1,
    id: randomUUID(),
    title: title.trim() || 'Untitled Video',
    createdAt: now,
    updatedAt: now,
    workspaceId,
    settings: mergedSettings,
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
    const ordered = [...(track.clips || [])].sort((a, b) => a.startMs - b.startMs);
    let cursor = 0;
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
    for (const clip of ordered) {
      if (Number.isFinite(clip.startMs) && Number.isFinite(clip.durationMs) && clip.startMs < cursor) {
        errors.push(`timeline.tracks[${trackIndex}].clips.${clip.id}.startMs overlaps the previous clip.`);
      }
      cursor = Math.max(cursor, (clip.startMs || 0) + (clip.durationMs || 0));
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const ADJUSTMENT_PRESETS: Record<NonNullable<VideoClipAdjustInput['preset']>, VideoClipAdjustments> = {
  neutral: {},
  clean: { exposure: 0.03, contrast: 1.05, saturation: 1.04, grain: 0, preset: 'clean' },
  cinematic: { exposure: -0.03, contrast: 1.18, saturation: 0.92, highlights: -0.12, shadows: 0.08, grain: 0.12, preset: 'cinematic' },
  warm: { exposure: 0.02, contrast: 1.05, saturation: 1.08, temperature: 0.18, grain: 0.04, preset: 'warm' },
  punchy: { exposure: 0.04, contrast: 1.25, saturation: 1.22, highlights: -0.05, shadows: -0.04, grain: 0.02, preset: 'punchy' },
  'black-and-white': { exposure: 0, contrast: 1.16, saturation: 0, grain: 0.1, preset: 'black-and-white' },
};

function sanitizedAdjustments(input: Partial<VideoClipAdjustments>): VideoClipAdjustments {
  const next: VideoClipAdjustments = {};
  if (input.exposure !== undefined) next.exposure = clamp(Number(input.exposure), -1, 1);
  if (input.contrast !== undefined) next.contrast = clamp(Number(input.contrast), 0, 3);
  if (input.saturation !== undefined) next.saturation = clamp(Number(input.saturation), 0, 3);
  if (input.highlights !== undefined) next.highlights = clamp(Number(input.highlights), -1, 1);
  if (input.shadows !== undefined) next.shadows = clamp(Number(input.shadows), -1, 1);
  if (input.temperature !== undefined) next.temperature = clamp(Number(input.temperature), -1, 1);
  if (input.tint !== undefined) next.tint = clamp(Number(input.tint), -1, 1);
  if (input.sharpen !== undefined) next.sharpen = clamp(Number(input.sharpen), 0, 1);
  if (input.vignette !== undefined) next.vignette = clamp(Number(input.vignette), 0, 1);
  if (input.grain !== undefined) next.grain = clamp(Number(input.grain), 0, 1);
  if (input.preset !== undefined) next.preset = input.preset;
  return Object.fromEntries(Object.entries(next).filter(([, value]) => Number.isFinite(value as number) || typeof value === 'string')) as VideoClipAdjustments;
}

function hasExplicitAdjustmentInput(args: VideoClipAdjustInput): boolean {
  return [
    args.exposure,
    args.contrast,
    args.saturation,
    args.highlights,
    args.shadows,
    args.temperature,
    args.tint,
    args.sharpen,
    args.vignette,
    args.grain,
  ].some((value) => value !== undefined);
}

function hasAdjustments(adjustments: VideoClipAdjustments | undefined): boolean {
  return Boolean(adjustments && Object.keys(adjustments).some((key) => key !== 'preset'));
}

function adjustmentFilter(inputLabel: string, outputLabel: string, adjustments: VideoClipAdjustments | undefined): string {
  if (!hasAdjustments(adjustments)) return `${inputLabel}null${outputLabel}`;
  const brightness = clamp((adjustments?.exposure ?? 0) + ((adjustments?.highlights ?? 0) * 0.08) + ((adjustments?.shadows ?? 0) * 0.06), -1, 1);
  const contrast = clamp(adjustments?.contrast ?? 1, 0, 3);
  const saturation = clamp((adjustments?.saturation ?? 1) + ((adjustments?.temperature ?? 0) * 0.04) - Math.abs(adjustments?.tint ?? 0) * 0.02, 0, 3);
  const gamma = clamp(1 - ((adjustments?.shadows ?? 0) * 0.12) + ((adjustments?.highlights ?? 0) * 0.08), 0.1, 10);
  const parts = [`eq=brightness=${ffmpegNumber(brightness)}:contrast=${ffmpegNumber(contrast)}:saturation=${ffmpegNumber(saturation)}:gamma=${ffmpegNumber(gamma)}`];
  if ((adjustments?.grain ?? 0) > 0) {
    const strength = Math.round(clamp(adjustments?.grain ?? 0, 0, 1) * 18);
    parts.push(`noise=alls=${strength}:allf=t`);
  }
  if ((adjustments?.sharpen ?? 0) > 0) {
    const amount = ffmpegNumber(clamp(adjustments?.sharpen ?? 0, 0, 1) * 1.2);
    parts.push(`unsharp=5:5:${amount}:3:3:0`);
  }
  if ((adjustments?.vignette ?? 0) > 0) {
    const angle = ffmpegNumber(Math.PI / 5 + clamp(adjustments?.vignette ?? 0, 0, 1) * 0.45);
    parts.push(`vignette=angle=${angle}`);
  }
  return `${inputLabel}${parts.join(',')}${outputLabel}`;
}

function textForClip(clip: VideoProject['timeline']['tracks'][number]['clips'][number], fallback: string): string {
  const textPayload = clip.text;
  if (typeof textPayload === 'object' && textPayload && 'text' in textPayload && typeof textPayload.text === 'string') {
    return textPayload.text;
  }
  return typeof clip.label === 'string' ? clip.label : fallback;
}

function hasAudioStream(path: string): boolean {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=index',
    '-of', 'csv=p=0',
    path,
  ], { encoding: 'utf-8' });
  return result.status === 0 && result.stdout.trim().length > 0;
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
    const adjusted = `adj${overlayIndex}`;
    filters.push(
      `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,format=rgba[${adjusted}]`,
    );
    filters.push(adjustmentFilter(`[${adjusted}]`, `[${prepared}]`, clip.adjustments));
    filters.push(`[${prepared}]setpts=PTS-STARTPTS+${start}/TB[${prepared}t]`);
    filters.push(`${currentVideo}[${prepared}t]overlay=0:0:enable='between(t,${start},${end})'[${next}]`);
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
  inputClips.filter((item) => item.media.type === 'audio' || (item.media.type === 'video' && hasAudioStream(item.media.path))).forEach(({ clip, inputIndex }, index) => {
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

function orderedClips<T extends { startMs: number }>(clips: T[]): T[] {
  return [...clips].sort((a, b) => a.startMs - b.startMs);
}

function timelineDuration(tracks: VideoProject['timeline']['tracks']): number {
  return tracks.reduce((duration, track) => {
    const trackEnd = (track.clips || []).reduce((end, clip) => Math.max(end, clip.startMs + clip.durationMs), 0);
    return Math.max(duration, trackEnd);
  }, 0);
}

function findClip(project: VideoProject, clipId: string): { track: VideoProject['timeline']['tracks'][number]; clip: VideoProject['timeline']['tracks'][number]['clips'][number] } | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function snapClipStart(track: VideoProject['timeline']['tracks'][number], clipId: string, proposedStartMs: number, thresholdMs = 250): number {
  const snapPoints = track.clips
    .filter((clip) => clip.id !== clipId)
    .map((clip) => clip.startMs + Math.max(1, clip.durationMs));
  let best = Math.max(0, Math.round(proposedStartMs));
  let bestDistance = thresholdMs + 1;
  for (const point of snapPoints) {
    const distance = Math.abs(point - proposedStartMs);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return Math.max(0, best);
}

function packTimeline(project: VideoProject): number {
  let changed = 0;
  for (const track of project.timeline.tracks) {
    let cursor = 0;
    track.clips = orderedClips(track.clips).map((clip) => {
      const startMs = cursor;
      cursor += Math.max(1, clip.durationMs);
      if (clip.startMs === startMs) return clip;
      changed += 1;
      return { ...clip, startMs };
    });
  }
  project.timeline.durationMs = timelineDuration(project.timeline.tracks);
  return changed;
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

export async function handleVideoProjectUpdate(ctx: SessionToolContext, args: VideoProjectUpdateInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  const project = readProject(projectPath);

  if (args.title !== undefined) {
    const title = args.title.trim();
    if (!title) return errorResponse('title must not be empty.');
    project.title = title;
  }
  const preset = args.aspectRatio && args.aspectRatio !== 'custom' ? aspectSettings(args.aspectRatio) : undefined;
  const nextSettings: Partial<{ aspectRatio: AspectRatio; width: number; height: number; fps: number }> = preset
    ? { aspectRatio: preset.aspectRatio, width: preset.width, height: preset.height }
    : args.aspectRatio === 'custom'
      ? { aspectRatio: 'custom' }
      : {};
  if (args.width !== undefined) {
    if (!Number.isFinite(args.width) || args.width <= 0) return errorResponse('width must be a positive number.');
    nextSettings.width = Math.round(args.width);
  }
  if (args.height !== undefined) {
    if (!Number.isFinite(args.height) || args.height <= 0) return errorResponse('height must be a positive number.');
    nextSettings.height = Math.round(args.height);
  }
  if (args.fps !== undefined) {
    if (!Number.isFinite(args.fps) || args.fps <= 0) return errorResponse('fps must be a positive number.');
    nextSettings.fps = Math.round(args.fps);
  }
  project.settings = { ...project.settings, ...nextSettings };
  const width = typeof project.settings.width === 'number' ? project.settings.width : undefined;
  const height = typeof project.settings.height === 'number' ? project.settings.height : undefined;
  project.settings.aspectRatio = normalizeAspectRatio(typeof project.settings.aspectRatio === 'string' ? project.settings.aspectRatio : undefined, width, height);

  const errors = validateProject(project);
  if (errors.length) return errorResponse(errors[0] ?? 'Invalid video project.');
  const versionId = addVersion(project, 'Updated project settings', ctx, 'video_project_update');
  writeJsonAtomic(projectPath, project);
  return ok(`Updated video project "${project.title}".`, {
    ok: true,
    projectPath,
    projectId: project.id,
    settings: project.settings,
    versionId,
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

export async function handleVideoClipEdit(ctx: SessionToolContext, args: VideoClipEditInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  const project = readProject(projectPath);
  let trackId: string | undefined;
  let clipId: string | undefined = args.clipId;
  let label = args.clipId;
  let startMs: number | undefined;
  let durationMs: number | undefined;
  let createdClipId: string | undefined;
  let deletedClipId: string | undefined;
  let changed = 0;

  if (args.action === 'pack') {
    changed = packTimeline(project);
    label = 'timeline';
  } else {
    if (!args.clipId) return errorResponse('clipId is required for this action.');
    const found = findClip(project, args.clipId);
    if (!found) return errorResponse(`Clip not found: ${args.clipId}`);
    const { track, clip } = found;
    trackId = track.id;
    label = typeof clip.label === 'string' ? clip.label : clip.id;

    if (args.action === 'move') {
      if (typeof args.startMs !== 'number' || !Number.isFinite(args.startMs) || args.startMs < 0) return errorResponse('startMs must be a non-negative number.');
      clip.startMs = args.snap ? snapClipStart(track, clip.id, args.startMs) : Math.max(0, Math.round(args.startMs));
      track.clips = orderedClips(track.clips);
      startMs = clip.startMs;
      durationMs = clip.durationMs;
    } else if (args.action === 'trim') {
      if (typeof args.durationMs !== 'number' || !Number.isFinite(args.durationMs) || args.durationMs <= 0) return errorResponse('durationMs must be a positive number.');
      clip.durationMs = Math.max(1, Math.round(args.durationMs));
      if (args.sourceInMs !== undefined) {
        if (!Number.isFinite(args.sourceInMs) || args.sourceInMs < 0) return errorResponse('sourceInMs must be a non-negative number.');
        clip.sourceInMs = Math.round(args.sourceInMs);
      }
      if (args.sourceOutMs !== undefined) {
        if (!Number.isFinite(args.sourceOutMs) || args.sourceOutMs < 0) return errorResponse('sourceOutMs must be a non-negative number.');
        clip.sourceOutMs = Math.round(args.sourceOutMs);
      }
      startMs = clip.startMs;
      durationMs = clip.durationMs;
    } else if (args.action === 'split') {
      if (typeof args.atMs !== 'number' || !Number.isFinite(args.atMs) || args.atMs < 0) return errorResponse('atMs must be a non-negative number.');
      const splitAt = Math.round(args.atMs);
      if (splitAt <= clip.startMs || splitAt >= clip.startMs + clip.durationMs) return errorResponse('atMs must be inside the clip bounds.');
      const firstDuration = splitAt - clip.startMs;
      const secondDuration = clip.durationMs - firstDuration;
      const sourceInMs = typeof clip.sourceInMs === 'number' ? clip.sourceInMs : 0;
      const secondClip = {
        ...clip,
        id: randomUUID(),
        startMs: splitAt,
        durationMs: secondDuration,
        sourceInMs: sourceInMs + firstDuration,
        label: typeof clip.label === 'string' ? `${clip.label} split` : undefined,
      };
      clip.durationMs = firstDuration;
      if (clip.sourceOutMs !== undefined) clip.sourceOutMs = sourceInMs + firstDuration;
      const index = track.clips.findIndex((item) => item.id === clip.id);
      track.clips.splice(index + 1, 0, secondClip);
      createdClipId = secondClip.id;
      startMs = clip.startMs;
      durationMs = clip.durationMs;
    } else if (args.action === 'delete') {
      const deletedStartMs = clip.startMs;
      const deletedDurationMs = clip.durationMs;
      track.clips = track.clips.filter((item) => item.id !== clip.id);
      if (args.ripple) {
        track.clips = track.clips.map((item) => item.startMs >= deletedStartMs + deletedDurationMs ? {
          ...item,
          startMs: Math.max(0, item.startMs - deletedDurationMs),
        } : item);
      }
      deletedClipId = clip.id;
      clipId = undefined;
    } else if (args.action === 'duplicate') {
      const newClip = {
        ...clip,
        id: randomUUID(),
        startMs: clip.startMs + Math.max(1, clip.durationMs),
        label: typeof clip.label === 'string' ? `${clip.label} copy` : undefined,
      };
      for (let index = 0; index < track.clips.length; index += 1) {
        const item = track.clips[index];
        if (item && item.id !== clip.id && item.startMs >= newClip.startMs) {
          track.clips[index] = { ...item, startMs: item.startMs + Math.max(1, clip.durationMs) };
        }
      }
      track.clips.push(newClip);
      track.clips = orderedClips(track.clips);
      createdClipId = newClip.id;
      clipId = newClip.id;
      startMs = newClip.startMs;
      durationMs = newClip.durationMs;
    } else {
      return errorResponse('Unknown video clip edit action.');
    }
  }

  project.timeline.durationMs = timelineDuration(project.timeline.tracks);
  const errors = validateProject(project);
  if (errors.length) return errorResponse(errors[0] ?? 'Invalid video project.');
  const actionLabel = args.action[0]!.toUpperCase() + args.action.slice(1);
  const versionId = addVersion(project, `${actionLabel} ${label ?? 'clip'}${args.action === 'pack' ? '' : ' clip'}`, ctx, 'video_clip_edit');
  writeJsonAtomic(projectPath, project);
  return ok(`Applied ${args.action} edit to "${label ?? 'timeline'}".`, {
    ok: true,
    projectPath,
    clipId,
    createdClipId,
    deletedClipId,
    changed,
    trackId,
    startMs,
    durationMs,
    versionId,
  });
}

export async function handleVideoClipAdjust(ctx: SessionToolContext, args: VideoClipAdjustInput): Promise<ToolResult> {
  if (!args.projectPath) return errorResponse('projectPath is required.');
  if (!args.clipId) return errorResponse('clipId is required.');
  const projectPathResult = resolveWorkspacePath(ctx, args.projectPath, 'projectPath');
  if (!projectPathResult.ok) return errorResponse(projectPathResult.error);
  const projectPath = projectPathResult.path;
  if (!existsSync(projectPath)) return errorResponse(`Project not found: ${projectPath}`);
  const project = readProject(projectPath);
  const found = findClip(project, args.clipId);
  if (!found) return errorResponse(`Clip not found: ${args.clipId}`);
  const { clip, track } = found;

  if (args.reset) {
    delete clip.adjustments;
  } else {
    const media = clip.mediaId ? project.media.find((asset) => asset.id === clip.mediaId) : undefined;
    if (!media || !['video', 'image'].includes(media.type)) {
      return errorResponse(`Clip "${clip.label ?? clip.id}" is not a video or image clip that can render look adjustments.`);
    }
    const preset = args.preset ? ADJUSTMENT_PRESETS[args.preset] : undefined;
    if (args.preset && !preset) return errorResponse(`Unknown adjustment preset: ${args.preset}`);
    const hasExplicit = hasExplicitAdjustmentInput(args);
    const base = args.preset ? { ...(preset ?? {}) } : { ...(clip.adjustments ?? {}) };
    clip.adjustments = sanitizedAdjustments({
      ...base,
      exposure: args.exposure ?? base.exposure,
      contrast: args.contrast ?? base.contrast,
      saturation: args.saturation ?? base.saturation,
      highlights: args.highlights ?? base.highlights,
      shadows: args.shadows ?? base.shadows,
      temperature: args.temperature ?? base.temperature,
      tint: args.tint ?? base.tint,
      sharpen: args.sharpen ?? base.sharpen,
      vignette: args.vignette ?? base.vignette,
      grain: args.grain ?? base.grain,
      preset: hasExplicit ? 'manual' : args.preset ?? clip.adjustments?.preset,
    });
  }

  const errors = validateProject(project);
  if (errors.length) return errorResponse(errors[0] ?? 'Invalid video project.');
  const versionId = addVersion(project, `${args.reset ? 'Reset' : 'Adjusted'} ${clip.label ?? clip.id} clip look`, ctx, 'video_clip_adjust');
  writeJsonAtomic(projectPath, project);
  return ok(`${args.reset ? 'Reset' : 'Applied'} adjustments for clip "${clip.label ?? clip.id}".`, {
    ok: true,
    projectPath,
    clipId: clip.id,
    trackId: track.id,
    adjustments: clip.adjustments ?? {},
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
