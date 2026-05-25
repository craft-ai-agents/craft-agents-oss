import type { OutputManifest, OutputPreviewMode, OutputSummary } from './types.ts';

export function summarizeOutputContent(content: string, maxLength = 240): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function previewModeForMimeType(mimeType: string | undefined): OutputPreviewMode {
  if (isWorkflowMimeType(mimeType)) return 'workflow';
  if (isChartMimeType(mimeType)) return 'chart';
  if (mimeType === 'text/markdown') return 'markdown';
  if (mimeType === 'application/json') return 'json';
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType === 'model/gltf-binary' || mimeType === 'model/gltf+json') return 'model';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/vnd.excalidraw+json') return 'excalidraw';
  if (isPresentationMimeType(mimeType)) return 'presentation';
  return 'text';
}

export function inferPreviewMode(mimeType?: string, path?: string): OutputPreviewMode {
  const lowerPath = path?.toLowerCase() ?? '';
  if (isWorkflowMimeType(mimeType) || /\.workflow(?:-run)?\.json$/.test(lowerPath)) return 'workflow';
  if (isChartMimeType(mimeType) || /\.(chart|vega|vegalite)\.json$/.test(lowerPath)) return 'chart';
  if (mimeType === 'text/markdown' || lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) return 'markdown';
  if (mimeType === 'application/json' || lowerPath.endsWith('.json')) return 'json';
  if (mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg)$/.test(lowerPath)) return 'image';
  if (mimeType?.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/.test(lowerPath)) return 'video';
  if (mimeType?.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/.test(lowerPath)) return 'audio';
  if (mimeType === 'model/gltf-binary' || mimeType === 'model/gltf+json' || /\.(glb|gltf)$/.test(lowerPath)) return 'model';
  if (mimeType === 'application/pdf' || lowerPath.endsWith('.pdf')) return 'pdf';
  if (mimeType === 'application/vnd.excalidraw+json' || lowerPath.endsWith('.excalidraw')) return 'excalidraw';
  if (isPresentationMimeType(mimeType) || /\.(pptx?|odp)$/.test(lowerPath)) return 'presentation';
  if (mimeType === 'text/csv' || /\.(csv|tsv)$/.test(lowerPath)) return 'table';
  return 'text';
}

function isPresentationMimeType(mimeType: string | undefined): boolean {
  return mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    || mimeType === 'application/vnd.ms-powerpoint'
    || mimeType === 'application/vnd.oasis.opendocument.presentation';
}

function isChartMimeType(mimeType: string | undefined): boolean {
  return mimeType === 'application/vnd.runneros.chart+json'
    || mimeType === 'application/vnd.vega.v5+json'
    || mimeType === 'application/vnd.vegalite.v5+json';
}

function isWorkflowMimeType(mimeType: string | undefined): boolean {
  return mimeType === 'application/vnd.runneros.workflow+json'
    || mimeType === 'application/vnd.runneros.workflow-run+json';
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
