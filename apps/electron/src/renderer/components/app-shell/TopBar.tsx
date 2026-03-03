/**
 * TopBar - Persistent top bar above all panels (Slack-style)
 *
 * Layout: [Sidebar] [Menu] [Back] [Forward] [Workspace selector] ... [Browser strip] [+] [Help]
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
import { useEffect, useRef, useState } from "react"
import { BrowserTabStrip } from "../browser/BrowserTabStrip"
import type { Workspace } from "../../../shared/types"
import { WorkspaceSwitcher } from "./WorkspaceSwitcher"
import { getDocUrl } from "@craft-agent/shared/docs/doc-links"

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

const RIGHT_SLOT_FULL_BADGES_THRESHOLD = 420
const RIGHT_SLOT_TWO_BADGES_THRESHOLD = 300

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
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string, openInNewWindow?: boolean) => void
  workspaceUnreadMap?: Record<string, boolean>
  onWorkspaceCreated?: (workspace: Workspace) => void
  activeSessionId?: string | null
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
  onAddSessionPanel: () => void
  onAddBrowserPanel: () => void
}

export function TopBar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  workspaceUnreadMap,
  onWorkspaceCreated,
  activeSessionId,
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
  onAddSessionPanel,
  onAddBrowserPanel,
}: TopBarProps) {
  const [isDebugMode, setIsDebugMode] = useState(false)
  const [maxVisibleBrowserBadges, setMaxVisibleBrowserBadges] = useState(3)
  const rightSlotRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    const slotEl = rightSlotRef.current
    if (!slotEl) return

    let frame = 0

    const updateBadgeDensity = () => {
      const slotWidth = slotEl.getBoundingClientRect().width
      const nextMaxVisibleBadges = slotWidth >= RIGHT_SLOT_FULL_BADGES_THRESHOLD
        ? 3
        : slotWidth >= RIGHT_SLOT_TWO_BADGES_THRESHOLD
          ? 2
          : 1

      setMaxVisibleBrowserBadges((prev) => (prev === nextMaxVisibleBadges ? prev : nextMaxVisibleBadges))
    }

    const schedule = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateBadgeDensity)
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(slotEl)
    updateBadgeDensity()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [workspaces.length, activeWorkspaceId])

  const actionHandlers: MenuActionHandlers = {
    toggleFocusMode: onToggleFocusMode,
    toggleSidebar: onToggleSidebar,
  }

  const menuLeftPadding = isMac ? 86 : 12

  return (
    <div
      className="fixed top-0 left-0 right-0 h-[48px] z-panel titlebar-drag-region"
    >
      <div className="flex h-full w-full items-center justify-between gap-2">
      {/* === LEFT: Sidebar + Menu + Navigation + Workspace === */}
      {/* Keep this container draggable. Only individual interactive controls should use titlebar-no-drag. */}
      <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-0.5" style={{ paddingLeft: menuLeftPadding }}>
        <div className="flex items-center gap-0.5">
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

        {/* Back / Forward / Workspace selector (moved from center) */}
        <div className="ml-1 flex w-[clamp(220px,42vw,640px)] min-w-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <TopBarButton onClick={onBack} disabled={!canGoBack} aria-label="Go back">
                <Icons.ChevronLeft className="h-[18px] w-[18px] text-foreground/70" strokeWidth={1.5} />
              </TopBarButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back {goBackHotkey}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <TopBarButton onClick={onForward} disabled={!canGoForward} aria-label="Go forward">
                <Icons.ChevronRight className="h-[18px] w-[18px] text-foreground/70" strokeWidth={1.5} />
              </TopBarButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">Forward {goForwardHotkey}</TooltipContent>
          </Tooltip>

          <div className="min-w-0 flex-1">
            <WorkspaceSwitcher
              variant="topbar"
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSelect={onSelectWorkspace}
              onWorkspaceCreated={onWorkspaceCreated}
              workspaceUnreadMap={workspaceUnreadMap}
            />
          </div>
        </div>
      </div>

      {/* === RIGHT: Browser strip + add + help === */}
      <div ref={rightSlotRef} className="flex min-w-0 shrink-0 items-center justify-end gap-1" style={{ paddingRight: 12 }}>
        <div className="min-w-0">
          <BrowserTabStrip activeSessionId={activeSessionId} maxVisibleBadges={maxVisibleBrowserBadges} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <TopBarButton aria-label="Add panel menu" className="ml-1 h-[26px] w-[26px] rounded-lg">
              <Icons.Plus className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
            </TopBarButton>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" minWidth="min-w-56">
            <StyledDropdownMenuItem onClick={onAddSessionPanel}>
              <SquarePenRounded className="h-3.5 w-3.5" />
              New Session in Panel
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={onAddBrowserPanel}>
              <Icons.Globe className="h-3.5 w-3.5" />
              New Browser Window
            </StyledDropdownMenuItem>
          </StyledDropdownMenuContent>
        </DropdownMenu>

        {/* Help button */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <TopBarButton aria-label="Help & Documentation" className="h-[26px] w-[26px] rounded-lg">
              <Icons.HelpCircle className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
            </TopBarButton>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" minWidth="min-w-48">
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('sources'))}>
              <Icons.DatabaseZap className="h-3.5 w-3.5" />
              <span className="flex-1">Sources</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('skills'))}>
              <Icons.Zap className="h-3.5 w-3.5" />
              <span className="flex-1">Skills</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('statuses'))}>
              <Icons.CheckCircle2 className="h-3.5 w-3.5" />
              <span className="flex-1">Statuses</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('permissions'))}>
              <Icons.Settings className="h-3.5 w-3.5" />
              <span className="flex-1">Permissions</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('automations'))}>
              <Icons.Webhook className="h-3.5 w-3.5" />
              <span className="flex-1">Automations</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://agents.craft.do/docs')}>
              <Icons.ExternalLink className="h-3.5 w-3.5" />
              <span className="flex-1">All Documentation</span>
            </StyledDropdownMenuItem>
          </StyledDropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>
    </div>
  )
}
