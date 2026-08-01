import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { Search, MessageSquare, Loader2, FileText } from 'lucide-react'
import type { SessionSearchResult } from '@archstudio/shared/protocol/dto'
import { sessionMetaMapAtom, windowWorkspaceIdAtom } from '../../atoms/sessions'
import './SearchPanel.css'

export type SearchPanelProps = {
  onSelectSession?: (sessionId: string) => void
}

const DEBOUNCE_MS = 250
const MIN_QUERY_LENGTH = 2

/** Splits a snippet around the query so matches can be highlighted without dangerouslySetInnerHTML. */
function highlight(snippet: string, query: string): React.ReactNode {
  if (!query) return snippet
  const lower = snippet.toLowerCase()
  const needle = query.toLowerCase()
  const parts: React.ReactNode[] = []
  let cursor = 0
  let idx = lower.indexOf(needle)
  let key = 0
  while (idx !== -1) {
    if (idx > cursor) parts.push(snippet.slice(cursor, idx))
    parts.push(
      <mark key={key++} className="search-panel__mark">
        {snippet.slice(idx, idx + needle.length)}
      </mark>,
    )
    cursor = idx + needle.length
    idx = lower.indexOf(needle, cursor)
  }
  if (cursor < snippet.length) parts.push(snippet.slice(cursor))
  return parts
}

export function SearchPanel({ onSelectSession }: SearchPanelProps) {
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const metaMap = useAtomValue(sessionMetaMapAtom)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SessionSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  /** Guards against out-of-order responses: only the newest search may commit. */
  const searchSeq = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH || !workspaceId) {
      setResults([])
      setIsSearching(false)
      setError(null)
      return
    }

    const seq = ++searchSeq.current
    setIsSearching(true)
    const timer = setTimeout(async () => {
      try {
        const found = await window.electronAPI.searchSessionContent(workspaceId, trimmed, String(seq))
        if (seq !== searchSeq.current) return
        setResults(found)
        setError(null)
      } catch (err) {
        if (seq !== searchSeq.current) return
        setError(err instanceof Error ? err.message : String(err))
        setResults([])
      } finally {
        if (seq === searchSeq.current) setIsSearching(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, workspaceId])

  const totalMatches = useMemo(
    () => results.reduce((sum, r) => sum + r.matchCount, 0),
    [results],
  )

  const toggle = (sessionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const sessionTitle = (sessionId: string) => {
    const meta = metaMap.get(sessionId)
    return meta?.name || meta?.preview || sessionId
  }

  const trimmed = query.trim()
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <div className="search-panel__field">
          <Search size={16} />
          <input
            type="text"
            autoFocus
            placeholder="Search across all sessions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {isSearching && <Loader2 size={15} className="search-panel__spinner" />}
        </div>
        {results.length > 0 && (
          <div className="search-panel__summary">
            {totalMatches} {totalMatches === 1 ? 'match' : 'matches'} in {results.length}{' '}
            {results.length === 1 ? 'session' : 'sessions'}
          </div>
        )}
      </div>

      <div className="search-panel__results">
        {error && <div className="search-panel__error">{error}</div>}

        {!error && trimmed.length === 0 && (
          <div className="search-panel__empty">
            <Search size={48} />
            <p>Search your sessions</p>
            <span>Find any message across every conversation in this workspace</span>
          </div>
        )}

        {!error && tooShort && (
          <div className="search-panel__hint">Type at least {MIN_QUERY_LENGTH} characters</div>
        )}

        {!error && !isSearching && trimmed.length >= MIN_QUERY_LENGTH && results.length === 0 && (
          <div className="search-panel__empty">
            <FileText size={48} />
            <p>No matches for “{trimmed}”</p>
          </div>
        )}

        {results.map((result) => {
          const isOpen = expanded.has(result.sessionId)
          const shown = isOpen ? result.matches : result.matches.slice(0, 3)
          const hidden = result.matches.length - shown.length
          return (
            <div key={result.sessionId} className="search-group">
              <button
                type="button"
                className="search-group__header"
                onClick={() => onSelectSession?.(result.sessionId)}
              >
                <MessageSquare size={14} />
                <span className="search-group__title">{sessionTitle(result.sessionId)}</span>
                <span className="search-group__count">{result.matchCount}</span>
              </button>

              {shown.map((match, i) => (
                <button
                  key={`${match.sessionId}-${match.lineNumber}-${i}`}
                  type="button"
                  className="search-hit"
                  onClick={() => onSelectSession?.(result.sessionId)}
                >
                  <span className="search-hit__line">{match.lineNumber}</span>
                  <span className="search-hit__snippet">{highlight(match.snippet, trimmed)}</span>
                </button>
              ))}

              {hidden > 0 && (
                <button type="button" className="search-group__more" onClick={() => toggle(result.sessionId)}>
                  Show {hidden} more {hidden === 1 ? 'match' : 'matches'}
                </button>
              )}
              {isOpen && result.matches.length > 3 && (
                <button type="button" className="search-group__more" onClick={() => toggle(result.sessionId)}>
                  Collapse
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
