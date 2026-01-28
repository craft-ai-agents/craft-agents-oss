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
import {
  Settings,
  Keyboard,
  User,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  ExternalLink,
  Undo2,
  Redo2,
  Scissors,
  Copy,
  ClipboardPaste,
  TextSelect,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Minimize2,
  Maximize2,
  LogOut,
  Bug,
  Download,
  Wrench,
  Pencil,
  Eye,
  AppWindow,
} from "lucide-react"
import { CraftAgentsSymbol } from "./icons/CraftAgentsSymbol"
import { SquarePenRounded } from "./icons/SquarePenRounded"
import { TopBarButton } from "./ui/TopBarButton"
import { useTranslation } from "react-i18next"

interface AppMenuProps {
  onNewChat: () => void
  onNewWindow?: () => void
  onOpenSettings: () => void
  onOpenKeyboardShortcuts: () => void
  onOpenStoredUserPreferences: () => void
  onBack?: () => void
  onForward?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  onToggleSidebar?: () => void
  isSidebarVisible?: boolean
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
  onOpenKeyboardShortcuts,
  onOpenStoredUserPreferences,
  onBack,
  onForward,
  canGoBack = true,
  canGoForward = true,
}: AppMenuProps) {
  const { t } = useTranslation('sidebar')
  const [isDebugMode, setIsDebugMode] = useState(false)
  const modKey = isMac ? '⌘' : 'Ctrl+'

  useEffect(() => {
    window.electronAPI.isDebugMode().then(setIsDebugMode)
  }, [])

  return (
    <div className="flex items-center gap-[5px] w-full">
      {/* Craft Logo Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TopBarButton aria-label={t('appMenu.craftMenuLabel', { defaultValue: 'Craft menu' })}>
            <CraftAgentsSymbol className="h-4 text-accent" />
          </TopBarButton>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="start" minWidth="min-w-48">
          {/* File actions at root level */}
          <StyledDropdownMenuItem onClick={onNewChat}>
            <SquarePenRounded className="h-3.5 w-3.5" />
            {t('appMenu.newChat', { defaultValue: 'New Chat' })}
            <DropdownMenuShortcut className="pl-6">{modKey}N</DropdownMenuShortcut>
          </StyledDropdownMenuItem>
          {onNewWindow && (
            <StyledDropdownMenuItem onClick={onNewWindow}>
              <AppWindow className="h-3.5 w-3.5" />
              {t('appMenu.newWindow', { defaultValue: 'New Window' })}
              <DropdownMenuShortcut className="pl-6">{modKey}⇧N</DropdownMenuShortcut>
            </StyledDropdownMenuItem>
          )}

          <StyledDropdownMenuSeparator />

          {/* Edit submenu */}
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <Pencil className="h-3.5 w-3.5" />
              {t('appMenu.edit', { defaultValue: 'Edit' })}
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.menuUndo()}>
                <Undo2 className="h-3.5 w-3.5" />
                {t('appMenu.undo', { defaultValue: 'Undo' })}
                <DropdownMenuShortcut className="pl-6">{modKey}Z</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.menuRedo()}>
                <Redo2 className="h-3.5 w-3.5" />
                {t('appMenu.redo', { defaultValue: 'Redo' })}
                <DropdownMenuShortcut className="pl-6">{modKey}⇧Z</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuSeparator />
              <StyledDropdownMenuItem onClick={() => window.electronAPI.menuCut()}>
                <Scissors className="h-3.5 w-3.5" />
                {t('appMenu.cut', { defaultValue: 'Cut' })}
                <DropdownMenuShortcut className="pl-6">{modKey}X</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.menuCopy()}>
                <Copy className="h-3.5 w-3.5" />
                {t('appMenu.copy', { defaultValue: 'Copy' })}
                <DropdownMenuShortcut className="pl-6">{modKey}C</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.menuPaste()}>
                <ClipboardPaste className="h-3.5 w-3.5" />
                {t('appMenu.paste', { defaultValue: 'Paste' })}
                <DropdownMenuShortcut className="pl-6">{modKey}V</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuSeparator />
              <StyledDropdownMenuItem onClick={() => window.electronAPI.menuSelectAll()}>
                <TextSelect className="h-3.5 w-3.5" />
                {t('appMenu.selectAll', { defaultValue: 'Select All' })}
                <DropdownMenuShortcut className="pl-6">{modKey}A</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
            </StyledDropdownMenuSubContent>
          </DropdownMenuSub>

          {/* View submenu */}
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <Eye className="h-3.5 w-3.5" />
              {t('appMenu.view', { defaultValue: 'View' })}
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.menuZoomIn()}>
                <ZoomIn className="h-3.5 w-3.5" />
                {t('appMenu.zoomIn', { defaultValue: 'Zoom In' })}
                <DropdownMenuShortcut className="pl-6">{modKey}+</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.menuZoomOut()}>
                <ZoomOut className="h-3.5 w-3.5" />
                {t('appMenu.zoomOut', { defaultValue: 'Zoom Out' })}
                <DropdownMenuShortcut className="pl-6">{modKey}-</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.menuZoomReset()}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t('appMenu.resetZoom', { defaultValue: 'Reset Zoom' })}
                <DropdownMenuShortcut className="pl-6">{modKey}0</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
            </StyledDropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Window submenu */}
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <AppWindow className="h-3.5 w-3.5" />
              {t('appMenu.window', { defaultValue: 'Window' })}
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.menuMinimize()}>
                <Minimize2 className="h-3.5 w-3.5" />
                {t('appMenu.minimize', { defaultValue: 'Minimize' })}
                <DropdownMenuShortcut className="pl-6">{modKey}M</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.menuMaximize()}>
                <Maximize2 className="h-3.5 w-3.5" />
                {t('appMenu.maximize', { defaultValue: 'Maximize' })}
              </StyledDropdownMenuItem>
            </StyledDropdownMenuSubContent>
          </DropdownMenuSub>

          <StyledDropdownMenuSeparator />

          {/* Settings submenu */}
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <Settings className="h-3.5 w-3.5" />
              {t('appMenu.settings', { defaultValue: 'Settings' })}
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent>
              <StyledDropdownMenuItem onClick={onOpenSettings}>
                <Wrench className="h-3.5 w-3.5" />
                {t('appMenu.settingsEllipsis', { defaultValue: 'Settings...' })}
                <DropdownMenuShortcut className="pl-6">{modKey},</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={onOpenStoredUserPreferences}>
                <User className="h-3.5 w-3.5" />
                {t('appMenu.storedUserPreferences', { defaultValue: 'Stored User Preferences' })}
              </StyledDropdownMenuItem>
            </StyledDropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Help submenu */}
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <HelpCircle className="h-3.5 w-3.5" />
              {t('appMenu.help', { defaultValue: 'Help' })}
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://agents.craft.do/docs')}>
                <HelpCircle className="h-3.5 w-3.5" />
                {t('appMenu.helpDocumentation', { defaultValue: 'Help & Documentation' })}
                <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={onOpenKeyboardShortcuts}>
                <Keyboard className="h-3.5 w-3.5" />
                {t('appMenu.keyboardShortcuts', { defaultValue: 'Keyboard Shortcuts' })}
                <DropdownMenuShortcut className="pl-6">{modKey}/</DropdownMenuShortcut>
              </StyledDropdownMenuItem>
            </StyledDropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Debug submenu (dev only) */}
          {isDebugMode && (
            <>
              <DropdownMenuSub>
                <StyledDropdownMenuSubTrigger>
                  <Bug className="h-3.5 w-3.5" />
                  {t('appMenu.debug', { defaultValue: 'Debug' })}
                </StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent>
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.checkForUpdates()}>
                    <Download className="h-3.5 w-3.5" />
                    {t('appMenu.checkForUpdates', { defaultValue: 'Check for Updates' })}
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.installUpdate()}>
                    <Download className="h-3.5 w-3.5" />
                    {t('appMenu.installUpdate', { defaultValue: 'Install Update' })}
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuSeparator />
                  <StyledDropdownMenuItem onClick={() => window.electronAPI.menuToggleDevTools()}>
                    <Bug className="h-3.5 w-3.5" />
                    {t('appMenu.toggleDevTools', { defaultValue: 'Toggle DevTools' })}
                    <DropdownMenuShortcut className="pl-6">{isMac ? '⌥⌘I' : 'Ctrl+Shift+I'}</DropdownMenuShortcut>
                  </StyledDropdownMenuItem>
                </StyledDropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}

          <StyledDropdownMenuSeparator />

          {/* Quit */}
          <StyledDropdownMenuItem onClick={() => window.electronAPI.menuQuit()}>
            <LogOut className="h-3.5 w-3.5" />
            {t('appMenu.quit', { defaultValue: 'Quit Craft Agents' })}
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
        aria-label={t('appMenu.goBack', { defaultValue: 'Go back' })}
      >
        <ChevronLeft className="h-[22px] w-[22px] text-foreground/70" strokeWidth={1.5} />
      </TopBarButton>

      {/* Forward Navigation */}
      <TopBarButton
        onClick={onForward}
        disabled={!canGoForward}
        aria-label={t('appMenu.goForward', { defaultValue: 'Go forward' })}
      >
        <ChevronRight className="h-[22px] w-[22px] text-foreground/70" strokeWidth={1.5} />
      </TopBarButton>
    </div>
  )
}
