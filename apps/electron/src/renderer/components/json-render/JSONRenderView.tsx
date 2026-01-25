/**
 * JSONRenderView
 *
 * Renders AI-generated UI trees using shadcn/ui components.
 * Includes error boundary for graceful failure handling.
 */

import React, { memo, Component, type ReactNode } from 'react'
import { Renderer, VisibilityProvider, DataProvider, ActionProvider, type ComponentRenderProps } from '@json-render/react'
import type { UITree } from '@json-render/core'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../ui/card'
import { Badge } from '../ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table'
import { cn } from '@/lib/utils'

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
}

// ============================================
// Main Component
// ============================================

interface JSONRenderViewProps {
  tree: UITree
}

export const JSONRenderView = memo(function JSONRenderView({
  tree,
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

  return (
    <JSONRenderErrorBoundary>
      <div
        className="json-render-view"
        role="region"
        aria-label="AI-generated content"
      >
        <DataProvider initialData={{}}>
          <VisibilityProvider>
            <ActionProvider handlers={{}}>
              <Renderer tree={transformedTree} registry={components} />
            </ActionProvider>
          </VisibilityProvider>
        </DataProvider>
      </div>
    </JSONRenderErrorBoundary>
  )
})
