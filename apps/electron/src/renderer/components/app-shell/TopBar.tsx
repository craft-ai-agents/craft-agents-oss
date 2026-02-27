/**
 * TopBar - Persistent top bar above all panels (Slack-style)
 *
 * Layout: [Sidebar] [Menu] [flex] [Back] [Forward] [Search field] [flex] [Settings]
 *
 * Fixed at top of window, 48px tall.
 * macOS: offset left to avoid stoplight controls.
 */

import * as Icons from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
import { CraftAgentsSymbol } from "../icons/CraftAgentsSymbol"
import { PanelLeftRounded } from "../icons/PanelLeftRounded"
import { TopBarButton } from "../ui/TopBarButton"
import { isMac } from "@/lib/platform"
import { useActionLabel } from "@/actions"
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
import {
  EDIT_MENU,
  VIEW_MENU,
  WINDOW_MENU,
  SETTINGS_ITEMS,
  getShortcutDisplay,
} from "../../../shared/menu-schema"
import type { MenuItem, MenuSection, SettingsMenuItem } from "../../../shared/menu-schema"
import { SETTINGS_ICONS } from "../icons/SettingsIcons"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { useEffect, useState } from "react"

// --- Menu rendering (moved from AppMenu) ---

type MenuActionHandlers = {
  toggleFocusMode?: () => void
  toggleSidebar?: () => void
}

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

function getIcon(name: string): React.ComponentType<{ className?: string }> | null {
  const IconComponent = Icons[name as keyof typeof Icons] as React.ComponentType<{ className?: string }> | undefined
  return IconComponent ?? null
}

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
    const safeHandler = handler ?? (() => {
      console.warn(`[TopBar] No handler registered for role: ${item.role}`)
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

// --- TopBar ---

interface TopBarProps {
  workspaceName?: string
  onNewChat: () => void
  onNewWindow?: () => void
  onOpenSettings: () => void
  onOpenSettingsSubpage: (subpage: SettingsMenuItem['id']) => void
  onOpenKeyboardShortcuts: () => void
  onOpenStoredUserPreferences: () => void
  onBack: () => void
  onForward: () => void
  canGoBack: boolean
  canGoForward: boolean
  onToggleSidebar: () => void
  onToggleFocusMode: () => void
  onAddPanel: () => void
}

export function TopBar({
  workspaceName,
  onNewChat,
  onNewWindow,
  onOpenSettings,
  onOpenSettingsSubpage,
  onOpenKeyboardShortcuts,
  onOpenStoredUserPreferences,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  onToggleSidebar,
  onToggleFocusMode,
  onAddPanel,
}: TopBarProps) {
  const [isDebugMode, setIsDebugMode] = useState(false)

  const newChatHotkey = useActionLabel('app.newChat').hotkey
  const newWindowHotkey = useActionLabel('app.newWindow').hotkey
  const settingsHotkey = useActionLabel('app.settings').hotkey
  const keyboardShortcutsHotkey = useActionLabel('app.keyboardShortcuts').hotkey
  const quitHotkey = useActionLabel('app.quit').hotkey
  const goBackHotkey = useActionLabel('nav.goBackAlt').hotkey
  const goForwardHotkey = useActionLabel('nav.goForwardAlt').hotkey

  useEffect(() => {
    window.electronAPI.isDebugMode().then(setIsDebugMode)
  }, [])

  const actionHandlers: MenuActionHandlers = {
    toggleFocusMode: onToggleFocusMode,
    toggleSidebar: onToggleSidebar,
  }

  const menuLeftPadding = isMac ? 86 : 12

  return (
    <div
      className="fixed top-0 left-0 right-0 h-[48px] z-panel flex items-center justify-between titlebar-drag-region"
      style={{ paddingLeft: menuLeftPadding, paddingRight: 12 }}
    >
      {/* === LEFT: Sidebar Toggle + Craft Menu === */}
      <div className="pointer-events-auto titlebar-no-drag flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <TopBarButton onClick={onToggleSidebar} aria-label="Toggle sidebar">
              <PanelLeftRounded className="h-[18px] w-[18px] text-foreground/70" />
            </TopBarButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">Toggle Sidebar</TooltipContent>
        </Tooltip>

        {/* Craft Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <TopBarButton aria-label="Craft menu">
              <CraftAgentsSymbol className="h-4 text-accent" />
            </TopBarButton>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="start" minWidth="min-w-48">
            <StyledDropdownMenuItem onClick={onNewChat}>
              <SquarePenRounded className="h-3.5 w-3.5" />
              New Chat
              {newChatHotkey && <DropdownMenuShortcut className="pl-6">{newChatHotkey}</DropdownMenuShortcut>}
            </StyledDropdownMenuItem>
            {onNewWindow && (
              <StyledDropdownMenuItem onClick={onNewWindow}>
                <Icons.AppWindow className="h-3.5 w-3.5" />
                New Window
                {newWindowHotkey && <DropdownMenuShortcut className="pl-6">{newWindowHotkey}</DropdownMenuShortcut>}
              </StyledDropdownMenuItem>
            )}

            <StyledDropdownMenuSeparator />

            {renderMenuSection(EDIT_MENU, actionHandlers)}
            {renderMenuSection(VIEW_MENU, actionHandlers)}
            {renderMenuSection(WINDOW_MENU, actionHandlers)}

            <StyledDropdownMenuSeparator />

            <DropdownMenuSub>
              <StyledDropdownMenuSubTrigger>
                <Icons.Settings className="h-3.5 w-3.5" />
                Settings
              </StyledDropdownMenuSubTrigger>
              <StyledDropdownMenuSubContent>
                <StyledDropdownMenuItem onClick={onOpenSettings}>
                  <Icons.Settings className="h-3.5 w-3.5" />
                  Settings...
                  {settingsHotkey && <DropdownMenuShortcut className="pl-6">{settingsHotkey}</DropdownMenuShortcut>}
                </StyledDropdownMenuItem>
                <StyledDropdownMenuSeparator />
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
                  {keyboardShortcutsHotkey && <DropdownMenuShortcut className="pl-6">{keyboardShortcutsHotkey}</DropdownMenuShortcut>}
                </StyledDropdownMenuItem>
              </StyledDropdownMenuSubContent>
            </DropdownMenuSub>

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

            <StyledDropdownMenuItem onClick={() => window.electronAPI.menuQuit()}>
              <Icons.LogOut className="h-3.5 w-3.5" />
              Quit Craft Agents
              {quitHotkey && <DropdownMenuShortcut className="pl-6">{quitHotkey}</DropdownMenuShortcut>}
            </StyledDropdownMenuItem>
          </StyledDropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* === CENTER: Back / Forward / Search (absolute centered) === */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="pointer-events-auto titlebar-no-drag flex items-center gap-1"
          style={{ width: '50%', maxWidth: 640 }}
        >
          {/* Back */}
          <Tooltip>
            <TooltipTrigger asChild>
              <TopBarButton onClick={onBack} disabled={!canGoBack} aria-label="Go back">
                <Icons.ChevronLeft className="h-[18px] w-[18px] text-foreground/70" strokeWidth={1.5} />
              </TopBarButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back {goBackHotkey}</TooltipContent>
          </Tooltip>

          {/* Forward */}
          <Tooltip>
            <TooltipTrigger asChild>
              <TopBarButton onClick={onForward} disabled={!canGoForward} aria-label="Go forward">
                <Icons.ChevronRight className="h-[18px] w-[18px] text-foreground/70" strokeWidth={1.5} />
              </TopBarButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">Forward {goForwardHotkey}</TooltipContent>
          </Tooltip>

          {/* Search field (visual placeholder) */}
          <button
            type="button"
            className="ml-1 flex-1 min-w-0 flex items-center justify-center gap-2 h-[30px] px-3 rounded-[8px] border border-foreground/6 text-[13px] text-foreground/40 hover:bg-foreground/5 hover:text-foreground transition-colors cursor-pointer"
          >
            <Icons.Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Search {workspaceName || 'Workspace'}</span>
          </button>
        </div>
      </div>

      {/* === RIGHT: Add Panel === */}
      <div className="pointer-events-auto titlebar-no-drag flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <TopBarButton onClick={onAddPanel} aria-label="Add panel">
              <Icons.Plus className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
            </TopBarButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">New Panel</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
