import { basename, extname, join } from 'node:path';
import type {
  MissionAssetClassification,
  MissionAssetKind,
  MissionAssetKindHint,
} from './types.ts';

const AUDIO_EXTENSIONS = new Set(['.wav', '.aiff', '.aif', '.flac', '.mp3', '.m4a']);
const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v', '.avi', '.mkv', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.psd', '.ai', '.tif', '.tiff']);
const DOC_EXTENSIONS = new Set(['.txt', '.md', '.docx', '.pdf', '.rtf']);

export function inferMimeType(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.aiff' || ext === '.aif') return 'audio/aiff';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.md') return 'text/markdown';
  if (ext === '.txt') return 'text/plain';
  return 'application/octet-stream';
}

export function classifyMissionAsset(filePath: string, kindHint: MissionAssetKindHint = 'any'): MissionAssetClassification {
  const name = basename(filePath);
  const lower = name.toLowerCase();
  const ext = extname(name).toLowerCase();

  if (kindHint === 'master') return route('master', 'audio/masters', 'high', 'Chosen through Add Master');
  if (kindHint === 'lyrics') return route('lyrics', 'docs/lyrics', 'high', 'Chosen through Add Lyrics');
  if (kindHint === 'cover-art') return route('cover-art', 'images/cover-art', 'high', 'Chosen through Add Cover Art');

  if (AUDIO_EXTENSIONS.has(ext)) {
    if (/\b(stem|vocal|instrumental|drums?|bass|guitar|keys?|acapella|acappella)\b/.test(lower)) {
      return route('stem', 'audio/stems', 'high', 'Audio filename suggests stem');
    }
    if (/\b(demo|idea|rough|scratch|draft)\b/.test(lower)) {
      return route('demo', 'audio/demos', 'high', 'Audio filename suggests demo');
    }
    if (/\b(ref|reference|inspo|inspiration)\b/.test(lower)) {
      return route('audio-reference', 'audio/references', 'high', 'Audio filename suggests reference');
    }
    return route('master', 'audio/masters', ext === '.wav' || ext === '.aiff' || ext === '.aif' || ext === '.flac' ? 'medium' : 'low', 'Audio file');
  }

  if (VIDEO_EXTENSIONS.has(ext)) {
    if (/\b(final|export|render|deliverable|finished)\b/.test(lower)) {
      return route('final-video', 'video/finals', 'high', 'Video filename suggests final');
    }
    if (/\b(edit|cut|version|v\d+)\b/.test(lower)) {
      return route('edited-video', 'video/edits', 'medium', 'Video filename suggests edit');
    }
    return route('raw-video', 'video/raw', 'medium', 'Video file');
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    if (/\b(cover|artwork|art|single-cover|album-cover)\b/.test(lower)) {
      return route('cover-art', 'images/cover-art', 'high', 'Image filename suggests cover art');
    }
    if (/\b(press|photo|headshot|portrait|promo)\b/.test(lower)) {
      return route('press-photo', 'images/press-photos', 'high', 'Image filename suggests press photo');
    }
    if (/\b(mood|board|ref|reference|inspo|visual)\b/.test(lower)) {
      return route('moodboard-image', 'images/moodboard', 'high', 'Image filename suggests moodboard');
    }
    return route('cover-art', 'images/cover-art', 'low', 'Image file');
  }

  if (DOC_EXTENSIONS.has(ext)) {
    if (/\b(lyric|lyrics)\b/.test(lower)) {
      return route('lyrics', 'docs/lyrics', 'high', 'Document filename suggests lyrics');
    }
    if (/\b(press|bio|epk|release|one-sheet|onesheet)\b/.test(lower)) {
      return route('press-doc', 'docs/press', 'high', 'Document filename suggests press material');
    }
    return route('note', 'docs/notes', 'medium', 'Document file');
  }

  return route('other', 'docs/notes', 'low', 'Unknown file type');
}

export function destinationForKind(kind: MissionAssetKind): string {
  switch (kind) {
    case 'master': return 'audio/masters';
    case 'demo': return 'audio/demos';
    case 'stem': return 'audio/stems';
    case 'audio-reference': return 'audio/references';
    case 'raw-video': return 'video/raw';
    case 'edited-video': return 'video/edits';
    case 'final-video': return 'video/finals';
    case 'cover-art': return 'images/cover-art';
    case 'press-photo': return 'images/press-photos';
    case 'moodboard-image': return 'images/moodboard';
    case 'lyrics': return 'docs/lyrics';
    case 'press-doc': return 'docs/press';
    case 'note': return 'docs/notes';
    case 'export': return 'exports/social';
    default: return 'docs/notes';
  }
}

export function displayKind(kind: MissionAssetKind): string {
  return kind.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function assetRelativePath(directory: string, fileName: string): string {
  return join('assets', directory, fileName).replace(/\\/g, '/');
}

function route(
  kind: MissionAssetKind,
  directory: string,
  confidence: MissionAssetClassification['confidence'],
  reason: string,
): MissionAssetClassification {
  return { kind, directory, confidence, reason };
}
