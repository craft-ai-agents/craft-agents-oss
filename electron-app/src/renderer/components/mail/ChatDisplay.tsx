import * as React from "react"
import { format } from "date-fns"
import {
  MoreVertical,
  Send,
  Trash2,
  MessageSquare,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { Session, Message } from "../../../shared/types"

interface ChatDisplayProps {
  session: Session | null
  onSendMessage: (message: string) => void
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
  onDelete: () => void
}

export function ChatDisplay({
  session,
  onSendMessage,
  onOpenFile,
  onOpenUrl,
  onDelete,
}: ChatDisplayProps) {
  const [input, setInput] = React.useState("")
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || session?.isProcessing) return
    onSendMessage(input.trim())
    setInput("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center p-2">
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" disabled={!session} onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete session</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete session</TooltipContent>
          </Tooltip>
        </div>
        <Separator orientation="vertical" className="mx-2 h-6 ml-auto" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={!session}>
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">More</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDelete}>Delete session</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Separator />

      {session ? (
        <div className="flex flex-1 flex-col min-h-0">
          {/* Session header */}
          <div className="flex items-start p-4">
            <div className="flex items-start gap-4 text-sm">
              <Avatar>
                <AvatarFallback>
                  {session.workspaceName?.charAt(0).toUpperCase() || 'W'}
                </AvatarFallback>
              </Avatar>
              <div className="grid gap-1">
                <div className="font-semibold">{session.workspaceName || 'Chat'}</div>
                <div className="line-clamp-1 text-xs text-muted-foreground">
                  {session.messages.length} message{session.messages.length !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
            {session.lastMessageAt && (
              <div className="ml-auto text-xs text-muted-foreground">
                {format(new Date(session.lastMessageAt), "PPpp")}
              </div>
            )}
          </div>
          <Separator />

          {/* Messages area */}
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {session.messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <div className="size-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                    <MessageSquare className="size-7 text-primary" />
                  </div>
                  <p className="font-medium text-foreground">Welcome to {session.workspaceName}</p>
                  <p className="text-sm mt-1">Start a conversation by typing a message below.</p>
                </div>
              ) : (
                session.messages.map(message => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onOpenFile={onOpenFile}
                    onOpenUrl={onOpenUrl}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          <Separator className="mt-auto" />

          {/* Input area */}
          <div className="p-4">
            <form onSubmit={handleSubmit}>
              <div className="grid gap-4">
                <Textarea
                  className="p-4"
                  placeholder={`Message ${session.workspaceName || 'Chat'}...`}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={session.isProcessing}
                />
                <div className="flex items-center">
                  <p className="text-xs text-muted-foreground">
                    Craft Agents can make mistakes. Please verify important information.
                  </p>
                  <Button
                    type="submit"
                    size="sm"
                    className="ml-auto"
                    disabled={!input.trim() || session.isProcessing}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : (
        <div className="p-8 text-center text-muted-foreground flex-1 flex flex-col items-center justify-center">
          <div className="size-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <MessageSquare className="size-8 text-muted-foreground/50" />
          </div>
          <h2 className="text-lg font-medium text-foreground">No session selected</h2>
          <p className="text-sm mt-1">Select a session from the list or create a new one</p>
        </div>
      )}
    </div>
  )
}

// Message Bubble Component
interface MessageBubbleProps {
  message: Message
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
}

function MessageBubble({ message, onOpenFile, onOpenUrl }: MessageBubbleProps) {
  const detectLinks = (text: string): React.ReactNode => {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    const fileRegex = /((?:\/|~\/)[^\s]+\.(?:md|txt|json|yaml|yml|ts|tsx|js|jsx|py|go|rs|swift|kt|java|c|cpp|h|hpp|css|scss|html|xml|toml|ini|cfg|conf|sh|bash|zsh))/g

    interface Match {
      type: 'url' | 'file'
      text: string
      index: number
      length: number
    }

    const matches: Match[] = []

    let match: RegExpExecArray | null
    while ((match = urlRegex.exec(text)) !== null) {
      matches.push({
        type: 'url',
        text: match[0],
        index: match.index,
        length: match[0].length
      })
    }

    while ((match = fileRegex.exec(text)) !== null) {
      const isPartOfUrl = matches.some(
        m => m.type === 'url' && match!.index >= m.index && match!.index < m.index + m.length
      )
      if (!isPartOfUrl) {
        matches.push({
          type: 'file',
          text: match[0],
          index: match.index,
          length: match[0].length
        })
      }
    }

    matches.sort((a, b) => a.index - b.index)

    if (matches.length === 0) {
      return text
    }

    const parts: React.ReactNode[] = []
    let lastIndex = 0

    for (const m of matches) {
      if (m.index > lastIndex) {
        parts.push(text.slice(lastIndex, m.index))
      }

      if (m.type === 'url') {
        parts.push(
          <button
            key={`url-${m.index}`}
            onClick={() => onOpenUrl(m.text)}
            className="text-primary hover:underline"
          >
            {m.text}
          </button>
        )
      } else {
        parts.push(
          <button
            key={`file-${m.index}`}
            onClick={() => onOpenFile(m.text)}
            className="text-primary hover:underline font-mono text-sm"
          >
            {m.text}
          </button>
        )
      }

      lastIndex = m.index + m.length
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex))
    }

    return parts
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-primary text-primary-foreground rounded-lg px-4 py-2">
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        </div>
      </div>
    )
  }

  if (message.role === 'assistant') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-muted rounded-lg px-4 py-2">
          <p className="whitespace-pre-wrap text-sm">{detectLinks(message.content)}</p>
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse rounded-sm" />
          )}
        </div>
      </div>
    )
  }

  if (message.role === 'tool') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] border rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
            <div className="p-1 rounded bg-primary/10 text-primary">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <span className="text-xs font-semibold uppercase tracking-wide">{message.toolName}</span>
          </div>
          <div className="px-3 py-2">
            {message.toolResult ? (
              <pre className="text-xs text-muted-foreground overflow-x-auto max-h-48 overflow-y-auto font-mono bg-muted/30 p-2 rounded">
                {message.toolResult.slice(0, 500)}
                {message.toolResult.length > 500 && '...'}
              </pre>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span className="text-xs">Running...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (message.role === 'error') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-destructive mb-1 font-semibold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Error</span>
          </div>
          <p className="text-sm text-destructive">{message.content}</p>
        </div>
      </div>
    )
  }

  if (message.role === 'status') {
    return (
      <div className="flex justify-center my-2">
        <div className="px-3 py-1 rounded-full bg-muted border text-xs font-medium text-muted-foreground flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
          {message.content}
        </div>
      </div>
    )
  }

  return null
}
