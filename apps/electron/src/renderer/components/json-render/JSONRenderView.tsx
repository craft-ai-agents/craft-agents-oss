/**
 * JSONRenderView
 *
 * Renders AI-generated UI trees using shadcn/ui components.
 * Includes error boundary for graceful failure handling.
 */

import React, { memo, Component, type ReactNode, useCallback, useState, useMemo } from 'react'
import { Renderer, VisibilityProvider, DataProvider, ActionProvider, useData, type ComponentRenderProps } from '@json-render/react'
import type { UITree as JsonRenderUITree, Action, ActionHandler } from '@json-render/core'

/**
 * Input UITree type - doesn't require 'key' since we add it internally.
 * This is what callers should pass to JSONRenderView.
 */
export interface UITree {
  root: string
  elements: Record<string, {
    type: string
    props: Record<string, unknown>
    children?: string[]
  }>
}
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../ui/card'
import { Badge } from '../ui/badge'
import { Button as ShadcnButton } from '../ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table'
import { Input } from '../ui/input'
import { cn } from '@/lib/utils'
import { getByPath } from '@json-render/core'
import { toast } from 'sonner'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from 'lucide-react'

// ============================================
// Error Boundary
// ============================================

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

class JSONRenderErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(error: Error) {
    console.error('[JSONRenderErrorBoundary] Error caught:', error)
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[JSONRenderErrorBoundary] Component stack:', errorInfo.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <div>Failed to render AI-generated UI</div>
          <div className="text-xs mt-1 opacity-70">{this.state.error?.message}</div>
        </div>
      )
    }
    return this.props.children
  }
}

// ============================================
// Component Registry
// ============================================

// Helper type for component props - using library's ComponentRenderProps
type ElementProps = ComponentRenderProps<Record<string, unknown>>

const components = {
  Card: ({ element, children }: ElementProps) => {
    const title = element.props.title as string | undefined
    const description = element.props.description as string | undefined
    return (
      <Card className="my-2">
        {(title || description) && (
          <CardHeader className="pb-2">
            {title && (
              <CardTitle className="text-base">
                {title}
              </CardTitle>
            )}
            {description && (
              <CardDescription>
                {description}
              </CardDescription>
            )}
          </CardHeader>
        )}
        <CardContent className={title ? '' : 'pt-4'}>
          {children}
        </CardContent>
      </Card>
    )
  },

  Stack: ({ element, children }: ElementProps) => {
    const gap = (element.props.gap as string) || 'md'
    const direction = (element.props.direction as string) || 'vertical'
    const gapClass = { sm: 'gap-1', md: 'gap-3', lg: 'gap-5' }[gap] || 'gap-3'

    return (
      <div
        className={cn(
          'flex',
          direction === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col',
          gapClass
        )}
      >
        {children}
      </div>
    )
  },

  Text: ({ element }: ElementProps) => {
    const variant = (element.props.variant as string) || 'p'
    const content = element.props.content as string

    const styles: Record<string, string> = {
      p: 'text-sm',
      h1: 'text-2xl font-bold',
      h2: 'text-xl font-semibold',
      h3: 'text-lg font-medium',
      muted: 'text-sm text-muted-foreground',
    }

    const Tag = variant.startsWith('h') ? (variant as 'h1' | 'h2' | 'h3') : 'p'
    return <Tag className={styles[variant] || styles.p}>{content}</Tag>
  },

  Badge: ({ element }: ElementProps) => {
    const variant = (element.props.variant as 'default' | 'secondary' | 'outline' | 'destructive') || 'default'
    const label = element.props.label as string

    return <Badge variant={variant}>{label}</Badge>
  },

  Table: ({ element }: ElementProps) => {
    const columns = (element.props.columns as Array<{ key: string; header: string }>) || []
    const data = (element.props.data as Array<Record<string, unknown>>) || []

    return (
      <div className="rounded-md border overflow-auto max-h-[400px]">
        <Table noWrapper>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key}>{col.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.slice(0, 100).map((row, i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell key={col.key}>
                    {String(row[col.key] ?? '')}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  },

  // ============================================
  // Interactive Components
  // ============================================

  Button: ({ element, onAction, loading }: ElementProps) => {
    const label = element.props.label as string
    const variant = (element.props.variant as 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost') || 'default'
    const size = (element.props.size as 'default' | 'sm' | 'lg') || 'default'
    const action = element.props.action as Action | string | undefined
    const disabled = element.props.disabled as boolean | undefined

    const handleClick = useCallback(() => {
      if (disabled || !action) return
      // Support both string action names and full Action objects
      const actionObj: Action = typeof action === 'string' ? { name: action } : action
      console.log('[JSONRender] Button clicked, executing action:', actionObj)
      onAction?.(actionObj)
    }, [action, disabled, onAction])

    return (
      <ShadcnButton
        variant={variant}
        size={size}
        disabled={!!disabled || loading}
        onClick={handleClick}
      >
        {loading ? 'Loading...' : label}
      </ShadcnButton>
    )
  },

  TextField: ({ element }: ElementProps) => {
    const label = element.props.label as string | undefined
    const valuePath = element.props.valuePath as string
    const placeholder = element.props.placeholder as string | undefined
    const type = (element.props.type as string) || 'text'

    // Use the data context for value binding
    const { data, set } = useData()
    const value = valuePath ? (getByPath(data, valuePath) as string | undefined) : undefined

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium">{label}</label>
        )}
        <input
          type={type}
          value={value ?? ''}
          onChange={(e) => valuePath && set(valuePath, e.target.value)}
          placeholder={placeholder}
          className="flex h-9 w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
    )
  },

  SelectField: ({ element }: ElementProps) => {
    const label = element.props.label as string | undefined
    const bindPath = element.props.bindPath as string
    const options = (element.props.options as Array<{ value: string; label: string }>) || []
    const placeholder = element.props.placeholder as string | undefined

    // Use the data context for value binding
    const { data, set } = useData()
    const value = bindPath ? (getByPath(data, bindPath) as string | undefined) : undefined

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium">{label}</label>
        )}
        <Select
          value={value}
          onValueChange={(val) => bindPath && set(bindPath, val)}
        >
          <SelectTrigger>
            <SelectValue placeholder={placeholder || 'Select...'} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  },

  // ============================================
  // Chart Components
  // ============================================

  Chart: ({ element }: ElementProps) => {
    const chartType = (element.props.type as 'bar' | 'line' | 'pie' | 'area') || 'bar'
    const data = (element.props.data as Array<Record<string, unknown>>) || []
    const xKey = (element.props.xKey as string) || 'name'
    const yKey = (element.props.yKey as string) || 'value'
    const title = element.props.title as string | undefined
    const height = (element.props.height as number) || 300
    const colors = (element.props.colors as string[]) || ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe']

    const renderChart = () => {
      switch (chartType) {
        case 'line':
          return (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey={xKey} className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
              <Legend />
              <Line type="monotone" dataKey={yKey} stroke={colors[0]} strokeWidth={2} dot={{ fill: colors[0] }} />
            </LineChart>
          )
        case 'pie':
          return (
            <PieChart>
              <Pie
                data={data}
                dataKey={yKey}
                nameKey={xKey}
                cx="50%"
                cy="50%"
                outerRadius={80}
                label
              >
                {data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
              <Legend />
            </PieChart>
          )
        case 'area':
          return (
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey={xKey} className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
              <Legend />
              <Area type="monotone" dataKey={yKey} stroke={colors[0]} fill={colors[0]} fillOpacity={0.3} />
            </AreaChart>
          )
        case 'bar':
        default:
          return (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey={xKey} className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
              <Legend />
              <Bar dataKey={yKey} fill={colors[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          )
      }
    }

    return (
      <div className="w-full">
        {title && <h4 className="text-sm font-medium mb-2">{title}</h4>}
        <ResponsiveContainer width="100%" height={height}>
          {renderChart()}
        </ResponsiveContainer>
      </div>
    )
  },

  // ============================================
  // Metric Component (KPI Display)
  // ============================================

  Metric: ({ element }: ElementProps) => {
    const label = element.props.label as string
    const value = element.props.value as string | number
    const trend = element.props.trend as 'up' | 'down' | 'neutral' | undefined
    const change = element.props.change as string | undefined
    const prefix = element.props.prefix as string | undefined
    const suffix = element.props.suffix as string | undefined

    const TrendIcon = trend === 'up' ? ArrowUpIcon : trend === 'down' ? ArrowDownIcon : MinusIcon
    const trendColor = trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-muted-foreground'

    return (
      <div className="flex flex-col gap-1 p-3 rounded-lg border bg-card">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold">
            {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
          </span>
          {(trend || change) && (
            <div className={cn('flex items-center gap-0.5 text-sm', trendColor)}>
              {trend && <TrendIcon className="h-4 w-4" />}
              {change && <span>{change}</span>}
            </div>
          )}
        </div>
      </div>
    )
  },

  // ============================================
  // DataTable Component (with sorting and filtering)
  // ============================================

  DataTable: ({ element }: ElementProps) => {
    const columns = (element.props.columns as Array<{ key: string; header: string; sortable?: boolean }>) || []
    const data = (element.props.data as Array<Record<string, unknown>>) || []
    const searchable = element.props.searchable as boolean | undefined
    const pageSize = (element.props.pageSize as number) || 10

    // Local state for sorting, filtering, and pagination
    const [sortKey, setSortKey] = useState<string | null>(null)
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
    const [filter, setFilter] = useState('')
    const [page, setPage] = useState(0)

    // Filter data
    const filteredData = useMemo(() => {
      if (!filter) return data
      const lowerFilter = filter.toLowerCase()
      return data.filter(row =>
        columns.some(col => {
          const value = row[col.key]
          return value != null && String(value).toLowerCase().includes(lowerFilter)
        })
      )
    }, [data, filter, columns])

    // Sort data
    const sortedData = useMemo(() => {
      if (!sortKey) return filteredData
      return [...filteredData].sort((a, b) => {
        const aVal = a[sortKey]
        const bVal = b[sortKey]
        if (aVal == null && bVal == null) return 0
        if (aVal == null) return 1
        if (bVal == null) return -1
        const comparison = String(aVal).localeCompare(String(bVal), undefined, { numeric: true })
        return sortDirection === 'asc' ? comparison : -comparison
      })
    }, [filteredData, sortKey, sortDirection])

    // Paginate data
    const paginatedData = useMemo(() => {
      const start = page * pageSize
      return sortedData.slice(start, start + pageSize)
    }, [sortedData, page, pageSize])

    const totalPages = Math.ceil(sortedData.length / pageSize)

    const handleSort = (key: string) => {
      if (sortKey === key) {
        setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
      } else {
        setSortKey(key)
        setSortDirection('asc')
      }
    }

    return (
      <div className="space-y-2">
        {searchable && (
          <Input
            placeholder="Search..."
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setPage(0)
            }}
            className="max-w-sm"
          />
        )}
        <div className="rounded-md border overflow-auto max-h-[400px]">
          <Table noWrapper>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={col.sortable !== false ? 'cursor-pointer hover:bg-muted/50' : ''}
                    onClick={() => col.sortable !== false && handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.header}
                      {sortKey === col.key && (
                        <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      {String(row[col.key] ?? '')}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {paginatedData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                    No data found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, sortedData.length)} of {sortedData.length}
            </span>
            <div className="flex gap-1">
              <ShadcnButton
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Previous
              </ShadcnButton>
              <ShadcnButton
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Next
              </ShadcnButton>
            </div>
          </div>
        )}
      </div>
    )
  },
}

// ============================================
// Default Action Handlers
// ============================================

/**
 * Default action handlers for common operations.
 * These can be overridden by passing custom handlers to JSONRenderView.
 */
const defaultActionHandlers: Record<string, ActionHandler> = {
  // Copy text to clipboard
  copy: async (params) => {
    const text = params?.text as string
    if (text) {
      await navigator.clipboard.writeText(text)
      toast.success('Copied to clipboard', { description: text.slice(0, 50) + (text.length > 50 ? '...' : '') })
    } else {
      toast.info('Copy action triggered', { description: 'No text provided to copy' })
    }
  },
  // Open a URL in browser
  open_url: async (params) => {
    const url = params?.url as string
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
      toast.success('Opening URL', { description: url })
    } else {
      toast.info('Open URL action triggered', { description: 'No URL provided' })
    }
  },
  // Log action for debugging
  log: async (params) => {
    console.log('[JSONRender] Log action:', params)
    toast.info('Action executed', {
      description: params ? JSON.stringify(params).slice(0, 100) : 'No parameters'
    })
  },
  // Submit form action
  submit: async (params) => {
    console.log('[JSONRender] Submit action:', params)
    toast.success('Form submitted', {
      description: 'Data logged to console'
    })
  },
  // Cancel/dismiss action
  cancel: async () => {
    toast.info('Action cancelled')
  },
  // API call action - makes HTTP requests
  api_call: async (params) => {
    const url = params?.url as string
    const method = (params?.method as string)?.toUpperCase() || 'GET'
    const body = params?.body as Record<string, unknown> | undefined
    const headers = params?.headers as Record<string, string> | undefined

    if (!url) {
      toast.error('API call failed', { description: 'No URL provided' })
      return { error: 'No URL provided' }
    }

    const toastId = toast.loading('Making API request...', { description: `${method} ${url}` })

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      })

      const contentType = response.headers.get('content-type')
      const isJson = contentType?.includes('application/json')
      const data = isJson ? await response.json() : await response.text()

      if (response.ok) {
        toast.success('API call successful', {
          id: toastId,
          description: `${method} ${response.status} - ${typeof data === 'object' ? 'Response received' : data.slice(0, 50)}`
        })
        console.log('[JSONRender] API response:', data)
        return { success: true, status: response.status, data }
      } else {
        toast.error('API call failed', {
          id: toastId,
          description: `${response.status} ${response.statusText}`
        })
        console.error('[JSONRender] API error:', data)
        return { success: false, status: response.status, error: data }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error('API call failed', {
        id: toastId,
        description: message
      })
      console.error('[JSONRender] API error:', error)
      return { error: message }
    }
  },
  // Refresh/reload action
  refresh: async () => {
    toast.info('Refreshing data...', { description: 'This would trigger a data refresh in a connected system' })
  },
  // MCP tool call action - fetches data from an MCP source
  mcp_fetch: async (params) => {
    const source = params?.source as string
    const tool = params?.tool as string
    const args = (params?.args as Record<string, unknown>) || {}

    if (!source || !tool) {
      toast.error('MCP fetch failed', { description: 'Missing source or tool name' })
      return { error: 'Missing source or tool' }
    }

    const toastId = toast.loading('Fetching from MCP...', { description: `${source}.${tool}` })

    try {
      // Get current workspace ID from window context
      const workspaceId = await window.electronAPI?.getWindowWorkspace?.()
      if (!workspaceId) {
        toast.error('MCP fetch failed', { id: toastId, description: 'No workspace context' })
        return { error: 'No workspace context' }
      }

      // Call the MCP tool via IPC
      const result = await window.electronAPI?.callMcpTool?.(workspaceId, source, tool, args)

      if (!result?.success) {
        toast.error('MCP fetch failed', { id: toastId, description: result?.error || 'Unknown error' })
        return { error: result?.error }
      }

      toast.success('MCP data fetched', { id: toastId, description: `${source}.${tool}` })
      console.log('[JSONRender] MCP result:', result.data)
      return result.data
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error('MCP fetch failed', { id: toastId, description: message })
      return { error: message }
    }
  },
}

// ============================================
// Main Component
// ============================================

interface JSONRenderViewProps {
  tree: UITree
  /** Initial data for data bindings */
  initialData?: Record<string, unknown>
  /** Custom action handlers (merged with defaults) */
  actionHandlers?: Record<string, ActionHandler>
  /** Callback when any action is executed */
  onAction?: (actionName: string, params?: Record<string, unknown>) => void
}

export const JSONRenderView = memo(function JSONRenderView({
  tree,
  initialData = {},
  actionHandlers = {},
  onAction,
}: JSONRenderViewProps) {
  // Debug: log what we receive
  console.log('[JSONRenderView] Received tree:', JSON.stringify(tree, null, 2))

  // Basic validation
  if (!tree?.root || !tree?.elements?.[tree.root]) {
    console.error('[JSONRenderView] Invalid tree structure - missing root or root element')
    return (
      <div className="text-sm text-muted-foreground italic">
        Invalid UI structure
      </div>
    )
  }

  // Transform tree to add required 'key' property to each element
  // The json-render library requires each UIElement to have a 'key' that matches its ID
  const transformedTree: JsonRenderUITree = {
    root: tree.root,
    elements: Object.fromEntries(
      Object.entries(tree.elements).map(([id, element]) => [
        id,
        {
          ...element,
          key: id, // Add the required key property
        },
      ])
    ),
  }

  console.log('[JSONRenderView] Transformed tree:', JSON.stringify(transformedTree, null, 2))

  // Merge default handlers with custom handlers, wrapping to call onAction callback
  const mergedHandlers: Record<string, ActionHandler> = {}
  const allHandlerNames = new Set([
    ...Object.keys(defaultActionHandlers),
    ...Object.keys(actionHandlers),
  ])

  for (const name of allHandlerNames) {
    const customHandler = actionHandlers[name]
    const defaultHandler = defaultActionHandlers[name]

    mergedHandlers[name] = async (params) => {
      console.log('[JSONRender] Executing action:', name, params)
      onAction?.(name, params as Record<string, unknown>)

      // Custom handler takes precedence
      if (customHandler) {
        return customHandler(params)
      }
      if (defaultHandler) {
        return defaultHandler(params)
      }
    }
  }

  return (
    <JSONRenderErrorBoundary>
      <div
        className="json-render-view"
        role="region"
        aria-label="AI-generated content"
      >
        <DataProvider initialData={initialData}>
          <VisibilityProvider>
            <ActionProvider handlers={mergedHandlers}>
              <Renderer tree={transformedTree} registry={components} />
            </ActionProvider>
          </VisibilityProvider>
        </DataProvider>
      </div>
    </JSONRenderErrorBoundary>
  )
})
