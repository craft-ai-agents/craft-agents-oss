/**
 * KnowledgeLinksStore — append-only KnowledgeLinkRecord jsonl (K-04 §3.3.3).
 *
 * Layout: {workspaceRoot}/knowledge/links.jsonl
 * Unlink = tombstone append (deletedAt). Fail-soft parse of corrupt lines.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import type { KnowledgeLinkRecord, KnowledgeLinkRelation } from '@craft-agent/core/knowledge'

export interface KnowledgeLinkFileRecord extends KnowledgeLinkRecord {
  /** Tombstone marker for unlink (append-only semantics). */
  deletedAt?: string
}

export function parseLinkLine(line: string): KnowledgeLinkFileRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const r = JSON.parse(trimmed) as Partial<KnowledgeLinkFileRecord>
    if (
      r &&
      typeof r === 'object' &&
      typeof r.id === 'string' &&
      typeof r.craftRef === 'object' &&
      r.craftRef !== null &&
      typeof r.knowledgeRef === 'object' &&
      r.knowledgeRef !== null &&
      typeof r.relation === 'string' &&
      typeof r.createdAt === 'string'
    ) {
      return r as KnowledgeLinkFileRecord
    }
  } catch {
    /* skip corrupt */
  }
  return null
}

export function parseLinkEntries(content: string): KnowledgeLinkFileRecord[] {
  if (!content) return []
  const out: KnowledgeLinkFileRecord[] = []
  for (const line of content.split('\n')) {
    const parsed = parseLinkLine(line)
    if (parsed) out.push(parsed)
  }
  return out
}

export interface LinkListFilter {
  craftId?: string
  knowledgeId?: string
  relation?: KnowledgeLinkRelation
  /** When true (default), hide tombstoned links. */
  activeOnly?: boolean
}

export class KnowledgeLinksStore {
  readonly filePath: string

  constructor(workspaceRoot: string) {
    this.filePath = join(workspaceRoot, 'knowledge', 'links.jsonl')
  }

  append(record: KnowledgeLinkFileRecord): KnowledgeLinkFileRecord {
    mkdirSync(dirname(this.filePath), { recursive: true })
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
    return record
  }

  /**
   * Active links after applying tombstones (last write wins per id).
   * A later line with the same id and deletedAt removes the link from active set.
   */
  list(filter?: LinkListFilter): KnowledgeLinkRecord[] {
    const byId = new Map<string, KnowledgeLinkFileRecord>()
    for (const entry of this.readAll()) {
      byId.set(entry.id, entry)
    }
    const activeOnly = filter?.activeOnly !== false
    const out: KnowledgeLinkRecord[] = []
    for (const entry of byId.values()) {
      if (activeOnly && entry.deletedAt) continue
      if (filter?.craftId !== undefined && entry.craftRef.id !== filter.craftId) continue
      if (filter?.knowledgeId !== undefined && entry.knowledgeRef.id !== filter.knowledgeId) continue
      if (filter?.relation !== undefined && entry.relation !== filter.relation) continue
      const { deletedAt: _deletedAt, ...record } = entry
      out.push(record)
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  }

  findPublishedFrom(craftId: string): KnowledgeLinkRecord | null {
    return this.list({ craftId, relation: 'published-from' })[0] ?? null
  }

  private readAll(): KnowledgeLinkFileRecord[] {
    if (!existsSync(this.filePath)) return []
    try {
      return parseLinkEntries(readFileSync(this.filePath, 'utf8'))
    } catch {
      return []
    }
  }
}
