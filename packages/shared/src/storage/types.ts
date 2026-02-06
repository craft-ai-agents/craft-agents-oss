/**
 * Storage Provider Interface
 *
 * Abstracts workspace-scoped storage operations so that local filesystem
 * and cloud API storage are interchangeable. Each provider is scoped to
 * a single workspace.
 *
 * Local provider: wraps existing filesystem storage functions
 * Cloud provider: communicates via WebSocket + REST to a Cloudflare Worker
 */

import type { SessionConfig, StoredSession, SessionMetadata, SessionTokenUsage } from '../sessions/types.ts';
import type { FolderSourceConfig, LoadedSource, SourceGuide, CreateSourceInput } from '../sources/types.ts';
import type { WorkspaceStatusConfig, StatusConfig } from '../statuses/types.ts';
import type { WorkspaceLabelConfig, LabelConfig } from '../labels/types.ts';
import type { LoadedSkill } from '../skills/types.ts';
import type { Plan } from '../agent/plan-types.ts';

// ============================================================
// Change Events (for real-time sync)
// ============================================================

export type RemoteChangeEvent =
  | { entity: 'session'; action: 'created' | 'updated' | 'deleted'; data: SessionMetadata }
  | { entity: 'source'; action: 'created' | 'updated' | 'deleted'; data: FolderSourceConfig }
  | { entity: 'statuses'; action: 'updated'; data: WorkspaceStatusConfig }
  | { entity: 'labels'; action: 'updated'; data: WorkspaceLabelConfig }
  | { entity: 'skill'; action: 'created' | 'updated' | 'deleted'; data: { slug: string } };

// ============================================================
// Domain-Specific Storage Interfaces
// ============================================================

export interface ISessionStorage {
  createSession(options?: {
    name?: string;
    workingDirectory?: string;
    permissionMode?: SessionConfig['permissionMode'];
    enabledSourceSlugs?: string[];
    model?: string;
    hidden?: boolean;
  }): Promise<SessionConfig>;

  loadSession(sessionId: string): Promise<StoredSession | null>;
  saveSession(session: StoredSession): Promise<void>;
  deleteSession(sessionId: string): Promise<boolean>;
  listSessions(): Promise<SessionMetadata[]>;
  clearSessionMessages(sessionId: string): Promise<void>;

  updateSessionMetadata(
    sessionId: string,
    updates: Partial<Pick<SessionConfig,
      | 'isFlagged'
      | 'name'
      | 'todoState'
      | 'labels'
      | 'lastReadMessageId'
      | 'hasUnread'
      | 'enabledSourceSlugs'
      | 'workingDirectory'
      | 'permissionMode'
      | 'sharedUrl'
      | 'sharedId'
      | 'model'
      | 'isRemoteSandbox'
    >>
  ): Promise<void>;

  updateSessionSdkId(sessionId: string, sdkSessionId: string): Promise<void>;

  // Plan operations
  savePlan(sessionId: string, plan: Plan, fileName?: string): Promise<string>;
  loadPlan(sessionId: string, fileName: string): Promise<Plan | null>;
  listPlans(sessionId: string): Promise<Array<{ name: string; path: string; modifiedAt: number }>>;
  deletePlan(sessionId: string, fileName: string): Promise<boolean>;
}

export interface ISourceStorage {
  createSource(input: CreateSourceInput): Promise<FolderSourceConfig>;
  loadSource(sourceSlug: string): Promise<LoadedSource | null>;
  saveSourceConfig(config: FolderSourceConfig): Promise<void>;
  deleteSource(sourceSlug: string): Promise<void>;
  loadWorkspaceSources(): Promise<LoadedSource[]>;
  sourceExists(sourceSlug: string): Promise<boolean>;

  // Guide operations
  loadSourceGuide(sourceSlug: string): Promise<SourceGuide | null>;
  saveSourceGuide(sourceSlug: string, guide: SourceGuide): Promise<void>;
}

export interface IStatusStorage {
  loadStatusConfig(): Promise<WorkspaceStatusConfig>;
  saveStatusConfig(config: WorkspaceStatusConfig): Promise<void>;
  getStatus(statusId: string): Promise<StatusConfig | null>;
  listStatuses(): Promise<StatusConfig[]>;
}

export interface ILabelStorage {
  loadLabelConfig(): Promise<WorkspaceLabelConfig>;
  saveLabelConfig(config: WorkspaceLabelConfig): Promise<void>;
  listLabels(): Promise<LabelConfig[]>;
  listLabelsFlat(): Promise<LabelConfig[]>;
  getLabel(labelId: string): Promise<LabelConfig | null>;
}

export interface ISkillStorage {
  loadSkill(slug: string): Promise<LoadedSkill | null>;
  loadWorkspaceSkills(): Promise<LoadedSkill[]>;
  deleteSkill(slug: string): Promise<boolean>;
  listSkillSlugs(): Promise<string[]>;
}

// ============================================================
// Asset Storage (workspace-scoped icons/images via R2)
// ============================================================

export interface IAssetStorage {
  /** Upload an asset (icon, image) to workspace storage */
  upload(relativePath: string, data: Buffer | string, mimeType: string): Promise<void>;
  /** Download an asset. Returns SVG string for .svg, data URL for binary images, null if not found */
  download(relativePath: string): Promise<string | null>;
  /** Delete an asset. Returns true if deleted, false if not found */
  delete(relativePath: string): Promise<boolean>;
  /** Get a signed URL for direct asset access */
  getSignedUrl(relativePath: string, expiresIn?: number): Promise<string>;
}

// ============================================================
// File Storage (R2 for cloud, filesystem for local)
// ============================================================

export type FileType = 'attachments' | 'downloads' | 'long_responses';

export interface FileMetadata {
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: number;
}

export interface IFileStorage {
  /**
   * Upload a file to storage.
   * @param sessionId - The session this file belongs to
   * @param type - The file type category
   * @param filename - The filename to store as
   * @param data - The file content as a Buffer
   * @param mimeType - Optional MIME type (defaults to application/octet-stream)
   */
  upload(
    sessionId: string,
    type: FileType,
    filename: string,
    data: Buffer,
    mimeType?: string
  ): Promise<FileMetadata>;

  /**
   * Download a file from storage.
   * @returns The file content as a Buffer, or null if not found
   */
  download(sessionId: string, type: FileType, filename: string): Promise<Buffer | null>;

  /**
   * Delete a file from storage.
   * @returns true if deleted, false if not found
   */
  delete(sessionId: string, type: FileType, filename: string): Promise<boolean>;

  /**
   * List all files of a given type for a session.
   */
  list(sessionId: string, type: FileType): Promise<FileMetadata[]>;

  /**
   * Delete all files for a session (used when deleting a session).
   */
  deleteAllForSession(sessionId: string): Promise<void>;

  /**
   * Get a URL for accessing a file.
   * For cloud storage: returns a signed HTTPS URL (time-limited)
   * For local storage: returns a file:// URL
   * @param expiresIn - Expiration time in seconds (default 900 = 15 minutes)
   */
  getFileUrl(
    sessionId: string,
    type: FileType,
    filename: string,
    expiresIn?: number
  ): Promise<string>;
}

// ============================================================
// Top-Level Storage Provider
// ============================================================

export interface IStorageProvider {
  readonly type: 'local' | 'cloud';
  readonly workspaceId: string;

  sessions: ISessionStorage;
  sources: ISourceStorage;
  statuses: IStatusStorage;
  labels: ILabelStorage;
  skills: ISkillStorage;
  files: IFileStorage;
  assets?: IAssetStorage;

  /** Initialize the provider (ensure dirs for local, connect WS for cloud) */
  initialize(): Promise<void>;

  /** Clean up resources (flush queues for local, close WS for cloud) */
  dispose(): Promise<void>;

  /**
   * Register a listener for remote change events (cloud only, no-op for local).
   * Returns an unsubscribe function.
   */
  onRemoteChange(callback: (event: RemoteChangeEvent) => void): () => void;
}
