import type { ComponentEntry } from './types'
import { useState, useEffect, type ReactNode } from 'react'
import { TurnCard, type ActivityItem, type ResponseContent, type TodoItem } from '@/components/chat/TurnCard'

/** Wrapper with padding for playground preview */
function PaddedWrapper({ children }: { children: ReactNode }) {
  return <div className="p-8">{children}</div>
}

// ============================================================================
// Streaming Simulation Components
// ============================================================================

const streamingTextSample = `I've analyzed the authentication system and here's what I found:

## Authentication Architecture

The authentication system is built around three main components:

### 1. AuthHandler (\`src/auth/index.ts\`)
- Manages the OAuth 2.0 flow
- Handles token validation and refresh
- Provides session management

\`\`\`typescript
export class AuthHandler {
  async authenticate(credentials: Credentials): Promise<Session> {
    const token = await this.oauth.getToken(credentials);
    return this.createSession(token);
  }
}
\`\`\`

### 2. TokenManager
- Stores tokens securely using encryption
- Handles automatic token refresh before expiry

### 3. SessionStore
- Maintains active user sessions
- Handles session timeout and cleanup

Would you like me to implement any improvements?`

/**
 * Realistic streaming simulation with:
 * - Fast character streaming (simulates real LLM token rate)
 * - Component batching accumulates into word-sized chunks
 * - Pauses at punctuation for natural rhythm
 */
function useStreamingSimulation(
  fullText: string,
  speed: 'slow' | 'normal' | 'fast' = 'normal',
) {
  const [streamedText, setStreamedText] = useState('')
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    setStreamedText('')
    setIsComplete(false)
    let index = 0
    let timeoutId: ReturnType<typeof setTimeout>

    // Speed configs: chars per tick, base interval
    // Fast intervals let component batching accumulate words
    const speedConfig = {
      slow: { charsPerTick: 1, baseInterval: 20, punctuationDelay: 300 },
      normal: { charsPerTick: 2, baseInterval: 10, punctuationDelay: 150 },
      fast: { charsPerTick: 4, baseInterval: 5, punctuationDelay: 50 },
    }
    const config = speedConfig[speed]

    function tick() {
      if (index >= fullText.length) {
        setIsComplete(true)
        return
      }

      const currentChar = fullText[index]
      const isPunctuation = /[.!?,;:\n]/.test(currentChar)

      // Send chars
      index = Math.min(index + config.charsPerTick, fullText.length)
      setStreamedText(fullText.slice(0, index))

      // Pause at punctuation for natural rhythm
      const nextInterval = isPunctuation
        ? config.punctuationDelay
        : config.baseInterval

      timeoutId = setTimeout(tick, nextInterval)
    }

    // Start with small delay
    timeoutId = setTimeout(tick, 100)

    return () => clearTimeout(timeoutId)
  }, [fullText, speed])

  return { streamedText, isComplete }
}

/** TurnCard wrapper that simulates streaming response */
function StreamingSimulationTurnCard({
  activities,
  intent,
  simulationSpeed = 'normal',
}: {
  activities: ActivityItem[]
  intent?: string
  simulationSpeed?: 'slow' | 'normal' | 'fast'
}) {
  const { streamedText, isComplete } = useStreamingSimulation(
    streamingTextSample,
    simulationSpeed,
  )

  const response: ResponseContent = {
    text: streamedText,
    isStreaming: !isComplete,
  }

  return (
    <TurnCard
      sessionId="playground-session"
      turnId="playground-turn"
      activities={activities}
      response={response}
      intent={intent}
      isStreaming={!isComplete}
      isComplete={isComplete}
      onOpenFile={(path) => console.log('[Playground] Open file:', path)}
      onOpenUrl={(url) => console.log('[Playground] Open URL:', url)}
    />
  )
}

// ============================================================================
// Sample Data
// ============================================================================

const now = Date.now()

// Completed tool activities
const completedGrepActivity: ActivityItem = {
  id: 'tool-1',
  type: 'tool',
  status: 'completed',
  toolName: 'Grep',
  toolInput: { pattern: 'AuthHandler', path: 'src/' },
  intent: 'Searching for authentication handlers',
  timestamp: now - 5000,
}

const completedReadActivity1: ActivityItem = {
  id: 'tool-2',
  type: 'tool',
  status: 'completed',
  toolName: 'Read',
  toolInput: { file_path: '/src/auth/index.ts' },
  timestamp: now - 4000,
}

const completedReadActivity2: ActivityItem = {
  id: 'tool-3',
  type: 'tool',
  status: 'completed',
  toolName: 'Read',
  toolInput: { file_path: '/src/auth/oauth.ts' },
  timestamp: now - 3000,
}

const completedBashActivity: ActivityItem = {
  id: 'tool-4',
  type: 'tool',
  status: 'completed',
  toolName: 'Bash',
  toolInput: { command: 'npm test', description: 'Running tests' },
  intent: 'Running the test suite',
  timestamp: now - 2000,
}

// Running tool activities
const runningGrepActivity: ActivityItem = {
  id: 'tool-running-1',
  type: 'tool',
  status: 'running',
  toolName: 'Grep',
  toolInput: { pattern: 'handleError', path: 'src/' },
  intent: 'Finding error handling patterns',
  timestamp: now - 1000,
}

const runningReadActivity: ActivityItem = {
  id: 'tool-running-2',
  type: 'tool',
  status: 'running',
  toolName: 'Read',
  toolInput: { file_path: '/src/lib/errors.ts' },
  timestamp: now - 500,
}

// Error activity
const errorActivity: ActivityItem = {
  id: 'tool-error-1',
  type: 'tool',
  status: 'error',
  toolName: 'Bash',
  toolInput: { command: 'npm run deploy' },
  error: 'Permission denied',
  timestamp: now - 1000,
}

// Pending activities
const pendingActivity: ActivityItem = {
  id: 'tool-pending-1',
  type: 'tool',
  status: 'pending',
  toolName: 'Write',
  toolInput: { file_path: '/src/auth/new-handler.ts' },
  timestamp: now,
}

// Intermediate messages (LLM commentary between tool calls)
const intermediateMessage1: ActivityItem = {
  id: 'intermediate-1',
  type: 'intermediate',
  status: 'completed',
  content: "Let me search for the authentication handlers in your codebase...",
  timestamp: now - 6000,
}

const intermediateMessage2: ActivityItem = {
  id: 'intermediate-2',
  type: 'intermediate',
  status: 'completed',
  content: "Found some matches. Now let me read the main auth file to understand the implementation.",
  timestamp: now - 3500,
}

const intermediateMessage3: ActivityItem = {
  id: 'intermediate-3',
  type: 'intermediate',
  status: 'completed',
  content: "I see this uses OAuth 2.0. Let me also check how tokens are managed.",
  timestamp: now - 2500,
}

const intermediateMessageRunning: ActivityItem = {
  id: 'intermediate-running',
  type: 'intermediate',
  status: 'completed',
  content: "Let me run the tests to make sure everything works correctly...",
  timestamp: now - 1500,
}

const intermediateMessageStreaming: ActivityItem = {
  id: 'intermediate-streaming',
  type: 'intermediate',
  status: 'running',  // Still streaming - will show "Thinking..."
  content: "",  // Content not shown while streaming
  timestamp: now,
}

// Sample responses
const shortResponse: ResponseContent = {
  text: "I found the authentication handlers in `src/auth/`. The main handler is `AuthHandler` which manages OAuth flows and token validation.",
  isStreaming: false,
}

const longResponse: ResponseContent = {
  text: `I've analyzed the authentication system and here's what I found:

## Authentication Architecture

The authentication system is built around three main components:

### 1. AuthHandler (\`src/auth/index.ts\`)
- Manages the OAuth 2.0 flow
- Handles token validation and refresh
- Provides session management

\`\`\`typescript
export class AuthHandler {
  async authenticate(credentials: Credentials): Promise<Session> {
    // OAuth flow implementation
    const token = await this.oauth.getToken(credentials);
    return this.createSession(token);
  }
}
\`\`\`

### 2. TokenManager (\`src/auth/tokens.ts\`)
- Stores tokens securely using encryption
- Handles automatic token refresh before expiry
- Provides token revocation

### 3. SessionStore (\`src/auth/sessions.ts\`)
- Maintains active user sessions
- Handles session timeout and cleanup
- Provides session restoration on app restart

## Recommendations

1. **Add refresh token rotation** - Currently tokens are reused until expiry
2. **Implement PKCE** - For better security in public clients
3. **Add audit logging** - Track authentication events for security monitoring

Would you like me to implement any of these improvements?`,
  isStreaming: false,
}

const streamingResponse: ResponseContent = {
  text: "I'm analyzing the codebase and looking for",
  isStreaming: true,
  streamStartTime: now - 500,
}

const emptyStreamingResponse: ResponseContent = {
  text: '',
  isStreaming: true,
  streamStartTime: now,
}

// ============================================================================
// Helper: Generate many activities for stress testing
// ============================================================================

/** Tool names and file paths for realistic variety */
const toolVariety = [
  { tool: 'Read', getInput: (i: number) => ({ file_path: `/src/components/feature-${i}.tsx` }) },
  { tool: 'Grep', getInput: (i: number) => ({ pattern: `pattern${i}`, path: 'src/' }) },
  { tool: 'Glob', getInput: (i: number) => ({ pattern: `**/*${i}*.ts` }) },
  { tool: 'Bash', getInput: (i: number) => ({ command: `npm test -- file${i}` }) },
  { tool: 'Write', getInput: (i: number) => ({ file_path: `/src/utils/helper-${i}.ts` }) },
  { tool: 'Edit', getInput: (i: number) => ({ file_path: `/src/lib/module-${i}.ts` }) },
]

const commentaryVariety = [
  "Let me check this file for relevant code...",
  "I found some interesting patterns here.",
  "This looks like what we need.",
  "Searching for related implementations...",
  "Found a match, examining the details.",
  "This module handles the core logic.",
  "Let me verify this works correctly.",
  "Checking for any edge cases...",
]

/**
 * Generate a realistic sequence of activities with mixed tools and commentary.
 * Alternates between tool calls and intermediate messages for realism.
 */
function generateManyActivities(count: number): ActivityItem[] {
  const activities: ActivityItem[] = []
  let timestamp = now - (count * 100)

  for (let i = 0; i < count; i++) {
    // Every 3rd item is an intermediate message
    if (i % 3 === 0 && i > 0) {
      activities.push({
        id: `intermediate-${i}`,
        type: 'intermediate',
        status: 'completed',
        content: commentaryVariety[i % commentaryVariety.length],
        timestamp: timestamp,
      })
    } else {
      const toolInfo = toolVariety[i % toolVariety.length]
      activities.push({
        id: `tool-${i}`,
        type: 'tool',
        status: 'completed',
        toolName: toolInfo.tool,
        toolInput: toolInfo.getInput(i),
        timestamp: timestamp,
      })
    }
    timestamp += 100
  }

  return activities
}

/** Pre-generated 75 activities for playground */
const manyActivities75 = generateManyActivities(75)

// ============================================================================
// Sample Todos (for TodoWrite visualization)
// ============================================================================

/** Empty state - no todos */
const todosEmpty: TodoItem[] = []

/** All pending - just started planning */
const todosAllPending: TodoItem[] = [
  { content: 'Analyze authentication system', status: 'pending', activeForm: 'Analyzing authentication system' },
  { content: 'Implement token refresh logic', status: 'pending', activeForm: 'Implementing token refresh' },
  { content: 'Add unit tests for auth flow', status: 'pending', activeForm: 'Adding unit tests' },
  { content: 'Update API documentation', status: 'pending', activeForm: 'Updating documentation' },
]

/** In progress - currently working */
const todosInProgress: TodoItem[] = [
  { content: 'Analyze authentication system', status: 'completed', activeForm: 'Analyzing authentication system' },
  { content: 'Implement token refresh logic', status: 'in_progress', activeForm: 'Implementing token refresh' },
  { content: 'Add unit tests for auth flow', status: 'pending', activeForm: 'Adding unit tests' },
  { content: 'Update API documentation', status: 'pending', activeForm: 'Updating documentation' },
]

/** Mixed progress */
const todosMixed: TodoItem[] = [
  { content: 'Fix critical security bug', status: 'completed', activeForm: 'Fixing security bug' },
  { content: 'Implement OAuth 2.0 flow', status: 'in_progress', activeForm: 'Implementing OAuth flow' },
  { content: 'Add session timeout handling', status: 'pending', activeForm: 'Adding timeout handling' },
  { content: 'Improve error messages', status: 'pending', activeForm: 'Improving error messages' },
  { content: 'Add telemetry events', status: 'pending', activeForm: 'Adding telemetry' },
]

/** Almost done - 1 remaining */
const todosAlmostDone: TodoItem[] = [
  { content: 'Research authentication patterns', status: 'completed', activeForm: 'Researching patterns' },
  { content: 'Implement token validation', status: 'completed', activeForm: 'Implementing validation' },
  { content: 'Add refresh token rotation', status: 'completed', activeForm: 'Adding token rotation' },
  { content: 'Run test suite and verify', status: 'in_progress', activeForm: 'Running tests' },
]

/** All completed - task done */
const todosAllCompleted: TodoItem[] = [
  { content: 'Analyze current implementation', status: 'completed', activeForm: 'Analyzing implementation' },
  { content: 'Implement improvements', status: 'completed', activeForm: 'Implementing improvements' },
  { content: 'Add comprehensive tests', status: 'completed', activeForm: 'Adding tests' },
  { content: 'Update documentation', status: 'completed', activeForm: 'Updating docs' },
]

/** Long task list (stress test) */
const todosLong: TodoItem[] = [
  { content: 'Set up project structure', status: 'completed', activeForm: 'Setting up project' },
  { content: 'Configure build system', status: 'completed', activeForm: 'Configuring build' },
  { content: 'Install dependencies', status: 'completed', activeForm: 'Installing deps' },
  { content: 'Create database schema', status: 'completed', activeForm: 'Creating schema' },
  { content: 'Implement user model', status: 'completed', activeForm: 'Implementing model' },
  { content: 'Add authentication middleware', status: 'in_progress', activeForm: 'Adding auth middleware' },
  { content: 'Create API endpoints', status: 'pending', activeForm: 'Creating endpoints' },
  { content: 'Add input validation', status: 'pending', activeForm: 'Adding validation' },
  { content: 'Implement error handling', status: 'pending', activeForm: 'Implementing errors' },
  { content: 'Add rate limiting', status: 'pending', activeForm: 'Adding rate limits' },
  { content: 'Set up logging', status: 'pending', activeForm: 'Setting up logging' },
  { content: 'Write unit tests', status: 'pending', activeForm: 'Writing tests' },
]

// ============================================================================
// Component Entry
// ============================================================================

export const turnCardComponents: ComponentEntry[] = [
  {
    id: 'turn-card',
    name: 'TurnCard',
    category: 'Turn Cards',
    description: 'Email-like batched display for one assistant turn with activities and response',
    component: TurnCard,
    wrapper: PaddedWrapper,
    layout: 'top',
    props: [
      {
        name: 'isStreaming',
        description: 'Whether content is still being received',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'isComplete',
        description: 'Whether this turn is fully complete',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'defaultExpanded',
        description: 'Start with activities expanded',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'intent',
        description: 'Primary intent/goal for preview text',
        control: { type: 'string', placeholder: 'e.g., Searching for auth handlers...' },
        defaultValue: '',
      },
    ],
    variants: [
      // Initial / Empty state
      {
        name: 'Initial (Starting)',
        description: 'No activities yet, just starting',
        props: {
          activities: [],
          response: undefined,
          isStreaming: true,
          isComplete: false,
        },
      },
      // Single tool running
      {
        name: 'Single Tool Running',
        description: 'One tool currently executing',
        props: {
          activities: [runningGrepActivity],
          response: undefined,
          isStreaming: true,
          isComplete: false,
          intent: 'Finding error handling patterns',
        },
      },
      // Multiple tools running
      {
        name: 'Multiple Tools Running',
        description: 'Several tools executing in parallel',
        props: {
          activities: [
            { ...completedGrepActivity, status: 'completed' },
            runningReadActivity,
            pendingActivity,
          ],
          response: undefined,
          isStreaming: true,
          isComplete: false,
        },
      },
      // All tools completed (collapsed)
      {
        name: 'Tools Completed (Collapsed)',
        description: 'Multiple tools finished, collapsed by default',
        props: {
          activities: [
            completedGrepActivity,
            completedReadActivity1,
            completedReadActivity2,
          ],
          response: undefined,
          isStreaming: false,
          isComplete: false,
        },
      },
      // Tools completed, now streaming response
      {
        name: 'Streaming Response',
        description: 'Tools done, response is streaming',
        props: {
          activities: [
            completedGrepActivity,
            completedReadActivity1,
          ],
          response: streamingResponse,
          isStreaming: true,
          isComplete: false,
        },
      },
      // Waiting for response (empty streaming)
      {
        name: 'Waiting for Response',
        description: 'Tools done, waiting for response to start',
        props: {
          activities: [
            completedGrepActivity,
            completedReadActivity1,
          ],
          response: emptyStreamingResponse,
          isStreaming: true,
          isComplete: false,
        },
      },
      // Complete turn with short response
      {
        name: 'Complete (Short)',
        description: 'Finished turn with brief response',
        props: {
          activities: [
            completedGrepActivity,
            completedReadActivity1,
            completedReadActivity2,
          ],
          response: shortResponse,
          isStreaming: false,
          isComplete: true,
        },
      },
      // Complete turn with long response
      {
        name: 'Complete (Long)',
        description: 'Finished turn with detailed response',
        props: {
          activities: [
            completedGrepActivity,
            completedReadActivity1,
            completedReadActivity2,
            completedBashActivity,
          ],
          response: longResponse,
          isStreaming: false,
          isComplete: true,
          intent: 'Analyzing authentication system',
        },
      },
      // Error state
      {
        name: 'Error State',
        description: 'A tool failed during execution',
        props: {
          activities: [
            completedGrepActivity,
            completedReadActivity1,
            errorActivity,
          ],
          response: undefined,
          isStreaming: false,
          isComplete: false,
          defaultExpanded: true,
        },
      },
      // Response only (no tools)
      {
        name: 'Response Only',
        description: 'Direct response without tool usage',
        props: {
          activities: [],
          response: shortResponse,
          isStreaming: false,
          isComplete: true,
        },
      },
      // Many tools
      {
        name: 'Many Tools (5+)',
        description: 'Large number of completed tools',
        props: {
          activities: [
            completedGrepActivity,
            completedReadActivity1,
            completedReadActivity2,
            completedBashActivity,
            { ...completedReadActivity1, id: 'tool-5', toolInput: { file_path: '/src/config.ts' } },
            { ...completedReadActivity1, id: 'tool-6', toolInput: { file_path: '/src/utils.ts' } },
          ],
          response: shortResponse,
          isStreaming: false,
          isComplete: true,
        },
      },
      // Extreme: 75 steps (real-world stress test)
      {
        name: 'Extreme: 75 Steps',
        description: 'Stress test with 75 activities - tests scrolling, animation limits, and performance',
        props: {
          activities: manyActivities75,
          response: longResponse,
          isStreaming: false,
          isComplete: true,
          defaultExpanded: true,
          intent: 'Comprehensive codebase analysis',
        },
      },
      // Expanded by default
      {
        name: 'Expanded (Default)',
        description: 'Activities shown expanded initially',
        props: {
          activities: [
            completedGrepActivity,
            completedReadActivity1,
            completedReadActivity2,
          ],
          response: shortResponse,
          isStreaming: false,
          isComplete: true,
          defaultExpanded: true,
        },
      },
      // Mixed: Tools with intermediate messages (completed)
      {
        name: 'Mixed: Tools + Commentary',
        description: 'Tools interleaved with LLM intermediate messages',
        props: {
          activities: [
            intermediateMessage1,
            completedGrepActivity,
            intermediateMessage2,
            completedReadActivity1,
            intermediateMessage3,
            completedReadActivity2,
          ],
          response: shortResponse,
          isStreaming: false,
          isComplete: true,
          defaultExpanded: true,
        },
      },
      // Mixed: In progress with commentary
      {
        name: 'Mixed: In Progress',
        description: 'Tool running after intermediate message',
        props: {
          activities: [
            intermediateMessage1,
            completedGrepActivity,
            intermediateMessage2,
            completedReadActivity1,
            intermediateMessageRunning,
            runningReadActivity,
          ],
          response: undefined,
          isStreaming: true,
          isComplete: false,
        },
      },
      // Mixed: Many steps
      {
        name: 'Mixed: Long Chain',
        description: 'Extended conversation with multiple tool/message pairs',
        props: {
          activities: [
            intermediateMessage1,
            completedGrepActivity,
            intermediateMessage2,
            completedReadActivity1,
            intermediateMessage3,
            completedReadActivity2,
            intermediateMessageRunning,
            completedBashActivity,
          ],
          response: longResponse,
          isStreaming: false,
          isComplete: true,
          defaultExpanded: true,
        },
      },
      // Mixed: Commentary only (no tools yet)
      {
        name: 'Mixed: Thinking Start',
        description: 'LLM thinking before first tool call',
        props: {
          activities: [
            intermediateMessage1,
          ],
          response: undefined,
          isStreaming: true,
          isComplete: false,
        },
      },
      // Mixed: Currently thinking (streaming intermediate)
      {
        name: 'Mixed: Currently Thinking',
        description: 'LLM is streaming an intermediate message',
        props: {
          activities: [
            intermediateMessage1,
            completedGrepActivity,
            intermediateMessage2,
            completedReadActivity1,
            intermediateMessageStreaming,
          ],
          response: undefined,
          isStreaming: true,
          isComplete: false,
          defaultExpanded: true,
        },
      },
      // ========== TodoWrite Variants ==========
      // Todo: Just started (all pending)
      {
        name: 'Todo: Just Started',
        description: 'TodoWrite with all items pending - just created the plan',
        props: {
          activities: [completedGrepActivity],
          response: undefined,
          isStreaming: false,
          isComplete: false,
          defaultExpanded: true,
          todos: todosAllPending,
        },
      },
      // Todo: In progress
      {
        name: 'Todo: In Progress',
        description: 'TodoWrite with one item in progress',
        props: {
          activities: [completedGrepActivity, completedReadActivity1],
          response: undefined,
          isStreaming: true,
          isComplete: false,
          defaultExpanded: true,
          todos: todosInProgress,
        },
      },
      // Todo: Mixed progress
      {
        name: 'Todo: Mixed Progress',
        description: 'TodoWrite with mixed completed/in_progress/pending items',
        props: {
          activities: [completedGrepActivity, completedReadActivity1, completedBashActivity],
          response: shortResponse,
          isStreaming: false,
          isComplete: true,
          defaultExpanded: true,
          todos: todosMixed,
        },
      },
      // Todo: Almost done
      {
        name: 'Todo: Almost Done',
        description: 'TodoWrite with most items completed, one in progress',
        props: {
          activities: [completedGrepActivity, completedReadActivity1],
          response: undefined,
          isStreaming: true,
          isComplete: false,
          defaultExpanded: true,
          todos: todosAlmostDone,
        },
      },
      // Todo: All completed
      {
        name: 'Todo: All Completed',
        description: 'TodoWrite with all items done - task complete',
        props: {
          activities: [completedGrepActivity, completedReadActivity1, completedBashActivity],
          response: longResponse,
          isStreaming: false,
          isComplete: true,
          defaultExpanded: true,
          todos: todosAllCompleted,
        },
      },
      // Todo: Long list (stress test)
      {
        name: 'Todo: Long List (12 items)',
        description: 'TodoWrite stress test with many items',
        props: {
          activities: [completedGrepActivity, completedReadActivity1],
          response: shortResponse,
          isStreaming: false,
          isComplete: true,
          defaultExpanded: true,
          todos: todosLong,
        },
      },
      // Todo: Only (no activities/response)
      {
        name: 'Todo: Standalone',
        description: 'TodoWrite without activities or response - planning phase only',
        props: {
          activities: [],
          response: undefined,
          isStreaming: false,
          isComplete: false,
          defaultExpanded: true,
          todos: todosMixed,
        },
      },
    ],
    mockData: () => ({
      activities: [
        completedGrepActivity,
        completedReadActivity1,
        completedReadActivity2,
      ],
      response: shortResponse,
      onOpenFile: (path: string) => console.log('[Playground] Open file:', path),
      onOpenUrl: (url: string) => console.log('[Playground] Open URL:', url),
    }),
  },
  // Streaming Simulation - Live demo of streaming response
  {
    id: 'turn-card-streaming-sim',
    name: 'TurnCard (Streaming Sim)',
    category: 'Turn Cards',
    description: 'Live simulation of document-style streaming preview with batched fade-in updates',
    component: StreamingSimulationTurnCard,
    wrapper: PaddedWrapper,
    layout: 'top',
    props: [
      {
        name: 'simulationSpeed',
        description: 'How fast to simulate streaming',
        control: {
          type: 'select',
          options: [
            { label: 'Slow', value: 'slow' },
            { label: 'Normal', value: 'normal' },
            { label: 'Fast', value: 'fast' },
          ],
        },
        defaultValue: 'normal',
      },
      {
        name: 'intent',
        description: 'Intent text shown in header',
        control: { type: 'string', placeholder: 'e.g., Analyzing auth system...' },
        defaultValue: 'Analyzing the authentication system',
      },
    ],
    variants: [
      {
        name: 'Response Only (Slow)',
        description: 'Document preview with gradient and toggle - slow to observe cross-fade',
        props: {
          activities: [],
          simulationSpeed: 'slow',
        },
      },
      {
        name: 'After Tools (Normal)',
        description: 'Shows last few lines in large card with batched updates',
        props: {
          activities: [
            completedGrepActivity,
            completedReadActivity1,
            completedReadActivity2,
          ],
          simulationSpeed: 'normal',
          intent: 'Analyzing authentication handlers',
        },
      },
      {
        name: 'Long Content (Slow)',
        description: 'Best for observing gradient at top and cross-fade effect',
        props: {
          activities: [
            completedGrepActivity,
            completedReadActivity1,
          ],
          simulationSpeed: 'slow',
        },
      },
      {
        name: 'After Mixed (Fast)',
        description: 'Fast streaming after tools + commentary',
        props: {
          activities: [
            intermediateMessage1,
            completedGrepActivity,
            intermediateMessage2,
            completedReadActivity1,
          ],
          simulationSpeed: 'fast',
          intent: 'Searching for patterns',
        },
      },
    ],
    mockData: () => ({
      activities: [
        completedGrepActivity,
        completedReadActivity1,
      ],
    }),
  },
]
