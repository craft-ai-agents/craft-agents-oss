import * as React from 'react'
import { useSetAtom } from 'jotai'
import type { ComponentEntry } from './types'
import { cn } from '@/lib/utils'
import { MODELS } from '@config/models'
import type { PermissionMode } from '@craft-agent/shared/agent/modes'
import { setBrowserInstancesAtom } from '@/atoms/browser-pane'
import type { BrowserInstanceInfo } from '../../../shared/types'

// Import REAL components from the main app
import { FreeFormInput } from '@/components/app-shell/input/FreeFormInput'
import { InputContainer } from '@/components/app-shell/input/InputContainer'
import { PermissionRequest } from '@/components/app-shell/input/structured/PermissionRequest'
import { AdminApprovalRequest } from '@/components/app-shell/input/structured/AdminApprovalRequest'
import type { StructuredInputState } from '@/components/app-shell/input/structured/types'

// Import adapters for mock data generation
import {
  mockPermissionRequest,
  mockAdminApprovalRequest,
  type PermissionRequestPlaygroundProps,
  type AdminApprovalRequestPlaygroundProps,
} from '../adapters/input-adapters'

// ============================================================================
// Playground Wrapper Components
// These are thin wrappers that provide mock data to the real components
// ============================================================================

/**
 * FreeFormInput wrapper for playground - uses the real component directly
 * The real component now has Electron API guards, so it works in playground context
 */
interface FreeFormInputPlaygroundProps {
  placeholder?: string
  disabled?: boolean
  isProcessing?: boolean
  currentModel: string
  permissionMode?: PermissionMode
  inputValue?: string
  onInputChange?: (value: string) => void
  unstyled?: boolean
  sessionId?: string
  showBrowserStatus?: boolean
  browserIsLoading?: boolean
  browserThemeColor?: string
  browserUrl?: string
  browserVisible?: boolean
}

function FreeFormInputPlayground({
  placeholder = 'Message...',
  disabled = false,
  isProcessing = false,
  currentModel,
  permissionMode = 'ask',
  inputValue,
  onInputChange,
  unstyled = false,
  sessionId = 'playground-session',
  showBrowserStatus = false,
  browserIsLoading = false,
  browserThemeColor = '#0b57d0',
  browserUrl = 'https://github.com/craftdocs/craft-agents',
  browserVisible = true,
}: FreeFormInputPlaygroundProps) {
  // Local state for options since playground doesn't have parent state management
  const [model, setModel] = React.useState(currentModel)
  const [mode, setMode] = React.useState<PermissionMode>(permissionMode)
  const setBrowserInstances = useSetAtom(setBrowserInstancesAtom)

  React.useEffect(() => setMode(permissionMode), [permissionMode])

  React.useEffect(() => {
    if (!showBrowserStatus) {
      setBrowserInstances([])
      return () => setBrowserInstances([])
    }

    const browserInstance: BrowserInstanceInfo = {
      id: 'playground-browser-1',
      url: browserUrl,
      title: 'Playground Browser',
      favicon: 'https://www.google.com/s2/favicons?domain=github.com&sz=64',
      isLoading: browserIsLoading,
      canGoBack: false,
      canGoForward: false,
      boundSessionId: sessionId,
      ownerType: 'session',
      ownerSessionId: sessionId,
      isVisible: browserVisible,
      agentControlActive: true,
      themeColor: browserThemeColor || null,
    }

    setBrowserInstances([browserInstance])
    return () => setBrowserInstances([])
  }, [
    setBrowserInstances,
    showBrowserStatus,
    browserUrl,
    browserIsLoading,
    sessionId,
    browserVisible,
    browserThemeColor,
  ])

  return (
    <FreeFormInput
      placeholder={placeholder}
      disabled={disabled}
      isProcessing={isProcessing}
      currentModel={model}
      onModelChange={setModel}
      permissionMode={mode}
      onPermissionModeChange={setMode}
      inputValue={inputValue}
      onInputChange={onInputChange}
      sessionId={sessionId}
      onSubmit={() => {}} // No-op for playground
      onStop={() => {}} // No-op for playground
      unstyled={unstyled}
    />
  )
}

/**
 * PermissionRequest wrapper for playground - provides mock data
 */
function PermissionRequestPlayground({
  toolName = 'Bash',
  description = 'Execute a shell command to list files in the current directory',
  command = 'ls -la /Users/demo/projects',
  onAction,
  unstyled = false,
}: PermissionRequestPlaygroundProps) {
  const mockRequest = mockPermissionRequest({ toolName, description, command })

  return (
    <PermissionRequest
      request={mockRequest}
      onResponse={() => onAction?.()}
      unstyled={unstyled}
    />
  )
}

/**
 * AdminApprovalRequest wrapper for playground - provides mock data
 */
function AdminApprovalRequestPlayground({
  appName = 'Docker Desktop',
  reason = 'Homebrew needs admin access to complete post-install steps.',
  command = 'brew install --cask docker',
  impact = 'May install files in /Applications and system-managed directories.',
  requiresSystemPrompt = true,
  rememberForMinutes = 10,
  onAction,
  unstyled = false,
}: AdminApprovalRequestPlaygroundProps) {
  const mockRequest = mockAdminApprovalRequest({
    appName,
    reason,
    command,
    impact,
    requiresSystemPrompt,
    rememberForMinutes,
  })

  return (
    <AdminApprovalRequest
      request={mockRequest}
      onApprove={() => onAction?.()}
      onCancel={() => onAction?.()}
      unstyled={unstyled}
    />
  )
}

function AdminApprovalPreviewWrapper({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[680px]">{children}</div>
}

// ============================================================================
// Input Transitions - Full app-like layout for testing animations
// Uses InputContainer directly (single source of truth for height/animation logic)
// ============================================================================

// Placeholder message bubbles to simulate real chat
const PLACEHOLDER_MESSAGES = [
  { role: 'user', content: 'Can you help me plan a trip to Barcelona?' },
  { role: 'assistant', content: 'Of course! I\'d be happy to help you plan a trip to Barcelona. Let me gather some information first. Barcelona is a beautiful city with amazing architecture, beaches, and cuisine.' },
  { role: 'user', content: 'I want to focus on Gaudi\'s architecture and good food.' },
  { role: 'assistant', content: 'Great choices! Barcelona is famous for Gaudí\'s masterpieces like Sagrada Família, Park Güell, and Casa Batlló. The food scene is incredible too - from traditional tapas to Michelin-starred restaurants. Let me create a plan for you.' },
]

// Mode options for the switcher
const MODE_OPTIONS = [
  { id: 'freeform', label: 'Input', color: null },
  { id: 'permission', label: 'Permission', color: 'bg-amber-500' },
  { id: 'admin_approval', label: 'Admin Approval', color: 'bg-info' },
]

type HeightMode = 'freeform' | 'permission' | 'admin_approval'

/**
 * Create mock StructuredInputState for playground testing
 */
function createMockStructuredInput(mode: HeightMode): StructuredInputState | undefined {
  if (mode === 'freeform') return undefined

  if (mode === 'admin_approval') {
    return {
      type: 'admin_approval',
      data: mockAdminApprovalRequest({
        appName: 'Docker Desktop',
        reason: 'Homebrew needs admin access to complete post-install steps.',
        impact: 'May install files in /Applications and system-managed directories.',
        command: 'brew install --cask docker',
      }),
    }
  }

  return {
    type: 'permission',
    data: mockPermissionRequest({
      toolName: 'Bash',
      description: 'Execute a shell command to install dependencies',
      command: 'npm install && npm run build',
    }),
  }
}

function InputTransitions() {
  const [heightMode, setHeightMode] = React.useState<HeightMode>('freeform')
  const [inputValue, setInputValue] = React.useState('')
  const [model, setModel] = React.useState('claude-sonnet-4-20250514')

  // Create structured input state based on current mode
  const structuredInput = createMockStructuredInput(heightMode)

  // Handle structured input responses - just switch back to freeform
  const handleStructuredResponse = React.useCallback(() => {
    setHeightMode('freeform')
  }, [])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top: Mode Switcher */}
      <div className="shrink-0 p-4 border-b border-border/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-foreground/80">Input Transitions Test</h2>
          <div className="text-xs text-muted-foreground">
            Uses real InputContainer component
          </div>
        </div>
        <div className="flex gap-1 p-1 bg-muted/50 rounded-lg w-fit">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.id}
              onClick={() => setHeightMode(m.id as HeightMode)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                heightMode === m.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              )}
            >
              {m.color && <div className={cn('w-3 h-3 rounded-sm', m.color)} />}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {PLACEHOLDER_MESSAGES.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[80%] p-3 rounded-lg text-sm',
                msg.role === 'user'
                  ? 'ml-auto bg-foreground text-background'
                  : 'bg-muted text-foreground'
              )}
            >
              {msg.content}
            </div>
          ))}
        </div>

        {/* Input - uses the real InputContainer */}
        <div className="shrink-0 p-4 pt-0">
          <InputContainer
            structuredInput={structuredInput}
            onStructuredResponse={handleStructuredResponse}
            // FreeFormInput props
            currentModel={model}
            onModelChange={setModel}
            inputValue={inputValue}
            onInputChange={setInputValue}
            onSubmit={() => {}}
            onStop={() => {}}
          />
        </div>
      </div>
    </div>
  )
}


// ============================================================================
// Component Registry Entries
// ============================================================================

export const inputComponents: ComponentEntry[] = [
  {
    id: 'input-transitions',
    name: 'Input Transitions',
    category: 'Chat Inputs',
    description: 'Full app-like layout for testing input animations with messages above and input at bottom',
    component: InputTransitions,
    layout: 'full',
    props: [],
    variants: [],
    mockData: () => ({}),
  },
  {
    id: 'freeform-input',
    name: 'FreeFormInput',
    category: 'Chat Inputs',
    description: 'Main text input with model selector, slash commands, and attachments',
    component: FreeFormInputPlayground,
    props: [
      {
        name: 'placeholder',
        description: 'Placeholder text',
        control: { type: 'string', placeholder: 'Message...' },
        defaultValue: 'Message Chat...',
      },
      {
        name: 'disabled',
        description: 'Disable the input',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'isProcessing',
        description: 'Show stop button instead of send',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'currentModel',
        description: 'Currently selected model',
        control: {
          type: 'select',
          options: MODELS.map(m => ({ label: m.name, value: m.id })),
        },
        defaultValue: 'claude-sonnet-4-20250514',
      },
      {
        name: 'showBrowserStatus',
        description: 'Show toolbar browser status slot for this session',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'browserIsLoading',
        description: 'Show loading spinner in browser status slot',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'browserThemeColor',
        description: 'Theme color used for browser status background',
        control: { type: 'string', placeholder: '#0b57d0' },
        defaultValue: '#0b57d0',
      },
      {
        name: 'browserUrl',
        description: 'Browser URL used to render hostname in status slot',
        control: { type: 'string', placeholder: 'https://example.com' },
        defaultValue: 'https://github.com/craftdocs/craft-agents',
      },
      {
        name: 'browserVisible',
        description: 'Whether the bound browser window is currently visible',
        control: { type: 'boolean' },
        defaultValue: true,
      },
    ],
    variants: [
      { name: 'Default', props: { currentModel: 'claude-sonnet-4-20250514' } },
      { name: 'With Badges', props: { currentModel: 'claude-sonnet-4-20250514', permissionMode: 'safe' as PermissionMode } },
      { name: 'Processing', props: { currentModel: 'claude-sonnet-4-20250514', isProcessing: true } },
      { name: 'Disabled', props: { currentModel: 'claude-sonnet-4-20250514', disabled: true } },
      {
        name: 'Browser Status / Themed',
        props: {
          currentModel: 'claude-sonnet-4-20250514',
          showBrowserStatus: true,
          browserThemeColor: '#1f6feb',
          browserUrl: 'https://github.com/craftdocs/craft-agents',
          browserVisible: true,
        },
      },
      {
        name: 'Browser Status / Loading',
        props: {
          currentModel: 'claude-sonnet-4-20250514',
          showBrowserStatus: true,
          browserIsLoading: true,
          browserThemeColor: '#0d1117',
          browserUrl: 'https://docs.craft.do/changelog',
          browserVisible: true,
        },
      },
      {
        name: 'Browser Status / No Theme',
        props: {
          currentModel: 'claude-sonnet-4-20250514',
          showBrowserStatus: true,
          browserThemeColor: '',
          browserUrl: 'https://example.com',
          browserVisible: true,
        },
      },
      {
        name: 'Processing + Browser',
        props: {
          currentModel: 'claude-sonnet-4-20250514',
          isProcessing: true,
          showBrowserStatus: true,
          browserThemeColor: '#fbbc04',
          browserUrl: 'https://news.ycombinator.com',
          browserVisible: true,
        },
      },
    ],
    mockData: () => ({}),
  },
  {
    id: 'permission-request',
    name: 'PermissionRequest',
    category: 'Chat Inputs',
    description: 'Structured input for approving tool execution permissions',
    component: PermissionRequestPlayground,
    props: [
      {
        name: 'toolName',
        description: 'Name of the tool requesting permission',
        control: { type: 'string', placeholder: 'Bash' },
        defaultValue: 'Bash',
      },
      {
        name: 'description',
        description: 'Description of what the tool wants to do',
        control: { type: 'textarea', placeholder: 'Description...', rows: 2 },
        defaultValue: 'Execute a shell command to list files in the current directory',
      },
      {
        name: 'command',
        description: 'The command or action being requested',
        control: { type: 'textarea', placeholder: 'Command preview...', rows: 2 },
        defaultValue: 'ls -la /Users/demo/projects',
      },
    ],
    variants: [
      { name: 'Bash Command', props: { toolName: 'Bash', description: 'Execute a shell command', command: 'npm install && npm run build' } },
      { name: 'Read File', props: { toolName: 'Read', description: 'Read file contents', command: '/etc/passwd' } },
      { name: 'Write File', props: { toolName: 'Write', description: 'Create or overwrite a file', command: '/tmp/output.txt' } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'admin-approval-request',
    name: 'AdminApprovalRequest',
    category: 'Chat Inputs',
    description: 'Friendly admin approval prompt for privileged installs and system-level actions',
    component: AdminApprovalRequestPlayground,
    layout: 'top',
    wrapper: AdminApprovalPreviewWrapper,
    props: [
      {
        name: 'appName',
        description: 'App or package being installed',
        control: { type: 'string', placeholder: 'Docker Desktop' },
        defaultValue: 'Docker Desktop',
      },
      {
        name: 'reason',
        description: 'Plain-language reason this needs admin approval',
        control: { type: 'textarea', placeholder: 'Reason...', rows: 2 },
        defaultValue: 'Homebrew needs admin access to complete post-install steps.',
      },
      {
        name: 'impact',
        description: 'What this can change on the machine',
        control: { type: 'textarea', placeholder: 'Impact...', rows: 2 },
        defaultValue: 'May install files in /Applications and system-managed directories.',
      },
      {
        name: 'command',
        description: 'Exact command that will run',
        control: { type: 'textarea', placeholder: 'Command preview...', rows: 2 },
        defaultValue: 'brew install --cask docker',
      },
      {
        name: 'requiresSystemPrompt',
        description: 'Show note about macOS Touch ID/password prompt',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'rememberForMinutes',
        description: 'Temporary remember window for this exact command',
        control: { type: 'number', min: 1, max: 120, step: 1 },
        defaultValue: 10,
      },
    ],
    variants: [
      {
        name: 'Default (Install)',
        props: {
          appName: 'Docker Desktop',
          reason: 'Homebrew needs admin access to complete post-install steps.',
          impact: 'May install files in /Applications and system-managed directories.',
          command: 'brew install --cask docker',
          requiresSystemPrompt: true,
          rememberForMinutes: 10,
        },
      },
      {
        name: 'Update Existing App',
        props: {
          appName: 'Visual Studio Code',
          reason: 'Updating this cask requires elevated file replacement in protected locations.',
          impact: 'May replace app binaries in /Applications.',
          command: 'brew upgrade --cask visual-studio-code',
          requiresSystemPrompt: true,
          rememberForMinutes: 10,
        },
      },
      {
        name: 'High Impact Script',
        props: {
          appName: 'Security Agent',
          reason: 'Installer needs admin rights to register background services.',
          impact: 'Adds system services and startup items.',
          command: 'installer -pkg /tmp/security-agent.pkg -target /',
          requiresSystemPrompt: true,
          rememberForMinutes: 5,
        },
      },
      {
        name: 'No Native Prompt Note',
        props: {
          appName: 'CLI Utility',
          reason: 'This action is elevated in-app but does not trigger a separate OS prompt.',
          impact: 'Writes files to protected system directories.',
          command: 'cp ./bin/tool /usr/local/bin/tool',
          requiresSystemPrompt: false,
          rememberForMinutes: 10,
        },
      },
    ],
    mockData: () => ({}),
  },
]
