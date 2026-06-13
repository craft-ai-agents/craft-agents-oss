#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const command = args[0] || 'help';

function hasFlag(name) {
  return args.includes(name);
}

function opt(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function positional(index) {
  return args.slice(1).filter((arg, i, all) => {
    if (arg.startsWith('--')) return false;
    const prev = all[i - 1];
    return !(prev && prev.startsWith('--'));
  })[index];
}

function print(payload) {
  if (hasFlag('--json')) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (payload.lines?.length) console.log(payload.lines.join('\n'));
  else console.log(payload.message || JSON.stringify(payload, null, 2));
}

function fail(message, extra = {}) {
  print({ ok: false, error: message, ...extra });
  process.exit(1);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJsonAtomic(path, value) {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(tmp, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultSettings(aspectRatio = '9:16') {
  if (aspectRatio === '16:9') return { aspectRatio, width: 1920, height: 1080, fps: 30 };
  if (aspectRatio === '1:1') return { aspectRatio, width: 1080, height: 1080, fps: 30 };
  if (aspectRatio === '4:5') return { aspectRatio, width: 1080, height: 1350, fps: 30 };
  return { aspectRatio, width: 1080, height: 1920, fps: 30 };
}

function createProject({ title, workspaceId, aspectRatio }) {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: randomUUID(),
    title: title || 'Untitled Video',
    createdAt: now,
    updatedAt: now,
    workspaceId: workspaceId || basename(process.cwd()),
    settings: defaultSettings(aspectRatio),
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

function validateProject(project) {
  const errors = [];
  const requiredArrays = ['media', 'captions', 'overlays', 'effects', 'templates', 'exports', 'versions', 'agentEvents'];
  if (!project || typeof project !== 'object' || Array.isArray(project)) errors.push('Project must be an object.');
  else {
    if (project.version !== 1) errors.push('version must be 1.');
    if (!project.id) errors.push('id is required.');
    if (!project.title) errors.push('title is required.');
    if (!project.workspaceId) errors.push('workspaceId is required.');
    if (!project.settings || typeof project.settings !== 'object') errors.push('settings is required.');
    else {
      if (!project.settings.aspectRatio) errors.push('settings.aspectRatio is required.');
      if (!(project.settings.width > 0)) errors.push('settings.width must be positive.');
      if (!(project.settings.height > 0)) errors.push('settings.height must be positive.');
      if (!(project.settings.fps > 0)) errors.push('settings.fps must be positive.');
    }
    for (const key of requiredArrays) {
      if (!Array.isArray(project[key])) errors.push(`${key} must be an array.`);
    }
    if (!project.timeline || typeof project.timeline !== 'object') errors.push('timeline is required.');
    else if (!Array.isArray(project.timeline.tracks)) errors.push('timeline.tracks must be an array.');

    const mediaIds = new Set((project.media || []).map((media) => media.id).filter(Boolean));
    for (const [trackIndex, track] of (project.timeline?.tracks || []).entries()) {
      if (!Array.isArray(track.clips)) errors.push(`timeline.tracks[${trackIndex}].clips must be an array.`);
      for (const [clipIndex, clip] of (track.clips || []).entries()) {
        const path = `timeline.tracks[${trackIndex}].clips[${clipIndex}]`;
        if (!clip.id) errors.push(`${path}.id is required.`);
        if (typeof clip.durationMs !== 'number' || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0) errors.push(`${path}.durationMs must be positive.`);
        if (typeof clip.startMs !== 'number' || !Number.isFinite(clip.startMs) || clip.startMs < 0) errors.push(`${path}.startMs must be non-negative.`);
        if (clip.mediaId && !mediaIds.has(clip.mediaId)) errors.push(`${path}.mediaId references missing media.`);
        if (clip.sourceInMs !== undefined && (typeof clip.sourceInMs !== 'number' || !Number.isFinite(clip.sourceInMs) || clip.sourceInMs < 0)) errors.push(`${path}.sourceInMs must be non-negative.`);
        if (clip.sourceOutMs !== undefined && (typeof clip.sourceOutMs !== 'number' || !Number.isFinite(clip.sourceOutMs) || clip.sourceOutMs < 0)) errors.push(`${path}.sourceOutMs must be non-negative.`);
        if (clip.sourceInMs !== undefined && clip.sourceOutMs !== undefined && clip.sourceOutMs <= clip.sourceInMs) errors.push(`${path}.sourceOutMs must be greater than sourceInMs.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function timelineDuration(tracks) {
  return (tracks || []).reduce((duration, track) => {
    const trackEnd = (track.clips || []).reduce((end, clip) => Math.max(end, (clip.startMs || 0) + (clip.durationMs || 0)), 0);
    return Math.max(duration, trackEnd);
  }, 0);
}

function orderedClips(track) {
  return [...(track.clips || [])].sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
}

function addProjectVersion(project, summary) {
  const now = new Date().toISOString();
  project.updatedAt = now;
  project.versions = Array.isArray(project.versions) ? project.versions : [];
  project.versions.push({ id: randomUUID(), createdAt: now, summary, actor: 'user' });
}

function findClip(project, clipId) {
  for (const track of project.timeline?.tracks || []) {
    const index = (track.clips || []).findIndex((clip) => clip.id === clipId);
    if (index !== -1) return { track, clip: track.clips[index], index };
  }
  return null;
}

function packProjectTimeline(project) {
  const next = cloneJson(project);
  let moved = 0;
  for (const track of next.timeline.tracks || []) {
    let cursor = 0;
    track.clips = orderedClips(track).map((clip) => {
      const previous = clip.startMs || 0;
      const updated = { ...clip, startMs: cursor };
      if (previous !== cursor) moved += 1;
      cursor += Math.max(1, clip.durationMs || 1);
      return updated;
    });
  }
  next.timeline.durationMs = timelineDuration(next.timeline.tracks);
  addProjectVersion(next, `Packed timeline (${moved} clip${moved === 1 ? '' : 's'} moved)`);
  return { project: next, changed: moved };
}

function splitProjectClip(project, clipId, atMs) {
  if (!Number.isFinite(atMs) || atMs < 0) fail('--at-ms must be a non-negative number.');
  const next = cloneJson(project);
  const found = findClip(next, clipId);
  if (!found) fail(`Clip not found: ${clipId}`);
  const { track, clip, index } = found;
  const start = clip.startMs || 0;
  const duration = clip.durationMs || 0;
  const end = start + duration;
  if (atMs <= start || atMs >= end) fail(`Split time must be inside the clip (${start}-${end} ms).`);
  const firstDuration = atMs - start;
  const secondDuration = end - atMs;
  const sourceIn = clip.sourceInMs || 0;
  const first = {
    ...clip,
    durationMs: firstDuration,
    sourceOutMs: clip.sourceOutMs !== undefined ? sourceIn + firstDuration : clip.sourceOutMs,
  };
  const second = {
    ...clip,
    id: randomUUID(),
    startMs: atMs,
    durationMs: secondDuration,
    label: clip.label ? `${clip.label} copy` : undefined,
    sourceInMs: sourceIn + firstDuration,
    sourceOutMs: clip.sourceOutMs,
  };
  track.clips.splice(index, 1, first, second);
  next.timeline.durationMs = timelineDuration(next.timeline.tracks);
  addProjectVersion(next, `Split clip ${clip.label || clip.id}`);
  return { project: next, createdClipId: second.id };
}

function deleteProjectClip(project, clipId, ripple = false) {
  const next = cloneJson(project);
  const found = findClip(next, clipId);
  if (!found) fail(`Clip not found: ${clipId}`);
  const { track, clip, index } = found;
  const removedDuration = clip.durationMs || 0;
  const removedStart = clip.startMs || 0;
  track.clips.splice(index, 1);
  if (ripple) {
    track.clips = (track.clips || []).map((item) => (item.startMs || 0) > removedStart
      ? { ...item, startMs: Math.max(0, (item.startMs || 0) - removedDuration) }
      : item);
  }
  next.timeline.durationMs = timelineDuration(next.timeline.tracks);
  addProjectVersion(next, `Deleted clip ${clip.label || clip.id}${ripple ? ' with ripple' : ''}`);
  return { project: next, deletedClipId: clipId };
}

function duplicateProjectClip(project, clipId) {
  const next = cloneJson(project);
  const found = findClip(next, clipId);
  if (!found) fail(`Clip not found: ${clipId}`);
  const { track, clip, index } = found;
  const insertStart = (clip.startMs || 0) + Math.max(1, clip.durationMs || 1);
  const clipDuration = Math.max(1, clip.durationMs || 1);
  const duplicate = {
    ...clip,
    id: randomUUID(),
    startMs: insertStart,
    label: clip.label ? `${clip.label} copy` : undefined,
  };
  track.clips = (track.clips || []).map((item, itemIndex) => itemIndex > index && (item.startMs || 0) >= insertStart
    ? { ...item, startMs: (item.startMs || 0) + clipDuration }
    : item);
  track.clips.splice(index + 1, 0, duplicate);
  next.timeline.durationMs = timelineDuration(next.timeline.tracks);
  addProjectVersion(next, `Duplicated clip ${clip.label || clip.id}`);
  return { project: next, createdClipId: duplicate.id };
}

function inspectProject(project) {
  const issues = [];
  const warnings = [];
  const mediaById = new Map((project.media || []).map((media) => [media.id, media]));
  for (const [trackIndex, track] of (project.timeline?.tracks || []).entries()) {
    const clips = orderedClips(track);
    let cursor = 0;
    for (const [clipIndex, clip] of clips.entries()) {
      const label = clip.label || clip.id || `track ${trackIndex} clip ${clipIndex}`;
      const start = clip.startMs || 0;
      const end = start + (clip.durationMs || 0);
      if (start > cursor) warnings.push({ type: 'gap', trackId: track.id, clipId: clip.id, message: `${label} starts after a ${start - cursor} ms gap.` });
      if (start < cursor) issues.push({ type: 'overlap', trackId: track.id, clipId: clip.id, message: `${label} overlaps the previous clip by ${cursor - start} ms.` });
      if (clip.mediaId) {
        const media = mediaById.get(clip.mediaId);
        if (!media) issues.push({ type: 'missing-media', trackId: track.id, clipId: clip.id, message: `${label} references missing media ${clip.mediaId}.` });
        else if (!['video', 'image', 'audio'].includes(media.type)) warnings.push({ type: 'unsupported-simple-render', trackId: track.id, clipId: clip.id, message: `${label} uses ${media.type}, which the simple MP4 renderer cannot render yet.` });
        else if (!existsSync(media.path)) issues.push({ type: 'missing-file', trackId: track.id, clipId: clip.id, message: `${label} media file is missing: ${media.path}` });
      }
      cursor = Math.max(cursor, end);
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    warnings,
    stats: {
      tracks: project.timeline?.tracks?.length || 0,
      clips: (project.timeline?.tracks || []).reduce((count, track) => count + (track.clips?.length || 0), 0),
      media: project.media?.length || 0,
      durationMs: project.timeline?.durationMs || 0,
    },
  };
}

function inferType(path) {
  const ext = extname(path).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)) return 'audio';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext)) return 'image';
  if (['.srt', '.vtt'].includes(ext)) return 'caption';
  if (ext === '.svg') return 'svg';
  if (ext === '.json') return 'unknown';
  return 'unknown';
}

function isVideoOutputPath(path) {
  return ['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(extname(path).toLowerCase());
}

function escapeDrawText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\r?\n/g, ' ')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .slice(0, 180);
}

function seconds(ms, fallbackMs = 0) {
  return Math.max(0, (ms ?? fallbackMs) / 1000);
}

function ffmpegNumber(value) {
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function textForClip(clip, fallback) {
  return typeof clip.text?.text === 'string' ? clip.text.text : (clip.label || fallback);
}

function renderSimpleMp4(project, outputPath) {
  const width = typeof project.settings?.width === 'number' ? project.settings.width : 1080;
  const height = typeof project.settings?.height === 'number' ? project.settings.height : 1920;
  const fps = typeof project.settings?.fps === 'number' ? project.settings.fps : 30;
  const durationSeconds = Math.max(1, Math.ceil((project.timeline?.durationMs || 3000) / 1000));
  const mediaById = new Map((project.media || []).map((media) => [media.id, media]));
  const clips = (project.timeline?.tracks || [])
    .flatMap((track) => track.clips || [])
    .sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
  const mediaClips = clips
    .map((clip) => ({ clip, media: clip.mediaId ? mediaById.get(clip.mediaId) : undefined }))
    .filter((item) => item.media);
  const unsupportedClips = mediaClips.filter(({ media }) => !['video', 'image', 'audio'].includes(media.type));
  if (unsupportedClips.length > 0) {
    const labels = unsupportedClips.slice(0, 3).map(({ clip }) => clip.label || clip.id).join(', ');
    fail(`Simple MP4 renderer only supports video, image, audio, and text clips right now: ${labels}.`);
  }

  const args = ['-y', '-f', 'lavfi', '-i', `color=c=#111111:s=${width}x${height}:r=${fps}:d=${durationSeconds}`];
  const inputClips = [];
  for (const { clip, media } of mediaClips) {
    if (!existsSync(media.path)) fail(`Media file not found for clip "${clip.label || clip.id}": ${media.path}`);
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

  const filters = [`[0:v]format=rgba[base0]`];
  let currentVideo = '[base0]';
  let overlayIndex = 0;
  for (const { clip, media, inputIndex } of inputClips.filter((item) => item.media.type === 'video' || item.media.type === 'image')) {
    const start = ffmpegNumber(seconds(clip.startMs));
    const end = ffmpegNumber(seconds((clip.startMs || 0) + (clip.durationMs || 1000)));
    const prepared = `v${overlayIndex}`;
    const next = `base${overlayIndex + 1}`;
    filters.push(
      `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,format=rgba,setpts=PTS-STARTPTS+${start}/TB[${prepared}]`,
    );
    filters.push(`${currentVideo}[${prepared}]overlay=0:0:enable='between(t,${start},${end})'[${next}]`);
    currentVideo = `[${next}]`;
    overlayIndex += 1;
  }

  const textClips = (project.timeline?.tracks || [])
    .flatMap((track) => track.clips || [])
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

  const audioLabels = [];
  inputClips.filter((item) => item.media.type === 'audio').forEach(({ clip, inputIndex }, index) => {
    const delayMs = Math.max(0, Math.round(clip.startMs || 0));
    const clipDuration = ffmpegNumber(seconds(clip.durationMs, 1000));
    const label = `a${index}`;
    filters.push(`[${inputIndex}:a]atrim=duration=${clipDuration},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1[${label}]`);
    audioLabels.push(`[${label}]`);
  });
  if (audioLabels.length > 0) {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0,atrim=duration=${durationSeconds}[aout]`);
  }

  filters.push(`${currentVideo}format=yuv420p[vout]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (audioLabels.length > 0) args.push('-map', '[aout]');
  args.push('-t', String(durationSeconds), '-r', String(fps), '-pix_fmt', 'yuv420p');
  if (['.mp4', '.mov', '.m4v'].includes(extname(outputPath).toLowerCase())) {
    args.push('-movflags', '+faststart');
  }
  args.push(outputPath);

  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
  if (result.status !== 0) fail(result.stderr || result.stdout || 'ffmpeg failed to render video.');
}

function probeMedia(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) fail(`Media file not found: ${path}`);
  const stats = statSync(resolved);
  return {
    ok: true,
    path: resolved,
    label: basename(resolved),
    type: inferType(resolved),
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

function runDoctor() {
  const nodeVersion = process.version;
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' });
  const ffmpegAvailable = ffmpeg.status === 0;
  const lines = [
    `✓ Node: ${nodeVersion}`,
    ffmpegAvailable ? '✓ ffmpeg available for video/image/audio/text MP4 exports' : '• ffmpeg not found; placeholder exports still work.',
    `• Tool root: ${resolve(join(import.meta.dirname, '..'))}`,
    '• Simple media timeline renderer enabled for .mp4 outputs.',
  ];
  print({
    ok: true,
    source: 'video-studio',
    checks: [
      { name: 'node', ok: true, value: nodeVersion },
      { name: 'ffmpeg', ok: ffmpegAvailable },
      { name: 'renderer', ok: ffmpegAvailable, value: ffmpegAvailable ? 'ffmpeg-simple' : 'placeholder-only' },
    ],
    canCreateProjects: true,
    canPlaceholderExport: true,
    canRenderRealVideo: ffmpegAvailable,
    lines,
  });
}

function runCreate() {
  const target = positional(0);
  if (!target) fail('Usage: video-studio create <project-dir-or-file> [--title <title>] [--json]');
  const resolvedTarget = resolve(target);
  const projectPath = extname(resolvedTarget) === '.json'
    ? resolvedTarget
    : join(resolvedTarget, 'video.runner-video.json');
  if (existsSync(projectPath) && !hasFlag('--force')) {
    fail(`Project already exists: ${projectPath}. Pass --force to overwrite.`);
  }
  const project = createProject({
    title: opt('--title', 'Untitled Video'),
    workspaceId: opt('--workspace-id', basename(process.cwd())),
    aspectRatio: opt('--aspect-ratio', '9:16'),
  });
  writeJsonAtomic(projectPath, project);
  print({
    ok: true,
    projectPath,
    projectId: project.id,
    title: project.title,
    lines: [`✓ Created video project: ${projectPath}`],
  });
}

function runValidate() {
  const projectPath = positional(0);
  if (!projectPath) fail('Usage: video-studio validate <project-path> [--json]');
  const resolved = resolve(projectPath);
  if (!existsSync(resolved)) fail(`Project file not found: ${projectPath}`);
  let project;
  try {
    project = readJson(resolved);
  } catch (error) {
    fail(`Project JSON is invalid: ${error.message}`);
  }
  const validation = validateProject(project);
  if (!validation.ok) fail('Project validation failed.', { projectPath: resolved, errors: validation.errors });
  print({
    ok: true,
    projectPath: resolved,
    projectId: project.id,
    title: project.title,
    tracks: project.timeline.tracks.length,
    media: project.media.length,
    lines: [`✓ Project valid: ${resolved}`],
  });
}

function readValidProject(projectPath) {
  const resolved = resolve(projectPath);
  if (!existsSync(resolved)) fail(`Project file not found: ${projectPath}`);
  let project;
  try {
    project = readJson(resolved);
  } catch (error) {
    fail(`Project JSON is invalid: ${error.message}`);
  }
  const validation = validateProject(project);
  if (!validation.ok) fail('Project validation failed.', { projectPath: resolved, errors: validation.errors });
  return { resolved, project };
}

function runProbe() {
  const mediaPath = positional(0);
  if (!mediaPath) fail('Usage: video-studio probe <media-path> [--json]');
  print(probeMedia(mediaPath));
}

function runInspect() {
  const projectPath = positional(0);
  if (!projectPath) fail('Usage: video-studio inspect <project-path> [--json]');
  const { resolved, project } = readValidProject(projectPath);
  const report = inspectProject(project);
  print({
    ok: report.ok,
    projectPath: resolved,
    ...report,
    lines: [
      report.ok ? `✓ Project inspect passed: ${resolved}` : `✕ Project inspect found ${report.issues.length} issue(s).`,
      `• ${report.stats.clips} clips across ${report.stats.tracks} tracks`,
      `• ${report.warnings.length} warning(s)`,
    ],
  });
  if (!report.ok) process.exit(1);
}

function runDryRun() {
  const projectPath = positional(0);
  if (!projectPath) fail('Usage: video-studio dry-run <project-path> [--json]');
  const { resolved, project } = readValidProject(projectPath);
  const report = inspectProject(project);
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' });
  const ffmpegAvailable = ffmpeg.status === 0;
  const renderable = report.ok && ffmpegAvailable && report.warnings.every((warning) => warning.type !== 'unsupported-simple-render');
  print({
    ok: renderable,
    projectPath: resolved,
    renderable,
    ffmpegAvailable,
    inspect: report,
    lines: [
      renderable ? `✓ Dry-run export passed: ${resolved}` : `✕ Dry-run export failed: ${resolved}`,
      ffmpegAvailable ? '✓ ffmpeg available' : '✕ ffmpeg unavailable',
      `• ${report.issues.length} issue(s), ${report.warnings.length} warning(s)`,
    ],
  });
  if (!renderable) process.exit(1);
}

function runEdit() {
  const projectPath = positional(0);
  if (!projectPath) fail('Usage: video-studio edit <project-path> --action pack|split|delete|duplicate [--clip-id <id>] [--at-ms <ms>] [--ripple] [--json]');
  const action = opt('--action', '');
  const clipId = opt('--clip-id', '');
  const { resolved, project } = readValidProject(projectPath);
  let result;
  if (action === 'pack') result = packProjectTimeline(project);
  else if (action === 'split') result = splitProjectClip(project, clipId, Number(opt('--at-ms', Number.NaN)));
  else if (action === 'delete') result = deleteProjectClip(project, clipId, hasFlag('--ripple'));
  else if (action === 'duplicate') result = duplicateProjectClip(project, clipId);
  else fail('Unknown edit action. Use pack, split, delete, or duplicate.');
  const validation = validateProject(result.project);
  if (!validation.ok) fail('Edit produced an invalid project.', { errors: validation.errors });
  writeJsonAtomic(resolved, result.project);
  print({
    ok: true,
    projectPath: resolved,
    action,
    ...Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'project')),
    durationMs: result.project.timeline.durationMs,
    lines: [`✓ Applied ${action} edit: ${resolved}`],
  });
}

function runExport() {
  const projectPath = positional(0);
  if (!projectPath) fail('Usage: video-studio export <project-path> --out <output-path> [--json]');
  const resolvedProject = resolve(projectPath);
  const outPath = resolve(opt('--out', join(dirname(resolvedProject), 'renders', 'preview.placeholder.txt')));
  if (!existsSync(resolvedProject)) fail(`Project file not found: ${projectPath}`);
  const project = readJson(resolvedProject);
  const validation = validateProject(project);
  if (!validation.ok) fail('Project validation failed.', { projectPath: resolvedProject, errors: validation.errors });
  ensureDir(dirname(outPath));
  const realVideo = isVideoOutputPath(outPath);
  if (realVideo) {
    renderSimpleMp4(project, outPath);
  } else {
    writeFileSync(
      outPath,
      [
        'RunnerOS Video Studio placeholder export',
        `Project: ${project.title}`,
        `Project ID: ${project.id}`,
        `Created: ${new Date().toISOString()}`,
        'This is not a playable MP4. Use an .mp4 output path for the simple FFmpeg renderer.',
        '',
      ].join('\n'),
      'utf-8',
    );
  }
  const receiptPath = `${outPath}.receipt.json`;
  const receipt = {
    ok: true,
    placeholder: !realVideo,
    rendered: realVideo,
    projectPath: resolvedProject,
    outputPath: outPath,
    createdAt: new Date().toISOString(),
    engine: realVideo ? 'runneros-video-studio-ffmpeg-simple' : 'runneros-video-studio-placeholder',
    note: realVideo ? 'Playable MP4 rendered by the simple FFmpeg media timeline engine.' : 'Placeholder export written by foundation CLI.',
  };
  writeJsonAtomic(receiptPath, receipt);
  project.exports.push({
    id: randomUUID(),
    createdAt: receipt.createdAt,
    status: 'succeeded',
    path: outPath,
    preset: opt('--preset', realVideo ? 'simple-mp4' : 'placeholder'),
    placeholder: !realVideo,
    receiptPath,
  });
  project.updatedAt = receipt.createdAt;
  writeJsonAtomic(resolvedProject, project);
  print({
    ok: true,
    projectPath: resolvedProject,
    outputPath: outPath,
    receiptPath,
    placeholder: !realVideo,
    rendered: realVideo,
    lines: [
      realVideo ? `✓ MP4 export rendered: ${outPath}` : `✓ Placeholder export written: ${outPath}`,
      `✓ Receipt written: ${receiptPath}`,
      realVideo ? '• Playable MP4 created by the simple media renderer.' : '• Use an .mp4 output path for the simple renderer.',
    ],
  });
}

function usage() {
  console.log(`runner-video-studio

Usage:
  video-studio doctor [--json]
  video-studio create <project-dir-or-file> [--title <title>] [--aspect-ratio 9:16|1:1|16:9|4:5] [--force] [--json]
  video-studio probe <media-path> [--json]
  video-studio inspect <project-path> [--json]
  video-studio dry-run <project-path> [--json]
  video-studio edit <project-path> --action pack|split|delete|duplicate [--clip-id <id>] [--at-ms <ms>] [--ripple] [--json]
  video-studio validate <project-path> [--json]
  video-studio export <project-path> --out <output-path> [--preset <name>] [--json]
`);
}

if (command === 'doctor') runDoctor();
else if (command === 'create') runCreate();
else if (command === 'validate') runValidate();
else if (command === 'probe') runProbe();
else if (command === 'inspect') runInspect();
else if (command === 'dry-run') runDryRun();
else if (command === 'edit') runEdit();
else if (command === 'export') runExport();
else usage();
