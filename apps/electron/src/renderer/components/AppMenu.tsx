import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import { ChevronDown, Settings, Keyboard, HelpCircle, ExternalLink, RotateCcw, User } from "lucide-react"
import { CraftAgentsSymbol } from "./icons/CraftAgentsSymbol"
import { SquarePenRounded } from "./icons/SquarePenRounded"

interface AppMenuProps {
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenKeyboardShortcuts: () => void
  onOpenStoredUserPreferences: () => void
  onOpenHelp: () => void
  onOpenCraft: () => void
  onReset: () => void
}

/**
 * AppMenu - Main application dropdown menu
 *
 * Triggered by clicking the Craft logo + chevron in the sidebar header.
 * Provides quick access to common actions.
 */
export function AppMenu({
  onNewChat,
  onOpenSettings,
  onOpenKeyboardShortcuts,
  onOpenStoredUserPreferences,
  onOpenHelp,
  onOpenCraft,
  onReset,
}: AppMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1 p-1.5 rounded-[4px] hover:bg-foreground/5 data-[state=open]:bg-foreground/5 focus:outline-none focus-visible:ring-0"
          aria-label="Craft menu"
        >
          <CraftAgentsSymbol className="h-4 text-accent" />
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
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

        {/* External links */}
        <StyledDropdownMenuItem onClick={onOpenHelp}>
          <HelpCircle className="h-3.5 w-3.5" />
          Help & Documentation
        </StyledDropdownMenuItem>
        <StyledDropdownMenuItem onClick={onOpenCraft}>
          <ExternalLink className="h-3.5 w-3.5" />
          Open Craft App
        </StyledDropdownMenuItem>

        <StyledDropdownMenuSeparator />

        {/* Reset App */}
        <StyledDropdownMenuItem onClick={onReset} variant="destructive">
          <RotateCcw className="h-3.5 w-3.5" />
          Reset App...
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
