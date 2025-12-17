import React, { useState, useEffect, useCallback } from 'react'
import type { Session, Workspace, SessionEvent, Message, SubAgentMetadata, FileAttachment, StoredAttachment } from '../shared/types'
import { generateMessageId } from '../shared/types'
import { Chat } from '@/components/chat/Chat'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FocusProvider } from '@/context/FocusContext'
import { useGlobalShortcuts } from '@/hooks/keyboard'
import { KeyboardShortcutsDialog } from '@/components/KeyboardShortcutsDialog'
import { DEFAULT_MODEL } from '@config/models'

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [agents, setAgents] = useState<SubAgentMetadata[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [currentModel, setCurrentModel] = useState(DEFAULT_MODEL)
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false)

  // Global shortcut: Cmd+/ to show keyboard shortcuts
  useGlobalShortcuts({
    shortcuts: [
      {
        key: '/',
        cmd: true,
        action: () => setShortcutsDialogOpen(true),
      },
    ],
    disabled: shortcutsDialogOpen,
  })

  // Load workspaces and sessions on mount
  useEffect(() => {
    window.electronAPI.getWorkspaces().then((ws) => {
      setWorkspaces(ws)
      // Set first workspace as active if none selected
      setActiveWorkspaceId(current => {
        if (!current && ws.length > 0) {
          return ws[0].id
        }
        return current
      })
    })
    window.electronAPI.getSessions().then(setSessions)
  }, [])

  // Load agents when workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      window.electronAPI.getAgents(activeWorkspaceId).then(setAgents)
    } else {
      setAgents([])
    }
  }, [activeWorkspaceId])

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

            case 'title_generated':
              return { ...session, name: event.title }

            default:
              return session
          }
        })
      })
    })

    return cleanup
  }, [])

  const handleCreateSession = useCallback(async (workspaceId: string, agentId?: string) => {
    // Find agent name if agent is provided
    const agent = agentId ? agents.find(a => a.id === agentId) : undefined
    const agentName = agent?.name
    // Pass agentName to main process so it's stored in the session
    const session = await window.electronAPI.createSession(workspaceId, agentId, agentName)
    setSessions(prev => [session, ...prev])
  }, [agents])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.deleteSession(sessionId)
    setSessions(prev => prev.filter(s => s.id !== sessionId))
  }, [])

  const handleArchiveSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.archiveSession(sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isArchived: true } : s
    ))
  }, [])

  const handleUnarchiveSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.unarchiveSession(sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isArchived: false } : s
    ))
  }, [])

  const handleRenameSession = useCallback(async (sessionId: string, name: string) => {
    await window.electronAPI.renameSession(sessionId, name)
    // The title_generated event will update the state
  }, [])

  const handleSendMessage = useCallback(async (sessionId: string, message: string, attachments?: FileAttachment[]) => {
    try {
      // Step 1: Store attachments and get persistent metadata
      let storedAttachments: StoredAttachment[] | undefined
      let processedAttachments: FileAttachment[] | undefined

      if (attachments?.length) {
        // Store each attachment to disk (generates thumbnails, converts Office→markdown)
        // Use allSettled so one failure doesn't kill all attachments
        const storeResults = await Promise.allSettled(
          attachments.map(a => window.electronAPI.storeAttachment(sessionId, a))
        )

        // Filter successful stores, warn about failures
        storedAttachments = []
        const successfulAttachments: FileAttachment[] = []
        storeResults.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            storedAttachments!.push(result.value)
            successfulAttachments.push(attachments[i])
          } else {
            console.warn(`Failed to store attachment "${attachments[i].name}":`, result.reason)
          }
        })

        // Notify user about failed attachments
        const failedCount = storeResults.filter(r => r.status === 'rejected').length
        if (failedCount > 0) {
          console.warn(`${failedCount} attachment(s) failed to store`)
          // Add warning message to session so user knows some attachments weren't included
          const failedNames = attachments
            .filter((_, i) => storeResults[i].status === 'rejected')
            .map(a => a.name)
            .join(', ')
          setSessions(prev => prev.map(s =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: [...s.messages, {
                    id: generateMessageId(),
                    role: 'warning' as const,
                    content: `⚠️ ${failedCount} attachment(s) could not be stored and will not be sent: ${failedNames}`,
                    timestamp: Date.now()
                  }]
                }
              : s
          ))
        }

        // Step 2: Create processed attachments for Claude
        // - Office files: Convert to text with markdown content
        // - Others: Use original FileAttachment
        processedAttachments = await Promise.all(
          successfulAttachments.map(async (att, i) => {
            const stored = storedAttachments?.[i]
            if (!stored) {
              console.error(`Missing stored attachment at index ${i}`)
              return att // Fall back to original
            }
            if (att.type === 'office' && stored.markdownPath) {
              // Read the converted markdown and send as text
              const markdown = await window.electronAPI.readFile(stored.markdownPath)
              return {
                ...att,
                type: 'text' as const,
                text: markdown,
                base64: undefined, // Don't send binary
              }
            }
            return att
          })
        )
      }

      // Step 3: Create user message with StoredAttachments (for UI display)
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: storedAttachments,
      }

      setSessions(prev => prev.map(s =>
        s.id === sessionId
          ? { ...s, messages: [...s.messages, userMessage], isProcessing: true, lastMessageAt: Date.now() }
          : s
      ))

      // Step 4: Send to Claude with processed attachments
      await window.electronAPI.sendMessage(sessionId, message, processedAttachments)
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

  const handleRefreshAgents = useCallback(async () => {
    if (activeWorkspaceId) {
      const refreshedAgents = await window.electronAPI.refreshAgents(activeWorkspaceId)
      setAgents(refreshedAgents)
    }
  }, [activeWorkspaceId])

  const handleOpenFile = useCallback(async (path: string) => {
    try {
      await window.electronAPI.openFile(path)
    } catch (error) {
      console.error('Failed to open file:', error)
    }
  }, [])

  const handleOpenUrl = useCallback(async (url: string) => {
    try {
      await window.electronAPI.openUrl(url)
    } catch (error) {
      console.error('Failed to open URL:', error)
    }
  }, [])

  const handleOpenSettings = useCallback(() => {
    console.log('Open settings')
    // TODO: Implement settings panel
  }, [])

  const handleOpenKeyboardShortcuts = useCallback(() => {
    setShortcutsDialogOpen(true)
  }, [])

  return (
    <FocusProvider>
      <TooltipProvider>
        <div className="h-full text-foreground">
          <Chat
            workspaces={workspaces}
            sessions={sessions}
            agents={agents}
            activeWorkspaceId={activeWorkspaceId}
            defaultLayout={[20, 32, 48]}
            currentModel={currentModel}
            onModelChange={setCurrentModel}
            onSelectWorkspace={setActiveWorkspaceId}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            onArchiveSession={handleArchiveSession}
            onUnarchiveSession={handleUnarchiveSession}
            onRenameSession={handleRenameSession}
            onSendMessage={handleSendMessage}
            onOpenFile={handleOpenFile}
            onOpenUrl={handleOpenUrl}
            onOpenSettings={handleOpenSettings}
            onOpenKeyboardShortcuts={handleOpenKeyboardShortcuts}
            onRefreshAgents={handleRefreshAgents}
          />
        </div>
        <KeyboardShortcutsDialog
          open={shortcutsDialogOpen}
          onOpenChange={setShortcutsDialogOpen}
        />
      </TooltipProvider>
    </FocusProvider>
  )
}
