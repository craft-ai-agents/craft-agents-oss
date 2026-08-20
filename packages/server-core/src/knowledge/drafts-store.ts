/**
 * KnowledgePublishDraftsStore — per-file PublishDraft persistence (K-06 / K-04 §3.3).
 *
 * Layout: {workspaceRoot}/knowledge/drafts/<draftId>.json
 * Writes are atomic via tmp + rename (proposals-store pattern).
 * Fail-soft reads: unknown id / corrupt file → null.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PublishDraft, PublicationStatus } from '@craft-agent/core/knowledge'

const DRAFT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function parseDraftFile(content: string): PublishDraft | null {
  try {
    const r = JSON.parse(content) as Partial<PublishDraft>
    if (
      r &&
      typeof r === 'object' &&
      typeof r.id === 'string' &&
      typeof r.status === 'string' &&
      typeof r.connectionId === 'string' &&
      typeof r.title === 'string' &&
      typeof r.markdown === 'string' &&
      typeof r.summary === 'string' &&
      Array.isArray(r.outline) &&
      Array.isArray(r.runIds) &&
      Array.isArray(r.sourceBlocks) &&
      Array.isArray(r.sourceMessages) &&
      Array.isArray(r.excluded) &&
      typeof r.contentHash === 'string' &&
      typeof r.model === 'object' &&
      r.model !== null &&
      typeof r.createdAt === 'number' &&
      typeof r.updatedAt === 'number'
    ) {
      return r as PublishDraft
    }
  } catch {
    /* skip corrupt */
  }
  return null
}

export class KnowledgePublishDraftsStore {
  readonly draftsDir: string

  constructor(workspaceRoot: string) {
    this.draftsDir = join(workspaceRoot, 'knowledge', 'drafts')
    this.cleanupOrphanTmp()
  }

  save(record: PublishDraft): PublishDraft {
    if (!DRAFT_ID_RE.test(record.id)) {
      throw new TypeError(`Invalid draft id (refused for path safety): ${JSON.stringify(record.id)}`)
    }
    this.writeRecord(record)
    return record
  }

  get(id: string): PublishDraft | null {
    if (!DRAFT_ID_RE.test(id)) return null
    const path = this.draftPath(id)
    if (!existsSync(path)) return null
    return parseDraftFile(readFileSync(path, 'utf8'))
  }

  list(filter?: { sessionId?: string; status?: PublicationStatus }): PublishDraft[] {
    return this.readAll()
      .filter(
        (r) =>
          (filter?.sessionId === undefined || r.sessionId === filter.sessionId) &&
          (filter?.status === undefined || r.status === filter.status),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  }

  remove(id: string): boolean {
    if (!DRAFT_ID_RE.test(id)) return false
    const path = this.draftPath(id)
    if (!existsSync(path)) return false
    try {
      unlinkSync(path)
      return true
    } catch {
      return false
    }
  }

  private readAll(): PublishDraft[] {
    let names: string[]
    try {
      names = readdirSync(this.draftsDir).sort()
    } catch {
      return []
    }
    const records: PublishDraft[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const parsed = parseDraftFile(readFileSync(join(this.draftsDir, name), 'utf8'))
      if (parsed) records.push(parsed)
    }
    return records
  }

  private writeRecord(record: PublishDraft): void {
    mkdirSync(this.draftsDir, { recursive: true })
    const tmp = join(this.draftsDir, `.${Date.now()}-${process.pid}.draft.tmp`)
    writeFileSync(tmp, JSON.stringify(record))
    renameSync(tmp, this.draftPath(record.id))
  }

  private draftPath(id: string): string {
    return join(this.draftsDir, `${id}.json`)
  }

  private cleanupOrphanTmp(): void {
    try {
      if (!existsSync(this.draftsDir)) return
      for (const entry of readdirSync(this.draftsDir)) {
        if (!entry.endsWith('.tmp')) continue
        try {
          unlinkSync(join(this.draftsDir, entry))
        } catch {
          /* best effort */
        }
      }
    } catch {
      /* best effort */
    }
  }
}
