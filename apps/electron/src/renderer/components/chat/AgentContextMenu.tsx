import { Info, MessageSquarePlus, RotateCcw } from "lucide-react"
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from "@/components/ui/styled-context-menu"
import type { SubAgentMetadata } from "../../../shared/types"

export type AgentAction =
  | { type: 'new_conversation'; agent: SubAgentMetadata }
  | { type: 'info'; agent: SubAgentMetadata }
  | { type: 'reset'; agent: SubAgentMetadata }

interface AgentContextMenuProps {
  agent: SubAgentMetadata
  children: React.ReactNode
  onAction: (action: AgentAction) => void
  onOpenChange?: (open: boolean) => void
  /** Whether the agent is ready to start a new conversation (set up and authenticated) */
  canStartConversation?: boolean
}

/**
 * Context menu for agent items in the sidebar
 * Actions: New Conversation (if ready), Info, Reset
 */
export function AgentContextMenu({
  agent,
  children,
  onAction,
  onOpenChange,
  canStartConversation = true,
}: AgentContextMenuProps) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        {canStartConversation && (
          <>
            <StyledContextMenuItem onClick={() => onAction({ type: 'new_conversation', agent })}>
              <MessageSquarePlus />
              New Conversation
            </StyledContextMenuItem>
            <StyledContextMenuSeparator />
          </>
        )}
        <StyledContextMenuItem onClick={() => onAction({ type: 'info', agent })}>
          <Info />
          Info
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem onClick={() => onAction({ type: 'reset', agent })}>
          <RotateCcw />
          Reset
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}
