/**
 * KnowledgeConnectionsStore — global registry of knowledge-provider
 * connections (spec K-04 §3.3.1).
 *
 * Lives at {configDir}/knowledge/connections.json: a single JSON document
 * holding an array of KnowledgeConnectionRecord, rewritten in full via
 * tmp + rename (the exact AuditLog.rotate()/LessonStore.rewrite pattern) —
 * the file holds tens of records, so whole-file rewrites stay cheap.
 *
 * Secrets never land in this file: only `credentialRef`, the CredentialManager
 * key (`source_bearer::{workspaceId}::{connectionId}`, K-04 §3.3.1). Reads
 * are fail-soft: a missing or corrupt file yields an empty list, never a
 * throw. Orphan *.tmp files from a process killed between write and rename
 * are cleaned on construction (K-04 §5).
 *
 * configDir is resolved lazily at construction time
 * (process.env.CRAFT_CONFIG_DIR || CONFIG_DIR), same convention as AuditLog —
 * test harnesses and -1 dev instances change the config dir before services
 * are created, so the frozen module constant must not be captured.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'node:crypto'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import type { CredentialId } from '@craft-agent/shared/credentials'
import { CodedError } from '@craft-agent/shared/protocol'

/**
 * Token key parser — the record's credentialRef IS a CredentialManager id
 * string `source_bearer::{workspaceId}::{connectionId}` (file header above).
 * The writer (sources:saveCredentials knowledge fallback) and the readers
 * (readToken / requireConnectionWorkspaceRoot in handlers/rpc/knowledge.ts)
 * MUST share this single parse: hand-rolling a second copy let tokens be
 * saved under the active-workspace key while reads resolved the record's
 * workspace, which is unrecoverable on multi-workspace installs.
 */
export function credentialIdFromRef(credentialRef: string): CredentialId | null {
  const parts = credentialRef.split('::')
  if (parts.length !== 3 || parts[0] !== 'source_bearer' || !parts[1] || !parts[2]) return null
  return { type: 'source_bearer', workspaceId: parts[1], sourceId: parts[2] }
}

/** Cache of the last probe result for a connection (K-04 §3.3.1). */
export type KnowledgeConnectionStatus = 'unknown' | 'ok' | 'needs_auth' | 'failed'

/**
 * Storage record for one knowledge connection.
 * Production mode is external-local only. `managed` is accepted at the type
 * level for P7-prep fail-closed paths, but save() rejects it at runtime until
 * G1 thresholds + G2 legal decision (spec K-08).
 */
export type KnowledgeConnectionMode = 'external-local' | 'managed'

export interface KnowledgeConnectionRecord {
  id: string
  provider: 'siyuan'
  mode: KnowledgeConnectionMode
  baseUrl: string
  /** CredentialManager key — never the token itself. */
  credentialRef: string
  /** Kernel version reported by the last probe, when known. */
  version?: string
  /** Serialized KnowledgeCapabilities from capability discovery. */
  capabilitiesJson?: string
  status: KnowledgeConnectionStatus
  createdAt: string
  updatedAt: string
}

/**
 * Everything a writer may supply; id/timestamps are managed by the store.
 * Discriminant fields default to the P1-only values.
 */
export interface SaveConnectionInput {
  id?: string
  baseUrl: string
  credentialRef: string
  provider?: 'siyuan'
  mode?: KnowledgeConnectionMode
  version?: string
  capabilitiesJson?: string
  status?: KnowledgeConnectionStatus
}

/**
 * Parse connections.json resiliently: missing/corrupt file → [], non-record
 * entries are skipped (parseAuditEntries contract, K-04 §5).
 */
export function parseConnectionFile(content: string): KnowledgeConnectionRecord[] {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is KnowledgeConnectionRecord =>
        !!r && typeof r === 'object' &&
        typeof (r as KnowledgeConnectionRecord).id === 'string' &&
        typeof (r as KnowledgeConnectionRecord).baseUrl === 'string' &&
        typeof (r as KnowledgeConnectionRecord).credentialRef === 'string' &&
        typeof (r as KnowledgeConnectionRecord).createdAt === 'string' &&
        typeof (r as KnowledgeConnectionRecord).updatedAt === 'string',
    )
  } catch {
    return []
  }
}

export class KnowledgeConnectionsStore {
  /** {configDir}/knowledge — global scope, connections are a property of the user's machine. */
  readonly knowledgeDir: string

  constructor(configDir: string = process.env.CRAFT_CONFIG_DIR || CONFIG_DIR) {
    this.knowledgeDir = join(configDir, 'knowledge')
    this.cleanupOrphanTmp()
  }

  get filePath(): string {
    return join(this.knowledgeDir, 'connections.json')
  }

  /** All connections, in file (insertion) order. Missing/corrupt file → []. */
  list(): KnowledgeConnectionRecord[] {
    return this.readRecords()
  }

  get(id: string): KnowledgeConnectionRecord | null {
    return this.readRecords().find(r => r.id === id) ?? null
  }

  /**
   * Upsert a connection: with an existing id the record is patched (createdAt
   * preserved, updatedAt bumped); otherwise a new record is appended with a
   * generated uuid. Returns the stored record.
   */
  save(input: SaveConnectionInput): KnowledgeConnectionRecord {
    if (input.mode === 'managed') {
      throw new CodedError(
        'CAPABILITY_DISABLED',
        'knowledge: managed connection mode is disabled until G1 metrics thresholds are met and G2 licensing decision is ACCEPTED (spec K-08 / g2-decision-record). Production mode remains external-local only; Craft does not ship or spawn a SiYuan kernel.',
      )
    }
    const records = this.readRecords()
    const now = new Date().toISOString()
    const idx = input.id ? records.findIndex(r => r.id === input.id) : -1
    if (idx >= 0) {
      const existing = records[idx]
      const patch: Partial<KnowledgeConnectionRecord> = {
        baseUrl: input.baseUrl,
        credentialRef: input.credentialRef,
        updatedAt: now,
      }
      if (input.provider !== undefined) patch.provider = input.provider
      if (input.mode !== undefined) patch.mode = input.mode
      if (input.version !== undefined) patch.version = input.version
      if (input.capabilitiesJson !== undefined) patch.capabilitiesJson = input.capabilitiesJson
      if (input.status !== undefined) patch.status = input.status
      const updated: KnowledgeConnectionRecord = { ...existing, ...patch }
      records[idx] = updated
      this.writeRecords(records)
      return updated
    }
    const record: KnowledgeConnectionRecord = {
      id: input.id ?? randomUUID(),
      provider: input.provider ?? 'siyuan',
      mode: input.mode ?? 'external-local',
      baseUrl: input.baseUrl,
      credentialRef: input.credentialRef,
      ...(input.version !== undefined ? { version: input.version } : {}),
      ...(input.capabilitiesJson !== undefined ? { capabilitiesJson: input.capabilitiesJson } : {}),
      status: input.status ?? 'unknown',
      createdAt: now,
      updatedAt: now,
    }
    records.push(record)
    this.writeRecords(records)
    return record
  }

  remove(id: string): boolean {
    const records = this.readRecords()
    const kept = records.filter(r => r.id !== id)
    if (kept.length === records.length) return false
    this.writeRecords(kept)
    return true
  }

  /** Update the cached probe status; null when the id is unknown. */
  setStatus(id: string, status: KnowledgeConnectionStatus): KnowledgeConnectionRecord | null {
    const records = this.readRecords()
    const idx = records.findIndex(r => r.id === id)
    if (idx < 0) return null
    const updated: KnowledgeConnectionRecord = { ...records[idx], status, updatedAt: new Date().toISOString() }
    records[idx] = updated
    this.writeRecords(records)
    return updated
  }

  private readRecords(): KnowledgeConnectionRecord[] {
    if (!existsSync(this.filePath)) return []
    return parseConnectionFile(readFileSync(this.filePath, 'utf8'))
  }

  /** Full atomic rewrite: tmp file in the same dir, then rename over the target. */
  private writeRecords(records: KnowledgeConnectionRecord[]): void {
    mkdirSync(this.knowledgeDir, { recursive: true })
    const tmp = join(this.knowledgeDir, `.${Date.now()}-${process.pid}.connections.tmp`)
    writeFileSync(tmp, JSON.stringify(records, null, 2))
    renameSync(tmp, this.filePath)
  }

  /** Best-effort removal of tmp files left by a process killed mid-rename. */
  private cleanupOrphanTmp(): void {
    try {
      if (!existsSync(this.knowledgeDir)) return
      for (const entry of readdirSync(this.knowledgeDir)) {
        if (!entry.endsWith('.tmp')) continue
        try { unlinkSync(join(this.knowledgeDir, entry)) } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }
}
