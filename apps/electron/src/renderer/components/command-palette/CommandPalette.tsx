import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { AnimatePresence, motion } from 'motion/react'
import {
  MessageSquare,
  Flag,
  FolderOpen,
  Sparkles,
  Search,
  Calendar,
  Settings,
  Plus,
  PanelLeft,
  Keyboard,
  Pencil,
  Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNavigation, routes } from '@/contexts/NavigationContext'
import { useRegisterModal } from '@/context/ModalContext'
import { useAppShellContext } from '@/context/AppShellContext'
import { commandPaletteOpenAtom } from '@/atoms/command-palette'
import { activeSessionIdAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { dailyReportModalOpenAtom } from '@/atoms/orchestration'

// ============ TYPES ============
interface PaletteCommand {
  id: string
  label: string
  keywords?: string[]
  shortcut?: string[]
  icon?: LucideIcon
  category: 'navigation' | 'actions' | 'session'
}

// ============ COMMANDS ============
const COMMANDS: PaletteCommand[] = [
  // Navigation
  { id: 'all-chats', label: 'All Chats', icon: MessageSquare, category: 'navigation', keywords: ['sessions', 'conversations'] },
  { id: 'flagged', label: 'Flagged', icon: Flag, category: 'navigation', keywords: ['starred', 'bookmarked'] },
  { id: 'sources', label: 'Sources', icon: FolderOpen, category: 'navigation', keywords: ['files', 'folders', 'mcp'] },
  { id: 'skills', label: 'Skills', icon: Sparkles, category: 'navigation', keywords: ['commands', 'slash'] },
  { id: 'search-docs', label: 'Search Docs', icon: Search, category: 'navigation', keywords: ['vector', 'semantic', 'find'] },
  { id: 'schedules', label: 'Schedules', icon: Calendar, category: 'navigation', keywords: ['cron', 'automated', 'tasks'] },
  { id: 'settings', label: 'Settings', icon: Settings, shortcut: ['⌘', ','], category: 'navigation', keywords: ['preferences', 'config'] },

  // Actions
  { id: 'new-chat', label: 'New Chat', icon: Plus, shortcut: ['⌘', 'N'], category: 'actions', keywords: ['create', 'session'] },
  { id: 'daily-report', label: 'Daily Report', icon: Calendar, shortcut: ['⌘', '⇧', 'R'], category: 'actions', keywords: ['github', 'report', 'orchestration'] },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', icon: PanelLeft, shortcut: ['⌘', '\\'], category: 'actions', keywords: ['hide', 'show', 'panel'] },
  { id: 'keyboard-shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard, category: 'actions', keywords: ['hotkeys', 'help'] },

  // Session
  { id: 'rename-session', label: 'Rename Session', icon: Pencil, category: 'session', keywords: ['edit', 'name'] },
  { id: 'flag-session', label: 'Flag/Unflag Session', icon: Flag, category: 'session', keywords: ['star', 'bookmark'] },
  { id: 'delete-session', label: 'Delete Session', icon: Trash2, category: 'session', keywords: ['remove', 'trash'] },
]

// ============ RECENT COMMANDS ============
const STORAGE_KEY = 'vesper-recent-commands'
const MAX_RECENT = 10

function getRecentCommands(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function addRecentCommand(id: string): void {
  const recent = getRecentCommands().filter(c => c !== id)
  const updated = [id, ...recent].slice(0, MAX_RECENT)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
}

// ============ COMMAND ITEM ============
function CommandItem({
  command,
  onSelect,
}: {
  command: PaletteCommand
  onSelect: () => void
}) {
  const Icon = command.icon

  return (
    <CommandPrimitive.Item
      value={command.label + ' ' + (command.keywords?.join(' ') || '')}
      onSelect={onSelect}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none',
        'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50'
      )}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <span className="flex-1">{command.label}</span>
      {command.shortcut && (
        <kbd className="ml-auto flex gap-0.5 text-xs text-muted-foreground">
          {command.shortcut.map((key, i) => (
            <span
              key={i}
              className="rounded bg-muted px-1.5 py-0.5 font-mono"
            >
              {key}
            </span>
          ))}
        </kbd>
      )}
    </CommandPrimitive.Item>
  )
}

// Session command IDs that require an active session
const SESSION_COMMAND_IDS = ['rename-session', 'flag-session', 'delete-session']

// ============ MAIN COMPONENT ============
export function CommandPalette() {
  const [open, setOpen] = useAtom(commandPaletteOpenAtom)
  const [recentIds, setRecentIds] = React.useState(getRecentCommands)
  const { navigate } = useNavigation()
  const context = useAppShellContext()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const setDailyReportModalOpen = useSetAtom(dailyReportModalOpenAtom)

  // Session state
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMeta = activeSessionId ? sessionMetaMap.get(activeSessionId) : null
  const hasActiveSession = !!activeSessionId

  // Register with modal context for ESC handling (high priority: 100)
  useRegisterModal(open, () => setOpen(false), 100)

  // Group commands by category, with dynamic labels for session commands
  const grouped = React.useMemo(() => {
    const g: Record<string, PaletteCommand[]> = {}
    for (const c of COMMANDS) {
      // Dynamically update flag-session label based on current state
      let command = c
      if (c.id === 'flag-session' && sessionMeta) {
        command = {
          ...c,
          label: sessionMeta.isFlagged ? 'Unflag Session' : 'Flag Session',
          keywords: sessionMeta.isFlagged
            ? ['unstar', 'unbookmark', 'remove flag']
            : ['star', 'bookmark', 'flag'],
        }
      }
      ;(g[command.category] ||= []).push(command)
    }
    return g
  }, [sessionMeta])

  // Filter recent items to only include valid commands
  // Also exclude session commands when no active session
  const validRecentIds = React.useMemo(
    () => recentIds.filter(id => {
      const isValidCommand = COMMANDS.some(c => c.id === id)
      const isSessionCommand = SESSION_COMMAND_IDS.includes(id)
      return isValidCommand && (!isSessionCommand || hasActiveSession)
    }),
    [recentIds, hasActiveSession]
  )

  // Command execution
  const executeCommand = React.useCallback(
    (id: string) => {
      addRecentCommand(id)
      setRecentIds(getRecentCommands())
      setOpen(false)

      switch (id) {
        // Navigation
        case 'all-chats':
          navigate(routes.view.allChats())
          break
        case 'flagged':
          navigate(routes.view.flagged())
          break
        case 'sources':
          navigate(routes.view.sources())
          break
        case 'skills':
          navigate(routes.view.skills())
          break
        case 'search-docs':
          navigate(routes.view.vectorSearch())
          break
        case 'schedules':
          navigate(routes.view.schedules())
          break
        case 'settings':
          navigate(routes.view.settings())
          break

        // Actions
        case 'new-chat':
          context.openNewChat?.()
          break
        case 'daily-report':
          setDailyReportModalOpen(true)
          break
        case 'toggle-sidebar':
          // Dispatch a custom event that AppShell listens to
          window.dispatchEvent(new CustomEvent('command-palette:toggle-sidebar'))
          break
        case 'keyboard-shortcuts':
          context.onOpenKeyboardShortcuts()
          break

        // Session commands (require active session)
        case 'rename-session':
          if (activeSessionId) {
            const currentName = sessionMeta?.name || sessionMeta?.preview || 'Untitled'
            const newName = window.prompt('Rename session:', currentName)
            if (newName && newName.trim()) {
              context.onRenameSession(activeSessionId, newName.trim())
            }
          }
          break
        case 'flag-session':
          if (activeSessionId) {
            if (sessionMeta?.isFlagged) {
              context.onUnflagSession(activeSessionId)
            } else {
              context.onFlagSession(activeSessionId)
            }
          }
          break
        case 'delete-session':
          if (activeSessionId) {
            context.onDeleteSession(activeSessionId)
          }
          break
      }
    },
    [navigate, routes, setOpen, context, activeSessionId, sessionMeta, setDailyReportModalOpen]
  )

  // Focus input when opening
  React.useEffect(() => {
    if (open) {
      // Use requestAnimationFrame for reliable focus after render
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [open])

  // Early return if closed (for AnimatePresence to work properly)
  if (!open) return null

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="command-palette-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Dialog */}
          <motion.div
            key="command-palette-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 px-4"
          >
            <CommandPrimitive
              className="rounded-xl border border-border bg-background shadow-2xl overflow-hidden"
              loop
            >
              {/* Input */}
              <div className="flex items-center border-b border-border px-4">
                <Search className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" />
                <CommandPrimitive.Input
                  ref={inputRef}
                  placeholder="Type a command or search..."
                  className="flex h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  aria-label="Search commands"
                />
              </div>

              {/* List */}
              <CommandPrimitive.List className="max-h-80 overflow-y-auto p-2">
                <CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground">
                  No commands found.
                </CommandPrimitive.Empty>

                {/* Recent */}
                {validRecentIds.length > 0 && (
                  <CommandPrimitive.Group
                    heading="Recent"
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {validRecentIds.slice(0, 5).map(id => {
                      const cmd = COMMANDS.find(c => c.id === id)
                      return (
                        cmd && (
                          <CommandItem
                            key={`recent-${id}`}
                            command={cmd}
                            onSelect={() => executeCommand(id)}
                          />
                        )
                      )
                    })}
                  </CommandPrimitive.Group>
                )}

                {/* Navigation */}
                {grouped.navigation && (
                  <CommandPrimitive.Group
                    heading="Navigation"
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {grouped.navigation.map(cmd => (
                      <CommandItem
                        key={cmd.id}
                        command={cmd}
                        onSelect={() => executeCommand(cmd.id)}
                      />
                    ))}
                  </CommandPrimitive.Group>
                )}

                {/* Actions */}
                {grouped.actions && (
                  <CommandPrimitive.Group
                    heading="Actions"
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {grouped.actions.map(cmd => (
                      <CommandItem
                        key={cmd.id}
                        command={cmd}
                        onSelect={() => executeCommand(cmd.id)}
                      />
                    ))}
                  </CommandPrimitive.Group>
                )}

                {/* Session - only show when there's an active session */}
                {grouped.session && hasActiveSession && (
                  <CommandPrimitive.Group
                    heading="Session"
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {grouped.session.map(cmd => (
                      <CommandItem
                        key={cmd.id}
                        command={cmd}
                        onSelect={() => executeCommand(cmd.id)}
                      />
                    ))}
                  </CommandPrimitive.Group>
                )}
              </CommandPrimitive.List>
            </CommandPrimitive>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
