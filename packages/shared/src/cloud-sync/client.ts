/**
 * Sync HTTP Client
 *
 * Communicates with Cloudflare Pages Functions for sync operations.
 * Token sent as X-Sync-Token header; server derives R2 prefix from SHA-256(token).
 */

import { VIEWER_URL } from '../branding.ts'
import type { SyncManifest } from './types.ts'

const SYNC_API_BASE = `${VIEWER_URL}/sync/api`

export class SyncClient {
  constructor(private token: string) {}

  /** Get the remote manifest, or null if none exists */
  async getRemoteManifest(): Promise<SyncManifest | null> {
    const res = await fetch(`${SYNC_API_BASE}/manifest`, {
      headers: { 'X-Sync-Token': this.token },
    })

    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`Failed to get manifest: ${res.status} ${res.statusText}`)
    }

    return res.json() as Promise<SyncManifest>
  }

  /**
   * Push files to the cloud.
   * Sends manifest + base64-encoded files in a single request.
   */
  async pushFiles(
    manifest: SyncManifest,
    files: { path: string; data: string }[],
  ): Promise<void> {
    const res = await fetch(`${SYNC_API_BASE}/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Token': this.token,
      },
      body: JSON.stringify({ manifest, files }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Push failed: ${res.status} ${body}`)
    }
  }

  /**
   * Pull specific files from the cloud.
   * Returns base64-encoded file contents.
   */
  async pullFiles(paths: string[]): Promise<{ path: string; data: string }[]> {
    const res = await fetch(`${SYNC_API_BASE}/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Token': this.token,
      },
      body: JSON.stringify({ paths }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Pull failed: ${res.status} ${body}`)
    }

    const result = await res.json() as { files: { path: string; data: string }[] }
    return result.files
  }

  /** Delete all remote data for this token */
  async deleteRemoteData(): Promise<void> {
    const res = await fetch(`${SYNC_API_BASE}`, {
      method: 'DELETE',
      headers: { 'X-Sync-Token': this.token },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Delete failed: ${res.status} ${body}`)
    }
  }
}
