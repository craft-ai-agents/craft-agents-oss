/**
 * PermissionsDataTable
 *
 * Typed Data Table for displaying source permissions.
 * Features: searchable patterns, sortable columns, max-height scroll, fullscreen view.
 */

import * as React from 'react'
import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Maximize2 } from 'lucide-react'
import { Info_DataTable, SortableHeader } from './Info_DataTable'
import { Info_Badge } from './Info_Badge'
import { Info_StatusBadge } from './Info_StatusBadge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { DataTableOverlay } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { getTableLabels } from '@/i18n/ui-labels'
import { getPermissionsTableColumnTitles } from './table-column-labels'

export type PermissionAccess = 'allowed' | 'blocked'
export type PermissionType = 'tool' | 'bash' | 'api' | 'mcp'

export interface PermissionRow {
  access: PermissionAccess
  type: PermissionType
  pattern: string
  comment?: string | null
}

interface PermissionsDataTableProps {
  data: PermissionRow[]
  /** Hide the type column (for MCP sources that only show pattern/comment) */
  hideTypeColumn?: boolean
  /** Show search input */
  searchable?: boolean
  /** Max height with scroll */
  maxHeight?: number
  /** Enable fullscreen button (shows Maximize2 icon on hover) */
  fullscreen?: boolean
  /** Title for the fullscreen overlay header */
  fullscreenTitle?: string
  className?: string
}

/**
 * PatternBadge - Clickable pattern badge with truncation and tooltip
 * - Dynamic width with max-width of 240px
 * - CSS truncation via text-ellipsis
 * - Tooltip shows full pattern on hover (only for patterns 30+ chars)
 * - Click to copy pattern to clipboard with toast notification
 */
function PatternBadge({ pattern }: { pattern: string }) {
  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(pattern)
      toast.success('Pattern copied to clipboard')
    } catch {
      toast.error('Failed to copy pattern')
    }
  }

  const badge = (
    <button type="button" onClick={handleClick} className="text-left">
      <Info_Badge color="muted" className="font-mono select-none">
        <span className="block overflow-hidden whitespace-nowrap text-ellipsis max-w-[240px]">
          {pattern}
        </span>
      </Info_Badge>
    </button>
  )

  // Only show tooltip for longer patterns (30+ chars)
  if (pattern.length >= 30) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="font-mono max-w-md break-all">{pattern}</TooltipContent>
      </Tooltip>
    )
  }

  return badge
}

function getColumnsWithType(headers: ReturnType<typeof getPermissionsTableColumnTitles>): ColumnDef<PermissionRow>[] {
  return [
  {
    accessorKey: 'access',
    header: ({ column }) => <SortableHeader column={column} title={headers.access} />,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <Info_StatusBadge status={row.original.access} className="whitespace-nowrap" />
      </div>
    ),
    minSize: 80,
  },
  {
    accessorKey: 'type',
    header: ({ column }) => <SortableHeader column={column} title={headers.type} />,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <Info_Badge color="muted" className="capitalize whitespace-nowrap">
          {row.original.type}
        </Info_Badge>
      </div>
    ),
    minSize: 80,
  },
  {
    accessorKey: 'pattern',
    header: ({ column }) => <SortableHeader column={column} title={headers.pattern} />,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <PatternBadge pattern={row.original.pattern} />
      </div>
    ),
    minSize: 100,
  },
  {
    id: 'comment',
    accessorKey: 'comment',
    header: () => <span className="p-1.5 pl-2.5">{headers.comment}</span>,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5 min-w-0">
        <span className="truncate block">
          {row.original.comment || '—'}
        </span>
      </div>
    ),
    meta: { fillWidth: true, truncate: true },
  },
]
}

function getColumnsWithoutType(headers: ReturnType<typeof getPermissionsTableColumnTitles>): ColumnDef<PermissionRow>[] {
  return [
  {
    accessorKey: 'access',
    header: ({ column }) => <SortableHeader column={column} title={headers.access} />,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <Info_StatusBadge status={row.original.access} className="whitespace-nowrap" />
      </div>
    ),
    minSize: 80,
  },
  {
    accessorKey: 'pattern',
    header: ({ column }) => <SortableHeader column={column} title={headers.pattern} />,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <PatternBadge pattern={row.original.pattern} />
      </div>
    ),
    minSize: 100,
  },
  {
    id: 'comment',
    accessorKey: 'comment',
    header: () => <span className="p-1.5 pl-2.5">{headers.comment}</span>,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5 min-w-0">
        <span className="truncate block">
          {row.original.comment || '—'}
        </span>
      </div>
    ),
    meta: { fillWidth: true, truncate: true },
  },
]
}

export function PermissionsDataTable({
  data,
  hideTypeColumn = false,
  searchable = false,
  maxHeight = 400,
  fullscreen = false,
  fullscreenTitle = 'Permissions',
  className,
}: PermissionsDataTableProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { isDark } = useTheme()
  const { t } = useTranslation(['common'])
  const tableLabels = getTableLabels(t)
  const headers = getPermissionsTableColumnTitles(tableLabels.permissions.headers)
  const columns = hideTypeColumn ? getColumnsWithoutType(headers) : getColumnsWithType(headers)

  // Fullscreen button for toolbar - shown on hover
  const fullscreenButton = fullscreen ? (
    <button
      type="button"
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
        data={data}
        searchable={searchable ? { placeholder: 'Search patterns...' } : false}
        maxHeight={maxHeight}
        emptyContent="No permissions configured"
        floatingAction={fullscreenButton}
        className={cn(fullscreen && 'group', className)}
      />

      {/* Fullscreen overlay - renders the table without scroll constraints */}
      {fullscreen && (
        <DataTableOverlay
          isOpen={isFullscreen}
          onClose={() => setIsFullscreen(false)}
          title={fullscreenTitle}
          subtitle={`${data.length} ${data.length === 1 ? 'rule' : 'rules'}`}
          theme={isDark ? 'dark' : 'light'}
        >
          <Info_DataTable
            columns={columns}
            data={data}
            searchable={searchable ? { placeholder: 'Search patterns...' } : false}
            emptyContent="No permissions configured"
          />
        </DataTableOverlay>
      )}
    </>
  )
}
