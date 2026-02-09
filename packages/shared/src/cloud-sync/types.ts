/**
 * Cloud Sync Types
 *
 * Types for workspace push/pull via Cloudflare R2.
 */

/** Sync token format: g4sync_ + 32-char hex */
export interface SyncToken {
  /** Raw token value (g4sync_ + hex) */
  raw: string
  /** SHA-256 hash of the raw token (used as R2 key prefix) */
  hash: string
}

/** Manifest describing all files in a synced workspace */
export interface SyncManifest {
  version: 1
  workspaceId: string
  workspaceName: string
  /** Unix timestamp (ms) when pushed */
  pushedAt: number
  /** Hostname of the machine that pushed */
  pushedFrom: string
  /** Total size of all files in bytes */
  totalSize: number
  /** File inventory */
  files: SyncFileEntry[]
}

/** Single file entry in a sync manifest */
export interface SyncFileEntry {
  /** Relative path from workspace root (e.g., "sessions/abc/session.jsonl") */
  path: string
  /** File size in bytes */
  size: number
  /** SHA-256 hash of file contents */
  sha256: string
  /** Last modified timestamp (Unix ms) */
  updatedAt: number
}

/** Diff result between local and remote manifests */
export interface SyncDiff {
  /** Files to upload/download (new or modified) */
  added: SyncFileEntry[]
  /** Files modified (present in both, different hash) */
  modified: SyncFileEntry[]
  /** Files to delete (present in old, absent in new) */
  deleted: SyncFileEntry[]
  /** Total bytes to transfer */
  transferSize: number
}

/** Progress callback during sync operations */
export interface SyncProgress {
  phase: 'scanning' | 'comparing' | 'uploading' | 'downloading' | 'cleaning' | 'done' | 'error'
  /** Current file being processed */
  currentFile?: string
  /** Files processed so far */
  processedFiles: number
  /** Total files to process */
  totalFiles: number
  /** Bytes transferred so far */
  processedBytes: number
  /** Total bytes to transfer */
  totalBytes: number
  /** Error message if phase is 'error' */
  error?: string
}

/** Result of a sync push/pull operation */
export interface SyncResult {
  success: boolean
  /** Number of files uploaded/downloaded */
  filesTransferred: number
  /** Number of files deleted */
  filesDeleted: number
  /** Total bytes transferred */
  bytesTransferred: number
  /** Duration in ms */
  durationMs: number
  /** Error message if failed */
  error?: string
}

/** Preview of what a pull would do (shown before user confirms) */
export interface PullPreview {
  /** Remote manifest metadata */
  remoteWorkspaceName: string
  remotePushedAt: number
  remotePushedFrom: string
  /** Diff summary */
  added: number
  modified: number
  deleted: number
  /** Total bytes to download */
  downloadSize: number
  /** Detailed diff for UI display */
  diff: SyncDiff
}

/** Status of sync for a workspace */
export interface SyncStatus {
  /** Whether a sync token is configured */
  connected: boolean
  /** Last push timestamp (Unix ms) or null */
  lastPushedAt: number | null
  /** Last pull timestamp (Unix ms) or null */
  lastPulledAt: number | null
}
