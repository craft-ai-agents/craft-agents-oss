import * as React from "react"
import {
  Inbox,
  MessageSquare,
  Plus,
  Search,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Separator } from "@/components/ui/separator"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkspaceSwitcher } from "./WorkspaceSwitcher"
import { ChatDisplay } from "./ChatDisplay"
import { SessionList } from "./SessionList"
import { Nav } from "./Nav"
import { useSession } from "@/hooks/useSession"
import type { Session, Workspace } from "../../../shared/types"

interface MailProps {
  workspaces: Workspace[]
  sessions: Session[]
  activeWorkspaceId: string | null
  defaultLayout?: number[]
  defaultCollapsed?: boolean
  navCollapsedSize?: number
  onSelectWorkspace: (id: string) => void
  onCreateSession: (workspaceId: string) => void
  onDeleteSession: (sessionId: string) => void
  onSendMessage: (sessionId: string, message: string) => void
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
}

export function Mail({
  workspaces,
  sessions,
  activeWorkspaceId,
  defaultLayout = [20, 32, 48],
  defaultCollapsed = false,
  navCollapsedSize = 4,
  onSelectWorkspace,
  onCreateSession,
  onDeleteSession,
  onSendMessage,
  onOpenFile,
  onOpenUrl,
}: MailProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(defaultCollapsed)
  const [session, setSession] = useSession()
  const [searchQuery, setSearchQuery] = React.useState("")

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  // Filter sessions by search query
  const filteredSessions = React.useMemo(() => {
    if (!searchQuery.trim()) return sessions
    const query = searchQuery.toLowerCase()
    return sessions.filter(s => {
      const workspaceName = s.workspaceName?.toLowerCase() || ''
      const lastMessage = s.messages[s.messages.length - 1]?.content?.toLowerCase() || ''
      return workspaceName.includes(query) || lastMessage.includes(query)
    })
  }, [sessions, searchQuery])

  const selectedSession = sessions.find(s => s.id === session.selected) || null

  return (
    <TooltipProvider delayDuration={0}>
      <ResizablePanelGroup
        direction="horizontal"
        onLayout={(sizes: number[]) => {
          localStorage.setItem('mail-layout', JSON.stringify(sizes))
        }}
        className="h-full items-stretch"
      >
        <ResizablePanel
          defaultSize={defaultLayout[0]}
          collapsedSize={navCollapsedSize}
          collapsible={true}
          minSize={10}
          maxSize={20}
          onCollapse={() => {
            setIsCollapsed(true)
            localStorage.setItem('mail-collapsed', JSON.stringify(true))
          }}
          onResize={() => {
            setIsCollapsed(false)
            localStorage.setItem('mail-collapsed', JSON.stringify(false))
          }}
          className={cn(
            "bg-sidebar overflow-hidden",
            isCollapsed &&
              "min-w-12.5 transition-all duration-300 ease-in-out"
          )}
        >
          <div
            className={cn(
              "flex h-13 items-center justify-center",
              isCollapsed ? "h-13" : "px-2"
            )}
          >
            <WorkspaceSwitcher
              isCollapsed={isCollapsed}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSelect={onSelectWorkspace}
            />
          </div>
          <Separator />
          <Nav
            isCollapsed={isCollapsed}
            links={[
              {
                title: "All Chats",
                label: String(sessions.length),
                icon: Inbox,
                variant: "default",
                onClick: () => setSession({ selected: null }),
              },
              {
                title: "New Chat",
                label: "",
                icon: Plus,
                variant: "ghost",
                onClick: () => activeWorkspace && onCreateSession(activeWorkspace.id),
              },
            ]}
          />
          <Separator />
          <Nav
            isCollapsed={isCollapsed}
            links={[
              {
                title: "Messages",
                label: String(sessions.reduce((acc, s) => acc + s.messages.length, 0)),
                icon: MessageSquare,
                variant: "ghost",
              },
            ]}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={defaultLayout[1]} minSize={15} className="overflow-hidden">
          <Tabs defaultValue="all" className="h-full flex flex-col">
            <div className="flex items-center px-4 py-2">
              <h1 className="text-xl font-bold">Sessions</h1>
              <TabsList className="ml-auto">
                <TabsTrigger
                  value="all"
                  className="text-muted-foreground"
                >
                  All
                </TabsTrigger>
                <TabsTrigger
                  value="recent"
                  className="text-muted-foreground"
                >
                  Recent
                </TabsTrigger>
              </TabsList>
            </div>
            <Separator />
            <div className="bg-background/95 p-4 backdrop-blur supports-backdrop-filter:bg-background/60">
              <form>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search"
                    className="pl-10"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </form>
            </div>
            <TabsContent value="all" className="m-0">
              <SessionList
                items={filteredSessions}
                onDelete={onDeleteSession}
              />
            </TabsContent>
            <TabsContent value="recent" className="m-0">
              <SessionList
                items={filteredSessions.slice(0, 10)}
                onDelete={onDeleteSession}
              />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={defaultLayout[2]} minSize={30}>
          <ChatDisplay
            session={selectedSession}
            onSendMessage={(message) => selectedSession && onSendMessage(selectedSession.id, message)}
            onOpenFile={onOpenFile}
            onOpenUrl={onOpenUrl}
            onDelete={() => selectedSession && onDeleteSession(selectedSession.id)}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </TooltipProvider>
  )
}
