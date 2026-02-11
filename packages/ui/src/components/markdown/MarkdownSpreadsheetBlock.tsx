import * as React from 'react'
import { Maximize2, ArrowUpDown, ArrowUp, ArrowDown, Search, Download } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import { DataTableOverlay } from '../overlay/DataTableOverlay'
import type { DataTableData, DataTableColumn } from './MarkdownDataTableBlock'

// ============================================================================
// MarkdownSpreadsheetBlock — renders `spreadsheet` code fences as interactive
// spreadsheet-style tables with column letters, row numbers, and CSV export.
//
// Same data schema as datatable but with spreadsheet affordances.
// ============================================================================

/** Format a cell value based on column type */
function formatCell(value: unknown, type?: string): React.ReactNode {
  if (value == null) return ''

  switch (type) {
    case 'currency': {
      const num = Number(value)
      if (isNaN(num)) return String(value)
      return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })
    }
    case 'percent': {
      const num = Number(value)
      if (isNaN(num)) return String(value)
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
        return new Date(value as string | number).toLocaleDateString()
      } catch {
        return String(value)
      }
    }
    case 'badge':
      return (
        <span className="inline-flex items-center h-5 px-2 text-[11px] font-medium rounded-full bg-foreground/10 text-foreground/70">
          {String(value)}
        </span>
      )
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
  if (type === 'number' || type === 'currency' || type === 'percent') return Number(a) - Number(b)
  if (type === 'boolean') return (a === true ? 1 : 0) - (b === true ? 1 : 0)
  if (type === 'date') return new Date(a as string).getTime() - new Date(b as string).getTime()
  return String(a).localeCompare(String(b))
}

/** Get column letter (A, B, C, ... Z, AA, AB, ...) */
function getColumnLetter(index: number): string {
  let result = ''
  let n = index
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}

/** Generate CSV string from data */
function generateCsv(data: DataTableData): string {
  const header = data.columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(',')
  const rows = data.rows.map(row =>
    data.columns.map(col => {
      const val = row[col.key]
      if (val == null) return ''
      const str = String(val)
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str
    }).join(',')
  )
  return [header, ...rows].join('\n')
}

/** Download a string as a file */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** The spreadsheet table renderer */
function SpreadsheetRenderer({
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

  const sortedRows = React.useMemo(() => {
    if (!sortKey) return filteredRows
    const col = data.columns.find(c => c.key === sortKey)
    const sorted = [...filteredRows].sort((a, b) => compareValues(a[sortKey], b[sortKey], col?.type))
    return sortDir === 'desc' ? sorted.reverse() : sorted
  }, [filteredRows, sortKey, sortDir, data.columns])

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm font-mono">
        <thead className="sticky top-0 bg-background z-10">
          {/* Column letters row */}
          <tr className="border-b border-border/30">
            <th className="w-10 py-1 px-2 text-center text-[10px] text-muted-foreground/50 font-normal" />
            {data.columns.map((_, i) => (
              <th key={i} className="py-1 px-3 text-center text-[10px] text-muted-foreground/50 font-normal">
                {getColumnLetter(i)}
              </th>
            ))}
          </tr>
          {/* Column labels row */}
          <tr className="border-b border-border">
            <th className="w-10 py-2 px-2 text-center text-[10px] text-muted-foreground/50 font-normal" />
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
              <td className="w-10 py-2 px-2 text-center text-[10px] text-muted-foreground/50 select-none border-r border-border/30">
                {i + 1}
              </td>
              {data.columns.map(col => (
                <td key={col.key} className="py-2 px-3 whitespace-nowrap">
                  {formatCell(row[col.key], col.type)}
                </td>
              ))}
            </tr>
          ))}
          {sortedRows.length === 0 && (
            <tr>
              <td colSpan={data.columns.length + 1} className="py-6 text-center text-muted-foreground">
                No matching rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

interface MarkdownSpreadsheetBlockProps {
  code: string
  className?: string
}

export function MarkdownSpreadsheetBlock({ code, className }: MarkdownSpreadsheetBlockProps) {
  const [overlayOpen, setOverlayOpen] = React.useState(false)
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc')
  const [filter, setFilter] = React.useState('')
  const [showSearch, setShowSearch] = React.useState(false)
  const [showExport, setShowExport] = React.useState(false)

  const parsed = React.useMemo<DataTableData | null>(() => {
    try {
      const obj = JSON.parse(code)
      if (obj && Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
        return obj as DataTableData
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

  const handleExportCsv = React.useCallback(() => {
    if (!parsed) return
    const csv = generateCsv(parsed)
    const filename = (parsed.title || 'spreadsheet').toLowerCase().replace(/\s+/g, '-') + '.csv'
    downloadFile(csv, filename, 'text/csv;charset=utf-8')
    setShowExport(false)
  }, [parsed])

  if (!parsed) {
    return <CodeBlock code={code} language="json" mode="full" className={className} />
  }

  return (
    <>
      <div className={cn('group relative my-3 rounded-md border border-border overflow-hidden', className)}>
        {/* Header bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border">
          <span className="text-xs font-medium text-muted-foreground">
            {parsed.title || 'Spreadsheet'} · {parsed.rows.length} rows
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSearch(s => !s)}
              className="p-1 rounded hover:bg-foreground/[0.05] transition-colors"
              title="Search"
            >
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowExport(s => !s)}
                className="p-1 rounded hover:bg-foreground/[0.05] transition-colors"
                title="Export"
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {showExport && (
                <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-md border border-border bg-background shadow-md py-1">
                  <button
                    onClick={handleExportCsv}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                  >
                    Download as .csv
                  </button>
                </div>
              )}
            </div>
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

        {/* Spreadsheet */}
        <div className="max-h-[400px] overflow-auto">
          <SpreadsheetRenderer
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
        title={parsed.title || 'Spreadsheet'}
        subtitle={`${parsed.rows.length} rows · ${parsed.columns.length} columns`}
      >
        <div className="px-4">
          <div className="mb-3 flex items-center gap-2">
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search rows..."
              className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-background text-sm hover:bg-muted/50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
          <SpreadsheetRenderer
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
