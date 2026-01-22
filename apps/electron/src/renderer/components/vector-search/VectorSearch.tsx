/**
 * Vector Search Component
 *
 * Semantic search for markdown documents using QMD CLI.
 * Supports keyword (BM25), semantic (vector), and hybrid search modes.
 */

import { useAtom } from 'jotai'
import { useEffect, useCallback } from 'react'
import { searchStateAtom, collectionsAtom, type SearchState, type SearchMode } from '../../atoms/vector-search'
import type { VectorSearchResult } from '../../../shared/types'

export function VectorSearch() {
  const [state, setState] = useAtom(searchStateAtom)
  const [collections, setCollections] = useAtom(collectionsAtom)

  // Load collections on mount
  useEffect(() => {
    window.electronAPI.vectorSearchExecute(['collection', 'list'])
      .then(({ stdout, stderr }) => {
        if (stderr) {
          // QMD not installed or other error - that's fine, user can still add collections
          return
        }
        if (stdout) {
          // Parse collection names from output (one per line)
          const names = stdout.trim().split('\n').filter(Boolean)
          setCollections(names)
        }
      })
  }, [setCollections])

  // Search function
  const search = useCallback(async () => {
    if (!state.query.trim()) return
    setState(s => ({ ...s, isSearching: true, error: null }))

    const cmd = state.mode === 'keyword' ? 'search'
              : state.mode === 'semantic' ? 'vsearch'
              : 'query'

    try {
      const { stdout, stderr } = await window.electronAPI.vectorSearchExecute([
        cmd, '-n', '20', state.query
      ])

      if (stderr) {
        setState(s => ({ ...s, isSearching: false, error: stderr }))
        return
      }

      // Parse results - QMD outputs tab-separated values by default
      // Format: path\tscore\tsnippet
      const results: VectorSearchResult[] = []
      if (stdout) {
        const lines = stdout.trim().split('\n')
        for (const line of lines) {
          const parts = line.split('\t')
          if (parts.length >= 2) {
            results.push({
              filePath: parts[0],
              score: parseFloat(parts[1]) || 0,
              snippet: parts[2] || '',
              collection: parts[3] || 'default'
            })
          }
        }
      }
      setState(s => ({ ...s, isSearching: false, results }))
    } catch (err) {
      setState(s => ({
        ...s,
        isSearching: false,
        error: err instanceof Error ? err.message : 'Search failed'
      }))
    }
  }, [state.query, state.mode, setState])

  // Handle key press
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      search()
    }
  }

  // Add collection
  const addCollection = async () => {
    const path = await window.electronAPI.openFolderDialog()
    if (path) {
      const name = path.split('/').pop() || 'collection'
      const { stderr } = await window.electronAPI.vectorSearchExecute([
        'collection', 'add', path, '--name', name
      ])
      if (!stderr) {
        // Refresh collections list
        const { stdout } = await window.electronAPI.vectorSearchExecute(['collection', 'list'])
        if (stdout) {
          const names = stdout.trim().split('\n').filter(Boolean)
          setCollections(names)
        }
      }
    }
  }

  return (
    <div className="flex flex-col h-full p-4">
      {/* Search Input */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={state.query}
          onChange={e => setState(s => ({ ...s, query: e.target.value }))}
          onKeyDown={handleKeyDown}
          placeholder="Search docs..."
          className="flex-1 px-3 py-2 border border-border rounded bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={state.mode}
          onChange={e => setState(s => ({ ...s, mode: e.target.value as SearchMode }))}
          className="px-3 py-2 border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="hybrid">Hybrid</option>
          <option value="keyword">Keyword</option>
          <option value="semantic">Semantic</option>
        </select>
        <button
          onClick={search}
          disabled={state.isSearching}
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.isSearching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Error */}
      {state.error && (
        <div className="p-3 mb-4 bg-destructive/10 text-destructive rounded border border-destructive/20">
          {state.error}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {state.results.length === 0 && !state.isSearching && state.query && (
          <div className="text-muted-foreground text-center py-8">No results found</div>
        )}
        {state.results.length === 0 && !state.query && (
          <div className="text-muted-foreground text-center py-8">
            <p className="mb-2">Search markdown documents across your collections.</p>
            <p className="text-sm">
              {collections.length === 0
                ? 'Add a collection to get started.'
                : `${collections.length} collection${collections.length === 1 ? '' : 's'} indexed.`
              }
            </p>
          </div>
        )}
        {state.results.map((result, i) => (
          <div
            key={`${result.filePath}-${i}`}
            className="p-3 border-b border-border hover:bg-muted/50 cursor-pointer transition-colors"
            onClick={() => window.electronAPI.openFile(result.filePath)}
          >
            <div className="font-medium text-foreground">
              {result.filePath.split('/').pop()}
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {result.filePath}
            </div>
            {result.snippet && (
              <div className="text-sm mt-1 text-foreground/80 line-clamp-2">
                {result.snippet}
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-1">
              Score: {result.score.toFixed(2)}
              {result.collection && ` | ${result.collection}`}
            </div>
          </div>
        ))}
      </div>

      {/* Add Collection */}
      <div className="mt-4 pt-4 border-t border-border">
        <button
          onClick={addCollection}
          className="text-primary hover:text-primary/80 hover:underline text-sm"
        >
          + Add Collection
        </button>
        {collections.length > 0 && (
          <span className="ml-4 text-xs text-muted-foreground">
            Collections: {collections.join(', ')}
          </span>
        )}
      </div>
    </div>
  )
}
