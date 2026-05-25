export type OutputKind =
  | 'report'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'dataset'
  | 'code'
  | 'model'
  | 'receipt'
  | 'external-action'
  | 'collection'
  | 'other';

export type OutputStatus = 'draft' | 'published' | 'failed' | 'cancelled';

export type OutputAssetRole = 'primary' | 'supporting' | 'source' | 'thumbnail' | 'attachment';

export type OutputPreviewMode =
  | 'markdown'
  | 'text'
  | 'json'
  | 'image'
  | 'video'
  | 'audio'
  | 'model'
  | 'pdf'
  | 'excalidraw'
  | 'presentation'
  | 'table'
  | 'chart'
  | 'receipt'
  | 'external-link'
  | 'web';

export interface OutputAsset {
  id: string;
  label: string;
  role: OutputAssetRole;
  path: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface OutputLink {
  id: string;
  label: string;
  url: string;
  role?: 'primary' | 'source' | 'related' | 'external';
}

export interface OutputReceipt {
  id: string;
  provider: string;
  action: string;
  status: 'succeeded' | 'failed' | 'pending';
  occurredAt: string;
  externalId?: string;
  url?: string;
  displayText?: string;
  metadata?: Record<string, unknown>;
}

export interface OutputOrigin {
  source: 'workflow' | 'session' | 'automation' | 'manual';
  workflowRunId?: string;
  workflowSlug?: string;
  workflowName?: string;
  stepId?: string;
  sessionId?: string;
  agentSlug?: string;
  agentName?: string;
  automationId?: string;
}

export interface OutputPreview {
  mode: OutputPreviewMode;
  assetId?: string;
  inlineText?: string;
}

export interface OutputManifest {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  title: string;
  slug: string;
  kind: OutputKind;
  status: OutputStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  origin: OutputOrigin;
  primary?: OutputAsset;
  assets: OutputAsset[];
  receipts: OutputReceipt[];
  links: OutputLink[];
  preview?: OutputPreview;
  tags?: string[];
}

export interface OutputSummary {
  id: string;
  workspaceId: string;
  title: string;
  slug: string;
  kind: OutputKind;
  status: OutputStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  origin: OutputOrigin;
  preview?: OutputPreview;
  primaryAssetId?: string;
  previewMode?: OutputPreviewMode;
  assetCount: number;
  receiptCount: number;
  linkCount: number;
  tags?: string[];
}

export interface CreateOutputBundleInput {
  id?: string;
  workspaceId: string;
  title: string;
  kind: OutputKind;
  status?: OutputStatus;
  summary?: string;
  origin: OutputManifest['origin'];
  content?: string;
  contentMimeType?: 'text/markdown' | 'text/plain' | 'application/json';
  assets?: OutputAsset[];
  receipts?: OutputReceipt[];
  links?: OutputLink[];
  tags?: string[];
  createdAt?: string;
  completedAt?: string;
}
