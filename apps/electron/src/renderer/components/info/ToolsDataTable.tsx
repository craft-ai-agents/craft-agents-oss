/**
 * ToolsDataTable
 *
 * Typed Data Table for displaying MCP tools.
 * Features: searchable tools, sortable columns, max-height scroll.
 */

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Info_DataTable, SortableHeader } from './Info_DataTable'
import { Info_Badge } from './Info_Badge'
import { Info_StatusBadge } from './Info_StatusBadge'
import { useTranslation } from '@/i18n'

export type ToolPermission = 'allowed' | 'requires-permission'

export interface ToolRow {
  name: string
  description: string
  permission: ToolPermission
}

interface ToolsDataTableProps {
  data: ToolRow[]
  /** Show loading spinner */
  loading?: boolean
  /** Show error message */
  error?: string
  /** Max height with scroll (default: 400) */
  maxHeight?: number
  className?: string
}

function ToolsDataTableInternal({
  data,
  loading,
  error,
  maxHeight = 400,
  className,
}: ToolsDataTableProps) {
  const { t } = useTranslation()

  const columns: ColumnDef<ToolRow>[] = React.useMemo(() => [
    {
      accessorKey: 'permission',
      header: ({ column }) => <SortableHeader column={column} title={t('access' as any)} />,
      cell: ({ row }) => (
        <div className="p-1.5 pl-2.5">
          <Info_StatusBadge status={row.original.permission} className="whitespace-nowrap" />
        </div>
      ),
      minSize: 80,
    },
    {
      accessorKey: 'name',
      header: ({ column }) => <SortableHeader column={column} title={t('tool' as any)} />,
      cell: ({ row }) => (
        <div className="p-1.5 pl-2.5">
          <Info_Badge color="muted" className="whitespace-nowrap">
            {row.original.name}
          </Info_Badge>
        </div>
      ),
      minSize: 100,
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: () => <span className="p-1.5 pl-2.5">{t('description' as any)}</span>,
      cell: ({ row }) => (
        <div className="p-1.5 pl-2.5 min-w-0">
          <span className="truncate block">{row.original.description}</span>
        </div>
      ),
      meta: { fillWidth: true, truncate: true },
    },
  ], [t])

  return (
    <Info_DataTable
      columns={columns}
      data={data}
      loading={loading}
      error={error}
      maxHeight={maxHeight}
      emptyContent={t('noToolsAvailable' as any)}
      className={className}
    />
  )
}

export const ToolsDataTable = React.memo(ToolsDataTableInternal)
