/**
 * JSONRenderTest - Quick test component to verify json-render works
 *
 * Import this in a page to test: import { JSONRenderTest } from '@/components/json-render/JSONRenderTest'
 */

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
import { cn } from '@/lib/utils'

// Helper type for component props
type ElementProps = ComponentRenderProps<Record<string, unknown>>

// Minimal component registry
const testComponents = {
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
}

// Test tree WITH the required 'key' property
const testTree: UITree = {
  root: 'card1',
  elements: {
    'card1': {
      key: 'card1',  // REQUIRED by @json-render/core
      type: 'Card',
      props: { title: 'Test Card', description: 'This is a test' },
      children: ['stack1'],
    },
    'stack1': {
      key: 'stack1',
      type: 'Stack',
      props: { direction: 'vertical', gap: 'md' },
      children: ['text1', 'badge1'],
    },
    'text1': {
      key: 'text1',
      type: 'Text',
      props: { content: 'Hello from json-render!', variant: 'p' },
    },
    'badge1': {
      key: 'badge1',
      type: 'Badge',
      props: { label: 'Working', variant: 'default' },
    },
  },
}

export function JSONRenderTest() {
  console.log('[JSONRenderTest] Rendering with tree:', testTree)

  return (
    <div className="p-4 border rounded-lg">
      <h2 className="text-lg font-bold mb-4">JSON Render Test</h2>
      <div className="bg-muted/30 p-4 rounded">
        <DataProvider initialData={{}}>
          <VisibilityProvider>
            <ActionProvider handlers={{}}>
              <Renderer tree={testTree} registry={testComponents} />
            </ActionProvider>
          </VisibilityProvider>
        </DataProvider>
      </div>
    </div>
  )
}
