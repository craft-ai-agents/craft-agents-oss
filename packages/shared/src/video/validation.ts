import type {
  RunnerVideoProject,
  VideoClip,
  VideoValidationIssue,
  VideoValidationResult,
} from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function push(errors: VideoValidationIssue[], path: string, message: string): void {
  errors.push({ path, message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateClip(clip: VideoClip, path: string, errors: VideoValidationIssue[], mediaIds: Set<string>): void {
  if (!isNonEmptyString(clip.id)) push(errors, `${path}.id`, 'Clip id is required.');
  if (!isNonEmptyString(clip.type)) push(errors, `${path}.type`, 'Clip type is required.');
  if (!isFiniteNonNegativeNumber(clip.startMs)) push(errors, `${path}.startMs`, 'Clip startMs must be a non-negative number.');
  if (typeof clip.durationMs !== 'number' || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0) {
    push(errors, `${path}.durationMs`, 'Clip durationMs must be a positive number.');
  }
  if (clip.mediaId && !mediaIds.has(clip.mediaId)) {
    push(errors, `${path}.mediaId`, `Referenced media "${clip.mediaId}" does not exist.`);
  }
  if (clip.sourceInMs !== undefined && !isFiniteNonNegativeNumber(clip.sourceInMs)) {
    push(errors, `${path}.sourceInMs`, 'sourceInMs must be a non-negative number.');
  }
  if (clip.sourceOutMs !== undefined && !isFiniteNonNegativeNumber(clip.sourceOutMs)) {
    push(errors, `${path}.sourceOutMs`, 'sourceOutMs must be a non-negative number.');
  }
  if (
    clip.sourceInMs !== undefined
    && clip.sourceOutMs !== undefined
    && clip.sourceOutMs <= clip.sourceInMs
  ) {
    push(errors, `${path}.sourceOutMs`, 'sourceOutMs must be greater than sourceInMs.');
  }
  if (clip.text && !isNonEmptyString(clip.text.text)) {
    push(errors, `${path}.text.text`, 'Text clips require non-empty text.');
  }
  if (clip.adjustments !== undefined && !isRecord(clip.adjustments)) {
    push(errors, `${path}.adjustments`, 'Clip adjustments must be an object.');
  }
}

export function validateRunnerVideoProject(value: unknown): VideoValidationResult {
  const errors: VideoValidationIssue[] = [];
  const warnings: VideoValidationIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [{ path: '$', message: 'Video project must be an object.' }],
      warnings,
    };
  }

  const project = value as unknown as RunnerVideoProject;

  if (project.version !== 1) push(errors, 'version', 'Project version must be 1.');
  if (!isNonEmptyString(project.id)) push(errors, 'id', 'Project id is required.');
  if (!isNonEmptyString(project.title)) push(errors, 'title', 'Project title is required.');
  if (!isNonEmptyString(project.workspaceId)) push(errors, 'workspaceId', 'workspaceId is required.');
  if (!isNonEmptyString(project.createdAt) || Number.isNaN(Date.parse(project.createdAt))) {
    push(errors, 'createdAt', 'createdAt must be an ISO date string.');
  }
  if (!isNonEmptyString(project.updatedAt) || Number.isNaN(Date.parse(project.updatedAt))) {
    push(errors, 'updatedAt', 'updatedAt must be an ISO date string.');
  }

  if (!isRecord(project.settings)) {
    push(errors, 'settings', 'settings is required.');
  } else {
    if (!isNonEmptyString(project.settings.aspectRatio)) push(errors, 'settings.aspectRatio', 'aspectRatio is required.');
    if (typeof project.settings.width !== 'number' || project.settings.width <= 0) push(errors, 'settings.width', 'width must be positive.');
    if (typeof project.settings.height !== 'number' || project.settings.height <= 0) push(errors, 'settings.height', 'height must be positive.');
    if (typeof project.settings.fps !== 'number' || project.settings.fps <= 0) push(errors, 'settings.fps', 'fps must be positive.');
  }

  if (!Array.isArray(project.media)) push(errors, 'media', 'media must be an array.');
  if (!isRecord(project.timeline)) push(errors, 'timeline', 'timeline is required.');
  if (!Array.isArray(project.captions)) push(errors, 'captions', 'captions must be an array.');
  if (!Array.isArray(project.overlays)) push(errors, 'overlays', 'overlays must be an array.');
  if (!Array.isArray(project.effects)) push(errors, 'effects', 'effects must be an array.');
  if (!Array.isArray(project.templates)) push(errors, 'templates', 'templates must be an array.');
  if (!Array.isArray(project.exports)) push(errors, 'exports', 'exports must be an array.');
  if (!Array.isArray(project.versions)) push(errors, 'versions', 'versions must be an array.');
  if (!Array.isArray(project.agentEvents)) push(errors, 'agentEvents', 'agentEvents must be an array.');

  const mediaIds = new Set<string>();
  if (Array.isArray(project.media)) {
    project.media.forEach((asset, index) => {
      if (!isNonEmptyString(asset.id)) push(errors, `media[${index}].id`, 'Media id is required.');
      else mediaIds.add(asset.id);
      if (!isNonEmptyString(asset.type)) push(errors, `media[${index}].type`, 'Media type is required.');
      if (!isNonEmptyString(asset.label)) push(errors, `media[${index}].label`, 'Media label is required.');
      if (!isNonEmptyString(asset.path)) push(errors, `media[${index}].path`, 'Media path is required.');
    });
  }

  if (isRecord(project.timeline)) {
    if (!isFiniteNonNegativeNumber(project.timeline.durationMs)) {
      push(errors, 'timeline.durationMs', 'Timeline durationMs must be non-negative.');
    }
    if (!Array.isArray(project.timeline.tracks)) {
      push(errors, 'timeline.tracks', 'timeline.tracks must be an array.');
    } else {
      project.timeline.tracks.forEach((track, trackIndex) => {
        if (!isNonEmptyString(track.id)) push(errors, `timeline.tracks[${trackIndex}].id`, 'Track id is required.');
        if (!isNonEmptyString(track.type)) push(errors, `timeline.tracks[${trackIndex}].type`, 'Track type is required.');
        if (!Array.isArray(track.clips)) {
          push(errors, `timeline.tracks[${trackIndex}].clips`, 'Track clips must be an array.');
        } else {
          track.clips.forEach((clip, clipIndex) => {
            validateClip(clip, `timeline.tracks[${trackIndex}].clips[${clipIndex}]`, errors, mediaIds);
          });
        }
      });
    }
  }

  if (project.versions?.length === 0) {
    warnings.push({ path: 'versions', message: 'Project has no version history yet.' });
  }

  return { ok: errors.length === 0, errors, warnings };
}
