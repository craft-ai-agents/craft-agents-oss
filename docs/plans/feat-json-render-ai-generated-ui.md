# feat: Integrate json-render for AI-Generated Session UI (MVP)

## Overview

Enable AI agents to generate simple, read-only UI components inline in chat messages. This MVP validates whether AI-generated UI is useful before investing in a full-featured system.

**Scope:** 5 components, inline placement only, no actions, ~200 lines of code.

## Problem Statement

Vesper agent responses are limited to plain text with markdown. Users cannot see structured data (tables, cards, metrics) in a rich visual format.

## Proposed Solution (MVP)

### Architecture

```
VesperAgent
  └── render_ui tool (generates JSON)
           │
           ▼
     Message with jsonRender property
           │
           ▼
     ChatDisplay renders <JSONRenderView>
           │
           ▼
     5 shadcn components (Card, Stack, Text, Badge, Table)
```

**No IPC handlers. No event processor changes. No atoms. Just render JSON in chat.**

### File Structure (3 files)

```
apps/electron/src/renderer/components/json-render/
├── catalog.ts           # Component definitions + tool schema (~40 lines)
├── JSONRenderView.tsx   # Renderer with error boundary (~100 lines)
└── index.ts             # Exports (~5 lines)
```

---

## Implementation

### 1. Install Dependency

```bash
cd apps/electron && bun add @json-render/core @json-render/react
```

### 2. Create Catalog

**File:** `apps/electron/src/renderer/components/json-render/catalog.ts`

```typescript
import { createCatalog } from '@json-render/core';
import { z } from 'zod';

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
        data: z.array(z.record(z.unknown())).max(100),
      }),
      description: 'Data table (max 100 rows)',
    },
  },

  actions: {}, // No actions in MVP
});

// Tool definition for the agent
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
    type: 'object',
    properties: {
      tree: {
        type: 'object',
        properties: {
          root: { type: 'string' },
          elements: { type: 'object' },
        },
        required: ['root', 'elements'],
      },
    },
    required: ['tree'],
  },
};
```

### 3. Create Renderer

**File:** `apps/electron/src/renderer/components/json-render/JSONRenderView.tsx`

```typescript
import { memo, Component, type ReactNode } from 'react';
import { Renderer } from '@json-render/react';
import type { UITree } from '@json-render/core';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { cn } from '@/lib/utils';

// Error boundary for graceful failure
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class JSONRenderErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          Failed to render AI-generated UI
        </div>
      );
    }
    return this.props.children;
  }
}

// Component registry mapping to shadcn/ui
const components = {
  Card: ({ element, children }: { element: any; children?: ReactNode }) => (
    <Card className="my-2">
      {(element.props.title || element.props.description) && (
        <CardHeader className="pb-2">
          {element.props.title && (
            <CardTitle className="text-base">{element.props.title}</CardTitle>
          )}
          {element.props.description && (
            <CardDescription>{element.props.description}</CardDescription>
          )}
        </CardHeader>
      )}
      <CardContent className={element.props.title ? '' : 'pt-4'}>
        {children}
      </CardContent>
    </Card>
  ),

  Stack: ({ element, children }: { element: any; children?: ReactNode }) => {
    const gapClass = { sm: 'gap-1', md: 'gap-3', lg: 'gap-5' }[element.props.gap || 'md'];
    return (
      <div
        className={cn(
          'flex',
          element.props.direction === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col',
          gapClass
        )}
      >
        {children}
      </div>
    );
  },

  Text: ({ element }: { element: any }) => {
    const styles: Record<string, string> = {
      p: 'text-sm',
      h1: 'text-2xl font-bold',
      h2: 'text-xl font-semibold',
      h3: 'text-lg font-medium',
      muted: 'text-sm text-muted-foreground',
    };
    const Tag = element.props.variant?.startsWith('h') ? element.props.variant : 'p';
    return <Tag className={styles[element.props.variant || 'p']}>{element.props.content}</Tag>;
  },

  Badge: ({ element }: { element: any }) => (
    <Badge variant={element.props.variant}>{element.props.label}</Badge>
  ),

  Table: ({ element }: { element: any }) => (
    <div className="rounded-md border overflow-auto max-h-[400px]">
      <Table>
        <TableHeader>
          <TableRow>
            {element.props.columns?.map((col: { key: string; header: string }) => (
              <TableHead key={col.key}>{col.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {element.props.data?.slice(0, 100).map((row: Record<string, unknown>, i: number) => (
            <TableRow key={i}>
              {element.props.columns?.map((col: { key: string }) => (
                <TableCell key={col.key}>{String(row[col.key] ?? '')}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};

interface JSONRenderViewProps {
  tree: UITree;
}

export const JSONRenderView = memo(function JSONRenderView({ tree }: JSONRenderViewProps) {
  // Basic validation
  if (!tree?.root || !tree?.elements?.[tree.root]) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Invalid UI structure
      </div>
    );
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
  );
});
```

### 4. Create Index

**File:** `apps/electron/src/renderer/components/json-render/index.ts`

```typescript
export { JSONRenderView } from './JSONRenderView';
export { vesperCatalog, RENDER_UI_TOOL } from './catalog';
```

### 5. Add to Message Type

**File:** `apps/electron/src/shared/types.ts` (add to Message interface)

```typescript
// Add to existing Message interface
jsonRender?: {
  tree: import('@json-render/core').UITree;
};
```

### 6. Render in ChatDisplay

**File:** In the component that renders chat messages, add:

```typescript
import { JSONRenderView } from '../json-render';

// Inside message rendering logic:
{message.jsonRender?.tree && (
  <div className="my-3">
    <JSONRenderView tree={message.jsonRender.tree} />
  </div>
)}
```

### 7. Register Tool with Agent

Add `RENDER_UI_TOOL` to the agent's tool list. When the tool is called, create a message with `jsonRender: { tree: toolResult.tree }`.

---

## Feature Flag

Add a simple feature flag for safe rollout:

```typescript
// In config or environment
export const FEATURES = {
  JSON_RENDER_ENABLED: process.env.NODE_ENV === 'development',
};

// When registering tool
if (FEATURES.JSON_RENDER_ENABLED) {
  tools.push(RENDER_UI_TOOL);
}
```

---

## What's NOT in MVP (Deferred)

| Feature | Reason to Defer |
|---------|-----------------|
| Panel/Canvas placements | Inline is sufficient to validate usefulness |
| Actions (buttons, forms) | Adds complexity; start read-only |
| 9 additional components | 5 covers 90% of use cases |
| Custom validation layer | Library validation is sufficient |
| IPC handlers | No actions = no IPC needed |
| Streaming optimizations | Premature optimization |
| Jotai atoms for state | No panel/canvas state to manage |

---

## Acceptance Criteria

### Functional
- [x] AI can call `render_ui` tool with a tree of 5 component types
- [x] UI renders inline in chat messages
- [x] Invalid trees show graceful error state
- [ ] UI persists when session is reloaded

### Non-Functional
- [ ] Feature flag controls availability
- [x] Error boundary prevents crashes
- [ ] Renders 50 components without visible lag

### Quality
- [ ] Unit tests for JSONRenderView with valid/invalid trees
- [ ] Manual test with each component type

---

## Example Usage

Agent generates:

```json
{
  "tree": {
    "root": "card1",
    "elements": {
      "card1": {
        "type": "Card",
        "props": { "title": "User Statistics" },
        "children": ["stack1"]
      },
      "stack1": {
        "type": "Stack",
        "props": { "direction": "horizontal", "gap": "lg" },
        "children": ["badge1", "badge2", "badge3"]
      },
      "badge1": { "type": "Badge", "props": { "label": "Active: 1,234" } },
      "badge2": { "type": "Badge", "props": { "label": "New: 56", "variant": "secondary" } },
      "badge3": { "type": "Badge", "props": { "label": "Churned: 12", "variant": "destructive" } }
    }
  }
}
```

Renders as a card with three badges in a horizontal row.

---

## Phase 2 (After MVP Validation)

If users find this valuable:
1. Add interactive components (Button, Input, Select, Form)
2. Add action system with confirmation dialogs
3. Add panel placement for larger UIs
4. Add more display components (Metric, Progress, Alert, List)
5. Add streaming support for progressive rendering

---

## References

- [json-render Repository](https://github.com/vercel-labs/json-render)
- shadcn/ui components: `apps/electron/src/renderer/components/ui/`

---

*MVP scope based on reviewer feedback: DHH, Kieran, Simplicity Reviewer*
*Estimated implementation: 2-4 hours, ~150 lines of code*
