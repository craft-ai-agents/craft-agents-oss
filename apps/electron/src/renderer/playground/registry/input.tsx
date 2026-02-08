import * as React from 'react'
import type { ComponentEntry } from './types'
import { cn } from '@/lib/utils'
import { MODELS } from '@config/models'
import type { PermissionMode } from '@craft-agent/shared/agent/modes'

// Import REAL components from the main app
import { FreeFormInput } from '@/components/app-shell/input/FreeFormInput'
import { InputContainer } from '@/components/app-shell/input/InputContainer'
import { PermissionRequest } from '@/components/app-shell/input/structured/PermissionRequest'
import type { StructuredInputState } from '@/components/app-shell/input/structured/types'

// Import adapters for mock data generation
import {
  mockPermissionRequest,
  type PermissionRequestPlaygroundProps,
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
  ultrathinkEnabled?: boolean
  permissionMode?: PermissionMode
  inputValue?: string
  onInputChange?: (value: string) => void
  unstyled?: boolean
}

function FreeFormInputPlayground({
  placeholder = 'Message...',
  disabled = false,
  isProcessing = false,
  currentModel,
  ultrathinkEnabled = false,
  permissionMode = 'ask',
  inputValue,
  onInputChange,
  unstyled = false,
}: FreeFormInputPlaygroundProps) {
  // Local state for options since playground doesn't have parent state management
  const [model, setModel] = React.useState(currentModel)
  const [ultrathink, setUltrathink] = React.useState(ultrathinkEnabled)
  const [mode, setMode] = React.useState<PermissionMode>(permissionMode)

  React.useEffect(() => setUltrathink(ultrathinkEnabled), [ultrathinkEnabled])
  React.useEffect(() => setMode(permissionMode), [permissionMode])

  return (
    <FreeFormInput
      placeholder={placeholder}
      disabled={disabled}
      isProcessing={isProcessing}
      currentModel={model}
      onModelChange={setModel}
      ultrathinkEnabled={ultrathink}
      onUltrathinkChange={setUltrathink}
      permissionMode={mode}
      onPermissionModeChange={setMode}
      inputValue={inputValue}
      onInputChange={onInputChange}
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
]

type HeightMode = 'freeform' | 'permission'

/**
 * Create mock StructuredInputState for playground testing
 */
function createMockStructuredInput(mode: HeightMode): StructuredInputState | undefined {
  if (mode === 'freeform') return undefined

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
        name: 'safeModeEnabled',
        description: 'Safe mode badge active',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'ultrathinkEnabled',
        description: 'Ultrathink badge active',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Default', props: { currentModel: 'claude-sonnet-4-20250514' } },
      { name: 'With Badges', props: { currentModel: 'claude-sonnet-4-20250514', permissionMode: 'safe' as PermissionMode, ultrathinkEnabled: true } },
      { name: 'Processing', props: { currentModel: 'claude-sonnet-4-20250514', isProcessing: true } },
      { name: 'Disabled', props: { currentModel: 'claude-sonnet-4-20250514', disabled: true } },
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
]
