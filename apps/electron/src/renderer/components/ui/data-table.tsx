import * as React from 'react'
import type {
  ColumnDef,
  ColumnFiltersState,
  ColumnSizingState,
  SortingState,
  PaginationState,
  Column,
  Table as TableInstance,
} from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** Global filter value (searches across all columns) */
  globalFilter?: string
  /** Column ID to apply column-specific filter to */
  filterColumn?: string
  /** Column-specific filter value */
  filterValue?: string
  /** Custom class for the table container */
  className?: string
  /** Empty state content */
  emptyContent?: React.ReactNode
  /** Callback to get table instance for external control */
  onTableReady?: (table: TableInstance<TData>) => void
  /** Skip the border wrapper (when parent provides it) */
  noBorder?: boolean
  /** Skip the table overflow wrapper (required for sticky headers) */
  noWrapper?: boolean
  /** Enable pagination */
  pagination?: boolean
  /** Page size when pagination is enabled (default: 50) */
  pageSize?: number
}

export function DataTable<TData, TValue>({
  columns,
  data,
  globalFilter,
  filterValue,
  filterColumn,
  className,
  emptyContent,
  onTableReady,
  noBorder = false,
  noWrapper = false,
  pagination: paginationEnabled = false,
  pageSize = 50,
}: DataTableProps<TData, TValue>) {
  const { t } = useTranslation()
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({})
  const [internalGlobalFilter, setInternalGlobalFilter] = React.useState('')
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  })

  // Sync external global filter and reset pagination
  React.useEffect(() => {
    if (globalFilter !== undefined) {
      setInternalGlobalFilter(globalFilter)
      // Reset to first page when filter changes
      if (paginationEnabled) {
        setPagination(prev => ({ ...prev, pageIndex: 0 }))
      }
    }
  }, [globalFilter, paginationEnabled])

  // Update column filter when filterValue changes
  React.useEffect(() => {
    if (filterColumn && filterValue !== undefined) {
      setColumnFilters([{ id: filterColumn, value: filterValue }])
    } else if (filterColumn) {
      setColumnFilters([])
    }
  }, [filterValue, filterColumn])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(paginationEnabled && { getPaginationRowModel: getPaginationRowModel() }),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnSizingChange: setColumnSizing,
    onGlobalFilterChange: setInternalGlobalFilter,
    ...(paginationEnabled && { onPaginationChange: setPagination }),
    globalFilterFn: 'includesString',
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      sorting,
      columnFilters,
      columnSizing,
      globalFilter: internalGlobalFilter,
      ...(paginationEnabled && { pagination }),
    },
  })

  // Expose table instance
  React.useEffect(() => {
    onTableReady?.(table)
  }, [table, onTableReady])

  const tableContent = (
    <Table noWrapper={noWrapper}>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const meta = header.column.columnDef.meta as
                | { fillWidth?: boolean; truncate?: boolean; maxWidth?: string }
                | undefined
              const minSize = header.column.columnDef.minSize
              const currentSize = header.getSize()
              // Only apply explicit width if user has resized or there's a minSize
              const hasResized = columnSizing[header.id] !== undefined
              return (
                <TableHead
                  key={header.id}
                  className={cn(meta?.fillWidth && 'w-full')}
                  style={{
                    width: hasResized ? currentSize : undefined,
                    minWidth: minSize,
                    maxWidth: meta?.maxWidth,
                  }}
                >
                  <div className="flex items-center">
                    <div className="flex-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </div>
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={cn(
                          'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
                          'opacity-0 hover:opacity-100 transition-opacity',
                          'bg-border',
                          header.column.getIsResizing() && 'opacity-100 bg-accent'
                        )}
                      />
                    )}
                  </div>
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows?.length ? (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() && 'selected'}
            >
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as
                  | { fillWidth?: boolean; truncate?: boolean; maxWidth?: string }
                  | undefined
                const minSize = cell.column.columnDef.minSize
                const currentSize = cell.column.getSize()
                const hasResized = columnSizing[cell.column.id] !== undefined
                return (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      meta?.fillWidth && 'w-full',
                      meta?.truncate && 'overflow-hidden'
                    )}
                    style={{
                      width: hasResized ? currentSize : undefined,
                      minWidth: minSize,
                      maxWidth: meta?.maxWidth,
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                )
              })}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="h-24 text-center"
            >
              {emptyContent ?? t('noOptions' as any)}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )

  const paginationControls = paginationEnabled && table.getPageCount() > 1 && (
    <div className="flex items-center justify-between px-2 py-3 border-t border-border">
      <div className="text-sm text-muted-foreground">
        {table.getFilteredRowModel().rows.length} {t('total' as any)}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          {t('back' as any)}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t('pageInfo' as any, { current: table.getState().pagination.pageIndex + 1, total: table.getPageCount() })}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          {t('continue' as any)}
        </Button>
      </div>
    </div>
  )

  if (noBorder) {
    return (
      <div className={cn('w-full', className)}>
        {tableContent}
        {paginationControls}
      </div>
    )
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="rounded-md border">
        {tableContent}
        {paginationControls}
      </div>
    </div>
  )
}

/**
 * Sortable column header component
 * Use in column definitions: header: ({ column }) => <SortableHeader column={column} title="Name" />
 */
interface SortableHeaderProps<TData, TValue> {
  column: Column<TData, TValue>
  title: string
  className?: string
}

export function SortableHeader<TData, TValue>({
  column,
  title,
  className,
}: SortableHeaderProps<TData, TValue>) {
  return (
    <Button
      variant="ghost"
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      className={cn('w-full justify-start p-1.5 pl-2.5', className)}
    >
      {title}
    </Button>
  )
}

export type { ColumnDef, Column, TableInstance }
