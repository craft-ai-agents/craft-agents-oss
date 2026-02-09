import { useEffect, useState } from "react"
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
import * as Icons from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@g4os/ui"
import { G4OSSymbol } from "./icons/G4OSSymbol"
import { SquarePenRounded } from "./icons/SquarePenRounded"
import { TopBarButton } from "./ui/TopBarButton"
import {
  EDIT_MENU,
  VIEW_MENU,
  WINDOW_MENU,
  SETTINGS_ITEMS,
  getShortcutDisplay,
} from "../../shared/menu-schema"
import type { MenuItem, MenuSection, SettingsMenuItem } from "../../shared/menu-schema"
import { SETTINGS_ICONS } from "./icons/SettingsIcons"
import { useLocale } from "@/context/LocaleContext"

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
  actionHandlers: MenuActionHandlers,
  t: ReturnType<typeof useLocale>['t']
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
        {getRoleLabel(item.role, t)}
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
        {getActionLabel(item.id, t)}
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
  actionHandlers: MenuActionHandlers,
  t: ReturnType<typeof useLocale>['t']
): React.ReactNode {
  const Icon = getIcon(section.icon)
  return (
    <DropdownMenuSub key={section.id}>
      <StyledDropdownMenuSubTrigger>
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {getSectionLabel(section.id, t)}
      </StyledDropdownMenuSubTrigger>
      <StyledDropdownMenuSubContent>
        {section.items.map((item, index) => renderMenuItem(item, index, actionHandlers, t))}
      </StyledDropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function getSectionLabel(sectionId: string, t: ReturnType<typeof useLocale>['t']): string {
  switch (sectionId) {
    case 'edit': return t('menu.section.edit')
    case 'view': return t('menu.section.view')
    case 'window': return t('menu.section.window')
    default: return sectionId
  }
}

function getRoleLabel(role: string, t: ReturnType<typeof useLocale>['t']): string {
  switch (role) {
    case 'undo': return t('menu.item.undo')
    case 'redo': return t('menu.item.redo')
    case 'cut': return t('menu.item.cut')
    case 'copy': return t('menu.item.copy')
    case 'paste': return t('menu.item.paste')
    case 'selectAll': return t('menu.item.selectAll')
    case 'zoomIn': return t('menu.item.zoomIn')
    case 'zoomOut': return t('menu.item.zoomOut')
    case 'resetZoom': return t('menu.item.resetZoom')
    case 'minimize': return t('menu.item.minimize')
    case 'zoom': return t('menu.item.maximize')
    default: return role
  }
}

function getActionLabel(actionId: string, t: ReturnType<typeof useLocale>['t']): string {
  switch (actionId) {
    case 'toggleFocusMode': return t('menu.item.toggleFocusMode')
    case 'toggleSidebar': return t('menu.item.toggleSidebar')
    default: return actionId
  }
}

function getSettingsLabel(id: SettingsMenuItem['id'], t: ReturnType<typeof useLocale>['t']): string {
  switch (id) {
    case 'app': return t('settings.page.app.label')
    case 'ai': return t('settings.page.ai.label')
    case 'appearance': return t('settings.page.appearance.label')
    case 'input': return t('settings.page.input.label')
    case 'workspace': return t('settings.page.workspace.label')
    case 'permissions': return t('settings.page.permissions.label')
    case 'labels': return t('settings.page.labels.label')
    case 'shortcuts': return t('settings.page.shortcuts.label')
    case 'preferences': return t('settings.page.preferences.label')
    default: return id
  }
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
}

/**
 * AppMenu - Main application dropdown menu and top bar navigation
 *
 * Contains the G4 OS logo dropdown with all menu functionality:
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
}: AppMenuProps) {
  const { t } = useLocale()
  const [isDebugMode, setIsDebugMode] = useState(false)

  // Get hotkey labels from centralized action registry
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

  // Action handlers for schema-driven menu items
  const actionHandlers: MenuActionHandlers = {
    toggleFocusMode: onToggleFocusMode,
    toggleSidebar: onToggleSidebar,
  }

  return (
    <div className="flex items-center gap-[5px] w-full">
      {/* G4 OS Logo Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TopBarButton aria-label="G4 OS menu">
            <G4OSSymbol className="h-4 text-accent" />
          </TopBarButton>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="start" minWidth="min-w-48">
          {/* File actions at root level */}
          <StyledDropdownMenuItem onClick={onNewChat}>
            <SquarePenRounded className="h-3.5 w-3.5" />
            {t('menu.root.newChat')}
            {newChatHotkey && <DropdownMenuShortcut className="pl-6">{newChatHotkey}</DropdownMenuShortcut>}
          </StyledDropdownMenuItem>
          {onNewWindow && (
            <StyledDropdownMenuItem onClick={onNewWindow}>
              <Icons.AppWindow className="h-3.5 w-3.5" />
              {t('menu.root.newWindow')}
              {newWindowHotkey && <DropdownMenuShortcut className="pl-6">{newWindowHotkey}</DropdownMenuShortcut>}
            </StyledDropdownMenuItem>
          )}

          <StyledDropdownMenuSeparator />

          {/* Edit, View, Window submenus from shared schema */}
          {renderMenuSection(EDIT_MENU, actionHandlers, t)}
          {renderMenuSection(VIEW_MENU, actionHandlers, t)}
          {renderMenuSection(WINDOW_MENU, actionHandlers, t)}

          <StyledDropdownMenuSeparator />

          {/* Settings submenu - items from shared schema */}
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <Icons.Settings className="h-3.5 w-3.5" />
              {t('menu.section.settings')}
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent>
              {/* Main settings entry with keyboard shortcut */}
              <StyledDropdownMenuItem onClick={onOpenSettings}>
                <Icons.Settings className="h-3.5 w-3.5" />
                {t('menu.action.settings')}
                {settingsHotkey && <DropdownMenuShortcut className="pl-6">{settingsHotkey}</DropdownMenuShortcut>}
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
                    {getSettingsLabel(item.id, t)}
                  </StyledDropdownMenuItem>
                )
              })}
            </StyledDropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Help submenu */}
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <Icons.HelpCircle className="h-3.5 w-3.5" />
              {t('menu.section.help')}
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://g4educacao.com/docs')}>
                <Icons.HelpCircle className="h-3.5 w-3.5" />
                {t('menu.action.helpDocs')}
                <Icons.ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={onOpenKeyboardShortcuts}>
                <Icons.Keyboard className="h-3.5 w-3.5" />
                {t('menu.action.keyboardShortcuts')}
                {keyboardShortcutsHotkey && <DropdownMenuShortcut className="pl-6">{keyboardShortcutsHotkey}</DropdownMenuShortcut>}
              </StyledDropdownMenuItem>
            </StyledDropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Debug submenu (dev only) */}
          {isDebugMode && (
            <>
              <DropdownMenuSub>
                <StyledDropdownMenuSubTrigger>
                  <Icons.Bug className="h-3.5 w-3.5" />
                  {t('menu.section.debug')}
                </StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent>
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.checkForUpdates()}>
                    <Icons.Download className="h-3.5 w-3.5" />
                    {t('menu.action.checkForUpdates')}
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.installUpdate()}>
                    <Icons.Download className="h-3.5 w-3.5" />
                    {t('menu.action.installUpdate')}
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuSeparator />
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.menuToggleDevTools()}>
                    <Icons.Bug className="h-3.5 w-3.5" />
                    {t('menu.action.toggleDevTools')}
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
            {t('menu.action.quit')}
            {quitHotkey && <DropdownMenuShortcut className="pl-6">{quitHotkey}</DropdownMenuShortcut>}
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>

      {/* Spacer to push nav buttons right */}
      <div className="flex-1" />

      {/* Back Navigation */}
      <Tooltip>
        <TooltipTrigger asChild>
          <TopBarButton
            onClick={onBack}
            disabled={!canGoBack}
            aria-label="Go back"
          >
            <Icons.ChevronLeft className="h-[22px] w-[22px] text-foreground/70" strokeWidth={1.5} />
          </TopBarButton>
        </TooltipTrigger>
        <TooltipContent side="bottom">{`${t('menu.tooltip.back')} ${goBackHotkey}`.trim()}</TooltipContent>
      </Tooltip>

      {/* Forward Navigation */}
      <Tooltip>
        <TooltipTrigger asChild>
          <TopBarButton
            onClick={onForward}
            disabled={!canGoForward}
            aria-label="Go forward"
          >
            <Icons.ChevronRight className="h-[22px] w-[22px] text-foreground/70" strokeWidth={1.5} />
          </TopBarButton>
        </TooltipTrigger>
        <TooltipContent side="bottom">{`${t('menu.tooltip.forward')} ${goForwardHotkey}`.trim()}</TooltipContent>
      </Tooltip>
    </div>
  )
}
