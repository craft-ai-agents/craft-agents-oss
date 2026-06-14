export const VIDEO_PROJECT_SCHEMA_VERSION = 1;
export const DEFAULT_VIDEO_PROJECT_FILE = 'video.runner-video.json';

export type VideoAspectRatio = '9:16' | '1:1' | '16:9' | '4:5' | 'custom';
export type VideoMediaType = 'video' | 'audio' | 'image' | 'caption' | 'svg' | 'lottie' | 'html' | 'unknown';
export type VideoTrackType = 'video' | 'audio' | 'image' | 'text' | 'caption' | 'effect' | 'adjustment';
export type VideoClipType = 'video' | 'audio' | 'image' | 'text' | 'caption' | 'shape' | 'lottie' | 'html';

export interface RunnerVideoProject {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  sourceSessionId?: string;
  canvasOutputId?: string;
  settings: VideoProjectSettings;
  media: VideoMediaAsset[];
  timeline: VideoTimeline;
  captions: VideoCaptionTrack[];
  overlays: VideoOverlay[];
  effects: VideoEffect[];
  templates: VideoTemplateBinding[];
  exports: VideoExportRecord[];
  versions: VideoProjectVersion[];
  agentEvents: VideoAgentEvent[];
}

export interface VideoProjectSettings {
  aspectRatio: VideoAspectRatio;
  width: number;
  height: number;
  fps: number;
  durationMs?: number;
  backgroundColor?: string;
  safeArea?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface VideoMediaAsset {
  id: string;
  type: VideoMediaType;
  label: string;
  path: string;
  mimeType?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  waveformPath?: string;
  thumbnailPath?: string;
  transcriptPath?: string;
  source:
    | { kind: 'user-import' }
    | { kind: 'agent-output'; sessionId: string; outputId?: string }
    | { kind: 'generated'; provider?: string; receiptId?: string }
    | { kind: 'screen-recording' }
    | { kind: 'workflow-output'; workflowRunId: string };
}

export interface VideoTimeline {
  durationMs: number;
  tracks: VideoTrack[];
  markers: VideoMarker[];
  selection?: VideoSelection;
}

export interface VideoTrack {
  id: string;
  type: VideoTrackType;
  label: string;
  locked?: boolean;
  muted?: boolean;
  hidden?: boolean;
  height?: number;
  clips: VideoClip[];
}

export interface VideoClip {
  id: string;
  mediaId?: string;
  type: VideoClipType;
  startMs: number;
  durationMs: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  label?: string;
  transform?: VideoTransform;
  crop?: VideoCrop;
  opacity?: number;
  volume?: number;
  speed?: number;
  adjustments?: VideoClipAdjustments;
  effects?: string[];
  transitionIn?: VideoTransition;
  transitionOut?: VideoTransition;
  keyframes?: VideoKeyframe[];
  text?: VideoTextPayload;
  captionCueIds?: string[];
}

export interface VideoClipAdjustments {
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

export interface VideoTransform {
  x: number;
  y: number;
  scale: number;
  rotateDeg: number;
  anchorX?: number;
  anchorY?: number;
}

export interface VideoCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoTransition {
  type: string;
  durationMs: number;
}

export interface VideoKeyframe {
  timeMs: number;
  property: string;
  value: unknown;
  easing?: string;
}

export interface VideoTextPayload {
  text: string;
  fontFamily?: string;
  fontSize: number;
  fontWeight?: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  stylePreset?: string;
}

export interface VideoMarker {
  id: string;
  timeMs: number;
  label: string;
  color?: string;
}

export interface VideoSelection {
  clipIds?: string[];
  trackIds?: string[];
  markerIds?: string[];
}

export interface VideoCaptionTrack {
  id: string;
  label: string;
  cues: VideoCaptionCue[];
  style?: Record<string, unknown>;
}

export interface VideoCaptionCue {
  id: string;
  startMs: number;
  durationMs: number;
  text: string;
}

export interface VideoOverlay {
  id: string;
  type: 'text' | 'image' | 'shape' | 'lottie' | 'html';
  clipId?: string;
  payload: Record<string, unknown>;
}

export interface VideoEffect {
  id: string;
  type: string;
  label?: string;
  params: Record<string, unknown>;
}

export interface VideoTemplateBinding {
  id: string;
  templateSlug: string;
  params: Record<string, unknown>;
}

export interface VideoExportRecord {
  id: string;
  createdAt: string;
  status: 'pending' | 'succeeded' | 'failed';
  path?: string;
  preset?: string;
  placeholder?: boolean;
  error?: string;
  receiptPath?: string;
}

export interface VideoProjectVersion {
  id: string;
  createdAt: string;
  summary: string;
  actor: 'user' | 'agent' | 'system';
  agentSlug?: string;
  sessionId?: string;
}

export interface VideoAgentEvent {
  id: string;
  createdAt: string;
  agentSlug: string;
  sessionId: string;
  toolName: string;
  summary: string;
  beforeVersionId?: string;
  afterVersionId?: string;
  receiptPath?: string;
}

export interface VideoValidationIssue {
  path: string;
  message: string;
}

export interface VideoValidationResult {
  ok: boolean;
  errors: VideoValidationIssue[];
  warnings: VideoValidationIssue[];
}
