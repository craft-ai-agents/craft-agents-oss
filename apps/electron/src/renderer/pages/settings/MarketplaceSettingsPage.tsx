import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Spinner } from '@craft-agent/ui'
import {
  ShoppingBag,
  Star,
  Clock,
  DownloadCloud,
  Package,
  CheckCircle2,
  FileText,
  Wrench,
  BookOpen,
  Server,
  ExternalLink,
} from 'lucide-react'

import { routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type {
  MarketplaceCatalogResult,
  MarketplaceEntry,
  MarketplaceEntryKind,
  MarketplaceEntryStats,
  MarketplaceLockRecord,
} from '@craft-agent/shared/marketplace'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'marketplace',
}

type SortKey = 'stars' | 'downloads' | 'updated' | 'name'
type BusyState = Record<string, 'busy' | undefined>

/** UI tabs map onto catalog kinds (+ rules = context-doc). */
type MarketplaceTab = 'skillpack' | 'tool' | 'service' | 'rule' | ''

const KIND_ICONS: Record<MarketplaceEntryKind, typeof Package> = {
  skillpack: Package,
  tool: Wrench,
  'context-doc': FileText,
}

const TAB_ICONS: Record<Exclude<MarketplaceTab, ''>, typeof Package> = {
  skillpack: Package,
  tool: Wrench,
  service: Server,
  rule: BookOpen,
}

function formatCompact(n: number): string {
  return Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** Human-readable package size hint (KB below 1 MB, MB above), locale-agnostic units. */
function formatSizeHint(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`
}

function daysElapsed(iso: string): number {
  // Full calendar days since pushedAt/refetch date; never negative.
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))
}

function formatRelativeDays(
  t: (key: string, opts?: Record<string, unknown>) => string,
  iso: string,
  keyPrefix: 'marketplace.updatedDaysAgo' | 'marketplace.lastFetchDaysAgo',
): string {
  const days = daysElapsed(iso)
  if (days < 1) {
    return keyPrefix === 'marketplace.updatedDaysAgo'
      ? t('marketplace.updatedToday')
      : t('marketplace.today')
  }
  return t(keyPrefix, { count: days })
}

/** Map UI tab → catalog kind filter. Services currently empty (tools with service-ish tags). */
function entryMatchesTab(entry: MarketplaceEntry, tab: MarketplaceTab): boolean {
  if (!tab) return true
  if (tab === 'skillpack') return entry.kind === 'skillpack'
  if (tab === 'tool') return entry.kind === 'tool'
  if (tab === 'rule') return entry.kind === 'context-doc'
  if (tab === 'service') {
    // No dedicated kind yet — surface tools tagged service/hosting/api.
    if (entry.kind !== 'tool') return false
    const tags = (entry.tags ?? []).map((x) => x.toLowerCase())
    return tags.some((tag) =>
      ['service', 'services', 'hosting', 'api', 'saas', 'cloud'].includes(tag),
    )
  }
  return true
}

function githubTreeUrl(repo: string, ref: string): string | null {
  if (!repo || !ref) return null
  // owner/repo only
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null
  return `https://github.com/${repo}/tree/${ref}`
}

export default function MarketplaceSettingsPage() {
  const { t } = useTranslation()
  const [view, setView] = useState<MarketplaceCatalogResult | null>(null)
  const [statsMap, setStatsMap] = useState<Record<string, MarketplaceEntryStats>>({})
  const [busy, setBusy] = useState<BusyState>({})
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<MarketplaceTab>('')
  const [tagFilter, setTagFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('stars')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Short-lived success banner from run() (cleared after 3s or next action). */
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  /** Live install phase text per entry id (from marketplace:progress). */
  const [progressById, setProgressById] = useState<Record<string, string>>({})

  const progressLabel = useCallback(
    (phase: string, detail?: string): string => {
      const key = `marketplace.progress.${phase}`
      const translated = t(key)
      const phaseLabel = translated === key ? phase : translated
      return detail ? `${phaseLabel}: ${detail}` : phaseLabel
    },
    [t],
  )

  const load = useCallback(async () => {
    try {
      // Progressive: paint catalog first; stats fill in without blocking first paint.
      const cat = await window.electronAPI.getMarketplaceCatalog()
      setView(cat)
      setError(null)
      setLoading(false)

      void window.electronAPI
        .getMarketplaceStats()
        .then((st) => setStatsMap(st))
        .catch((err) => {
          // Stats are best-effort; keep catalog visible.
          console.warn('marketplace stats failed', err)
        })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [])

  const refreshCatalog = useCallback(async () => {
    setRefreshing(true)
    setActionSuccess(null)
    try {
      const cat = await window.electronAPI.refreshMarketplaceCatalog()
      setView(cat)
      try {
        const st = await window.electronAPI.getMarketplaceStats()
        setStatsMap(st)
      } catch (err) {
        console.warn('marketplace stats refresh failed', err)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const offChanged = window.electronAPI.onMarketplaceChanged(() => {
      void load()
    })
    const offProgress = window.electronAPI.onMarketplaceProgress((payload) => {
      setProgressById((prev) => ({
        ...prev,
        [payload.id]: progressLabel(payload.phase, payload.detail),
      }))
    })
    return () => {
      offChanged()
      offProgress()
    }
  }, [load, progressLabel])

  // Auto-refresh catalog when the settings page regains focus (no banner).
  useEffect(() => {
    const onFocus = () => {
      void refreshCatalog()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshCatalog])

  const run = useCallback(
    async (id: string, fn: () => Promise<unknown>, successKey: string) => {
      setBusy((b) => ({ ...b, [id]: 'busy' }))
      setActionSuccess(null)
      setError(null)
      setProgressById((p) => {
        const next = { ...p }
        delete next[id]
        return next
      })
      try {
        await fn()
        await load()
        const key = `marketplace.success.${successKey}`
        const translated = t(key)
        const label = translated === key ? successKey : translated
        setActionSuccess(label)
        window.setTimeout(() => {
          setActionSuccess((cur) => (cur === label ? null : cur))
        }, 3000)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy((b) => {
          const next = { ...b }
          delete next[id]
          return next
        })
        setProgressById((p) => {
          const next = { ...p }
          delete next[id]
          return next
        })
      }
    },
    [load, t],
  )

  const confirmRemove = useCallback(
    (id: string) => {
      if (!window.confirm(t('marketplace.removeConfirm'))) return
      void run(id, () => window.electronAPI.removeMarketplaceEntry(id), 'remove')
    },
    [run, t],
  )

  const allTags = useMemo(() => {
    if (!view) return []
    const tags = new Set<string>()
    for (const entry of view.catalog.entries) {
      for (const tag of entry.tags ?? []) tags.add(tag)
    }
    return [...tags].sort((a, b) => a.localeCompare(b))
  }, [view])

  const tabCounts = useMemo(() => {
    const counts: Record<Exclude<MarketplaceTab, ''>, number> = {
      skillpack: 0,
      tool: 0,
      service: 0,
      rule: 0,
    }
    if (!view) return counts
    for (const e of view.catalog.entries) {
      if (entryMatchesTab(e, 'skillpack')) counts.skillpack++
      if (entryMatchesTab(e, 'tool')) counts.tool++
      if (entryMatchesTab(e, 'service')) counts.service++
      if (entryMatchesTab(e, 'rule')) counts.rule++
    }
    return counts
  }, [view])

  const entries = useMemo(() => {
    if (!view) return []
    const q = query.trim().toLowerCase()
    const filtered = view.catalog.entries.filter((e) => {
      if (q && !e.title.toLowerCase().includes(q) && !e.descriptionRu.toLowerCase().includes(q))
        return false
      if (!entryMatchesTab(e, tab)) return false
      if (tagFilter && !(e.tags ?? []).includes(tagFilter)) return false
      return true
    })
    const statsVal = (id: string, sel: (s: MarketplaceEntryStats) => number): number => {
      const s = statsMap[id]
      return s ? sel(s) : 0
    }
    /** Combined download signal: npm weekly + GitHub release asset totals. */
    const totalDownloads = (s: MarketplaceEntryStats): number =>
      (s.npmWeeklyDownloads ?? 0) + (s.githubReleaseDownloads ?? 0)
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.title.localeCompare(b.title, 'ru')
        case 'downloads':
          return statsVal(b.id, totalDownloads) - statsVal(a.id, totalDownloads)
        case 'updated': {
          const pa = statsMap[a.id]?.pushedAt ? new Date(statsMap[a.id]!.pushedAt!).getTime() : 0
          const pb = statsMap[b.id]?.pushedAt ? new Date(statsMap[b.id]!.pushedAt!).getTime() : 0
          return pb - pa
        }
        default:
          return statsVal(b.id, (s) => s.stars ?? 0) - statsVal(a.id, (s) => s.stars ?? 0)
      }
    })
  }, [view, query, tab, tagFilter, sortKey, statsMap])

  const installs: Record<string, MarketplaceLockRecord> = view?.installs ?? {}

  const entryState = (e: MarketplaceEntry): 'available' | 'installed' | 'update' | 'deferred' => {
    const lock = installs[e.id]
    if (!lock) return 'available'
    if (lock.status === 'deferred') return 'deferred'
    return lock.ref === e.source.ref ? 'installed' : 'update'
  }

  const tabs: Array<{ id: MarketplaceTab; labelKey: string }> = [
    { id: '', labelKey: 'marketplace.tabAll' },
    { id: 'skillpack', labelKey: 'marketplace.tabSkills' },
    { id: 'tool', labelKey: 'marketplace.tabTools' },
    { id: 'service', labelKey: 'marketplace.tabServices' },
    { id: 'rule', labelKey: 'marketplace.tabRules' },
  ]

  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader
          title={t('settings.marketplace.title')}
          actions={<HeaderMenu route={routes.view.settings('marketplace')} />}
        />
        <div className="flex-1 min-h-0 mask-fade-y overflow-hidden">
          <div className="px-5 pt-6 space-y-3 max-w-3xl mx-auto w-full animate-pulse">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="border border-border/60 rounded-lg p-4 flex items-start gap-4">
                <div className="p-2 rounded-lg bg-foreground/10 mt-1 h-9 w-9" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 w-1/3 rounded bg-foreground/10" />
                  <div className="h-3 w-2/3 rounded bg-foreground/10" />
                  <div className="h-3 w-1/2 rounded bg-foreground/10" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        title={t('settings.marketplace.title')}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshCatalog()}
              disabled={refreshing}
              className="text-xs px-2 py-1 rounded-md border border-border/50 hover:bg-muted disabled:opacity-40 flex items-center gap-1.5"
              title={t('marketplace.refresh')}
            >
              {refreshing ? <Spinner className="w-3 h-3" /> : null}
              {t('marketplace.refresh')}
            </button>
            <HeaderMenu route={routes.view.settings('marketplace')} />
          </div>
        }
      />

      <div className="px-5 pt-4 max-w-3xl mx-auto w-full">
        {error ? (
          <div className="mb-3 border border-destructive/40 bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-2">
            {error}
          </div>
        ) : null}
        {actionSuccess ? (
          <div className="mb-3 border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 text-sm rounded-lg px-4 py-2">
            {actionSuccess}
          </div>
        ) : null}

        {/* Tabs: Skills | Tools | Services | Rules */}
        <div
          role="tablist"
          className="flex flex-wrap gap-1 mb-3 border-b border-border/50 pb-2"
        >
          {tabs.map((item) => {
            const active = tab === item.id
            const count =
              item.id === ''
                ? view?.catalog.entries.length ?? 0
                : tabCounts[item.id as Exclude<MarketplaceTab, ''>]
            const Icon = item.id ? TAB_ICONS[item.id] : ShoppingBag
            return (
              <button
                key={item.id || 'all'}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={
                  active
                    ? 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary/10 text-primary font-medium'
                    : 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted/60'
                }
              >
                <Icon className="w-3.5 h-3.5 opacity-70" />
                {t(item.labelKey)}
                <span className="text-[10px] opacity-60 tabular-nums">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Controls: search/tags left, sort right */}
        <div className="flex flex-wrap gap-2 mb-4 items-center text-sm">
          <input
            className="border border-border/60 rounded-md px-3 py-1.5 outline-none focus:ring-1 focus:ring-ring bg-background"
            placeholder={t('marketplace.search')}
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
          />
          {allTags.length > 0 && (
            <select
              className="border border-border/60 rounded-md px-2 py-1.5 bg-background"
              value={tagFilter}
              onChange={(ev) => setTagFilter(ev.target.value)}
            >
              <option value="">{t('marketplace.filterAllTags')}</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  #{tag}
                </option>
              ))}
            </select>
          )}
          <div className="flex-1 min-w-[1rem]" />
          <select
            className="border border-border/60 rounded-md px-2 py-1.5 bg-background ml-auto"
            value={sortKey}
            onChange={(ev) => setSortKey(ev.target.value as SortKey)}
            aria-label={t('marketplace.sortLabel')}
          >
            <option value="stars">{t('marketplace.sortStars')}</option>
            <option value="downloads">{t('marketplace.sortDownloads')}</option>
            <option value="updated">{t('marketplace.sortUpdated')}</option>
            <option value="name">{t('marketplace.sortName')}</option>
          </select>
        </div>
      </div>

      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 pb-8 space-y-3 max-w-3xl mx-auto w-full">
            {entries.length === 0 ? (
              <div className="text-center py-12 border border-border/60 rounded-lg">
                <ShoppingBag className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <div className="text-sm font-medium">{t('marketplace.emptyTitle')}</div>
                <div className="text-xs opacity-70 mt-1">{t('marketplace.emptyDescription')}</div>
              </div>
            ) : (
              entries.map((e) => {
                const st = statsMap[e.id]
                const state = entryState(e)
                const isBusy = busy[e.id] === 'busy'
                const Icon = KIND_ICONS[e.kind]
                const ghUrl = githubTreeUrl(e.source.repo, e.source.ref)
                return (
                  <div
                    key={e.id}
                    className="border border-border/70 rounded-lg p-4 flex items-start gap-4 bg-card/30 shadow-sm"
                  >
                    <div className="p-2 rounded-lg bg-primary/10 text-primary mt-1">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                            {e.title}
                            <span className="text-xs px-2 py-0.5 border border-border/50 rounded-full opacity-70">
                              {t(`marketplace.kind.${e.kind}`)}
                            </span>
                            {typeof e.sizeHintKb === 'number' && e.sizeHintKb > 0 ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
                                {formatSizeHint(e.sizeHintKb)}
                              </span>
                            ) : null}
                            {e.license ? (
                              <span className="text-[10px] opacity-60">{e.license}</span>
                            ) : null}
                          </div>
                          <div className="text-xs opacity-70 mt-1 break-words">
                            {e.descriptionRu}
                          </div>
                          {isBusy && progressById[e.id] ? (
                            <div className="text-[11px] mt-1 text-primary/80 font-mono truncate">
                              {progressById[e.id]}
                            </div>
                          ) : null}
                        </div>

                        <div className="text-xs text-right whitespace-nowrap shrink-0 min-w-[4.5rem]">
                          {st && !st.error ? (
                            <>
                              {typeof st.stars === 'number' ? (
                                <div className="flex items-center justify-end gap-1.5 font-medium">
                                  <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                                  {formatCompact(st.stars)}
                                </div>
                              ) : null}
                              {typeof st.npmWeeklyDownloads === 'number' ||
                              typeof st.githubReleaseDownloads === 'number' ? (
                                <div className="mt-1 opacity-80 flex items-center justify-end gap-1.5">
                                  <DownloadCloud className="w-3 h-3" />
                                  <span title={t('marketplace.downloadsHint')}>
                                    {formatCompact(
                                      (st.npmWeeklyDownloads ?? 0) +
                                        (st.githubReleaseDownloads ?? 0),
                                    )}
                                  </span>
                                </div>
                              ) : null}
                              {st.pushedAt ? (
                                <div className="mt-1 opacity-60 flex items-center justify-end gap-1.5">
                                  <Clock className="w-3 h-3" />
                                  {formatRelativeDays(t, st.pushedAt, 'marketplace.updatedDaysAgo')}
                                </div>
                              ) : null}
                              {st.stale ? (
                                <div className="mt-0.5 text-[10px] opacity-50">
                                  {t('marketplace.statsStale')}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <div className="opacity-40 tabular-nums" title={t('marketplace.statsUnavailable')}>
                              —
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            title={`${e.source.repo}@${e.source.ref}`}
                            className="group relative text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground cursor-help inline-flex items-center gap-1"
                          >
                            {e.source.repo}@{e.source.ref.slice(0, 8)}
                            <span className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden w-max max-w-xs rounded-md border border-border bg-popover px-2 py-1.5 text-[10px] text-popover-foreground shadow-md group-hover:block">
                              <span className="font-mono break-all">{e.source.ref}</span>
                              {ghUrl ? (
                                <a
                                  href={ghUrl}
                                  className="mt-1 flex items-center gap-1 text-primary underline pointer-events-auto"
                                  onClick={(ev) => {
                                    ev.preventDefault()
                                    void window.electronAPI.openUrl(ghUrl)
                                  }}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  {t('marketplace.openOnGitHub')}
                                </a>
                              ) : null}
                            </span>
                          </span>
                          {e.tags?.slice(0, 3).map((tag) => (
                            <span key={tag} className="text-[10px] opacity-60">
                              #{tag}
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {state === 'installed' ? (
                            <>
                              <span className="text-xs py-1 px-3 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                {t('marketplace.installed')}
                              </span>
                              <button
                                type="button"
                                onClick={() => confirmRemove(e.id)}
                                disabled={isBusy}
                                className="text-xs px-3 py-1 rounded-md border hover:bg-muted disabled:opacity-40"
                              >
                                {t('marketplace.remove')}
                              </button>
                            </>
                          ) : state === 'deferred' ? (
                            <>
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-xs py-1 px-3 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 flex items-center gap-1">
                                  {t('marketplace.deferred')}
                                </span>
                                <span className="text-[10px] opacity-60 max-w-[14rem] text-right leading-snug">
                                  {t('marketplace.deferredHint')}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  void run(e.id, () => window.electronAPI.updateMarketplaceEntry(e.id), 'update')
                                }
                                disabled={isBusy}
                                className="text-xs px-4 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1.5 disabled:opacity-40"
                              >
                                {isBusy ? <Spinner className="w-3 h-3" /> : null}
                                {t('marketplace.retry')}
                              </button>
                              <button
                                type="button"
                                onClick={() => confirmRemove(e.id)}
                                disabled={isBusy}
                                className="text-xs px-3 py-1 rounded-md border hover:bg-muted disabled:opacity-40"
                              >
                                {t('marketplace.remove')}
                              </button>
                            </>
                          ) : state === 'update' ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  void run(e.id, () => window.electronAPI.updateMarketplaceEntry(e.id), 'update')
                                }
                                disabled={isBusy}
                                className="text-xs px-4 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1.5 disabled:opacity-40"
                              >
                                {isBusy ? <Spinner className="w-3 h-3" /> : null}
                                {t('marketplace.update')}
                              </button>
                              <button
                                type="button"
                                onClick={() => confirmRemove(e.id)}
                                disabled={isBusy}
                                className="text-xs px-3 py-1 rounded-md border hover:bg-muted disabled:opacity-40"
                              >
                                {t('marketplace.remove')}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                void run(e.id, () => window.electronAPI.installMarketplaceEntry(e.id), 'install')
                              }
                              disabled={isBusy}
                              className="text-xs px-4 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5 disabled:opacity-40"
                            >
                              {isBusy ? <Spinner className="w-3 h-3" /> : null}
                              {t('marketplace.install')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
