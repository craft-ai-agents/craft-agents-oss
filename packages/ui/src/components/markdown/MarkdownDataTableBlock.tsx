import * as React from 'react'
import { Maximize2, ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import { DataTableOverlay } from '../overlay/DataTableOverlay'

// ============================================================================
// MarkdownDataTableBlock — renders `datatable` code fences as interactive tables.
//
// Parses JSON content with columns/rows schema and renders a sortable, filterable
// table. Supports inline data or `src` file references. Falls back to a plain
// code block if JSON is invalid.
//
// Column types: text, number, currency, percent, boolean, date, badge
// ============================================================================

/** Column definition from the datatable JSON schema */
export interface DataTableColumn {
  key: string
  label: string
  type?: 'text' | 'number' | 'currency' | 'percent' | 'boolean' | 'date' | 'badge'
}

/** Parsed datatable schema */
export interface DataTableData {
  columns: DataTableColumn[]
  rows: Record<string, unknown>[]
  title?: string
}

interface MarkdownDataTableBlockProps {
  code: string
  className?: string
}

/** Format a cell value based on column type */
function formatCell(value: unknown, type?: string): React.ReactNode {
  if (value == null) return '—'

  switch (type) {
    case 'currency': {
      const num = Number(value)
      if (isNaN(num)) return String(value)
      return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })
    }
    case 'percent': {
      const num = Number(value)
      if (isNaN(num)) return String(value)
      // Handle both 0.15 (fraction) and 15 (already percent) formats
      const pct = Math.abs(num) <= 1 && num !== 0 ? num * 100 : num
      const sign = pct > 0 ? '+' : ''
      return (
        <span className={cn(pct > 0 ? 'text-green-600 dark:text-green-400' : pct < 0 ? 'text-red-600 dark:text-red-400' : '')}>
          {sign}{pct.toFixed(1)}%
        </span>
      )
    }
    case 'boolean': {
      const bool = value === true || value === 'true' || value === 1
      return <span>{bool ? '✓' : '✗'}</span>
    }
    case 'date': {
      try {
        const d = new Date(value as string | number)
        return d.toLocaleDateString()
      } catch {
        return String(value)
      }
    }
    case 'badge': {
      return (
        <span className="inline-flex items-center h-5 px-2 text-[11px] font-medium rounded-full bg-foreground/10 text-foreground/70">
          {String(value)}
        </span>
      )
    }
    case 'number': {
      const num = Number(value)
      if (isNaN(num)) return String(value)
      return num.toLocaleString()
    }
    default:
      return String(value)
  }
}

/** Compare values for sorting */
function compareValues(a: unknown, b: unknown, type?: string): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1

  if (type === 'number' || type === 'currency' || type === 'percent') {
    return Number(a) - Number(b)
  }
  if (type === 'boolean') {
    const aBool = a === true || a === 'true' || a === 1 ? 1 : 0
    const bBool = b === true || b === 'true' || b === 1 ? 1 : 0
    return aBool - bBool
  }
  if (type === 'date') {
    return new Date(a as string).getTime() - new Date(b as string).getTime()
  }
  return String(a).localeCompare(String(b))
}

/** The core table renderer — shared by inline and overlay views */
function DataTableRenderer({
  data,
  sortKey,
  sortDir,
  onSort,
  filter,
}: {
  data: DataTableData
  sortKey: string | null
  sortDir: 'asc' | 'desc'
  onSort: (key: string) => void
  filter: string
}) {
  // Filter rows
  const filteredRows = React.useMemo(() => {
    if (!filter) return data.rows
    const lower = filter.toLowerCase()
    return data.rows.filter(row =>
      data.columns.some(col => {
        const val = row[col.key]
        return val != null && String(val).toLowerCase().includes(lower)
      })
    )
  }, [data.rows, data.columns, filter])

  // Sort rows
  const sortedRows = React.useMemo(() => {
    if (!sortKey) return filteredRows
    const col = data.columns.find(c => c.key === sortKey)
    const sorted = [...filteredRows].sort((a, b) =>
      compareValues(a[sortKey], b[sortKey], col?.type)
    )
    return sortDir === 'desc' ? sorted.reverse() : sorted
  }, [filteredRows, sortKey, sortDir, data.columns])

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-background z-10">
          <tr className="border-b border-border">
            {data.columns.map(col => (
              <th
                key={col.key}
                className="text-left py-2 px-3 font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                onClick={() => onSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key ? (
                    sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-30" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
              {data.columns.map(col => (
                <td key={col.key} className="py-2 px-3 whitespace-nowrap">
                  {formatCell(row[col.key], col.type)}
                </td>
              ))}
            </tr>
          ))}
          {sortedRows.length === 0 && (
            <tr>
              <td colSpan={data.columns.length} className="py-6 text-center text-muted-foreground">
                No matching rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function MarkdownDataTableBlock({ code, className }: MarkdownDataTableBlockProps) {
  const [overlayOpen, setOverlayOpen] = React.useState(false)
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc')
  const [filter, setFilter] = React.useState('')
  const [showSearch, setShowSearch] = React.useState(false)

  // Parse JSON data
  const parsed = React.useMemo<DataTableData | null>(() => {
    try {
      const obj = JSON.parse(code)
      // Validate basic shape
      if (obj && Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
        return obj as DataTableData
      }
      // src reference — not supported inline, render as code
      if (obj && typeof obj.src === 'string') {
        return null
      }
      return null
    } catch {
      return null
    }
  }, [code])

  const handleSort = React.useCallback((key: string) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        return key
      }
      setSortDir('asc')
      return key
    })
  }, [])

  // Fallback to code block if parsing fails
  if (!parsed) {
    return <CodeBlock code={code} language="json" mode="full" className={className} />
  }

  return (
    <>
      <div className={cn('group relative my-3 rounded-md border border-border overflow-hidden', className)}>
        {/* Header bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border">
          <span className="text-xs font-medium text-muted-foreground">
            {parsed.title || 'Data Table'} · {parsed.rows.length} rows
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSearch(s => !s)}
              className="p-1 rounded hover:bg-foreground/[0.05] transition-colors"
              title="Search"
            >
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={() => setOverlayOpen(true)}
              className="p-1 rounded hover:bg-foreground/[0.05] transition-colors"
              title="Expand"
            >
              <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Search bar */}
        {showSearch && (
          <div className="px-3 py-1.5 border-b border-border bg-muted/10">
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search rows..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              autoFocus
            />
          </div>
        )}

        {/* Table */}
        <div className="max-h-[400px] overflow-auto">
          <DataTableRenderer
            data={parsed}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            filter={filter}
          />
        </div>
      </div>

      {/* Fullscreen overlay */}
      <DataTableOverlay
        isOpen={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        title={parsed.title || 'Data Table'}
        subtitle={`${parsed.rows.length} rows · ${parsed.columns.length} columns`}
      >
        <div className="px-4">
          <div className="mb-3">
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search rows..."
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
            />
          </div>
          <DataTableRenderer
            data={parsed}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            filter={filter}
          />
        </div>
      </DataTableOverlay>
    </>
  )
}
