import React, { useState, useEffect, useCallback } from 'react'
import type { Session, Workspace, SessionEvent, Message } from '../shared/types'
import { generateMessageId } from '../shared/types'
import { Mail } from '@/components/mail/Mail'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)

  // Load workspaces on mount
  useEffect(() => {
    window.electronAPI.getWorkspaces().then((ws) => {
      setWorkspaces(ws)
      if (ws.length > 0 && !activeWorkspaceId) {
        setActiveWorkspaceId(ws[0].id)
      }
    })
    window.electronAPI.getSessions().then(setSessions)
  }, [])

  // Listen for session events
  useEffect(() => {
    const cleanup = window.electronAPI.onSessionEvent((event: SessionEvent) => {
      setSessions(prev => {
        return prev.map(session => {
          if (session.id !== event.sessionId) return session

          switch (event.type) {
            case 'text_delta': {
              const lastMsg = session.messages[session.messages.length - 1]

              if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
                return {
                  ...session,
                  messages: [
                    ...session.messages.slice(0, -1),
                    { ...lastMsg, content: lastMsg.content + event.delta }
                  ]
                }
              }

              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'assistant' as const,
                    content: event.delta,
                    timestamp: Date.now(),
                    isStreaming: true
                  }
                ]
              }
            }

            case 'text_complete': {
              const msgs = session.messages
              const lastAssistant = msgs[msgs.length - 1]
              if (lastAssistant?.role === 'assistant') {
                return {
                  ...session,
                  messages: [
                    ...msgs.slice(0, -1),
                    { ...lastAssistant, content: event.text, isStreaming: false }
                  ]
                }
              }
              return session
            }

            case 'tool_start':
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'tool' as const,
                    content: `Running ${event.toolName}...`,
                    timestamp: Date.now(),
                    toolName: event.toolName,
                    toolUseId: event.toolUseId,
                    toolInput: event.toolInput
                  }
                ]
              }

            case 'tool_result': {
              const toolMsgs = session.messages
              const matchingTool = toolMsgs.find(m => m.toolUseId === event.toolUseId)
              if (matchingTool) {
                return {
                  ...session,
                  messages: toolMsgs.map(m =>
                    m.toolUseId === event.toolUseId
                      ? { ...m, content: event.result, toolResult: event.result }
                      : m
                  )
                }
              }
              const lastTool = toolMsgs.findLast(m => m.toolName === event.toolName && !m.toolResult)
              if (lastTool) {
                return {
                  ...session,
                  messages: toolMsgs.map(m =>
                    m.id === lastTool.id
                      ? { ...m, content: event.result, toolResult: event.result }
                      : m
                  )
                }
              }
              return session
            }

            case 'error':
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'error' as const,
                    content: event.error,
                    timestamp: Date.now()
                  }
                ]
              }

            case 'typed_error':
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'error' as const,
                    content: event.error.title
                      ? `${event.error.title}: ${event.error.message}`
                      : event.error.message,
                    timestamp: Date.now()
                  }
                ]
              }

            case 'status':
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'status' as const,
                    content: event.message,
                    timestamp: Date.now()
                  }
                ]
              }

            case 'complete':
              return { ...session, isProcessing: false }

            default:
              return session
          }
        })
      })
    })

    return cleanup
  }, [])

  const handleCreateSession = useCallback(async (workspaceId: string) => {
    const session = await window.electronAPI.createSession(workspaceId)
    setSessions(prev => [session, ...prev])
  }, [])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.deleteSession(sessionId)
    setSessions(prev => prev.filter(s => s.id !== sessionId))
  }, [])

  const handleSendMessage = useCallback(async (sessionId: string, message: string) => {
    const userMessage: Message = {
      id: generateMessageId(),
      role: 'user',
      content: message,
      timestamp: Date.now()
    }

    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? { ...s, messages: [...s.messages, userMessage], isProcessing: true, lastMessageAt: Date.now() }
        : s
    ))

    try {
      await window.electronAPI.sendMessage(sessionId, message)
    } catch (error) {
      console.error('Failed to send message:', error)
      setSessions(prev => prev.map(s =>
        s.id === sessionId
          ? {
              ...s,
              isProcessing: false,
              messages: [
                ...s.messages,
                {
                  id: generateMessageId(),
                  role: 'error' as const,
                  content: `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  timestamp: Date.now()
                }
              ]
            }
          : s
      ))
    }
  }, [])

  const handleOpenFile = useCallback((path: string) => {
    console.log('Open file:', path)
    // TODO: Integrate file viewer
  }, [])

  const handleOpenUrl = useCallback((url: string) => {
    console.log('Open URL:', url)
    // TODO: Integrate browser view
  }, [])

  return (
    <TooltipProvider>
      <div className="h-full bg-background text-foreground">
        <Mail
          workspaces={workspaces}
          sessions={sessions}
          activeWorkspaceId={activeWorkspaceId}
          defaultLayout={[20, 32, 48]}
          navCollapsedSize={4}
          onSelectWorkspace={setActiveWorkspaceId}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
          onSendMessage={handleSendMessage}
          onOpenFile={handleOpenFile}
          onOpenUrl={handleOpenUrl}
        />
      </div>
    </TooltipProvider>
  )
}
