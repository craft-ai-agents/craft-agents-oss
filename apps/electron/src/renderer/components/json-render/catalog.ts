/**
 * JSON Render Catalog
 *
 * Defines the component catalog for AI-generated UI.
 * Includes display components and interactive components with actions.
 */

import { createCatalog } from '@json-render/core'
import { z } from 'zod'

export const vesperCatalog = createCatalog({
  components: {
    // ============================================
    // Layout Components
    // ============================================
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

    // ============================================
    // Display Components
    // ============================================
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

    // ============================================
    // Interactive Components
    // ============================================
    Button: {
      props: z.object({
        label: z.string(),
        variant: z.enum(['default', 'secondary', 'outline', 'destructive', 'ghost']).default('default'),
        size: z.enum(['default', 'sm', 'lg']).default('default'),
        action: z.string().describe('Action name to execute on click'),
        disabled: z.boolean().optional(),
      }),
      description: 'Clickable button that triggers an action',
    },

    TextField: {
      props: z.object({
        label: z.string().optional(),
        valuePath: z.string().describe('Data path to bind the input value'),
        placeholder: z.string().optional(),
        type: z.enum(['text', 'email', 'number', 'password', 'url']).default('text'),
      }),
      description: 'Text input field with data binding',
    },

    SelectField: {
      props: z.object({
        label: z.string().optional(),
        bindPath: z.string().describe('Data path to bind the selected value'),
        options: z.array(z.object({
          value: z.string(),
          label: z.string(),
        })),
        placeholder: z.string().optional(),
      }),
      description: 'Dropdown select with options',
    },
  },

  actions: {
    copy: { description: 'Copy text to clipboard. Params: { text: string }' },
    open_url: { description: 'Open a URL in browser. Params: { url: string }' },
    log: { description: 'Log data for debugging. Params: any' },
  },
})

/**
 * Tool definition for the agent
 * This tool allows the AI to generate UI components inline in chat
 */
export const RENDER_UI_TOOL = {
  name: 'render_ui',
  description: `Generate a UI to display in chat. Available components:

LAYOUT:
- Card: Container with optional title/description. Can contain other components.
- Stack: Layout container. direction: "horizontal" | "vertical", gap: "sm" | "md" | "lg"

DISPLAY:
- Text: Display text. variant: "p" | "h1" | "h2" | "h3" | "muted"
- Badge: Status indicator. variant: "default" | "secondary" | "outline" | "destructive"
- Table: Data table with columns and rows. Max 100 rows.

INTERACTIVE:
- Button: Clickable button. label, variant, action (action name string), disabled
- TextField: Text input. label, valuePath (data binding path), placeholder, type
- SelectField: Dropdown. label, bindPath, options: [{value, label}], placeholder

ACTIONS (for Button):
- copy: Copy text to clipboard. Use action: "copy" with params.text
- open_url: Open URL in browser. Use action: "open_url" with params.url
- log: Debug logging. Use action: "log" with any params

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
