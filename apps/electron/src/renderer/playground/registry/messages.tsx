import * as React from 'react'
import type { ComponentEntry } from './types'
import { TurnCard, type ActivityItem, type ResponseContent, Markdown, CollapsibleMarkdownProvider } from '@craft-agent/ui'
import { Spinner } from '@craft-agent/ui'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Info,
} from 'lucide-react'
import { AnimatedCollapsibleContent } from '@/components/ui/collapsible'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { AuthRequestCard } from '@/components/chat/AuthRequestCard'
import type { Message } from '../../../shared/types'

// ============================================================================
// Message Components - Extracted from ChatDisplay for playground preview
// ============================================================================

/** User message bubble - right aligned with subtle background */
function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[80%] bg-foreground/5 rounded-[16px] px-4 py-1 break-words min-w-0">
        <p className="text-sm">{content}</p>
      </div>
    </div>
  )
}

/** Assistant message bubble - left aligned white card */
function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-start group">
      <div className="relative max-w-[80%] bg-white shadow-minimal rounded-[8px] pl-6 pr-4 py-3 break-words min-w-0">
        <button
          className="absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-foreground/5"
          title="Open in new window"
        >
          <ExternalLink className="w-4 h-4 text-muted-foreground hover:text-foreground" />
        </button>
        <CollapsibleMarkdownProvider>
          <Markdown
            mode="minimal"
            className="text-sm"
            collapsible
          >
            {content}
          </Markdown>
        </CollapsibleMarkdownProvider>
      </div>
    </div>
  )
}

/** Error message bubble - red themed with collapsible details */
interface ErrorMessageProps {
  content: string
  errorTitle?: string
  errorDetails?: string[]
  errorOriginal?: string
}

function ErrorMessage({ content, errorTitle, errorDetails, errorOriginal }: ErrorMessageProps) {
  const hasDetails = (errorDetails && errorDetails.length > 0) || errorOriginal
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] bg-destructive/10 rounded-[8px] pl-3.5 pr-4 pt-3 pb-3 break-words">
        <div className="text-xs text-destructive/50 mb-0.5 font-semibold">
          {errorTitle || 'Error'}
        </div>
        <p className="text-sm text-destructive">{content}</p>

        {hasDetails && (
          <div className="mt-2">
            <button
              onClick={() => setDetailsOpen(!detailsOpen)}
              className="flex items-center gap-1 text-xs text-destructive/70 hover:text-destructive transition-colors"
            >
              {detailsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span>{detailsOpen ? 'Hide' : 'Show'} technical details</span>
            </button>

            <AnimatedCollapsibleContent isOpen={detailsOpen} className="overflow-hidden">
              <div className="mt-2 pt-2 border-t border-destructive/20 text-xs text-destructive/60 font-mono space-y-0.5">
                {errorDetails?.map((detail, i) => (
                  <div key={i}>{detail}</div>
                ))}
                {errorOriginal && !errorDetails?.some(d => d.includes('Raw error:')) && (
                  <div className="mt-1">Raw: {errorOriginal.slice(0, 200)}{errorOriginal.length > 200 ? '...' : ''}</div>
                )}
              </div>
            </AnimatedCollapsibleContent>
          </div>
        )}
      </div>
    </div>
  )
}

/** Status message - spinner with text, used during compaction etc */
function StatusMessage({ content }: { content: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-[13px] text-muted-foreground">
      <div className="w-3 h-3 flex items-center justify-center shrink-0">
        <Spinner className="text-[10px]" />
      </div>
      <span>{content}</span>
    </div>
  )
}

/** Info message - icon with text, supports different severity levels */
type InfoMessageLevel = 'info' | 'warning' | 'error' | 'success'

interface InfoMessageProps {
  content: string
  level?: InfoMessageLevel
}

const infoMessageConfig: Record<InfoMessageLevel, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'text-muted-foreground' },
  warning: { icon: AlertTriangle, className: 'text-amber-600' },
  error: { icon: CircleAlert, className: 'text-destructive' },
  success: { icon: CheckCircle2, className: 'text-emerald-600' },
}

function InfoMessage({ content, level = 'info' }: InfoMessageProps) {
  const config = infoMessageConfig[level]
  const Icon = config.icon

  return (
    <div className={cn('flex items-center gap-2 px-3 py-1 text-[13px]', config.className)}>
      <div className="w-3 h-3 flex items-center justify-center shrink-0">
        <Icon className="w-3 h-3" />
      </div>
      <span>{content}</span>
    </div>
  )
}

/** Warning message - amber themed bubble */
function WarningMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] bg-amber-500/10 rounded-[8px] pl-3.5 pr-4 pt-3 pb-3 break-words">
        <div className="text-xs text-amber-600/50 dark:text-amber-500/50 mb-0.5 font-semibold">
          Warning
        </div>
        <p className="text-sm text-amber-700 dark:text-amber-400">{content}</p>
      </div>
    </div>
  )
}

/** Processing indicator with cycling messages and elapsed time */
const PROCESSING_MESSAGES = [
  'Thinking…',
  'Pondering…',
  'Contemplating…',
  'Reasoning…',
  'Processing…',
  'Computing…',
  'Considering…',
  'Reflecting…',
  'Deliberating…',
  'Cogitating…',
  'Ruminating…',
  'Musing…',
  'Working on it…',
  'On it…',
  'Crunching…',
  'Brewing…',
  'Connecting dots…',
  'Mulling it over…',
  'Deep in thought…',
  'Hmm…',
  'Let me see…',
  'One moment…',
  'Hold on…',
  'Bear with me…',
  'Just a sec…',
  'Hang tight…',
  'Getting there…',
  'Almost…',
  'Working…',
  'Busy busy…',
  'Whirring…',
  'Churning…',
  'Percolating…',
  'Simmering…',
  'Cooking…',
  'Baking…',
  'Stirring…',
  'Spinning up…',
  'Warming up…',
  'Revving…',
  'Buzzing…',
  'Humming…',
  'Ticking…',
  'Clicking…',
  'Whizzing…',
  'Zooming…',
  'Zipping…',
  'Chugging…',
  'Trucking…',
  'Rolling…',
]

interface ProcessingIndicatorProps {
  /** Animation cycle duration in milliseconds */
  cycleMs?: number
  /** Whether the elapsed counter should count automatically */
  counting?: boolean
  /** Initial elapsed time (only used if counting is false) */
  elapsed?: number
}

function ProcessingIndicator({ cycleMs = 10000, counting = true, elapsed: initialElapsed = 0 }: ProcessingIndicatorProps) {
  const [elapsed, setElapsed] = React.useState(initialElapsed)
  const [messageIndex, setMessageIndex] = React.useState(() =>
    Math.floor(Math.random() * PROCESSING_MESSAGES.length)
  )
  const startTimeRef = React.useRef(Date.now())

  // Update elapsed time every second (only if counting)
  React.useEffect(() => {
    if (!counting) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [counting])

  // Cycle through messages based on cycleMs
  React.useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(prev => {
        // Pick a random different message
        let next = Math.floor(Math.random() * PROCESSING_MESSAGES.length)
        while (next === prev && PROCESSING_MESSAGES.length > 1) {
          next = Math.floor(Math.random() * PROCESSING_MESSAGES.length)
        }
        return next
      })
    }, cycleMs)
    return () => clearInterval(interval)
  }, [cycleMs])

  const currentMessage = PROCESSING_MESSAGES[messageIndex]

  const labelRef = React.useRef<HTMLSpanElement>(null)
  const [labelWidth, setLabelWidth] = React.useState<number | 'auto'>('auto')

  // Measure label width when message changes (not when counter changes)
  React.useLayoutEffect(() => {
    if (labelRef.current) {
      setLabelWidth(labelRef.current.offsetWidth)
    }
  }, [currentMessage])

  return (
    <div className="flex items-center gap-2 px-3 py-1 text-[13px] text-muted-foreground">
      {/* Spinner */}
      <div className="w-3 h-3 flex items-center justify-center shrink-0">
        <Spinner className="text-[10px]" />
      </div>
      {/* Label container */}
      <span className="inline-flex items-center h-5">
        {/* Animated width container - only animates when label changes */}
        <motion.span
          className="relative inline-block h-5"
          animate={{ width: labelWidth }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* True crossfade for label only */}
          <AnimatePresence initial={false}>
            <motion.span
              ref={labelRef}
              key={currentMessage}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-0 top-0 h-5 flex items-center whitespace-nowrap"
            >
              {currentMessage}
            </motion.span>
          </AnimatePresence>
        </motion.span>
        {/* Counter - no animation, just updates instantly */}
        {elapsed >= 1 && (
          <span className="text-muted-foreground/60 ml-1 tabular-nums">
            {elapsed}s
          </span>
        )}
      </span>
    </div>
  )
}

// ============================================================================
// Message Gallery - All message types in one scrollable view
// ============================================================================

function MessageGallery() {
  const now = Date.now()

  // Sample tool activities for TurnCard
  const completedGrepActivity: ActivityItem = {
    id: 'tool-1',
    type: 'tool',
    status: 'completed',
    toolName: 'Grep',
    toolInput: { pattern: 'AuthHandler', path: 'src/' },
    intent: 'Searching for authentication handlers',
    timestamp: now - 5000,
  }

  const completedReadActivity: ActivityItem = {
    id: 'tool-2',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolInput: { file_path: '/src/auth/index.ts' },
    timestamp: now - 4000,
  }

  const runningGrepActivity: ActivityItem = {
    id: 'tool-running-1',
    type: 'tool',
    status: 'running',
    toolName: 'Grep',
    toolInput: { pattern: 'handleError', path: 'src/' },
    intent: 'Finding error handling patterns',
    timestamp: now - 1000,
  }

  const shortResponse: ResponseContent = {
    text: "I found the authentication handlers in `src/auth/`. The main handler is `AuthHandler` which manages OAuth flows and token validation.",
    isStreaming: false,
  }

  const streamingResponse: ResponseContent = {
    text: "I'm analyzing the codebase and looking for patterns that match your query. Let me check a few more files...",
    isStreaming: true,
    streamStartTime: now - 500,
  }

  return (
    <div className="max-w-[960px] mx-auto p-8 space-y-8">
      {/* Section: System Messages */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-foreground/80">System Messages</h2>
        <div className="bg-muted/20 rounded-lg">
          <StatusMessage content="Compacting conversation..." />
          <InfoMessage content="Compacted conversation (was 180000 tokens)" />
          <InfoMessage content="Session restored from 5 minutes ago" />
          <InfoMessage content="Agent activated successfully" level="success" />
          <InfoMessage content="Rate limit approaching" level="warning" />
          <InfoMessage content="Connection lost" level="error" />
        </div>
      </section>

      {/* Section: Processing States */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-foreground/80">Processing States</h2>
        <div className="bg-muted/20 rounded-lg ">
          <ProcessingIndicator />
        </div>
      </section>

      {/* Section: User Messages */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-foreground/80">User Messages</h2>
        <div className="space-y-3">
          <UserMessage content="How do I authenticate with the API?" />
          <UserMessage content="Can you search for all files that contain 'handleError' and show me how they work?" />
        </div>
      </section>

      {/* Section: Assistant Messages */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-foreground/80">Assistant Messages</h2>
        <div className="space-y-3">
          <AssistantMessage content="I found the authentication handlers in `src/auth/`. The main handler is `AuthHandler` which manages OAuth flows and token validation." />
          <AssistantMessage content={`Here's a more detailed response with **markdown** formatting:

1. First, check the \`config.ts\` file
2. Then update the environment variables
3. Finally, restart the server

\`\`\`typescript
const config = {
  apiKey: process.env.API_KEY,
  secret: process.env.SECRET
};
\`\`\`
`} />
        </div>
      </section>

      {/* Section: Warning Messages */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-foreground/80">Warning Messages</h2>
        <div className="space-y-3">
          <WarningMessage content="This operation may take a while for large codebases." />
          <WarningMessage content="The API rate limit is approaching. Consider batching your requests." />
        </div>
      </section>

      {/* Section: Error Messages */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-foreground/80">Error Messages</h2>
        <div className="space-y-3">
          <ErrorMessage
            content="Failed to connect to the API server."
            errorTitle="Connection Error"
          />
          <ErrorMessage
            content="The authentication token has expired."
            errorTitle="Auth Error"
            errorDetails={[
              'Token expired at: 2025-01-15T10:30:00Z',
              'Last refresh attempt: 2025-01-15T10:25:00Z',
              'Refresh token status: invalid',
            ]}
            errorOriginal="AuthenticationError: Token validation failed with code AUTH_EXPIRED_TOKEN at validateToken (auth.ts:142)"
          />
        </div>
      </section>

      {/* Section: TurnCard - Complete Turn */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-foreground/80">TurnCard - Complete Turn</h2>
        <TurnCard
          sessionId="playground-session"
          turnId="turn-1"
          activities={[completedGrepActivity, completedReadActivity]}
          response={shortResponse}
          intent="Analyzing authentication system"
          isStreaming={false}
          isComplete={true}
          onOpenFile={(path) => console.log('Open file:', path)}
          onOpenUrl={(url) => console.log('Open URL:', url)}
        />
      </section>

      {/* Section: TurnCard - Streaming */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-foreground/80">TurnCard - Streaming Response</h2>
        <TurnCard
          sessionId="playground-session"
          turnId="turn-2"
          activities={[completedGrepActivity]}
          response={streamingResponse}
          isStreaming={true}
          isComplete={false}
          onOpenFile={(path) => console.log('Open file:', path)}
          onOpenUrl={(url) => console.log('Open URL:', url)}
        />
      </section>

      {/* Section: TurnCard - Tool Running */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-foreground/80">TurnCard - Tool Running</h2>
        <TurnCard
          sessionId="playground-session"
          turnId="turn-3"
          activities={[runningGrepActivity]}
          response={undefined}
          intent="Finding error handling patterns"
          isStreaming={true}
          isComplete={false}
          onOpenFile={(path) => console.log('Open file:', path)}
          onOpenUrl={(url) => console.log('Open URL:', url)}
        />
      </section>

      {/* Section: TurnCard - Response Only */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-foreground/80">TurnCard - Response Only (No Tools)</h2>
        <TurnCard
          sessionId="playground-session"
          turnId="turn-4"
          activities={[]}
          response={shortResponse}
          isStreaming={false}
          isComplete={true}
          onOpenFile={(path) => console.log('Open file:', path)}
          onOpenUrl={(url) => console.log('Open URL:', url)}
        />
      </section>

      {/* Section: Auth Request Cards */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-foreground/80">Auth Request Cards</h2>
        <div className="space-y-4">
          {/* Credential - Pending */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-muted-foreground">Credential Request (pending)</h3>
            <AuthRequestCard
              sessionId="playground-session"
              message={createAuthMessage({
                type: 'credential',
                status: 'pending',
                sourceSlug: 'github',
                sourceName: 'GitHub',
                mode: 'bearer',
                description: 'Enter your GitHub personal access token to connect.',
                hint: 'Generate a token at https://github.com/settings/tokens',
              })}
              onRespondToCredential={(sessionId, requestId, response) =>
                console.log('Credential response:', { sessionId, requestId, response })
              }
            />
          </div>

          {/* Credential - Basic Auth */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-muted-foreground">Basic Auth (pending)</h3>
            <AuthRequestCard
              sessionId="playground-session"
              message={createAuthMessage({
                type: 'credential',
                status: 'pending',
                sourceSlug: 'jira',
                sourceName: 'Jira',
                mode: 'basic',
                labels: { username: 'Email', password: 'API Token' },
                description: 'Connect to your Atlassian account.',
              })}
              onRespondToCredential={(sessionId, requestId, response) =>
                console.log('Credential response:', { sessionId, requestId, response })
              }
            />
          </div>

          {/* OAuth - Pending */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-muted-foreground">OAuth Request (pending)</h3>
            <AuthRequestCard
              sessionId="playground-session"
              message={createAuthMessage({
                type: 'oauth',
                status: 'pending',
                sourceSlug: 'linear',
                sourceName: 'Linear',
              })}
            />
          </div>

          {/* Google OAuth - Pending */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-muted-foreground">Google OAuth (pending)</h3>
            <AuthRequestCard
              sessionId="playground-session"
              message={createAuthMessage({
                type: 'oauth-google',
                status: 'pending',
                sourceSlug: 'gmail',
                sourceName: 'Gmail',
              })}
            />
          </div>

          {/* Completed */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-muted-foreground">Auth Completed</h3>
            <AuthRequestCard
              sessionId="playground-session"
              message={createAuthMessage({
                type: 'oauth-google',
                status: 'completed',
                sourceSlug: 'gmail',
                sourceName: 'Gmail',
                email: 'user@example.com',
              })}
            />
          </div>

          {/* Cancelled */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-muted-foreground">Auth Cancelled</h3>
            <AuthRequestCard
              sessionId="playground-session"
              message={createAuthMessage({
                type: 'oauth',
                status: 'cancelled',
                sourceSlug: 'slack',
                sourceName: 'Slack',
              })}
            />
          </div>

          {/* Failed */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-muted-foreground">Auth Failed</h3>
            <AuthRequestCard
              sessionId="playground-session"
              message={createAuthMessage({
                type: 'credential',
                status: 'failed',
                sourceSlug: 'sentry',
                sourceName: 'Sentry',
                error: 'Invalid API key. Please check and try again.',
              })}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

/** Helper to create auth message for playground */
function createAuthMessage(opts: {
  type: 'credential' | 'oauth' | 'oauth-google' | 'oauth-slack' | 'oauth-microsoft'
  status: 'pending' | 'completed' | 'cancelled' | 'failed'
  sourceSlug: string
  sourceName: string
  mode?: 'bearer' | 'basic' | 'header' | 'query'
  labels?: { credential?: string; username?: string; password?: string }
  description?: string
  hint?: string
  error?: string
  email?: string
  workspace?: string
}): Message {
  return {
    id: `auth-${opts.sourceSlug}-${Date.now()}`,
    role: 'auth-request',
    content: `Authentication required for ${opts.sourceName}`,
    timestamp: Date.now(),
    authRequestId: `req-${opts.sourceSlug}`,
    authRequestType: opts.type,
    authSourceSlug: opts.sourceSlug,
    authSourceName: opts.sourceName,
    authStatus: opts.status,
    authCredentialMode: opts.mode,
    authLabels: opts.labels,
    authDescription: opts.description,
    authHint: opts.hint,
    authError: opts.error,
    authEmail: opts.email,
    authWorkspace: opts.workspace,
  }
}

// ============================================================================
// Component Registry Entries
// ============================================================================

export const messagesComponents: ComponentEntry[] = [
  {
    id: 'message-gallery',
    name: 'Message Gallery',
    category: 'Chat Messages',
    description: 'All message types displayed together for easy design comparison',
    component: MessageGallery,
    layout: 'top',
    props: [],
    variants: [],
    mockData: () => ({}),
  },
  {
    id: 'user-message',
    name: 'UserMessage',
    category: 'Chat Messages',
    description: 'Right-aligned user message bubble',
    component: UserMessage,
    props: [
      {
        name: 'content',
        description: 'Message text content',
        control: { type: 'textarea', placeholder: 'Enter message...', rows: 2 },
        defaultValue: 'How do I authenticate with the API?',
      },
    ],
    variants: [
      { name: 'Short', props: { content: 'Hello!' } },
      { name: 'Medium', props: { content: 'How do I authenticate with the API?' } },
      { name: 'Long', props: { content: 'Can you search for all files that contain "handleError" and show me how they work? I need to understand the error handling patterns in this codebase.' } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'assistant-message',
    name: 'AssistantMessage',
    category: 'Chat Messages',
    description: 'Left-aligned assistant response with markdown support',
    component: AssistantMessage,
    props: [
      {
        name: 'content',
        description: 'Message text content (supports markdown)',
        control: { type: 'textarea', placeholder: 'Enter message...', rows: 4 },
        defaultValue: 'I found the authentication handlers in `src/auth/`. The main handler is `AuthHandler` which manages OAuth flows.',
      },
    ],
    variants: [
      { name: 'Short', props: { content: 'The file is located at `src/config.ts`.' } },
      { name: 'With Code', props: { content: 'Here\'s the code:\n\n```typescript\nconst x = 1;\n```' } },
      { name: 'With List', props: { content: '**Steps:**\n1. First step\n2. Second step\n3. Third step' } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'status-message',
    name: 'StatusMessage',
    category: 'Chat Messages',
    description: 'System status with spinner (compaction, connecting, etc)',
    component: StatusMessage,
    props: [
      {
        name: 'content',
        description: 'Status message text',
        control: { type: 'string', placeholder: 'Status message...' },
        defaultValue: 'Compacting conversation...',
      },
    ],
    variants: [
      { name: 'Compacting', props: { content: 'Compacting conversation...' } },
      { name: 'Compacted', props: { content: 'Compacted conversation (was 180000 tokens)' } },
      { name: 'Connecting', props: { content: 'Connecting to server...' } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'info-message',
    name: 'InfoMessage',
    category: 'Chat Messages',
    description: 'System message with icon indicating severity level',
    component: InfoMessage,
    props: [
      {
        name: 'content',
        description: 'Info message text',
        control: { type: 'string', placeholder: 'Info message...' },
        defaultValue: 'Session restored from 5 minutes ago',
      },
      {
        name: 'level',
        description: 'Severity level determining icon and color',
        control: {
          type: 'select',
          options: [
            { label: 'Info', value: 'info' },
            { label: 'Warning', value: 'warning' },
            { label: 'Error', value: 'error' },
            { label: 'Success', value: 'success' },
          ],
        },
        defaultValue: 'info',
      },
    ],
    variants: [
      { name: 'Info', props: { content: 'Session restored from 5 minutes ago', level: 'info' } },
      { name: 'Success', props: { content: 'Agent activated successfully', level: 'success' } },
      { name: 'Warning', props: { content: 'Rate limit approaching', level: 'warning' } },
      { name: 'Error', props: { content: 'Connection lost', level: 'error' } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'warning-message',
    name: 'WarningMessage',
    category: 'Chat Messages',
    description: 'Amber-themed warning message',
    component: WarningMessage,
    props: [
      {
        name: 'content',
        description: 'Warning message text',
        control: { type: 'textarea', placeholder: 'Warning message...', rows: 2 },
        defaultValue: 'This operation may take a while for large codebases.',
      },
    ],
    variants: [
      { name: 'Performance', props: { content: 'This operation may take a while for large codebases.' } },
      { name: 'Rate Limit', props: { content: 'The API rate limit is approaching. Consider batching your requests.' } },
      { name: 'Deprecation', props: { content: 'This API endpoint will be deprecated in v2.0. Please migrate to the new endpoint.' } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'error-message',
    name: 'ErrorMessage',
    category: 'Chat Messages',
    description: 'Red-themed error with collapsible technical details',
    component: ErrorMessage,
    props: [
      {
        name: 'content',
        description: 'Error message text',
        control: { type: 'textarea', placeholder: 'Error message...', rows: 2 },
        defaultValue: 'Failed to connect to the API server.',
      },
      {
        name: 'errorTitle',
        description: 'Error title/type',
        control: { type: 'string', placeholder: 'Error' },
        defaultValue: 'Connection Error',
      },
    ],
    variants: [
      { name: 'Simple', props: { content: 'Failed to connect to the API server.', errorTitle: 'Connection Error' } },
      {
        name: 'With Details',
        props: {
          content: 'The authentication token has expired.',
          errorTitle: 'Auth Error',
          errorDetails: ['Token expired at: 2025-01-15T10:30:00Z', 'Last refresh attempt: 2025-01-15T10:25:00Z'],
          errorOriginal: 'AuthenticationError: Token validation failed',
        }
      },
      { name: 'Network Error', props: { content: 'Network request failed. Please check your internet connection.', errorTitle: 'Network Error' } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'processing-indicator',
    name: 'ProcessingIndicator',
    category: 'Chat Messages',
    description: 'Animated processing indicator with cycling messages and elapsed time counter',
    component: ProcessingIndicator,
    props: [
      {
        name: 'cycleMs',
        description: 'Message cycle interval in milliseconds',
        control: { type: 'number', min: 1000, max: 30000, step: 1000 },
        defaultValue: 10000,
      },
      {
        name: 'counting',
        description: 'Whether the elapsed counter auto-increments',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'elapsed',
        description: 'Initial elapsed time in seconds (only used when counting is false)',
        control: { type: 'number', min: 0, max: 120, step: 1 },
        defaultValue: 0,
      },
    ],
    variants: [
      { name: 'Default (10s cycle, counting)', props: { cycleMs: 10000, counting: true } },
      { name: 'Fast Cycle (3s)', props: { cycleMs: 3000, counting: true } },
      { name: 'Static at 5s', props: { cycleMs: 10000, counting: false, elapsed: 5 } },
      { name: 'Static at 30s', props: { cycleMs: 10000, counting: false, elapsed: 30 } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'auth-request-card',
    name: 'AuthRequestCard',
    category: 'Chat Messages',
    description: 'Inline authentication request card for credentials or OAuth flows',
    component: ({ authType, authStatus, sourceName, mode, description, hint, error, email }) => (
      <AuthRequestCard
        sessionId="playground-session"
        message={createAuthMessage({
          type: authType,
          status: authStatus,
          sourceSlug: sourceName.toLowerCase().replace(/\s+/g, '-'),
          sourceName,
          mode,
          description,
          hint,
          error,
          email,
        })}
        onRespondToCredential={(sessionId, requestId, response) =>
          console.log('Credential response:', { sessionId, requestId, response })
        }
      />
    ),
    props: [
      {
        name: 'authType',
        description: 'Type of authentication',
        control: {
          type: 'select',
          options: [
            { label: 'Credential', value: 'credential' },
            { label: 'OAuth', value: 'oauth' },
            { label: 'Google OAuth', value: 'oauth-google' },
            { label: 'Slack OAuth', value: 'oauth-slack' },
            { label: 'Microsoft OAuth', value: 'oauth-microsoft' },
          ],
        },
        defaultValue: 'credential',
      },
      {
        name: 'authStatus',
        description: 'Current status of the auth request',
        control: {
          type: 'select',
          options: [
            { label: 'Pending', value: 'pending' },
            { label: 'Completed', value: 'completed' },
            { label: 'Cancelled', value: 'cancelled' },
            { label: 'Failed', value: 'failed' },
          ],
        },
        defaultValue: 'pending',
      },
      {
        name: 'sourceName',
        description: 'Name of the source',
        control: { type: 'string', placeholder: 'Source name...' },
        defaultValue: 'GitHub',
      },
      {
        name: 'mode',
        description: 'Credential mode (only for credential type)',
        control: {
          type: 'select',
          options: [
            { label: 'Bearer Token', value: 'bearer' },
            { label: 'Basic Auth', value: 'basic' },
            { label: 'Header', value: 'header' },
            { label: 'Query Param', value: 'query' },
          ],
        },
        defaultValue: 'bearer',
      },
      {
        name: 'description',
        description: 'Description shown to user',
        control: { type: 'string', placeholder: 'Description...' },
        defaultValue: 'Enter your personal access token to connect.',
      },
      {
        name: 'hint',
        description: 'Hint about where to find credentials',
        control: { type: 'string', placeholder: 'Hint...' },
        defaultValue: '',
      },
      {
        name: 'error',
        description: 'Error message (for failed status)',
        control: { type: 'string', placeholder: 'Error message...' },
        defaultValue: '',
      },
      {
        name: 'email',
        description: 'Email (for completed OAuth)',
        control: { type: 'string', placeholder: 'Email...' },
        defaultValue: '',
      },
    ],
    variants: [
      {
        name: 'Credential Pending',
        props: {
          authType: 'credential',
          authStatus: 'pending',
          sourceName: 'GitHub',
          mode: 'bearer',
          description: 'Enter your personal access token to connect.',
          hint: 'Generate at https://github.com/settings/tokens',
        },
      },
      {
        name: 'Basic Auth',
        props: {
          authType: 'credential',
          authStatus: 'pending',
          sourceName: 'Jira',
          mode: 'basic',
          description: 'Connect to your Atlassian account.',
        },
      },
      {
        name: 'OAuth Pending',
        props: {
          authType: 'oauth',
          authStatus: 'pending',
          sourceName: 'Linear',
        },
      },
      {
        name: 'Google OAuth',
        props: {
          authType: 'oauth-google',
          authStatus: 'pending',
          sourceName: 'Gmail',
        },
      },
      {
        name: 'Completed',
        props: {
          authType: 'oauth-google',
          authStatus: 'completed',
          sourceName: 'Gmail',
          email: 'user@example.com',
        },
      },
      {
        name: 'Cancelled',
        props: {
          authType: 'oauth',
          authStatus: 'cancelled',
          sourceName: 'Slack',
        },
      },
      {
        name: 'Failed',
        props: {
          authType: 'credential',
          authStatus: 'failed',
          sourceName: 'Sentry',
          error: 'Invalid API key. Please check and try again.',
        },
      },
    ],
    mockData: () => ({}),
  },
]
