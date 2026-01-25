/**
 * JSONRenderView
 *
 * Renders AI-generated UI trees using shadcn/ui components.
 * Includes error boundary for graceful failure handling.
 */

import React, { memo, Component, type ReactNode, useCallback } from 'react'
import { Renderer, VisibilityProvider, DataProvider, ActionProvider, useData, type ComponentRenderProps } from '@json-render/react'
import type { UITree, Action, ActionHandler } from '@json-render/core'
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
import { cn } from '@/lib/utils'
import { getByPath } from '@json-render/core'
import { toast } from 'sonner'

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
  const transformedTree: UITree = {
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
