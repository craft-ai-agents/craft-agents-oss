/**
 * KnowledgeMetricsStore — file-backed G1 usage counters (P7-prep).
 *
 * Layout: {workspaceRoot}/knowledge/metrics.json
 * Atomic write: tmp + rename in the same directory.
 *
 * Fail-soft: missing/corrupt file → empty snapshot (never throws on read).
 * connectionsActive is derived on read from KnowledgeConnectionsStore (global).
 *
 * Full managed kernel (P7) remains blocked until G1 thresholds + G2 legal
 * decision — this store only instruments external-local production usage.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { KnowledgeConnectionsStore } from './connections-store'
import { KnowledgePublicationsStore } from './publications-store'

export const KNOWLEDGE_METRICS_VERSION = 1 as const

export type KnowledgeMetricsCounterKey =
  | 'connectionsActive'
  | 'publicationsTotal'
  | 'publicationsLast7d'
  | 'automationProposalsTotal'
  | 'automationRunsTriggered'
  | 'knowledgeSurfaceOpens'
  | 'viewRunsTotal'
  | 'watchTicksTotal'

export type KnowledgeMetricsDailyKey = 'publications' | 'automationProposals' | 'viewRuns'

export interface KnowledgeMetricsCounters {
  connectionsActive: number
  publicationsTotal: number
  publicationsLast7d: number
  automationProposalsTotal: number
  automationRunsTriggered: number
  knowledgeSurfaceOpens: number
  viewRunsTotal: number
  watchTicksTotal: number
}

export interface KnowledgeMetricsDailyBucket {
  publications?: number
  automationProposals?: number
  viewRuns?: number
}

export interface KnowledgeMetricsSnapshot {
  version: typeof KNOWLEDGE_METRICS_VERSION
  updatedAt: string
  counters: KnowledgeMetricsCounters
  daily?: Record<string, KnowledgeMetricsDailyBucket>
}

interface MetricsFileShape {
  version?: number
  updatedAt?: string
  counters?: Partial<Record<Exclude<KnowledgeMetricsCounterKey, never>, number>>
  daily?: Record<string, KnowledgeMetricsDailyBucket>
}

const ZERO_COUNTERS: Omit<KnowledgeMetricsCounters, 'connectionsActive' | 'publicationsLast7d'> = {
  publicationsTotal: 0,
  automationProposalsTotal: 0,
  automationRunsTriggered: 0,
  knowledgeSurfaceOpens: 0,
  viewRunsTotal: 0,
  watchTicksTotal: 0,
}

function utcDay(isoOrMs: string | number = Date.now()): string {
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function sevenDaysAgoMs(nowMs: number): number {
  return nowMs - 7 * 24 * 60 * 60 * 1000
}

export function emptyMetricsSnapshot(now: () => number = () => Date.now()): KnowledgeMetricsSnapshot {
  const nowMs = now()
  return {
    version: KNOWLEDGE_METRICS_VERSION,
    updatedAt: new Date(nowMs).toISOString(),
    counters: {
      connectionsActive: 0,
      publicationsLast7d: 0,
      ...ZERO_COUNTERS,
    },
    daily: {},
  }
}

/** Parse metrics.json resiliently: missing/corrupt → empty shape. */
export function parseMetricsFile(content: string): MetricsFileShape {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as MetricsFileShape
  } catch {
    return {}
  }
}

export interface KnowledgeMetricsStoreOptions {
  /** Injectable clock (tests). */
  now?: () => number
  /** Override connections active derivation (tests). */
  connectionsActive?: () => number
  /** Override publications-last-7d derivation (tests). */
  publicationsLast7d?: () => number
}

export class KnowledgeMetricsStore {
  readonly filePath: string
  private readonly now: () => number
  private readonly connectionsActiveFn: () => number
  private readonly publicationsLast7dFn: () => number

  constructor(workspaceRoot: string, options: KnowledgeMetricsStoreOptions = {}) {
    this.filePath = join(workspaceRoot, 'knowledge', 'metrics.json')
    this.now = options.now ?? (() => Date.now())
    this.connectionsActiveFn =
      options.connectionsActive ??
      (() => {
        try {
          return new KnowledgeConnectionsStore().list().length
        } catch {
          return 0
        }
      })
    this.publicationsLast7dFn =
      options.publicationsLast7d ??
      (() => {
        try {
          const cutoff = sevenDaysAgoMs(this.now())
          return new KnowledgePublicationsStore(workspaceRoot)
            .list()
            .filter((p) => {
              const t = Date.parse(p.createdAt)
              return !Number.isNaN(t) && t >= cutoff
            }).length
        } catch {
          return 0
        }
      })
    this.cleanupOrphanTmp()
  }

  /** Full snapshot with derived counters recomputed on read. */
  snapshot(): KnowledgeMetricsSnapshot {
    const raw = this.readRaw()
    const nowMs = this.now()
    const counters: KnowledgeMetricsCounters = {
      connectionsActive: Math.max(0, this.connectionsActiveFn()),
      publicationsTotal: nonNeg(raw.counters?.publicationsTotal),
      publicationsLast7d: Math.max(0, this.publicationsLast7dFn()),
      automationProposalsTotal: nonNeg(raw.counters?.automationProposalsTotal),
      automationRunsTriggered: nonNeg(raw.counters?.automationRunsTriggered),
      knowledgeSurfaceOpens: nonNeg(raw.counters?.knowledgeSurfaceOpens),
      viewRunsTotal: nonNeg(raw.counters?.viewRunsTotal),
      watchTicksTotal: nonNeg(raw.counters?.watchTicksTotal),
    }
    return {
      version: KNOWLEDGE_METRICS_VERSION,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(nowMs).toISOString(),
      counters,
      daily: raw.daily && typeof raw.daily === 'object' ? { ...raw.daily } : {},
    }
  }

  get(): KnowledgeMetricsSnapshot {
    return this.snapshot()
  }

  /**
   * Atomically bump a counter (and optional daily bucket). Fail-soft: write
   * errors propagate (caller may catch); corrupt prior state is reset.
   */
  increment(
    key: KnowledgeMetricsCounterKey,
    amount = 1,
    dailyKey?: KnowledgeMetricsDailyKey,
  ): KnowledgeMetricsSnapshot {
    if (key === 'connectionsActive' || key === 'publicationsLast7d') {
      // Derived counters — snapshot only.
      return this.snapshot()
    }
    const persistedKey = key as Exclude<
      KnowledgeMetricsCounterKey,
      'connectionsActive' | 'publicationsLast7d'
    >
    const delta = Number.isFinite(amount) ? Math.trunc(amount) : 0
    if (delta === 0) return this.snapshot()

    const nowMs = this.now()
    const raw = this.readRaw()
    const counters = {
      publicationsTotal: nonNeg(raw.counters?.publicationsTotal),
      automationProposalsTotal: nonNeg(raw.counters?.automationProposalsTotal),
      automationRunsTriggered: nonNeg(raw.counters?.automationRunsTriggered),
      knowledgeSurfaceOpens: nonNeg(raw.counters?.knowledgeSurfaceOpens),
      viewRunsTotal: nonNeg(raw.counters?.viewRunsTotal),
      watchTicksTotal: nonNeg(raw.counters?.watchTicksTotal),
    }
    counters[persistedKey] = nonNeg(counters[persistedKey]) + delta

    const daily: Record<string, KnowledgeMetricsDailyBucket> =
      raw.daily && typeof raw.daily === 'object' ? { ...raw.daily } : {}
    if (dailyKey) {
      const day = utcDay(nowMs)
      const bucket = { ...(daily[day] ?? {}) }
      bucket[dailyKey] = nonNeg(bucket[dailyKey]) + delta
      daily[day] = bucket
    }

    const file: MetricsFileShape = {
      version: KNOWLEDGE_METRICS_VERSION,
      updatedAt: new Date(nowMs).toISOString(),
      counters,
      daily,
    }
    this.writeRaw(file)
    return this.snapshot()
  }

  private readRaw(): MetricsFileShape {
    if (!existsSync(this.filePath)) return {}
    try {
      return parseMetricsFile(readFileSync(this.filePath, 'utf8'))
    } catch {
      return {}
    }
  }

  private writeRaw(file: MetricsFileShape): void {
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })
    const tmp = join(dir, `.${Date.now()}-${process.pid}.metrics.tmp`)
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.filePath)
  }

  private cleanupOrphanTmp(): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.metrics.tmp') && !(entry.startsWith('.') && entry.endsWith('.tmp') && entry.includes('metrics'))) {
          // Also clean generic .*.tmp left mid-rename if named with metrics
          if (!entry.includes('metrics') || !entry.endsWith('.tmp')) continue
        }
        if (!entry.endsWith('.tmp')) continue
        if (!entry.includes('metrics')) continue
        try {
          unlinkSync(join(dir, entry))
        } catch {
          /* best effort */
        }
      }
    } catch {
      /* best effort */
    }
  }
}

function nonNeg(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  return Math.max(0, Math.trunc(n))
}

/** Process-wide cache of metrics stores keyed by workspace root. */
const metricsByRoot = new Map<string, KnowledgeMetricsStore>()

export function metricsStoreFor(
  workspaceRoot: string,
  options?: KnowledgeMetricsStoreOptions,
): KnowledgeMetricsStore {
  if (options) {
    // Options (tests) always create a fresh instance and do not pollute cache.
    return new KnowledgeMetricsStore(workspaceRoot, options)
  }
  let store = metricsByRoot.get(workspaceRoot)
  if (!store) {
    store = new KnowledgeMetricsStore(workspaceRoot)
    metricsByRoot.set(workspaceRoot, store)
  }
  return store
}

/** Test seam — drop cached stores. */
export function __resetMetricsStoreCacheForTests(): void {
  metricsByRoot.clear()
}

/** Fail-soft increment helper used by RPC / automation hooks. */
export function bumpKnowledgeMetric(
  workspaceRoot: string | null | undefined,
  key: KnowledgeMetricsCounterKey,
  dailyKey?: KnowledgeMetricsDailyKey,
): void {
  if (!workspaceRoot) return
  try {
    metricsStoreFor(workspaceRoot).increment(key, 1, dailyKey)
  } catch {
    /* metrics must never break product paths */
  }
}
