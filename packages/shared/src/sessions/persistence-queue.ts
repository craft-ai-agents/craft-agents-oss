import { writeFile, rename, unlink } from 'fs/promises'
import { dirname } from 'path'
import type { StoredSession, SessionHeader } from './types.js'
import { getSessionFilePath, ensureSessionsDir, ensureSessionDir } from './storage.js'
import { toPortablePath } from '../utils/paths.js'
import { createSessionHeader, makeSessionPathPortable, readSessionHeader, rewriteSessionJsonlHeader } from './jsonl.js'
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
  isArchived?: boolean
  archivedAt?: number
  projectId?: string
  kanbanColumn?: string
  rank?: string
  priority?: SessionHeader['priority']
  dueDate?: number | null
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
    isArchived: header.isArchived,
    archivedAt: header.archivedAt,
    projectId: header.projectId,
    kanbanColumn: header.kanbanColumn,
    rank: header.rank,
    priority: header.priority,
    dueDate: header.dueDate,
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
    isArchived: diskHeader.isArchived,
    archivedAt: diskHeader.archivedAt,
    projectId: diskHeader.projectId,
    kanbanColumn: diskHeader.kanbanColumn,
    rank: diskHeader.rank,
    priority: diskHeader.priority,
    dueDate: diskHeader.dueDate,
  }
}

/**
 * Debounced async session persistence queue.
 * Prevents main thread blocking by using async writes and coalescing
 * rapid successive persist calls into a single write.
 *
 * IMPORTANT: Writes are serialized per-session to prevent race conditions
 * when rapid successive flushes (e.g., clearSessionForRecovery + onSdkSessionIdUpdate)
 * would otherwise write to the same .tmp file concurrently.
 */
class SessionPersistenceQueue {
  private pending = new Map<string, PendingWrite>()
  private writeInProgress = new Map<string, Promise<void>>()
  private lastWrittenHeaderSignature = new Map<string, string>()
  private writeFailures = new Map<string, unknown>()
  private debounceMs: number

  constructor(debounceMs = 500) {
    this.debounceMs = debounceMs
  }

  /**
   * Run work after every earlier write for this session. Full snapshots and
   * header-only updates share one lane because both use `${file}.tmp`.
   */
  private serialize(sessionId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.writeInProgress.get(sessionId)
    const next = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(operation)
    this.writeInProgress.set(sessionId, next)
    void next.then(
      () => {
        if (this.writeInProgress.get(sessionId) === next) {
          this.writeInProgress.delete(sessionId)
        }
      },
      () => {
        if (this.writeInProgress.get(sessionId) === next) {
          this.writeInProgress.delete(sessionId)
        }
      },
    )
    return next
  }

  private throwIfWriteFailed(sessionId: string): void {
    const failure = this.writeFailures.get(sessionId)
    if (failure !== undefined) throw failure
  }

  /**
   * Queue a session for persistence. A newer snapshot replaces an older
   * pending snapshot and resets its debounce timer.
   */
  enqueue(session: StoredSession): void {
    const existing = this.pending.get(session.id)
    if (existing) {
      clearTimeout(existing.timer)
    }

    const timer = setTimeout(() => {
      void this.serialize(session.id, () => this.write(session.id)).catch((error) => {
        console.error(`[PersistenceQueue] Failed to schedule session ${session.id} write:`, error)
      })
    }, this.debounceMs)

    this.pending.set(session.id, { data: session, timer })
  }

  /**
   * Write a session to disk immediately in JSONL format.
   * Uses atomic write (write-to-temp-then-rename) to prevent corruption.
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
      const storageSession: StoredSession = {
        ...data,
        workspaceRootPath: toPortablePath(data.workspaceRootPath),
        workingDirectory: data.workingDirectory ? toPortablePath(data.workingDirectory) : undefined,
        sdkCwd: data.sdkCwd ? toPortablePath(data.sdkCwd) : undefined,
        lastUsedAt: Date.now(),
      }

      const localHeader = createSessionHeader(storageSession)
      const localSig = getHeaderMetadataSignature(localHeader)
      const diskHeader = readSessionHeader(filePath)
      const previousSig = this.lastWrittenHeaderSignature.get(sessionId)
      const diskSig = diskHeader ? getHeaderMetadataSignature(diskHeader) : undefined
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

      const sessionDir = dirname(filePath)
      const lines = [
        makeSessionPathPortable(JSON.stringify(header), sessionDir),
        ...storageSession.messages.map(message =>
          makeSessionPathPortable(JSON.stringify(message), sessionDir)),
      ]

      const finalSignature = getHeaderMetadataSignature(header)
      this.lastWrittenHeaderSignature.set(sessionId, finalSignature)

      const tmpFile = filePath + '.tmp'
      await writeFile(tmpFile, lines.join('\n') + '\n', 'utf-8')
      try { await unlink(filePath) } catch { /* ignore if it does not exist */ }
      await rename(tmpFile, filePath)
      this.writeFailures.delete(sessionId)
      debug(`[PersistenceQueue] Wrote session ${sessionId}`)
    } catch (error) {
      this.writeFailures.set(sessionId, error)
      console.error(`[PersistenceQueue] Failed to write session ${sessionId}:`, error)
    }
  }

  /**
   * Persist a metadata patch without parsing or materializing message lines.
   * The patch is merged with the current header in the same per-session lane
   * used by queued full snapshots.
   */
  async updateSessionHeader(
    sessionId: string,
    workspaceRootPath: string,
    patch: Partial<SessionHeader>,
  ): Promise<void> {
    await this.flush(sessionId)
    this.throwIfWriteFailed(sessionId)

    await this.serialize(sessionId, async () => {
      // A full snapshot may have been queued while this update waited.
      const pending = this.pending.get(sessionId)
      if (pending) {
        clearTimeout(pending.timer)
        await this.write(sessionId)
        this.throwIfWriteFailed(sessionId)
      }

      ensureSessionsDir(workspaceRootPath)
      ensureSessionDir(workspaceRootPath, sessionId)
      const filePath = getSessionFilePath(workspaceRootPath, sessionId)
      const previousSignature = this.lastWrittenHeaderSignature.get(sessionId)
      try {
        await rewriteSessionJsonlHeader(
          filePath,
          header => ({ ...header, ...patch }),
          header => {
            this.lastWrittenHeaderSignature.set(sessionId, getHeaderMetadataSignature(header))
          },
        )
      } catch (error) {
        if (previousSignature === undefined) {
          this.lastWrittenHeaderSignature.delete(sessionId)
        } else {
          this.lastWrittenHeaderSignature.set(sessionId, previousSignature)
        }
        throw error
      }
      debug(`[PersistenceQueue] Updated session ${sessionId} header`)
    })
  }

  /**
   * Immediately flush a pending snapshot, or wait for an in-progress write.
   * A failed snapshot is surfaced to callers that require durable state.
   */
  async flush(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId)
    if (entry) {
      clearTimeout(entry.timer)
      await this.serialize(sessionId, () => this.write(sessionId))
      this.throwIfWriteFailed(sessionId)
      return
    }

    const inProgress = this.writeInProgress.get(sessionId)
    if (inProgress) {
      await inProgress
    }
    this.throwIfWriteFailed(sessionId)
  }

  /**
   * Cancel a pending write for a session (for example before deletion).
   */
  cancel(sessionId: string): void {
    const entry = this.pending.get(sessionId)
    if (entry) {
      clearTimeout(entry.timer)
      this.pending.delete(sessionId)
      debug(`[PersistenceQueue] Cancelled pending write for session ${sessionId}`)
    }
    this.lastWrittenHeaderSignature.delete(sessionId)
    this.writeFailures.delete(sessionId)
  }

  /**
   * Flush all queued or in-progress session persistence.
   */
  async flushAll(): Promise<void> {
    const sessionIds = new Set([
      ...this.pending.keys(),
      ...this.writeInProgress.keys(),
    ])
    await Promise.all([...sessionIds].map(id => this.flush(id)))
  }

  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId)
  }

  getLastWrittenSignature(sessionId: string): string | undefined {
    return this.lastWrittenHeaderSignature.get(sessionId)
  }

  get pendingCount(): number {
    return this.pending.size
  }
}

// Singleton instance
export const sessionPersistenceQueue = new SessionPersistenceQueue()

// Named exports for testing/customization
export { SessionPersistenceQueue, getHeaderMetadataSignature, mergeHeaderWithExternalMetadata }
