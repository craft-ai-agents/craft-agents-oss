# feat: Superhuman-style CMD+K Command Palette

> **Type:** Enhancement
> **Priority:** P1
> **Complexity:** Low-Medium
> **Created:** 2026-01-22
> **Updated:** 2026-01-22 (simplified after review)

## Overview

Implement a Superhuman-style CMD+K command palette for the Vesper Electron app. This provides a fast, keyboard-driven interface for navigation, executing actions, and discovering features—liberating functionality from visual UI constraints.

**Key Principles (from Superhuman):**
1. **Omnipresence** - Accessible from anywhere via CMD+K
2. **Toggle Behavior** - Same shortcut opens AND closes
3. **Feature Liberation** - Unlimited capacity without UI clutter
4. **Discovery & Learning** - Display shortcuts so users learn organically

## Problem Statement

Currently, users must navigate through the sidebar or remember individual keyboard shortcuts to access different views and actions. A command palette provides:
- Faster access to any feature with a single keystroke
- Discoverability of all available actions
- Learning path for keyboard shortcuts
- Unified search across navigation and commands

## Proposed Solution

Build a centered modal command palette using the existing `cmdk` library (already installed), integrated with `useGlobalShortcuts` and `NavigationContext`.

**Visual Style:** Centered modal with blur backdrop (Superhuman-style)

**Scope:** Standalone first—navigation + commands only, no integrations with vector search or skills initially.

## Technical Approach

### Architecture (Simplified - 2 Files)

After review, the architecture has been simplified from 7 files to 2:

```
src/renderer/
├── atoms/command-palette.ts                    # Open state atom (10 lines)
└── components/command-palette/CommandPalette.tsx  # Everything else (~150 lines)
```

**Why 2 files instead of 7:**
- Types inline (only 2 small interfaces)
- CommandItem is 25 lines, keep it local
- No React Context needed—Jotai atom is simpler for `open: boolean`
- No factory pattern—commands are static, switch statement for execution
- Recent commands: simple localStorage read/write inline

**State Management:** Jotai atom (`commandPaletteOpenAtom`)

**Keyboard Handling:** Add to existing `useGlobalShortcuts` in `AppShell.tsx`

**Modal Integration:** Register with `useRegisterModal` at high priority (100)

### Command Data (Static Array)

Commands are defined as a static array in the main component file. Execution uses a simple switch statement—no dependency injection needed.

```typescript
// Inline in CommandPalette.tsx
interface PaletteCommand {
  id: string
  label: string
  keywords?: string[]
  shortcut?: string[]
  icon?: LucideIcon
  category: 'navigation' | 'actions' | 'session'
  when?: () => boolean
}

const COMMANDS: PaletteCommand[] = [
  // Navigation
  { id: 'all-chats', label: 'All Chats', icon: MessageSquare, category: 'navigation' },
  { id: 'flagged', label: 'Flagged', icon: Flag, category: 'navigation' },
  { id: 'sources', label: 'Sources', icon: FolderOpen, category: 'navigation' },
  { id: 'skills', label: 'Skills', icon: Sparkles, category: 'navigation' },
  { id: 'search-docs', label: 'Search Docs', icon: Search, category: 'navigation' },
  { id: 'schedules', label: 'Schedules', icon: Calendar, category: 'navigation' },
  { id: 'settings', label: 'Settings', icon: Settings, shortcut: ['⌘', ','], category: 'navigation' },

  // Actions
  { id: 'new-chat', label: 'New Chat', icon: Plus, shortcut: ['⌘', 'N'], category: 'actions' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', icon: PanelLeft, shortcut: ['⌘', '\\'], category: 'actions' },
  { id: 'keyboard-shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard, category: 'actions' },

  // Session (conditional visibility)
  { id: 'rename-session', label: 'Rename Session', icon: Pencil, category: 'session' },
  { id: 'flag-session', label: 'Flag/Unflag', icon: Flag, category: 'session' },
  { id: 'delete-session', label: 'Delete Session', icon: Trash2, category: 'session' },
]
```

### Implementation

#### File 1: `apps/electron/src/renderer/atoms/command-palette.ts` (~10 lines)

```typescript
import { atom } from 'jotai'

// Simple open state - no Context needed
export const commandPaletteOpenAtom = atom(false)
```

#### File 2: `apps/electron/src/renderer/components/command-palette/CommandPalette.tsx` (~150 lines)

Everything in one file:
- Types inline at top
- Commands as static array
- CommandItem as local function
- Recent commands logic inline (localStorage read/write)
- Main CommandPalette component

```typescript
import * as React from 'react'
import { Command } from 'cmdk'
import { useAtom } from 'jotai'
import { AnimatePresence, motion } from 'motion/react'
import { useNavigation } from '@/contexts/NavigationContext'
import { useRegisterModal } from '@/context/ModalContext'
import { commandPaletteOpenAtom } from '@/atoms/command-palette'
import {
  MessageSquare, Flag, FolderOpen, Sparkles, Search,
  Calendar, Settings, Plus, PanelLeft, Keyboard, Pencil, Trash2
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ============ TYPES (inline) ============
interface PaletteCommand {
  id: string
  label: string
  keywords?: string[]
  shortcut?: string[]
  icon?: LucideIcon
  category: 'navigation' | 'actions' | 'session'
}

// ============ COMMANDS (static array) ============
const COMMANDS: PaletteCommand[] = [
  { id: 'all-chats', label: 'All Chats', icon: MessageSquare, category: 'navigation' },
  { id: 'flagged', label: 'Flagged', icon: Flag, category: 'navigation' },
  { id: 'sources', label: 'Sources', icon: FolderOpen, category: 'navigation' },
  { id: 'skills', label: 'Skills', icon: Sparkles, category: 'navigation' },
  { id: 'search-docs', label: 'Search Docs', icon: Search, category: 'navigation' },
  { id: 'schedules', label: 'Schedules', icon: Calendar, category: 'navigation' },
  { id: 'settings', label: 'Settings', icon: Settings, shortcut: ['⌘', ','], category: 'navigation' },
  { id: 'new-chat', label: 'New Chat', icon: Plus, shortcut: ['⌘', 'N'], category: 'actions' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', icon: PanelLeft, shortcut: ['⌘', '\\'], category: 'actions' },
  { id: 'keyboard-shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard, category: 'actions' },
  { id: 'rename-session', label: 'Rename Session', icon: Pencil, category: 'session' },
  { id: 'flag-session', label: 'Flag/Unflag', icon: Flag, category: 'session' },
  { id: 'delete-session', label: 'Delete Session', icon: Trash2, category: 'session' },
]

// ============ RECENT COMMANDS (inline localStorage) ============
const STORAGE_KEY = 'vesper-recent-commands'
const getRecentCommands = (): string[] => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
  catch { return [] }
}
const addRecentCommand = (id: string) => {
  const recent = getRecentCommands().filter(c => c !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify([id, ...recent].slice(0, 10)))
}

// ============ COMMAND ITEM (local component) ============
function CommandItem({ command, onSelect }: { command: PaletteCommand; onSelect: () => void }) {
  const Icon = command.icon
  return (
    <Command.Item
      value={command.label + ' ' + (command.keywords?.join(' ') || '')}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
    >
      {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      <span className="flex-1">{command.label}</span>
      {command.shortcut && (
        <kbd className="flex gap-1 text-xs text-muted-foreground">
          {command.shortcut.map((key, i) => (
            <span key={i} className="rounded bg-muted px-1.5 py-0.5">{key}</span>
          ))}
        </kbd>
      )}
    </Command.Item>
  )
}

// ============ MAIN COMPONENT ============
export function CommandPalette() {
  const [open, setOpen] = useAtom(commandPaletteOpenAtom)
  const [recentIds, setRecentIds] = React.useState(getRecentCommands)
  const { navigate, routes } = useNavigation()
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Register with modal context for ESC handling
  useRegisterModal(open, () => setOpen(false), 100)

  // Command execution - simple switch
  const executeCommand = React.useCallback((id: string) => {
    addRecentCommand(id)
    setRecentIds(getRecentCommands())
    setOpen(false)

    switch (id) {
      case 'all-chats': navigate(routes.view.allChats()); break
      case 'flagged': navigate(routes.view.flagged()); break
      case 'sources': navigate(routes.view.sources()); break
      case 'skills': navigate(routes.view.skills()); break
      case 'search-docs': navigate(routes.view.vectorSearch()); break
      case 'schedules': navigate(routes.view.schedules()); break
      case 'settings': navigate(routes.view.settings()); break
      case 'new-chat': /* wire up */ break
      case 'toggle-sidebar': /* wire up */ break
      case 'keyboard-shortcuts': /* wire up */ break
      case 'rename-session': /* wire up */ break
      case 'flag-session': /* wire up */ break
      case 'delete-session': /* wire up */ break
    }
  }, [navigate, routes, setOpen])

  // Group by category
  const grouped = React.useMemo(() => {
    const g: Record<string, PaletteCommand[]> = {}
    for (const c of COMMANDS) (g[c.category] ||= []).push(c)
    return g
  }, [])

  React.useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  if (!open) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.15 }}
        className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2"
      >
        <Command className="rounded-xl border border-border bg-background shadow-2xl" loop>
          <Command.Input
            ref={inputRef}
            placeholder="Type a command..."
            className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No commands found.
            </Command.Empty>

            {recentIds.length > 0 && (
              <Command.Group heading="Recent">
                {recentIds.slice(0, 5).map(id => {
                  const cmd = COMMANDS.find(c => c.id === id)
                  return cmd && <CommandItem key={`r-${id}`} command={cmd} onSelect={() => executeCommand(id)} />
                })}
              </Command.Group>
            )}

            <Command.Group heading="Navigation">
              {grouped.navigation?.map(c => <CommandItem key={c.id} command={c} onSelect={() => executeCommand(c.id)} />)}
            </Command.Group>

            <Command.Group heading="Actions">
              {grouped.actions?.map(c => <CommandItem key={c.id} command={c} onSelect={() => executeCommand(c.id)} />)}
            </Command.Group>

            <Command.Group heading="Session">
              {grouped.session?.map(c => <CommandItem key={c.id} command={c} onSelect={() => executeCommand(c.id)} />)}
            </Command.Group>
          </Command.List>
        </Command>
      </motion.div>
    </AnimatePresence>
  )
}
```

#### Files to Modify

**`apps/electron/src/renderer/components/app-shell/AppShell.tsx`**
- Add CMD+K shortcut to `useGlobalShortcuts`

```typescript
import { useSetAtom } from 'jotai'
import { commandPaletteOpenAtom } from '@/atoms/command-palette'

// In component:
const togglePalette = useSetAtom(commandPaletteOpenAtom)

// In shortcuts array (~line 489):
{ key: 'k', cmd: true, action: () => togglePalette(o => !o) }

// In render (alongside other global components):
<CommandPalette />
```

### Implementation Phases

#### Phase 1: Core Palette
- Create `atoms/command-palette.ts`
- Create `components/command-palette/CommandPalette.tsx`
- Add CMD+K shortcut to AppShell
- Wire up navigation commands (they work immediately via routes)

#### Phase 2: Wire Up Actions
- Connect `toggle-sidebar` to sidebar state
- Connect `new-chat` to session creation
- Connect `keyboard-shortcuts` to KeyboardShortcutsDialog
- Wire up session commands (need active session context)
- Add conditional visibility for session commands

#### Phase 3: Polish
- Fine-tune animations
- Add to keyboard shortcuts dialog
- Manual QA against Superhuman reference

## Acceptance Criteria

### Functional Requirements
- [ ] CMD+K (Mac) / Ctrl+K (Windows) opens command palette
- [ ] ESC closes palette
- [ ] Clicking backdrop closes palette
- [ ] CMD+K again closes palette (toggle behavior)
- [ ] Typing filters commands with fuzzy matching
- [ ] Arrow Up/Down navigates commands
- [ ] Enter executes selected command
- [ ] Commands grouped by category (Navigation, Actions, Session)
- [ ] Keyboard shortcuts displayed for commands that have them
- [ ] Recent items section shows last 5 used commands
- [ ] Session commands only visible when a session is active

### Non-Functional Requirements
- [ ] Opens within 50ms of keystroke
- [ ] Search filtering instantaneous (<16ms / one frame)
- [ ] Full keyboard accessibility (no mouse required)
- [ ] ARIA attributes: `role="dialog"`, `aria-modal="true"`, `aria-label` on input
- [ ] Focus returns to previous element on close
- [ ] Visible focus indicators on selected item

### Edge Cases Handled
- [ ] CMD+K blocked when permission modal is showing
- [ ] CMD+K works when typing in chat input (meta shortcuts pass through)
- [ ] Stale recent items filtered out (if command removed)
- [ ] Recent items limited to 10 max (prevent localStorage bloat)
- [ ] Double-ESC still cancels agent processing (palette doesn't interfere)

### Quality Gates
- [ ] Integration test: open/close via keyboard
- [ ] E2E test: open → search → execute → verify navigation
- [ ] Test: CMD+K while permission modal open (should be blocked)
- [ ] Visual review against Superhuman reference

## Dependencies & Prerequisites

- `cmdk` v1.1.1 ✓ (already installed)
- `motion` ✓ (already installed)
- `lucide-react` ✓ (already installed)
- `jotai` ✓ (already installed)

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Z-index conflicts | Low | Medium | Use z-50, test with all overlays |
| Keyboard shortcut conflicts | Low | Low | Electron captures before browser |
| Permission modal interference | Medium | Medium | Block CMD+K when `pendingPermissions` exists |
| Focus not returning on close | Medium | Low | `useRegisterModal` handles cleanup |

## Future Considerations

After MVP, potential enhancements:
1. **Vector Search integration** - Search documents from palette
2. **Skills integration** - Execute skills directly
3. **Workspace-scoped recent items** - Key by workspaceId
4. **Context-aware commands** - Show different commands based on current view

## References

### Internal References
- Keyboard shortcuts: `apps/electron/src/renderer/hooks/keyboard/useGlobalShortcuts.ts:1-92`
- Modal registry: `apps/electron/src/renderer/context/ModalContext.tsx:1-112`
- Navigation context: `apps/electron/src/renderer/contexts/NavigationContext.tsx:1-800`
- Existing command UI: `apps/electron/src/renderer/components/ui/command.tsx:1-136`
- AppShell shortcuts: `apps/electron/src/renderer/components/app-shell/AppShell.tsx:464-519`

### External References
- cmdk documentation: https://github.com/pacocoursey/cmdk
- Superhuman command palette: https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/

---

## Review Feedback Incorporated

This plan was simplified based on feedback from three reviewers:

1. **DHH Reviewer**: Reduced from 7 files to 2, removed dependency injection pattern, using Jotai atom instead of React Context
2. **Kieran Reviewer**: Added edge case handling, performance criteria (50ms open, 16ms filter), accessibility requirements
3. **Simplicity Reviewer**: Inlined types, CommandItem as local function, localStorage logic inline

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
