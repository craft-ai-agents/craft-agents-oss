/**
 * KnowledgeHome (W2 + P5) — collection body of the Knowledge mode:
 * full-text search, proposals entry, and saved knowledge views (K-09).
 *
 * Behavior:
 * - Search box (`knowledge.search.placeholder`); typing ≥2 chars searches
 *   after a short debounce, Enter searches immediately. Queries the FIRST
 *   connection from `knowledge.listConnections()`.
 * - Result click → `navigate(routes.view.siyuan({ kind, id }))`.
 * - Saved views: `knowledge.viewsList` → click runs `knowledge.viewRun` and
 *   renders hits in EntityList (optional groupBy headers). Preset
 *   `set_attribute` actions go through `knowledge.viewSetAttribute`
 *   (proposeMutation only) and navigate to the proposal diff.
 * - Deep-link: `knowledge/view/{viewId}` sets activeViewId via the atom.
 *
 * Exported helpers (searchKnowledge / searchHitRoute / resolveKnowledgeApi /
 * listKnowledgeViews / runKnowledgeView / setViewAttribute / groupViewHits /
 * selectKnowledgeView) keep logic-level bun:test coverage without a DOM harness.
 */
import { atom, useAtom, useAtomValue } from 'jotai'
import { Bookmark, Check, ChevronLeft, FileDiff, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { KnowledgeRef, SearchHit } from '@craft-agent/core/knowledge'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { EntityList } from '@/components/ui/entity-list'
import { useNavigation } from '@/contexts/NavigationContext'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { ViewConfig as KnowledgeViewConfig } from '@craft-agent/shared/views'
import { KnowledgeProposals } from './KnowledgeProposals'
import { countActionableProposals, resolveKnowledgeMutationsApi } from './proposal-actions'

/**
 * Which body KnowledgeHome renders. Module-level atom so other column hosts
 * (KnowledgeNavigator link) can surface the proposals list explicitly; the
 * section entry below search toggles it in place. `view` is a saved-knowledge
 * view result surface (P5).
 */
export const knowledgeHomeViewAtom = atom<'search' | 'proposals' | 'view'>('search')

/** Active saved knowledge view id (deep-linkable via knowledge/view/{id}). */
export const knowledgeActiveViewIdAtom = atom<string | null>(null)

// ---------------------------------------------------------------------------
// Search / views logic (exported for tests — see header).
// ---------------------------------------------------------------------------

export interface KnowledgeSearchApi {
  listConnections(): Promise<Array<{ id: string }>>
  search(args: {
    workspaceId: string
    connectionId: string
    input: { query: string }
  }): Promise<{ items: SearchHit[] }>
}

/** P5 views + set_attribute subset of ElectronAPI.knowledge. */
export interface KnowledgeViewHit extends SearchHit {
  attributes?: Record<string, string>
  topic?: string
}

export interface KnowledgeViewsApi {
  listConnections(): Promise<Array<{ id: string }>>
  viewsList(args?: { connectionId?: string }): Promise<KnowledgeViewConfig[]>
  viewRun(args: {
    connectionId: string
    viewId: string
    workspaceId?: string
  }): Promise<{ items: KnowledgeViewHit[]; view: KnowledgeViewConfig }>
  viewSetAttribute(args: {
    connectionId: string
    ref: KnowledgeRef
    name: string
    value: string
  }): Promise<{ proposalId: string }>
}

/** Reads the P1 knowledge surface off the preload-injected ElectronAPI. */
export function resolveKnowledgeApi(): KnowledgeSearchApi | null {
  if (typeof window === 'undefined' || !window.electronAPI?.knowledge) return null
  return window.electronAPI.knowledge
}

/** Reads the P5 views surface; null when preload predates the channels. */
export function resolveKnowledgeViewsApi(): KnowledgeViewsApi | null {
  if (typeof window === 'undefined' || !window.electronAPI?.knowledge) return null
  const api = window.electronAPI.knowledge
  if (typeof api.viewsList !== 'function' || typeof api.viewRun !== 'function') return null
  return api as KnowledgeViewsApi
}

/**
 * Runs a knowledge search against the first configured connection.
 * Returns `null` when there is no usable API or zero connections.
 */
export async function searchKnowledge(
  api: KnowledgeSearchApi | null,
  workspaceId: string,
  query: string,
): Promise<SearchHit[] | null> {
  if (!api) return null
  const connections = await api.listConnections()
  const primary = connections[0]
  if (!primary) return null
  const page = await api.search({
    workspaceId,
    connectionId: primary.id,
    input: { query },
  })
  return page.items
}

/** Route for a search hit — the in-app SiYuan surface for this document/block. */
export function searchHitRoute(hit: Pick<SearchHit, 'ref'>) {
  return routes.view.siyuan({ kind: hit.ref.kind, id: hit.ref.id })
}

/** Route for a saved knowledge view deep-link. */
export function knowledgeViewRoute(viewId: string) {
  return routes.view.knowledgeView(viewId)
}

/** Lists domain=knowledge views (server filters; client keeps only knowledge). */
export async function listKnowledgeViews(
  api: KnowledgeViewsApi | null,
  connectionId?: string,
): Promise<KnowledgeViewConfig[] | null> {
  if (!api) return null
  const views = await api.viewsList(connectionId ? { connectionId } : undefined)
  return views.filter((v) => !v.domain || v.domain === 'knowledge')
}

/**
 * Resolves the primary connection and runs a saved view.
 * Returns null when there is no API / no connection.
 */
export async function runKnowledgeView(
  api: KnowledgeViewsApi | null,
  viewId: string,
  workspaceId?: string,
): Promise<{ items: KnowledgeViewHit[]; view: KnowledgeViewConfig; connectionId: string } | null> {
  if (!api) return null
  const connections = await api.listConnections()
  const primary = connections[0]
  if (!primary) return null
  const result = await api.viewRun({
    connectionId: primary.id,
    viewId,
    workspaceId,
  })
  return { ...result, connectionId: primary.id }
}

/** Propose set_attribute via viewSetAttribute (never direct write). */
export async function setViewAttribute(
  api: KnowledgeViewsApi | null,
  args: {
    connectionId: string
    ref: KnowledgeRef
    name: string
    value: string
  },
): Promise<{ proposalId: string } | null> {
  if (!api || typeof api.viewSetAttribute !== 'function') return null
  return api.viewSetAttribute(args)
}

/**
 * Pure selection helper: pick a view by id from a list (or null).
 * Used by the component and logic-level tests.
 */
export function selectKnowledgeView(
  views: KnowledgeViewConfig[],
  viewId: string | null | undefined,
): KnowledgeViewConfig | null {
  if (!viewId) return null
  return views.find((v) => v.id === viewId) ?? null
}

/** Group key for a hit: topic/status use enriched attributes when present. */
export function groupKeyForHit(hit: KnowledgeViewHit, groupBy?: string): string {
  if (!groupBy) return ''
  if (groupBy === 'notebook') {
    const path = hit.notebookPath || ''
    const parts = path.split('/').filter(Boolean)
    return parts[0] || path || 'ungrouped'
  }
  if (groupBy === 'topic') {
    const topic =
      hit.topic ||
      hit.attributes?.topic ||
      hit.attributes?.['knowledge-topic']
    if (topic) return topic
  }
  if (groupBy === 'status') {
    const status =
      hit.attributes?.['knowledge-workflow_status'] ||
      hit.attributes?.workflow_status ||
      hit.attributes?.status ||
      hit.attributes?.['knowledge-status']
    if (status) return status
  }
  // Fallback: notebook path leaf
  const path = hit.notebookPath || ''
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || 'ungrouped'
}

export interface ViewHitGroup {
  key: string
  items: KnowledgeViewHit[]
}

/** Client-side groupBy for view results (flat list + headers). */
export function groupViewHits(items: KnowledgeViewHit[], groupBy?: string): ViewHitGroup[] {
  if (!groupBy) return [{ key: '', items }]
  const map = new Map<string, KnowledgeViewHit[]>()
  for (const hit of items) {
    const key = groupKeyForHit(hit, groupBy)
    const bucket = map.get(key)
    if (bucket) bucket.push(hit)
    else map.set(key, [hit])
  }
  return [...map.entries()].map(([key, groupItems]) => ({ key, items: groupItems }))
}

/** First set_attribute preset on a view, if any. */
export function firstSetAttributeAction(
  view: KnowledgeViewConfig | null | undefined,
): { name: string; value: string } | null {
  if (!view?.presetActions) return null
  for (const action of view.presetActions) {
    if (action.type === 'set_attribute') {
      return { name: action.name, value: action.value }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SearchStatus = 'idle' | 'loading' | 'error' | 'done'
type ViewRunStatus = 'idle' | 'loading' | 'error' | 'done'

const SEARCH_DEBOUNCE_MS = 250

export function KnowledgeHome() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [noConnections, setNoConnections] = useState(false)
  const [kernelOffline, setKernelOffline] = useState(false)
  const [kernelBinaryFound, setKernelBinaryFound] = useState<boolean | null>(null)
  const [kernelInstallUrl, setKernelInstallUrl] = useState<string | null>(null)
  const [startingKernel, setStartingKernel] = useState(false)
  const [view, setView] = useAtom(knowledgeHomeViewAtom)
  const [activeViewId, setActiveViewId] = useAtom(knowledgeActiveViewIdAtom)
  const [actionableProposalCount, setActionableProposalCount] = useState(0)
  const [migrating, setMigrating] = useState(false)
  // Saved views list
  const [savedViews, setSavedViews] = useState<KnowledgeViewConfig[]>([])
  const [viewsLoaded, setViewsLoaded] = useState(false)

  // Active view run state
  const [viewHits, setViewHits] = useState<SearchHit[]>([])
  const [activeView, setActiveView] = useState<KnowledgeViewConfig | null>(null)
  const [viewConnectionId, setViewConnectionId] = useState<string | null>(null)
  const [viewStatus, setViewStatus] = useState<ViewRunStatus>('idle')
  const [setAttrBusy, setSetAttrBusy] = useState<string | null>(null)

  // Proposals section entry badge
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    const refreshCount = async () => {
      const api = resolveKnowledgeMutationsApi()
      if (!api) return
      try {
        const count = await countActionableProposals(api, workspaceId ?? undefined)
        if (!cancelled) setActionableProposalCount(count)
      } catch {
        /* leave the previous count in place */
      }
    }
    void refreshCount()
    const unsubscribe = window.electronAPI?.knowledge?.onChanged?.(() => void refreshCount())
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [workspaceId])

  // Load saved knowledge views once (and when workspace changes).
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    const load = async () => {
      const api = resolveKnowledgeViewsApi()
      try {
        const list = await listKnowledgeViews(api)
        if (cancelled) return
        setSavedViews(list ?? [])
      } catch {
        if (!cancelled) setSavedViews([])
      } finally {
        if (!cancelled) setViewsLoaded(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  // Probe kernel health for empty-state CTA (binary / install / start).
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    const probe = async () => {
      const api = window.electronAPI?.knowledge
      if (!api?.engineStatus) return
      try {
        const connections = api.listConnections ? await api.listConnections() : []
        const connectionId = connections[0]?.id
        const status = await api.engineStatus({
          ...(workspaceId ? { workspaceId } : {}),
          ...(connectionId ? { connectionId } : {}),
        })
        if (cancelled) return
        setKernelOffline(!status.running)
        setKernelBinaryFound(status.binaryFound ?? null)
        setKernelInstallUrl(status.installUrl ?? null)
        if (connections.length === 0) setNoConnections(true)
      } catch {
        if (!cancelled) setKernelOffline(true)
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const handleStartKernel = useCallback(async () => {
    const start = window.electronAPI?.knowledge?.engineStart
    if (typeof start !== 'function') {
      toast.error(t('knowledge.kernel.startFailed', { message: 'unavailable' }))
      return
    }
    setStartingKernel(true)
    try {
      const result = await start(workspaceId ? { workspaceId } : undefined)
      if (!result.ok && result.error === 'siyuan-not-installed') {
        setKernelBinaryFound(false)
        toast.error(t('knowledge.kernel.binaryMissing'))
        return
      }
      if (!result.ok) {
        toast.error(t('knowledge.kernel.startFailed', { message: result.error ?? 'unknown' }))
        return
      }
      toast.success(t('knowledge.kernel.startOk'))
      setNoConnections(false)
      // Re-probe after a short delay (kernel boot is async)
      window.setTimeout(() => {
        void window.electronAPI?.knowledge
          ?.engineStatus?.({
            ...(workspaceId ? { workspaceId } : {}),
            ...(result.connectionId ? { connectionId: result.connectionId } : {}),
          })
          .then((status) => {
            setKernelOffline(!status.running)
            setKernelBinaryFound(status.binaryFound ?? null)
          })
          .catch(() => {})
      }, 1500)
    } catch (error) {
      toast.error(t('knowledge.kernel.startFailed', {
        message: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setStartingKernel(false)
    }
  }, [workspaceId, t])

  // Deep-link / atom-driven view selection → run viewRun.
  useEffect(() => {
    if (!activeViewId) {
      if (view === 'view') {
        setView('search')
        setViewHits([])
        setActiveView(null)
        setViewStatus('idle')
      }
      return
    }
    let cancelled = false
    const run = async () => {
      setView('view')
      setViewStatus('loading')
      const api = resolveKnowledgeViewsApi()
      try {
        const result = await runKnowledgeView(api, activeViewId, workspaceId ?? undefined)
        if (cancelled) return
        if (!result) {
          setNoConnections(true)
          setViewHits([])
          setActiveView(selectKnowledgeView(savedViews, activeViewId))
          setViewConnectionId(null)
          setViewStatus('done')
          return
        }
        setNoConnections(false)
        setViewHits(result.items)
        setActiveView(result.view)
        setViewConnectionId(result.connectionId)
        setViewStatus('done')
      } catch {
        if (!cancelled) setViewStatus('error')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // savedViews intentionally omitted — selection by id; name backfill is best-effort
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeViewId, workspaceId, setView])

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (!trimmed) {
        setStatus('idle')
        setHits([])
        setNoConnections(false)
        return
      }
      if (!workspaceId) return
      const api = resolveKnowledgeApi()
      setStatus('loading')
      try {
        const items = await searchKnowledge(api, workspaceId, trimmed)
        if (items === null) {
          setNoConnections(true)
          setHits([])
        } else {
          setNoConnections(false)
          setHits(items)
        }
        setStatus('done')
      } catch {
        setStatus('error')
      }
    },
    [workspaceId],
  )

  useEffect(() => {
    if (query.trim().length < 2) return
    const timer = setTimeout(() => void runSearch(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, runSearch])

  const openHit = useCallback(
    (hit: SearchHit) => navigate(searchHitRoute(hit)),
    [navigate],
  )

  const openSavedView = useCallback(
    (viewId: string) => {
      setActiveViewId(viewId)
      setView('view')
      navigate(knowledgeViewRoute(viewId))
    },
    [navigate, setActiveViewId, setView],
  )

  const backToSearch = useCallback(() => {
    setActiveViewId(null)
    setView('search')
    setViewHits([])
    setActiveView(null)
    setViewStatus('idle')
    navigate(routes.view.knowledge())
  }, [navigate, setActiveViewId, setView])

  const handleMigrateNotes = useCallback(async () => {
    if (migrating) return
    if (!workspaceId) {
      toast.error(t('knowledge.migrate.noWorkspace'))
      return
    }
    const api = window.electronAPI?.knowledge
    if (!api?.migrateNotes || !window.electronAPI?.openFolderDialog) {
      toast.error(t('knowledge.migrate.failed'))
      return
    }

    let sourceRoot: string | null
    try {
      sourceRoot = await window.electronAPI.openFolderDialog()
    } catch {
      toast.error(t('knowledge.migrate.failed'))
      return
    }
    if (!sourceRoot) return

    setMigrating(true)
    const progressToast = toast.loading(t('knowledge.migrate.progress'))
    try {
      const result = await api.migrateNotes({
        workspaceId,
        sourceRoot,
        format: 'craft-markdown',
      })
      const failedCount = result.failed?.length ?? 0
      if (failedCount > 0 && result.migrated === 0) {
        toast.error(t('knowledge.migrate.failed'), {
          id: progressToast,
          description: result.failed[0]?.error,
        })
        return
      }
      const message =
        failedCount > 0
          ? t('knowledge.migrate.partial', {
              migrated: result.migrated,
              failed: failedCount,
            })
          : t('knowledge.migrate.success', {
              migrated: result.migrated,
              skipped: result.skipped,
            })
      toast.success(message, { id: progressToast })
    } catch (error) {
      toast.error(t('knowledge.migrate.failed'), {
        id: progressToast,
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setMigrating(false)
    }
  }, [migrating, workspaceId, t])


  const handleSetAttribute = useCallback(
    async (hit: SearchHit) => {
      const action = firstSetAttributeAction(activeView)
      if (!action || !viewConnectionId) return
      const api = resolveKnowledgeViewsApi()
      const busyKey = `${hit.ref.kind}:${hit.ref.id}`
      setSetAttrBusy(busyKey)
      try {
        const result = await setViewAttribute(api, {
          connectionId: viewConnectionId,
          ref: hit.ref,
          name: action.name,
          value: action.value,
        })
        if (!result?.proposalId) {
          toast.error(t('knowledge.surface.error'))
          return
        }
        toast.success(t('knowledge.views.attributeProposed', {
          name: action.name,
          value: action.value,
        }), {
          action: {
            label: t('knowledge.views.openProposal'),
            onClick: () => navigate(routes.view.proposal(result.proposalId)),
          },
        })
        navigate(routes.view.proposal(result.proposalId))
      } catch (error) {
        toast.error(t('knowledge.surface.error'), {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setSetAttrBusy(null)
      }
    },
    [activeView, viewConnectionId, navigate, t],
  )

  const setAttrAction = firstSetAttributeAction(activeView)
  const viewGroups = useMemo(
    () => groupViewHits(viewHits, activeView?.groupBy),
    [viewHits, activeView?.groupBy],
  )

  const emptyState =
    status === 'idle' && (noConnections || kernelOffline) ? (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <p className="text-[13px] font-medium text-foreground">
          {t('knowledge.kernel.offlineTitle')}
        </p>
        <p className="max-w-sm text-[12px] leading-snug text-muted-foreground">
          {kernelBinaryFound === false
            ? t('knowledge.kernel.installHint')
            : t('knowledge.kernel.offlineBody')}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {kernelBinaryFound === false ? (
            <button
              type="button"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
              onClick={() =>
                void window.electronAPI?.openUrl?.(
                  kernelInstallUrl ?? 'https://b3log.org/siyuan/',
                )
              }
            >
              {t('knowledge.kernel.installCta')}
            </button>
          ) : (
            <button
              type="button"
              disabled={startingKernel}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
              onClick={() => void handleStartKernel()}
            >
              {startingKernel ? t('knowledge.kernel.starting') : t('knowledge.kernel.startCta')}
            </button>
          )}
        </div>
      </div>
    ) : status === 'idle' ? (
      <HomeHint text={t('knowledge.search.placeholder')} />
    ) : noConnections ? (
      <HomeHint text={t('knowledge.home.noConnections')} />
    ) : (
      <HomeHint text={t('knowledge.home.noResults')} />
    )

  const proposalsEntry = (
    <div className="px-3 pb-2">
      <button
        type="button"
        onClick={() => setView(view === 'proposals' ? 'search' : 'proposals')}
        aria-pressed={view === 'proposals'}
        className={cn(
          'flex w-full items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-left',
          'hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          view === 'proposals' && 'ring-1 ring-ring',
        )}
      >
        <FileDiff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/80">
          {t('knowledge.proposals.title')}
        </span>
        {actionableProposalCount > 0 && (
          <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {t('knowledge.proposals.count', { count: actionableProposalCount })}
          </span>
        )}
      </button>
    </div>
  )

  if (view === 'proposals') {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border pt-3">{proposalsEntry}</div>
        <KnowledgeProposals className="min-h-0 flex-1" />
      </div>
    )
  }

  if (view === 'view' && activeViewId) {
    const title =
      activeView?.name ||
      selectKnowledgeView(savedViews, activeViewId)?.name ||
      activeViewId

    return (
      <div className="flex h-full flex-col">
        <div className="sticky top-0 z-10 border-b border-border bg-background px-3 pb-2 pt-3">
          <button
            type="button"
            onClick={backToSearch}
            className={cn(
              'mb-2 flex items-center gap-1 rounded-md px-1 py-0.5 text-[12px] text-muted-foreground',
              'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            )}
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            {t('knowledge.views.back')}
          </button>
          <div className="flex items-center gap-2 px-1">
            <Bookmark className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-foreground">{title}</div>
              {activeView?.description && (
                <div className="truncate text-[11px] text-muted-foreground">
                  {activeView.description}
                </div>
              )}
            </div>
            {viewStatus === 'done' && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {t('knowledge.views.resultCount', { count: viewHits.length })}
              </span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {viewStatus === 'loading' && (
            <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              {t('knowledge.surface.loading')}
            </p>
          )}
          {viewStatus === 'error' && (
            <p className="px-3 py-6 text-center text-[12px] text-destructive">
              {t('knowledge.surface.error')}
            </p>
          )}
          {viewStatus === 'done' && noConnections && (
            <HomeHint text={t('knowledge.home.noConnections')} />
          )}
          {viewStatus === 'done' && !noConnections && viewHits.length === 0 && (
            <HomeHint text={t('knowledge.views.empty')} />
          )}
          {viewStatus === 'done' &&
            !noConnections &&
            viewGroups.map((group) => (
              <div key={group.key || '__all'}>
                {group.key ? (
                  <div className="sticky top-0 z-[1] bg-background/95 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
                    {group.key === 'ungrouped'
                      ? t('knowledge.views.ungrouped')
                      : group.key}
                  </div>
                ) : null}
                {group.items.map((hit) => {
                  const rowKey = `${hit.ref.kind}:${hit.ref.id}`
                  const busy = setAttrBusy === rowKey
                  return (
                    <div
                      key={rowKey}
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-2',
                        'hover:bg-accent/60',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => openHit(hit)}
                        className={cn(
                          'min-w-0 flex-1 flex flex-col gap-0.5 text-left',
                          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm',
                        )}
                      >
                        <span className="truncate text-[13px] font-medium text-foreground">
                          {hit.title || hit.ref.id}
                        </span>
                        <span className="truncate text-[12px] text-muted-foreground">
                          {hit.snippet || hit.notebookPath}
                        </span>
                      </button>
                      {setAttrAction && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSetAttribute(hit)}
                          title={t('knowledge.views.markApproved')}
                          className={cn(
                            'mt-0.5 shrink-0 inline-flex items-center gap-1 rounded-md border border-border',
                            'bg-background px-2 py-1 text-[11px] font-medium text-foreground/80',
                            'hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                            'disabled:opacity-50',
                          )}
                        >
                          <Check className="size-3" aria-hidden />
                          {t('knowledge.views.markApproved')}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground flex items-center justify-between gap-2">
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            disabled={migrating}
            onClick={() => void handleMigrateNotes()}
          >
            {migrating ? t('knowledge.migrate.progress') : t('knowledge.migrate.button')}
          </button>
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => navigate(routes.view.notes())}
          >
            {t('sidebar.notes')}
          </button>
        </div>
      </div>

      <EntityList<SearchHit>
        className="flex-1"
        header={
          <>
            <form
              className="sticky top-0 z-10 bg-background px-3 pb-2 pt-3"
              onSubmit={(e) => {
                e.preventDefault()
                void runSearch(query)
              }}
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('knowledge.search.placeholder')}
                  aria-label={t('knowledge.search.placeholder')}
                  className={cn(
                    'w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-[13px]',
                    'placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  )}
                />
              </div>
            </form>
            {proposalsEntry}
          </>
        }
        items={status === 'done' ? hits : []}
        getKey={(hit) => `${hit.ref.kind}:${hit.ref.id}`}
        emptyState={
          status === 'loading' ? (
            <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              {t('knowledge.surface.loading')}
            </p>
          ) : status === 'error' ? (
            <p className="px-3 py-6 text-center text-[12px] text-destructive">
              {t('knowledge.surface.error')}
            </p>
          ) : (
            emptyState
          )
        }
        renderItem={(hit) => (
          <button
            type="button"
            key={`${hit.ref.kind}:${hit.ref.id}`}
            onClick={() => openHit(hit)}
            className={cn(
              'flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left',
              'hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            )}
          >
            <span className="truncate text-[13px] font-medium text-foreground">
              {hit.title || hit.ref.id}
            </span>
            <span className="truncate text-[12px] text-muted-foreground">{hit.snippet}</span>
          </button>
        )}
      />

      {/* Saved knowledge views (P5) */}
      <div className="border-t border-border px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
          <Bookmark className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('knowledge.nav.savedViews')}
          </span>
        </div>
        {!viewsLoaded ? (
          <div className="px-0.5 py-1 text-[11px] text-muted-foreground">
            {t('knowledge.surface.loading')}
          </div>
        ) : savedViews.length === 0 ? (
          <div className="rounded-md bg-muted/40 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
            {t('knowledge.views.none')}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {savedViews.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => openSavedView(v.id)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left',
                    'hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    activeViewId === v.id && 'bg-muted ring-1 ring-ring',
                  )}
                >
                  <span className="truncate text-[12px] font-medium text-foreground/90">
                    {v.name}
                  </span>
                  {v.description ? (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {v.description}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function HomeHint({ text }: { text: string }) {
  return (
    <p className="px-3 py-6 text-center text-[12px] leading-snug text-muted-foreground">{text}</p>
  )
}
