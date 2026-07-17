/**
 * Share store — persistence backends for self-hosted conversation sharing.
 *
 * Two interchangeable backends, selected by `CRAFT_SHARE_ID_MODE`:
 *
 * - **hash** (default, mirrors the hosted behaviour): "Share" uploads a copy
 *   of the session; we mint an unguessable ~21-char id and persist the JSON
 *   under `CONFIG_DIR/shares/<id>.json`. Revoking deletes that file.
 *
 * - **session** (zero-copy self-host mode): the share id *is* the real session
 *   id and we serve the live session straight from workspace storage. Nothing
 *   is duplicated. Sharing flips the session's `sharedId` marker and revoking
 *   clears it, so only sessions explicitly shared are ever served.
 *
 * Both backends expose the same tiny interface consumed by the HTTP handler.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import { getWorkspaces } from '@craft-agent/shared/config/storage'
import { loadSession, updateSessionMetadata } from '@craft-agent/shared/sessions/storage'

export type ShareIdMode = 'hash' | 'session'

/** Anything JSON-serialisable with an `id`; in practice a `StoredSession`. */
export type ShareSession = Record<string, unknown> & { id?: string }

export interface ShareStore {
  readonly mode: ShareIdMode
  /** Persist/register a share, returning the id that addresses it. */
  create(session: ShareSession): Promise<string>
  /** Fetch a shared session, or null if not shared / not found. */
  get(id: string): Promise<ShareSession | null>
  /** Replace the contents of an existing share (no-op for live session mode). */
  put(id: string, session: ShareSession): Promise<void>
  /** Revoke a share. Returns false if nothing was shared under that id. */
  delete(id: string): Promise<boolean>
}

// ---------------------------------------------------------------------------
// id generation / validation
// ---------------------------------------------------------------------------

// URL-safe alphabet, matching the shape of the hosted 21-char ids (nanoid-style).
const ID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'
const ID_LENGTH = 21

/** Generate an unguessable, URL-safe share id (~125 bits of entropy). */
export function generateShareId(): string {
  const bytes = new Uint8Array(ID_LENGTH)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < ID_LENGTH; i++) {
    out += ID_ALPHABET[bytes[i]! & 63]
  }
  return out
}

/**
 * Reject ids that could escape the store directory or the session namespace.
 * `basename` strips any path components; we then whitelist the character set.
 */
export function isSafeShareId(id: string): boolean {
  if (!id || typeof id !== 'string') return false
  if (id.length > 128) return false
  if (basename(id) !== id) return false
  return /^[A-Za-z0-9_-]+$/.test(id)
}

// ---------------------------------------------------------------------------
// hash backend — self-contained copies on the local filesystem
// ---------------------------------------------------------------------------

export class HashShareStore implements ShareStore {
  readonly mode = 'hash' as const
  private readonly dir: string

  constructor(dir: string = join(CONFIG_DIR, 'shares')) {
    this.dir = dir
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  private pathFor(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  async create(session: ShareSession): Promise<string> {
    // Retry on the (astronomically unlikely) id collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = generateShareId()
      const path = this.pathFor(id)
      if (existsSync(path)) continue
      writeFileSync(path, JSON.stringify(session), 'utf-8')
      return id
    }
    throw new Error('Failed to allocate a unique share id')
  }

  async get(id: string): Promise<ShareSession | null> {
    if (!isSafeShareId(id)) return null
    const path = this.pathFor(id)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as ShareSession
    } catch {
      return null
    }
  }

  async put(id: string, session: ShareSession): Promise<void> {
    if (!isSafeShareId(id)) throw new Error('Invalid share id')
    const path = this.pathFor(id)
    if (!existsSync(path)) throw new Error('Share not found')
    writeFileSync(path, JSON.stringify(session), 'utf-8')
  }

  async delete(id: string): Promise<boolean> {
    if (!isSafeShareId(id)) return false
    const path = this.pathFor(id)
    if (!existsSync(path)) return false
    rmSync(path, { force: true })
    return true
  }
}

// ---------------------------------------------------------------------------
// session backend — zero-copy live serving from workspace storage
// ---------------------------------------------------------------------------

export class SessionShareStore implements ShareStore {
  readonly mode = 'session' as const

  /** Find the workspace that owns a given session id, if any. */
  private locate(id: string): { rootPath: string; session: ShareSession } | null {
    for (const ws of getWorkspaces()) {
      const session = loadSession(ws.rootPath, id) as ShareSession | null
      if (session) return { rootPath: ws.rootPath, session }
    }
    return null
  }

  async create(session: ShareSession): Promise<string> {
    const id = typeof session.id === 'string' ? session.id : ''
    if (!isSafeShareId(id)) throw new Error('Session has no valid id to share')
    const found = this.locate(id)
    if (!found) throw new Error('Session not found')
    // Mark it shared so `get` will serve it (and revoke can turn it off).
    await updateSessionMetadata(found.rootPath, id, { sharedId: id })
    return id
  }

  async get(id: string): Promise<ShareSession | null> {
    if (!isSafeShareId(id)) return null
    const found = this.locate(id)
    if (!found) return null
    // Only serve sessions that are currently marked shared.
    if (found.session.sharedId !== id) return null
    return found.session
  }

  async put(_id: string, _session: ShareSession): Promise<void> {
    // Live serving — the on-disk session is always current, nothing to write.
  }

  async delete(id: string): Promise<boolean> {
    if (!isSafeShareId(id)) return false
    const found = this.locate(id)
    if (!found || found.session.sharedId !== id) return false
    await updateSessionMetadata(found.rootPath, id, { sharedId: undefined, sharedUrl: undefined })
    return true
  }
}

export function createShareStore(mode: ShareIdMode, opts?: { dir?: string }): ShareStore {
  return mode === 'session' ? new SessionShareStore() : new HashShareStore(opts?.dir)
}
