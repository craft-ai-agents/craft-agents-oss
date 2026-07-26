/**
 * Health check history — SQLite-backed store for provider uptime tracking.
 *
 * Records every health-check ping result (success/failure + optional latency)
 * into a dedicated SQLite table indexed by slug + hour. The heatmap IPC handler
 * returns hourly uptime aggregates for the last 7 days so the ProvidersPanel
 * can render a colour-coded grid.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import { Database } from '@craft-agent/shared/memory/database-compat'
import { join } from 'path'
import { app } from 'electron'

// ============================================================
// Types
// ============================================================

export interface HealthCheckRecord {
  slug: string
  timestamp: number
  success: boolean
  latencyMs?: number
}

/**
 * Aggregated hourly bucket returned by the heatmap query.
 */
export interface HourlyBucket {
  /** ISO hour key like "2026-07-20T14" */
  hour: string
  /** Number of checks in this hour */
  checks: number
  /** Fraction of successful checks (0–1) */
  successRate: number
}

// ============================================================
// Database
// ============================================================

const HEALTH_DB = 'health_check.db'

let db: Database | null = null

function getDb(): Database {
  if (!db) {
    const dbPath = join(app.getPath('userData'), HEALTH_DB)
    db = new Database(dbPath, { create: true })
    db.run('PRAGMA journal_mode = WAL')
    db.run('PRAGMA synchronous = NORMAL')
    db.run(`
      CREATE TABLE IF NOT EXISTS health_check_history (
        slug TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        success INTEGER NOT NULL,
        latency_ms INTEGER
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_hch_slug ON health_check_history(slug, timestamp)')
  }
  return db
}

/**
 * Record a single health check result.
 */
export function recordHealthCheck(slug: string, success: boolean, latencyMs?: number): void {
  const d = getDb()
  const stmt = d.prepare(
    'INSERT INTO health_check_history (slug, timestamp, success, latency_ms) VALUES (?, ?, ?, ?)',
  )
  stmt.run(slug, Date.now(), success ? 1 : 0, latencyMs ?? null)
}

/**
 * Query hourly uptime buckets for the last N days for a given slug.
 */
export function getHourlyUptime(slug: string, days = 7): HourlyBucket[] {
  const d = getDb()
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

  const rows = d
    .prepare(
      `SELECT
         strftime('%Y-%m-%dT%H', timestamp / 1000, 'unixepoch') AS hour,
         COUNT(*) AS checks,
         CAST(SUM(success) AS REAL) / COUNT(*) AS success_rate
       FROM health_check_history
       WHERE slug = ? AND timestamp >= ?
       GROUP BY hour
       ORDER BY hour ASC`,
    )
    .all(slug, cutoff) as Array<{ hour: string; checks: number; success_rate: number }>

  // Fill in any missing hours with zero-check buckets so the heatmap
  // doesn't have gaps (those hours render as grey/unknown cells).
  const buckets: HourlyBucket[] = []
  const now = new Date()
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rowMap = new Map(rows.map(r => [r.hour, r]))

  for (let d = new Date(start); d <= now; d.setHours(d.getHours() + 1)) {
    const hourKey = d.toISOString().slice(0, 13) // "2026-07-20T14"
    const row = rowMap.get(hourKey)
    if (row) {
      buckets.push({ hour: hourKey, checks: row.checks, successRate: row.success_rate })
    } else {
      buckets.push({ hour: hourKey, checks: 0, successRate: 0 })
    }
  }

  return buckets
}

/**
 * Get heatmap data for all known slugs (batch fetch).
 */
export function getAllHeatmapData(days = 7): Record<string, HourlyBucket[]> {
  const d = getDb()
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const result: Record<string, HourlyBucket[]> = {}

  const slugs = d
    .prepare('SELECT DISTINCT slug FROM health_check_history WHERE timestamp >= ?')
    .all(cutoff) as Array<{ slug: string }>

  for (const { slug } of slugs) {
    result[slug] = getHourlyUptime(slug, days)
  }

  return result
}

/**
 * Prune entries older than N days (called periodically to keep the DB bounded).
 */
export function pruneOldRecords(days = 30): void {
  const d = getDb()
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  d.run('DELETE FROM health_check_history WHERE timestamp < ?', cutoff)
  d.run('PRAGMA wal_checkpoint(TRUNCATE)')
}

// ============================================================
// Periodic pruning — keeps the DB bounded
// ============================================================

let pruneTimer: ReturnType<typeof setInterval> | null = null

function startPeriodicPrune(): void {
  if (pruneTimer) return
  pruneTimer = setInterval(() => {
    try {
      pruneOldRecords(30) // keep 30 days
    } catch {
      // Best-effort; fails silently if DB is unavailable.
    }
  }, 86_400_000) // once per day
}

function stopPeriodicPrune(): void {
  if (pruneTimer) {
    clearInterval(pruneTimer)
    pruneTimer = null
  }
}

// ============================================================
// IPC Channels
// ============================================================

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.health.RECORD,
  RPC_CHANNELS.health.HEATMAP,
  RPC_CHANNELS.health.HEATMAP_ALL,
] as const

export function registerHealthHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // Start the daily prune timer when the handlers are registered.
  // This is safe because `registerHealthHandlers` is called from the
  // main-process handler init, which runs after `app.whenReady()`.
  startPeriodicPrune()

  // Record a single health check result
  server.handle(RPC_CHANNELS.health.RECORD, async (_ctx, slug: string, success: boolean, latencyMs?: number) => {
    recordHealthCheck(slug, success, latencyMs)
    return { success: true }
  })

  // Get heatmap for a single slug
  server.handle(RPC_CHANNELS.health.HEATMAP, async (_ctx, slug: string, days?: number) => {
    return getHourlyUptime(slug, days ?? 7)
  })

  // Get heatmap for all slugs
  server.handle(RPC_CHANNELS.health.HEATMAP_ALL, async (_ctx, days?: number) => {
    return getAllHeatmapData(days ?? 7)
  })
}

/**
 * Clean up the periodic prune timer. Call from Electron's `before-quit`
 * handler or the app's dispose lifecycle to prevent dangling timers.
 */
export function disposeHealthHandlers(): void {
  stopPeriodicPrune()
}
