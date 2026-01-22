/**
 * Vector Search Component
 *
 * Semantic search for markdown documents using QMD CLI.
 * Supports keyword (BM25), semantic (vector), and hybrid search modes.
 */

import { useAtom } from 'jotai'
import { useEffect, useCallback } from 'react'
import { searchStateAtom, collectionsAtom, type SearchMode, type CollectionInfo } from '../../atoms/vector-search'
import type { VectorSearchResult } from '../../../shared/types'

/**
 * Parse collection list output from QMD CLI
 * Format:
 * Collections (N):
 *
 * name (qmd://name/)
 *   Pattern:  **\/*.md
 *   Files:    123
 *   Updated:  2d ago
 */
function parseCollectionList(output: string): CollectionInfo[] {
  const collections: CollectionInfo[] = []
  const lines = output.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    // Look for collection name line: "name (qmd://name/)"
    const nameMatch = line.match(/^(\S+)\s+\(qmd:\/\/([^/]+)\/\)$/)
    if (nameMatch) {
      const collection: CollectionInfo = {
        name: nameMatch[1],
        url: `qmd://${nameMatch[2]}/`,
        pattern: '',
        files: 0,
        updated: ''
      }
      // Parse following lines for Pattern, Files, Updated
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const subLine = lines[j].trim()
        if (subLine.startsWith('Pattern:')) {
          collection.pattern = subLine.replace('Pattern:', '').trim()
        } else if (subLine.startsWith('Files:')) {
          collection.files = parseInt(subLine.replace('Files:', '').trim()) || 0
        } else if (subLine.startsWith('Updated:')) {
          collection.updated = subLine.replace('Updated:', '').trim()
        }
      }
      collections.push(collection)
    }
    i++
  }
  return collections
}

/**
 * Strip ANSI escape codes from string
 * QMD outputs progress info with ANSI codes even with --json flag
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\]9;[0-9;]+/g, '')
}

/**
 * Parse JSON search results from QMD CLI output
 * QMD outputs progress messages (tips, query expansion, etc.) BEFORE the JSON array
 * We need to find and extract just the JSON portion
 */
function parseSearchResults(output: string): VectorSearchResult[] {
  if (!output.trim()) {
    console.debug('[VectorSearch] Empty output from QMD')
    return []
  }

  // Strip ANSI escape codes first
  const cleaned = stripAnsi(output)

  // Find the JSON array in the output (starts with '[', ends with ']')
  const jsonStart = cleaned.indexOf('[')
  if (jsonStart === -1) {
    console.debug('[VectorSearch] No JSON array found in output:', cleaned.slice(0, 300))
    return []
  }

  const jsonEnd = cleaned.lastIndexOf(']')
  if (jsonEnd === -1 || jsonEnd < jsonStart) {
    console.debug('[VectorSearch] Invalid JSON array bounds')
    return []
  }

  try {
    const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1)
    const parsed = JSON.parse(jsonStr) as Array<{
      docid: string
      score: number
      file: string
      title?: string
      context?: string
      snippet?: string
    }>

    const results = parsed.map(item => ({
      filePath: item.file?.replace(/^qmd:\/\/[^/]+\//, '') || '', // Remove qmd:// prefix
      score: item.score ?? 0,
      snippet: item.snippet?.replace(/@@ [^@]+ @@[^\n]*\n?/, '') || '', // Remove diff header
      collection: item.file?.match(/^qmd:\/\/([^/]+)\//)?.[1] || 'default',
      title: item.title
    }))

    console.debug('[VectorSearch] Parsed results:', results.length)
    return results
  } catch (e) {
    console.error('[VectorSearch] JSON parse error:', e, 'Output:', cleaned.slice(0, 300))
    return []
  }
}

export function VectorSearch() {
  const [state, setState] = useAtom(searchStateAtom)
  const [collections, setCollections] = useAtom(collectionsAtom)

  // Load collections on mount
  useEffect(() => {
    console.debug('[VectorSearch] Loading collections...')
    window.electronAPI.vectorSearchExecute(['collection', 'list'])
      .then(({ stdout, stderr }) => {
        console.debug('[VectorSearch] Collection list stdout:', stdout?.slice(0, 200))
        console.debug('[VectorSearch] Collection list stderr:', stderr)

        // Try to parse collections from stdout even if there's stderr (warnings are ok)
        if (stdout) {
          const parsed = parseCollectionList(stdout)
          console.debug('[VectorSearch] Parsed collections:', parsed.length)
          setCollections(parsed)
        } else if (stderr) {
          // Only log as error if there's no stdout at all
          console.warn('[VectorSearch] Collection list warning:', stderr)
        }
      })
      .catch(err => {
        console.error('[VectorSearch] Failed to load collections:', err)
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
        cmd, '-n', '20', '--json', state.query
      ])

      console.debug('[VectorSearch] stdout:', stdout?.slice(0, 200))
      console.debug('[VectorSearch] stderr:', stderr)

      // Try to parse results from stdout first (QMD may output warnings to stderr but still return results)
      const results = parseSearchResults(stdout || '')

      // Only treat stderr as error if we got no results AND there's an error message
      if (results.length === 0 && stderr && !stdout?.includes('[')) {
        setState(s => ({ ...s, isSearching: false, error: stderr }))
        return
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

  // Handle key press - memoized to prevent re-renders
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      search()
    }
  }, [search])

  // Memoized handlers for input changes
  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setState(s => ({ ...s, query: e.target.value }))
  }, [setState])

  const handleModeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setState(s => ({ ...s, mode: e.target.value as SearchMode }))
  }, [setState])

  // Add collection - memoized
  // Registers the collection AND runs embedding to index documents
  const addCollection = useCallback(async () => {
    try {
      const path = await window.electronAPI.openFolderDialog()
      if (!path) return

      const name = path.split('/').pop() || 'collection'
      console.debug('[VectorSearch] Adding collection:', name, 'from', path)

      // Step 1: Register the collection
      const addResult = await window.electronAPI.vectorSearchExecute([
        'collection', 'add', path, '--name', name
      ])
      console.debug('[VectorSearch] Add result:', addResult)

      if (addResult.stderr && !addResult.stderr.includes('already exists') && !addResult.stdout) {
        setState(s => ({ ...s, error: `Failed to add collection: ${addResult.stderr}` }))
        return
      }

      // Step 2: Run embedding to index documents (this enables semantic search)
      console.debug('[VectorSearch] Running qmd embed to index documents...')
      const embedResult = await window.electronAPI.vectorSearchExecute(['embed'])
      console.debug('[VectorSearch] Embed result:', embedResult)

      // Step 3: Refresh collections list
      const listResult = await window.electronAPI.vectorSearchExecute(['collection', 'list'])
      console.debug('[VectorSearch] List result:', listResult)

      if (listResult.stdout) {
        const parsed = parseCollectionList(listResult.stdout)
        setCollections(parsed)
      }
    } catch (err) {
      console.error('[VectorSearch] addCollection error:', err)
      setState(s => ({ ...s, error: err instanceof Error ? err.message : 'Failed to add collection' }))
    }
  }, [setCollections, setState])

  // Memoized handler for opening files
  const handleOpenFile = useCallback((filePath: string) => {
    window.electronAPI.openFile(filePath)
  }, [])

  return (
    <div className="flex flex-col h-full p-4">
      {/* Search Input */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={state.query}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          placeholder="Search docs..."
          className="flex-1 px-3 py-2 border border-border rounded bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={state.mode}
          onChange={handleModeChange}
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
            onClick={() => handleOpenFile(result.filePath)}
          >
            <div className="font-medium text-foreground">
              {result.title || result.filePath.split('/').pop()}
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
            Collections ({collections.length}): {collections.map(c =>
              `${c.name} (${c.url}), Pattern: ${c.pattern}, Files: ${c.files}, Updated: ${c.updated}`
            ).join(', ')}
          </span>
        )}
      </div>
    </div>
  )
}
