import { useEffect, useState } from "react"
import type { TFunction } from 'i18next'
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
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
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
import type { MenuItem, MenuSection, SettingsMenuItem } from "../../shared/menu-schema"
import { SETTINGS_ICONS } from "./icons/SettingsIcons"
import { useTranslation } from 'react-i18next'

export function getAppMenuLabels(t: TFunction) {
  return {
    ariaCraftMenu: t('common:appMenu.aria.craftMenu'),
    ariaGoBack: t('common:appMenu.aria.goBack'),
    ariaGoForward: t('common:appMenu.aria.goForward'),
    newChat: t('common:appMenu.file.newChat'),
    newWindow: t('common:appMenu.file.newWindow'),
    settingsMenu: t('common:appMenu.settings.menu'),
    settingsOpen: t('common:appMenu.settings.open'),
    helpMenu: t('common:appMenu.help.menu'),
    helpDocs: t('common:appMenu.help.docs'),
    keyboardShortcuts: t('common:appMenu.help.shortcuts'),
    debugMenu: t('common:appMenu.debug.menu'),
    checkUpdates: t('common:appMenu.debug.checkUpdates'),
    installUpdate: t('common:appMenu.debug.installUpdate'),
    toggleDevtools: t('common:appMenu.debug.toggleDevtools'),
    quit: t('common:appMenu.quit'),
  }
}

export function getAppMenuSchemaLabels(t: TFunction) {
  return {
    sections: {
      edit: t('common:appMenu.schema.sections.edit'),
      view: t('common:appMenu.schema.sections.view'),
      window: t('common:appMenu.schema.sections.window'),
    },
    items: {
      undo: t('common:appMenu.schema.items.undo'),
      redo: t('common:appMenu.schema.items.redo'),
      cut: t('common:appMenu.schema.items.cut'),
      copy: t('common:appMenu.schema.items.copy'),
      paste: t('common:appMenu.schema.items.paste'),
      selectAll: t('common:appMenu.schema.items.selectAll'),
      zoomIn: t('common:appMenu.schema.items.zoomIn'),
      zoomOut: t('common:appMenu.schema.items.zoomOut'),
      resetZoom: t('common:appMenu.schema.items.resetZoom'),
      toggleFocusMode: t('common:appMenu.schema.items.toggleFocusMode'),
      toggleSidebar: t('common:appMenu.schema.items.toggleSidebar'),
      minimize: t('common:appMenu.schema.items.minimize'),
      maximize: t('common:appMenu.schema.items.maximize'),
    },
  }
}

export function getAppMenuSettingsItemLabel(
  t: TFunction,
  id: SettingsMenuItem['id']
): string {
  const resolved = t(`settings:navigator.items.${id}.label` as never)
  return typeof resolved === 'string' ? resolved : String(resolved)
}

function localizeSection(section: MenuSection, labels: ReturnType<typeof getAppMenuSchemaLabels>): MenuSection {
  const sectionLabelMap: Record<string, string> = {
    edit: labels.sections.edit,
    view: labels.sections.view,
    window: labels.sections.window,
  }

  const itemLabelMap: Record<string, string> = {
    undo: labels.items.undo,
    redo: labels.items.redo,
    cut: labels.items.cut,
    copy: labels.items.copy,
    paste: labels.items.paste,
    selectAll: labels.items.selectAll,
    zoomIn: labels.items.zoomIn,
    zoomOut: labels.items.zoomOut,
    resetZoom: labels.items.resetZoom,
    toggleFocusMode: labels.items.toggleFocusMode,
    toggleSidebar: labels.items.toggleSidebar,
    minimize: labels.items.minimize,
    zoom: labels.items.maximize,
  }

  return {
    ...section,
    label: sectionLabelMap[section.id] ?? section.label,
    items: section.items.map((item) => {
      if (item.type === 'separator') return item
      const key = item.type === 'role' ? item.role : item.id
      return {
        ...item,
        label: itemLabelMap[key] ?? item.label,
      }
    }),
  }
}

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
}: AppMenuProps) {
  const { t } = useTranslation(['common', 'settings'])
  const labels = getAppMenuLabels(t)
  const schemaLabels = getAppMenuSchemaLabels(t)
  const [isDebugMode, setIsDebugMode] = useState(false)

  // Get hotkey labels from centralized action registry
  const newChatHotkey = useActionLabel('app.newChat').hotkey
  const newWindowHotkey = useActionLabel('app.newWindow').hotkey
  const settingsHotkey = useActionLabel('app.settings').hotkey
  const keyboardShortcutsHotkey = useActionLabel('app.keyboardShortcuts').hotkey
  const quitHotkey = useActionLabel('app.quit').hotkey
  const goBackHotkey = useActionLabel('nav.goBackAlt').hotkey
  const goForwardHotkey = useActionLabel('nav.goForwardAlt').hotkey

  const editMenu = localizeSection(EDIT_MENU, schemaLabels)
  const viewMenu = localizeSection(VIEW_MENU, schemaLabels)
  const windowMenu = localizeSection(WINDOW_MENU, schemaLabels)

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
      {/* Craft Logo Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TopBarButton aria-label={labels.ariaCraftMenu}>
            <CraftAgentsSymbol className="h-4 text-accent" />
          </TopBarButton>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="start" minWidth="min-w-48">
          {/* File actions at root level */}
          <StyledDropdownMenuItem onClick={onNewChat}>
            <SquarePenRounded className="h-3.5 w-3.5" />
            {labels.newChat}
            <DropdownMenuShortcut className="pl-6">{modKey}N</DropdownMenuShortcut>
          </StyledDropdownMenuItem>
          {onNewWindow && (
            <StyledDropdownMenuItem onClick={onNewWindow}>
              <Icons.AppWindow className="h-3.5 w-3.5" />
              {labels.newWindow}
              <DropdownMenuShortcut className="pl-6">{modKey}⇧N</DropdownMenuShortcut>
            </StyledDropdownMenuItem>
          )}

          <StyledDropdownMenuSeparator />

          {/* Edit, View, Window submenus from shared schema */}
          {renderMenuSection(editMenu, actionHandlers)}
          {renderMenuSection(viewMenu, actionHandlers)}
          {renderMenuSection(windowMenu, actionHandlers)}

          <StyledDropdownMenuSeparator />

          {/* Settings submenu - items from shared schema */}
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <Icons.Settings className="h-3.5 w-3.5" />
              {labels.settingsMenu}
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent>
              {/* Main settings entry with keyboard shortcut */}
              <StyledDropdownMenuItem onClick={onOpenSettings}>
                <Icons.Settings className="h-3.5 w-3.5" />
                {labels.settingsOpen}
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
                    {getAppMenuSettingsItemLabel(t, item.id)}
                  </StyledDropdownMenuItem>
                )
              })}
            </StyledDropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Help submenu */}
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <Icons.HelpCircle className="h-3.5 w-3.5" />
              {labels.helpMenu}
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://agents.craft.do/docs')}>
                <Icons.HelpCircle className="h-3.5 w-3.5" />
                {labels.helpDocs}
                <Icons.ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={onOpenKeyboardShortcuts}>
                <Icons.Keyboard className="h-3.5 w-3.5" />
                {labels.keyboardShortcuts}
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
                  {labels.debugMenu}
                </StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent>
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.checkForUpdates()}>
                    <Icons.Download className="h-3.5 w-3.5" />
                    {labels.checkUpdates}
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.installUpdate()}>
                    <Icons.Download className="h-3.5 w-3.5" />
                    {labels.installUpdate}
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuSeparator />
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.menuToggleDevTools()}>
                    <Icons.Bug className="h-3.5 w-3.5" />
                    {labels.toggleDevtools}
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
            {labels.quit}
            <DropdownMenuShortcut className="pl-6">{modKey}Q</DropdownMenuShortcut>
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>

      {/* Spacer to push nav buttons right */}
      <div className="flex-1" />

      {/* Back Navigation */}
      <TopBarButton
        onClick={onBack}
        disabled={!canGoBack}
        aria-label={labels.ariaGoBack}
      >
        <Icons.ChevronLeft className="h-[22px] w-[22px] text-foreground/70" strokeWidth={1.5} />
      </TopBarButton>

      {/* Forward Navigation */}
      <TopBarButton
        onClick={onForward}
        disabled={!canGoForward}
        aria-label={labels.ariaGoForward}
      >
        <Icons.ChevronRight className="h-[22px] w-[22px] text-foreground/70" strokeWidth={1.5} />
      </TopBarButton>
    </div>
  )
}
