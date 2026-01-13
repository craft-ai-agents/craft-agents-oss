/**
 * PermissionsDataTable
 *
 * Typed Data Table for displaying source permissions.
 * Features: searchable patterns, sortable columns, max-height scroll.
 */

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Info_DataTable, SortableHeader } from './Info_DataTable'
import { Info_Badge } from './Info_Badge'
import { Info_StatusBadge } from './Info_StatusBadge'

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
  className?: string
}

// Column definitions with sorting
const columnsWithType: ColumnDef<PermissionRow>[] = [
  {
    accessorKey: 'access',
    header: ({ column }) => <SortableHeader column={column} title="Access" />,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <Info_StatusBadge status={row.original.access} className="whitespace-nowrap" />
      </div>
    ),
    minSize: 80,
  },
  {
    accessorKey: 'type',
    header: ({ column }) => <SortableHeader column={column} title="Type" />,
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
    header: ({ column }) => <SortableHeader column={column} title="Pattern" />,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <Info_Badge color="muted" className="font-mono whitespace-nowrap">
          {row.original.pattern}
        </Info_Badge>
      </div>
    ),
    minSize: 100,
  },
  {
    id: 'comment',
    accessorKey: 'comment',
    header: () => <span className="p-1.5 pl-2.5">Comment</span>,
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

const columnsWithoutType: ColumnDef<PermissionRow>[] = [
  {
    accessorKey: 'access',
    header: ({ column }) => <SortableHeader column={column} title="Access" />,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <Info_StatusBadge status={row.original.access} className="whitespace-nowrap" />
      </div>
    ),
    minSize: 80,
  },
  {
    accessorKey: 'pattern',
    header: ({ column }) => <SortableHeader column={column} title="Pattern" />,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <Info_Badge color="muted" className="font-mono whitespace-nowrap">
          {row.original.pattern}
        </Info_Badge>
      </div>
    ),
    minSize: 100,
  },
  {
    id: 'comment',
    accessorKey: 'comment',
    header: () => <span className="p-1.5 pl-2.5">Comment</span>,
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

export function PermissionsDataTable({
  data,
  hideTypeColumn = false,
  searchable = false,
  maxHeight = 400,
  className,
}: PermissionsDataTableProps) {
  const columns = hideTypeColumn ? columnsWithoutType : columnsWithType

  return (
    <Info_DataTable
      columns={columns}
      data={data}
      searchable={searchable ? { placeholder: 'Search patterns...' } : false}
      maxHeight={maxHeight}
      emptyContent="No permissions configured"
      className={className}
    />
  )
}
