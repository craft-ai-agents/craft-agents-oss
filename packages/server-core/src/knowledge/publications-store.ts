/**
 * KnowledgePublicationsStore — append-only PublicationRecord jsonl (K-04 §3.3.5).
 *
 * Layout: {workspaceRoot}/knowledge/publications.jsonl
 * Fail-soft parse: corrupt lines skipped. Never throws on read.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import type { PublicationRecord } from '@craft-agent/core/knowledge'

export function parsePublicationLine(line: string): PublicationRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const r = JSON.parse(trimmed) as Partial<PublicationRecord>
    if (
      r &&
      typeof r === 'object' &&
      typeof r.id === 'string' &&
      typeof r.draftId === 'string' &&
      typeof r.connectionId === 'string' &&
      typeof r.targetRef === 'object' &&
      r.targetRef !== null &&
      (r.mode === 'create' || r.mode === 'update') &&
      typeof r.contentHash === 'string' &&
      typeof r.proposalId === 'string' &&
      typeof r.provenance === 'object' &&
      r.provenance !== null &&
      typeof r.createdAt === 'string'
    ) {
      return r as PublicationRecord
    }
  } catch {
    /* skip corrupt */
  }
  return null
}

export function parsePublicationEntries(content: string): PublicationRecord[] {
  if (!content) return []
  const out: PublicationRecord[] = []
  for (const line of content.split('\n')) {
    const parsed = parsePublicationLine(line)
    if (parsed) out.push(parsed)
  }
  return out
}

export interface PublicationListFilter {
  sessionId?: string
  runId?: string
  proposalId?: string
  contentHash?: string
}

export class KnowledgePublicationsStore {
  readonly filePath: string

  constructor(workspaceRoot: string) {
    this.filePath = join(workspaceRoot, 'knowledge', 'publications.jsonl')
  }

  append(record: PublicationRecord): PublicationRecord {
    mkdirSync(dirname(this.filePath), { recursive: true })
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
    return record
  }

  list(filter?: PublicationListFilter): PublicationRecord[] {
    const all = this.readAll()
    return all
      .filter(
        (r) =>
          (filter?.sessionId === undefined || r.sessionId === filter.sessionId) &&
          (filter?.runId === undefined || r.runId === filter.runId) &&
          (filter?.proposalId === undefined || r.proposalId === filter.proposalId) &&
          (filter?.contentHash === undefined || r.contentHash === filter.contentHash),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  }

  /** Most recent publication for a session (if any). */
  findLatestForSession(sessionId: string): PublicationRecord | null {
    const matches = this.list({ sessionId })
    return matches[0] ?? null
  }

  findByProposalId(proposalId: string): PublicationRecord | null {
    return this.list({ proposalId })[0] ?? null
  }

  private readAll(): PublicationRecord[] {
    if (!existsSync(this.filePath)) return []
    try {
      return parsePublicationEntries(readFileSync(this.filePath, 'utf8'))
    } catch {
      return []
    }
  }
}
