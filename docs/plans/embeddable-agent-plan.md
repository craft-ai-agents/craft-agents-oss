# Implementation Plan: Embeddable Craft Agent for React Apps

> **Goal:** Enable any React developer to embed Craft Agent directly into their web application, allowing them to edit their app's source code while viewing the running app, with full context awareness of what component they're looking at.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals & Success Criteria](#2-goals--success-criteria)
3. [Architecture Overview](#3-architecture-overview)
4. [Package Structure](#4-package-structure)
5. [Implementation Phases](#5-implementation-phases)
6. [Detailed Component Specifications](#6-detailed-component-specifications)
7. [API Reference](#7-api-reference)
8. [Testing Strategy](#8-testing-strategy)
9. [Security Considerations](#9-security-considerations)
10. [Future Enhancements](#10-future-enhancements)

---

## 1. Executive Summary

### The Problem

Developers currently need to context-switch between their running application and their code editor when making changes. They lose context about what they're looking at, and AI assistants don't understand the visual/component context of the running app.

### The Solution

Create `@craft-agent/embed` - an embeddable React component + build plugin that:
1. Renders a chat panel inside any React application
2. Detects which component the user is viewing/clicking on
3. Communicates with a local dev server running CraftAgent
4. Enables Claude to edit source files with instant hot-reload feedback

### Key Innovation

**Context Bridge**: Leverages React's built-in `__source` metadata (added during development builds) combined with Fiber tree introspection to correlate running components with their source file locations - no special build configuration required from the user.

---

## 2. Goals & Success Criteria

### Primary Goals

| Goal | Description | Success Metric |
|------|-------------|----------------|
| **G1: Zero-config embedding** | Developers can add the agent with minimal setup | 2 lines of config (plugin + component) |
| **G2: Context awareness** | Agent knows which component user is viewing | Can identify component name, file path, line number, props |
| **G3: Live editing** | Changes appear immediately via hot reload | < 500ms from edit to visual update |
| **G4: Platform agnostic** | Works with Vite, webpack, and other bundlers | Vite plugin first, webpack second |
| **G5: Reuse existing UI** | Leverage `@craft-agent/ui` components | ChatView, TurnCard, Markdown reused |

### Non-Goals (Out of Scope for V1)

- Production deployment (dev-only feature)
- Non-React frameworks (Vue, Svelte, Angular)
- Remote/cloud-hosted agent (local only)
- Mobile app support
- Collaborative editing (single user)

### Success Criteria

1. **Developer Experience**: A React developer with a Vite project can add embeddable agent in under 5 minutes
2. **Context Accuracy**: Click-to-inspect correctly identifies source file 95%+ of the time for user-defined components
3. **Edit Reliability**: File edits trigger hot reload without manual refresh
4. **Performance**: Panel renders in <100ms, doesn't impact host app performance

---

## 3. Architecture Overview

### High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           User's React App (Browser)                       │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     <CraftAgentProvider>                              │  │
│  │                                                                       │  │
│  │   ┌─────────────────────────────────────────────────────────────┐    │  │
│  │   │                    <CraftAgentPanel />                       │    │  │
│  │   │  ┌─────────────────┐  ┌────────────────────────────────────┐│    │  │
│  │   │  │ Context Sidebar │  │           Chat Area                ││    │  │
│  │   │  │                 │  │                                    ││    │  │
│  │   │  │ - Screenshot    │  │  ┌──────────────────────────────┐ ││    │  │
│  │   │  │ - Component     │  │  │      ChatView                │ ││    │  │
│  │   │  │ - File Path     │  │  │   (from @craft-agent/ui)     │ ││    │  │
│  │   │  │ - Props         │  │  │                              │ ││    │  │
│  │   │  │ - State         │  │  │  - Messages                  │ ││    │  │
│  │   │  │                 │  │  │  - Tool results              │ ││    │  │
│  │   │  │ [Inspect Btn]   │  │  │  - Streaming                 │ ││    │  │
│  │   │  └─────────────────┘  │  └──────────────────────────────┘ ││    │  │
│  │   │                       │  ┌──────────────────────────────┐ ││    │  │
│  │   │                       │  │         Input Area           │ ││    │  │
│  │   │                       │  └──────────────────────────────┘ ││    │  │
│  │   │  └────────────────────────────────────────────────────────┘│    │  │
│  │   └─────────────────────────────────────────────────────────────┘    │  │
│  │                                                                       │  │
│  │   <InspectOverlay /> (when inspect mode active)                       │  │
│  │                                                                       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                              WebSocket                                      │
│                           ws://localhost:3847                               │
│                                    │                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    Craft Agent Dev Server (Node.js)                        │
│                         (Spawned by Vite Plugin)                           │
│                                                                            │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐  │
│  │    WebSocket       │  │     CraftAgent      │  │   File System      │  │
│  │    Handler         │  │     Instance        │  │   Operations       │  │
│  │                    │  │                     │  │                    │  │
│  │  - Session mgmt    │  │  - Chat streaming   │  │  - Read files      │  │
│  │  - Message routing │  │  - Tool execution   │  │  - Write files     │  │
│  │  - Event broadcast │  │  - MCP connections  │  │  - Watch changes   │  │
│  └────────────────────┘  └─────────────────────┘  └────────────────────┘  │
│                                                                            │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐  │
│  │   Context Engine   │  │    Source Maps      │  │   HMR Bridge       │  │
│  │                    │  │    Parser           │  │                    │  │
│  │  - Build context   │  │                     │  │  - Vite HMR API    │  │
│  │  - Inject to msg   │  │  - Resolve paths    │  │  - Trigger reload  │  │
│  │  - Screenshot proc │  │  - Map line nums    │  │  - Notify client   │  │
│  └────────────────────┘  └─────────────────────┘  └────────────────────┘  │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. User clicks "Inspect" → InspectOverlay activates
2. User clicks component → Fiber tree queried → Source location extracted
3. User types message → Context attached → WebSocket → Dev Server
4. Dev Server → CraftAgent.chat() streams events
5. Agent calls Edit tool → File written → HMR triggered
6. Vite hot reloads → User sees change instantly
7. Events stream back → Panel updates → User sees response
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **WebSocket over HTTP** | Enables bidirectional streaming for agent events |
| **Local dev server** | CraftAgent requires Node.js; keeps data local |
| **Vite plugin first** | Most popular React bundler; best DX |
| **Reuse @craft-agent/ui** | Consistent UI; already battle-tested |
| **React Fiber introspection** | Works without user's build config changes |
| **Development-only** | Security (no prod file access); performance |

---

## 4. Package Structure

### New Package: `packages/embed`

```
packages/embed/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                          # Main exports
│   │
│   ├── components/
│   │   ├── CraftAgentProvider.tsx        # Context provider (wraps app)
│   │   ├── CraftAgentPanel.tsx           # Main panel component
│   │   ├── CraftAgentTrigger.tsx         # Floating trigger button
│   │   ├── ContextSidebar.tsx            # Shows selected component info
│   │   ├── InspectOverlay.tsx            # Full-screen inspect overlay
│   │   ├── ComponentHighlight.tsx        # Highlight box around component
│   │   ├── ConnectionStatus.tsx          # Dev server connection indicator
│   │   ├── ChatContainer.tsx             # Wrapper for ChatView
│   │   └── ScreenshotPreview.tsx         # Thumbnail of captured context
│   │
│   ├── hooks/
│   │   ├── useAgentConnection.ts         # WebSocket connection management
│   │   ├── useInspector.ts               # Click-to-inspect functionality
│   │   ├── useContextCapture.ts          # Screenshot + component tree
│   │   ├── useComponentInfo.ts           # Selected component state
│   │   ├── useSession.ts                 # Chat session state
│   │   └── useHotkeys.ts                 # Keyboard shortcuts
│   │
│   ├── context/
│   │   ├── EmbedContext.tsx              # Global embed state
│   │   └── types.ts                      # Context types
│   │
│   ├── bridge/
│   │   ├── fiber-utils.ts                # React Fiber introspection
│   │   ├── source-resolver.ts            # __source metadata extraction
│   │   ├── component-tree.ts             # Build component tree string
│   │   ├── screenshot.ts                 # html2canvas wrapper
│   │   └── protocol.ts                   # WebSocket message types
│   │
│   ├── styles/
│   │   └── embed.css                     # Scoped styles (CSS modules)
│   │
│   └── utils/
│       ├── constants.ts                  # Default ports, etc.
│       ├── sanitize.ts                   # Sanitize props for display
│       └── logger.ts                     # Debug logging
│
├── vite-plugin/
│   ├── index.ts                          # Plugin entry point
│   ├── dev-server.ts                     # Express + WebSocket server
│   ├── agent-manager.ts                  # CraftAgent lifecycle
│   ├── context-builder.ts                # Build context for messages
│   ├── hmr-bridge.ts                     # Trigger Vite HMR
│   ├── source-map-parser.ts              # Parse source maps
│   └── types.ts                          # Plugin option types
│
└── webpack-plugin/                       # Future: webpack support
    └── index.ts                          # Placeholder
```

### Package.json

```json
{
  "name": "@craft-agent/embed",
  "version": "0.1.0",
  "description": "Embed Craft Agent in any React application",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./vite-plugin": {
      "import": "./dist/vite-plugin/index.js",
      "types": "./dist/vite-plugin/index.d.ts"
    },
    "./styles.css": "./dist/styles/embed.css"
  },
  "peerDependencies": {
    "react": ">=18.0.0",
    "react-dom": ">=18.0.0"
  },
  "dependencies": {
    "@craft-agent/ui": "workspace:*",
    "@craft-agent/shared": "workspace:*",
    "@craft-agent/core": "workspace:*",
    "html2canvas": "^1.4.1",
    "ws": "^8.16.0",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "@types/ws": "^8.5.10",
    "@types/express": "^4.17.21"
  }
}
```

---

## 5. Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal:** Basic package structure, WebSocket communication, simple panel rendering

#### Tasks

| Task | File(s) | Description | Priority |
|------|---------|-------------|----------|
| 1.1 | `packages/embed/package.json` | Create package with dependencies | P0 |
| 1.2 | `packages/embed/tsconfig.json` | TypeScript configuration | P0 |
| 1.3 | `src/bridge/protocol.ts` | Define WebSocket message types | P0 |
| 1.4 | `vite-plugin/dev-server.ts` | Basic Express + WS server | P0 |
| 1.5 | `vite-plugin/index.ts` | Vite plugin that spawns server | P0 |
| 1.6 | `src/hooks/useAgentConnection.ts` | WebSocket hook | P0 |
| 1.7 | `src/context/EmbedContext.tsx` | Global state provider | P0 |
| 1.8 | `src/components/CraftAgentProvider.tsx` | Provider component | P0 |
| 1.9 | `src/components/CraftAgentPanel.tsx` | Basic panel shell | P0 |
| 1.10 | `src/index.ts` | Export all components | P0 |

#### Deliverables
- [ ] Package builds successfully
- [ ] Vite plugin starts dev server on `bun run dev`
- [ ] Panel renders in test app
- [ ] WebSocket connects to dev server
- [ ] Basic message send/receive works

### Phase 2: Agent Integration (Week 2)

**Goal:** CraftAgent running on dev server, chat functionality working

#### Tasks

| Task | File(s) | Description | Priority |
|------|---------|-------------|----------|
| 2.1 | `vite-plugin/agent-manager.ts` | CraftAgent lifecycle management | P0 |
| 2.2 | `vite-plugin/dev-server.ts` | Wire agent to WebSocket handlers | P0 |
| 2.3 | `src/hooks/useSession.ts` | Session state management | P0 |
| 2.4 | `src/components/ChatContainer.tsx` | Integrate ChatView from @craft-agent/ui | P0 |
| 2.5 | `src/components/CraftAgentPanel.tsx` | Add chat area to panel | P0 |
| 2.6 | Event streaming | Stream AgentEvents to client | P0 |
| 2.7 | `vite-plugin/hmr-bridge.ts` | Trigger HMR after file edits | P1 |
| 2.8 | Permission handling | Handle permission requests in panel | P1 |

#### Deliverables
- [ ] Can send message and receive streamed response
- [ ] Tool calls display in chat
- [ ] File edits trigger hot reload
- [ ] Permission requests show in panel

### Phase 3: Context Detection (Week 3)

**Goal:** Click-to-inspect working, component info displayed

#### Tasks

| Task | File(s) | Description | Priority |
|------|---------|-------------|----------|
| 3.1 | `src/bridge/fiber-utils.ts` | React Fiber introspection utilities | P0 |
| 3.2 | `src/bridge/source-resolver.ts` | Extract __source metadata | P0 |
| 3.3 | `src/hooks/useInspector.ts` | Click-to-inspect hook | P0 |
| 3.4 | `src/components/InspectOverlay.tsx` | Overlay during inspect mode | P0 |
| 3.5 | `src/components/ComponentHighlight.tsx` | Highlight hovered component | P0 |
| 3.6 | `src/hooks/useComponentInfo.ts` | Selected component state | P0 |
| 3.7 | `src/components/ContextSidebar.tsx` | Display component info | P0 |
| 3.8 | `src/bridge/component-tree.ts` | Build component tree string | P1 |

#### Deliverables
- [ ] Click-to-inspect mode activates with button/hotkey
- [ ] Hovering highlights components
- [ ] Clicking selects component and shows info
- [ ] Sidebar displays: name, file path, line, props
- [ ] Component tree structure captured

### Phase 4: Visual Context (Week 4)

**Goal:** Screenshot capture, context injection into agent messages

#### Tasks

| Task | File(s) | Description | Priority |
|------|---------|-------------|----------|
| 4.1 | `src/bridge/screenshot.ts` | html2canvas wrapper | P0 |
| 4.2 | `src/hooks/useContextCapture.ts` | Capture full context | P0 |
| 4.3 | `vite-plugin/context-builder.ts` | Build context block for messages | P0 |
| 4.4 | `src/components/ScreenshotPreview.tsx` | Show thumbnail in sidebar | P1 |
| 4.5 | Context attachment | Attach context to user messages | P0 |
| 4.6 | System prompt enhancement | Add context-aware instructions | P1 |

#### Deliverables
- [ ] Screenshot captured on message send
- [ ] Context injected into agent messages
- [ ] Agent can "see" the current screen
- [ ] Thumbnail shows in sidebar

### Phase 5: Polish & DX (Week 5)

**Goal:** Great developer experience, documentation, edge cases

#### Tasks

| Task | File(s) | Description | Priority |
|------|---------|-------------|----------|
| 5.1 | `src/components/CraftAgentTrigger.tsx` | Floating trigger button | P1 |
| 5.2 | `src/components/ConnectionStatus.tsx` | Connection indicator | P1 |
| 5.3 | `src/hooks/useHotkeys.ts` | Keyboard shortcuts | P1 |
| 5.4 | `src/styles/embed.css` | Polished styles | P1 |
| 5.5 | Error handling | Graceful degradation | P1 |
| 5.6 | `README.md` | Usage documentation | P0 |
| 5.7 | Example app | Demo implementation | P1 |
| 5.8 | Dark mode support | Theme adaptation | P2 |

#### Deliverables
- [ ] Trigger button shows/hides panel
- [ ] Connection status visible
- [ ] Cmd+Shift+K opens panel
- [ ] Opt+Click for quick inspect
- [ ] Comprehensive README
- [ ] Working example app

---

## 6. Detailed Component Specifications

### 6.1 CraftAgentProvider

**Purpose:** Provides global context for the embed system

```typescript
// src/components/CraftAgentProvider.tsx

interface CraftAgentProviderProps {
  children: React.ReactNode
  /** Dev server WebSocket URL (default: ws://localhost:3847) */
  serverUrl?: string
  /** Enable screenshot capture for visual context */
  enableScreenshots?: boolean
  /** Enable click-to-inspect functionality */
  enableInspector?: boolean
  /** Callback when agent edits a file */
  onFileEdit?: (filePath: string) => void
}

export function CraftAgentProvider({
  children,
  serverUrl = 'ws://localhost:3847',
  enableScreenshots = true,
  enableInspector = true,
  onFileEdit,
}: CraftAgentProviderProps) {
  // Connection state
  const connection = useAgentConnection(serverUrl)

  // Inspector state
  const inspector = useInspector({ enabled: enableInspector })

  // Session state
  const session = useSession(connection)

  // Context capture
  const contextCapture = useContextCapture({ enableScreenshots })

  // Listen for file edits
  useEffect(() => {
    if (!connection.socket) return

    const handleMessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data)
      if (data.type === 'file_edited' && onFileEdit) {
        onFileEdit(data.filePath)
      }
    }

    connection.socket.addEventListener('message', handleMessage)
    return () => connection.socket?.removeEventListener('message', handleMessage)
  }, [connection.socket, onFileEdit])

  const value: EmbedContextValue = {
    connection,
    inspector,
    session,
    contextCapture,
    config: { enableScreenshots, enableInspector },
  }

  return (
    <EmbedContext.Provider value={value}>
      {children}
      {inspector.isActive && <InspectOverlay />}
    </EmbedContext.Provider>
  )
}
```

### 6.2 CraftAgentPanel

**Purpose:** Main panel UI with chat and context sidebar

```typescript
// src/components/CraftAgentPanel.tsx

interface CraftAgentPanelProps {
  /** Panel position */
  position?: 'right' | 'left' | 'bottom' | 'floating'
  /** Default open state */
  defaultOpen?: boolean
  /** Panel width (for left/right positions) */
  width?: number
  /** Panel height (for bottom position) */
  height?: number
  /** Custom class name */
  className?: string
}

export function CraftAgentPanel({
  position = 'right',
  defaultOpen = false,
  width = 420,
  height = 400,
  className,
}: CraftAgentPanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const { connection, inspector, session, contextCapture } = useEmbedContext()

  // Keyboard shortcut: Cmd+Shift+K to toggle
  useHotkeys('mod+shift+k', () => setIsOpen(prev => !prev))

  // Handle send message with context
  const handleSendMessage = async (content: string) => {
    const context = await contextCapture.capture()
    session.sendMessage(content, context)
  }

  if (!isOpen) {
    return <CraftAgentTrigger onClick={() => setIsOpen(true)} />
  }

  return (
    <div
      className={cn(
        'craft-agent-panel',
        `craft-agent-panel--${position}`,
        className
      )}
      style={{
        width: position === 'bottom' ? '100%' : width,
        height: position === 'bottom' ? height : '100%',
      }}
    >
      {/* Header */}
      <div className="craft-agent-panel__header">
        <span className="craft-agent-panel__title">Craft Agent</span>
        <ConnectionStatus status={connection.status} />
        <button onClick={() => setIsOpen(false)}>×</button>
      </div>

      {/* Content */}
      <div className="craft-agent-panel__content">
        {/* Context Sidebar */}
        <ContextSidebar
          selectedComponent={inspector.selectedComponent}
          screenshot={contextCapture.lastScreenshot}
          onInspectClick={() => inspector.startInspecting()}
        />

        {/* Chat Area */}
        <ChatContainer
          session={session.data}
          onSendMessage={handleSendMessage}
          isStreaming={session.isStreaming}
        />
      </div>
    </div>
  )
}
```

### 6.3 InspectOverlay

**Purpose:** Full-screen overlay for click-to-inspect mode

```typescript
// src/components/InspectOverlay.tsx

export function InspectOverlay() {
  const { inspector } = useEmbedContext()
  const [hoveredElement, setHoveredElement] = useState<Element | null>(null)
  const [hoveredInfo, setHoveredInfo] = useState<ComponentInfo | null>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Get element under cursor
      const element = document.elementFromPoint(e.clientX, e.clientY)
      if (!element || element.closest('.craft-agent-panel')) return

      setHoveredElement(element)

      // Get component info
      const fiber = findFiberNode(element)
      const info = extractComponentInfo(fiber)
      setHoveredInfo(info)
    }

    const handleClick = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (hoveredInfo) {
        inspector.selectComponent(hoveredInfo)
      }

      inspector.stopInspecting()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        inspector.stopInspecting()
      }
    }

    document.addEventListener('mousemove', handleMouseMove, { capture: true })
    document.addEventListener('click', handleClick, { capture: true })
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove, { capture: true })
      document.removeEventListener('click', handleClick, { capture: true })
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [inspector, hoveredInfo])

  return (
    <div className="craft-agent-inspect-overlay">
      {/* Highlight box around hovered element */}
      {hoveredElement && (
        <ComponentHighlight
          element={hoveredElement}
          info={hoveredInfo}
        />
      )}

      {/* Instructions */}
      <div className="craft-agent-inspect-instructions">
        Click a component to select it • Press Esc to cancel
      </div>
    </div>
  )
}
```

### 6.4 Fiber Utils

**Purpose:** React Fiber tree introspection

```typescript
// src/bridge/fiber-utils.ts

interface Fiber {
  type: any
  return: Fiber | null
  child: Fiber | null
  sibling: Fiber | null
  stateNode: Element | null
  memoizedProps: Record<string, any>
  memoizedState: any
  _debugSource?: {
    fileName: string
    lineNumber: number
    columnNumber?: number
  }
}

/**
 * Find the React Fiber node for a DOM element.
 * React attaches fiber references to DOM nodes with keys like:
 * - __reactFiber$xxx (React 18+)
 * - __reactInternalInstance$xxx (React 16-17)
 */
export function findFiberNode(element: Element | null): Fiber | null {
  if (!element) return null

  const key = Object.keys(element).find(
    k => k.startsWith('__reactFiber$') ||
         k.startsWith('__reactInternalInstance$')
  )

  if (!key) return null
  return (element as any)[key] as Fiber
}

/**
 * Get display name for a component type
 */
export function getDisplayName(type: any): string {
  if (!type) return 'Unknown'

  // Function component with displayName
  if (type.displayName) return type.displayName

  // Function component with name
  if (type.name) return type.name

  // Memo/forwardRef wrapped components
  if (type.$$typeof) {
    if (type.type) return getDisplayName(type.type)
    if (type.render) return getDisplayName(type.render)
  }

  // Host elements (div, span, etc.)
  if (typeof type === 'string') return type

  return 'Anonymous'
}

/**
 * Check if a fiber represents a user-defined component (not a host element)
 */
export function isUserComponent(fiber: Fiber): boolean {
  const { type } = fiber

  // Host elements are strings
  if (typeof type === 'string') return false

  // User components are functions or objects (class components, forwardRef, etc.)
  return typeof type === 'function' || typeof type === 'object'
}

/**
 * Walk up the fiber tree to find the nearest user-defined component
 */
export function findNearestUserComponent(fiber: Fiber | null): Fiber | null {
  let current = fiber

  while (current) {
    if (isUserComponent(current)) {
      return current
    }
    current = current.return
  }

  return null
}

/**
 * Extract component information from a fiber node
 */
export function extractComponentInfo(fiber: Fiber | null): ComponentInfo | null {
  const userFiber = findNearestUserComponent(fiber)
  if (!userFiber) return null

  const source = userFiber._debugSource ||
                 userFiber.type?._debugSource ||
                 userFiber.type?.type?._debugSource

  return {
    name: getDisplayName(userFiber.type),
    filePath: source?.fileName ?? null,
    lineNumber: source?.lineNumber ?? null,
    columnNumber: source?.columnNumber ?? null,
    props: sanitizeProps(userFiber.memoizedProps),
    // Don't include state - it's internal implementation detail
  }
}

/**
 * Sanitize props for display (remove functions, circular refs, etc.)
 */
export function sanitizeProps(props: Record<string, any>): Record<string, any> {
  if (!props) return {}

  const sanitized: Record<string, any> = {}

  for (const [key, value] of Object.entries(props)) {
    // Skip children and internal props
    if (key === 'children' || key.startsWith('__')) continue

    // Skip functions
    if (typeof value === 'function') {
      sanitized[key] = '[Function]'
      continue
    }

    // Skip React elements
    if (value?.$$typeof) {
      sanitized[key] = '[ReactElement]'
      continue
    }

    // Handle objects (try to serialize, fallback to type)
    if (typeof value === 'object' && value !== null) {
      try {
        JSON.stringify(value)
        sanitized[key] = value
      } catch {
        sanitized[key] = `[${value.constructor?.name || 'Object'}]`
      }
      continue
    }

    sanitized[key] = value
  }

  return sanitized
}
```

### 6.5 WebSocket Protocol

**Purpose:** Define message types between browser and dev server

```typescript
// src/bridge/protocol.ts

/** Messages from browser → dev server */
export type ClientMessage =
  | { type: 'chat'; sessionId: string; message: string; context: CapturedContext }
  | { type: 'stop'; sessionId: string }
  | { type: 'permission_response'; sessionId: string; allowed: boolean; alwaysAllow?: boolean }
  | { type: 'create_session' }
  | { type: 'ping' }

/** Messages from dev server → browser */
export type ServerMessage =
  | { type: 'session_created'; sessionId: string }
  | { type: 'agent_event'; sessionId: string; event: AgentEvent }
  | { type: 'file_edited'; filePath: string }
  | { type: 'permission_request'; sessionId: string; toolName: string; command: string }
  | { type: 'error'; message: string }
  | { type: 'pong' }
  | { type: 'connected'; version: string }

/** Captured context sent with messages */
export interface CapturedContext {
  /** Base64 screenshot of current viewport */
  screenshot?: string
  /** Currently selected component info */
  selectedComponent?: ComponentInfo
  /** Simplified component tree structure */
  componentTree?: string
  /** Current URL */
  url: string
  /** Viewport dimensions */
  viewport: { width: number; height: number }
  /** Timestamp */
  timestamp: number
}

/** Component information */
export interface ComponentInfo {
  name: string
  filePath: string | null
  lineNumber: number | null
  columnNumber?: number | null
  props: Record<string, any>
}
```

### 6.6 Dev Server

**Purpose:** Express + WebSocket server that runs CraftAgent

```typescript
// vite-plugin/dev-server.ts

import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { CraftAgent, type AgentEvent } from '@craft-agent/shared/agent'
import type { ClientMessage, ServerMessage, CapturedContext } from '../src/bridge/protocol'

interface DevServerOptions {
  port: number
  workspaceId?: string
  model?: string
}

interface Session {
  id: string
  agent: CraftAgent | null
  ws: WebSocket
  abortController?: AbortController
}

export function createDevServer(options: DevServerOptions) {
  const app = express()
  const server = app.listen(options.port)
  const wss = new WebSocketServer({ server })

  const sessions = new Map<string, Session>()

  console.log(`[craft-agent] Dev server running on ws://localhost:${options.port}`)

  wss.on('connection', (ws) => {
    // Send connected message
    send(ws, { type: 'connected', version: '0.1.0' })

    ws.on('message', async (data) => {
      const msg: ClientMessage = JSON.parse(data.toString())

      switch (msg.type) {
        case 'create_session': {
          const sessionId = crypto.randomUUID()
          sessions.set(sessionId, { id: sessionId, agent: null, ws })
          send(ws, { type: 'session_created', sessionId })
          break
        }

        case 'chat': {
          const session = sessions.get(msg.sessionId)
          if (!session) {
            send(ws, { type: 'error', message: 'Session not found' })
            return
          }

          await handleChat(session, msg.message, msg.context, options)
          break
        }

        case 'stop': {
          const session = sessions.get(msg.sessionId)
          session?.abortController?.abort()
          break
        }

        case 'permission_response': {
          // Handle permission response
          // Implementation depends on CraftAgent's permission API
          break
        }

        case 'ping': {
          send(ws, { type: 'pong' })
          break
        }
      }
    })

    ws.on('close', () => {
      // Clean up sessions for this connection
      for (const [id, session] of sessions) {
        if (session.ws === ws) {
          session.abortController?.abort()
          sessions.delete(id)
        }
      }
    })
  })

  return {
    server,
    wss,
    shutdown: () => {
      wss.close()
      server.close()
    },
  }
}

async function handleChat(
  session: Session,
  message: string,
  context: CapturedContext,
  options: DevServerOptions
) {
  // Create agent if needed
  if (!session.agent) {
    session.agent = new CraftAgent({
      workspace: await getWorkspace(options.workspaceId),
      model: options.model,
    })
  }

  // Build contextual message
  const userMessage = buildContextualMessage(message, context)

  // Abort controller for cancellation
  session.abortController = new AbortController()

  try {
    // Stream agent events
    for await (const event of session.agent.chat([userMessage], {
      signal: session.abortController.signal,
    })) {
      send(session.ws, { type: 'agent_event', sessionId: session.id, event })

      // Check if file was edited
      if (event.type === 'tool_result' &&
          (event.toolName === 'Edit' || event.toolName === 'Write')) {
        const filePath = event.input?.file_path || event.input?.filePath
        if (filePath) {
          send(session.ws, { type: 'file_edited', filePath })
        }
      }
    }
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      send(session.ws, { type: 'error', message: error.message })
    }
  }
}

function buildContextualMessage(message: string, context: CapturedContext) {
  const contextBlock = `
<current-context>
${context.screenshot ? '<screenshot>[Attached viewport screenshot]</screenshot>' : ''}

<selected-component>
${context.selectedComponent ? `
Name: ${context.selectedComponent.name}
File: ${context.selectedComponent.filePath || 'Unknown'}
Line: ${context.selectedComponent.lineNumber || 'Unknown'}
Props: ${JSON.stringify(context.selectedComponent.props, null, 2)}
` : 'None selected - user is asking a general question'}
</selected-component>

<visible-component-tree>
${context.componentTree || 'Not captured'}
</visible-component-tree>

<url>${context.url}</url>
<viewport>${context.viewport.width}x${context.viewport.height}</viewport>
</current-context>

User's request: ${message}
`

  const content: any[] = [{ type: 'text', text: contextBlock }]

  // Add screenshot as image if available
  if (context.screenshot) {
    content.unshift({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: context.screenshot.replace(/^data:image\/png;base64,/, ''),
      },
    })
  }

  return { role: 'user' as const, content }
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}
```

### 6.7 Vite Plugin

**Purpose:** Integrates with Vite to spawn dev server and inject HMR hooks

```typescript
// vite-plugin/index.ts

import type { Plugin, ViteDevServer } from 'vite'
import { createDevServer } from './dev-server'

interface CraftAgentPluginOptions {
  /** WebSocket server port (default: 3847) */
  port?: number
  /** Workspace ID for CraftAgent */
  workspaceId?: string
  /** Claude model to use */
  model?: string
  /** Enable in production (default: false) */
  enableInProduction?: boolean
}

export default function craftAgentPlugin(
  options: CraftAgentPluginOptions = {}
): Plugin {
  const {
    port = 3847,
    workspaceId,
    model,
    enableInProduction = false,
  } = options

  let devServer: ReturnType<typeof createDevServer> | null = null
  let viteServer: ViteDevServer | null = null

  return {
    name: 'craft-agent',

    // Only apply in serve mode (development)
    apply: (config, { command }) => {
      if (enableInProduction) return true
      return command === 'serve'
    },

    configureServer(server) {
      viteServer = server

      // Start dev server
      devServer = createDevServer({
        port,
        workspaceId,
        model,
      })

      // Hook into Vite's HMR to notify when files change
      server.watcher.on('change', (path) => {
        // Notify connected clients that a file changed
        // This helps the panel show "file updated" feedback
      })

      console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🚀 Craft Agent Dev Server                                    ║
║                                                                ║
║   WebSocket: ws://localhost:${port}                             ║
║                                                                ║
║   Add <CraftAgentPanel /> to your app to start editing!        ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`)
    },

    buildEnd() {
      // Shutdown dev server when Vite stops
      devServer?.shutdown()
    },

    // Inject HMR trigger function
    transformIndexHtml(html) {
      // Add a script that exposes HMR trigger to window
      return html.replace(
        '</head>',
        `<script>
          window.__CRAFT_AGENT_HMR__ = {
            invalidate: (path) => {
              if (import.meta.hot) {
                import.meta.hot.invalidate()
              }
            }
          }
        </script>
        </head>`
      )
    },
  }
}

// Export for use in vite.config.ts
export { craftAgentPlugin }
```

---

## 7. API Reference

### React Components

#### `<CraftAgentProvider>`

Wraps your application to provide embed context.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `serverUrl` | `string` | `'ws://localhost:3847'` | Dev server WebSocket URL |
| `enableScreenshots` | `boolean` | `true` | Capture screenshots with messages |
| `enableInspector` | `boolean` | `true` | Enable click-to-inspect |
| `onFileEdit` | `(path: string) => void` | - | Called when agent edits a file |

#### `<CraftAgentPanel>`

The main chat panel component.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `position` | `'right' \| 'left' \| 'bottom' \| 'floating'` | `'right'` | Panel position |
| `defaultOpen` | `boolean` | `false` | Initially open |
| `width` | `number` | `420` | Panel width (px) |
| `height` | `number` | `400` | Panel height (for bottom) |
| `className` | `string` | - | Additional CSS class |

### Hooks

#### `useEmbedContext()`

Access the embed context from any component.

```typescript
const {
  connection,        // { status, socket, reconnect }
  inspector,         // { isActive, selectedComponent, startInspecting, stopInspecting }
  session,           // { data, sendMessage, stop, isStreaming }
  contextCapture,    // { capture, lastScreenshot }
  config,           // { enableScreenshots, enableInspector }
} = useEmbedContext()
```

#### `useInspector()`

Control the click-to-inspect functionality.

```typescript
const {
  isActive,          // boolean - is inspect mode active
  selectedComponent, // ComponentInfo | null
  startInspecting,   // () => void
  stopInspecting,    // () => void
  selectComponent,   // (info: ComponentInfo) => void
} = useInspector()
```

### Vite Plugin

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import craftAgent from '@craft-agent/embed/vite-plugin'

export default defineConfig({
  plugins: [
    react(),
    craftAgent({
      port: 3847,           // WebSocket port
      workspaceId: 'ws-id', // Optional workspace
      model: 'claude-sonnet-4-20250514', // Optional model override
    }),
  ],
})
```

---

## 8. Testing Strategy

### Unit Tests

| Module | Test Focus |
|--------|------------|
| `fiber-utils.ts` | Fiber node finding, component info extraction |
| `protocol.ts` | Message serialization/deserialization |
| `sanitize.ts` | Props sanitization edge cases |
| `source-resolver.ts` | __source metadata extraction |

### Integration Tests

| Scenario | Test |
|----------|------|
| Connection lifecycle | Connect, disconnect, reconnect |
| Message flow | Send message → receive response |
| Inspector | Click element → get component info |
| File edit | Edit message → file written → HMR triggered |

### E2E Tests

| Scenario | Test |
|----------|------|
| Full flow | Open panel → inspect → ask to edit → verify change |
| Error handling | Server down → graceful degradation |
| Hot reload | File edit → component updates without refresh |

### Manual Testing Checklist

- [ ] Panel opens/closes with button and keyboard shortcut
- [ ] Connection status shows correctly
- [ ] Inspect mode highlights correct components
- [ ] Component info sidebar updates on selection
- [ ] Chat messages send and stream correctly
- [ ] Tool results display properly
- [ ] File edits trigger hot reload
- [ ] Permission requests show in panel
- [ ] Error states handled gracefully

---

## 9. Security Considerations

### Development-Only Enforcement

```typescript
// In CraftAgentProvider
if (process.env.NODE_ENV === 'production' && !props.enableInProduction) {
  console.warn('[craft-agent] Embed disabled in production')
  return <>{children}</>
}
```

### File System Access

- Dev server only runs on localhost
- File operations restricted to project directory
- No arbitrary file reads/writes outside project

### WebSocket Security

- Only accepts connections from localhost
- No authentication required (local dev only)
- Messages validated before processing

### Source Map Exposure

- Source maps only parsed locally
- No source code sent to external servers
- Component info stays in memory

---

## 10. Future Enhancements

### V1.1: Enhanced Context

- [ ] State inspection (useState, useReducer values)
- [ ] Redux DevTools integration
- [ ] React Query devtools integration
- [ ] Network request context

### V1.2: Multi-Framework Support

- [ ] webpack plugin
- [ ] Next.js integration
- [ ] Remix integration
- [ ] Create React App support

### V2.0: Advanced Features

- [ ] Multi-file editing with diff view
- [ ] Undo/redo for agent edits
- [ ] Edit history timeline
- [ ] Collaborative mode (multiple users)
- [ ] Custom tool definitions
- [ ] Voice input support

### V3.0: Beyond React

- [ ] Vue 3 support
- [ ] Svelte support
- [ ] Solid.js support
- [ ] Framework-agnostic core

---

## Appendix A: Example Usage

### Minimal Setup

```tsx
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import craftAgent from '@craft-agent/embed/vite-plugin'

export default defineConfig({
  plugins: [react(), craftAgent()],
})

// App.tsx
import { CraftAgentProvider, CraftAgentPanel } from '@craft-agent/embed'
import '@craft-agent/embed/styles.css'

function App() {
  return (
    <CraftAgentProvider>
      <YourApp />
      <CraftAgentPanel />
    </CraftAgentProvider>
  )
}
```

### Custom Configuration

```tsx
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import craftAgent from '@craft-agent/embed/vite-plugin'

export default defineConfig({
  plugins: [
    react(),
    craftAgent({
      port: 4000,
      workspaceId: 'my-workspace',
      model: 'claude-sonnet-4-20250514',
    }),
  ],
})

// App.tsx
import { CraftAgentProvider, CraftAgentPanel } from '@craft-agent/embed'
import '@craft-agent/embed/styles.css'

function App() {
  return (
    <CraftAgentProvider
      serverUrl="ws://localhost:4000"
      enableScreenshots={true}
      onFileEdit={(path) => console.log('Edited:', path)}
    >
      <YourApp />
      <CraftAgentPanel
        position="floating"
        defaultOpen={false}
        width={500}
      />
    </CraftAgentProvider>
  )
}
```

---

## Appendix B: Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Panel doesn't appear | Production build | Ensure `NODE_ENV=development` |
| "Connection failed" | Dev server not running | Check Vite plugin is loaded |
| Component info missing | No __source metadata | Ensure React dev mode, not production build |
| HMR not working | Vite HMR disabled | Check Vite config |
| Inspector not highlighting | CSS conflicts | Check z-index, pointer-events |

### Debug Mode

```tsx
<CraftAgentProvider debug>
  {/* Logs all messages to console */}
</CraftAgentProvider>
```

---

## Appendix C: Dependencies

### Required Peer Dependencies

```json
{
  "react": ">=18.0.0",
  "react-dom": ">=18.0.0"
}
```

### Internal Dependencies

```json
{
  "@craft-agent/ui": "workspace:*",
  "@craft-agent/shared": "workspace:*",
  "@craft-agent/core": "workspace:*"
}
```

### External Dependencies

```json
{
  "html2canvas": "^1.4.1",
  "ws": "^8.16.0",
  "express": "^4.18.2"
}
```

---

*Last updated: 2026-01-11*
*Plan version: 1.0.0*
