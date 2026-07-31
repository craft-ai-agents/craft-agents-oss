import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Brain, Search, Plus, Download, Filter, Network, FileText, Tag, Calendar, Link2, MoreHorizontal, Loader2, BarChart3, Database, RefreshCw } from 'lucide-react'
import type { AnyMemory, MemoryEdge, MemoryQuery, MemorySearchResult } from '@craft-agent/shared/memory/types'
import { MemoryGraph } from './MemoryGraph'
import './MemoryPanel.css'

export type MemoryPanelProps = {
  memories?: AnyMemory[]
  onSelectMemory?: (memory: AnyMemory) => void
  onAddMemory?: () => void
  selectedMemoryId?: string
}

const CLASS_VALUES = new Set(['profile', 'semantic', 'episodic', 'procedural'])
const SCOPE_VALUES = new Set(['session', 'project', 'workspace', 'agent', 'global'])

/**
 * Map the panel's flat `<select>` choice into a (class|scope) filter that
 * the server can apply in SQL. Returns `{}` (= no filter) for `all` and any
 * unknown values — keeps the dropdown simple without forcing two dropdowns.
 */
function buildFilter(kind: string): Pick<MemoryQuery, 'class' | 'scope'> {
  if (kind === 'all' || !kind) return {}
  if (CLASS_VALUES.has(kind)) return { class: kind as AnyMemory['class'] }
  if (SCOPE_VALUES.has(kind)) return { scope: kind as AnyMemory['scope'] }
  return {}
}

const DEBOUNCE_MS = 200

type ImportStats = {
  read: number
  imported: number
  skipped: number
  errors: Array<{ message: string; filePath?: string }>
}

export function MemoryPanel({
  memories: externalMemories,
  onSelectMemory,
  onAddMemory,
  selectedMemoryId: controlledSelectedId,
}: MemoryPanelProps) {
  const [results, setResults] = useState<MemorySearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list')
  const [selectedId, setSelectedId] = useState<string | undefined>(controlledSelectedId)

  const selectedIdFinal = controlledSelectedId ?? selectedId

  // Graph view needs the unfiltered list (it draws relationships). We keep
  // that fetched separately so a search query doesn't blow away the graph.
  const [graphMemories, setGraphMemories] = useState<AnyMemory[]>([])
  const [graphEdges, setGraphEdges] = useState<MemoryEdge[]>([])
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphError, setGraphError] = useState<string | null>(null)

  // Import-from-vault state. `importing` is the in-flight flag so the
  // button can't be double-pressed; `importStats` is null when there's no
  // toast to show, otherwise the stats object the toast renders. The
  // stats object also gets re-set when handleImport runs so a single
  // import overwrites the previous toast instantly without flicker.
  const [importing, setImporting] = useState(false)
  const [importStats, setImportStats] = useState<ImportStats | null>(null)

  // Stats dashboard state
  const [showStats, setShowStats] = useState(false)
  const [stats, setStats] = useState<{
    classDistribution: Record<string, number>
    totalActive: number
    totalArchived: number
    ftsHealth: { memoriesRows: number; ftsRows: number; healthy: boolean }
    vault: { root: string; filesOnDisk: number; lastImportAt: string | null }
    graph: { edgeCount: number; edgeTypeDistribution: Record<string, number> }
  } | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState<string | null>(null)

  // Phase 3: Vault configuration state
  const [vaultInfo, setVaultInfo] = useState<{ path: string; isCustom: boolean; exists: boolean } | null>(null)
  const [showVaultSettings, setShowVaultSettings] = useState(false)
  const [vaultPathInput, setVaultPathInput] = useState('')
  const [vaultSetting, setVaultSetting] = useState(false)
  // Phase 4: Sync state
  const [syncing, setSyncing] = useState(false)
  const [watcherActive, setWatcherActive] = useState(false)

  // Phase 6: Edge management state
  const [selectedEdges, setSelectedEdges] = useState<MemoryEdge[]>([])
  const [edgesLoading, setEdgesLoading] = useState(false)
  const [showEdgePicker, setShowEdgePicker] = useState(false)
  const [edgeTargetId, setEdgeTargetId] = useState('')
  const [edgeType, setEdgeType] = useState('related-to')
  // Refresh trigger to force graph reload after edge changes
  const [edgeRefreshKey, setEdgeRefreshKey] = useState(0)

  // Auto-dismiss the import toast after 6 s. The ref keeps the timeout
  // handle around so the previous timer cancels cleanly when a new
  // import fires before the prior one expires.
  const importTimerRef = useRef<number | null>(null)

  // Hard reset on external prop change (e.g. parent provides a new dataset
  // for testing/playgrounds). Mirrors the layout in panel of MediaLabPanel.
  useEffect(() => {
    if (!externalMemories) return
    setResults(externalMemories.map((m) => ({ memory: m, score: 0 })))
    setGraphMemories(externalMemories)
    setGraphEdges([])
    setLoading(false)
    setError(null)
  }, [externalMemories])

  // Graph: lazy-load the full memory list when the user clicks the Graph
  // button. Cached after first fetch, but re-fetches when edgeRefreshKey
  // changes (Phase 6: edge CRUD should refresh the graph).
  useEffect(() => {
    if (externalMemories) return
    if (viewMode !== 'graph') return
    if (graphMemories.length > 0 || graphEdges.length > 0) return
    let cancelled = false
    setGraphLoading(true)
    setGraphError(null)
    window.electronAPI
      .getMemoryGraph()
      .then((graph) => {
        if (cancelled) return
        setGraphMemories(graph.memories)
        setGraphEdges(graph.edges)
        setGraphLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setGraphError(e?.message ?? 'Failed to load graph memories')
        setGraphLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [viewMode, graphEdges.length, graphMemories.length, externalMemories, edgeRefreshKey])

  // Boot: initial full list. Skip the first debounced effect run so we don't
  // double-fetch.
  const skipNextSearchFetchRef = useRef(false)
  useEffect(() => {
    if (externalMemories) return
    let cancelled = false
    setLoading(true)
    setError(null)
    skipNextSearchFetchRef.current = true
    window.electronAPI
      .listMemories()
      .then((m) => {
        if (cancelled) return
        const hydrated = m.map((mem) => ({ memory: mem, score: 0 }))
        setResults(hydrated)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.message ?? 'Failed to load memories')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [externalMemories])

  // Debounced FTS5 search. Fires after DEBOUNCE_MS; latest call wins.
  // Triggers off (search, filter). Empty `search` short-circuits to a
  // searchMemories() call (server returns MemorySearchResult[] ranked by
  // recency), so the filter dropdown still affects the result set when
  // the search box is empty.
  useEffect(() => {
    if (externalMemories) return
    if (skipNextSearchFetchRef.current) {
      skipNextSearchFetchRef.current = false
      return
    }
    const handle = setTimeout(() => {
      let cancelled = false
      setLoading(true)
      setError(null)
      const trimmed = search.trim()
      // Single code path: `searchMemories` handles both modes.
      // Empty `query.query` runs a SQL-only filtered list (no FTS cost);
      // non-empty runs FTS5 + bm25 + snippet.
      const filt = buildFilter(filter)
      const query: MemoryQuery = { ...filt, limit: 50 }
      if (trimmed) query.query = trimmed
      window.electronAPI.searchMemories(query)
        .then((hits) => {
          if (cancelled) return
          setResults(hits)
          setLoading(false)
        })
        .catch((e) => {
          if (cancelled) return
          setError(e?.message ?? 'Failed to search memories')
          setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [search, filter, externalMemories])

  const handleAdd = useCallback(() => {
    onAddMemory?.()
  }, [onAddMemory])

  // Fetch stats when toggling the stats panel open
  const handleToggleStats = useCallback(async () => {
    if (showStats) {
      setShowStats(false)
      return
    }
    setShowStats(true)
    if (!stats) {
      setStatsLoading(true)
      setStatsError(null)
      try {
        const s = await window.electronAPI.getMemoryStats()
        setStats(s)
      } catch (error) {
        setStatsError(error instanceof Error ? error.message : String(error))
      } finally {
        setStatsLoading(false)
      }
    }
    handleCheckWatcherStatus()
  }, [showStats, stats])

  const handleRefreshStats = useCallback(async () => {
    setStatsLoading(true)
    setStatsError(null)
    try {
      const s = await window.electronAPI.getMemoryStats()
      setStats(s)
    } catch (error) {
      setStatsError(error instanceof Error ? error.message : String(error))
    } finally {
      setStatsLoading(false)
    }
  }, [])

  // Phase 3: Vault configuration handlers
  const handleLoadVaultInfo = useCallback(async () => {
    try {
      const info = await window.electronAPI.getVaultInfo()
      setVaultInfo(info)
      setVaultPathInput(info.path)
    } catch (error) {
      console.error('Failed to load vault info:', error)
    }
  }, [])

  const handleSetVaultPath = useCallback(async () => {
    if (!vaultPathInput.trim()) return
    setVaultSetting(true)
    try {
      const result = await window.electronAPI.setVaultPath(vaultPathInput.trim())
      setVaultInfo({ path: result.path, isCustom: true, exists: true })
      setShowVaultSettings(false)
      // Refresh stats to show new vault
      handleRefreshStats()
    } catch (error) {
      console.error('Failed to set vault path:', error)
    } finally {
      setVaultSetting(false)
    }
  }, [vaultPathInput, handleRefreshStats])

  const handleOpenVault = useCallback(async () => {
    try {
      await window.electronAPI.openVaultFolder()
    } catch (error) {
      console.error('Failed to open vault folder:', error)
    }
  }, [])

  // Phase 4: Full sync handler
  const handleSyncVault = useCallback(async () => {
    setSyncing(true)
    try {
      await window.electronAPI.syncVault()
      // Refresh stats after sync
      handleRefreshStats()
    } catch (error) {
      console.error('Failed to sync vault:', error)
    } finally {
      setSyncing(false)
    }
  }, [handleRefreshStats])

  // Phase 4: Check watcher status when stats panel opens
  const handleCheckWatcherStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.getVaultWatcherStatus()
      setWatcherActive(status.active)
    } catch {
      setWatcherActive(false)
    }
  }, [])

  // Phase 6: Edge management handlers
  const handleLoadEdges = useCallback(async (memoryId: string) => {
    setEdgesLoading(true)
    try {
      const edges = await window.electronAPI.getMemoryEdges(memoryId)
      setSelectedEdges(edges)
    } catch (error) {
      console.error('Failed to load edges:', error)
      setSelectedEdges([])
    } finally {
      setEdgesLoading(false)
    }
  }, [])

  const handleCreateEdge = useCallback(async (sourceId: string, targetId: string) => {
    try {
      await window.electronAPI.createMemoryEdge(sourceId, targetId, 'related-to', 1)
      // Refresh edges for the selected memory
      if (selectedIdFinal) await handleLoadEdges(selectedIdFinal)
      // Trigger graph refresh
      setGraphMemories([])
      setGraphEdges([])
      setEdgeRefreshKey(k => k + 1)
    } catch (error) {
      console.error('Failed to create edge:', error)
    }
  }, [selectedIdFinal, handleLoadEdges])

  const handleDeleteEdge = useCallback(async (edgeId: string) => {
    try {
      await window.electronAPI.deleteMemoryEdge(edgeId)
      if (selectedIdFinal) await handleLoadEdges(selectedIdFinal)
      setGraphMemories([])
      setGraphEdges([])
      setEdgeRefreshKey(k => k + 1)
    } catch (error) {
      console.error('Failed to delete edge:', error)
    }
  }, [selectedIdFinal, handleLoadEdges])

  const handleAddEdge = useCallback(async () => {
    if (!selectedIdFinal || !edgeTargetId || edgeTargetId === selectedIdFinal) return
    try {
      await window.electronAPI.createMemoryEdge(selectedIdFinal, edgeTargetId, edgeType, 1)
      await handleLoadEdges(selectedIdFinal)
      setShowEdgePicker(false)
      setEdgeTargetId('')
      setGraphMemories([])
      setGraphEdges([])
      setEdgeRefreshKey(k => k + 1)
    } catch (error) {
      console.error('Failed to create edge:', error)
    }
  }, [selectedIdFinal, edgeTargetId, edgeType, handleLoadEdges])

  // Phase 6: Load edges for the selected memory when selection changes.
  useEffect(() => {
    if (!selectedIdFinal) {
      setSelectedEdges([])
      return
    }
    handleLoadEdges(selectedIdFinal)
  }, [selectedIdFinal, handleLoadEdges])

  /**
   * Fire the bulk-import RPC, surface the result in a toast, and refresh the
   * on-screen dataset if any new memories made it through. Stats auto-dismiss
   * after 6 s; a second import within that window cancels the prior timer
   * and refreshes the toast with the freshest numbers so the user doesn't
   * see stale data flickering on top of new data.
   */
  const handleImport = useCallback(async () => {
    if (importing) return
    setImporting(true)
    setImportStats(null)
    try {
      const stats = await window.electronAPI.importMemoriesFromVault()
      setImportStats(stats)
      // Refresh only if something was actually imported — otherwise the
      // dataset is already correct and we save a round-trip.
      if (stats.imported > 0 || stats.skipped > 0) {
        const trimmed = search.trim()
        const filt = buildFilter(filter)
        const query: MemoryQuery = { ...filt, limit: 50 }
        if (trimmed) query.query = trimmed
        try {
          const hits = await window.electronAPI.searchMemories(query)
          setResults(hits)
        } catch {
          // Fall back to listMemories if the search RPC throws after import.
          const m = await window.electronAPI.listMemories()
          setResults(m.map((mem) => ({ memory: mem, score: 0 })))
        }
      }
    } catch (e) {
      setImportStats({
        read: 0,
        imported: 0,
        skipped: 0,
        errors: [{ message: e instanceof Error ? e.message : String(e) }],
      })
    } finally {
      setImporting(false)
    }
    if (importTimerRef.current !== null) {
      window.clearTimeout(importTimerRef.current)
    }
    importTimerRef.current = window.setTimeout(() => {
      setImportStats(null)
      importTimerRef.current = null
    }, 6000)
  }, [importing, search, filter])

  const selected = results.find((r) => r.memory.id === selectedIdFinal)?.memory
    ?? graphMemories.find((m) => m.id === selectedIdFinal)

  return (
    <div className="memory-panel">
      <div className="memory-panel__sidebar">
        <div className="memory-panel__header">
          <div className="memory-panel__title">
            <Brain size={20} />
            <h2>Memory</h2>
          </div>
          <button
            type="button"
            className="memory-panel__add"
            onClick={handleAdd}
            title="Add memory"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="memory-panel__add"
            onClick={handleImport}
            disabled={importing}
            title={importing ? 'Importing from vault…' : 'Import from Obsidian vault'}
            data-testid="memory-panel-import-btn"
            style={{ marginLeft: 6 }}
          >
            {importing ? <Loader2 size={16} className="memory-panel__spinner" /> : <Download size={16} />}
          </button>
          <button
            type="button"
            className={`memory-panel__add ${showStats ? 'memory-panel__add--active' : ''}`}
            onClick={handleToggleStats}
            title="Memory stats dashboard"
            style={{ marginLeft: 4 }}
          >
            <BarChart3 size={16} />
          </button>
        </div>

        {showStats && (
          <div className="memory-panel__stats" data-testid="memory-panel-stats">
            {statsLoading ? (
              <div className="memory-panel__stats-loading">
                <Loader2 size={14} className="memory-panel__spinner" />
                <span>Loading stats…</span>
              </div>
            ) : statsError ? (
              <div className="memory-panel__stats-loading memory-panel__error">
                <span>Failed to load stats: {statsError}</span>
                <button type="button" onClick={handleRefreshStats}>Retry</button>
              </div>
            ) : stats ? (
              <>
                <div className="memory-panel__stats-header">
                  <h3 className="memory-panel__stats-title">Memory Stats</h3>
                  <button
                    type="button"
                    className="memory-panel__stats-refresh"
                    onClick={handleRefreshStats}
                    title="Refresh stats"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>

                {/* Class distribution */}
                <div className="memory-panel__stats-section">
                  <div className="memory-panel__stats-section-title">
                    <Database size={12} />
                    <span>Class Distribution</span>
                  </div>
                  <div className="memory-panel__stats-grid">
                    {['profile', 'semantic', 'episodic', 'procedural'].map((cls) => {
                      const count = stats.classDistribution[cls] ?? 0
                      const maxCount = Math.max(...Object.values(stats.classDistribution), 1)
                      const barPct = maxCount > 0 ? (count / maxCount) * 100 : 0
                      return (
                        <div key={cls} className="memory-panel__stats-bar-row">
                          <span className="memory-panel__stats-bar-label">{cls}</span>
                          <div className="memory-panel__stats-bar-track">
                            <div
                              className="memory-panel__stats-bar-fill"
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                          <span className="memory-panel__stats-bar-value">{count}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="memory-panel__stats-total">
                    <span>{stats.totalActive} active</span>
                    <span className="memory-panel__stats-sep">·</span>
                    <span>{stats.totalArchived} archived</span>
                  </div>
                </div>

                {/* FTS index health */}
                <div className="memory-panel__stats-section">
                  <div className="memory-panel__stats-section-title">
                    <FileText size={12} />
                    <span>FTS Index Health</span>
                  </div>
                  <div className="memory-panel__stats-fields">
                    <div className="memory-panel__stats-field">
                      <span className="memory-panel__stats-field-label">Memories rows</span>
                      <span className="memory-panel__stats-field-value">{stats.ftsHealth.memoriesRows}</span>
                    </div>
                    <div className="memory-panel__stats-field">
                      <span className="memory-panel__stats-field-label">FTS index rows</span>
                      <span className="memory-panel__stats-field-value">{stats.ftsHealth.ftsRows}</span>
                    </div>
                    <div className={`memory-panel__stats-health-badge ${stats.ftsHealth.healthy ? 'memory-panel__stats-health--ok' : 'memory-panel__stats-health--warn'}`}>
                      {stats.ftsHealth.healthy ? 'Healthy' : 'Mismatch'}
                    </div>
                  </div>
                </div>

                {/* Graph status */}
                <div className="memory-panel__stats-section">
                  <div className="memory-panel__stats-section-title">
                    <Network size={12} />
                    <span>Graph</span>
                  </div>
                  <div className="memory-panel__stats-fields">
                    <div className="memory-panel__stats-field">
                      <span className="memory-panel__stats-field-label">Persisted edges</span>
                      <span className="memory-panel__stats-field-value">{stats.graph.edgeCount}</span>
                    </div>
                    {Object.entries(stats.graph.edgeTypeDistribution).slice(0, 4).map(([type, count]) => (
                      <div key={type} className="memory-panel__stats-field">
                        <span className="memory-panel__stats-field-label">{type}</span>
                        <span className="memory-panel__stats-field-value">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Vault sync status */}
                <div className="memory-panel__stats-section">
                  <div className="memory-panel__stats-section-title">
                    <Download size={12} />
                    <span>Vault Sync</span>
                  </div>
                  <div className="memory-panel__stats-fields">
                    <div className="memory-panel__stats-field">
                      <span className="memory-panel__stats-field-label">Vault path</span>
                      <span className="memory-panel__stats-field-value" title={stats.vault.root}>{stats.vault.root}</span>
                    </div>
                    <div className="memory-panel__stats-field">
                      <span className="memory-panel__stats-field-label">Files on disk</span>
                      <span className="memory-panel__stats-field-value">{stats.vault.filesOnDisk}</span>
                    </div>
                    {stats.vault.lastImportAt && (
                      <div className="memory-panel__stats-field">
                        <span className="memory-panel__stats-field-label">Last import</span>
                        <span className="memory-panel__stats-field-value">
                          {new Date(stats.vault.lastImportAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {!stats.vault.lastImportAt && (
                      <div className="memory-panel__stats-field">
                        <span className="memory-panel__stats-field-label">Last import</span>
                        <span className="memory-panel__stats-field-value memory-panel__stats-vault-never">Never</span>
                      </div>
                    )}
                  </div>
                  <div className="memory-panel__vault-actions">
                    <button
                      type="button"
                      className="memory-panel__vault-btn"
                      onClick={() => { handleLoadVaultInfo(); setShowVaultSettings(!showVaultSettings) }}
                      title="Configure vault path"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="memory-panel__vault-btn"
                      onClick={handleOpenVault}
                      title="Open vault in file manager"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="memory-panel__vault-btn"
                      onClick={handleSyncVault}
                      disabled={syncing}
                      title="Full bidirectional sync"
                    >
                      {syncing ? 'Syncing…' : 'Sync now'}
                    </button>
                  </div>
                  <div className="memory-panel__vault-watcher-status">
                    Watcher: {watcherActive ? '● Active' : '○ Inactive'}
                  </div>
                  {showVaultSettings && (
                    <div className="memory-panel__vault-settings">
                      <input
                        type="text"
                        className="memory-panel__vault-input"
                        placeholder="C:\Users\you\Obsidian\MyVault"
                        value={vaultPathInput}
                        onChange={(e) => setVaultPathInput(e.target.value)}
                      />
                      <button
                        type="button"
                        className="memory-panel__vault-btn memory-panel__vault-btn--primary"
                        onClick={handleSetVaultPath}
                        disabled={vaultSetting || !vaultPathInput.trim()}
                      >
                        {vaultSetting ? 'Setting…' : 'Set vault path'}
                      </button>
                      {vaultInfo && (
                        <div className="memory-panel__vault-info">
                          {vaultInfo.isCustom ? 'Custom vault' : 'Default vault'}
                          {' · '}
                          {vaultInfo.exists ? 'exists' : 'not found'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="memory-panel__stats-loading">
                <span>Failed to load stats.</span>
              </div>
            )}
          </div>
        )}

        {importStats && (
          <div
            className="memory-panel__toast"
            role="status"
            aria-live="polite"
            data-testid="memory-panel-import-toast"
          >
            <span className="memory-panel__toast-title">Vault import</span>
            <span className="memory-panel__toast-detail">
              imported <strong>{importStats.imported}</strong> · skipped{' '}
              <strong>{importStats.skipped}</strong> · errors{' '}
              <strong>{importStats.errors.length}</strong> (read {importStats.read})
            </span>
            {importStats.errors.length > 0 && (
              <ul className="memory-panel__toast-errors">
                {importStats.errors.slice(0, 3).map((err, i) => (
                  <li key={`${err.filePath ?? 'unknown'}-${i}`}>
                    {err.filePath ? (
                      <code>{err.filePath.split(/[\\/]/).pop()}</code>
                    ) : null}
                    {' '}
                    {err.message}
                  </li>
                ))}
                {importStats.errors.length > 3 && (
                  <li>…and {importStats.errors.length - 3} more</li>
                )}
              </ul>
            )}
          </div>
        )}

        <div className="memory-panel__search">
          <Search size={14} className="memory-panel__search-icon" />
          <input
            type="text"
            placeholder="Search memories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="memory-panel__filters">
          <Filter size={14} />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="memory-panel__filter-select"
          >
            <option value="all">All</option>
            <option value="semantic">Semantic</option>
            <option value="episodic">Episodic</option>
            <option value="procedural">Procedural</option>
            <option value="profile">Profile</option>
            <option value="session">Session scope</option>
            <option value="project">Project scope</option>
            <option value="workspace">Workspace scope</option>
            <option value="agent">Agent scope</option>
            <option value="global">Global scope</option>
          </select>
        </div>

        <div className="memory-panel__view-toggle">
          <button
            type="button"
            className={`memory-panel__view-btn ${viewMode === 'list' ? 'memory-panel__view-btn--active' : ''}`}
            onClick={() => setViewMode('list')}
            title="List view"
          >
            <FileText size={14} />
          </button>
          <button
            type="button"
            className={`memory-panel__view-btn ${viewMode === 'graph' ? 'memory-panel__view-btn--active' : ''}`}
            onClick={() => setViewMode('graph')}
            title="Graph view"
          >
            <Network size={14} />
          </button>
        </div>

        <div className="memory-panel__list">
          {loading && (
            <div className="memory-panel__empty">
              <Loader2 size={20} className="memory-panel__spinner" />
              <span>Searching…</span>
            </div>
          )}
          {error && !loading && (
            <div className="memory-panel__empty memory-panel__error">{error}</div>
          )}
          {!loading && !error && results.length === 0 && (
            <div className="memory-panel__empty">No memories found.</div>
          )}
          {!loading && !error && results.map((r) => {
            const m = r.memory
            return (
              <button
                key={m.id}
                type="button"
                className={`memory-panel__item ${selectedIdFinal === m.id ? 'memory-panel__item--active' : ''}`}
                onClick={() => {
                  setSelectedId(m.id)
                  onSelectMemory?.(m)
                }}
              >
                <div className="memory-panel__item-header">
                  <span className="memory-panel__item-type">{m.class}</span>
                  {r.isRelated && (
                    <span className="memory-panel__item-related-badge" title={`Related via graph (${r.relatedDepth ?? 1}-hop)`}>
                      Related
                    </span>
                  )}
                  <span className="memory-panel__item-confidence">{Math.round(m.confidence * 100)}%</span>
                </div>
                <div className="memory-panel__item-title">{m.title}</div>
                {r.snippet && (
                  <div
                    className="memory-panel__item-snippet"
                    // FTS5 `snippet()` is server-controlled: harmless
                    // <mark> + matched text + ellipsis. We layer
                    // dangerouslySetInnerHTML on an explicit class so css
                    // can scope the highlight color.
                    dangerouslySetInnerHTML={{ __html: r.snippet }}
                  />
                )}
                <div className="memory-panel__item-meta">
                  <Tag size={10} />
                  <span>{m.tags.slice(0, 3).join(', ')}</span>
                </div>
                <div className="memory-panel__item-date">
                  <Calendar size={10} />
                  <span>{new Date(m.updatedAt).toLocaleDateString()}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="memory-panel__main">
        {viewMode === 'graph' ? (
          <div className="memory-panel__graph">
            {graphLoading ? (
              <div className="memory-panel__placeholder"><Loader2 size={24} className="memory-panel__spinner" /><p>Loading graph…</p></div>
            ) : graphError ? (
              <div className="memory-panel__placeholder memory-panel__error"><p>{graphError}</p></div>
            ) : (
              <MemoryGraph
                memories={graphMemories}
                edges={graphEdges}
                selectedId={selectedIdFinal}
                onSelect={(memory) => {
                  setSelectedId(memory.id)
                  onSelectMemory?.(memory)
                }}
                onCreateEdge={handleCreateEdge}
                onDeleteEdge={handleDeleteEdge}
              />
            )}
          </div>
        ) : selected ? (
          <div className="memory-panel__detail">
            <div className="memory-panel__detail-header">
              <div>
                <h3>{selected.title}</h3>
                <div className="memory-panel__detail-meta">
                  <span className="memory-panel__detail-type">{selected.class}</span>
                  <span className="memory-panel__detail-scope">{selected.scope}</span>
                  <span className="memory-panel__detail-confidence">{Math.round(selected.confidence * 100)}% confidence</span>
                </div>
              </div>
              <button type="button" className="memory-panel__detail-more" title="More actions">
                <MoreHorizontal size={16} />
              </button>
            </div>

            <div className="memory-panel__detail-content">{selected.content}</div>

            <div className="memory-panel__detail-tags">
              {selected.tags.map((tag) => (
                <span key={tag} className="memory-panel__tag">
                  {tag}
                </span>
              ))}
            </div>

            <div className="memory-panel__detail-relationships">
              <div className="memory-panel__detail-relationships-header">
                <Link2 size={14} />
                <span>Relationships</span>
                <button
                  type="button"
                  className="memory-panel__relationship-add-btn"
                  onClick={() => setShowEdgePicker(!showEdgePicker)}
                  title="Add relationship"
                >
                  +
                </button>
              </div>
              {showEdgePicker && (
                <div className="memory-panel__edge-picker">
                  <select
                    className="memory-panel__edge-picker-select"
                    value={edgeTargetId}
                    onChange={(e) => setEdgeTargetId(e.target.value)}
                  >
                    <option value="">Select a memory…</option>
                    {[...results.map(r => r.memory), ...graphMemories]
                      .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
                      .filter(m => m.id !== selected.id)
                      .map(m => (
                        <option key={m.id} value={m.id}>{m.title} ({m.class})</option>
                      ))
                  }
                  </select>
                  <select
                    className="memory-panel__edge-picker-type"
                    value={edgeType}
                    onChange={(e) => setEdgeType(e.target.value)}
                  >
                    <option value="related-to">Related to</option>
                    <option value="depends-on">Depends on</option>
                    <option value="supersedes">Supersedes</option>
                  </select>
                  <button
                    type="button"
                    className="memory-panel__vault-btn memory-panel__vault-btn--primary"
                    onClick={handleAddEdge}
                    disabled={!edgeTargetId}
                  >
                    Add
                  </button>
                </div>
              )}
              {edgesLoading ? (
                <div className="memory-panel__relationships-loading">
                  <Loader2 size={12} className="memory-panel__spinner" />
                  <span>Loading…</span>
                </div>
              ) : selectedEdges.length === 0 ? (
                <div className="memory-panel__relationships-empty">No relationships yet.</div>
              ) : (
                <ul className="memory-panel__relationships-list">
                  {selectedEdges.map((edge) => {
                    const otherId = edge.sourceMemoryId === selected.id ? edge.targetMemoryId : edge.sourceMemoryId
                    const other = [...results.map(r => r.memory), ...graphMemories]
                      .find(m => m.id === otherId)
                    const direction = edge.sourceMemoryId === selected.id ? '→' : '←'
                    return (
                      <li key={edge.id} className="memory-panel__relationship-item">
                        <span className="memory-panel__relationship-type">{edge.type}</span>
                        <span className="memory-panel__relationship-direction">{direction}</span>
                        <span className="memory-panel__relationship-title">{other?.title ?? otherId}</span>
                        {edge.provenance === 'manual' && (
                          <button
                            type="button"
                            className="memory-panel__relationship-delete"
                            onClick={() => handleDeleteEdge(edge.id)}
                            title="Delete relationship"
                          >
                            ×
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="memory-panel__detail-footer">
              <div className="memory-panel__detail-date">
                <Calendar size={14} />
                <span>Updated {new Date(selected.updatedAt).toLocaleString()}</span>
              </div>
              <div className="memory-panel__detail-source">
                <Link2 size={14} />
                <span>{selected.source?.sessionId ? `session ${selected.source.sessionId}` : 'unknown'}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="memory-panel__placeholder">
            <Brain size={48} />
            <p>Select a memory to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}
