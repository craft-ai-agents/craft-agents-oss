/**
 * PathRulesDataTable
 *
 * Data table displaying path-to-label mapping rules.
 * Each row shows the path pattern, match mode, associated label,
 * enabled status, and description.
 */

import * as React from 'react'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Maximize2, Check, X, Folder } from 'lucide-react'
import { Info_DataTable, SortableHeader } from './Info_DataTable'
import { Info_Badge } from './Info_Badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { DataTableOverlay } from '@craft-agent/ui'
import { LabelIcon } from '@/components/ui/label-icon'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import { toast } from 'sonner'
import type { PathRule } from '@craft-agent/shared/labels/path-rules'
import type { LabelConfig } from '@craft-agent/shared/labels'

/**
 * Path rule row with resolved label info
 */
interface PathRuleRow extends PathRule {
  /** Resolved label config (if found) */
  label?: LabelConfig
}

interface PathRulesDataTableProps {
  /** Path rules to display */
  rules: PathRule[]
  /** Label tree for resolving label info */
  labels: LabelConfig[]
  /** Show search input */
  searchable?: boolean
  /** Max height with scroll */
  maxHeight?: number
  /** Enable fullscreen button */
  fullscreen?: boolean
  /** Title for fullscreen overlay */
  fullscreenTitle?: string
  className?: string
}

/**
 * PathBadge - Monospace path with click-to-copy and tooltip.
 */
function PathBadge({ path }: { path: string }) {
  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(path)
      toast.success('Path copied to clipboard')
    } catch {
      toast.error('Failed to copy path')
    }
  }

  const badge = (
    <button type="button" onClick={handleClick} className="text-left flex items-center gap-1.5">
      <Folder className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
      <Info_Badge color="muted" className="font-mono select-none">
        <span className="block overflow-hidden whitespace-nowrap text-ellipsis max-w-[250px]">
          {path}
        </span>
      </Info_Badge>
    </button>
  )

  if (path.length >= 35) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="font-mono max-w-md break-all">{path}</TooltipContent>
      </Tooltip>
    )
  }

  return badge
}

/**
 * Recursively find a label by ID in the label tree.
 */
function findLabelById(labels: LabelConfig[], labelId: string): LabelConfig | undefined {
  for (const label of labels) {
    if (label.id === labelId) {
      return label
    }
    if (label.children) {
      const found = findLabelById(label.children, labelId)
      if (found) return found
    }
  }
  return undefined
}

// Column definitions for the path rules table
const columns: ColumnDef<PathRuleRow>[] = [
  {
    id: 'path',
    header: ({ column }) => <SortableHeader column={column} title="Path" />,
    accessorFn: (row) => row.path,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <PathBadge path={row.original.path} />
      </div>
    ),
    minSize: 200,
  },
  {
    id: 'match',
    header: () => <span className="p-1.5 pl-2.5">Match</span>,
    accessorFn: (row) => row.match,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <Info_Badge color={row.original.match === 'prefix' ? 'info' : 'muted'}>
          {row.original.match === 'prefix' ? 'Prefix' : 'Exact'}
        </Info_Badge>
      </div>
    ),
    minSize: 80,
  },
  {
    id: 'label',
    header: ({ column }) => <SortableHeader column={column} title="Label" />,
    accessorFn: (row) => row.label?.name ?? row.labelId,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5 flex items-center gap-1.5">
        {row.original.label ? (
          <>
            <LabelIcon label={row.original.label} size="xs" />
            <span className="text-sm truncate">{row.original.label.name}</span>
          </>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm text-destructive/80 truncate">
                {row.original.labelId}
              </span>
            </TooltipTrigger>
            <TooltipContent>Label not found</TooltipContent>
          </Tooltip>
        )}
      </div>
    ),
    minSize: 100,
  },
  {
    id: 'enabled',
    header: () => <span className="p-1.5 pl-2.5">Enabled</span>,
    accessorFn: (row) => row.enabled !== false,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        {row.original.enabled !== false ? (
          <Check className="w-4 h-4 text-success" />
        ) : (
          <X className="w-4 h-4 text-muted-foreground/50" />
        )}
      </div>
    ),
    minSize: 70,
  },
  {
    id: 'description',
    header: () => <span className="p-1.5 pl-2.5">Description</span>,
    accessorFn: (row) => row.description ?? '',
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5 min-w-0">
        <span className="truncate block text-sm">
          {row.original.description || '—'}
        </span>
      </div>
    ),
    meta: { fillWidth: true, truncate: true },
  },
]

export function PathRulesDataTable({
  rules,
  labels,
  searchable = false,
  maxHeight = 400,
  fullscreen = false,
  fullscreenTitle = 'Path Rules',
  className,
}: PathRulesDataTableProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { isDark } = useTheme()

  // Resolve label info for each rule
  const rows: PathRuleRow[] = useMemo(() => {
    return rules.map(rule => ({
      ...rule,
      label: findLabelById(labels, rule.labelId),
    }))
  }, [rules, labels])

  // Fullscreen button (shown on hover)
  const fullscreenButton = fullscreen ? (
    <button
      onClick={() => setIsFullscreen(true)}
      className={cn(
        'p-1 rounded-[6px] transition-all',
        'opacity-0 group-hover:opacity-100',
        'bg-background/80 backdrop-blur-sm shadow-minimal',
        'text-muted-foreground/50 hover:text-foreground',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:opacity-100'
      )}
      title="View Fullscreen"
    >
      <Maximize2 className="w-3.5 h-3.5" />
    </button>
  ) : undefined

  return (
    <>
      <Info_DataTable
        columns={columns}
        data={rows}
        searchable={searchable ? { placeholder: 'Search rules...' } : false}
        maxHeight={maxHeight}
        emptyContent="No path rules configured"
        floatingAction={fullscreenButton}
        className={cn(fullscreen && 'group', className)}
      />

      {/* Fullscreen overlay */}
      {fullscreen && (
        <DataTableOverlay
          isOpen={isFullscreen}
          onClose={() => setIsFullscreen(false)}
          title={fullscreenTitle}
          subtitle={`${rows.length} ${rows.length === 1 ? 'rule' : 'rules'}`}
          theme={isDark ? 'dark' : 'light'}
        >
          <Info_DataTable
            columns={columns}
            data={rows}
            searchable={searchable ? { placeholder: 'Search rules...' } : false}
            emptyContent="No path rules configured"
          />
        </DataTableOverlay>
      )}
    </>
  )
}
