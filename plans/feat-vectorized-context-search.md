# Feature: Vectorized Context Search (Simplified)

## Overview

Add semantic search for markdown documents across registered repositories using QMD CLI. Local embeddings, no external API calls.

---

## The Simplest Thing That Works

```
┌────────────────────────────────────────────────────────────┐
│                      Renderer                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  VectorSearch.tsx                                   │   │
│  │  - Search input + mode selector                     │   │
│  │  - Results list                                     │   │
│  │  - Collection dropdown                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                 │
│                   window.electronAPI                       │
└──────────────────────────┼─────────────────────────────────┘
                           │ IPC
┌──────────────────────────┼─────────────────────────────────┐
│                      Main Process                          │
│                          │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  executeQmd(args: string[]): Promise<string>        │   │
│  │  - Safe execution with execFile                     │   │
│  │  - Returns stdout                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                 │
│                    child_process                           │
└──────────────────────────┼─────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   QMD CLI   │
                    └─────────────┘
```

---

## Implementation

### 1. Types (`shared/types.ts`)

Add to existing `IPC_CHANNELS`:

```typescript
VECTOR_SEARCH_EXECUTE: 'vector-search:execute'
```

Add to `ElectronAPI`:

```typescript
vectorSearch: {
  execute: (args: string[]) => Promise<{ stdout: string; stderr: string }>
}
```

Add result type:

```typescript
interface VectorSearchResult {
  filePath: string
  snippet: string
  score: number
  collection: string
}
```

### 2. IPC Handler (`main/ipc.ts`)

Add one handler:

```typescript
ipcMain.handle(IPC_CHANNELS.VECTOR_SEARCH_EXECUTE, async (_event, args: string[]) => {
  // Validate args don't contain shell metacharacters
  const sanitized = args.map(arg =>
    arg.replace(/[`$(){}|;&]/g, '').slice(0, 1000)
  )

  return new Promise((resolve, reject) => {
    execFile('qmd', sanitized, { shell: false, timeout: 30000 }, (error, stdout, stderr) => {
      if (error && error.code === 'ENOENT') {
        resolve({ stdout: '', stderr: 'QMD not installed. Run: bun install -g https://github.com/tobi/qmd' })
      } else if (error) {
        resolve({ stdout: '', stderr: stderr || error.message })
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
})
```

### 3. Preload (`preload/index.ts`)

Add to `electronAPI`:

```typescript
vectorSearch: {
  execute: (args: string[]) => ipcRenderer.invoke(IPC_CHANNELS.VECTOR_SEARCH_EXECUTE, args)
}
```

### 4. State (`renderer/atoms/vector-search.ts`)

Two atoms:

```typescript
import { atom } from 'jotai'

interface SearchState {
  query: string
  mode: 'keyword' | 'semantic' | 'hybrid'
  results: VectorSearchResult[]
  error: string | null
  isSearching: boolean
}

export const searchStateAtom = atom<SearchState>({
  query: '',
  mode: 'hybrid',
  results: [],
  error: null,
  isSearching: false
})

export const collectionsAtom = atom<string[]>([])
```

### 5. Component (`renderer/components/vector-search/VectorSearch.tsx`)

One component (~150 lines):

```typescript
import { useAtom } from 'jotai'
import { searchStateAtom, collectionsAtom } from '@/atoms/vector-search'

export function VectorSearch() {
  const [state, setState] = useAtom(searchStateAtom)
  const [collections, setCollections] = useAtom(collectionsAtom)

  // Load collections on mount
  useEffect(() => {
    window.electronAPI.vectorSearch.execute(['collection', 'list', '--json'])
      .then(({ stdout }) => {
        if (stdout) setCollections(JSON.parse(stdout))
      })
  }, [])

  // Search function
  async function search() {
    if (!state.query.trim()) return
    setState(s => ({ ...s, isSearching: true, error: null }))

    const cmd = state.mode === 'keyword' ? 'search'
              : state.mode === 'semantic' ? 'vsearch'
              : 'query'

    const { stdout, stderr } = await window.electronAPI.vectorSearch.execute([
      cmd, '--json', '-n', '20', state.query
    ])

    if (stderr) {
      setState(s => ({ ...s, isSearching: false, error: stderr }))
    } else {
      const results = JSON.parse(stdout || '[]')
      setState(s => ({ ...s, isSearching: false, results }))
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
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Search docs..."
          className="flex-1 px-3 py-2 border rounded"
        />
        <select
          value={state.mode}
          onChange={e => setState(s => ({ ...s, mode: e.target.value as SearchState['mode'] }))}
          className="px-3 py-2 border rounded"
        >
          <option value="hybrid">Hybrid</option>
          <option value="keyword">Keyword</option>
          <option value="semantic">Semantic</option>
        </select>
        <button onClick={search} disabled={state.isSearching} className="px-4 py-2 bg-blue-500 text-white rounded">
          {state.isSearching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Error */}
      {state.error && (
        <div className="p-3 mb-4 bg-red-100 text-red-700 rounded">{state.error}</div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {state.results.length === 0 && !state.isSearching && state.query && (
          <div className="text-gray-500 text-center py-8">No results found</div>
        )}
        {state.results.map((result, i) => (
          <div key={i} className="p-3 border-b hover:bg-gray-50 cursor-pointer"
               onClick={() => window.electronAPI.openPath(result.filePath)}>
            <div className="font-medium">{result.filePath.split('/').pop()}</div>
            <div className="text-sm text-gray-500">{result.collection}</div>
            <div className="text-sm mt-1">{result.snippet}</div>
            <div className="text-xs text-gray-400 mt-1">Score: {result.score.toFixed(2)}</div>
          </div>
        ))}
      </div>

      {/* Add Collection */}
      <div className="mt-4 pt-4 border-t">
        <button
          onClick={async () => {
            const paths = await window.electronAPI.openDirectoryDialog()
            if (paths[0]) {
              const name = paths[0].split('/').pop()
              await window.electronAPI.vectorSearch.execute(['collection', 'add', paths[0], '--name', name!])
              // Refresh collections
              const { stdout } = await window.electronAPI.vectorSearch.execute(['collection', 'list', '--json'])
              if (stdout) setCollections(JSON.parse(stdout))
            }
          }}
          className="text-blue-500 hover:underline"
        >
          + Add Collection
        </button>
      </div>
    </div>
  )
}
```

---

## Integration

Add to app navigation (e.g., sidebar or command palette):

```typescript
// In LeftSidebar.tsx or wherever navigation lives
<NavItem
  icon={<SearchIcon />}
  label="Search Docs"
  onClick={() => setActivePanel('vector-search')}
/>
```

---

## Tests

### Security Tests (`__tests__/vector-search-handlers.test.ts`)

```typescript
import { describe, it, expect } from 'bun:test'

describe('vector-search IPC handler', () => {
  it('sanitizes shell metacharacters from args', () => {
    const sanitize = (arg: string) => arg.replace(/[`$(){}|;&]/g, '').slice(0, 1000)

    expect(sanitize('normal query')).toBe('normal query')
    expect(sanitize('test; rm -rf /')).toBe('test rm -rf /')
    expect(sanitize('$(whoami)')).toBe('whoami')
    expect(sanitize('`id`')).toBe('id')
    expect(sanitize('a'.repeat(2000))).toHaveLength(1000)
  })

  it('handles ENOENT when QMD not installed', async () => {
    // Mock execFile to throw ENOENT
    const result = await handleQmdNotInstalled()
    expect(result.stderr).toContain('QMD not installed')
  })
})
```

### Component Test (`__tests__/VectorSearch.test.tsx`)

```typescript
import { describe, it, expect } from 'bun:test'
import { render, fireEvent } from '@testing-library/react'
import { VectorSearch } from '../components/vector-search/VectorSearch'

describe('VectorSearch', () => {
  it('shows error when QMD not installed', async () => {
    // Mock IPC to return error
    const { findByText } = render(<VectorSearch />)
    const input = await findByText('Search docs...')
    fireEvent.change(input, { target: { value: 'test' }})
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await findByText(/QMD not installed/)).toBeTruthy()
  })

  it('displays search results', async () => {
    // Mock IPC to return results
    const { findByText } = render(<VectorSearch />)
    // ... test search flow
  })
})
```

---

## Acceptance Criteria

- [x] User can search with keyword, semantic, or hybrid mode
- [x] User can add a collection via folder picker
- [x] Results show file path, snippet, and score
- [x] Clicking a result opens the file
- [x] Clear error message when QMD not installed
- [x] Security: shell metacharacters are sanitized

---

## What's NOT in V1 (Deferred)

- File watching / auto-reindex
- Settings page
- Model download UI
- Collection filtering in search
- Document preview panel
- Memory optimization
- Progress indicators for indexing

These are earned through user feedback, not assumed.

---

## Dependencies

- **QMD CLI** - Users install separately: `bun install -g https://github.com/tobi/qmd`
- Models download automatically on first QMD use

---

## Estimated Scope

- ~50 lines: Types
- ~30 lines: IPC handler
- ~10 lines: Preload
- ~20 lines: Atoms
- ~150 lines: Component
- ~50 lines: Tests

**Total: ~310 lines** (vs 620 lines of previous plan documentation)

---

*Simplified based on reviews from DHH, Kieran, and Simplicity reviewers*
