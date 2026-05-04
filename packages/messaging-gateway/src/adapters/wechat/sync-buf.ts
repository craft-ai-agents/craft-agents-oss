/**
 * Persist `get_updates_buf` between adapter restarts.
 *
 * The iLink long-poll endpoint expects every `getupdates` call to echo back
 * the cursor it returned previously; sending an empty string rewinds the
 * stream and risks duplicate / lost messages on restart. We mirror openclaw's
 * disk layout: one JSON file per ilink_bot_id under the workspace's
 * messaging directory.
 *
 * The store is intentionally synchronous + stateless — adapters call `load()`
 * once on init and `save()` after every successful poll. No write-batching:
 * iLink polls return at most every ~35s, so write rate is negligible.
 */

import fs from 'node:fs'
import path from 'node:path'

interface PersistedSyncBuf {
  get_updates_buf: string
}

/** Build the on-disk path for an account's sync-buf file. */
export function syncBufPath(stateDir: string, ilinkBotId: string): string {
  return path.join(stateDir, 'wechat', 'accounts', `${ilinkBotId}.sync.json`)
}

export function loadSyncBuf(filePath: string): string {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PersistedSyncBuf
    return typeof parsed.get_updates_buf === 'string' ? parsed.get_updates_buf : ''
  } catch {
    return ''
  }
}

export function saveSyncBuf(filePath: string, getUpdatesBuf: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(
    filePath,
    JSON.stringify({ get_updates_buf: getUpdatesBuf } satisfies PersistedSyncBuf),
    'utf-8',
  )
}
