import { formatDistanceToNow } from "date-fns"
import { Archive, ArchiveRestore, Trash2, Bot } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { useSession } from "@/hooks/useSession"
import type { Session } from "../../../shared/types"

interface SessionListProps {
  items: Session[]
  onDelete: (sessionId: string) => void
  onArchive?: (sessionId: string) => void
  onUnarchive?: (sessionId: string) => void
}

/**
 * SessionList - Scrollable list of session cards
 *
 * Each card displays:
 * - Workspace name + processing indicator (pulsing dot)
 * - Relative timestamp ("2 hours ago")
 * - Message count + agent name (if applicable)
 * - Preview text (first 300 chars of last message)
 * - Processing badge when agent is working
 *
 * Hover actions: Archive/Unarchive, Delete
 */
export function SessionList({ items, onDelete, onArchive, onUnarchive }: SessionListProps) {
  const [session, setSession] = useSession()

  // Sort by most recent activity first
  const sortedItems = [...items].sort((a, b) =>
    (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
  )

  return (
    <ScrollArea className="h-screen">
      <div className="flex flex-col">
        {sortedItems.length === 0 ? (
          /* Empty State */
          <p className="text-sm text-muted-foreground text-center py-8">
            No conversations yet
          </p>
        ) : (
          sortedItems.map((item, index) => {
            const lastMessage = item.messages[item.messages.length - 1]
            const preview = lastMessage?.content?.slice(0, 300) || 'New conversation'

            return (
              /* Session Card: Clickable button that selects the session */
              <div key={item.id}>
                {index > 0 && <Separator />}
                <button
                  className={cn(
                    "group flex w-full flex-col items-start gap-2 px-4 py-3 text-left text-sm transition-all hover:bg-accent relative",
                    session.selected === item.id && "bg-muted"  // Selected state
                  )}
                onClick={() =>
                  setSession({
                    ...session,
                    selected: item.id,
                  })
                }
              >
                {/* Card Header Row */}
                <div className="flex w-full flex-col gap-0.5">
                  {/* Workspace Name + Processing Indicator */}
                  <div className="flex items-center gap-2">
                    <div className="font-semibold font-sans">{item.workspaceName || 'Workspace'}</div>
                    {item.isProcessing && (
                      <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
                    )}
                  </div>
                  {/* Meta Row: Message count · Timestamp + Agent name */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                    <span>
                      {item.messages.length} message{item.messages.length !== 1 ? 's' : ''}
                      {item.lastMessageAt && (
                        <> · {formatDistanceToNow(new Date(item.lastMessageAt), { addSuffix: true })}</>
                      )}
                    </span>
                    {item.agentName && (
                      <span className="flex items-center gap-1 ml-auto">
                        <Bot className="h-3 w-3" />
                        {item.agentName}
                      </span>
                    )}
                  </div>
                </div>
                {/* Preview Text: First 300 chars of last message */}
                <div className="line-clamp-2 text-xs text-muted-foreground">
                  {preview}
                </div>
                {/* Processing Badge */}
                {item.isProcessing && (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Processing</Badge>
                  </div>
                )}

                {/* Hover Action Buttons: Archive, Unarchive, Delete */}
                <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onArchive && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="group/btn size-6 hover:bg-foreground/5"
                      title="Archive"
                      onClick={(e) => {
                        e.stopPropagation()
                        onArchive(item.id)
                      }}
                    >
                      <Archive className="size-3.5 text-muted-foreground group-hover/btn:text-foreground" />
                    </Button>
                  )}
                  {onUnarchive && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="group/btn size-6 hover:bg-foreground/5"
                      title="Unarchive"
                      onClick={(e) => {
                        e.stopPropagation()
                        onUnarchive(item.id)
                      }}
                    >
                      <ArchiveRestore className="size-3.5 text-muted-foreground group-hover/btn:text-foreground" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="group/btn size-6 hover:bg-foreground/5"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(item.id)
                    }}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground group-hover/btn:text-foreground" />
                  </Button>
                </div>
                </button>
              </div>
            )
          })
        )}
      </div>
    </ScrollArea>
  )
}
