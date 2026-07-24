import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { Brain, Search, Plus, Filter, Network, FileText, Tag, Calendar, Link2, MoreHorizontal, Loader2 } from 'lucide-react'
import type { AnyMemory } from '@craft-agent/shared/memory/types'
import { MemoryGraph } from './MemoryGraph'
import './MemoryPanel.css'

export type MemoryPanelProps = {
  memories?: AnyMemory[]
  onSelectMemory?: (memory: AnyMemory) => void
  onAddMemory?: () => void
  selectedMemoryId?: string
}

export function MemoryPanel({
  memories: externalMemories,
  onSelectMemory,
  onAddMemory,
  selectedMemoryId: controlledSelectedId,
}: MemoryPanelProps) {
  const [internalMemories, setInternalMemories] = useState<AnyMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list')
  const [selectedId, setSelectedId] = useState<string | undefined>(controlledSelectedId)

  const memories = externalMemories ?? internalMemories
  const selectedIdFinal = controlledSelectedId ?? selectedId

  useEffect(() => {
    if (externalMemories) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    window.electronAPI
      .listMemories()
      .then((m) => {
        if (cancelled) return
        setInternalMemories(m)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.message ?? 'Failed to load memories')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [externalMemories])

  const handleAdd = useCallback(() => {
    onAddMemory?.()
  }, [onAddMemory])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return memories.filter((m) => {
      const matchesSearch =
        !q ||
        m.title.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      const matchesFilter = filter === 'all' || m.class === filter || m.scope === filter
      return matchesSearch && matchesFilter
    })
  }, [memories, search, filter])

  const selected = memories.find((m) => m.id === selectedIdFinal)

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
        </div>

        <div className="memory-panel__search">
          <Search size={14} className="memory-panel__search-icon" />
          <input
            type="text"
            placeholder="Search memories..."
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
            <option value="user">User scope</option>
            <option value="project">Project scope</option>
            <option value="workspace">Workspace scope</option>
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
              <span>Loading memories...</span>
            </div>
          )}
          {error && !loading && (
            <div className="memory-panel__empty memory-panel__error">{error}</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="memory-panel__empty">No memories found.</div>
          )}
          {!loading && !error && filtered.map((m) => (
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
                <span className="memory-panel__item-confidence">{Math.round(m.confidence * 100)}%</span>
              </div>
              <div className="memory-panel__item-title">{m.title}</div>
              <div className="memory-panel__item-meta">
                <Tag size={10} />
                <span>{m.tags.slice(0, 3).join(', ')}</span>
              </div>
              <div className="memory-panel__item-date">
                <Calendar size={10} />
                <span>{new Date(m.updatedAt).toLocaleDateString()}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="memory-panel__main">
        {viewMode === 'graph' ? (
          <div className="memory-panel__graph">
            <MemoryGraph memories={memories} selectedId={selectedIdFinal} onSelect={onSelectMemory} />
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
