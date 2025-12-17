import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Settings, Keyboard, HelpCircle, ExternalLink } from "lucide-react"
import { CraftSymbol } from "./icons/CraftSymbol"
import { SquarePenRounded } from "./icons/SquarePenRounded"

interface AppMenuProps {
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenKeyboardShortcuts: () => void
  onOpenHelp: () => void
  onOpenCraft: () => void
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
  onOpenHelp,
  onOpenCraft,
}: AppMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1 p-1.5 rounded-[4px] hover:bg-foreground/5 data-[state=open]:bg-foreground/5 focus:outline-none"
          aria-label="Craft menu"
        >
          <CraftSymbol className="h-4" />
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-fit min-w-48 font-sans whitespace-nowrap text-xs dark bg-background/80 backdrop-blur-xl backdrop-saturate-150 border-border/50"
        style={{ borderRadius: '8px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)' }}
      >
        {/* Primary action */}
        <DropdownMenuItem onClick={onNewChat} className="gap-3 pr-4 hover:bg-foreground/10 focus:bg-foreground/10">
          <SquarePenRounded className="h-3.5 w-3.5" />
          New Chat
          <DropdownMenuShortcut className="pl-6">⌘N</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-foreground/10" />

        {/* Settings and preferences */}
        <DropdownMenuItem onClick={onOpenSettings} className="gap-3 pr-4 hover:bg-foreground/10 focus:bg-foreground/10">
          <Settings className="h-3.5 w-3.5" />
          Settings...
          <DropdownMenuShortcut className="pl-6">⌘,</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenKeyboardShortcuts} className="gap-3 pr-4 hover:bg-foreground/10 focus:bg-foreground/10">
          <Keyboard className="h-3.5 w-3.5" />
          Keyboard Shortcuts
          <DropdownMenuShortcut className="pl-6">⌘/</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-foreground/10" />

        {/* External links */}
        <DropdownMenuItem onClick={onOpenHelp} className="gap-3 pr-4 hover:bg-foreground/10 focus:bg-foreground/10">
          <HelpCircle className="h-3.5 w-3.5" />
          Help & Documentation
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenCraft} className="gap-3 pr-4 hover:bg-foreground/10 focus:bg-foreground/10">
          <ExternalLink className="h-3.5 w-3.5" />
          Open Craft App
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
