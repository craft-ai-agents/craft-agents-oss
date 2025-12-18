import { Info, RotateCw, KeyRound, Trash2 } from "lucide-react"
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from "@/components/ui/styled-context-menu"
import type { SubAgentMetadata } from "../../../shared/types"

export type AgentAction =
  | { type: 'info'; agent: SubAgentMetadata }
  | { type: 'reload'; agent: SubAgentMetadata }
  | { type: 'reauthenticate'; agent: SubAgentMetadata }
  | { type: 'reset'; agent: SubAgentMetadata }

interface AgentContextMenuProps {
  agent: SubAgentMetadata
  children: React.ReactNode
  onAction: (action: AgentAction) => void
  onOpenChange?: (open: boolean) => void
}

/**
 * Context menu for agent items in the sidebar
 * Actions: Info, Reload, Reauthenticate, Reset
 */
export function AgentContextMenu({
  agent,
  children,
  onAction,
  onOpenChange,
}: AgentContextMenuProps) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onClick={() => onAction({ type: 'info', agent })}>
          <Info />
          Info
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem onClick={() => onAction({ type: 'reload', agent })}>
          <RotateCw />
          Reload
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => onAction({ type: 'reauthenticate', agent })}>
          <KeyRound />
          Reauthenticate
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem onClick={() => onAction({ type: 'reset', agent })} variant="destructive">
          <Trash2 />
          Reset
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}
