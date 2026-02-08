import { useEffect, useState } from "react"
import { isMac } from "@/lib/platform"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
  DropdownMenuSub,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from "@/components/ui/styled-dropdown"
import * as Icons from "lucide-react"
import { LayoutGrid, PanelLeft, Maximize2 } from "lucide-react"
import { CraftAgentsSymbol } from "./icons/CraftAgentsSymbol"
import { SquarePenRounded } from "./icons/SquarePenRounded"
import { TopBarButton } from "./ui/TopBarButton"
import {
  EDIT_MENU,
  VIEW_MENU,
  WINDOW_MENU,
  SETTINGS_ITEMS,
  getShortcutDisplay,
} from "../../shared/menu-schema"

/**
 * View mode for the app layout:
 * - 'full': Show all panels (left sidebar + session list + chat)
 * - 'compact': Hide left sidebar (session list + chat only)
 * - 'focus': Focus mode (chat only)
 */
export type ViewMode = 'full' | 'compact' | 'focus'
import type { MenuItem, MenuSection, SettingsMenuItem } from "../../shared/menu-schema"
import { SETTINGS_ICONS } from "./icons/SettingsIcons"

// Map of action handlers for menu items that need custom behavior
type MenuActionHandlers = {
  toggleFocusMode?: () => void
  toggleSidebar?: () => void
}

// Map of IPC handlers for role-based menu items
const roleHandlers: Record<string, () => void> = {
  undo: () => window.electronAPI.menuUndo(),
  redo: () => window.electronAPI.menuRedo(),
  cut: () => window.electronAPI.menuCut(),
  copy: () => window.electronAPI.menuCopy(),
  paste: () => window.electronAPI.menuPaste(),
  selectAll: () => window.electronAPI.menuSelectAll(),
  zoomIn: () => window.electronAPI.menuZoomIn(),
  zoomOut: () => window.electronAPI.menuZoomOut(),
  resetZoom: () => window.electronAPI.menuZoomReset(),
  minimize: () => window.electronAPI.menuMinimize(),
  zoom: () => window.electronAPI.menuMaximize(),
}

/**
 * Get the Lucide icon component by name
 */
function getIcon(name: string): React.ComponentType<{ className?: string }> | null {
  const IconComponent = Icons[name as keyof typeof Icons] as React.ComponentType<{ className?: string }> | undefined
  return IconComponent ?? null
}

/**
 * Renders a single menu item from the schema
 */
function renderMenuItem(
  item: MenuItem,
  index: number,
  actionHandlers: MenuActionHandlers
): React.ReactNode {
  if (item.type === 'separator') {
    return <StyledDropdownMenuSeparator key={`sep-${index}`} />
  }

  const Icon = getIcon(item.icon)
  const shortcut = getShortcutDisplay(item, isMac)

  if (item.type === 'role') {
    const handler = roleHandlers[item.role]
    // Gracefully handle missing role handlers with console warning
    const safeHandler = handler ?? (() => {
      console.warn(`[AppMenu] No handler registered for role: ${item.role}`)
    })
    return (
      <StyledDropdownMenuItem key={item.role} onClick={safeHandler}>
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {item.label}
        {shortcut && <DropdownMenuShortcut className="pl-6">{shortcut}</DropdownMenuShortcut>}
      </StyledDropdownMenuItem>
    )
  }

  if (item.type === 'action') {
    // Map action IDs to handlers
    const handler = item.id === 'toggleFocusMode'
      ? actionHandlers.toggleFocusMode
      : item.id === 'toggleSidebar'
        ? actionHandlers.toggleSidebar
        : undefined
    return (
      <StyledDropdownMenuItem key={item.id} onClick={handler}>
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {item.label}
        {shortcut && <DropdownMenuShortcut className="pl-6">{shortcut}</DropdownMenuShortcut>}
      </StyledDropdownMenuItem>
    )
  }

  return null
}

/**
 * Renders a menu section as a submenu
 */
function renderMenuSection(
  section: MenuSection,
  actionHandlers: MenuActionHandlers
): React.ReactNode {
  const Icon = getIcon(section.icon)
  return (
    <DropdownMenuSub key={section.id}>
      <StyledDropdownMenuSubTrigger>
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {section.label}
      </StyledDropdownMenuSubTrigger>
      <StyledDropdownMenuSubContent>
        {section.items.map((item, index) => renderMenuItem(item, index, actionHandlers))}
      </StyledDropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

interface AppMenuProps {
  onNewChat: () => void
  onNewWindow?: () => void
  onOpenSettings: () => void
  /** Navigate to a specific settings subpage */
  onOpenSettingsSubpage: (subpage: SettingsMenuItem['id']) => void
  onOpenKeyboardShortcuts: () => void
  onOpenStoredUserPreferences: () => void
  onBack?: () => void
  onForward?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  onToggleSidebar?: () => void
  onToggleFocusMode?: () => void
  /** Callback to cycle view mode */
  onCycleViewMode?: () => void
  /** Current view mode for icon state */
  viewMode?: ViewMode
}

/**
 * AppMenu - Main application dropdown menu and top bar navigation
 *
 * Contains the Craft logo dropdown with all menu functionality:
 * - File actions (New Chat, New Window)
 * - Edit submenu (Undo, Redo, Cut, Copy, Paste, Select All)
 * - View submenu (Zoom In/Out, Reset)
 * - Window submenu (Minimize, Maximize)
 * - Settings submenu (Settings, Stored User Preferences)
 * - Help submenu (Documentation, Keyboard Shortcuts)
 * - Debug submenu (dev only)
 * - Quit
 *
 * On Windows/Linux, this is the only menu (native menu is hidden).
 * On macOS, this mirrors the native menu for consistency.
 */
export function AppMenu({
  onNewChat,
  onNewWindow,
  onOpenSettings,
  onOpenSettingsSubpage,
  onOpenKeyboardShortcuts,
  onOpenStoredUserPreferences,
  onBack,
  onForward,
  canGoBack = true,
  canGoForward = true,
  onToggleSidebar,
  onToggleFocusMode,
  onCycleViewMode,
  viewMode,
}: AppMenuProps) {
  const [isDebugMode, setIsDebugMode] = useState(false)
  const modKey = isMac ? '⌘' : 'Ctrl+'

  useEffect(() => {
    window.electronAPI.isDebugMode().then(setIsDebugMode)
  }, [])

  // Action handlers for schema-driven menu items
  const actionHandlers: MenuActionHandlers = {
    toggleFocusMode: onToggleFocusMode,
    toggleSidebar: onToggleSidebar,
  }

  const ViewModeIcon = viewMode === 'compact'
    ? PanelLeft
    : viewMode === 'focus'
      ? Maximize2
      : LayoutGrid

  return (
    <div className="flex items-center gap-[5px]">
      {/* Craft Logo Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TopBarButton aria-label="Craft menu">
            <CraftAgentsSymbol className="h-4 text-accent" />
          </TopBarButton>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="start" minWidth="min-w-48">
          {/* File actions at root level */}
          <StyledDropdownMenuItem onClick={onNewChat}>
            <SquarePenRounded className="h-3.5 w-3.5" />
            New Chat
            <DropdownMenuShortcut className="pl-6">{modKey}N</DropdownMenuShortcut>
          </StyledDropdownMenuItem>
          {onNewWindow && (
            <StyledDropdownMenuItem onClick={onNewWindow}>
              <Icons.AppWindow className="h-3.5 w-3.5" />
              New Window
              <DropdownMenuShortcut className="pl-6">{modKey}⇧N</DropdownMenuShortcut>
            </StyledDropdownMenuItem>
          )}

          <StyledDropdownMenuSeparator />

          {/* Edit, View, Window submenus from shared schema */}
          {renderMenuSection(EDIT_MENU, actionHandlers)}
          {renderMenuSection(VIEW_MENU, actionHandlers)}
          {renderMenuSection(WINDOW_MENU, actionHandlers)}

          <StyledDropdownMenuSeparator />

          {/* Settings submenu - items from shared schema */}
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <Icons.Settings className="h-3.5 w-3.5" />
              Settings
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent>
              {/* Main settings entry with keyboard shortcut */}
              <StyledDropdownMenuItem onClick={onOpenSettings}>
                <Icons.Settings className="h-3.5 w-3.5" />
                Settings...
                <DropdownMenuShortcut className="pl-6">{modKey},</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuSeparator />
              {/* All settings subpages from shared schema */}
              {SETTINGS_ITEMS.map((item) => {
                const Icon = SETTINGS_ICONS[item.id]
                return (
                  <StyledDropdownMenuItem
                    key={item.id}
                    onClick={() => onOpenSettingsSubpage(item.id)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </StyledDropdownMenuItem>
                )
              })}
            </StyledDropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Help submenu */}
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <Icons.HelpCircle className="h-3.5 w-3.5" />
              Help
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://agents.craft.do/docs')}>
                <Icons.HelpCircle className="h-3.5 w-3.5" />
                Help & Documentation
                <Icons.ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={onOpenKeyboardShortcuts}>
                <Icons.Keyboard className="h-3.5 w-3.5" />
                Keyboard Shortcuts
                <DropdownMenuShortcut className="pl-6">{modKey}/</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
            </StyledDropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Debug submenu (dev only) */}
          {isDebugMode && (
            <>
              <DropdownMenuSub>
                <StyledDropdownMenuSubTrigger>
                  <Icons.Bug className="h-3.5 w-3.5" />
                  Debug
                </StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent>
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.checkForUpdates()}>
                    <Icons.Download className="h-3.5 w-3.5" />
                    Check for Updates
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.installUpdate()}>
                    <Icons.Download className="h-3.5 w-3.5" />
                    Install Update
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuSeparator />
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.menuToggleDevTools()}>
                    <Icons.Bug className="h-3.5 w-3.5" />
                    Toggle DevTools
                    <DropdownMenuShortcut className="pl-6">{isMac ? '⌥⌘I' : 'Ctrl+Shift+I'}</DropdownMenuShortcut>
                  </StyledDropdownMenuItem>
                </StyledDropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}

          <StyledDropdownMenuSeparator />

          {/* Quit */}
          <StyledDropdownMenuItem onClick={() => window.electronAPI.menuQuit()}>
            <Icons.LogOut className="h-3.5 w-3.5" />
            Quit Craft Agents
            <DropdownMenuShortcut className="pl-6">{modKey}Q</DropdownMenuShortcut>
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>

      {/* View Mode Toggle - cycles through full → compact → focus */}
      {onCycleViewMode && (
        <TopBarButton onClick={onCycleViewMode} aria-label="Toggle view mode">
          <ViewModeIcon className="h-4 w-4 text-foreground/70" />
        </TopBarButton>
      )}

      {/* Back Navigation */}
      <TopBarButton
        onClick={onBack}
        disabled={!canGoBack}
        aria-label="Go back"
      >
        <Icons.ChevronLeft className="h-5 w-5 text-foreground/70" strokeWidth={1.5} />
      </TopBarButton>

      {/* Forward Navigation */}
      <TopBarButton
        onClick={onForward}
        disabled={!canGoForward}
        aria-label="Go forward"
      >
        <Icons.ChevronRight className="h-5 w-5 text-foreground/70" strokeWidth={1.5} />
      </TopBarButton>
    </div>
  )
}
