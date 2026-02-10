import type { ComponentEntry } from './types'
import { type ReactNode, useState, useCallback, useMemo, useRef } from 'react'
import { ActionCard } from '@craft-agent/ui'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Configure pdf.js worker
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker

// Sample assets
import samplePdfUrl from '@/assets/samples/sample-invoice.pdf?url'
import sampleImageUrl from '@/assets/samples/sample-landscape.jpg'

import {
  Mail,
  Terminal,
  Hash,
  FileCode,
  Calendar,
  CreditCard,
  ClipboardList,
  CircleDot,
  Table,
  Sheet,
  BarChart3,
  FileText,
  ImageIcon,
  GitPullRequest,
  Globe,
  Database,
  Braces,
  Rocket,
  FileEdit,
  Users,
  Link,
  Bell,
  Paperclip,
  GitCompare,
  Clock,
  BookOpen,
  Scale,
  Languages,
  UserCircle,
  LayoutGrid,
  GitCommit,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
} from 'lucide-react'

/** Wrapper with padding for playground preview */
function PaddedWrapper({ children }: { children: ReactNode }) {
  return <div className="p-8 max-w-[560px] mx-auto">{children}</div>
}

// ============================================================================
// Brand Colors (matching real source brands)
// ============================================================================

const BRAND = {
  gmail: { light: '#EA4335', dark: '#F87171' },
  slack: { light: '#611F69', dark: '#E0A2EA' },
  stripe: { light: '#635BFF', dark: '#A5A0FF' },
  googleCalendar: { light: '#4285F4', dark: '#93B5F8' },
  linear: { light: '#5E6AD2', dark: '#8B92E8' },
  github: { light: '#24292e', dark: '#f0f6fc' },
  vercel: { light: '#000000', dark: '#ffffff' },
  notion: { light: '#000000', dark: '#ffffff' },
} as const

const ICON = 'w-3.5 h-3.5'
const noop = (label: string) => () => console.log(`[Playground] ${label}`)

// ============================================================================
// Shared Helpers
// ============================================================================

/** Metadata row: label + value */
function MetaRow({ label, value, labelWidth = 'w-20' }: { label: string; value: string; labelWidth?: string }) {
  return (
    <div className="flex gap-3 text-[13px]">
      <span className={`text-muted-foreground ${labelWidth} shrink-0`}>{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}

/** Status badge */
function StatusBadge({ label, color }: { label: string; color: 'success' | 'info' | 'destructive' | 'accent' | 'muted' }) {
  const colors = {
    success: 'bg-success/10 text-success',
    info: 'bg-info/10 text-info',
    destructive: 'bg-destructive/10 text-destructive',
    accent: 'bg-accent/10 text-accent',
    muted: 'bg-foreground/5 text-muted-foreground',
  }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${colors[color]}`}>{label}</span>
}

/** Code block */
function CodeBlock({ children }: { children: string }) {
  return (
    <div className="rounded-md bg-foreground/[0.03] border border-foreground/[0.06] px-4 py-3 overflow-x-auto">
      <pre className="text-[13px] font-mono text-foreground leading-relaxed"><code>{children}</code></pre>
    </div>
  )
}

/** Simple table */
function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-foreground/[0.06]">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-foreground/[0.06] bg-foreground/[0.02]">
            {headers.map(h => <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-foreground/[0.03] last:border-0">
              {row.map((cell, j) => <td key={j} className="py-2 px-3 text-foreground">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================================
// Card Components (1-6: existing, 7-31: new)
// ============================================================================

// --- 1. Email Draft ---
function EmailCardSample({ to, subject, body, sourceConnected = true }: { to: string; subject: string; body: string; sourceConnected?: boolean }) {
  return (
    <ActionCard icon={<Mail className={ICON} />} title="Email Draft" tag={to} brandColor={BRAND.gmail} sourceConnected={sourceConnected}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy email') },
        { label: 'Send via Gmail', variant: 'primary', onClick: noop('Send email') },
      ]}>
      <div className="space-y-3">
        <div className="space-y-1.5 text-[13px]">
          <div className="flex gap-2"><span className="text-muted-foreground w-16 shrink-0">To:</span><span>{to}</span></div>
          <div className="flex gap-2"><span className="text-muted-foreground w-16 shrink-0">Subject:</span><span className="font-medium">{subject}</span></div>
        </div>
        <div className="border-t border-border/30" />
        <div className="whitespace-pre-wrap leading-relaxed">{body}</div>
      </div>
    </ActionCard>
  )
}

// --- 2. Terminal Command ---
function CommandCardSample({ command, description }: { command: string; description?: string }) {
  return (
    <ActionCard icon={<Terminal className={ICON} />} title="Terminal Command" tag={description}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Run in Background', variant: 'secondary', onClick: noop('Run bg') },
        { label: 'Run', variant: 'primary', onClick: noop('Run') },
      ]}>
      <div className="rounded-md bg-foreground/[0.03] border border-foreground/[0.06] px-4 py-3">
        <code className="text-[13px] font-mono"><span className="text-muted-foreground select-none">$ </span>{command}</code>
      </div>
    </ActionCard>
  )
}

// --- 3. Slack Message ---
function SlackMessageCardSample({ channel, message, sourceConnected = true }: { channel: string; message: string; sourceConnected?: boolean }) {
  return (
    <ActionCard icon={<Hash className={ICON} />} title="Slack Message" tag={`#${channel}`} brandColor={BRAND.slack} sourceConnected={sourceConnected}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: `Send to #${channel}`, variant: 'primary', onClick: noop('Send Slack') },
      ]}>
      <div className="whitespace-pre-wrap leading-relaxed">{message}</div>
    </ActionCard>
  )
}

// --- 4. Code File ---
function CodeFileCardSample({ filename, language, code }: { filename: string; language: string; code: string }) {
  return (
    <ActionCard icon={<FileCode className={ICON} />} title={filename} tag={language} brandColor="var(--success)"
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Create File', variant: 'primary', onClick: noop('Create') },
      ]}>
      <CodeBlock>{code}</CodeBlock>
    </ActionCard>
  )
}

// --- 5. Calendar Event ---
function CalendarEventCardSample({ title, date, time, location, attendees, sourceConnected = true }: { title: string; date: string; time: string; location: string; attendees: string[]; sourceConnected?: boolean }) {
  return (
    <ActionCard icon={<Calendar className={ICON} />} title={title} brandColor={BRAND.googleCalendar} sourceConnected={sourceConnected}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Create Event', variant: 'primary', onClick: noop('Create event') },
      ]}>
      <div className="space-y-2">
        <MetaRow label="Date" value={date} />
        <MetaRow label="Time" value={time} />
        <MetaRow label="Location" value={location} />
        <MetaRow label="Attendees" value={attendees.join(', ')} />
      </div>
    </ActionCard>
  )
}

// --- 6. Payment Link ---
function PaymentLinkCardSample({ amount, currency, description, sourceConnected = true }: { amount: string; currency: string; description: string; sourceConnected?: boolean }) {
  return (
    <ActionCard icon={<CreditCard className={ICON} />} title="Payment Link" tag={`${amount} ${currency}`} brandColor={BRAND.stripe} sourceConnected={sourceConnected}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Create Link', variant: 'primary', onClick: noop('Create link') },
      ]}>
      <div className="space-y-2">
        <div className="flex gap-3 text-[13px]">
          <span className="text-muted-foreground w-20 shrink-0">Amount</span>
          <span className="font-medium text-lg">{amount} {currency}</span>
        </div>
        <MetaRow label="Description" value={description} />
      </div>
    </ActionCard>
  )
}

// --- 7. Form Input ---
function FormInputCardSample({ title, fields }: { title: string; fields: { label: string; type: 'text' | 'textarea' | 'select'; placeholder?: string; options?: string[] }[] }) {
  return (
    <ActionCard icon={<ClipboardList className={ICON} />} title={title}
      actions={[
        { label: 'Clear', variant: 'ghost', onClick: noop('Clear') },
        { label: 'Submit', variant: 'primary', onClick: noop('Submit') },
      ]}>
      <div className="space-y-4">
        {fields.map((f) => (
          <div key={f.label} className="space-y-1.5">
            <label className="text-[13px] font-medium text-foreground">{f.label}</label>
            {f.type === 'textarea' ? (
              <textarea className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none" rows={3} placeholder={f.placeholder} />
            ) : f.type === 'select' ? (
              <select className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="">{f.placeholder || 'Select...'}</option>
                {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type="text" className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" placeholder={f.placeholder} />
            )}
          </div>
        ))}
      </div>
    </ActionCard>
  )
}

// --- 8. Issue / Task ---
function IssueCardSample({ issueKey, title, description, status, statusColor, priority, assignee, labels, brandColor, sourceConnected = true }: { issueKey: string; title: string; description: string; status: string; statusColor: 'success' | 'info' | 'accent' | 'muted'; priority: string; assignee: string; labels: string[]; brandColor?: { light: string; dark: string }; sourceConnected?: boolean }) {
  return (
    <ActionCard icon={<CircleDot className={ICON} />} title={issueKey} tag={<StatusBadge label={status} color={statusColor} /> as unknown as string} brandColor={brandColor ?? BRAND.linear} sourceConnected={sourceConnected}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Create Issue', variant: 'primary', onClick: noop('Create issue') },
      ]}>
      <div className="space-y-3">
        <div className="font-medium text-[14px]">{title}</div>
        <div className="text-[13px] text-muted-foreground leading-relaxed">{description}</div>
        <div className="space-y-2 pt-1">
          <MetaRow label="Priority" value={priority} />
          <MetaRow label="Assignee" value={assignee} />
          <div className="flex gap-3 text-[13px]">
            <span className="text-muted-foreground w-20 shrink-0">Labels</span>
            <div className="flex gap-1.5 flex-wrap">{labels.map(l => <span key={l} className="px-2 py-0.5 rounded-full bg-foreground/5 text-[11px]">{l}</span>)}</div>
          </div>
        </div>
      </div>
    </ActionCard>
  )
}

// --- 9. Data Table (TanStack-powered, sortable + filterable) ---

/** Column definition for the structured JSON format an LLM would produce */
interface TableColumnDef {
  key: string
  label: string
  type?: 'text' | 'number' | 'currency' | 'percent' | 'boolean' | 'date' | 'badge'
  align?: 'left' | 'center' | 'right'
}

/** Format a cell value based on column type */
function formatCell(value: unknown, type?: TableColumnDef['type']): ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground/40">—</span>
  switch (type) {
    case 'currency': {
      const num = typeof value === 'number' ? value : Number(value)
      return <span className="tabular-nums">{num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
    }
    case 'percent': {
      const pct = typeof value === 'number' ? value : Number(value)
      const formatted = (pct * 100).toFixed(1) + '%'
      const isPositive = pct > 0
      return <span className={`tabular-nums ${isPositive ? 'text-success' : pct < 0 ? 'text-destructive' : ''}`}>{isPositive ? '+' : ''}{formatted}</span>
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value)
      return <span className="tabular-nums">{n.toLocaleString()}</span>
    }
    case 'boolean':
      return value ? <span className="text-success">Yes</span> : <span className="text-muted-foreground">No</span>
    case 'badge':
      return <StatusBadge label={String(value)} color={String(value).toLowerCase() === 'active' ? 'success' : String(value).toLowerCase() === 'revoked' || String(value).toLowerCase() === 'failed' ? 'destructive' : 'muted'} />
    default:
      return String(value)
  }
}

/** Resolve text alignment for a column type */
function columnAlign(type?: TableColumnDef['type'], explicit?: string): string {
  if (explicit) return `text-${explicit}`
  if (type === 'number' || type === 'currency' || type === 'percent') return 'text-right'
  return 'text-left'
}

function DataTableCardSample({ title, columns, rows }: { title: string; columns: TableColumnDef[]; rows: Record<string, unknown>[] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  const tanstackColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(() =>
    columns.map((col) => ({
      accessorKey: col.key,
      header: ({ column: c }) => (
        <button
          onClick={() => c.toggleSorting(c.getIsSorted() === 'asc')}
          className={`flex items-center gap-1.5 w-full font-medium text-muted-foreground hover:text-foreground transition-colors ${columnAlign(col.type, col.align)}`}
        >
          <span className="flex-1">{col.label}</span>
          {c.getIsSorted() === 'asc' ? <ArrowUp className="w-3 h-3 opacity-60" /> :
           c.getIsSorted() === 'desc' ? <ArrowDown className="w-3 h-3 opacity-60" /> :
           <ArrowUpDown className="w-3 h-3 opacity-20" />}
        </button>
      ),
      cell: ({ getValue }) => (
        <div className={columnAlign(col.type, col.align)}>
          {formatCell(getValue(), col.type)}
        </div>
      ),
    })),
    [columns],
  )

  const table = useReactTable({
    data: rows,
    columns: tanstackColumns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: 'includesString',
  })

  const filteredCount = table.getFilteredRowModel().rows.length

  return (
    <ActionCard icon={<Table className={ICON} />} title={title} tag={`${filteredCount} row${filteredCount !== 1 ? 's' : ''}`}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Export CSV', variant: 'secondary', onClick: noop('Export CSV') },
        { label: 'Open Fullscreen', variant: 'primary', onClick: noop('Fullscreen') },
      ]}>
      {/* Search filter */}
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
        <input
          type="text"
          placeholder="Filter rows..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-md border border-foreground/[0.08] bg-foreground/[0.02] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-colors"
        />
      </div>
      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-foreground/[0.06]">
        <table className="w-full text-[13px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-foreground/[0.06] bg-foreground/[0.02]">
                {hg.headers.map((header) => (
                  <th key={header.id} className="py-2 px-3 text-[12px]">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-foreground/[0.03] last:border-0 hover:bg-foreground/[0.01] transition-colors">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="py-2 px-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="py-6 text-center text-muted-foreground text-[13px]">
                  No matching rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ActionCard>
  )
}

// --- 10. Spreadsheet ---

/** Spreadsheet column definition — same shape as DataTable but with Excel-style column letters */
interface SpreadsheetColumnDef {
  key: string
  label: string
  type?: 'text' | 'number' | 'currency' | 'percent' | 'formula'
}

/** Detect if a value looks numeric for right-alignment */
function isNumericValue(v: unknown): boolean {
  if (typeof v === 'number') return true
  if (typeof v === 'string') return /^-?[\d,]+\.?\d*%?$/.test(v.replace(/[$€£¥]/g, ''))
  return false
}

function SpreadsheetCardSample({ filename, sheetName, columns, rows }: { filename: string; sheetName: string; columns: SpreadsheetColumnDef[]; rows: Record<string, unknown>[] }) {
  // Generate Excel-style column letters: A, B, C, ...
  const colLetters = columns.map((_, i) => String.fromCharCode(65 + i))

  return (
    <ActionCard icon={<Sheet className={ICON} />} title={filename} tag={sheetName} brandColor={{ light: '#217346', dark: '#5BB381' }}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Export XLSX', variant: 'secondary', onClick: noop('Export XLSX') },
        { label: 'Open in App', variant: 'primary', onClick: noop('Open') },
      ]}>
      <div className="overflow-x-auto rounded-md border border-foreground/[0.06]">
        <table className="w-full text-[13px]">
          {/* Column letter headers */}
          <thead>
            <tr className="border-b border-foreground/[0.08] bg-foreground/[0.03]">
              <th className="text-center py-1 px-2 font-normal text-muted-foreground/40 w-10 border-r border-foreground/[0.06] text-[11px]" />
              {colLetters.map((letter) => (
                <th key={letter} className="text-center py-1 px-3 font-normal text-muted-foreground/40 border-r border-foreground/[0.06] last:border-0 text-[11px]">{letter}</th>
              ))}
            </tr>
            {/* Data header row (row 1 = column labels) */}
            <tr className="border-b border-foreground/[0.06] bg-foreground/[0.02]">
              <td className="text-center py-1.5 px-2 text-muted-foreground/40 border-r border-foreground/[0.06] text-[11px] font-mono">1</td>
              {columns.map((col) => (
                <td key={col.key} className="py-1.5 px-3 font-semibold text-foreground border-r border-foreground/[0.06] last:border-0">{col.label}</td>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-foreground/[0.03] last:border-0 hover:bg-foreground/[0.01] transition-colors">
                <td className="text-center py-1.5 px-2 text-muted-foreground/40 border-r border-foreground/[0.06] text-[11px] font-mono">{i + 2}</td>
                {columns.map((col) => {
                  const val = row[col.key]
                  const numeric = col.type === 'number' || col.type === 'currency' || col.type === 'percent' || col.type === 'formula' || isNumericValue(val)
                  return (
                    <td key={col.key} className={`py-1.5 px-3 border-r border-foreground/[0.06] last:border-0 tabular-nums ${numeric ? 'text-right' : ''} ${col.type === 'formula' ? 'text-info' : ''}`}>
                      {formatCell(val, col.type === 'formula' ? 'number' : col.type)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ActionCard>
  )
}

// --- 11. Chart ---
function ChartCardSample({ title, chartType, data }: { title: string; chartType: string; data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map(d => d.value))
  return (
    <ActionCard icon={<BarChart3 className={ICON} />} title={title} tag={chartType}
      actions={[
        { label: 'Copy Image', variant: 'ghost', onClick: noop('Copy image') },
        { label: 'Export SVG', variant: 'secondary', onClick: noop('Export SVG') },
        { label: 'Edit Data', variant: 'primary', onClick: noop('Edit data') },
      ]}>
      {chartType === 'bar' ? (
        <div className="space-y-2">
          {data.map(d => (
            <div key={d.label} className="flex items-center gap-3 text-[13px]">
              <span className="text-muted-foreground w-20 shrink-0 truncate">{d.label}</span>
              <div className="flex-1 h-6 bg-foreground/[0.03] rounded-md overflow-hidden">
                <div className="h-full bg-accent/70 rounded-md transition-all" style={{ width: `${(d.value / max) * 100}%` }} />
              </div>
              <span className="text-muted-foreground w-12 text-right tabular-nums">{d.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-end gap-3 h-40 pt-4">
          {data.map(d => (
            <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[11px] text-muted-foreground tabular-nums">{d.value}</span>
              <div className="w-full bg-accent/70 rounded-t-md transition-all" style={{ height: `${(d.value / max) * 100}%` }} />
              <span className="text-[11px] text-muted-foreground truncate w-full text-center">{d.label}</span>
            </div>
          ))}
        </div>
      )}
    </ActionCard>
  )
}

// --- 12. PDF Document ---
function PDFCardSample({ filename }: { filename: string }) {
  const [numPages, setNumPages] = useState<number>(0)
  const [pageNumber, setPageNumber] = useState(1)

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n)
  }, [])

  const file = useMemo(() => ({ url: samplePdfUrl }), [])

  return (
    <ActionCard icon={<FileText className={ICON} />} title={filename} tag={numPages ? `${numPages} pages` : 'Loading...'} brandColor={{ light: '#D32F2F', dark: '#EF5350' }}
      actions={[
        { label: 'Copy Text', variant: 'ghost', onClick: noop('Copy text') },
        { label: 'Download', variant: 'secondary', onClick: noop('Download') },
        { label: 'Open Fullscreen', variant: 'primary', onClick: noop('Fullscreen') },
      ]}>
      <div className="rounded-md border border-foreground/[0.06] bg-foreground/[0.01] overflow-hidden">
        <div className="flex justify-center bg-neutral-100 dark:bg-neutral-900">
          <Document file={file} onLoadSuccess={onLoadSuccess} loading={<div className="p-8 text-muted-foreground text-[13px]">Loading PDF...</div>}>
            <Page pageNumber={pageNumber} width={480} renderTextLayer={false} renderAnnotationLayer={false} />
          </Document>
        </div>
        {numPages > 1 && (
          <div className="flex items-center justify-center gap-3 py-2 border-t border-foreground/[0.06]">
            <button onClick={() => setPageNumber((p) => Math.max(1, p - 1))} disabled={pageNumber <= 1} className="px-2 py-0.5 text-[12px] rounded hover:bg-muted disabled:opacity-30">Prev</button>
            <span className="text-[12px] text-muted-foreground">{pageNumber} / {numPages}</span>
            <button onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))} disabled={pageNumber >= numPages} className="px-2 py-0.5 text-[12px] rounded hover:bg-muted disabled:opacity-30">Next</button>
          </div>
        )}
      </div>
    </ActionCard>
  )
}

// --- 13. Image ---
function ImageCardSample({ filename, dimensions, alt }: { filename: string; dimensions: string; alt: string }) {
  return (
    <ActionCard icon={<ImageIcon className={ICON} />} title={filename} tag={dimensions}
      actions={[
        { label: 'Copy Image', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Download', variant: 'secondary', onClick: noop('Download') },
        { label: 'Open Fullscreen', variant: 'primary', onClick: noop('Fullscreen') },
      ]}>
      <div className="rounded-md border border-foreground/[0.06] overflow-hidden">
        <img src={sampleImageUrl} alt={alt} className="w-full h-auto object-cover" />
      </div>
    </ActionCard>
  )
}

// --- 14. Pull Request ---
function PRCardSample({ number, title, branch, baseBranch, additions, deletions, reviewers, checks }: { number: number; title: string; branch: string; baseBranch: string; additions: number; deletions: number; reviewers: string[]; checks: string }) {
  return (
    <ActionCard icon={<GitPullRequest className={ICON} />} title={title} tag={`#${number}`} brandColor={BRAND.github}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'View on GitHub', variant: 'secondary', onClick: noop('View') },
        { label: 'Create PR', variant: 'primary', onClick: noop('Create PR') },
      ]}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="px-2 py-0.5 rounded-md bg-accent/10 text-accent font-mono text-[11px]">{branch}</span>
          <span className="text-muted-foreground">into</span>
          <span className="px-2 py-0.5 rounded-md bg-foreground/5 font-mono text-[11px]">{baseBranch}</span>
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <span className="text-success font-mono">+{additions}</span>
          <span className="text-destructive font-mono">-{deletions}</span>
          <span className="text-muted-foreground">·</span>
          <StatusBadge label={checks} color={checks === 'Passing' ? 'success' : checks === 'Failing' ? 'destructive' : 'info'} />
        </div>
        <MetaRow label="Reviewers" value={reviewers.join(', ')} />
      </div>
    </ActionCard>
  )
}

// --- 15. API Request ---
function APIRequestCardSample({ method, url, body, statusCode }: { method: string; url: string; body?: string; statusCode?: number }) {
  const methodColors: Record<string, string> = { GET: 'bg-success/10 text-success', POST: 'bg-accent/10 text-accent', PUT: 'bg-info/10 text-info', DELETE: 'bg-destructive/10 text-destructive' }
  return (
    <ActionCard icon={<Globe className={ICON} />} title="API Request"
      actions={[
        { label: 'Copy as cURL', variant: 'ghost', onClick: noop('Copy cURL') },
        { label: 'Send Request', variant: 'primary', onClick: noop('Send') },
      ]}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${methodColors[method] ?? 'bg-foreground/5'}`}>{method}</span>
          <span className="text-[13px] font-mono truncate">{url}</span>
          {statusCode && <StatusBadge label={`${statusCode}`} color={statusCode < 400 ? 'success' : 'destructive'} />}
        </div>
        {body && <CodeBlock>{body}</CodeBlock>}
      </div>
    </ActionCard>
  )
}

// --- 16. Database Query ---
function DBQueryCardSample({ database, query, resultHeaders, resultRows }: { database: string; query: string; resultHeaders: string[]; resultRows: string[][] }) {
  return (
    <ActionCard icon={<Database className={ICON} />} title="Database Query" tag={database}
      actions={[
        { label: 'Copy SQL', variant: 'ghost', onClick: noop('Copy SQL') },
        { label: 'Export Results', variant: 'secondary', onClick: noop('Export') },
        { label: 'Run Query', variant: 'primary', onClick: noop('Run query') },
      ]}>
      <div className="space-y-3">
        <CodeBlock>{query}</CodeBlock>
        {resultHeaders.length > 0 && (
          <>
            <div className="text-[11px] text-muted-foreground">{resultRows.length} rows returned</div>
            <SimpleTable headers={resultHeaders} rows={resultRows} />
          </>
        )}
      </div>
    </ActionCard>
  )
}

// --- 17. JSON / Config ---
function JSONConfigCardSample({ title, content }: { title: string; content: string }) {
  return (
    <ActionCard icon={<Braces className={ICON} />} title={title}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Validate', variant: 'secondary', onClick: noop('Validate') },
        { label: 'Apply Config', variant: 'primary', onClick: noop('Apply') },
      ]}>
      <CodeBlock>{content}</CodeBlock>
    </ActionCard>
  )
}

// --- 18. Deployment ---
function DeploymentCardSample({ environment, commit, status, statusColor, url, branch }: { environment: string; commit: string; status: string; statusColor: 'success' | 'info' | 'destructive'; url: string; branch: string }) {
  return (
    <ActionCard icon={<Rocket className={ICON} />} title="Deployment" tag={<StatusBadge label={status} color={statusColor} /> as unknown as string} brandColor={BRAND.vercel}
      actions={[
        { label: 'View Logs', variant: 'ghost', onClick: noop('View logs') },
        { label: 'Rollback', variant: 'secondary', onClick: noop('Rollback') },
        { label: 'Deploy', variant: 'primary', onClick: noop('Deploy') },
      ]}>
      <div className="space-y-2">
        <MetaRow label="Environment" value={environment} />
        <MetaRow label="Branch" value={branch} />
        <MetaRow label="Commit" value={commit} />
        <MetaRow label="URL" value={url} />
      </div>
    </ActionCard>
  )
}

// --- 19. Document Draft ---
function DocumentCardSample({ title, format, content, tags }: { title: string; format: string; content: string; tags: string[] }) {
  return (
    <ActionCard icon={<FileEdit className={ICON} />} title="Document" tag={format} brandColor={BRAND.notion}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Export Markdown', variant: 'secondary', onClick: noop('Export MD') },
        { label: 'Save to Craft', variant: 'primary', onClick: noop('Save') },
      ]}>
      <div className="space-y-3">
        <div className="font-medium text-[15px]">{title}</div>
        <div className="text-[13px] text-muted-foreground leading-relaxed whitespace-pre-wrap">{content}</div>
        {tags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap pt-1">
            {tags.map(t => <span key={t} className="px-2 py-0.5 rounded-full bg-foreground/5 text-[11px] text-muted-foreground">{t}</span>)}
          </div>
        )}
      </div>
    </ActionCard>
  )
}

// --- 20. Meeting Notes ---
function MeetingNotesCardSample({ title, date, attendees, decisions, actionItems }: { title: string; date: string; attendees: string[]; decisions: string[]; actionItems: { task: string; owner: string }[] }) {
  return (
    <ActionCard icon={<Users className={ICON} />} title={title} tag={date}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Share via Slack', variant: 'secondary', onClick: noop('Share') },
        { label: 'Create Tasks', variant: 'primary', onClick: noop('Create tasks') },
      ]}>
      <div className="space-y-4 text-[13px]">
        <MetaRow label="Attendees" value={attendees.join(', ')} />
        <div className="space-y-1.5">
          <div className="font-medium text-foreground">Key Decisions</div>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            {decisions.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
        <div className="space-y-1.5">
          <div className="font-medium text-foreground">Action Items</div>
          {actionItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded border border-foreground/20 shrink-0" />
              <span className="flex-1">{item.task}</span>
              <span className="text-muted-foreground shrink-0">{item.owner}</span>
            </div>
          ))}
        </div>
      </div>
    </ActionCard>
  )
}

// --- 21. Link Preview ---
function LinkPreviewCardSample({ url, title, description, domain, imageAlt }: { url: string; title: string; description: string; domain: string; imageAlt?: string }) {
  return (
    <ActionCard icon={<Link className={ICON} />} title={domain}
      actions={[
        { label: 'Copy Link', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Save Bookmark', variant: 'secondary', onClick: noop('Save') },
        { label: 'Open', variant: 'primary', onClick: noop('Open') },
      ]}>
      <div className="space-y-3">
        {imageAlt && (
          <div className="rounded-md border border-foreground/[0.06] bg-foreground/[0.02] h-32 flex items-center justify-center">
            <span className="text-muted-foreground text-[11px]">{imageAlt}</span>
          </div>
        )}
        <div className="font-medium text-[14px]">{title}</div>
        <div className="text-[13px] text-muted-foreground leading-relaxed">{description}</div>
        <div className="text-[11px] text-muted-foreground font-mono truncate">{url}</div>
      </div>
    </ActionCard>
  )
}

// --- 22. Notification / Alert ---
function NotificationCardSample({ severity, title, description, resource, timestamp }: { severity: 'critical' | 'warning' | 'info'; title: string; description: string; resource: string; timestamp: string }) {
  const tints = { critical: 'var(--destructive)', warning: 'var(--info)', info: 'var(--accent)' }
  const icons = { critical: <Bell className={ICON} />, warning: <Bell className={ICON} />, info: <Bell className={ICON} /> }
  const badgeColors = { critical: 'destructive' as const, warning: 'info' as const, info: 'accent' as const }
  return (
    <ActionCard icon={icons[severity]} title="Alert" tag={<StatusBadge label={severity.toUpperCase()} color={badgeColors[severity]} /> as unknown as string} brandColor={tints[severity]}
      actions={[
        { label: 'Silence', variant: 'ghost', onClick: noop('Silence') },
        { label: 'Escalate', variant: 'secondary', onClick: noop('Escalate') },
        { label: 'Acknowledge', variant: 'primary', onClick: noop('Acknowledge') },
      ]}>
      <div className="space-y-3">
        <div className="font-medium text-[14px]">{title}</div>
        <div className="text-[13px] text-muted-foreground leading-relaxed">{description}</div>
        <div className="space-y-2">
          <MetaRow label="Resource" value={resource} />
          <MetaRow label="Time" value={timestamp} />
        </div>
      </div>
    </ActionCard>
  )
}

// --- 23. File Attachment ---
function FileAttachmentCardSample({ filename, size, type, uploadedAt }: { filename: string; size: string; type: string; uploadedAt: string }) {
  return (
    <ActionCard icon={<Paperclip className={ICON} />} title={filename} tag={size}
      actions={[
        { label: 'Share Link', variant: 'ghost', onClick: noop('Share') },
        { label: 'Open', variant: 'secondary', onClick: noop('Open') },
        { label: 'Download', variant: 'primary', onClick: noop('Download') },
      ]}>
      <div className="space-y-2">
        <MetaRow label="Type" value={type} />
        <MetaRow label="Size" value={size} />
        <MetaRow label="Uploaded" value={uploadedAt} />
      </div>
    </ActionCard>
  )
}

// --- 24. Diff / Comparison ---
function DiffCardSample({ title, additions, deletions, hunks }: { title: string; additions: number; deletions: number; hunks: { type: '+' | '-' | ' '; line: string }[] }) {
  return (
    <ActionCard icon={<GitCompare className={ICON} />} title={title} tag={`+${additions} -${deletions}`}
      actions={[
        { label: 'Copy Diff', variant: 'ghost', onClick: noop('Copy diff') },
        { label: 'View Full', variant: 'secondary', onClick: noop('View full') },
        { label: 'Apply Changes', variant: 'primary', onClick: noop('Apply') },
      ]}>
      <div className="rounded-md border border-foreground/[0.06] overflow-hidden">
        {hunks.map((h, i) => (
          <div key={i} className={`px-3 py-0.5 font-mono text-[12px] ${h.type === '+' ? 'bg-success/5 text-success' : h.type === '-' ? 'bg-destructive/5 text-destructive' : 'text-muted-foreground'}`}>
            <span className="select-none opacity-50 mr-2">{h.type}</span>{h.line}
          </div>
        ))}
      </div>
    </ActionCard>
  )
}

// --- 25. Cron / Schedule ---
function CronCardSample({ name, expression, humanReadable, nextRuns, lastStatus }: { name: string; expression: string; humanReadable: string; nextRuns: string[]; lastStatus: string }) {
  return (
    <ActionCard icon={<Clock className={ICON} />} title={name} tag={humanReadable}
      actions={[
        { label: 'Disable', variant: 'ghost', onClick: noop('Disable') },
        { label: 'Edit Schedule', variant: 'secondary', onClick: noop('Edit') },
        { label: 'Run Now', variant: 'primary', onClick: noop('Run now') },
      ]}>
      <div className="space-y-3">
        <div className="px-3 py-2 rounded-md bg-foreground/[0.03] border border-foreground/[0.06] font-mono text-[13px]">{expression}</div>
        <MetaRow label="Last Run" value={lastStatus} />
        <div className="space-y-1.5">
          <div className="text-[13px] font-medium">Next 3 runs</div>
          {nextRuns.map((r, i) => <div key={i} className="text-[13px] text-muted-foreground">{r}</div>)}
        </div>
      </div>
    </ActionCard>
  )
}

// --- 26. Research Summary ---
function ResearchSummaryCardSample({ topic, findings, sourceCount, confidence, sources }: { topic: string; findings: string[]; sourceCount: number; confidence: number; sources: string[] }) {
  return (
    <ActionCard icon={<BookOpen className={ICON} />} title="Research Summary" tag={topic}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Expand Sources', variant: 'secondary', onClick: noop('Expand') },
        { label: 'Save to Craft', variant: 'primary', onClick: noop('Save') },
      ]}>
      <div className="space-y-4 text-[13px]">
        <div className="space-y-1.5">
          <div className="font-medium">Key Findings</div>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            {findings.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Confidence</span>
            <div className="w-20 h-1.5 bg-foreground/[0.06] rounded-full overflow-hidden">
              <div className="h-full bg-success rounded-full" style={{ width: `${confidence}%` }} />
            </div>
            <span className="text-muted-foreground tabular-nums">{confidence}%</span>
          </div>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{sourceCount} sources</span>
        </div>
        <div className="space-y-1">
          <div className="font-medium">Sources</div>
          {sources.map((s, i) => <div key={i} className="text-muted-foreground truncate">{s}</div>)}
        </div>
      </div>
    </ActionCard>
  )
}

// --- 27. Comparison / Decision Matrix ---
function ComparisonCardSample({ title, options, criteria }: { title: string; options: string[]; criteria: { name: string; scores: number[] }[] }) {
  const totals = options.map((_, oi) => criteria.reduce((sum, c) => sum + c.scores[oi], 0))
  const maxTotal = Math.max(...totals)
  return (
    <ActionCard icon={<Scale className={ICON} />} title={title} tag={`${options.length} options`}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Export CSV', variant: 'secondary', onClick: noop('Export') },
        { label: 'Save Decision', variant: 'primary', onClick: noop('Save') },
      ]}>
      <SimpleTable
        headers={['Criteria', ...options]}
        rows={[
          ...criteria.map(c => [c.name, ...c.scores.map(s => `${s}/10`)]),
          ['**Total**', ...totals.map((t, i) => t === maxTotal ? `**${t}**` : `${t}`)],
        ]}
      />
    </ActionCard>
  )
}

// --- 28. Translation ---
function TranslationCardSample({ sourceLang, targetLang, original, translated, alternatives }: { sourceLang: string; targetLang: string; original: string; translated: string; alternatives?: string[] }) {
  return (
    <ActionCard icon={<Languages className={ICON} />} title="Translation" tag={`${sourceLang} → ${targetLang}`}
      actions={[
        { label: 'Switch Languages', variant: 'ghost', onClick: noop('Switch') },
        { label: 'Send via Email', variant: 'secondary', onClick: noop('Send') },
        { label: 'Copy Translation', variant: 'primary', onClick: noop('Copy') },
      ]}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{sourceLang}</div>
          <div className="text-[13px] leading-relaxed p-3 rounded-md bg-foreground/[0.02] border border-foreground/[0.06]">{original}</div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{targetLang}</div>
          <div className="text-[13px] leading-relaxed p-3 rounded-md bg-foreground/[0.02] border border-foreground/[0.06]">{translated}</div>
        </div>
        {alternatives && alternatives.length > 0 && (
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">Alternatives</div>
            {alternatives.map((a, i) => <div key={i} className="text-[13px] text-muted-foreground">{a}</div>)}
          </div>
        )}
      </div>
    </ActionCard>
  )
}

// --- 29. Contact / Person ---
function ContactCardSample({ name, role, company, email, slackHandle, timezone, recentContext }: { name: string; role: string; company: string; email: string; slackHandle: string; timezone: string; recentContext: string }) {
  return (
    <ActionCard icon={<UserCircle className={ICON} />} title={name} tag={role}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Message on Slack', variant: 'secondary', onClick: noop('Slack') },
        { label: 'Send Email', variant: 'primary', onClick: noop('Email') },
      ]}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent font-medium text-[15px]">
            {name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <div className="font-medium text-[14px]">{name}</div>
            <div className="text-[12px] text-muted-foreground">{role} at {company}</div>
          </div>
        </div>
        <div className="space-y-2">
          <MetaRow label="Email" value={email} />
          <MetaRow label="Slack" value={slackHandle} />
          <MetaRow label="Timezone" value={timezone} />
        </div>
        <div className="space-y-1">
          <div className="text-[13px] font-medium">Recent Context</div>
          <div className="text-[13px] text-muted-foreground">{recentContext}</div>
        </div>
      </div>
    </ActionCard>
  )
}

// --- 30. Kanban / Status Board ---
function KanbanCardSample({ title, columns }: { title: string; columns: { name: string; count: number; color: 'muted' | 'info' | 'success' | 'accent' | 'destructive'; items?: string[] }[] }) {
  const total = columns.reduce((s, c) => s + c.count, 0)
  return (
    <ActionCard icon={<LayoutGrid className={ICON} />} title={title} tag={`${total} items`}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Create Report', variant: 'secondary', onClick: noop('Report') },
        { label: 'Open in Linear', variant: 'primary', onClick: noop('Open') },
      ]}>
      <div className="flex gap-2">
        {columns.map(col => (
          <div key={col.name} className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-muted-foreground truncate">{col.name}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{col.count}</span>
            </div>
            <div className="space-y-1">
              {(col.items ?? []).slice(0, 3).map((item, i) => (
                <div key={i} className="px-2 py-1.5 rounded-md bg-foreground/[0.03] border border-foreground/[0.06] text-[11px] truncate">{item}</div>
              ))}
              {col.count > 3 && <div className="text-[10px] text-muted-foreground text-center">+{col.count - 3} more</div>}
            </div>
          </div>
        ))}
      </div>
    </ActionCard>
  )
}

// --- 31. Timeline / Changelog ---
function TimelineCardSample({ title, dateRange, events }: { title: string; dateRange: string; events: { time: string; label: string; type: 'commit' | 'deploy' | 'incident' | 'milestone' }[] }) {
  const typeStyles = {
    commit: 'bg-foreground/10 text-foreground',
    deploy: 'bg-success/10 text-success',
    incident: 'bg-destructive/10 text-destructive',
    milestone: 'bg-accent/10 text-accent',
  }
  return (
    <ActionCard icon={<GitCommit className={ICON} />} title={title} tag={dateRange}
      actions={[
        { label: 'Copy', variant: 'ghost', onClick: noop('Copy') },
        { label: 'Filter', variant: 'secondary', onClick: noop('Filter') },
        { label: 'Export', variant: 'primary', onClick: noop('Export') },
      ]}>
      <div className="relative pl-6 space-y-3">
        <div className="absolute left-[7px] top-1 bottom-1 w-px bg-foreground/10" />
        {events.map((e, i) => (
          <div key={i} className="relative flex items-start gap-3">
            <div className={`absolute left-[-20px] top-1 w-3.5 h-3.5 rounded-full ${typeStyles[e.type]} flex items-center justify-center`}>
              <div className="w-1.5 h-1.5 rounded-full bg-current" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px]">{e.label}</div>
              <div className="text-[11px] text-muted-foreground">{e.time}</div>
            </div>
          </div>
        ))}
      </div>
    </ActionCard>
  )
}

// ============================================================================
// Playground Registry
// ============================================================================

export const actionCardsComponents: ComponentEntry[] = [
  // 1. Email
  {
    id: 'action-card-email', name: 'Email Draft', category: 'Action Cards',
    description: 'Email draft card with Gmail branding and Send action',
    component: EmailCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'to', description: 'Recipient', control: { type: 'string', placeholder: 'john@example.com' }, defaultValue: 'john.doe@example.com' },
      { name: 'subject', description: 'Subject', control: { type: 'string', placeholder: 'Subject line' }, defaultValue: 'Q1 Performance Report' },
      { name: 'sourceConnected', description: 'Gmail connected', control: { type: 'boolean' }, defaultValue: true },
    ],
    variants: [
      { name: 'Default', description: 'Standard email', props: { to: 'john.doe@example.com', subject: 'Q1 Performance Report Review', body: 'Hi John,\n\nI\'ve completed the Q1 performance report. Key highlights:\n\n- Revenue increased 15% YoY\n- Customer retention improved to 94%\n- Three new enterprise clients onboarded\n\nBest regards,\nAlice', sourceConnected: true } },
      { name: 'Disconnected', description: 'Gmail not connected', props: { to: 'team@company.com', subject: 'Sprint Retro Notes', body: 'Hey team,\n\nAction items:\n1. Improve CI pipeline speed\n2. Add monitoring for payment service\n3. Schedule design review for v2', sourceConnected: false } },
    ],
    mockData: () => ({ body: 'Hi John,\n\nReport attached.\n\nBest,\nAlice' }),
  },

  // 2. Terminal Command
  {
    id: 'action-card-command', name: 'Terminal Command', category: 'Action Cards',
    description: 'Terminal command card with Run action',
    component: CommandCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'command', description: 'Shell command', control: { type: 'string', placeholder: 'npm install ...' }, defaultValue: 'npm install @tanstack/react-query' },
      { name: 'description', description: 'Description', control: { type: 'string', placeholder: '' }, defaultValue: '' },
    ],
    variants: [
      { name: 'npm install', description: 'Package install', props: { command: 'npm install @tanstack/react-query', description: 'Install dependencies' } },
      { name: 'Git', description: 'Git workflow', props: { command: 'git checkout -b feat/action-cards && git add -A && git commit -m "Add action cards"' } },
      { name: 'Docker', description: 'Docker deploy', props: { command: 'docker compose -f docker-compose.prod.yml up -d --build', description: 'Deploy production' } },
    ],
    mockData: () => ({}),
  },

  // 3. Slack Message
  {
    id: 'action-card-slack', name: 'Slack Message', category: 'Action Cards',
    description: 'Slack message card with Send action',
    component: SlackMessageCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'channel', description: 'Channel', control: { type: 'string', placeholder: 'engineering' }, defaultValue: 'engineering' },
      { name: 'sourceConnected', description: 'Slack connected', control: { type: 'boolean' }, defaultValue: true },
    ],
    variants: [
      { name: 'Default', description: 'Team update', props: { channel: 'engineering', message: 'Hey team! API migration update:\n\n- Auth service: Deployed to staging\n- User service: ~80% complete\n- Payment service: Starting next week', sourceConnected: true } },
      { name: 'Disconnected', description: 'Slack not connected', props: { channel: 'general', message: 'Reminder: All-hands tomorrow at 2 PM PST.', sourceConnected: false } },
    ],
    mockData: () => ({ message: 'Quick update on the migration.' }),
  },

  // 4. Code File
  {
    id: 'action-card-code', name: 'Code File', category: 'Action Cards',
    description: 'Code file card with Create File action',
    component: CodeFileCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'filename', description: 'Filename', control: { type: 'string', placeholder: 'utils.ts' }, defaultValue: 'formatDate.ts' },
      { name: 'language', description: 'Language', control: { type: 'string', placeholder: 'TypeScript' }, defaultValue: 'TypeScript' },
    ],
    variants: [
      { name: 'TypeScript', description: 'Utility function', props: { filename: 'src/utils/formatDate.ts', language: 'TypeScript', code: 'export function formatDate(date: Date, locale = \'en-US\'): string {\n  return new Intl.DateTimeFormat(locale, {\n    year: \'numeric\',\n    month: \'long\',\n    day: \'numeric\',\n  }).format(date)\n}' } },
      { name: 'Python', description: 'Data processing', props: { filename: 'scripts/process.py', language: 'Python', code: 'import pandas as pd\n\ndef process_csv(path: str) -> None:\n    df = pd.read_csv(path)\n    df = df.drop_duplicates().dropna(subset=[\'id\'])\n    df.to_csv(path, index=False)' } },
    ],
    mockData: () => ({ code: 'export const hello = "world"' }),
  },

  // 5. Calendar Event
  {
    id: 'action-card-calendar', name: 'Calendar Event', category: 'Action Cards',
    description: 'Calendar event with Create Event action',
    component: CalendarEventCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'title', description: 'Event title', control: { type: 'string', placeholder: 'Meeting' }, defaultValue: 'Sprint Planning' },
      { name: 'sourceConnected', description: 'Calendar connected', control: { type: 'boolean' }, defaultValue: true },
    ],
    variants: [
      { name: 'Default', description: 'Standard meeting', props: { title: 'Sprint Planning', date: 'Tue, Feb 10, 2026', time: '2:00 PM - 3:00 PM PST', location: 'Zoom', attendees: ['alice@co.com', 'bob@co.com'], sourceConnected: true } },
      { name: 'Disconnected', description: 'Calendar not connected', props: { title: '1:1 with Manager', date: 'Wed, Feb 11, 2026', time: '10:00 AM - 10:30 AM PST', location: 'Room B', attendees: ['manager@co.com'], sourceConnected: false } },
    ],
    mockData: () => ({ date: 'Tue, Feb 10', time: '2-3 PM', location: 'Zoom', attendees: ['alice@co.com'] }),
  },

  // 6. Payment Link
  {
    id: 'action-card-payment', name: 'Payment Link', category: 'Action Cards',
    description: 'Stripe payment link card',
    component: PaymentLinkCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'amount', description: 'Amount', control: { type: 'string', placeholder: '$99' }, defaultValue: '$99.00' },
      { name: 'currency', description: 'Currency', control: { type: 'string', placeholder: 'USD' }, defaultValue: 'USD' },
      { name: 'sourceConnected', description: 'Stripe connected', control: { type: 'boolean' }, defaultValue: true },
    ],
    variants: [
      { name: 'Default', description: 'Monthly sub', props: { amount: '$99.00', currency: 'USD', description: 'Pro Plan — Monthly subscription', sourceConnected: true } },
      { name: 'Disconnected', description: 'Stripe not connected', props: { amount: '$499.00', currency: 'USD', description: 'Enterprise Plan — Annual', sourceConnected: false } },
    ],
    mockData: () => ({ description: 'Pro Plan' }),
  },

  // 7. Form Input
  {
    id: 'action-card-form', name: 'Form Input', category: 'Action Cards',
    description: 'Interactive form with text inputs, selects, and textareas',
    component: FormInputCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'title', description: 'Form title', control: { type: 'string', placeholder: 'Form title' }, defaultValue: 'New Issue' },
    ],
    variants: [
      { name: 'Issue Form', description: 'Bug report form', props: { title: 'Report a Bug', fields: [{ label: 'Title', type: 'text', placeholder: 'Brief description...' }, { label: 'Priority', type: 'select', placeholder: 'Select priority', options: ['Critical', 'High', 'Medium', 'Low'] }, { label: 'Description', type: 'textarea', placeholder: 'Steps to reproduce...' }] } },
      { name: 'Contact Form', description: 'Simple contact form', props: { title: 'Contact Us', fields: [{ label: 'Name', type: 'text', placeholder: 'Your name' }, { label: 'Email', type: 'text', placeholder: 'your@email.com' }, { label: 'Message', type: 'textarea', placeholder: 'How can we help?' }] } },
    ],
    mockData: () => ({ fields: [{ label: 'Name', type: 'text', placeholder: 'Name' }] }),
  },

  // 8. Issue / Task
  {
    id: 'action-card-issue', name: 'Issue / Task', category: 'Action Cards',
    description: 'Project management issue card with Linear/Jira branding',
    component: IssueCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'issueKey', description: 'Issue key', control: { type: 'string', placeholder: 'ENG-123' }, defaultValue: 'ENG-142' },
      { name: 'sourceConnected', description: 'Source connected', control: { type: 'boolean' }, defaultValue: true },
    ],
    variants: [
      { name: 'In Progress', description: 'Active issue', props: { issueKey: 'ENG-142', title: 'Add action card components to playground', description: 'Implement reusable ActionCard component with brand theming support and create playground entries for all card types.', status: 'In Progress', statusColor: 'info', priority: 'High', assignee: 'Alice Chen', labels: ['frontend', 'design-system'], sourceConnected: true } },
      { name: 'Bug Report', description: 'Critical bug', props: { issueKey: 'BUG-89', title: 'Payment webhook fails for EUR currency', description: 'Stripe webhooks return 400 for payments in EUR. USD works fine. Affects ~12% of transactions.', status: 'Critical', statusColor: 'destructive', priority: 'Urgent', assignee: 'Bob Smith', labels: ['bug', 'payments', 'p0'], sourceConnected: true } },
    ],
    mockData: () => ({ description: 'Implement feature', status: 'Todo', statusColor: 'muted', priority: 'Medium', assignee: 'Unassigned', labels: [] }),
  },

  // 9. Data Table (sortable + filterable, typed columns)
  {
    id: 'action-card-datatable', name: 'Data Table', category: 'Action Cards',
    description: 'Sortable & filterable table with typed columns (click headers to sort, use search to filter)',
    component: DataTableCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'title', description: 'Table title', control: { type: 'string', placeholder: 'Results' }, defaultValue: 'Sales by Region' },
    ],
    variants: [
      {
        name: 'Sales Data', description: 'Revenue table with typed columns',
        props: {
          title: 'Sales by Region — Q1 2026',
          columns: [
            { key: 'region', label: 'Region', type: 'text' },
            { key: 'revenue', label: 'Revenue', type: 'currency' },
            { key: 'growth', label: 'YoY Growth', type: 'percent' },
            { key: 'customers', label: 'Customers', type: 'number' },
            { key: 'onTarget', label: 'On Target', type: 'boolean' },
          ],
          rows: [
            { region: 'North America', revenue: 4200000, growth: 0.152, customers: 342, onTarget: true },
            { region: 'Europe (EMEA)', revenue: 2890000, growth: 0.081, customers: 218, onTarget: true },
            { region: 'Asia Pacific', revenue: 1650000, growth: 0.224, customers: 156, onTarget: false },
            { region: 'Latin America', revenue: 940000, growth: 0.312, customers: 89, onTarget: true },
            { region: 'Middle East', revenue: 520000, growth: -0.045, customers: 41, onTarget: false },
            { region: 'Africa', revenue: 180000, growth: 0.670, customers: 23, onTarget: false },
          ],
        },
      },
      {
        name: 'API Keys', description: 'Configuration table with badge status',
        props: {
          title: 'API Keys',
          columns: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'prefix', label: 'Key Prefix', type: 'text' },
            { key: 'created', label: 'Created', type: 'date' },
            { key: 'status', label: 'Status', type: 'badge' },
          ],
          rows: [
            { name: 'Production', prefix: 'sk_live_...4x2k', created: 'Jan 15, 2026', status: 'Active' },
            { name: 'Staging', prefix: 'sk_test_...9m3p', created: 'Dec 3, 2025', status: 'Active' },
            { name: 'Development', prefix: 'sk_dev_...1a7q', created: 'Nov 20, 2025', status: 'Revoked' },
            { name: 'CI/CD Pipeline', prefix: 'sk_ci_...8f3r', created: 'Feb 1, 2026', status: 'Active' },
          ],
        },
      },
    ],
    mockData: () => ({
      columns: [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }],
      rows: [{ name: 'Foo', value: 'Bar' }],
    }),
  },

  // 10. Spreadsheet (Excel-style with typed columns, row numbers, column letters)
  {
    id: 'action-card-spreadsheet', name: 'Spreadsheet', category: 'Action Cards',
    description: 'Excel-style grid with column letters, row numbers, and formatted cells',
    component: SpreadsheetCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'filename', description: 'Filename', control: { type: 'string', placeholder: 'data.xlsx' }, defaultValue: 'Q1_Revenue.xlsx' },
      { name: 'sheetName', description: 'Sheet name', control: { type: 'string', placeholder: 'Sheet1' }, defaultValue: 'Summary' },
    ],
    variants: [
      {
        name: 'Revenue Sheet', description: 'Financial spreadsheet with formulas',
        props: {
          filename: 'Q1_Revenue.xlsx', sheetName: 'Summary',
          columns: [
            { key: 'region', label: 'Region', type: 'text' },
            { key: 'revenue', label: 'Q1 Revenue', type: 'currency' },
            { key: 'cost', label: 'Q1 Cost', type: 'currency' },
            { key: 'margin', label: 'Margin', type: 'percent' },
            { key: 'headcount', label: 'HC', type: 'number' },
          ],
          rows: [
            { region: 'North', revenue: 1200000, cost: 840000, margin: 0.30, headcount: 45 },
            { region: 'South', revenue: 890000, cost: 623000, margin: 0.30, headcount: 32 },
            { region: 'East', revenue: 650000, cost: 487500, margin: 0.25, headcount: 28 },
            { region: 'West', revenue: 340000, cost: 238000, margin: 0.30, headcount: 15 },
            { region: 'Total', revenue: 3080000, cost: 2188500, margin: 0.289, headcount: 120 },
          ],
        },
      },
      {
        name: 'Employee Directory', description: 'Text-heavy spreadsheet',
        props: {
          filename: 'Team_Directory.xlsx', sheetName: 'Engineering',
          columns: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'role', label: 'Role', type: 'text' },
            { key: 'level', label: 'Level', type: 'text' },
            { key: 'salary', label: 'Salary', type: 'currency' },
            { key: 'startDate', label: 'Start Date', type: 'text' },
          ],
          rows: [
            { name: 'Alice Chen', role: 'Staff Engineer', level: 'L6', salary: 245000, startDate: 'Mar 2022' },
            { name: 'Bob Patel', role: 'Senior Engineer', level: 'L5', salary: 198000, startDate: 'Jul 2023' },
            { name: 'Carol Wu', role: 'Engineering Manager', level: 'M1', salary: 220000, startDate: 'Jan 2021' },
            { name: 'Dan Kim', role: 'Engineer', level: 'L4', salary: 165000, startDate: 'Sep 2024' },
          ],
        },
      },
    ],
    mockData: () => ({
      columns: [{ key: 'a', label: 'Name' }, { key: 'b', label: 'Value' }],
      rows: [{ a: 'Test', b: '123' }],
    }),
  },

  // 11. Chart
  {
    id: 'action-card-chart', name: 'Chart', category: 'Action Cards',
    description: 'Data visualization with bar/column charts',
    component: ChartCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'title', description: 'Chart title', control: { type: 'string', placeholder: 'Revenue' }, defaultValue: 'Revenue by Region' },
      { name: 'chartType', description: 'Chart type', control: { type: 'select', options: [{ label: 'Bar', value: 'bar' }, { label: 'Column', value: 'column' }] }, defaultValue: 'bar' },
    ],
    variants: [
      { name: 'Horizontal Bar', description: 'Revenue bars', props: { title: 'Revenue by Region', chartType: 'bar', data: [{ label: 'North America', value: 1200 }, { label: 'Europe', value: 890 }, { label: 'Asia Pacific', value: 650 }, { label: 'Latin America', value: 340 }] } },
      { name: 'Vertical Column', description: 'Monthly data', props: { title: 'Monthly Active Users', chartType: 'column', data: [{ label: 'Sep', value: 12400 }, { label: 'Oct', value: 14200 }, { label: 'Nov', value: 13800 }, { label: 'Dec', value: 15600 }, { label: 'Jan', value: 17200 }] } },
    ],
    mockData: () => ({ data: [{ label: 'A', value: 100 }, { label: 'B', value: 200 }] }),
  },

  // 12. PDF Document
  {
    id: 'action-card-pdf', name: 'PDF Document', category: 'Action Cards',
    description: 'Inline PDF preview with real react-pdf rendering and page navigation',
    component: PDFCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'filename', description: 'Filename', control: { type: 'string', placeholder: 'document.pdf' }, defaultValue: 'Invoice_INV-2026-0847.pdf' },
    ],
    variants: [
      { name: 'Invoice', description: 'Real rendered invoice PDF', props: { filename: 'Invoice_INV-2026-0847.pdf' } },
    ],
  },

  // 13. Image
  {
    id: 'action-card-image', name: 'Image', category: 'Action Cards',
    description: 'Inline image display with real photograph',
    component: ImageCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'filename', description: 'Filename', control: { type: 'string', placeholder: 'photo.jpg' }, defaultValue: 'alpine-sunrise.jpg' },
      { name: 'dimensions', description: 'Dimensions', control: { type: 'string', placeholder: '1920x1080' }, defaultValue: '800 x 533' },
    ],
    variants: [
      { name: 'Landscape', description: 'Mountain landscape photograph', props: { filename: 'alpine-sunrise.jpg', dimensions: '800 x 533', alt: 'Alpine sunrise above the clouds' } },
    ],
    mockData: () => ({ alt: 'Mountain landscape' }),
  },

  // 14. Pull Request
  {
    id: 'action-card-pr', name: 'Pull Request', category: 'Action Cards',
    description: 'PR card with diff stats and GitHub branding',
    component: PRCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'number', description: 'PR number', control: { type: 'string', placeholder: '142' }, defaultValue: '142' },
      { name: 'title', description: 'PR title', control: { type: 'string', placeholder: 'Title' }, defaultValue: 'Add action card components' },
    ],
    variants: [
      { name: 'Default', description: 'Feature PR', props: { number: 142, title: 'Add action card components', branch: 'feat/action-cards', baseBranch: 'main', additions: 847, deletions: 23, reviewers: ['alice', 'bob'], checks: 'Passing' } },
      { name: 'Failing Checks', description: 'PR with failing CI', props: { number: 139, title: 'Fix payment webhook handling', branch: 'fix/webhook-eur', baseBranch: 'main', additions: 34, deletions: 12, reviewers: ['carol'], checks: 'Failing' } },
    ],
    mockData: () => ({ number: 1, branch: 'feat/x', baseBranch: 'main', additions: 10, deletions: 5, reviewers: [], checks: 'Pending' }),
  },

  // 15. API Request
  {
    id: 'action-card-api', name: 'API Request', category: 'Action Cards',
    description: 'HTTP request card with method badge and cURL export',
    component: APIRequestCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'method', description: 'HTTP method', control: { type: 'select', options: [{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }, { label: 'PUT', value: 'PUT' }, { label: 'DELETE', value: 'DELETE' }] }, defaultValue: 'GET' },
      { name: 'url', description: 'URL', control: { type: 'string', placeholder: 'https://api.example.com' }, defaultValue: 'https://api.example.com/users' },
    ],
    variants: [
      { name: 'GET', description: 'Simple GET request', props: { method: 'GET', url: 'https://api.stripe.com/v1/customers?limit=10', statusCode: 200 } },
      { name: 'POST with Body', description: 'POST with JSON body', props: { method: 'POST', url: 'https://api.example.com/users', body: '{\n  "name": "Alice Chen",\n  "email": "alice@company.com",\n  "role": "admin"\n}' } },
    ],
    mockData: () => ({}),
  },

  // 16. Database Query
  {
    id: 'action-card-db', name: 'Database Query', category: 'Action Cards',
    description: 'SQL query card with result preview',
    component: DBQueryCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'database', description: 'Database name', control: { type: 'string', placeholder: 'production' }, defaultValue: 'production' },
    ],
    variants: [
      { name: 'Select Query', description: 'Query with results', props: { database: 'production', query: 'SELECT name, email, plan, created_at\nFROM users\nWHERE plan = \'enterprise\'\nORDER BY created_at DESC\nLIMIT 5;', resultHeaders: ['name', 'email', 'plan', 'created_at'], resultRows: [['Alice Chen', 'alice@acme.com', 'enterprise', '2026-01-15'], ['Bob Smith', 'bob@corp.io', 'enterprise', '2026-01-12'], ['Carol Davis', 'carol@big.co', 'enterprise', '2025-12-28']] } },
    ],
    mockData: () => ({ query: 'SELECT * FROM users LIMIT 5;', resultHeaders: [], resultRows: [] }),
  },

  // 17. JSON / Config
  {
    id: 'action-card-json', name: 'JSON / Config', category: 'Action Cards',
    description: 'Collapsible JSON/YAML config viewer',
    component: JSONConfigCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'title', description: 'Title', control: { type: 'string', placeholder: 'config.json' }, defaultValue: 'tsconfig.json' },
    ],
    variants: [
      { name: 'tsconfig', description: 'TypeScript config', props: { title: 'tsconfig.json', content: '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "moduleResolution": "bundler",\n    "strict": true,\n    "jsx": "react-jsx",\n    "outDir": "./dist",\n    "rootDir": "./src"\n  },\n  "include": ["src/**/*"],\n  "exclude": ["node_modules", "dist"]\n}' } },
      { name: 'Package.json', description: 'NPM config', props: { title: 'package.json', content: '{\n  "name": "my-app",\n  "version": "2.1.0",\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc && vite build",\n    "test": "vitest"\n  },\n  "dependencies": {\n    "react": "^19.0.0",\n    "react-dom": "^19.0.0"\n  }\n}' } },
    ],
    mockData: () => ({ content: '{ "key": "value" }' }),
  },

  // 18. Deployment
  {
    id: 'action-card-deploy', name: 'Deployment', category: 'Action Cards',
    description: 'Deployment card with environment and status info',
    component: DeploymentCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'environment', description: 'Environment', control: { type: 'string', placeholder: 'production' }, defaultValue: 'production' },
    ],
    variants: [
      { name: 'Ready to Deploy', description: 'Production deployment', props: { environment: 'Production', commit: 'a1b2c3d — Add action card components', status: 'Ready', statusColor: 'info', url: 'https://app.example.com', branch: 'main' } },
      { name: 'Deployed', description: 'Successful deployment', props: { environment: 'Staging', commit: 'f4e5d6c — Fix webhook handler', status: 'Live', statusColor: 'success', url: 'https://staging.example.com', branch: 'feat/webhooks' } },
    ],
    mockData: () => ({ commit: 'abc123', status: 'Ready', statusColor: 'info', url: 'https://example.com', branch: 'main' }),
  },

  // 19. Document Draft
  {
    id: 'action-card-document', name: 'Document Draft', category: 'Action Cards',
    description: 'Rich document card for Craft/Notion/Blog',
    component: DocumentCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'title', description: 'Document title', control: { type: 'string', placeholder: 'Title' }, defaultValue: 'Engineering Guidelines' },
      { name: 'format', description: 'Format', control: { type: 'string', placeholder: 'markdown' }, defaultValue: 'Markdown' },
    ],
    variants: [
      { name: 'RFC', description: 'Technical RFC', props: { title: 'RFC: Adopt Event Sourcing for Order System', format: 'Markdown', content: 'This RFC proposes adopting event sourcing for our order management system to improve auditability, debugging, and data consistency.\n\nThe current CRUD approach loses historical state and makes it difficult to debug production issues. Event sourcing captures every state change as an immutable event.', tags: ['rfc', 'architecture', 'backend'] } },
      { name: 'Blog Post', description: 'Blog draft', props: { title: 'Building Delightful Developer Tools', format: 'Blog Post', content: 'The best developer tools share a common trait: they respect the developer\'s time and attention. This means fast startup, minimal configuration, and predictable behavior.\n\nIn this post, I\'ll share what we learned building our CLI over the past year.', tags: ['engineering', 'devtools', 'dx'] } },
    ],
    mockData: () => ({ content: 'Document content here...', tags: [] }),
  },

  // 20. Meeting Notes
  {
    id: 'action-card-meeting', name: 'Meeting Notes', category: 'Action Cards',
    description: 'Meeting summary with decisions and action items',
    component: MeetingNotesCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'title', description: 'Meeting title', control: { type: 'string', placeholder: 'Sprint Planning' }, defaultValue: 'Sprint Planning' },
      { name: 'date', description: 'Date', control: { type: 'string', placeholder: 'Feb 10' }, defaultValue: 'Feb 10, 2026' },
    ],
    variants: [
      { name: 'Sprint Planning', description: 'Sprint planning notes', props: { title: 'Sprint 24 Planning', date: 'Feb 10, 2026', attendees: ['Alice', 'Bob', 'Carol', 'Dave'], decisions: ['Prioritize action card feature over dashboard redesign', 'Ship MVP by Feb 14, iterate after', 'Use existing shadcn components, no new deps'], actionItems: [{ task: 'Implement ActionCard component', owner: 'Alice' }, { task: 'Write playground entries for all 31 types', owner: 'Bob' }, { task: 'Update source config schema', owner: 'Carol' }, { task: 'Add brand color support to validators', owner: 'Dave' }] } },
    ],
    mockData: () => ({ attendees: ['Alice'], decisions: ['Decision 1'], actionItems: [{ task: 'Task 1', owner: 'Alice' }] }),
  },

  // 21. Link Preview
  {
    id: 'action-card-link', name: 'Link Preview', category: 'Action Cards',
    description: 'Rich link preview with OG metadata',
    component: LinkPreviewCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'url', description: 'URL', control: { type: 'string', placeholder: 'https://...' }, defaultValue: 'https://craft.do' },
    ],
    variants: [
      { name: 'Documentation', description: 'Docs link', props: { url: 'https://tanstack.com/query/latest', title: 'TanStack Query — Powerful data synchronization for React', description: 'TanStack Query gives you declarative, always-up-to-date auto-managed queries and mutations that improve your developer experience.', domain: 'tanstack.com', imageAlt: 'TanStack Query Banner' } },
      { name: 'No Image', description: 'Link without preview image', props: { url: 'https://github.com/anthropics/claude-code', title: 'Claude Code — CLI for Claude', description: 'An interactive CLI that puts AI at your fingertips in the terminal.', domain: 'github.com' } },
    ],
    mockData: () => ({ title: 'Page Title', description: 'Description', domain: 'example.com' }),
  },

  // 22. Notification / Alert
  {
    id: 'action-card-alert', name: 'Notification / Alert', category: 'Action Cards',
    description: 'System alert card with severity levels',
    component: NotificationCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'severity', description: 'Severity', control: { type: 'select', options: [{ label: 'Critical', value: 'critical' }, { label: 'Warning', value: 'warning' }, { label: 'Info', value: 'info' }] }, defaultValue: 'warning' },
    ],
    variants: [
      { name: 'Critical', description: 'Critical system alert', props: { severity: 'critical', title: 'Database connection pool exhausted', description: 'All 100 connections in the primary pool are in use. New requests are being queued. Average wait time: 4.2s.', resource: 'production/postgresql-primary', timestamp: '2 minutes ago' } },
      { name: 'Warning', description: 'Warning alert', props: { severity: 'warning', title: 'Memory usage above 85%', description: 'API server memory usage has exceeded the warning threshold. Consider scaling up or investigating potential memory leaks.', resource: 'api-server-03', timestamp: '15 minutes ago' } },
      { name: 'Info', description: 'Informational alert', props: { severity: 'info', title: 'SSL certificate renewal scheduled', description: 'The SSL certificate for app.example.com will be automatically renewed in 7 days.', resource: 'app.example.com', timestamp: '1 hour ago' } },
    ],
    mockData: () => ({ title: 'Alert', description: 'Details', resource: 'server', timestamp: 'now' }),
  },

  // 23. File Attachment
  {
    id: 'action-card-file', name: 'File Attachment', category: 'Action Cards',
    description: 'File metadata card with download actions',
    component: FileAttachmentCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'filename', description: 'Filename', control: { type: 'string', placeholder: 'file.pdf' }, defaultValue: 'Q1_Report.pdf' },
      { name: 'size', description: 'File size', control: { type: 'string', placeholder: '2.4 MB' }, defaultValue: '2.4 MB' },
    ],
    variants: [
      { name: 'PDF Report', description: 'PDF document', props: { filename: 'Q1_Revenue_Report_2026.pdf', size: '2.4 MB', type: 'PDF Document', uploadedAt: 'Feb 9, 2026 at 3:15 PM' } },
      { name: 'Zip Archive', description: 'Compressed archive', props: { filename: 'project-assets-v2.zip', size: '156 MB', type: 'ZIP Archive', uploadedAt: 'Feb 8, 2026 at 11:00 AM' } },
    ],
    mockData: () => ({ type: 'File', uploadedAt: 'Today' }),
  },

  // 24. Diff / Comparison
  {
    id: 'action-card-diff', name: 'Diff / Comparison', category: 'Action Cards',
    description: 'Unified diff view with +/- highlighting',
    component: DiffCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'title', description: 'Diff title', control: { type: 'string', placeholder: 'Changes' }, defaultValue: 'src/config.ts' },
    ],
    variants: [
      { name: 'Code Change', description: 'Typical code diff', props: { title: 'src/config.ts', additions: 4, deletions: 2, hunks: [{ type: ' ', line: 'export const config = {' }, { type: '-', line: '  apiUrl: "http://localhost:3000",' }, { type: '-', line: '  timeout: 5000,' }, { type: '+', line: '  apiUrl: process.env.API_URL ?? "http://localhost:3000",' }, { type: '+', line: '  timeout: parseInt(process.env.TIMEOUT ?? "5000"),' }, { type: '+', line: '  retries: 3,' }, { type: '+', line: '  retryDelay: 1000,' }, { type: ' ', line: '}' }] } },
    ],
    mockData: () => ({ additions: 1, deletions: 1, hunks: [{ type: '-', line: 'old' }, { type: '+', line: 'new' }] }),
  },

  // 25. Cron / Schedule
  {
    id: 'action-card-cron', name: 'Cron / Schedule', category: 'Action Cards',
    description: 'Scheduled task with cron expression and next runs',
    component: CronCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'name', description: 'Task name', control: { type: 'string', placeholder: 'Backup' }, defaultValue: 'Database Backup' },
    ],
    variants: [
      { name: 'Daily Backup', description: 'Nightly backup task', props: { name: 'Database Backup', expression: '0 2 * * *', humanReadable: 'Every day at 2:00 AM', nextRuns: ['Feb 10, 2026 at 2:00 AM', 'Feb 11, 2026 at 2:00 AM', 'Feb 12, 2026 at 2:00 AM'], lastStatus: 'Completed — Feb 9, 2:00 AM (took 4m 32s)' } },
      { name: 'Hourly Sync', description: 'Frequent sync task', props: { name: 'Data Sync', expression: '0 * * * *', humanReadable: 'Every hour', nextRuns: ['Feb 9, 2026 at 4:00 PM', 'Feb 9, 2026 at 5:00 PM', 'Feb 9, 2026 at 6:00 PM'], lastStatus: 'Completed — Feb 9, 3:00 PM (took 12s)' } },
    ],
    mockData: () => ({ expression: '* * * * *', humanReadable: 'Every minute', nextRuns: ['Now'], lastStatus: 'Never run' }),
  },

  // 26. Research Summary
  {
    id: 'action-card-research', name: 'Research Summary', category: 'Action Cards',
    description: 'Condensed research brief with confidence score and sources',
    component: ResearchSummaryCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'topic', description: 'Topic', control: { type: 'string', placeholder: 'Topic' }, defaultValue: 'React Server Components' },
    ],
    variants: [
      { name: 'Tech Research', description: 'Technology evaluation', props: { topic: 'React Server Components', findings: ['RSC reduces client bundle size by 30-50% for content-heavy pages', 'Streaming SSR enables faster Time-to-First-Byte (TTFB)', 'Works best for read-heavy pages; interactive components still need client rendering', 'Next.js App Router provides the most mature RSC implementation'], sourceCount: 12, confidence: 87, sources: ['react.dev/blog/2024/react-19', 'nextjs.org/docs/app/building-your-application', 'vercel.com/blog/understanding-react-server-components'] } },
    ],
    mockData: () => ({ findings: ['Finding 1'], sourceCount: 1, confidence: 75, sources: ['example.com'] }),
  },

  // 27. Comparison / Decision Matrix
  {
    id: 'action-card-comparison', name: 'Comparison Matrix', category: 'Action Cards',
    description: 'Decision matrix comparing options across criteria',
    component: ComparisonCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'title', description: 'Title', control: { type: 'string', placeholder: 'Comparison' }, defaultValue: 'Database Comparison' },
    ],
    variants: [
      { name: 'Database Comparison', description: 'Comparing databases', props: { title: 'Database Selection', options: ['PostgreSQL', 'MySQL', 'MongoDB'], criteria: [{ name: 'Performance', scores: [9, 8, 7] }, { name: 'Scalability', scores: [8, 7, 9] }, { name: 'Developer Experience', scores: [9, 7, 8] }, { name: 'Community Support', scores: [9, 9, 8] }, { name: 'Cost', scores: [10, 10, 7] }] } },
    ],
    mockData: () => ({ options: ['A', 'B'], criteria: [{ name: 'Score', scores: [8, 7] }] }),
  },

  // 28. Translation
  {
    id: 'action-card-translation', name: 'Translation', category: 'Action Cards',
    description: 'Multi-language translation with original and translated text',
    component: TranslationCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'sourceLang', description: 'Source language', control: { type: 'string', placeholder: 'English' }, defaultValue: 'English' },
      { name: 'targetLang', description: 'Target language', control: { type: 'string', placeholder: 'Spanish' }, defaultValue: 'Spanish' },
    ],
    variants: [
      { name: 'Business Email', description: 'Email translation', props: { sourceLang: 'English', targetLang: 'Japanese', original: 'Thank you for your interest in our enterprise plan. I\'d be happy to schedule a demo at your convenience. Please let me know your availability this week.', translated: '弊社のエンタープライズプランにご興味をお持ちいただきありがとうございます。ご都合の良い時にデモをスケジュールさせていただきます。今週のご都合をお知らせください。', alternatives: ['弊社のエンタープライズプランにご関心をお寄せいただき...'] } },
      { name: 'Spanish', description: 'Spanish translation', props: { sourceLang: 'English', targetLang: 'Spanish', original: 'The quarterly results exceeded expectations. Revenue grew 15% year over year, driven primarily by new enterprise contracts.', translated: 'Los resultados trimestrales superaron las expectativas. Los ingresos crecieron un 15% interanual, impulsados principalmente por nuevos contratos empresariales.' } },
    ],
    mockData: () => ({ original: 'Hello', translated: 'Hola' }),
  },

  // 29. Contact / Person
  {
    id: 'action-card-contact', name: 'Contact / Person', category: 'Action Cards',
    description: 'Consolidated contact info across sources',
    component: ContactCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'name', description: 'Name', control: { type: 'string', placeholder: 'Name' }, defaultValue: 'Alice Chen' },
      { name: 'role', description: 'Role', control: { type: 'string', placeholder: 'Role' }, defaultValue: 'Engineering Manager' },
    ],
    variants: [
      { name: 'Colleague', description: 'Internal team member', props: { name: 'Alice Chen', role: 'Engineering Manager', company: 'Acme Corp', email: 'alice@acme.com', slackHandle: '@alice.chen', timezone: 'PST (UTC-8)', recentContext: 'Last met in Sprint 23 planning. Working on the action cards feature. Prefers async communication.' } },
      { name: 'Client', description: 'External contact', props: { name: 'David Park', role: 'VP of Engineering', company: 'Client Inc', email: 'david@client.io', slackHandle: '@david (shared channel)', timezone: 'EST (UTC-5)', recentContext: 'Renewed enterprise contract last month. Interested in API integration features. Has meeting scheduled for Feb 14.' } },
    ],
    mockData: () => ({ company: 'Company', email: 'e@mail.com', slackHandle: '@user', timezone: 'UTC', recentContext: 'No context' }),
  },

  // 30. Kanban / Status Board
  {
    id: 'action-card-kanban', name: 'Kanban Board', category: 'Action Cards',
    description: 'Visual status board with columns and items',
    component: KanbanCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'title', description: 'Board title', control: { type: 'string', placeholder: 'Sprint Board' }, defaultValue: 'Sprint 24' },
    ],
    variants: [
      { name: 'Sprint Board', description: 'Current sprint overview', props: { title: 'Sprint 24', columns: [{ name: 'Backlog', count: 5, color: 'muted', items: ['Update API docs', 'Fix mobile layout', 'Add export feature'] }, { name: 'In Progress', count: 3, color: 'info', items: ['Action card components', 'Brand theming', 'Source config schema'] }, { name: 'Review', count: 2, color: 'accent', items: ['Zod validators', 'Playground registry'] }, { name: 'Done', count: 8, color: 'success', items: ['ActionCard base', 'Email card', 'Slack card'] }] } },
    ],
    mockData: () => ({ columns: [{ name: 'Todo', count: 3, color: 'muted' }, { name: 'Done', count: 1, color: 'success' }] }),
  },

  // 31. Timeline / Changelog
  {
    id: 'action-card-timeline', name: 'Timeline', category: 'Action Cards',
    description: 'Chronological event timeline with type indicators',
    component: TimelineCardSample, wrapper: PaddedWrapper, layout: 'top',
    props: [
      { name: 'title', description: 'Timeline title', control: { type: 'string', placeholder: 'Changelog' }, defaultValue: 'Project Timeline' },
      { name: 'dateRange', description: 'Date range', control: { type: 'string', placeholder: 'Feb 1-9' }, defaultValue: 'Feb 3-9, 2026' },
    ],
    variants: [
      { name: 'Project Timeline', description: 'Week of project activity', props: { title: 'Action Cards — This Week', dateRange: 'Feb 3-9, 2026', events: [{ time: 'Feb 9, 3:30 PM', label: 'Added 31 card types to playground', type: 'milestone' }, { time: 'Feb 9, 2:00 PM', label: 'Deployed ActionCard component to staging', type: 'deploy' }, { time: 'Feb 8, 11:00 AM', label: 'Fixed brand color resolution in dark mode', type: 'commit' }, { time: 'Feb 7, 4:30 PM', label: 'Source config schema updated with brand + cards fields', type: 'commit' }, { time: 'Feb 6, 9:00 AM', label: 'Broke staging with invalid Zod schema', type: 'incident' }, { time: 'Feb 5, 2:00 PM', label: 'Initial ActionCard design approved', type: 'milestone' }, { time: 'Feb 3, 10:00 AM', label: 'Started action cards feature branch', type: 'commit' }] } },
    ],
    mockData: () => ({ events: [{ time: 'Now', label: 'Event', type: 'commit' }] }),
  },
]
