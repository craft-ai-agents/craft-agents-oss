import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import * as Icons from "lucide-react"
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
import { CraftAgentsSymbol } from "../icons/CraftAgentsSymbol"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { SETTINGS_ICONS } from "../icons/SettingsIcons"
import { TopBarButton } from "../ui/TopBarButton"
import {
  EDIT_MENU,
  VIEW_MENU,
  WINDOW_MENU,
  SETTINGS_ITEMS,
  ROOT_MENU,
  HELP_LINKS,
  DEBUG_MENU,
  getShortcutDisplay,
} from "../../../shared/menu-schema"
import type { MenuItem, MenuSection } from "../../../shared/menu-schema"
import type { AppMenuProps } from "./types"

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

function renderSubmenuItem(
  item: MenuItem,
  index: number,
  actionHandlers: MenuActionHandlers,
  t: (key: string) => string,
): React.ReactNode {
  if (item.type === 'separator') {
    return <StyledDropdownMenuSeparator key={`sep-${index}`} />
  }

  if (item.type === 'url') {
    const Icon = getIcon(item.icon)
    return (
      <StyledDropdownMenuItem key={item.id} onClick={() => window.electronAPI.openUrl(item.url)}>
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {t(item.labelKey)}
        <Icons.ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
      </StyledDropdownMenuItem>
    )
  }

  const Icon = getIcon(item.icon)
  const shortcut = getShortcutDisplay(item, isMac)

  if (item.type === 'role') {
    const handler = roleHandlers[item.role]
    const safeHandler = handler ?? (() => {
      console.warn(`[DesktopAppMenu] No handler registered for role: ${item.role}`)
    })
    return (
      <StyledDropdownMenuItem key={item.role} onClick={safeHandler}>
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {t(item.labelKey)}
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
        {t(item.labelKey)}
        {shortcut && <DropdownMenuShortcut className="pl-6">{shortcut}</DropdownMenuShortcut>}
      </StyledDropdownMenuItem>
    )
  }

  return null
}

function renderMenuSection(
  section: MenuSection,
  actionHandlers: MenuActionHandlers,
  t: (key: string) => string,
): React.ReactNode {
  const Icon = getIcon(section.icon)
  return (
    <DropdownMenuSub key={section.id}>
      <StyledDropdownMenuSubTrigger>
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {t(section.labelKey)}
      </StyledDropdownMenuSubTrigger>
      <StyledDropdownMenuSubContent>
        {section.items.map((item, index) => renderSubmenuItem(item, index, actionHandlers, t))}
      </StyledDropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/**
 * Desktop AppMenu — Craft logo dropdown with Edit/View/Window/Settings/Help/Debug submenus.
 *
 * Behavior matches the pre-refactor version that lived inline in `TopBar.tsx`.
 * Labels, hotkey strings, and update-actions are pulled from `menu-schema.ts`
 * so the mobile sheet and this dropdown share a single source of truth.
 */
export function DesktopAppMenu({
  onNewChat,
  onNewWindow,
  onOpenSettings,
  onOpenSettingsSubpage,
  onOpenKeyboardShortcuts,
  onToggleSidebar,
  onToggleFocusMode,
}: AppMenuProps) {
  const { t } = useTranslation()
  const [isDebugMode, setIsDebugMode] = useState(false)

  const newChatHotkey = useActionLabel('app.newChat').hotkey
  const newWindowHotkey = useActionLabel('app.newWindow').hotkey
  const settingsHotkey = useActionLabel('app.settings').hotkey
  const keyboardShortcutsHotkey = useActionLabel('app.keyboardShortcuts').hotkey
  const quitHotkey = useActionLabel('app.quit').hotkey

  useEffect(() => {
    window.electronAPI.isDebugMode().then(setIsDebugMode)
  }, [])

  const actionHandlers: MenuActionHandlers = {
    toggleFocusMode: onToggleFocusMode,
    toggleSidebar: onToggleSidebar,
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TopBarButton aria-label={t("menu.craftMenu")}>
          <CraftAgentsSymbol className="h-4 text-accent" />
        </TopBarButton>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="start" minWidth="min-w-48">
        <StyledDropdownMenuItem onClick={onNewChat}>
          <SquarePenRounded className="h-3.5 w-3.5" />
          {t(ROOT_MENU.newChat.labelKey)}
          {newChatHotkey && <DropdownMenuShortcut className="pl-6">{newChatHotkey}</DropdownMenuShortcut>}
        </StyledDropdownMenuItem>
        {onNewWindow && (
          <StyledDropdownMenuItem onClick={onNewWindow}>
            <Icons.AppWindow className="h-3.5 w-3.5" />
            {t(ROOT_MENU.newWindow.labelKey)}
            {newWindowHotkey && <DropdownMenuShortcut className="pl-6">{newWindowHotkey}</DropdownMenuShortcut>}
          </StyledDropdownMenuItem>
        )}

        <StyledDropdownMenuSeparator />

        {renderMenuSection(EDIT_MENU, actionHandlers, t)}
        {renderMenuSection(VIEW_MENU, actionHandlers, t)}
        {renderMenuSection(WINDOW_MENU, actionHandlers, t)}

        <StyledDropdownMenuSeparator />

        <DropdownMenuSub>
          <StyledDropdownMenuSubTrigger>
            <Icons.Settings className="h-3.5 w-3.5" />
            {t("sidebar.settings")}
          </StyledDropdownMenuSubTrigger>
          <StyledDropdownMenuSubContent>
            <StyledDropdownMenuItem onClick={onOpenSettings}>
              <Icons.Settings className="h-3.5 w-3.5" />
              {t("menu.settings")}
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
                  {t(item.labelKey)}
                </StyledDropdownMenuItem>
              )
            })}
          </StyledDropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <StyledDropdownMenuSubTrigger>
            <Icons.HelpCircle className="h-3.5 w-3.5" />
            {t("menu.help")}
          </StyledDropdownMenuSubTrigger>
          <StyledDropdownMenuSubContent>
            {HELP_LINKS.map((link) => {
              const Icon = getIcon(link.icon)
              return (
                <StyledDropdownMenuItem
                  key={link.id}
                  onClick={() => window.electronAPI.openUrl(link.url)}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {t(link.labelKey)}
                  <Icons.ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
                </StyledDropdownMenuItem>
              )
            })}
            <StyledDropdownMenuItem onClick={onOpenKeyboardShortcuts}>
              <Icons.Keyboard className="h-3.5 w-3.5" />
              {t(ROOT_MENU.keyboardShortcuts.labelKey)}
              {keyboardShortcutsHotkey && <DropdownMenuShortcut className="pl-6">{keyboardShortcutsHotkey}</DropdownMenuShortcut>}
            </StyledDropdownMenuItem>
          </StyledDropdownMenuSubContent>
        </DropdownMenuSub>

        {isDebugMode && renderDebugSubmenu(t)}

        <StyledDropdownMenuSeparator />

        <StyledDropdownMenuItem onClick={() => window.electronAPI.menuQuit()}>
          <Icons.LogOut className="h-3.5 w-3.5" />
          {t(ROOT_MENU.quit.labelKey)}
          {quitHotkey && <DropdownMenuShortcut className="pl-6">{quitHotkey}</DropdownMenuShortcut>}
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Renders the Debug submenu by mapping over `DEBUG_MENU.items`. The three actions
 * that drive it (`checkForUpdates`, `installUpdate`, `toggleDevTools`) all live on
 * `window.electronAPI` directly and never traverse the menu IPC channels.
 */
function renderDebugSubmenu(t: (key: string) => string): React.ReactNode {
  const SectionIcon = getIcon(DEBUG_MENU.icon)
  return (
    <DropdownMenuSub>
      <StyledDropdownMenuSubTrigger>
        {SectionIcon && <SectionIcon className="h-3.5 w-3.5" />}
        {t(DEBUG_MENU.labelKey)}
      </StyledDropdownMenuSubTrigger>
      <StyledDropdownMenuSubContent>
        {DEBUG_MENU.items.map((item, index) => {
          if (item.type === 'separator') {
            return <StyledDropdownMenuSeparator key={`sep-${index}`} />
          }
          if (item.type !== 'action') return null
          const Icon = getIcon(item.icon)
          const shortcut = isMac ? item.shortcutDisplayMac : item.shortcutDisplayOther
          const handler = debugHandlers[item.id]
          if (!handler) {
            console.warn(`[DesktopAppMenu] No debug handler for id: ${item.id}`)
            return null
          }
          return (
            <StyledDropdownMenuItem key={item.id} onClick={handler}>
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {t(item.labelKey)}
              {shortcut && <DropdownMenuShortcut className="pl-6">{shortcut}</DropdownMenuShortcut>}
            </StyledDropdownMenuItem>
          )
        })}
      </StyledDropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

const debugHandlers: Record<string, () => void> = {
  checkForUpdates: () => window.electronAPI.checkForUpdates(),
  installUpdate: () => window.electronAPI.installUpdate(),
  toggleDevTools: () => window.electronAPI.menuToggleDevTools(),
}
