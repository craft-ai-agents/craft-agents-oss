/**
 * TopBar - Persistent top bar above all panels (Slack-style)
 *
 * Layout: [Menu] [Sidebar] [Back] [Forward] [Workspace selector] ... [Browser strip] [+] [Help]
 *
 * Fixed at top of window, height controlled by --topbar-height.
 * macOS: offset left to avoid stoplight controls.
 */

import { useTranslation } from "react-i18next"
import * as Icons from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
import { PanelLeftRounded } from "../icons/PanelLeftRounded"
import { PanelRightRounded } from "../icons/PanelRightRounded"
import { TopBarButton } from "../ui/TopBarButton"
import { cn } from "@/lib/utils"
import { isMac, isWebUI } from "@/lib/platform"
import { useActionLabel } from "@/actions"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import type { SettingsMenuItem } from "../../../shared/menu-schema"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { SquareCode } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { BrowserTabStrip } from "../browser/BrowserTabStrip"
import type { Workspace } from "../../../shared/types"
import { WorkspaceSwitcher } from "./WorkspaceSwitcher"
import { CompactWorkspaceSwitcher } from "./CompactWorkspaceSwitcher"
import { getDocUrl } from "@craft-agent/shared/docs/doc-links"
import { AppMenu } from "../AppMenu"

const RIGHT_SLOT_FULL_BADGES_THRESHOLD = 420
const RIGHT_SLOT_TWO_BADGES_THRESHOLD = 300

interface TopBarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string, openInNewWindow?: boolean) => void | Promise<void>
  workspaceUnreadMap?: Record<string, boolean>
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
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
  onToggleRightSidebar: () => void
  onToggleFocusMode: () => void
  onAddSessionPanel: () => void
  onAddBrowserPanel: () => void
  /** When true, shows the right sidebar toggle in the top bar */
  isRightSidebarToggleVisible: boolean
  /** When true, shows the editor panel toggle button in the top bar */
  isEditorPanelToggleVisible: boolean
  /** Whether the editor panel is currently open */
  isEditorPanelOpen: boolean
  /** Called when the user clicks the editor panel toggle button */
  onEditorPanelToggle: () => void
  /** When true, hides controls that don't apply in compact/mobile layout */
  isCompact?: boolean
}

export function TopBar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  workspaceUnreadMap,
  onWorkspaceCreated,
  onWorkspaceRemoved,
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
  onToggleRightSidebar,
  onToggleFocusMode,
  onAddSessionPanel,
  onAddBrowserPanel,
  isRightSidebarToggleVisible,
  isEditorPanelToggleVisible,
  isEditorPanelOpen,
  onEditorPanelToggle,
  isCompact,
}: TopBarProps) {
  const { t } = useTranslation()
  const [maxVisibleBrowserBadges, setMaxVisibleBrowserBadges] = useState(3)
  const rightSlotRef = useRef<HTMLDivElement | null>(null)

  const goBackHotkey = useActionLabel('nav.goBackAlt').hotkey
  const goForwardHotkey = useActionLabel('nav.goForwardAlt').hotkey

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

  // Stoplight padding clears macOS traffic-light controls, which only exist
  // in the Electron desktop window. The webui runs in a regular browser tab
  // and has no traffic lights regardless of host OS — collapse to a normal
  // 12px inset so the logo sits at the edge.
  const menuLeftPadding = isMac && !isWebUI ? 86 : 12

  return (
    <div
      className="fixed top-0 left-0 right-0 z-panel titlebar-drag-region bg-foreground-5"
      style={{ height: 'var(--topbar-height)' }}
    >
      <div className="flex h-full w-full items-center justify-between gap-2">
      {/* === LEFT: Menu + Sidebar + Navigation + Workspace === */}
      {/* Keep this container draggable. Only individual interactive controls should use titlebar-no-drag. */}
      {/* In compact mode the right slot is hidden, so we add right padding here
          so the workspace pill doesn't run flush against the viewport edge. */}
      <div
        className="pointer-events-auto flex min-w-0 flex-1 items-center gap-0.5"
        style={{ paddingLeft: menuLeftPadding, paddingRight: isCompact ? 12 : 0 }}
      >
        <div className="flex items-center gap-0.5">
        <AppMenu
          onNewChat={onNewChat}
          onNewWindow={onNewWindow}
          onOpenSettings={onOpenSettings}
          onOpenSettingsSubpage={onOpenSettingsSubpage}
          onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
          onOpenStoredUserPreferences={onOpenStoredUserPreferences}
          onToggleSidebar={onToggleSidebar}
          onToggleFocusMode={onToggleFocusMode}
        />

        {!isCompact && (
        <Tooltip>
          <TooltipTrigger asChild>
            <TopBarButton onClick={onToggleSidebar} aria-label={t("menu.toggleSidebar")}>
              <PanelLeftRounded className="h-[18px] w-[18px] text-foreground/70" />
            </TopBarButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("menu.toggleSidebar")}</TooltipContent>
        </Tooltip>
        )}
        </div>

        {/* Back / Forward / Workspace selector (moved from center).
            In compact mode the back/forward buttons are dropped — the iOS-style
            drill-in chevron in PanelHeader plus the browser's native back gesture
            cover that affordance, and the freed width lets the workspace pill
            actually fit on phone-width viewports. */}
        <div className={cn("ml-1 flex min-w-0 items-center gap-1", isCompact ? "flex-1" : "w-[clamp(220px,42vw,640px)]")}>
          {!isCompact && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TopBarButton onClick={onBack} disabled={!canGoBack} aria-label={t("common.back")}>
                    <Icons.ChevronLeft className="h-[18px] w-[18px] text-foreground/70" strokeWidth={1.5} />
                  </TopBarButton>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("common.back")} {goBackHotkey}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <TopBarButton onClick={onForward} disabled={!canGoForward} aria-label={t("common.forward")}>
                    <Icons.ChevronRight className="h-[18px] w-[18px] text-foreground/70" strokeWidth={1.5} />
                  </TopBarButton>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("common.forward")} {goForwardHotkey}</TooltipContent>
              </Tooltip>
            </>
          )}

          {workspaces.some(w => w.remoteServer) && (
            <div className="min-w-0 flex-1">
              {isCompact ? (
                <CompactWorkspaceSwitcher
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  onSelect={onSelectWorkspace}
                  onWorkspaceCreated={onWorkspaceCreated}
                  onWorkspaceRemoved={onWorkspaceRemoved}
                  workspaceUnreadMap={workspaceUnreadMap}
                />
              ) : (
                <WorkspaceSwitcher
                  variant="topbar"
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  onSelect={onSelectWorkspace}
                  onWorkspaceCreated={onWorkspaceCreated}
                  onWorkspaceRemoved={onWorkspaceRemoved}
                  workspaceUnreadMap={workspaceUnreadMap}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* === RIGHT: Browser strip + add + help === */}
      {!isCompact && (
      <div ref={rightSlotRef} className="flex min-w-0 shrink-0 items-center justify-end gap-1" style={{ paddingRight: 12 }}>
        <div className="min-w-0">
          <BrowserTabStrip activeSessionId={activeSessionId} maxVisibleBadges={maxVisibleBrowserBadges} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <TopBarButton aria-label={t("menu.addPanelMenu")} className="ml-1 h-[26px] w-[26px] rounded-lg">
              <Icons.Plus className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
            </TopBarButton>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" minWidth="min-w-56">
            <StyledDropdownMenuItem onClick={onAddSessionPanel}>
              <SquarePenRounded className="h-3.5 w-3.5" />
              {t("session.newSessionInPanel")}
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={onAddBrowserPanel}>
              <Icons.Globe className="h-3.5 w-3.5" />
              {t("browser.newWindow")}
            </StyledDropdownMenuItem>
          </StyledDropdownMenuContent>
        </DropdownMenu>

        {/* Help button */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <TopBarButton aria-label={t("menu.helpAndDocs")} className="h-[26px] w-[26px] rounded-lg">
              <Icons.HelpCircle className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
            </TopBarButton>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" minWidth="min-w-48">
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('sources'))}>
              <Icons.DatabaseZap className="h-3.5 w-3.5" />
              <span className="flex-1">{t("sidebar.sources")}</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('skills'))}>
              <Icons.Zap className="h-3.5 w-3.5" />
              <span className="flex-1">{t("sidebar.skills")}</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('statuses'))}>
              <Icons.CheckCircle2 className="h-3.5 w-3.5" />
              <span className="flex-1">{t("sidebar.statuses")}</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('permissions'))}>
              <Icons.Settings className="h-3.5 w-3.5" />
              <span className="flex-1">{t("settings.permissions.title")}</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('automations'))}>
              <Icons.Webhook className="h-3.5 w-3.5" />
              <span className="flex-1">{t("sidebar.automations")}</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://agents.craft.do/docs')}>
              <Icons.ExternalLink className="h-3.5 w-3.5" />
              <span className="flex-1">{t("menu.allDocumentation")}</span>
            </StyledDropdownMenuItem>
          </StyledDropdownMenuContent>
        </DropdownMenu>

        {isEditorPanelToggleVisible && (
          <Tooltip>
            <TooltipTrigger asChild>
              <TopBarButton
                onClick={onEditorPanelToggle}
                aria-label={t("menu.toggleEditorPanel")}
                className={cn("h-[26px] w-[26px] rounded-lg", isEditorPanelOpen && "bg-foreground/10")}
              >
                <SquareCode className="h-[18px] w-[18px] text-foreground/50" strokeWidth={1.5} />
              </TopBarButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("menu.toggleEditorPanel")}</TooltipContent>
          </Tooltip>
        )}

        {isRightSidebarToggleVisible && (
          <Tooltip>
            <TooltipTrigger asChild>
              <TopBarButton
                onClick={onToggleRightSidebar}
                aria-label={t("menu.toggleRightSidebar")}
                className="h-[26px] w-[26px] rounded-lg"
              >
                <PanelRightRounded className="h-[18px] w-[18px] text-foreground/50" />
              </TopBarButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("menu.toggleRightSidebar")}</TooltipContent>
          </Tooltip>
        )}
      </div>
      )}
      </div>
    </div>
  )
}
