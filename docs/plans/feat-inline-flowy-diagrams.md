# feat: Inline Flowy Diagrams

> Transform Flowy from a standalone diagramming tool into a **visual communication channel** between Claude and users within conversations.

## Overview

Flowy diagrams (flowcharts and UI mockups) should render inline in chat messages, not in a separate sidebar panel. Claude creates diagrams via skill commands, users edit them visually, and Claude reads the changes to respond intelligently.

**Key Insight:** Flowy is a conversation tool, not a separate feature.

```
User: "Explain the authentication flow"

Claude: [Creates flowchart via /flowy-flowchart skill]
        "Here's the auth flow: [📊 Auth Flow Diagram]
         The red node is where your bug likely is."

User: [Edits diagram - adds "2FA" step]

Claude: [Reads visual edit from context]
        "I see you added 2FA. Let me update the code..."
```

## Problem Statement

The current Flowy implementation is isolated in a sidebar panel, disconnected from conversations:

1. **Navigation Friction**: Users must leave their chat to create/view diagrams
2. **No Claude Integration**: Claude can't create or read diagrams
3. **Context Lost**: Diagrams aren't associated with specific messages/conversations
4. **Manual Workflow**: Users create diagrams manually, not through natural conversation

## Proposed Solution

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Chat Message                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ "Here's the data flow:"                              │    │
│  │                                                      │    │
│  │  ┌──────────────────────────────────────────────┐   │    │
│  │  │  [FlowyInlineEmbed]                          │   │    │
│  │  │   📊 Data Flow Diagram                       │   │    │
│  │  │   ┌─────┐    ┌─────┐    ┌─────┐            │   │    │
│  │  │   │User │───▶│ API │───▶│ DB  │            │   │    │
│  │  │   └─────┘    └─────┘    └─────┘            │   │    │
│  │  │                    [Edit] [Fullscreen]      │   │    │
│  │  └──────────────────────────────────────────────┘   │    │
│  │                                                      │    │
│  │ "The bottleneck is at the DB query."                │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. Claude invokes skill → /flowy-flowchart "Auth Flow"
2. Skill creates FlowyDocument → stored in session message data
3. Message renders → FlowyInlineEmbed component
4. User edits → changes saved to message, broadcast via IPC
5. Next message → diagram context injected for Claude
6. Claude responds → references the visual changes
```

## Technical Approach

### 1. Extend Message Data Model

**File:** `packages/core/src/types/message.ts`

```typescript
// New interface for inline diagram embeds
export interface FlowyInlineEmbed {
  /** Unique embed ID within message */
  id: string;
  /** Diagram document (stored inline with message) */
  document: FlowyDocument;
  /** Display mode */
  displayMode: 'thumbnail' | 'preview' | 'full';
  /** Position marker in content string (like badges) */
  position: number;
}

// Extend StoredMessage
export interface StoredMessage {
  // ... existing fields

  /** Inline Flowy diagram embeds */
  flowyEmbeds?: FlowyInlineEmbed[];
}
```

### 2. Create Flowy Skills

**File:** `~/.vesper/skills/flowy-flowchart/SKILL.md`

```yaml
---
name: Flowy Flowchart
description: Create a flowchart diagram inline in the conversation
icon: workflow
triggers:
  - /flowy-flowchart
  - create flowchart
  - draw diagram
---

Create a flowchart to visualize processes, flows, or architectures.

## Usage
/flowy-flowchart [name] - Creates a new flowchart with the given name

## Output Format
Return a FlowyDocument JSON that will render inline in the message.

## Example
User: /flowy-flowchart "User Authentication"
Claude: Creates flowchart with Login → Validate → Token → Session nodes
```

**File:** `~/.vesper/skills/flowy-ui-mockup/SKILL.md`

```yaml
---
name: Flowy UI Mockup
description: Create an iPhone UI mockup inline in the conversation
icon: smartphone
triggers:
  - /flowy-ui-mockup
  - create mockup
  - draw ui
---

Create an iPhone UI mockup to visualize app screens and navigation.
```

### 3. Implement FlowyInlineEmbed Component

**File:** `packages/ui/src/components/chat/FlowyInlineEmbed.tsx`

```typescript
interface FlowyInlineEmbedProps {
  embed: FlowyInlineEmbed;
  onEdit?: (updatedDocument: FlowyDocument) => void;
  onOpenFullscreen?: () => void;
  isEditable?: boolean;
}

export function FlowyInlineEmbed({
  embed,
  onEdit,
  onOpenFullscreen,
  isEditable = true
}: FlowyInlineEmbedProps) {
  const [isQuickEditOpen, setQuickEditOpen] = useState(false);

  return (
    <div className="flowy-inline-embed rounded-lg border bg-background/50 p-3 my-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {embed.document.type === 'flowchart' ? (
            <Workflow className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Smartphone className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{embed.document.name}</span>
        </div>
        <div className="flex gap-1">
          {isEditable && (
            <Button variant="ghost" size="sm" onClick={() => setQuickEditOpen(true)}>
              Edit
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onOpenFullscreen}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Diagram Preview */}
      <FlowyPreviewRenderer
        document={embed.document}
        maxHeight={300}
        onClick={() => isEditable && setQuickEditOpen(true)}
      />

      {/* Quick Edit Popover */}
      {isQuickEditOpen && (
        <FlowyQuickEditor
          document={embed.document}
          onSave={(doc) => { onEdit?.(doc); setQuickEditOpen(false); }}
          onClose={() => setQuickEditOpen(false)}
          onOpenFullscreen={onOpenFullscreen}
        />
      )}
    </div>
  );
}
```

### 4. Update Message Rendering

**File:** `packages/ui/src/components/chat/UserMessageBubble.tsx`

Extend `renderContentWithBadges()` to handle `flowyEmbeds`:

```typescript
function renderContentWithFlowyEmbeds(
  content: string,
  badges: ContentBadge[],
  flowyEmbeds: FlowyInlineEmbed[],
  onFlowyEdit: (embedId: string, doc: FlowyDocument) => void
): React.ReactNode[] {
  // Merge badges and embeds by position
  const allInlineContent = [
    ...badges.map(b => ({ type: 'badge' as const, item: b, position: b.start })),
    ...flowyEmbeds.map(e => ({ type: 'flowy' as const, item: e, position: e.position })),
  ].sort((a, b) => a.position - b.position);

  const elements: React.ReactNode[] = [];
  let lastEnd = 0;

  allInlineContent.forEach((inline, i) => {
    // Add text before this inline content
    if (inline.position > lastEnd) {
      elements.push(
        <MarkdownContent key={`text-${i}`}>
          {content.slice(lastEnd, inline.position)}
        </MarkdownContent>
      );
    }

    if (inline.type === 'badge') {
      elements.push(<InlineBadge key={`badge-${i}`} badge={inline.item} />);
      lastEnd = inline.item.end;
    } else {
      elements.push(
        <FlowyInlineEmbed
          key={`flowy-${i}`}
          embed={inline.item}
          onEdit={(doc) => onFlowyEdit(inline.item.id, doc)}
        />
      );
      lastEnd = inline.position; // Embeds are point insertions
    }
  });

  // Add remaining text
  if (lastEnd < content.length) {
    elements.push(<MarkdownContent key="text-final">{content.slice(lastEnd)}</MarkdownContent>);
  }

  return elements;
}
```

### 5. Claude Context Injection

**File:** `packages/shared/src/agent/context-builder.ts`

When user sends a message in a session with diagram embeds, inject diagram state:

```typescript
export function buildDiagramContext(embeds: FlowyInlineEmbed[]): string {
  if (embeds.length === 0) return '';

  const diagramContexts = embeds.map(embed => {
    const doc = embed.document;

    if (doc.type === 'flowchart') {
      const flowchart = doc.content as FlowyFlowchart;
      return `
<diagram id="${embed.id}" name="${doc.name}" type="flowchart">
  <nodes>
${flowchart.nodes.map(n => `    <node id="${n.id}" label="${n.label}" type="${n.type}" />`).join('\n')}
  </nodes>
  <edges>
${flowchart.edges.map(e => `    <edge from="${e.source}" to="${e.target}" label="${e.label || ''}" />`).join('\n')}
  </edges>
</diagram>`;
    } else {
      const mockup = doc.content as FlowyMockup;
      return `
<diagram id="${embed.id}" name="${doc.name}" type="mockup">
  <screens>
${mockup.screens.map(s => `    <screen id="${s.id}" title="${s.title}" />`).join('\n')}
  </screens>
</diagram>`;
    }
  });

  return `<diagram_context>\n${diagramContexts.join('\n')}\n</diagram_context>`;
}
```

### 6. Session Storage Updates

**File:** `packages/shared/src/sessions/storage.ts`

Diagram embeds are stored inline with messages in JSONL format - no changes needed to storage format, just ensure `FlowyInlineEmbed` serializes correctly.

### 7. IPC for Diagram Updates

**File:** `apps/electron/src/shared/types.ts`

```typescript
// Add new IPC channels
export const IPC_CHANNELS = {
  // ... existing channels

  // Inline diagram updates
  FLOWY_EMBED_UPDATE: 'flowy:embed-update',
  FLOWY_EMBED_GET_PREVIEW: 'flowy:embed-get-preview',
} as const;
```

**File:** `apps/electron/src/preload/index.ts`

```typescript
flowyEmbedUpdate: (sessionId: string, messageId: string, embedId: string, document: FlowyDocument) =>
  ipcRenderer.invoke(IPC_CHANNELS.FLOWY_EMBED_UPDATE, sessionId, messageId, embedId, document),

flowyEmbedGetPreview: (document: FlowyDocument, width: number, height: number) =>
  ipcRenderer.invoke(IPC_CHANNELS.FLOWY_EMBED_GET_PREVIEW, document, width, height),
```

## Acceptance Criteria

### Functional Requirements

- [ ] **Skill Creation**: `/flowy-flowchart` and `/flowy-ui-mockup` skills create diagrams inline in Claude's response
- [ ] **Inline Rendering**: Diagrams render in chat messages with preview visualization
- [ ] **Quick Edit**: Double-click diagram to open inline property editor
- [ ] **Fullscreen Edit**: "Fullscreen" button opens complete diagram editor
- [ ] **Auto-Save**: Edits save automatically with 500ms debounce
- [ ] **Claude Context**: Diagram state injected into Claude context on subsequent messages
- [ ] **Claude Updates**: Claude can propose diagram modifications that user can accept/reject

### Non-Functional Requirements

- [ ] **Performance**: Session with 10 diagrams loads in <1s
- [ ] **Memory**: Closing fullscreen editor releases memory within 1 tick
- [ ] **Accessibility**: Full keyboard navigation (Tab, Enter, Escape, Arrow keys)
- [ ] **Screen Reader**: Diagram announces name, type, and element count

### Quality Gates

- [ ] Unit tests for FlowyInlineEmbed component
- [ ] Integration tests for skill execution → render flow
- [ ] E2E test for edit → save → Claude context injection
- [ ] Accessibility audit passes WCAG AA

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Diagram creation success rate | >95% | Skill executions without error |
| User edit completion rate | >80% | Started edits that are saved |
| Claude context accuracy | 100% | Diagram state correctly injected |
| Render performance | <100ms | Time from message load to diagram visible |

## Dependencies & Prerequisites

### Existing Components to Leverage

| Component | Location | Usage |
|-----------|----------|-------|
| FlowyDocument types | `packages/shared/src/flowy/types.ts` | Data model |
| ContentBadge system | `packages/core/src/types/message.ts` | Pattern for inline content |
| Skills system | `packages/shared/src/skills/` | Skill definition format |
| Session persistence | `packages/shared/src/sessions/storage.ts` | JSONL storage |
| FlowyListPanel | `apps/electron/src/renderer/components/flowy/` | Reference UI patterns |

### New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| react-flow-renderer | Node-based diagram editor | ~150KB gzipped |
| @react-flow/dagre | Auto-layout for flowcharts | ~20KB gzipped |

## Risk Analysis & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| React Flow bundle size | Slow initial load | Medium | Code-split, lazy load editor |
| Complex undo/redo | Data corruption | Low | Use Immer for immutable state |
| Large diagrams slow render | Poor UX | Medium | Virtualize >50 nodes |
| Claude context token usage | Expensive API calls | Medium | Summarize large diagrams |

## Implementation Phases

### Phase 1: Foundation (MVP)
- [ ] Extend `StoredMessage` with `flowyEmbeds` field
- [ ] Create `/flowy-flowchart` skill that outputs JSON
- [ ] Build `FlowyInlineEmbed` component (read-only preview)
- [ ] Update message rendering to include embeds

### Phase 2: Editing
- [ ] Implement quick edit popover (rename, node labels)
- [ ] Build fullscreen editor with React Flow
- [ ] Add auto-save with debounce
- [ ] Wire up IPC for embed updates

### Phase 3: Claude Integration
- [ ] Implement diagram context injection
- [ ] Add Claude diagram modification parsing
- [ ] Build accept/reject UI for Claude changes
- [ ] Create `/flowy-ui-mockup` skill

### Phase 4: Polish
- [ ] Accessibility audit and fixes
- [ ] Performance optimization (lazy loading, virtualization)
- [ ] Export diagrams with session
- [ ] Keyboard shortcuts documentation

## Future Considerations

- **Real-time Collaboration**: Yjs integration for multi-user editing
- **Template Library**: Pre-built diagram templates (ERD, sequence, state machine)
- **Import/Export**: Mermaid, Figma, draw.io compatibility
- **AI Enhancement**: "Improve this diagram" command for Claude to optimize layout

## References

### Internal References
- Existing Flowy types: `packages/shared/src/flowy/types.ts`
- ContentBadge pattern: `packages/core/src/types/message.ts:66-93`
- Message rendering: `packages/ui/src/components/chat/UserMessageBubble.tsx:169-239`
- Skills system: `packages/shared/src/skills/types.ts`
- IPC patterns: `apps/electron/src/preload/index.ts`

### External References
- React Flow documentation: https://reactflow.dev
- tldraw chat starter kit: https://tldraw.dev/starter-kits/chat
- Dagre layout algorithm: https://github.com/dagrejs/dagre

---

*Generated with Claude Code - 2026-01-25*
