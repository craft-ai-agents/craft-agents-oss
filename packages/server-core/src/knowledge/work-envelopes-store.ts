/**
 * KnowledgeWorkEnvelopesStore — upsert-by-key jsonl for S-08 work envelopes.
 *
 * Layout: {workspaceRoot}/knowledge/work-envelopes.jsonl
 * Key = `${kind}:${id}` (knowledgeEnvelopeKey). Last write wins per key.
 * Writes compact the full map via tmp+rename (no unbounded append history).
 * Fail-soft parse: corrupt lines skipped. Never throws on read.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  knowledgeEnvelopeKey,
  type KnowledgeRef,
  type KnowledgeWorkEnvelope,
} from '@craft-agent/core/knowledge'

export function parseWorkEnvelopeLine(line: string): KnowledgeWorkEnvelope | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const value = JSON.parse(trimmed) as Partial<KnowledgeWorkEnvelope>
    const ref = value.knowledgeRef
    if (
      !ref ||
      typeof ref !== 'object' ||
      typeof ref.kind !== 'string' ||
      typeof ref.id !== 'string' ||
      typeof value.createdAt !== 'number' ||
      typeof value.updatedAt !== 'number'
    ) {
      return null
    }
    return {
      knowledgeRef: ref as KnowledgeRef,
      status: typeof value.status === 'string' ? value.status : undefined,
      labels: Array.isArray(value.labels)
        ? value.labels.filter((l): l is string => typeof l === 'string')
        : undefined,
      flagged: typeof value.flagged === 'boolean' ? value.flagged : undefined,
      archived: typeof value.archived === 'boolean' ? value.archived : undefined,
      assignedTo: typeof value.assignedTo === 'string' ? value.assignedTo : undefined,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    }
  } catch {
    /* skip corrupt */
  }
  return null
}

export function parseWorkEnvelopeEntries(content: string): KnowledgeWorkEnvelope[] {
  if (!content) return []
  const out: KnowledgeWorkEnvelope[] = []
  for (const line of content.split('\n')) {
    const entry = parseWorkEnvelopeLine(line)
    if (entry) out.push(entry)
  }
  return out
}

export class KnowledgeWorkEnvelopesStore {
  readonly filePath: string

  constructor(workspaceRoot: string) {
    this.filePath = join(workspaceRoot, 'knowledge', 'work-envelopes.jsonl')
  }

  /** Last-write-wins map keyed by kind:id. */
  private readMap(): Map<string, KnowledgeWorkEnvelope> {
    const map = new Map<string, KnowledgeWorkEnvelope>()
    if (!existsSync(this.filePath)) return map
    try {
      for (const entry of parseWorkEnvelopeEntries(readFileSync(this.filePath, 'utf8'))) {
        map.set(knowledgeEnvelopeKey(entry.knowledgeRef), entry)
      }
    } catch {
      /* fail-soft */
    }
    return map
  }

  get(ref: KnowledgeRef): KnowledgeWorkEnvelope | null {
    return this.readMap().get(knowledgeEnvelopeKey(ref)) ?? null
  }

  list(): KnowledgeWorkEnvelope[] {
    return [...this.readMap().values()].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.knowledgeRef.id.localeCompare(b.knowledgeRef.id),
    )
  }

  /**
   * Upsert by kind:id. Preserves createdAt on update; always refreshes updatedAt
   * when the caller omits it or supplies a stale value.
   */
  upsert(envelope: KnowledgeWorkEnvelope): KnowledgeWorkEnvelope {
    const key = knowledgeEnvelopeKey(envelope.knowledgeRef)
    const map = this.readMap()
    const existing = map.get(key)
    const now = Date.now()
    const next: KnowledgeWorkEnvelope = {
      knowledgeRef: { ...envelope.knowledgeRef },
      status: envelope.status,
      labels: envelope.labels ? [...envelope.labels] : undefined,
      flagged: envelope.flagged,
      archived: envelope.archived,
      assignedTo: envelope.assignedTo,
      createdAt: existing?.createdAt ?? envelope.createdAt ?? now,
      updatedAt: envelope.updatedAt && envelope.updatedAt >= (existing?.updatedAt ?? 0)
        ? envelope.updatedAt
        : now,
    }
    map.set(key, next)
    this.writeMap(map)
    return next
  }

  /** Full atomic rewrite: one line per key (LWW), tmp + rename. */
  private writeMap(map: Map<string, KnowledgeWorkEnvelope>): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const body = [...map.values()].map((entry) => JSON.stringify(entry)).join('\n')
    const tmp = join(dirname(this.filePath), `.${Date.now()}-${process.pid}.envelopes.tmp`)
    writeFileSync(tmp, body ? `${body}\n` : '', 'utf8')
    renameSync(tmp, this.filePath)
  }
}
