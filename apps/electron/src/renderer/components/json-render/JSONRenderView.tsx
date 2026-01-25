/**
 * JSONRenderView
 *
 * Renders AI-generated UI trees using shadcn/ui components.
 * Includes error boundary for graceful failure handling.
 */

import { memo, Component, type ReactNode } from 'react'
import { Renderer } from '@json-render/react'
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
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          Failed to render AI-generated UI
        </div>
      )
    }
    return this.props.children
  }
}

// ============================================
// Component Registry
// ============================================

interface ElementProps {
  element: {
    type: string
    props: Record<string, unknown>
    children?: string[]
  }
  children?: ReactNode
}

const components = {
  Card: ({ element, children }: ElementProps) => (
    <Card className="my-2">
      {(element.props.title || element.props.description) && (
        <CardHeader className="pb-2">
          {element.props.title && (
            <CardTitle className="text-base">
              {element.props.title as string}
            </CardTitle>
          )}
          {element.props.description && (
            <CardDescription>
              {element.props.description as string}
            </CardDescription>
          )}
        </CardHeader>
      )}
      <CardContent className={element.props.title ? '' : 'pt-4'}>
        {children}
      </CardContent>
    </Card>
  ),

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
  // Basic validation
  if (!tree?.root || !tree?.elements?.[tree.root]) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Invalid UI structure
      </div>
    )
  }

  return (
    <JSONRenderErrorBoundary>
      <div
        className="json-render-view"
        role="region"
        aria-label="AI-generated content"
      >
        <Renderer tree={tree} components={components} />
      </div>
    </JSONRenderErrorBoundary>
  )
})
