import type { ElectronAPI, Session, SessionEvent } from '../../shared/types'
import { generateMessageId } from '../../shared/types'
import { mockWorkspaces, mockSessions, mockStreamingResponses } from './dummyData'

// Mutable copy of sessions for the mock
let sessions = [...mockSessions]

// Store event callback for streaming simulation
let eventCallback: ((event: SessionEvent) => void) | null = null

// Track which streaming response to use next (cycles through them)
let responseIndex = 0

/**
 * Simulates streaming text character by character with realistic delays
 */
async function simulateStreaming(
  sessionId: string,
  text: string,
  chunkSize = 3,
  delayMs = 20
): Promise<void> {
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize)
    eventCallback?.({ type: 'text_delta', sessionId, delta: chunk })
    await sleep(delayMs)
  }
  eventCallback?.({ type: 'text_complete', sessionId, text })
}

/**
 * Simulates a tool call with start and result events
 */
async function simulateToolCall(
  sessionId: string,
  toolName: string,
  toolInput: unknown,
  toolResult: string
): Promise<void> {
  const toolUseId = `tool-${Date.now()}`

  eventCallback?.({
    type: 'tool_start',
    sessionId,
    toolName,
    toolUseId,
    toolInput,
  })

  // Simulate tool execution time
  await sleep(800)

  eventCallback?.({
    type: 'tool_result',
    sessionId,
    toolUseId,
    toolName,
    result: toolResult,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const mockElectronAPI: ElectronAPI = {
  // ===== Session Management =====

  async getSessions(): Promise<Session[]> {
    await sleep(100) // Simulate network delay
    return [...sessions].sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  },

  async createSession(workspaceId: string): Promise<Session> {
    await sleep(150)

    const workspace = mockWorkspaces.find(w => w.id === workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    const newSession: Session = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      lastMessageAt: Date.now(),
      messages: [],
      isProcessing: false,
    }

    sessions = [newSession, ...sessions]
    return newSession
  },

  async deleteSession(sessionId: string): Promise<void> {
    await sleep(100)
    sessions = sessions.filter(s => s.id !== sessionId)
  },

  async sendMessage(sessionId: string, message: string): Promise<void> {
    // This returns immediately - results stream via events
    const session = sessions.find(s => s.id === sessionId)
    if (!session) {
      eventCallback?.({ type: 'error', sessionId, error: 'Session not found' })
      return
    }

    // Get next mock response (cycles through available responses)
    const mockResponse = mockStreamingResponses[responseIndex % mockStreamingResponses.length]
    responseIndex++

    // Start async streaming (don't await - returns immediately like real IPC)
    ;(async () => {
      try {
        // Small delay before starting
        await sleep(300)

        // Optionally simulate a tool call first
        if (mockResponse.includeToolCall && mockResponse.toolName) {
          await simulateToolCall(
            sessionId,
            mockResponse.toolName,
            mockResponse.toolInput,
            mockResponse.toolResult || 'Success'
          )
          await sleep(200)
        }

        // Stream the response text
        await simulateStreaming(sessionId, mockResponse.text)

        // Mark complete
        eventCallback?.({ type: 'complete', sessionId })
      } catch (error) {
        eventCallback?.({
          type: 'error',
          sessionId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        eventCallback?.({ type: 'complete', sessionId })
      }
    })()
  },

  async cancelProcessing(sessionId: string): Promise<void> {
    // In a real implementation, this would abort the stream
    // For mock, we just send complete
    eventCallback?.({ type: 'complete', sessionId })
  },

  // ===== Workspace Management =====

  async getWorkspaces() {
    await sleep(100)
    return [...mockWorkspaces]
  },

  // ===== Event Listener =====

  onSessionEvent(callback: (event: SessionEvent) => void): () => void {
    eventCallback = callback

    // Return cleanup function
    return () => {
      eventCallback = null
    }
  },

  // ===== File Operations =====

  async readFile(path: string): Promise<string> {
    await sleep(200)

    // Return mock markdown content
    return `# Mock File Content

**Path:** \`${path}\`

This is placeholder content for the file viewer. In browser development mode, actual file reading is not available.

## Sample Content

- Item one
- Item two
- Item three

\`\`\`typescript
const example = "code block";
console.log(example);
\`\`\`

> This is a blockquote to test markdown rendering.
`
  },

  // ===== System =====

  getVersions() {
    return {
      node: '20.0.0',
      chrome: '120.0.0',
      electron: 'browser-mock',
    }
  },
}
