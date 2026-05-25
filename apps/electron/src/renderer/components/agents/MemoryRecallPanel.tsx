import * as React from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { MemoryRecallResult, MemoryScope, RecallMemoryInput } from '@craft-agent/shared/memory/types'

interface MemoryRecallApi {
  recallMemory?: (payload: RecallMemoryInput) => Promise<MemoryRecallResult[]>
}

interface MemoryRecallPanelProps {
  scope?: MemoryScope
  agentSlug?: string
}

export function MemoryRecallPanel({ scope = 'user', agentSlug }: MemoryRecallPanelProps) {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<MemoryRecallResult[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [searched, setSearched] = React.useState(false)
  const scopeLabel = scope === 'agent' ? 'agent MEMORY.md' : 'USER.md'

  const runRecall = React.useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setError(null)
      setSearched(false)
      return
    }
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const api = window.electronAPI as unknown as MemoryRecallApi
      if (!api.recallMemory) throw new Error('Memory recall API is unavailable')
      setResults(await api.recallMemory({
        query: trimmed,
        scopes: [scope],
        agentSlug: scope === 'agent' ? agentSlug : undefined,
        limit: 8,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [agentSlug, query, scope])

  return (
    <div className="runneros-card p-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-white/45" />
        <div>
          <div className="text-sm font-medium text-white/78">Recall search</div>
          <div className="text-xs text-white/38">Search {scopeLabel} with the same backend agents will use.</div>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <div className="relative flex-1 rounded-[10px] border border-white/[0.06] bg-white/[0.035] shadow-minimal has-[:focus-visible]:border-white/[0.14]">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runRecall()
            }}
            placeholder="Search memory..."
            className="h-9 border-0 bg-transparent text-[12.5px] text-white/78 shadow-none placeholder:text-white/24 focus-visible:bg-transparent focus-visible:outline-none focus-visible:ring-0"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-9 shrink-0"
          onClick={() => void runRecall()}
          disabled={loading || !query.trim()}
        >
          {loading ? 'Searching...' : 'Search'}
        </Button>
      </div>

      <div className="mt-3">
        {error ? (
          <div className="rounded-[10px] border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>
        ) : !searched ? (
          <div className="text-sm text-white/42">Enter a query to test recall.</div>
        ) : results.length === 0 ? (
          <div className="text-sm text-white/42">No matching memories.</div>
        ) : (
          <div className="grid gap-2">
            {results.map((result) => (
              <MemoryRecallRow key={`${result.scope}:${result.agentSlug ?? 'user'}:${result.entry.name}`} result={result} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MemoryRecallRow({ result }: { result: MemoryRecallResult }) {
  return (
    <div className="rounded-[10px] border border-white/[0.07] bg-white/[0.025] p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded-[6px] border border-sky-400/25 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-200/85">
              {result.scope}
            </span>
            <span className="truncate text-sm font-medium text-white/78">{result.entry.name}</span>
          </div>
          <div className="mt-1 line-clamp-2 text-xs text-white/45">{result.excerpt}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/34">
            <span>{result.entry.type}</span>
            <span>score {Math.round(result.score)}</span>
            <span>{result.reason}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
