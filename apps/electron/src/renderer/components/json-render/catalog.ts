/**
 * JSON Render Catalog
 *
 * Defines the component catalog for AI-generated UI.
 * MVP: 5 components (Card, Stack, Text, Badge, Table), no actions.
 */

import { createCatalog } from '@json-render/core'
import { z } from 'zod'

export const vesperCatalog = createCatalog({
  components: {
    Card: {
      props: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
      }),
      hasChildren: true,
      description: 'Container for grouping content',
    },

    Stack: {
      props: z.object({
        direction: z.enum(['horizontal', 'vertical']).default('vertical'),
        gap: z.enum(['sm', 'md', 'lg']).default('md'),
      }),
      hasChildren: true,
      description: 'Flex container for layout',
    },

    Text: {
      props: z.object({
        content: z.string(),
        variant: z.enum(['p', 'h1', 'h2', 'h3', 'muted']).default('p'),
      }),
      description: 'Text with typography variants',
    },

    Badge: {
      props: z.object({
        label: z.string(),
        variant: z.enum(['default', 'secondary', 'outline', 'destructive']).default('default'),
      }),
      description: 'Status indicator',
    },

    Table: {
      props: z.object({
        columns: z.array(z.object({
          key: z.string(),
          header: z.string(),
        })).max(20),
        data: z.array(z.record(z.string(), z.unknown())).max(100),
      }),
      description: 'Data table (max 100 rows)',
    },
  },

  actions: {}, // No actions in MVP
})

/**
 * Tool definition for the agent
 * This tool allows the AI to generate UI components inline in chat
 */
export const RENDER_UI_TOOL = {
  name: 'render_ui',
  description: `Generate a simple UI to display in chat. Available components:
- Card: Container with optional title/description. Can contain other components.
- Stack: Layout container. direction: "horizontal" | "vertical", gap: "sm" | "md" | "lg"
- Text: Display text. variant: "p" | "h1" | "h2" | "h3" | "muted"
- Badge: Status indicator. variant: "default" | "secondary" | "outline" | "destructive"
- Table: Data table with columns and rows. Max 100 rows.

Return a tree with { root: string, elements: Record<string, Element> } where each element has { type, props, children? }.`,

  input_schema: {
    type: 'object' as const,
    properties: {
      tree: {
        type: 'object' as const,
        properties: {
          root: { type: 'string' as const },
          elements: { type: 'object' as const },
        },
        required: ['root', 'elements'] as const,
      },
    },
    required: ['tree'] as const,
  },
}

export type VesperCatalog = typeof vesperCatalog
