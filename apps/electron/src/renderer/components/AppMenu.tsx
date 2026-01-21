import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import { Settings, Keyboard, RotateCcw, User, ChevronLeft, ChevronRight, HelpCircle, ExternalLink } from "lucide-react"
import { CraftAgentsSymbol } from "./icons/CraftAgentsSymbol"
import { SquarePenRounded } from "./icons/SquarePenRounded"
import { PanelLeftRounded } from "./icons/PanelLeftRounded"
import { TopBarButton } from "./ui/TopBarButton"

interface AppMenuProps {
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenKeyboardShortcuts: () => void
  onOpenStoredUserPreferences: () => void
  onReset: () => void
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
 * Contains the Craft logo dropdown, back/forward navigation, and sidebar toggle.
 * All buttons use the consistent TopBarButton component.
 */
export function AppMenu({
  onNewChat,
  onOpenSettings,
  onOpenKeyboardShortcuts,
  onOpenStoredUserPreferences,
  onReset,
  onBack,
  onForward,
  canGoBack = true,
  canGoForward = true,
  onToggleSidebar,
  isSidebarVisible = true,
}: AppMenuProps) {
  return (
    <div className="flex items-center gap-[5px] w-full">
      {/* Craft Logo Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TopBarButton aria-label="Craft menu">
            <CraftAgentsSymbol className="h-4 text-accent" />
          </TopBarButton>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="start" minWidth="min-w-48">
          {/* Primary action */}
          <StyledDropdownMenuItem onClick={onNewChat}>
            <SquarePenRounded className="h-3.5 w-3.5" />
            New Chat
            <DropdownMenuShortcut className="pl-6">⌘N</DropdownMenuShortcut>
          </StyledDropdownMenuItem>

          <StyledDropdownMenuSeparator />

          {/* Settings and preferences */}
          <StyledDropdownMenuItem onClick={onOpenSettings}>
            <Settings className="h-3.5 w-3.5" />
            Settings...
            <DropdownMenuShortcut className="pl-6">⌘,</DropdownMenuShortcut>
          </StyledDropdownMenuItem>
          <StyledDropdownMenuItem onClick={onOpenKeyboardShortcuts}>
            <Keyboard className="h-3.5 w-3.5" />
            Keyboard Shortcuts
            <DropdownMenuShortcut className="pl-6">⌘/</DropdownMenuShortcut>
          </StyledDropdownMenuItem>
          <StyledDropdownMenuItem onClick={onOpenStoredUserPreferences}>
            <User className="h-3.5 w-3.5" />
            Stored User Preferences
          </StyledDropdownMenuItem>

          <StyledDropdownMenuSeparator />

          {/* Help */}
          <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://agents.craft.do/docs')}>
            <HelpCircle className="h-3.5 w-3.5" />
            Help & Documentation
            <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
          </StyledDropdownMenuItem>

          <StyledDropdownMenuSeparator />

          {/* Reset App */}
          <StyledDropdownMenuItem onClick={onReset} variant="destructive">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset App...
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>

      {/* Spacer to push nav buttons right */}
      <div className="flex-1" />

      {/* Back Navigation */}
      <TopBarButton
        onClick={onBack}
        disabled={!canGoBack}
        aria-label="Go back"
      >
        <ChevronLeft className="h-[22px] w-[22px] text-foreground/70" strokeWidth={1.5} />
      </TopBarButton>

      {/* Forward Navigation */}
      <TopBarButton
        onClick={onForward}
        disabled={!canGoForward}
        aria-label="Go forward"
      >
        <ChevronRight className="h-[22px] w-[22px] text-foreground/70" strokeWidth={1.5} />
      </TopBarButton>

      {/* Sidebar Toggle - temporarily hidden */}
      {/* {onToggleSidebar && (
        <TopBarButton
          onClick={onToggleSidebar}
          aria-label={isSidebarVisible ? "Hide sidebar" : "Show sidebar"}
        >
          <PanelLeftRounded className="h-5 w-5 text-foreground/70" />
        </TopBarButton>
      )} */}
    </div>
  )
}
