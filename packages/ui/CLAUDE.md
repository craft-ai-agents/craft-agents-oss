# CLAUDE.md - UI Package

This file provides guidance to Claude Code when working with the `@g4os/ui` package.

## Overview

Platform-agnostic React component library for rendering agent sessions, chat messages, code diffs, terminal output, and content overlays. Used by both the Electron app (full interactive) and the web viewer (read-only).

## Directory Structure

```
packages/ui/src/
├── components/
│   ├── chat/                # Chat display components
│   │   ├── SessionViewer.tsx    # Read-only session transcript viewer
│   │   ├── TurnCard.tsx         # Single agent turn (user msg + assistant response)
│   │   ├── ResponseCard.tsx     # Assistant response with tool calls
│   │   ├── UserMessageBubble.tsx
│   │   ├── SystemMessage.tsx
│   │   └── AcceptPlanDropdown.tsx
│   ├── markdown/            # Markdown rendering
│   │   ├── Markdown.tsx         # Main renderer (react-markdown + remark-gfm)
│   │   ├── MemoizedMarkdown.tsx # Memoized version for streaming
│   │   ├── CodeBlock.tsx        # Fenced code blocks with syntax highlighting
│   │   ├── InlineCode.tsx
│   │   └── CollapsibleSection.tsx
│   ├── overlay/             # Fullscreen content preview overlays
│   │   ├── FullscreenOverlayBase.tsx
│   │   ├── PreviewOverlay.tsx   # Auto-detects content type
│   │   ├── CodePreviewOverlay.tsx
│   │   ├── MultiDiffPreviewOverlay.tsx
│   │   ├── TerminalPreviewOverlay.tsx
│   │   ├── JSONPreviewOverlay.tsx
│   │   ├── ImagePreviewOverlay.tsx
│   │   ├── PDFPreviewOverlay.tsx
│   │   ├── DataTableOverlay.tsx
│   │   ├── MermaidPreviewOverlay.tsx
│   │   └── GenericOverlay.tsx
│   ├── code-viewer/         # Syntax highlighting and diffs
│   │   ├── ShikiCodeViewer.tsx
│   │   ├── ShikiDiffViewer.tsx
│   │   ├── UnifiedDiffViewer.tsx
│   │   └── DiffViewerControls.tsx
│   ├── terminal/            # Terminal output rendering
│   │   └── TerminalOutput.tsx   # ANSI color parsing
│   └── ui/                  # UI primitives
├── context/
│   ├── PlatformProvider.tsx     # Platform abstraction (Electron vs web)
│   └── ShikiThemeProvider.tsx   # Syntax highlighting theme
├── lib/
│   ├── tool-parsers.ts          # Parse tool inputs/results for display
│   ├── file-classification.ts   # Detect file types for preview
│   └── layout.ts                # Layout utilities
└── index.ts                     # Main exports
```

## Key Concepts

### Platform Abstraction

Components work across Electron and web via `PlatformProvider`:

```typescript
const { openFile, openUrl, copyToClipboard, openInEditor } = usePlatform()

// Electron: full file system access, editor integration
// Web viewer: limited to URL opening and clipboard
```

### SessionViewer

The main read-only viewer component, used by both the web viewer app and for session replay:

```typescript
<SessionViewer
  session={session}
  onOverlayOpen={handleOverlay}
  platform="electron" // or "web"
/>
```

### Overlay System

Content preview overlays auto-detect type and render appropriately:
- **Code:** Shiki syntax highlighting with theme support
- **Diffs:** Unified or split view with file navigation
- **Terminal:** ANSI color parsing
- **JSON:** Collapsible tree view
- **Images/PDFs:** Native rendering
- **Mermaid:** SVG diagram rendering via `@g4os/mermaid`
- **Data tables:** Tabular data display

### Markdown Rendering

Uses `react-markdown` with `remark-gfm` and `rehype-raw`:
- `MemoizedMarkdown` prevents re-renders during streaming
- `CodeBlock` integrates Shiki for syntax highlighting
- `CollapsibleSection` for long content blocks

## Dependencies

- `@g4os/core` — types (Message, AgentEvent, etc.)
- `@g4os/mermaid` — diagram rendering
- `react-markdown`, `remark-gfm`, `rehype-raw` — markdown
- `shiki` — syntax highlighting
- `react-pdf` — PDF rendering
- `@radix-ui/*` — headless UI primitives
- `lucide-react` — icons

## Conventions

- Components accept data props, never fetch directly
- Platform-specific behavior goes through `usePlatform()` hook
- Overlays extend `FullscreenOverlayBase` for consistent styling
- Tool result parsing is centralized in `lib/tool-parsers.ts`
- File type detection in `lib/file-classification.ts` determines which overlay to show
