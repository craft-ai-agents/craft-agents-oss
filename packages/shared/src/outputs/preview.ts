import type { OutputManifest, OutputPreviewMode, OutputSummary } from './types.ts';

export function summarizeOutputContent(content: string, maxLength = 240): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function previewModeForMimeType(mimeType: string | undefined): OutputPreviewMode {
  if (mimeType === 'text/markdown') return 'markdown';
  if (mimeType === 'application/json') return 'json';
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  return 'text';
}

export function inferPreviewMode(mimeType?: string, path?: string): OutputPreviewMode {
  const lowerPath = path?.toLowerCase() ?? '';
  if (mimeType === 'text/markdown' || lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) return 'markdown';
  if (mimeType === 'application/json' || lowerPath.endsWith('.json')) return 'json';
  if (mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg)$/.test(lowerPath)) return 'image';
  if (mimeType?.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/.test(lowerPath)) return 'video';
  if (mimeType?.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/.test(lowerPath)) return 'audio';
  if (mimeType === 'text/csv' || /\.(csv|tsv)$/.test(lowerPath)) return 'table';
  return 'text';
}

export const deriveOutputSummaryFallback = summarizeOutputContent;

export function toOutputSummary(manifest: OutputManifest): OutputSummary {
  return {
    id: manifest.id,
    workspaceId: manifest.workspaceId,
    title: manifest.title,
    slug: manifest.slug,
    kind: manifest.kind,
    status: manifest.status,
    summary: manifest.summary,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    completedAt: manifest.completedAt,
    origin: manifest.origin,
    preview: manifest.preview,
    primaryAssetId: manifest.primary?.id,
    previewMode: manifest.preview?.mode,
    assetCount: manifest.assets.length,
    receiptCount: manifest.receipts.length,
    linkCount: manifest.links.length,
    tags: manifest.tags,
  };
}
