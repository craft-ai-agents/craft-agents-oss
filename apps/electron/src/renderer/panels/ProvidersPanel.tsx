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
} from 'lucide-react'
import type { LlmConnectionWithStatus, LlmProviderType } from '@craft-agent/shared/config'
import './ProvidersPanel.css'

export type ProvidersPanelProps = {
  onAddProvider?: () => void
  onEditProvider?: (slug: string) => void
}

/** Human-readable label per provider type */
function providerLabel(type: LlmProviderType): string {
  switch (type) {
    case 'anthropic':       return 'Anthropic (Claude)'
    case 'pi':              return 'Pi SDK'
    case 'pi_compat':       return 'OpenAI-compatible'
    case 'openai':          return 'OpenAI'
    case 'vertex':          return 'Vertex AI'
    case 'bedrock':         return 'Bedrock'
    default:                return String(type)
  }
}

/** Semantic grouping for the provider card header icon color */
function providerCategory(type: LlmProviderType): 'cloud' | 'local' | 'other' {
  if (type === 'pi_compat' || type === 'openai-compat') return 'local'
  if (type === 'anthropic' || type === 'openai' || type === 'pi' || type === 'vertex' || type === 'bedrock') return 'cloud'
  return 'other'
}

/** Format a list of model IDs into a compact display string */
function formatModels(models?: Array<string | { id: string }>): string {
  if (!models || models.length === 0) return '—'
  if (models.length <= 3) return models.map(m => (typeof m === 'string' ? m : m.id)).join(', ')
  return `${models.length} models`
}

export function ProvidersPanel({
  onAddProvider,
  onEditProvider,
}: ProvidersPanelProps) {
  const [providers, setProviders] = useState<LlmConnectionWithStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchProviders = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true)
    }
    setError(null)
    try {
      const conns = await window.electronAPI.listLlmConnectionsWithStatus()
      setProviders(conns)
    } catch (e) {
      if (!opts?.silent) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (!opts?.silent) {
        setLoading(false)
      }
    }
  }, [])

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

  const handleTest = useCallback(async (slug: string) => {
    setTesting(slug)
    try {
      await window.electronAPI.testLlmConnection(slug)
      // Re-fetch to update status
      await fetchProviders()
    } catch {
      await fetchProviders()
    } finally {
      setTesting(null)
    }
  }, [fetchProviders])

  const handleDelete = useCallback(async (slug: string) => {
    await window.electronAPI.deleteLlmConnection(slug)
    await fetchProviders()
  }, [fetchProviders])

  const handleSetDefault = useCallback(async (slug: string) => {
    await window.electronAPI.setDefaultLlmConnection(slug)
    await fetchProviders()
  }, [fetchProviders])

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
          ) : (
            providers.map((provider) => (
              <div
                key={provider.slug}
                className={`providers-panel__card ${provider.isDefault ? 'providers-panel__card--default' : ''}`}
              >
                {/* Card header */}
                <div className="providers-panel__card-header">
                  <div className="providers-panel__card-info">
                    <div className="providers-panel__card-name">
                      <span
                        className={`providers-panel__status-dot providers-panel__status-dot--${providerCategory(provider.providerType)} ${provider.isAuthenticated ? 'providers-panel__status-dot--ok' : 'providers-panel__status-dot--err'}`}
                      />
                      <h3>{provider.name}</h3>
                      {provider.isDefault && (
                        <span className="providers-panel__default-badge" title="Default provider">
                          <Star size={12} />
                          Default
                        </span>
                      )}
                    </div>
                    <span className="providers-panel__card-type">
                      {providerLabel(provider.providerType)}
                      {provider.piAuthProvider && ` · ${provider.piAuthProvider}`}
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
                  {provider.lastUsedAt && (
                    <span className="providers-panel__last-used">
                      Last used {new Date(provider.lastUsedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
