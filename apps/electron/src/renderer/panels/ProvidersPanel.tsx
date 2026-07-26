import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plug,
  Plus,
  Wifi,
  WifiOff,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Trash2,
  Star,
  Settings,
  ExternalLink,
  Radio,
  CheckCircle2,
  XCircle,
  Bell,
  ChevronDown,
  ChevronUp,
  History,
  Bolt,
  Globe,
  HelpCircle,
  Search,
  Server,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { LlmConnectionWithStatus, LlmProviderType } from '@craft-agent/shared/config'
import { providerLabel } from '@craft-agent/shared/config'
import './ProvidersPanel.css'

export type ProvidersPanelProps = {
  onAddProvider?: () => void
  onEditProvider?: (slug: string) => void
}

/** Semantic grouping for the provider card header icon color */
function providerCategory(type: LlmProviderType): 'cloud' | 'local' | 'datacenter' | 'other' {
  if (type === 'pi_compat' || type === 'openai-compat') return 'local'
  if (type === 'anthropic' || type === 'openai' || type === 'pi') return 'cloud'
  if (type === 'vertex' || type === 'bedrock') return 'datacenter'
  return 'other'
}

/** Format a list of model IDs into a compact display string */
function formatModels(models?: Array<string | { id: string }>): string {
  if (!models || models.length === 0) return '—'
  if (models.length <= 3) return models.map(m => (typeof m === 'string' ? m : m.id)).join(', ')
  return `${models.length} models`
}

// ---------------------------------------------------------------------------
// Health-check heartbeat types
// ---------------------------------------------------------------------------

type HealthStatusValue = 'unknown' | 'healthy' | 'degraded' | 'unhealthy'

interface HealthCheckResult {
  status: HealthStatusValue
  message?: string
  lastChecked: number
}

function healthDotTitle(hs: HealthCheckResult | undefined): string {
  if (!hs) return 'Health: not yet checked'
  const labels: Record<HealthStatusValue, string> = {
    healthy: 'Endpoint reachable',
    degraded: 'Degraded',
    unhealthy: 'Endpoint unreachable',
    unknown: 'Health unknown',
  }
  const label = labels[hs.status] ?? 'Health unknown'
  return hs.message ? `${label} — ${hs.message}` : label
}

// ---------------------------------------------------------------------------
// Test history (manual, batch, auto-on-connect) — last 5 results per slug
// ---------------------------------------------------------------------------

interface TestHistoryEntry {
  success: boolean
  error?: string
  timestamp: number
  source: 'manual' | 'auto' | 'batch'
  /** Response time in milliseconds for the test request */
  latencyMs?: number
}

const TEST_HISTORY_MAX = 5

function formatTimeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return 'now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

// ---------------------------------------------------------------------------
// Notification history — auth/health transitions logged per slug
// ---------------------------------------------------------------------------

type NotificationKind = 'auth_lost' | 'auth_gained' | 'auth_error_changed' | 'health_lost' | 'health_gained'

interface NotificationEntry {
  kind: NotificationKind
  /** Full message displayed in the toast */
  message: string
  /** Timestamp when the notification fired */
  timestamp: number
  /** The provider name at the time of the notification */
  providerName: string
}

const NOTIFICATION_HISTORY_MAX = 20

function notificationIcon(kind: NotificationKind): string {
  switch (kind) {
    case 'auth_lost':          return '🔴'
    case 'auth_gained':        return '🟢'
    case 'auth_error_changed': return '🟡'
    case 'health_lost':        return '⚠️'
    case 'health_gained':      return '✅'
  }
}

function NotificationTimeline({ entries }: { entries: NotificationEntry[] }) {
  if (entries.length === 0) return null

  return (
    <div className="providers-panel__notification-history">
      <div className="providers-panel__notification-list">
        {entries.map((e, i) => (
          <div key={i} className={`providers-panel__notification-entry providers-panel__notification-entry--${e.kind}`}>
            <span className="providers-panel__notification-icon" aria-hidden="true">{notificationIcon(e.kind)}</span>
            <span className="providers-panel__notification-msg" title={e.message}>
              {e.message.length > 60 ? e.message.slice(0, 60) + '…' : e.message}
            </span>
            <span className="providers-panel__notification-time">{formatTimeAgo(e.timestamp)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TestTimeline({ entries }: { entries: TestHistoryEntry[] | undefined }) {
  if (!entries || entries.length === 0) return null

  return (
    <div className="providers-panel__test-history">
      <span className="providers-panel__test-history-label">Recent</span>
      <div className="providers-panel__test-history-dots">
        {entries.map((e, i) => (
          <div
            key={i}
            className={`providers-panel__test-dot ${e.success ? 'providers-panel__test-dot--ok' : 'providers-panel__test-dot--err'}`}
            title={`${e.success ? 'Connected' : e.error ?? 'Failed'} — ${formatTimeAgo(e.timestamp)} (${e.source})`}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Test history log — expanded readable view from the footer icon
// ---------------------------------------------------------------------------

/**
 * Derive a per-provider slow-latency threshold from the rolling average.
 * Returns avg * 1.5 with a 500ms floor, falling back to 2000ms when there
 * isn't enough history to compute a meaningful baseline.
 */
function calcSlowThreshold(avgData: { sum: number; count: number; avg: number } | undefined): number {
  if (avgData && avgData.count >= 2) {
    return Math.max(500, Math.round(avgData.avg * 1.5))
  }
  return 2000
}

function TestHistoryLog({ entries, slowThreshold }: { entries: TestHistoryEntry[]; slowThreshold?: number }) {
  if (entries.length === 0) return null
  const threshold = slowThreshold ?? 2000

  return (
    <div className="providers-panel__test-log">
      <div className="providers-panel__test-log-list">
        {entries.map((e, i) => (
          <div key={i} className={`providers-panel__test-log-entry ${e.success ? 'providers-panel__test-log-entry--ok' : 'providers-panel__test-log-entry--err'}`}>
            <span className="providers-panel__test-log-icon" aria-hidden="true">
              {e.success ? '✓' : '✗'}
            </span>
            <span className="providers-panel__test-log-source">{e.source}</span>
            <span className="providers-panel__test-log-msg" title={e.error}>
              {e.success ? 'Connected' : e.error ? (e.error.length > 50 ? e.error.slice(0, 50) + '…' : e.error) : 'Failed'}
            </span>
            {e.latencyMs != null && (
              <span className={`providers-panel__test-log-latency ${e.latencyMs > threshold ? 'providers-panel__test-log-latency--slow' : ''}`}>
                {e.latencyMs}ms
              </span>
            )}
            <span className="providers-panel__test-log-time">{formatTimeAgo(e.timestamp)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Health-check heatmap — hourly uptime over 7 days
// ---------------------------------------------------------------------------

interface Bucket {
  hour: string
  checks: number
  successRate: number
}

function UptimeHeatmap({ buckets }: { buckets: Bucket[] }) {
  if (buckets.length === 0) return null

  // Group by day: last 7 days, each up to 24 hour cells
  const now = new Date()
  const days: { label: string; buckets: Bucket[] }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dayLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    const dayBuckets = buckets.filter(b => {
      // hour key is ISO like "2026-07-20T14" — match on date prefix
      return b.hour.startsWith(d.toISOString().slice(0, 10))
    })
    days.push({ label: dayLabel, buckets: dayBuckets })
  }

  return (
    <div className="providers-panel__heatmap">
      <span className="providers-panel__heatmap-label">7-Day Uptime</span>
      <div className="providers-panel__heatmap-grid">
        {days.map((day, di) => (
          <div key={di} className="providers-panel__heatmap-day">
            <span className="providers-panel__heatmap-day-label">{day.label}</span>
            <div className="providers-panel__heatmap-cells">
              {day.buckets.map((b, hi) => (
                <div
                  key={hi}
                  className={`providers-panel__heatmap-cell ${
                    b.checks === 0
                      ? 'providers-panel__heatmap-cell--empty'
                      : b.successRate >= 0.9
                        ? 'providers-panel__heatmap-cell--good'
                        : b.successRate >= 0.5
                          ? 'providers-panel__heatmap-cell--mixed'
                          : 'providers-panel__heatmap-cell--bad'
                  }`}
                  title={`${b.hour}: ${b.checks} checks, ${Math.round(b.successRate * 100)}% success`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="providers-panel__heatmap-legend">
        <span className="providers-panel__heatmap-legend-label">Uptime</span>
        <div className="providers-panel__heatmap-legend-cells">
          <span className="providers-panel__heatmap-cell providers-panel__heatmap-cell--empty" title="No data" />
          <span className="providers-panel__heatmap-cell providers-panel__heatmap-cell--bad" title="< 50%" />
          <span className="providers-panel__heatmap-cell providers-panel__heatmap-cell--mixed" title="50-90%" />
          <span className="providers-panel__heatmap-cell providers-panel__heatmap-cell--good" title=">= 90%" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Latency histogram — 3-bucket view of response-time distribution
// ---------------------------------------------------------------------------

/**
 * Mini histogram showing how many tests/events fell into each latency bucket.
 * Data sources: inference events (preferred) or health-check history entries.
 * Both carry optional `latencyMs`.
 */
function LatencyHistogram({ entries }: { entries: Array<{ latencyMs?: number }> | undefined }) {
  if (!entries || entries.length < 2) return null

  const fast: number[] = []   // < 500ms
  const mid: number[] = []    // 500–2000ms
  const slow: number[] = []   // > 2000ms

  for (const e of entries) {
    if (e.latencyMs == null) continue
    if (e.latencyMs < 500) fast.push(e.latencyMs)
    else if (e.latencyMs <= 2000) mid.push(e.latencyMs)
    else slow.push(e.latencyMs)
  }

  const total = fast.length + mid.length + slow.length
  if (total === 0) return null

  const max = Math.max(fast.length, mid.length, slow.length, 1)

  return (
    <div className="providers-panel__latency-histogram">
      <span className="providers-panel__latency-histogram-label">Latency</span>
      <div className="providers-panel__latency-histogram-buckets">
        <div
          className="providers-panel__latency-bucket providers-panel__latency-bucket--fast"
          style={{ height: `${(fast.length / max) * 100}%` }}
          title={`< 500ms: ${fast.length}/${total}`}
        >
          {fast.length > 0 && (
            <span className="providers-panel__latency-bucket-count">{fast.length}</span>
          )}
        </div>
        <div
          className="providers-panel__latency-bucket providers-panel__latency-bucket--mid"
          style={{ height: `${(mid.length / max) * 100}%` }}
          title={`500–2000ms: ${mid.length}/${total}`}
        >
          {mid.length > 0 && (
            <span className="providers-panel__latency-bucket-count">{mid.length}</span>
          )}
        </div>
        <div
          className="providers-panel__latency-bucket providers-panel__latency-bucket--slow"
          style={{ height: `${(slow.length / max) * 100}%` }}
          title={`> 2000ms: ${slow.length}/${total}`}
        >
          {slow.length > 0 && (
            <span className="providers-panel__latency-bucket-count">{slow.length}</span>
          )}
        </div>
      </div>
      <div className="providers-panel__latency-histogram-labels">
        <span>&lt;500</span>
        <span>500–2k</span>
        <span>&gt;2k</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Health-check history sparkline — mini SVG bar chart
// ---------------------------------------------------------------------------

/**
 * Minimum bar height in px so a near-zero latency event is still visible.
 */
const SPARKLINE_MIN_BAR = 3

type SparklineEntry = { success: boolean; latencyMs?: number }

function Sparkline({
  history,
  maxBars = 40,
}: {
  history: Array<SparklineEntry> | undefined
  maxBars?: number
}) {
  const bars = (history ?? []).slice(-maxBars)
  if (bars.length < 2) return null

  const barW = 3
  const gap = 1
  const totalW = bars.length * (barW + gap) - gap
  const h = 20

  // Compute max latency in the visible window so bars scale proportionally.
  // Fall back to 1 when no latency data is available (all bars full height).
  const maxLatency = Math.max(1, ...bars.map(b => b.latencyMs ?? 0))
  const hasLatency = maxLatency > 1

  const successCount = bars.filter(b => b.success).length
  const pct = Math.round((successCount / bars.length) * 100)
  const range = hasLatency
    ? `${bars.length} checks, ${pct}% success, max ${maxLatency}ms`
    : `${bars.length} checks, ${pct}% success`

  return (
    <div className="providers-panel__sparkline-wrap" title={range}>
      <svg
        className="providers-panel__sparkline"
        preserveAspectRatio="none"
        viewBox={`0 0 ${totalW} ${h}`}
      >
        {bars.map((b, i) => {
          // When latency is available, bar height represents the proportion of
          // the max latency in this window (capped at full height). When no
          // latency data exists, bars render at full height (legacy behavior).
          const barH = hasLatency && b.latencyMs != null
            ? Math.max(SPARKLINE_MIN_BAR, Math.round((b.latencyMs / maxLatency) * h))
            : h
          return (
            <rect
              key={i}
              x={i * (barW + gap)}
              y={h - barH}
              width={barW}
              height={barH}
              rx={1}
              fill={b.success ? '#22c55e' : '#ef4444'}
              opacity={b.success ? 0.65 : 0.85}
            />
          )
        })}
      </svg>
      <span className="providers-panel__sparkline-label">
        {pct}%
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function ProvidersPanel({
  onAddProvider,
  onEditProvider,
}: ProvidersPanelProps) {
  const [providers, setProviders] = useState<LlmConnectionWithStatus[]>([])
  const SEARCH_KEY = 'archstudio:providersSearch'
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>(
    () => {
      try {
        const saved = localStorage.getItem(SEARCH_KEY)
        // Validate it's a string (not a corrupted value)
        if (typeof saved === 'string') {
          // Cap length to prevent abuse
          return saved.slice(0, 200)
        }
      } catch {
        // localStorage read error — start fresh
      }
      return ''
    }
  )
  const [categoryFilter, setCategoryFilter] = useState<'local' | 'cloud' | 'datacenter' | null>(null)

  /** Toggle a category filter — clicking the active category clears it */
  const toggleCategoryFilter = useCallback((cat: 'local' | 'cloud' | 'datacenter') => {
    setCategoryFilter(prev => prev === cat ? null : cat)
  }, [])

  /** Filter providers by name, type label, or model names, plus category */
  const filteredProviders = React.useMemo(() => {
    let result = providers

    // Apply category filter first (faster than text search)
    if (categoryFilter !== null) {
      result = result.filter(p => providerCategory(p.providerType) === categoryFilter)
    }

    // Apply text search
    const q = searchQuery.toLowerCase().trim()
    if (q) {
      result = result.filter(p => {
        // Search by connection name
        if (p.name.toLowerCase().includes(q)) return true
        // Search by provider type label
        if (providerLabel(p.providerType, p.isLocalModel).toLowerCase().includes(q)) return true
        // Search by base URL
        if (p.baseUrl && p.baseUrl.toLowerCase().includes(q)) return true
        // Search by default model
        if (p.defaultModel && p.defaultModel.toLowerCase().includes(q)) return true
        // Search by model names
        if (p.models && p.models.some(m => {
          const id = typeof m === 'string' ? m : m.id
          return id.toLowerCase().includes(q)
        })) return true
        // Search by auth type
        if (p.authType && p.authType.toLowerCase().includes(q)) return true
        return false
      })
    }

    return result
  }, [providers, searchQuery, categoryFilter])
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState<string | null>(null)
  const [batchTesting, setBatchTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; error?: string; latencyMs?: number } | null>>({})
  const testTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [healthStatuses, setHealthStatuses] = useState<Record<string, HealthCheckResult>>({})
  const lastHealthCheckRef = useRef<Record<string, number>>({})
  const HEALTH_CHECK_COOLDOWN = 30_000 // 30 seconds between checks per provider

  // Notification history — ref-based, no re-render on push
  const notificationHistoryRef = useRef<Record<string, NotificationEntry[]>>({})

  /**
   * Push a notification entry into the rolling buffer for a slug.
   */
  function pushNotification(slug: string, entry: Omit<NotificationEntry, 'timestamp'>): void {
    const h = notificationHistoryRef.current[slug] ?? []
    h.unshift({ ...entry, timestamp: Date.now() })
    notificationHistoryRef.current[slug] = h.slice(0, NOTIFICATION_HISTORY_MAX)
  }

  // Snapshot of previous auth+health status for change detection
  const prevStatusRef = useRef<Record<string, {
    isAuthenticated: boolean
    authError?: string
    healthStatus: HealthStatusValue
  }>>({})

  /**
   * Compare current provider states against the previous snapshot and fire
   * toast notifications for meaningful transitions. Called after every poll.
   */
  const detectChanges = useCallback((conns: LlmConnectionWithStatus[]) => {
    const now = Date.now()
    for (const p of conns) {
      const prev = prevStatusRef.current[p.slug]
      const currHealth = healthStatuses[p.slug]?.status ?? 'unknown'

      // ── Auth transition: authenticated → not authenticated ────────────
      if (prev && prev.isAuthenticated && !p.isAuthenticated) {
        const reason = p.authError ? `: ${p.authError}` : ''
        const msg = `${p.name} lost authentication${reason}`
        toast.error(msg, { id: `provider-auth-${p.slug}`, duration: 8000 })
        pushNotification(p.slug, { kind: 'auth_lost', message: msg, providerName: p.name })
      }

      // ── Auth transition: not authenticated → authenticated ────────────
      if (prev && !prev.isAuthenticated && p.isAuthenticated) {
        const msg = `${p.name} connected`
        toast.success(msg)
        pushNotification(p.slug, { kind: 'auth_gained', message: msg, providerName: p.name })
        // Auto-run a connection test to confirm the endpoint is reachable
        // and show the result inline on the card (without activating the
        // manual test button spinner).
        if (testTimeoutRef.current[p.slug]) {
          clearTimeout(testTimeoutRef.current[p.slug])
          delete testTimeoutRef.current[p.slug]
        }
        const t0 = performance.now()
        window.electronAPI.testLlmConnection(p.slug).then(result => {
          const latencyMs = Math.round(performance.now() - t0)
          pushTestHistory(p.slug, result.success, result.error, 'auto', latencyMs)
          setTestResults(prev => ({ ...prev, [p.slug]: result.success ? { success: true, latencyMs } : { success: false, error: result.error ?? 'Failed', latencyMs } }))
          testTimeoutRef.current[p.slug] = setTimeout(() => {
            setTestResults(prev => {
              if (prev[p.slug] === null) return prev
              return { ...prev, [p.slug]: null }
            })
            delete testTimeoutRef.current[p.slug]
          }, 4000)
        }).catch(e => {
          const latencyMs = Math.round(performance.now() - t0)
          const errMsg = e instanceof Error ? e.message : String(e)
          pushTestHistory(p.slug, false, errMsg, 'auto', latencyMs)
          setTestResults(prev => ({ ...prev, [p.slug]: { success: false, error: errMsg, latencyMs } }))
          testTimeoutRef.current[p.slug] = setTimeout(() => {
            setTestResults(prev => {
              if (prev[p.slug] === null) return prev
              return { ...prev, [p.slug]: null }
            })
            delete testTimeoutRef.current[p.slug]
          }, 4000)
        })
      }

      // ── Auth error message changed (while still unauthenticated) ──────
      if (prev && !prev.isAuthenticated && !p.isAuthenticated) {
        if (prev.authError !== p.authError && p.authError) {
          const msg = `${p.name}: ${p.authError}`
          toast.warning(msg, { id: `provider-auth-${p.slug}`, duration: 8000 })
          pushNotification(p.slug, { kind: 'auth_error_changed', message: msg, providerName: p.name })
        }
      }

      // ── Health transition: healthy → unhealthy ────────────────────────
      if (prev && prev.healthStatus === 'healthy' && (currHealth === 'unhealthy' || currHealth === 'degraded')) {
        const statusLabel = currHealth === 'unhealthy' ? 'went offline' : 'degraded'
        const msg = `${p.name} ${statusLabel}`
        toast.warning(msg, { id: `provider-health-${p.slug}`, duration: 6000 })
        pushNotification(p.slug, { kind: 'health_lost', message: msg, providerName: p.name })
      }

      // ── Health transition: unhealthy/degraded → healthy ───────────────
      if (prev && prev.healthStatus !== 'healthy' && currHealth === 'healthy') {
        const msg = `${p.name} back online`
        toast.success(msg)
        pushNotification(p.slug, { kind: 'health_gained', message: msg, providerName: p.name })
      }
    }

    // Save snapshot for next poll tick
    prevStatusRef.current = {}
    for (const p of conns) {
      prevStatusRef.current[p.slug] = {
        isAuthenticated: p.isAuthenticated,
        authError: p.authError,
        healthStatus: healthStatuses[p.slug]?.status ?? 'unknown',
      }
    }
  }, [healthStatuses])

  // Test history — last 5 manual/batch/auto-test results per slug
  const testHistoryRef = useRef<Record<string, TestHistoryEntry[]>>({})

  function pushTestHistory(slug: string, success: boolean, error: string | undefined, source: TestHistoryEntry['source'], latencyMs?: number): void {
    const h = testHistoryRef.current[slug] ?? []
    h.unshift({ success, error, timestamp: Date.now(), source, latencyMs })
    testHistoryRef.current[slug] = h.slice(0, TEST_HISTORY_MAX)
    // Update rolling average latency
    if (latencyMs != null) {
      const prev = avgLatencyRef.current[slug] ?? { sum: 0, count: 0, avg: 0 }
      prev.sum += latencyMs
      prev.count += 1
      prev.avg = Math.round(prev.sum / prev.count)
      avgLatencyRef.current[slug] = prev
      // Persist to localStorage so the rolling average survives across sessions
      try {
        localStorage.setItem(AVG_LATENCY_KEY, JSON.stringify(avgLatencyRef.current));
      } catch {
        // localStorage write failure (quota exceeded) — data still in ref for this session
      }
    }
  }

  // Heatmap data (from SQLite health_check_history) — hourly uptime per slug
  const [healthHeatmap, setHealthHeatmap] = useState<Record<string, Bucket[]>>({})

  // Real inference history (from LlmInferenceStore) for the sparkline
  const [inferenceHistory, setInferenceHistory] = useState<Record<string, InferenceHistoryResult>>({})

  /**
   * Fetch real inference history from the shared LlmInferenceStore.
   * Called every poll cycle alongside the provider list fetch.
   */
  /**
   * Fetch heatmap data from the SQLite health_check_history table.
   * Called every poll cycle alongside the provider list fetch.
   */
  const fetchHealthHeatmap = useCallback(async () => {
    try {
      const all = await window.electronAPI.getHealthHeatmapAll()
      setHealthHeatmap(all)
    } catch {
      // SQLite store may not be available on remote servers.
    }
  }, [])

  const fetchInferenceHistory = useCallback(async () => {
    try {
      const all = await window.electronAPI.getLlmInferenceHistoryAll()
      setInferenceHistory(all)
    } catch (err) {
      // Inference store is a main-process singleton — may not be available
      // on all connection types (e.g., remote server without the store).
      // Silently degrade to health-check-only sparkline display.
      console.warn('[ProvidersPanel] Failed to fetch inference history:', err)
    }
  }, [])

  // Rolling health-check history for the sparkline (ref-based — no re-render on push)
  const HEALTH_HISTORY_MAX = 60 // ~30 min at ~2 checks/min
  const healthHistoryRef = useRef<Record<string, Array<{ success: boolean; timestamp: number }>>>({})

  // Rolling average latency per slug (ref-based, computed on push).
  // Persisted to localStorage so the rolling average survives panel close/reopen
  // and accumulates across sessions instead of resetting to zero every mount.
  const AVG_LATENCY_KEY = 'archstudio:avgLatency';
  const avgLatencyRef = useRef<Record<string, { sum: number; count: number; avg: number }>>(
    () => {
      try {
        const raw = localStorage.getItem(AVG_LATENCY_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          // Validate shape: object with slug → { sum, count, avg } entries
          if (typeof parsed === 'object' && parsed !== null) {
            for (const val of Object.values(parsed)) {
              const v = val as Record<string, unknown>;
              if (typeof v.sum !== 'number' || typeof v.count !== 'number') {
                return {}; // corrupted — start fresh
              }
            }
            return parsed as Record<string, { sum: number; count: number; avg: number }>;
          }
        }
      } catch {
        // localStorage read error (quota, corrupted JSON) — start fresh
      }
      return {};
    }
  )

  /**
   * Push a health-check result into the rolling buffer. Prunes entries
   * older than 1 hour and caps at HEALTH_HISTORY_MAX.
   */
  function pushHealthHistory(slug: string, success: boolean): void {
    const cutoff = Date.now() - 60 * 60 * 1000
    const h = healthHistoryRef.current[slug] ?? []
    h.push({ success, timestamp: Date.now() })
    healthHistoryRef.current[slug] = h
      .filter(e => e.timestamp >= cutoff)
      .slice(-HEALTH_HISTORY_MAX)
  }

  /**
   * Run health-check pings for all providers that haven't been tested within
   * the cooldown window. Runs in the background — does not block the poll
   * cycle and does not show inline test results (those are for manual tests).
   */
  /**
   * Persist a health check result to the SQLite health_check_history table.
   * Fire-and-forget — failures are logged but never block the UI.
   */
  async function recordHealthCheck(slug: string, success: boolean, latencyMs?: number): Promise<void> {
    try {
      await window.electronAPI.recordHealthCheck(slug, success, latencyMs)
    } catch {
      // SQLite store is a main-process singleton — may not be available on remote servers.
    }
  }

  const runHealthChecks = useCallback(async (conns: LlmConnectionWithStatus[]) => {
    const now = Date.now()
    for (const provider of conns) {
      const lastChecked = lastHealthCheckRef.current[provider.slug] ?? 0
      if ((now - lastChecked) < HEALTH_CHECK_COOLDOWN) continue
      // Claim the cooldown slot IMMEDIATELY before the async call so the
      // next poll tick (5s later) doesn't fire a duplicate test while this
      // one is still in-flight.
      lastHealthCheckRef.current[provider.slug] = now
      const t0 = performance.now()
      try {
        const result = await window.electronAPI.testLlmConnection(provider.slug)
        const completedAt = Date.now()
        const latencyMs = Math.round(performance.now() - t0)
        const ok = result.success
        pushHealthHistory(provider.slug, ok)
        setHealthStatuses(prev => ({
          ...prev,
          [provider.slug]: {
            status: ok ? 'healthy' : 'unhealthy',
            message: result.error,
            lastChecked: completedAt,
          },
        }))
        lastHealthCheckRef.current[provider.slug] = completedAt
        recordHealthCheck(provider.slug, ok, latencyMs)
      } catch (e) {
        const completedAt = Date.now()
        const latencyMs = Math.round(performance.now() - t0)
        pushHealthHistory(provider.slug, false)
        setHealthStatuses(prev => ({
          ...prev,
          [provider.slug]: {
            status: 'unhealthy',
            message: e instanceof Error ? e.message : String(e),
            lastChecked: completedAt,
          },
        }))
        lastHealthCheckRef.current[provider.slug] = completedAt
        recordHealthCheck(provider.slug, false, latencyMs)
      }
    }
  }, [])

  const fetchProviders = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true)
    }
    setError(null)
    try {
      const conns = await window.electronAPI.listLlmConnectionsWithStatus()
      setProviders(conns)
      // Fetch heatmap + inference history alongside provider list
      fetchHealthHeatmap()
      fetchInferenceHistory()
      // Detect auth/health changes and fire toasts.
      // Note: health-transition detection reads healthStatuses from the
      // previous poll cycle (runHealthChecks updates it asynchronously).
      // This means "healthy → unhealthy" notifications fire ~5-35s after
      // the actual health check result — acceptable for a 30s cooldown.
      detectChanges(conns)
      // Kick off health checks in the background (fire-and-forget — doesn't block the UI)
      runHealthChecks(conns)
    } catch (e) {
      if (!opts?.silent) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (!opts?.silent) {
        setLoading(false)
      }
    }
  }, [fetchHealthHeatmap, fetchInferenceHistory])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  // Poll-based auto-refresh (5-second interval)
  useEffect(() => {
    if (!autoRefresh) return
    // Immediate fetch on mount, then poll
    fetchProviders({ silent: true })
    pollRef.current = setInterval(() => {
      fetchProviders({ silent: true })
    }, 5000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [autoRefresh, fetchProviders])

  // Listen for instant change events from the main process (belt + suspenders)
  useEffect(() => {
    const cleanup = window.electronAPI.onLlmConnectionsChanged(() => {
      fetchProviders({ silent: true })
    })
    return () => cleanup()
  }, [fetchProviders])

  // Subscribe to push-based inference updates — re-fetches inference history
  // immediately when an agent backend records a turn or tool-call event,
  // instead of waiting for the next 5s poll tick.
  useEffect(() => {
    if (!window.electronAPI.onLlmInferenceChanged) return
    const cleanup = window.electronAPI.onLlmInferenceChanged(() => {
      fetchInferenceHistory()
    })
    return () => cleanup()
  }, [fetchInferenceHistory])

  // Keyboard shortcuts — Ctrl+F to focus search, Escape to clear
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ctrl+F or Cmd+F — focus search input
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      // Escape — clear search and blur input
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        e.preventDefault()
        if (searchQuery) {
          setSearchQuery('')
        }
        searchInputRef.current?.blur()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [searchQuery])

  // Persist search query to localStorage whenever it changes
  useEffect(() => {
    try {
      if (searchQuery) {
        localStorage.setItem(SEARCH_KEY, searchQuery)
      } else {
        localStorage.removeItem(SEARCH_KEY)
      }
    } catch {
      // localStorage write failure — silently degrade
    }
  }, [searchQuery])

  // Track which cards have expanded notification history
  const [expandedNotifications, setExpandedNotifications] = useState<Record<string, boolean>>({})

  // Track which cards have expanded test history log
  const [expandedTestLog, setExpandedTestLog] = useState<Record<string, boolean>>({})

  // Clean up stale health-status and history entries when providers are deleted
  useEffect(() => {
    const activeSlugs = new Set(providers.map(p => p.slug))
    setHealthStatuses(prev => {
      const next = { ...prev }
      for (const slug of Object.keys(next)) {
        if (!activeSlugs.has(slug)) delete next[slug]
      }
      return next
    })
    for (const slug of Object.keys(lastHealthCheckRef.current)) {
      if (!activeSlugs.has(slug)) delete lastHealthCheckRef.current[slug]
    }
    for (const slug of Object.keys(healthHistoryRef.current)) {
      if (!activeSlugs.has(slug)) delete healthHistoryRef.current[slug]
    }
    for (const slug of Object.keys(prevStatusRef.current)) {
      if (!activeSlugs.has(slug)) delete prevStatusRef.current[slug]
    }
    for (const slug of Object.keys(testHistoryRef.current)) {
      if (!activeSlugs.has(slug)) delete testHistoryRef.current[slug]
    }
    for (const slug of Object.keys(notificationHistoryRef.current)) {
      if (!activeSlugs.has(slug)) delete notificationHistoryRef.current[slug]
    }
    // Flush deleted slugs from localStorage so stale latency data doesn't
    // survive across sessions for connections that no longer exist.
    // IMPORTANT: guard with providers.length > 0 — on initial mount providers
    // is empty before fetchProviders resolves, and without this guard ALL
    // persisted data would be wiped on every page load.
    if (providers.length > 0) {
      const avgKeys = Object.keys(avgLatencyRef.current)
      let dirty = false
      for (const slug of avgKeys) {
        if (!activeSlugs.has(slug)) {
          delete avgLatencyRef.current[slug]
          dirty = true
        }
      }
      if (dirty) {
        try {
          localStorage.setItem(AVG_LATENCY_KEY, JSON.stringify(avgLatencyRef.current))
        } catch { /* localStorage write failure — data still in ref for this session */ }
      }
    }
    // Reset expanded states when providers are deleted
    setExpandedNotifications(prev => {
      const next = { ...prev }
      for (const slug of Object.keys(next)) {
        if (!activeSlugs.has(slug)) delete next[slug]
      }
      return next
    })
    setExpandedTestLog(prev => {
      const next = { ...prev }
      for (const slug of Object.keys(next)) {
        if (!activeSlugs.has(slug)) delete next[slug]
      }
      return next
    })
  }, [providers])

  const handleTest = useCallback(async (slug: string) => {
    setTesting(slug)
    // Cancel any pending auto-dismiss for this slug
    if (testTimeoutRef.current[slug]) {
      clearTimeout(testTimeoutRef.current[slug])
      delete testTimeoutRef.current[slug]
    }
    // Clear previous test result for this slug
    setTestResults((prev) => ({ ...prev, [slug]: null }))
    const t0 = performance.now()
    try {
      const result = await window.electronAPI.testLlmConnection(slug)
      const latencyMs = Math.round(performance.now() - t0)
      pushTestHistory(slug, result.success, result.error, 'manual', latencyMs)
      setTestResults((prev) => ({
        ...prev,
        [slug]: result.success ? { success: true, latencyMs } : { success: false, error: result.error ?? 'Test failed', latencyMs },
      }))
      // Re-fetch to update status
      await fetchProviders({ silent: true })
    } catch (e) {
      const latencyMs = Math.round(performance.now() - t0)
      const errMsg = e instanceof Error ? e.message : String(e)
      pushTestHistory(slug, false, errMsg, 'manual', latencyMs)
      setTestResults((prev) => ({
        ...prev,
        [slug]: { success: false, error: errMsg, latencyMs },
      }))
    } finally {
      setTesting(null)
    }
    // Auto-dismiss result after 4 seconds
    testTimeoutRef.current[slug] = setTimeout(() => {
      setTestResults((prev) => {
        if (prev[slug] === null) return prev // already cleared
        return { ...prev, [slug]: null }
      })
      delete testTimeoutRef.current[slug]
    }, 4000)
  }, [fetchProviders])

  const handleDelete = useCallback(async (slug: string) => {
    await window.electronAPI.deleteLlmConnection(slug)
    await fetchProviders()
  }, [fetchProviders])

  const handleSetDefault = useCallback(async (slug: string) => {
    await window.electronAPI.setDefaultLlmConnection(slug)
    await fetchProviders()
  }, [fetchProviders])

  /**
   * Test all providers in parallel, show aggregated results as a toast,
   * and set inline per-provider results that auto-dismiss after 6 seconds.
   */
  const handleTestAll = useCallback(async () => {
    if (providers.length === 0) return
    setBatchTesting(true)
    const slugs = providers.map(p => p.slug)

    const results = await Promise.allSettled(
      slugs.map(async (slug) => {
        const t0 = performance.now()
        const r = await window.electronAPI.testLlmConnection(slug)
        return { slug, result: r, latencyMs: Math.round(performance.now() - t0) }
      })
    )

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < results.length; i++) {
      const wrapped = results[i]!

      if (wrapped.status === 'fulfilled') {
        const { slug, result, latencyMs } = wrapped.value
        if (result.success) {
          successCount++
          pushTestHistory(slug, true, undefined, 'batch', latencyMs)
          setTestResults(prev => ({ ...prev, [slug]: { success: true, latencyMs } }))
        } else {
          failCount++
          pushTestHistory(slug, false, result.error ?? 'Test failed', 'batch', latencyMs)
          setTestResults(prev => ({ ...prev, [slug]: { success: false, error: result.error ?? 'Test failed', latencyMs } }))
        }
      } else {
        failCount++
        // wrapped.status === 'rejected' — the slug index is the same as the input mapping
        const slug = slugs[i]!
        const errMsg = wrapped.reason instanceof Error ? wrapped.reason.message : String(wrapped.reason)
        pushTestHistory(slug, false, errMsg, 'batch')
        setTestResults(prev => ({ ...prev, [slug]: { success: false, error: errMsg } }))
      }

      // Auto-dismiss each inline result after 6 seconds
      if (testTimeoutRef.current[slug]) {
        clearTimeout(testTimeoutRef.current[slug])
      }
      testTimeoutRef.current[slug] = setTimeout(() => {
        setTestResults(prev => {
          if (prev[slug] === null) return prev
          return { ...prev, [slug]: null }
        })
        delete testTimeoutRef.current[slug]
      }, 6000)
    }

    setBatchTesting(false)

    // Aggregated summary
    if (failCount === 0) {
      toast.success(`${successCount}/${providers.length} connected`)
    } else {
      toast.warning(`${successCount}/${providers.length} connected, ${failCount} failed`, {
        duration: 6000,
      })
    }
  }, [providers])

  const handleAdd = useCallback(() => {
    if (onAddProvider) {
      onAddProvider()
    } else {
      setShowAddForm(!showAddForm)
    }
  }, [onAddProvider, showAddForm])

  return (
    <div className="providers-panel">
      {/* Header */}
      <div className="providers-panel__header">
        <div className="providers-panel__title">
          <Plug size={20} />
          <h2>Providers</h2>
          <span className="providers-panel__count">{providers.length}</span>
          <div className="providers-panel__legend-trigger">
            <HelpCircle size={13} />
            <div className="providers-panel__legend-popover">
              <div className="providers-panel__legend-arrow" />
              <div className="providers-panel__legend-content">
                <div className="providers-panel__legend-title">Badge colors</div>
                <div className="providers-panel__legend-row">
                  <span className="providers-panel__legend-swatch providers-panel__legend-swatch--local" />
                  <span>Local — providers on your machine</span>
                </div>
                <div className="providers-panel__legend-row">
                  <span className="providers-panel__legend-swatch providers-panel__legend-swatch--cloud" />
                  <span>Cloud — remote providers</span>
                </div>
                <div className="providers-panel__legend-row">
                  <span className="providers-panel__legend-swatch providers-panel__legend-swatch--datacenter" />
                  <span>Data Center — self-hosted / on-prem</span>
                </div>
                <div className="providers-panel__legend-row">
                  <span className="providers-panel__legend-swatch providers-panel__legend-swatch--default" />
                  <span>Default — primary for new sessions</span>
                </div>
                <div className="providers-panel__legend-hint">Click any badge to filter by category</div>
              </div>
            </div>
          </div>
        </div>          <div className="providers-panel__actions">
          <button
            type="button"
            className={`providers-panel__btn ${autoRefresh ? 'providers-panel__btn--live' : ''}`}
            onClick={() => setAutoRefresh((v) => !v)}
            title={autoRefresh ? 'Auto-refresh is on (click to pause)' : 'Auto-refresh is off (click to resume)'}
          >
            <Radio size={12} />
            <span className="providers-panel__live-dot" />
            <span>Live</span>
          </button>
          <button
            type="button"
            className="providers-panel__btn"
            onClick={() => fetchProviders()}
            disabled={loading}
            title="Refresh now"
          >
            <RefreshCw size={14} className={loading ? 'providers-panel__spinner' : ''} />
          </button>
          {providers.length >= 2 && (
            <button
              type="button"
              className={`providers-panel__btn ${batchTesting ? 'providers-panel__btn--testing' : ''}`}
              onClick={handleTestAll}
              disabled={batchTesting}
              title="Test all provider connections"
            >
              {batchTesting ? (
                <Loader2 size={14} className="providers-panel__spinner" />
              ) : (
                <RefreshCw size={14} />
              )}
              <span>{batchTesting ? 'Testing…' : 'Test All'}</span>
            </button>
          )}
          <button
            type="button"
            className="providers-panel__btn providers-panel__btn--primary"
            onClick={handleAdd}
            title="Add provider connection"
          >
            <Plus size={14} />
            <span>Add Connection</span>
          </button>
        </div>
      </div>

      {/* Connection type quick-add */}
      {showAddForm && (
        <div className="providers-panel__quick-add">
          <h3>Quick-add a connection type</h3>
          <div className="providers-panel__quick-add-grid">
            {([
              { label: 'Claude (API Key)', type: 'anthropic' },
              { label: 'OpenAI (API Key)', type: 'openai' },
              { label: 'Ollama (Local)', type: 'pi_compat' },
              { label: 'ChatGPT (Codex)', type: 'pi' },
              { label: 'Custom Endpoint', type: 'pi_compat' },
            ] as const).map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="providers-panel__preset-btn"
                onClick={() => {
                  setShowAddForm(false)
                  onAddProvider?.()
                }}
              >
                <span className="providers-panel__preset-icon">
                  <Plug size={16} />
                </span>
                <span className="providers-panel__preset-label">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search filter — only shown when 2+ providers connected */}
      {providers.length >= 2 && !loading && !error && (
        <div className="providers-panel__search">
          <Search size={13} className="providers-panel__search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="providers-panel__search-input"
            placeholder="Filter by name, type, or model…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery || categoryFilter ? (
            <>
              <span className="providers-panel__search-count" title={`${filteredProviders.length} of ${providers.length} providers shown`}>
                {filteredProviders.length}/{providers.length}
              </span>
              <button
                type="button"
                className="providers-panel__search-clear"
                onClick={() => { setSearchQuery(''); setCategoryFilter(null) }}
                title="Clear all filters"
              >
                <X size={12} />
              </button>
            </>
          ) : null}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="providers-panel__error">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && !error && (
        <div className="providers-panel__empty">
          <Loader2 size={24} className="providers-panel__spinner" />
          <span>Loading providers…</span>
        </div>
      )}

      {/* Provider list */}
      {!loading && !error && (
        <div className="providers-panel__list">
          {providers.length === 0 ? (
            <div className="providers-panel__empty">
              <Plug size={40} className="providers-panel__empty-icon" />
              <p>No providers connected yet.</p>
              <p className="providers-panel__empty-hint">
                Add your first provider to start using AI models in ARCHstudio.
              </p>
              <button
                type="button"
                className="providers-panel__btn providers-panel__btn--primary"
                onClick={handleAdd}
              >
                <Plus size={14} />
                <span>Add Connection</span>
              </button>
            </div>
          ) : filteredProviders.length === 0 ? (
            <div className="providers-panel__empty">
              <Search size={24} className="providers-panel__empty-icon" />
              <p>No providers match your filter.</p>
              <p className="providers-panel__empty-hint">
                Try a different name, type, or model name.
              </p>
              <button
                type="button"
                className="providers-panel__btn"
                onClick={() => { setSearchQuery(''); setCategoryFilter(null) }}
              >
                <X size={12} />
                <span>{categoryFilter ? 'Clear all filters' : 'Clear filter'}</span>
              </button>
            </div>
          ) : (
            filteredProviders.map((provider) => (
              <div
                key={provider.slug}
                className={`providers-panel__card providers-panel__card--${providerCategory(provider.providerType)} ${provider.isDefault ? 'providers-panel__card--default' : ''}`}
              >
                {/* Card header */}
                <div className="providers-panel__card-header">
                  <div className="providers-panel__card-info">
                    <div className="providers-panel__card-name">
                      <span
                        className={`providers-panel__status-dot providers-panel__status-dot--${providerCategory(provider.providerType)} ${provider.isAuthenticated ? 'providers-panel__status-dot--ok' : 'providers-panel__status-dot--err'}`}
                      />
                      <span
                        className={`providers-panel__health-dot providers-panel__health-dot--${healthStatuses[provider.slug]?.status ?? 'unknown'}`}
                        title={healthDotTitle(healthStatuses[provider.slug])}
                      />
                      <h3>{provider.name}</h3>
                      {provider.isLocalModel && (
                        <button
                          type="button"
                          className={`providers-panel__filter-badge providers-panel__local-badge providers-panel__badge--copyable ${categoryFilter === 'local' ? 'providers-panel__filter-badge--active' : ''}`}
                          onClick={() => {
                            toggleCategoryFilter('local')
                            if (provider.baseUrl) {
                              navigator.clipboard.writeText(provider.baseUrl).then(() => {
                                toast.success('URL copied', {
                                  position: 'bottom-right',
                                  duration: 2000,
                                })
                              }).catch(() => {
                                console.warn('[ProvidersPanel] Clipboard write rejected for', provider.slug)
                              })
                            }
                          }}
                          title={`${categoryFilter === 'local' ? 'Clear local filter — show all providers' : 'Filter to show only local providers'}${provider.baseUrl ? `\nClick to copy endpoint URL: ${provider.baseUrl}` : ''}${provider.models?.length ? `\n${provider.models.length} model${provider.models.length === 1 ? '' : 's'}` : ''}${(() => { const hs = healthStatuses[provider.slug]; if (!hs) return '\nHealth: not checked'; const labels: Record<string, string> = { healthy: 'healthy', degraded: 'degraded', unhealthy: 'unreachable', unknown: 'not checked' }; const label = labels[hs.status] ?? hs.status; return hs.message ? `\n${label} — ${hs.message}` : `\n${label}` })()}`}
                        >
                          <Bolt size={12} />
                          Local
                        </button>
                      )}
                      {providerCategory(provider.providerType) === 'cloud' && !provider.isLocalModel && (
                        <button
                          type="button"
                          className={`providers-panel__filter-badge providers-panel__cloud-badge ${categoryFilter === 'cloud' ? 'providers-panel__filter-badge--active' : ''}`}
                          onClick={() => toggleCategoryFilter('cloud')}
                          title={`${categoryFilter === 'cloud' ? 'Clear cloud filter — show all providers' : 'Filter to show only cloud providers'}\n${providerLabel(provider.providerType)}${provider.piAuthProvider ? ` \n${provider.piAuthProvider}` : ''}`}
                        >
                          <Globe size={12} />
                          Cloud
                        </button>
                      )}
                      {providerCategory(provider.providerType) === 'datacenter' && !provider.isLocalModel && (
                        <button
                          type="button"
                          className={`providers-panel__filter-badge providers-panel__datacenter-badge ${categoryFilter === 'datacenter' ? 'providers-panel__filter-badge--active' : ''}`}
                          onClick={() => toggleCategoryFilter('datacenter')}
                          title={`${categoryFilter === 'datacenter' ? 'Clear data-center filter — show all providers' : 'Filter to show only data-center providers'}\n${providerLabel(provider.providerType)}`}
                        >
                          <Server size={12} />
                          Data Center
                        </button>
                      )}
                      {provider.isDefault && (
                        <span
                          className="providers-panel__default-badge"
                          title={`Default provider — primary for new sessions${provider.lastUsedAt ? `\nLast used ${formatTimeAgo(provider.lastUsedAt)}` : ''}${provider.defaultModel ? `\nDefault model: ${provider.defaultModel}` : ''}`}
                        >
                          <Star size={12} />
                          Default
                        </span>
                      )}
                    </div>
                    <span className="providers-panel__card-type">
                      {providerLabel(provider.providerType, provider.isLocalModel)}
                      {provider.piAuthProvider && !provider.isLocalModel && ` · ${provider.piAuthProvider}`}
                    </span>
                  </div>
                  <div className="providers-panel__card-actions">
                    {!provider.isDefault && (
                      <button
                        type="button"
                        className="providers-panel__icon-btn"
                        onClick={() => handleSetDefault(provider.slug)}
                        title="Set as default"
                      >
                        <Star size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="providers-panel__icon-btn"
                      onClick={() => onEditProvider?.(provider.slug)}
                      title="Edit connection"
                    >
                      <Settings size={14} />
                    </button>
                    <button
                      type="button"
                      className="providers-panel__icon-btn"
                      onClick={() => handleDelete(provider.slug)}
                      title="Remove connection"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Card body */}
                <div className="providers-panel__card-body">
                  {/* Status badge */}
                  <div className="providers-panel__status-row">
                    {provider.isAuthenticated ? (
                      <span className="providers-panel__status-badge providers-panel__status-badge--ok">
                        <Wifi size={12} />
                        Authenticated
                      </span>
                    ) : (
                      <span className="providers-panel__status-badge providers-panel__status-badge--err" title={provider.authError}>
                        <WifiOff size={12} />
                        {provider.authError ? 'Auth Error' : 'Not Authenticated'}
                      </span>
                    )}
                    {provider.baseUrl && (
                      <span className="providers-panel__endpoint" title={provider.baseUrl}>
                        <ExternalLink size={10} />
                        {provider.baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
                      </span>
                    )}
                  </div>

                  {/* Auth error */}
                  {provider.authError && (
                    <div className="providers-panel__auth-error">
                      <AlertTriangle size={12} />
                      <span>{provider.authError}</span>
                    </div>
                  )}

                  {/* Details grid */}
                  <div className="providers-panel__details-grid">
                    <div className="providers-panel__detail">
                      <span className="providers-panel__detail-label">Auth</span>
                      <span className="providers-panel__detail-value">{provider.authType}</span>
                    </div>
                    <div className="providers-panel__detail">
                      <span className="providers-panel__detail-label">Model count</span>
                      <span className="providers-panel__detail-value">
                        {provider.models?.length ?? 0}
                      </span>
                    </div>
                    {provider.defaultModel && (
                      <div className="providers-panel__detail providers-panel__detail--wide">
                        <span className="providers-panel__detail-label">Default model</span>
                        <span className="providers-panel__detail-value providers-panel__detail-value--mono">
                          {provider.defaultModel}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Model list preview */}
                  {provider.models && provider.models.length > 0 && (
                    <div className="providers-panel__models">
                      <span className="providers-panel__models-label">Models</span>
                      {provider.isLocalModel && (
                        <span className="providers-panel__models-source">
                          Auto-discovered from running instance
                        </span>
                      )}
                      <div className="providers-panel__models-list">
                        {provider.models.slice(0, 8).map((m) => {
                          const id = typeof m === 'string' ? m : m.id
                          return (
                            <span key={id} className="providers-panel__model-chip" title={id}>
                              {id}
                            </span>
                          )
                        })}
                        {provider.models.length > 8 && (
                          <span className="providers-panel__model-chip providers-panel__model-chip--more">
                            +{provider.models.length - 8}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Connection-usage sparkline — inference data preferred, falls back to health checks */}
                  {(() => {
                    const inf = inferenceHistory[provider.slug]
                    const hc = healthHistoryRef.current[provider.slug]
                    const avgLat = avgLatencyRef.current[provider.slug]
                    // Prefer real inference data over health-check ping data
                    if (inf && inf.totalEvents >= 2) {
                      return (
                        <div className="providers-panel__reliability">
                          <span className="providers-panel__reliability-label">
                            Reliability
                            <span className="providers-panel__reliability-source"> (inference)</span>
                          </span>
                          <Sparkline history={inf.events} />
                          {avgLat && avgLat.count >= 2 && (
                            <span className={`providers-panel__avg-latency ${avgLat.avg > calcSlowThreshold(avgLat) ? 'providers-panel__avg-latency--slow' : ''}`}>
                              {avgLat.avg}ms avg
                            </span>
                          )}
                        </div>
                      )
                    }
                    return hc && hc.length >= 2 ? (
                      <div className="providers-panel__reliability">
                        <span className="providers-panel__reliability-label">
                          Reliability
                          <span className="providers-panel__reliability-source"> (health)</span>
                        </span>
                        <Sparkline history={hc} />
                        {avgLat && avgLat.count >= 2 && (
                          <span className={`providers-panel__avg-latency ${avgLat.avg > calcSlowThreshold(avgLat) ? 'providers-panel__avg-latency--slow' : ''}`}>
                            {avgLat.avg}ms avg
                          </span>
                        )}
                      </div>
                    ) : null
                  })()}

                  {/* Latency histogram — shows distribution from inference or health events */}
                  {(() => {
                    const inf = inferenceHistory[provider.slug]
                    const hc = healthHistoryRef.current[provider.slug]
                    // Prefer inference events (richer data), fall back to health-check pings
                    return (
                      <LatencyHistogram
                        entries={
                          inf && inf.events.length >= 2
                            ? inf.events
                            : hc
                        }
                      />
                    )
                  })()}

                  {/* 7-day uptime heatmap from the SQLite health_check_history table */}
                  <UptimeHeatmap buckets={healthHeatmap[provider.slug] ?? []} />
                </div>

                {/* Card footer */}
                <div className="providers-panel__card-footer">
                  <button
                    type="button"
                    className="providers-panel__footer-btn"
                    onClick={() => handleTest(provider.slug)}
                    disabled={testing === provider.slug}
                  >
                    {testing === provider.slug ? (
                      <>
                        <Loader2 size={12} className="providers-panel__spinner" />
                        Testing…
                      </>
                    ) : (
                      <>
                        <RefreshCw size={12} />
                        Test Connection
                      </>
                    )}
                  </button>
                  {/* Inline test result — with latency badge */}
                  {testResults[provider.slug] && (
                    <span
                      className={`providers-panel__test-result ${
                        testResults[provider.slug]!.success
                          ? 'providers-panel__test-result--ok'
                          : 'providers-panel__test-result--err'
                      }`}
                    >
                      {testResults[provider.slug]!.success ? (
                        <CheckCircle2 size={12} />
                      ) : (
                        <XCircle size={12} />
                      )}
                      <span>
                        {testResults[provider.slug]!.success
                          ? 'Connected'
                          : testResults[provider.slug]!.error ?? 'Failed'}
                      </span>
                      {testResults[provider.slug]!.latencyMs != null && (
                        <span className={`providers-panel__test-latency ${testResults[provider.slug]!.latencyMs > calcSlowThreshold(avgLatencyRef.current[provider.slug]) ? 'providers-panel__test-latency--slow' : ''}`}>
                          {testResults[provider.slug]!.latencyMs}ms
                        </span>
                      )}
                    </span>
                  )}
                  {provider.lastUsedAt && !testResults[provider.slug] && (
                    <span className="providers-panel__last-used">
                      Last used {new Date(provider.lastUsedAt).toLocaleDateString()}
                    </span>
                  )}
                  {/* Test history log icon button */}
                  {testHistoryRef.current[provider.slug]?.length > 0 && (
                    <button
                      type="button"
                      className={`providers-panel__footer-icon-btn ${expandedTestLog[provider.slug] ? 'providers-panel__footer-icon-btn--active' : ''}`}
                      onClick={() => setExpandedTestLog(prev => ({ ...prev, [provider.slug]: !prev[provider.slug] }))}
                      title={expandedTestLog[provider.slug] ? 'Hide test history' : 'Show test history'}
                    >
                      <History size={12} />
                    </button>
                  )}
                </div>

                {/* Test history mini-timeline below the footer */}
                <TestTimeline entries={testHistoryRef.current[provider.slug]} />

                {/* Expanded test history log */}
                {expandedTestLog[provider.slug] && testHistoryRef.current[provider.slug]?.length > 0 && (
                  <TestHistoryLog entries={testHistoryRef.current[provider.slug]} slowThreshold={calcSlowThreshold(avgLatencyRef.current[provider.slug])} />
                )}

                {/* Notification history — collapsible auth/health transition log */}
                {(() => {
                  const notifications = notificationHistoryRef.current[provider.slug]
                  if (!notifications || notifications.length === 0) return null
                  const isExpanded = expandedNotifications[provider.slug]
                  const count = notifications.length
                  return (
                    <div className="providers-panel__notification-section">
                      <button
                        type="button"
                        className="providers-panel__notification-toggle"
                        onClick={() => setExpandedNotifications(prev => ({ ...prev, [provider.slug]: !prev[provider.slug] }))}
                      >
                        <Bell size={12} />
                        <span>Notifications</span>
                        <span className="providers-panel__notification-count">{count}</span>
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      {isExpanded && <NotificationTimeline entries={notifications} />}
                    </div>
                  )
                })()}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
