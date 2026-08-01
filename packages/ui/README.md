# @archstudio/ui

React UI components and utilities for rendering agent sessions, chat, markdown, code, and interactive content in ARCHstudio.

## Installation

```bash
# In a workspace package
bun add @archstudio/ui
```

Or add to `package.json`:
```json
{
  "dependencies": {
    "@archstudio/ui": "workspace:*"
  }
}
```

## Overview

`@archstudio/ui` provides all React components and rendering logic for the ARCHstudio interface:
- **Chat rendering** — Message display, turn grouping, streaming support
- **Markdown** — Rich markdown rendering with Tiptap, Mermaid diagrams, math
- **Code viewer** — Syntax highlighting with Shiki, diff rendering
- **Annotations** — Interactive annotations, plan steps, follow-ups
- **Icons** — Icon system with Lucide React
- **Terminal** — ANSI color output rendering
- **Overlays** — Fullscreen mode, rich block interactions, dismiss policies
- **Form components** — Input, dropdown, toggle, checkbox components
- **Utilities** — Layout helpers, file classification, tool parsing

## Key Modules

### Chat (`src/components/chat/`)
- Turn-based message grouping and rendering
- Streaming message support
- Plan annotation integration
- Follow-up suggestions
- Turn phase tracking (planning, executing, complete)

### Markdown (`src/components/markdown/`)
- Tiptap-based editor and renderer
- Mermaid diagram support
- LaTeX math rendering
- Collapsible sections
- Link routing and external URL handling
- Markdown diff rendering
- Rich block event handling

### Code Viewer (`src/components/code-viewer/`)
- Shiki syntax highlighting (30+ languages)
- Language detection
- Copy-to-clipboard
- Diff view support
- Line numbering and folding

### Annotations (`src/components/annotations/`)
- Interactive plan step annotations
- Island-based presentation (avoid layout thrashing)
- Dismiss policies (smart, always, never)
- Selection restoration
- Interaction state machine
- Follow-up state tracking

### UI Components (`src/components/ui/`)
- `InlineMenuSurface` — Floating menus
- `Island` — Isolated interactive regions
- Form components (input, select, toggle, checkbox)
- Styled dropdowns with keyboard navigation
- Accessible button and link styles

### Terminal (`src/components/terminal/`)
- ANSI color code parser
- TTY output rendering
- Escape sequence handling

### Overlays (`src/components/overlay/`)
- Fullscreen overlay management
- Rich block interaction specs
- Escape key stack for nested overlays

## Exported Components

### High-level Components
- `ChatDisplay` — Full chat session renderer
- `MarkdownRenderer` — Render markdown content
- `CodeViewer` — Display and diff code
- `AnnotationHost` — Render interactive annotations

### Form Components
- `Input` — Text input field
- `Select` / `SelectMenu` — Dropdown selection
- `Toggle` / `Checkbox` — Boolean inputs
- `Button` — Action button
- `TextArea` — Multi-line text input

### Utilities
- `useAnnotationIsland()` — Manage annotation islands
- `useRichBlockInteractions()` — Handle rich block interactions
- `useIslandNavigation()` — Keyboard navigation in islands
- `toolParsers` — Parse tool calls from text
- `fileClassification()` — Determine file type from path/content
- `openExternalUrl()` — Safe external link opening

## Styling

Components use Tailwind CSS + design tokens:
- `--ds-text` — Text color
- `--ds-background` — Background color
- `--ds-panel` — Panel background
- `--ds-border` — Border color
- `--ds-elevation-*` — Shadow levels (elevation-1 through elevation-4)
- `--brand-lime`, `--brand-purple` — Brand colors

## Development

```bash
# Type-check
cd packages/ui && bun run tsc --noEmit

# Run tests
bun test packages/ui

# Build
bun run build:ui
```

## Dependencies

- React 18+
- `@tiptap/react` — Editor framework
- `@rnag/markdown-to-tiptap` — Markdown → Tiptap conversion
- `shiki` — Syntax highlighting
- `remark` — Markdown processing
- `rehype` — HTML processing
- `date-fns` — Date formatting
- `lucide-react` — Icons
- Tailwind CSS — Styling

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- No IE11 support

## License

MIT
