# CLAUDE.md — `@archstudio/ui`

## Purpose
React UI component library for rendering agent sessions, chat, markdown, code, and interactive overlays in ARCHstudio.

## Current scope
- Chat message rendering (turns, streaming, annotations)
- Markdown rendering (Tiptap editor, Mermaid, math, code blocks)
- Code viewer with syntax highlighting and diffs
- Interactive annotations (plan steps, follow-ups)
- Terminal/ANSI output
- Form components (input, select, toggle, checkbox)
- Overlay management (fullscreen, islands, escape stack)
- Accessibility and keyboard navigation

## Commands
From repo root:
```bash
cd packages/ui && bun run tsc --noEmit
bun test packages/ui
```

## Hard rules
- All user-facing text must use `useTranslation()` (i18next)
- Components are render-only (no business logic)
- Styling uses Tailwind + design tokens (no CSS-in-JS)
- Annotations use island-based rendering (batch DOM updates)
- Rich blocks must trigger events, not direct mutations
- Escape key handling uses centralized stack (avoid conflicts)

## Key architectural patterns

### Turn-based rendering (`turn-utils.ts`)
Messages are grouped into **turns** (user input → assistant response) before rendering. Each turn has a **phase** (planning, executing, complete). Annotations (plan steps, follow-ups) are keyed to turn phases, not individual messages.

**Never render raw message arrays.** Always call `groupMessagesByTurn()` first:
```typescript
const turns = groupMessagesByTurn(messages);
turns.forEach(turn => <TurnRenderer key={turn.id} turn={turn} />)
```

### Markdown rendering (`markdown/index.ts`)
Markdown → Tiptap AST → React. Three rendering paths:
1. **Editor mode** — Full Tiptap editor with slash commands, collaborative editing
2. **Viewer mode** — Read-only Tiptap rendering (fast, preserves formatting)
3. **Plaintext** — Just the text, no formatting (fallback)

Rich blocks (buttons, dropdowns, inputs) inside markdown trigger `rich-block-events.ts` handlers, which publish to an overlay system — don't mount overlays directly in markdown.

### Annotations (`annotations/core.ts`)
Annotations are interactive overlays bound to messages (plan steps, follow-up suggestions). They use an **island** system to batch DOM updates and avoid layout thrashing.

**Island lifecycle:**
1. Annotation data arrives → `annotation-core.ts` creates annotation AST
2. Islands are identified (boundaries where no nesting occurs)
3. Islands are presented via `annotation-host-config.ts` (style, animation)
4. Interaction happens → `interaction-state-machine.ts` updates state
5. Dismiss policy (`island-dismiss-policy.ts`) decides if island stays

Each annotation island is a rect with (x, y, w, h) + payload. Islands don't re-layout on state changes (they're positioned absolutely). Selection can be restored after interactions.

### Rich block interactions (`overlay/useRichBlockInteractions.ts`)
Markdown can embed rich blocks (buttons, inputs, selects). When a user interacts with a rich block:
1. Event is captured in markdown context
2. `rich-block-events.ts` publishes to global handler
3. Handler looks up the interaction spec (`rich-block-interaction-spec.ts`)
4. Overlay is created (fullscreen or inline based on spec)
5. On submit/cancel, overlay is dismissed and event is fired to backend

Never create overlays directly from markdown. Always go through the interaction spec system.

### Code viewer language detection
Language is inferred from:
1. Explicit fence header (`\`\`\`typescript`)
2. File extension (`.ts` → TypeScript)
3. Content sniffing (if header is missing)

Shiki themes are registered at startup (`registerShikiThemes.ts`). Dark mode uses `nord`, light mode uses `github-light`.

### Terminal/ANSI rendering (`terminal/ansi-parser.ts`)
Parses ANSI escape sequences (colors, bold, italic) and renders as styled spans. Supports 16 basic colors + 256-color palette + truecolor (24-bit). No SGR sequences beyond styling (no cursor movement, etc.).

## Source of truth
- Component exports: `packages/ui/src/index.ts`
- Chat utilities: `packages/ui/src/components/chat/turn-utils.ts`
- Markdown: `packages/ui/src/components/markdown/`
- Annotations: `packages/ui/src/components/annotations/`
- Overlays: `packages/ui/src/components/overlay/`
- Form components: `packages/ui/src/components/ui/`
