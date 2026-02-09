/**
 * Cloud Sync Module
 *
 * Provides workspace push/pull via Cloudflare R2.
 * Uses sync tokens for credential-free cross-device sync.
 *
 * Usage:
 *   import { generateSyncToken, SyncEngine } from '@g4os/shared/cloud-sync';
 */

export type {
  SyncManifest,
  SyncFileEntry,
  SyncDiff,
  SyncProgress,
  SyncResult,
  SyncToken,
  PullPreview,
  SyncStatus,
} from './types.ts'
export { generateSyncToken, hashSyncToken, isValidSyncToken } from './token.ts'
export { buildLocalManifest, computeSyncDiff } from './manifest.ts'
export { SyncClient } from './client.ts'
export { SyncEngine } from './sync-engine.ts'
