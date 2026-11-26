import { writeFile, rename, unlink } from 'fs/promises'
import { dirname } from 'path'
import type { StoredSession, SessionHeader } from './types.js'
import { getSessionFilePath, ensureSessionsDir, ensureSessionDir } from './storage.js'
import { toPortablePath } from '../utils/paths.js'
import { createSessionHeader, makeSessionPathPortable, readSessionHeader, rewriteSessionHeader } from './jsonl.js'
import { debug } from '../utils/debug.js'

interface PendingWrite {
  data: StoredSession
  timer: ReturnType<typeof setTimeout>
}

interface HeaderMetadataSignature {
  name?: string
  labels?: string[]
  isFlagged?: boolean
  sessionStatus?: string
  permissionMode?: string
  hasUnread?: boolean
  lastReadMessageId?: string
}

function getHeaderMetadataSignature(header: SessionHeader): string {
  const signature: HeaderMetadataSignature = {
    name: header.name,
    labels: header.labels,
    isFlagged: header.isFlagged,
    sessionStatus: header.sessionStatus,
    permissionMode: header.permissionMode,
    hasUnread: header.hasUnread,
    lastReadMessageId: header.lastReadMessageId,
  }
  return JSON.stringify(signature)
}

function mergeHeaderWithExternalMetadata(localHeader: SessionHeader, diskHeader: SessionHeader): SessionHeader {
  return {
    ...localHeader,
    name: diskHeader.name,
    labels: diskHeader.labels,
    isFlagged: diskHeader.isFlagged,
    sessionStatus: diskHeader.sessionStatus,
    permissionMode: diskHeader.permissionMode,
    hasUnread: diskHeader.hasUnread,
    lastReadMessageId: diskHeader.lastReadMessageId,
  }
}

/**
 * Debounced async session persistence queue.
 * Prevents main thread blocking by using async writes and coalescing
 * rapid successive persist calls into a single write.
 *
 * IMPORTANT: Writes are serialized per-session (`writeChains`): debounced writes, flushes and
 * header patches each start after the session's previous write settles, so two never write the
 * same file at once (e.g. a timer write and a flush, or clearSessionForRecovery +
 * onSdkSessionIdUpdate flushing in quick succession), and a header patch never lands under a
 * newer full write.
 */
class SessionPersistenceQueue {
  private pending = new Map<string, PendingWrite>()
  /** Per session: its last write, which the next one waits for (removed once nothing waits). */
  private writeChains = new Map<string, Promise<void>>()
  private lastWrittenHeaderSignature = new Map<string, string>()
  private debounceMs: number

  constructor(debounceMs = 500) {
    this.debounceMs = debounceMs
  }

  /**
   * Queue a session for persistence. If a write is already pending for this
   * session, it will be replaced with the new data and the timer reset.
   */
  enqueue(session: StoredSession): void {
    const existing = this.pending.get(session.id)
    if (existing) {
      clearTimeout(existing.timer)
    }

    const timer = setTimeout(() => {
      void this.flush(session.id)
    }, this.debounceMs)

    this.pending.set(session.id, { data: session, timer })
  }

  /** Run `op` once the session's previous write has settled; the next one waits for it in turn. */
  private serialize(sessionId: string, op: () => Promise<void>): Promise<void> {
    const run = (this.writeChains.get(sessionId) ?? Promise.resolve()).then(op)
    const settled = run.catch(() => { /* reported by the caller; the next write still runs */ })
    this.writeChains.set(sessionId, settled)
    void settled.then(() => {
      if (this.writeChains.get(sessionId) === settled) this.writeChains.delete(sessionId)
    })
    return run
  }

  /**
   * Write a session to disk immediately in JSONL format.
   * Uses atomic write (write-to-temp-then-rename) to prevent corruption on crash.
   */
  private async write(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId)
    if (!entry) return

    this.pending.delete(sessionId)

    try {
      const { data } = entry
      ensureSessionsDir(data.workspaceRootPath)
      ensureSessionDir(data.workspaceRootPath, sessionId)

      const filePath = getSessionFilePath(data.workspaceRootPath, sessionId)

      // Prepare session with portable paths for cross-machine compatibility
      const storageSession: StoredSession = {
        ...data,
        workspaceRootPath: toPortablePath(data.workspaceRootPath),
        workingDirectory: data.workingDirectory ? toPortablePath(data.workingDirectory) : undefined,
        sdkCwd: data.sdkCwd ? toPortablePath(data.sdkCwd) : undefined,
        lastUsedAt: Date.now(),
      }

      // Create JSONL content: header + messages (one per line)
      // Filter out intermediate messages - they're transient streaming status updates
      const localHeader = createSessionHeader(storageSession)
      const localSig = getHeaderMetadataSignature(localHeader)
      const diskHeader = readSessionHeader(filePath)
      const previousSig = this.lastWrittenHeaderSignature.get(sessionId)
      const diskSig = diskHeader ? getHeaderMetadataSignature(diskHeader) : undefined

      // Queue writes should never clobber session metadata changed externally
      // (watcher edits, direct header edits, other instances), but they must
      // still persist local metadata updates (e.g. generated title).
      //
      // Preserve disk metadata only when disk diverged from our last written
      // signature, which indicates an external mutation.
      const hasMetadataMismatch = !!diskHeader && !!diskSig && diskSig !== localSig
      const hasExternalMetadataChange = !!diskHeader && !!diskSig && !!previousSig && diskSig !== previousSig
      const header = hasExternalMetadataChange && diskHeader
        ? mergeHeaderWithExternalMetadata(localHeader, diskHeader)
        : localHeader

      if (hasMetadataMismatch) {
        const baseline = previousSig ? `, previousSig=${previousSig.slice(0, 12)}` : ', previousSig=<none>'
        const mode = hasExternalMetadataChange ? 'disk preserved' : 'local preserved'
        debug(`[PersistenceQueue] Session ${sessionId} metadata mismatch detected (${mode}${baseline})`)
      }

      const persistableMessages = storageSession.messages
      // Use original absolute sessionDir (before toPortablePath) for path replacement
      const sessionDir = dirname(filePath)
      const lines = [
        makeSessionPathPortable(JSON.stringify(header), sessionDir),
        ...persistableMessages.map(m => makeSessionPathPortable(JSON.stringify(m), sessionDir)),
      ]

      // Atomic write: write to .tmp then rename over the real file.
      // If the process crashes mid-write, only the .tmp is corrupted —
      // the original session.jsonl remains intact.
      //
      // Update signature BEFORE the write so that fs.watch events fired
      // during unlink/rename are correctly identified as self-writes.
      // Without this, onSessionMetadataChange sees the stale signature
      // and reverts in-memory metadata on idle sessions.
      const finalSignature = getHeaderMetadataSignature(header)
      this.lastWrittenHeaderSignature.set(sessionId, finalSignature)

      const tmpFile = filePath + '.tmp'
      await writeFile(tmpFile, lines.join('\n') + '\n', 'utf-8')
      // On Windows, rename fails if target exists. Delete first for cross-platform compatibility.
      try { await unlink(filePath) } catch { /* ignore if doesn't exist */ }
      await rename(tmpFile, filePath)
      debug(`[PersistenceQueue] Wrote session ${sessionId}`)
    } catch (error) {
      console.error(`[PersistenceQueue] Failed to write session ${sessionId}:`, error)
    }
  }

  /**
   * Write a session's pending snapshot now, after its writes in progress (none pending: just wait
   * for those). Resolves once everything queued for the session before the call is on disk.
   */
  async flush(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId)
    if (entry) clearTimeout(entry.timer)
    if (!entry && !this.writeChains.has(sessionId)) return
    // write() takes whatever snapshot is pending when its turn comes (none: nothing to do)
    await this.serialize(sessionId, () => this.write(sessionId))
  }

  /**
   * Change header fields of a session whose messages aren't loaded, without reading its transcript
   * (`rewriteSessionHeader`). Runs in turn with the session's other writes: a snapshot still
   * pending goes to disk first, then the patch, read from `getPatch` at that moment so it carries
   * the latest values. A failure is logged, not thrown: the in-memory session stays right and its
   * next full write repairs the file.
   *
   * Like `write`, it records the new header's signature before the file is replaced, so the
   * watcher takes the patch for our own write. Otherwise a session this run never wrote has no
   * signature, the echo reads as an external change, and a copy of it deferred while the session
   * is busy or under a write guard is applied later, over any status, label or name set meanwhile.
   */
  async patchHeader(
    workspaceRootPath: string,
    sessionId: string,
    getPatch: () => Partial<Record<keyof SessionHeader, unknown>>,
  ): Promise<void> {
    await this.serialize(sessionId, async () => {
      const entry = this.pending.get(sessionId)
      if (entry) {
        clearTimeout(entry.timer)
        await this.write(sessionId)
      }
      const filePath = getSessionFilePath(workspaceRootPath, sessionId)
      const previousSignature = this.lastWrittenHeaderSignature.get(sessionId)
      try {
        const patched = await rewriteSessionHeader(filePath, getPatch(), (header) => {
          this.lastWrittenHeaderSignature.set(sessionId, getHeaderMetadataSignature(header))
        })
        if (patched) {
          debug(`[PersistenceQueue] Patched header of session ${sessionId}`)
        } else {
          debug(`[PersistenceQueue] No readable header to patch for session ${sessionId}`)
        }
      } catch (error) {
        // The file wasn't replaced: it still has the header the previous signature describes
        if (previousSignature === undefined) this.lastWrittenHeaderSignature.delete(sessionId)
        else this.lastWrittenHeaderSignature.set(sessionId, previousSignature)
        console.error(`[PersistenceQueue] Failed to patch header of session ${sessionId}:`, error)
      }
    })
  }

  /**
   * Cancel a pending write for a session (e.g., when deleting the session).
   */
  cancel(sessionId: string): void {
    const entry = this.pending.get(sessionId)
    if (entry) {
      clearTimeout(entry.timer)
      this.pending.delete(sessionId)
      debug(`[PersistenceQueue] Cancelled pending write for session ${sessionId}`)
    }
    this.lastWrittenHeaderSignature.delete(sessionId)
  }

  /**
   * Flush all pending sessions. Call this on app quit.
   */
  async flushAll(): Promise<void> {
    // Pending snapshots, plus writes already running (a header patch has no pending snapshot)
    const sessionIds = new Set([...this.pending.keys(), ...this.writeChains.keys()])
    await Promise.all([...sessionIds].map(id => this.flush(id)))
  }

  /**
   * Check if a session has a pending write.
   */
  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId)
  }

  /**
   * Get the metadata signature of the last header we wrote for a session.
   * Used by ConfigWatcher to suppress self-triggered metadata change events.
   */
  getLastWrittenSignature(sessionId: string): string | undefined {
    return this.lastWrittenHeaderSignature.get(sessionId)
  }

  /**
   * Get count of pending writes.
   */
  get pendingCount(): number {
    return this.pending.size
  }
}

// Singleton instance
export const sessionPersistenceQueue = new SessionPersistenceQueue()

// Named exports for testing/customization
export { SessionPersistenceQueue, getHeaderMetadataSignature, mergeHeaderWithExternalMetadata }
