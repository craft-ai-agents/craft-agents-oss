import * as React from 'react'
import type { ComponentEntry } from './types'
import { AttachmentPreview } from '@/components/app-shell/AttachmentPreview'
import { SetupAuthBanner } from '@/components/app-shell/SetupAuthBanner'
import { TurnCard, type ActivityItem } from '@craft-agent/ui'
import type { BackgroundTask } from '@/components/app-shell/ActiveTasksBar'
import { ActiveOptionBadges } from '@/components/app-shell/ActiveOptionBadges'
import { InputContainer } from '@/components/app-shell/input'
import type { StructuredResponse } from '@/components/app-shell/input/structured/types'
import { EmptyStateHint, getHintCount, getHintTemplate } from '@/components/chat/EmptyStateHint'
import { Button } from '@/components/ui/button'
import { motion } from 'motion/react'
import { ArrowUp, Paperclip, ChevronDown, Sparkles } from 'lucide-react'
import type { FileAttachment, PermissionRequest } from '../../../shared/types'
import { cn } from '@/lib/utils'
import {
  ensureMockElectronAPI,
  mockInputCallbacks,
  mockAttachmentCallbacks,
  mockSources,
  sampleImageAttachment,
  samplePdfAttachment,
} from '../mock-utils'

const sampleCodeAttachment: FileAttachment = {
  type: 'text',
  path: '/Users/test/app.tsx',
  name: 'App.tsx',
  mimeType: 'text/typescript',
  size: 8500,
}

const samplePermissionRequest: PermissionRequest = {
  requestId: 'perm-1',
  sessionId: 'session-1',
  toolName: 'bash',
  description: 'Run shell command',
  command: 'npm install --save-dev typescript @types/react',
}

const longPermissionRequest: PermissionRequest = {
  requestId: 'perm-2',
  sessionId: 'session-1',
  toolName: 'bash',
  description: 'Run shell command',
  command: 'find /Users/test/project -type f -name "*.ts" | xargs grep -l "deprecated" | head -20',
}

const veryLongPermissionRequest: PermissionRequest = {
  requestId: 'perm-3',
  sessionId: 'session-1',
  toolName: 'bash',
  description: 'Run complex deployment script',
  command: `#!/bin/bash
set -e

echo "Starting deployment..."
cd /Users/project/app

# Build the application
npm run build
npm run test

# Docker operations
docker build -t myapp:latest .
docker tag myapp:latest registry.example.com/myapp:latest
docker push registry.example.com/myapp:latest

# Deploy to kubernetes
kubectl apply -f k8s/deployment.yaml
kubectl rollout status deployment/myapp`,
}

// Sample background tasks
const sampleBackgroundTasks: BackgroundTask[] = [
  {
    id: 'task-abc123',
    type: 'agent',
    toolUseId: 'tool-1',
    startTime: Date.now() - 45000, // 45 seconds ago
    elapsedSeconds: 45,
    intent: 'Explore codebase structure',
  },
  {
    id: 'shell-xyz456',
    type: 'shell',
    toolUseId: 'tool-2',
    startTime: Date.now() - 154000, // 2m 34s ago
    elapsedSeconds: 154,
  },
]

const singleBackgroundTask: BackgroundTask[] = [
  {
    id: 'task-123456',
    type: 'agent',
    toolUseId: 'tool-single',
    startTime: Date.now() - 23000,
    elapsedSeconds: 23,
    intent: 'Search for TypeScript files',
  },
]

const longRunningTasks: BackgroundTask[] = [
  {
    id: 'task-long-1',
    type: 'agent',
    toolUseId: 'tool-long-1',
    startTime: Date.now() - 3723000, // 1h 2m 3s
    elapsedSeconds: 3723,
    intent: 'Refactor authentication system',
  },
  {
    id: 'shell-long-2',
    type: 'shell',
    toolUseId: 'tool-long-2',
    startTime: Date.now() - 245000, // 4m 5s
    elapsedSeconds: 245,
  },
  {
    id: 'task-long-3',
    type: 'agent',
    toolUseId: 'tool-long-3',
    startTime: Date.now() - 12000, // 12s
    elapsedSeconds: 12,
    intent: 'Run tests',
  },
]

// ============================================================================
// Sample Nested Tool Activities (Task subagent with child tools)
// ============================================================================

/** Flat list of tools (no nesting) */
const flatActivities: ActivityItem[] = [
  {
    id: 'tool-1',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-1',
    toolInput: { file_path: 'src/components/App.tsx' },
    content: 'File contents...',
    timestamp: Date.now() - 3000,
    depth: 0,
  },
  {
    id: 'tool-2',
    type: 'tool',
    status: 'completed',
    toolName: 'Grep',
    toolUseId: 'grep-1',
    toolInput: { pattern: 'useState', path: 'src/' },
    content: '15 matches found',
    timestamp: Date.now() - 2000,
    depth: 0,
  },
  {
    id: 'tool-3',
    type: 'tool',
    status: 'completed',
    toolName: 'Edit',
    toolUseId: 'edit-1',
    toolInput: { file_path: 'src/components/App.tsx' },
    content: 'File updated',
    timestamp: Date.now() - 1000,
    depth: 0,
  },
]

/** Task with nested child tools (completed) */
const nestedActivitiesCompleted: ActivityItem[] = [
  {
    id: 'task-1',
    type: 'tool',
    status: 'completed',
    toolName: 'Task',
    toolUseId: 'task-parent-1',
    toolInput: { description: 'Explore codebase structure', subagent_type: 'Explore' },
    content: 'Exploration complete',
    timestamp: Date.now() - 5000,
    depth: 0,
  },
  {
    id: 'read-1',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-child-1',
    toolInput: { file_path: 'package.json' },
    content: '{ "name": "my-app", ... }',
    timestamp: Date.now() - 4500,
    parentId: 'task-parent-1',
    depth: 1,
  },
  {
    id: 'glob-1',
    type: 'tool',
    status: 'completed',
    toolName: 'Glob',
    toolUseId: 'glob-child-1',
    toolInput: { pattern: 'src/**/*.tsx' },
    content: '24 files matched',
    timestamp: Date.now() - 4000,
    parentId: 'task-parent-1',
    depth: 1,
  },
  {
    id: 'grep-1',
    type: 'tool',
    status: 'completed',
    toolName: 'Grep',
    toolUseId: 'grep-child-1',
    toolInput: { pattern: 'export function' },
    content: '156 matches',
    timestamp: Date.now() - 3500,
    parentId: 'task-parent-1',
    depth: 1,
  },
  {
    id: 'read-2',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-child-2',
    toolInput: { file_path: 'src/index.tsx' },
    content: 'Entry point file...',
    timestamp: Date.now() - 3000,
    parentId: 'task-parent-1',
    depth: 1,
  },
]

/** Task with nested child tools (in progress) */
const nestedActivitiesInProgress: ActivityItem[] = [
  {
    id: 'task-2',
    type: 'tool',
    status: 'running',
    toolName: 'Task',
    toolUseId: 'task-parent-2',
    toolInput: { description: 'Implement new feature', subagent_type: 'general-purpose' },
    timestamp: Date.now() - 3000,
    depth: 0,
  },
  {
    id: 'read-3',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-child-3',
    toolInput: { file_path: 'src/components/Button.tsx' },
    content: 'Component file...',
    timestamp: Date.now() - 2500,
    parentId: 'task-parent-2',
    depth: 1,
  },
  {
    id: 'edit-2',
    type: 'tool',
    status: 'completed',
    toolName: 'Edit',
    toolUseId: 'edit-child-1',
    toolInput: { file_path: 'src/components/Button.tsx' },
    content: 'Added onClick handler',
    timestamp: Date.now() - 2000,
    parentId: 'task-parent-2',
    depth: 1,
  },
  {
    id: 'write-1',
    type: 'tool',
    status: 'running',
    toolName: 'Write',
    toolUseId: 'write-child-1',
    toolInput: { file_path: 'src/components/NewFeature.tsx' },
    timestamp: Date.now() - 500,
    parentId: 'task-parent-2',
    depth: 1,
  },
]

/** Multiple nested Task tools */
const multipleNestedTasks: ActivityItem[] = [
  {
    id: 'task-a',
    type: 'tool',
    status: 'completed',
    toolName: 'Task',
    toolUseId: 'task-a-id',
    toolInput: { description: 'Analyze code quality', subagent_type: 'Explore' },
    content: 'Analysis complete',
    timestamp: Date.now() - 10000,
    depth: 0,
  },
  {
    id: 'grep-a1',
    type: 'tool',
    status: 'completed',
    toolName: 'Grep',
    toolUseId: 'grep-a1-id',
    toolInput: { pattern: 'TODO|FIXME' },
    content: '23 issues found',
    timestamp: Date.now() - 9500,
    parentId: 'task-a-id',
    depth: 1,
  },
  {
    id: 'read-a1',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-a1-id',
    toolInput: { file_path: 'src/legacy/OldComponent.tsx' },
    content: 'Legacy code...',
    timestamp: Date.now() - 9000,
    parentId: 'task-a-id',
    depth: 1,
  },
  {
    id: 'task-b',
    type: 'tool',
    status: 'completed',
    toolName: 'Task',
    toolUseId: 'task-b-id',
    toolInput: { description: 'Fix identified issues', subagent_type: 'general-purpose' },
    content: 'Issues fixed',
    timestamp: Date.now() - 5000,
    depth: 0,
  },
  {
    id: 'edit-b1',
    type: 'tool',
    status: 'completed',
    toolName: 'Edit',
    toolUseId: 'edit-b1-id',
    toolInput: { file_path: 'src/legacy/OldComponent.tsx' },
    content: 'Removed deprecated code',
    timestamp: Date.now() - 4500,
    parentId: 'task-b-id',
    depth: 1,
  },
  {
    id: 'bash-b1',
    type: 'tool',
    status: 'completed',
    toolName: 'Bash',
    toolUseId: 'bash-b1-id',
    toolInput: { command: 'npm run lint:fix', description: 'Auto-fix linting issues' },
    content: 'Fixed 12 issues',
    timestamp: Date.now() - 4000,
    parentId: 'task-b-id',
    depth: 1,
  },
  {
    id: 'write-b1',
    type: 'tool',
    status: 'completed',
    toolName: 'Write',
    toolUseId: 'write-b1-id',
    toolInput: { file_path: 'src/components/ModernComponent.tsx' },
    content: 'Created new component',
    timestamp: Date.now() - 3500,
    parentId: 'task-b-id',
    depth: 1,
  },
]

/** Deep nesting example (2+ levels) */
const deepNestedActivities: ActivityItem[] = [
  {
    id: 'task-outer',
    type: 'tool',
    status: 'completed',
    toolName: 'Task',
    toolUseId: 'task-outer-id',
    toolInput: { description: 'Refactor authentication', subagent_type: 'Plan' },
    content: 'Refactoring complete',
    timestamp: Date.now() - 8000,
    depth: 0,
  },
  {
    id: 'task-inner',
    type: 'tool',
    status: 'completed',
    toolName: 'Task',
    toolUseId: 'task-inner-id',
    toolInput: { description: 'Implement OAuth flow', subagent_type: 'general-purpose' },
    content: 'OAuth implemented',
    timestamp: Date.now() - 7500,
    parentId: 'task-outer-id',
    depth: 1,
  },
  {
    id: 'read-deep',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-deep-id',
    toolInput: { file_path: 'src/auth/oauth.ts' },
    content: 'OAuth config...',
    timestamp: Date.now() - 7000,
    parentId: 'task-inner-id',
    depth: 2,
  },
  {
    id: 'edit-deep',
    type: 'tool',
    status: 'completed',
    toolName: 'Edit',
    toolUseId: 'edit-deep-id',
    toolInput: { file_path: 'src/auth/oauth.ts' },
    content: 'Added PKCE support',
    timestamp: Date.now() - 6500,
    parentId: 'task-inner-id',
    depth: 2,
  },
  {
    id: 'write-auth',
    type: 'tool',
    status: 'completed',
    toolName: 'Write',
    toolUseId: 'write-auth-id',
    toolInput: { file_path: 'src/auth/callback.ts' },
    content: 'Created callback handler',
    timestamp: Date.now() - 6000,
    parentId: 'task-inner-id',
    depth: 2,
  },
  {
    id: 'bash-test',
    type: 'tool',
    status: 'completed',
    toolName: 'Bash',
    toolUseId: 'bash-test-id',
    toolInput: { command: 'npm test', description: 'Run auth tests' },
    content: 'All tests passed',
    timestamp: Date.now() - 5000,
    parentId: 'task-outer-id',
    depth: 1,
  },
]

/**
 * Contextual wrapper for ActiveTasksBar showing it with messages and input
 */
interface ActiveTasksBarContextProps {
  tasks?: BackgroundTask[]
}

function ActiveTasksBarContext({ tasks = sampleBackgroundTasks }: ActiveTasksBarContextProps) {
  const [permissionMode, setPermissionMode] = React.useState<'safe' | 'ask' | 'allow-all'>('ask')
  const [ultrathinkEnabled, setUltrathinkEnabled] = React.useState(false)

  // Inject mock electronAPI for file attachments
  React.useEffect(() => {
    ensureMockElectronAPI()
  }, [])

  return (
    <div className="w-full max-w-[960px] h-full flex flex-col">
      {/* Sample messages for context - matches ChatDisplay padding */}
      <div className="flex-1 overflow-auto px-5 py-8 space-y-2.5">
        {/* User message */}
        <div className="pt-3 flex justify-end">
          <div className="max-w-[80%] rounded-2xl bg-foreground text-background px-4 py-2">
            <p className="text-sm">Can you explore the codebase structure and analyze the API endpoints?</p>
          </div>
        </div>

        {/* Assistant message */}
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2">
            <p className="text-sm">I'll explore the codebase and analyze the API endpoints. Let me start by running a background task to search for API route definitions...</p>
          </div>
        </div>
      </div>

      {/* Input area - matches ChatDisplay padding */}
      <div className="mx-auto w-full px-4 pb-4 mt-1" style={{ maxWidth: 'var(--content-max-width, 960px)' }}>
        {/* Active option badges and tasks */}
        <ActiveOptionBadges
          ultrathinkEnabled={ultrathinkEnabled}
          onUltrathinkChange={setUltrathinkEnabled}
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          tasks={tasks}
          sessionId="playground-session"
          onKillTask={(taskId) => console.log('[Playground] Kill task:', taskId)}
        />

        {/* Real InputContainer */}
        <InputContainer
          placeholder="Message Craft Agent..."
          disabled={false}
          isProcessing={false}
          currentModel="claude-sonnet-4-5-20250929"
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          ultrathinkEnabled={ultrathinkEnabled}
          onUltrathinkChange={setUltrathinkEnabled}
          sources={mockSources}
          enabledSourceSlugs={['github-api', 'local-files']}
          workingDirectory="/Users/demo/projects/craft-agent"
          sessionId="playground-session"
          onSubmit={mockInputCallbacks.onSubmit}
          onModelChange={mockInputCallbacks.onModelChange}
          onInputChange={mockInputCallbacks.onInputChange}
          onHeightChange={mockInputCallbacks.onHeightChange}
          onFocusChange={mockInputCallbacks.onFocusChange}
          onSourcesChange={mockInputCallbacks.onSourcesChange}
          onWorkingDirectoryChange={mockInputCallbacks.onWorkingDirectoryChange}
          onStop={mockInputCallbacks.onStop}
        />
      </div>
    </div>
  )
}

/**
 * Interactive test component for Permission UI ↔ Input View animation transitions
 * Allows toggling between states to inspect the animate in/out behavior
 */
interface PermissionInputToggleProps {
  autoToggle?: boolean
  autoToggleInterval?: number
  useLongCommand?: boolean
}

function PermissionInputToggle({ autoToggle = false, autoToggleInterval = 3000, useLongCommand = false }: PermissionInputToggleProps) {
  const [showPermission, setShowPermission] = React.useState(false)
  const [permissionMode, setPermissionMode] = React.useState<'safe' | 'ask' | 'allow-all'>('ask')
  const [ultrathinkEnabled, setUltrathinkEnabled] = React.useState(false)

  const permissionRequest = useLongCommand ? veryLongPermissionRequest : samplePermissionRequest

  // Auto-toggle for continuous animation testing
  React.useEffect(() => {
    if (!autoToggle) return
    const interval = setInterval(() => {
      setShowPermission(prev => !prev)
    }, autoToggleInterval)
    return () => clearInterval(interval)
  }, [autoToggle, autoToggleInterval])

  // Inject mock electronAPI for file attachments
  React.useEffect(() => {
    ensureMockElectronAPI()
  }, [])

  const handlePermissionResponse = (response: StructuredResponse) => {
    console.log('[Playground] Structured response:', response)
    setShowPermission(false)
  }

  // Build structuredInput state for real InputContainer
  const structuredInput = showPermission ? {
    type: 'permission' as const,
    data: permissionRequest,
  } : undefined

  return (
    <div className="w-full max-w-[960px] h-full flex flex-col px-4 pb-4">
      {/* Spacer to push content to bottom */}
      <div className="flex-1" />

      {/* Control buttons */}
      <div className="flex items-center gap-2 mb-20">
        <Button
          variant={showPermission ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowPermission(true)}
          className="gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Show Permission
        </Button>
        <Button
          variant={!showPermission ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowPermission(false)}
          className="gap-1.5"
        >
          Show Input
        </Button>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          Current: <span className="font-medium">{showPermission ? 'Permission Banner' : 'Input View'}</span>
        </span>
      </div>

      {/* Active option badges */}
      <ActiveOptionBadges
        ultrathinkEnabled={ultrathinkEnabled}
        onUltrathinkChange={setUltrathinkEnabled}
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
      />

      {/* Real InputContainer - handles animation automatically */}
      <InputContainer
        placeholder="Message Craft Agent..."
        disabled={false}
        isProcessing={false}
        currentModel="claude-sonnet-4-5-20250929"
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
        ultrathinkEnabled={ultrathinkEnabled}
        onUltrathinkChange={setUltrathinkEnabled}
        sources={mockSources}
        enabledSourceSlugs={['github-api', 'local-files']}
        workingDirectory="/Users/demo/projects/craft-agent"
        sessionId="playground-session"
        structuredInput={structuredInput}
        onStructuredResponse={handlePermissionResponse}
        onSubmit={mockInputCallbacks.onSubmit}
        onModelChange={mockInputCallbacks.onModelChange}
        onInputChange={mockInputCallbacks.onInputChange}
        onHeightChange={mockInputCallbacks.onHeightChange}
        onFocusChange={mockInputCallbacks.onFocusChange}
        onSourcesChange={mockInputCallbacks.onSourcesChange}
        onWorkingDirectoryChange={mockInputCallbacks.onWorkingDirectoryChange}
        onStop={mockInputCallbacks.onStop}
      />
    </div>
  )
}

// Generate variants for all hints dynamically
const emptyStateHintVariants = Array.from({ length: getHintCount() }, (_, i) => ({
  name: `Hint ${i + 1}`,
  description: getHintTemplate(i).slice(0, 50) + '...',
  props: { hintIndex: i },
}))

export const chatComponents: ComponentEntry[] = [
  {
    id: 'empty-state-hint',
    name: 'EmptyStateHint',
    category: 'Chat',
    description: 'Rotating workflow suggestions for empty chat state with inline entity badges (sources, files, folders, skills)',
    component: EmptyStateHint,
    props: [
      {
        name: 'hintIndex',
        description: 'Specific hint to display (0-14). Leave empty for random.',
        control: { type: 'number', min: 0, max: 14, step: 1 },
        defaultValue: 0,
      },
    ],
    variants: emptyStateHintVariants,
    mockData: () => ({}),
  },
  {
    id: 'attachment-preview',
    name: 'AttachmentPreview',
    category: 'Chat',
    description: 'ChatGPT-style attachment preview strip showing attached files as bubbles above textarea',
    component: AttachmentPreview,
    props: [
      {
        name: 'disabled',
        description: 'Disable remove buttons',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'loadingCount',
        description: 'Number of loading placeholders to show',
        control: { type: 'number', min: 0, max: 5, step: 1 },
        defaultValue: 0,
      },
    ],
    variants: [
      { name: 'Empty', props: { attachments: [], loadingCount: 0 } },
      { name: 'With Images', props: { attachments: [sampleImageAttachment, sampleImageAttachment] } },
      { name: 'With Documents', props: { attachments: [samplePdfAttachment, sampleCodeAttachment] } },
      { name: 'Mixed', props: { attachments: [sampleImageAttachment, samplePdfAttachment, sampleCodeAttachment] } },
      { name: 'Loading', props: { attachments: [], loadingCount: 3 } },
      { name: 'Disabled', props: { attachments: [sampleImageAttachment, samplePdfAttachment], disabled: true } },
    ],
    mockData: () => ({
      attachments: [sampleImageAttachment, samplePdfAttachment],
      onRemove: mockAttachmentCallbacks.onRemove,
    }),
  },
  {
    id: 'setup-auth-banner',
    name: 'SetupAuthBanner',
    category: 'Chat',
    description: 'Shows when an agent needs activation or authentication',
    component: SetupAuthBanner,
    props: [
      {
        name: 'state',
        description: 'Banner state',
        control: {
          type: 'select',
          options: [
            { label: 'Hidden', value: 'hidden' },
            { label: 'MCP Auth', value: 'mcp_auth' },
            { label: 'API Auth', value: 'api_auth' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'mcp_auth',
      },
      {
        name: 'reason',
        description: 'Custom reason message',
        control: { type: 'string', placeholder: 'Optional custom reason' },
        defaultValue: '',
      },
    ],
    variants: [
      { name: 'MCP Auth', props: { state: 'mcp_auth' } },
      { name: 'API Auth', props: { state: 'api_auth' } },
      { name: 'Custom Reason', props: { state: 'api_auth', reason: 'Your OAuth token has expired. Please re-authenticate to continue.' } },
      { name: 'Error', props: { state: 'error' } },
      { name: 'Hidden', props: { state: 'hidden' } },
    ],
    mockData: () => ({
      onAction: () => console.log('[Playground] Setup/Auth action clicked'),
    }),
  },
  {
    id: 'active-option-badges',
    name: 'ActiveOptionBadges',
    category: 'Chat',
    description: 'Shows active options (ultrathink, permission mode) and background tasks as badge pills above chat input',
    component: ActiveOptionBadges,
    props: [
      {
        name: 'ultrathinkEnabled',
        description: 'Show ultrathink badge',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'permissionMode',
        description: 'Current permission mode',
        control: {
          type: 'select',
          options: [
            { label: 'Safe Mode', value: 'safe' },
            { label: 'Ask Permission', value: 'ask' },
            { label: 'Allow All', value: 'allow-all' },
          ],
        },
        defaultValue: 'ask',
      },
      {
        name: 'variant',
        description: 'Interaction variant',
        control: {
          type: 'select',
          options: [
            { label: 'Dropdown', value: 'dropdown' },
            { label: 'Cycle', value: 'cycle' },
          ],
        },
        defaultValue: 'dropdown',
      },
    ],
    variants: [
      { name: 'Ultrathink Only', props: { ultrathinkEnabled: true, permissionMode: 'ask', tasks: [], sessionId: 'session-1' } },
      { name: 'Permission Mode (Ask)', props: { ultrathinkEnabled: false, permissionMode: 'ask', tasks: [], sessionId: 'session-1' } },
      { name: 'Permission Mode (Safe)', props: { ultrathinkEnabled: false, permissionMode: 'safe', tasks: [], sessionId: 'session-1' } },
      { name: 'Permission Mode (Allow All)', props: { ultrathinkEnabled: false, permissionMode: 'allow-all', tasks: [], sessionId: 'session-1' } },
      { name: 'Single Task', props: { ultrathinkEnabled: false, permissionMode: 'ask', tasks: singleBackgroundTask, sessionId: 'session-1' } },
      { name: 'Multiple Tasks', props: { ultrathinkEnabled: false, permissionMode: 'ask', tasks: sampleBackgroundTasks, sessionId: 'session-1' } },
      { name: 'Long Running Tasks', props: { ultrathinkEnabled: false, permissionMode: 'ask', tasks: longRunningTasks, sessionId: 'session-1' } },
      { name: 'All Active (Everything)', props: { ultrathinkEnabled: true, permissionMode: 'ask', tasks: sampleBackgroundTasks, sessionId: 'session-1' } },
      { name: 'Tasks in Safe Mode', props: { ultrathinkEnabled: false, permissionMode: 'safe', tasks: sampleBackgroundTasks, sessionId: 'session-1' } },
      { name: 'Cycle Variant', props: { ultrathinkEnabled: false, permissionMode: 'ask', tasks: sampleBackgroundTasks, variant: 'cycle', sessionId: 'session-1' } },
    ],
    mockData: () => ({
      tasks: sampleBackgroundTasks,
      sessionId: 'session-playground',
      onUltrathinkChange: (enabled: boolean) => console.log('[Playground] Ultrathink changed:', enabled),
      onPermissionModeChange: (mode: string) => console.log('[Playground] Permission mode changed:', mode),
      onKillTask: (taskId: string) => console.log('[Playground] Kill task:', taskId),
    }),
  },
  {
    id: 'permission-input-toggle',
    name: 'Permission ↔ Input Toggle',
    category: 'Chat',
    description: 'Interactive test for animating between Permission Banner and Input View. Click buttons to toggle states and inspect animations.',
    component: PermissionInputToggle,
    props: [
      {
        name: 'useLongCommand',
        description: 'Use a very long multi-line command',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'autoToggle',
        description: 'Automatically toggle between states',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'autoToggleInterval',
        description: 'Auto-toggle interval in milliseconds',
        control: { type: 'number', min: 1000, max: 10000, step: 500 },
        defaultValue: 3000,
      },
    ],
    variants: [
      { name: 'Short Command', props: { useLongCommand: false } },
      { name: 'Long Command (10+ lines)', props: { useLongCommand: true } },
      { name: 'Auto Toggle', props: { autoToggle: true, autoToggleInterval: 2000 } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'turn-card-flat',
    name: 'TurnCard (Flat Tools)',
    category: 'Turn Cards',
    description: 'TurnCard with flat tool hierarchy - no nesting, all tools at root level',
    component: TurnCard,
    props: [],
    variants: [
      { name: 'Default', props: {} },
    ],
    mockData: () => ({
      activities: flatActivities,
      response: { text: 'I found the pattern across the codebase and made the necessary edits.', isStreaming: false },
      isStreaming: false,
      isComplete: true,
    }),
  },
  {
    id: 'turn-card-nested-complete',
    name: 'TurnCard (Nested - Complete)',
    category: 'Turn Cards',
    description: 'TurnCard showing Task subagent with completed child tools - vertical line tree view',
    component: TurnCard,
    props: [],
    variants: [
      { name: 'Default', props: {} },
    ],
    mockData: () => ({
      activities: nestedActivitiesCompleted,
      response: { text: 'Exploration complete. I found 24 React components with 156 exported functions. The codebase follows a modular pattern.', isStreaming: false },
      isStreaming: false,
      isComplete: true,
    }),
  },
  {
    id: 'turn-card-nested-progress',
    name: 'TurnCard (Nested - In Progress)',
    category: 'Turn Cards',
    description: 'TurnCard showing Task subagent with child tools still running',
    component: TurnCard,
    props: [],
    variants: [
      { name: 'Default', props: {} },
    ],
    mockData: () => ({
      activities: nestedActivitiesInProgress,
      isStreaming: true,
      isComplete: false,
    }),
  },
  {
    id: 'turn-card-multi-task',
    name: 'TurnCard (Multiple Tasks)',
    category: 'Turn Cards',
    description: 'TurnCard showing multiple sequential Task subagents, each with their own child tools',
    component: TurnCard,
    props: [],
    variants: [
      { name: 'Default', props: {} },
    ],
    mockData: () => ({
      activities: multipleNestedTasks,
      response: { text: 'Analysis and fixes complete. I found 23 TODO/FIXME issues, removed deprecated code, and created a modern replacement component.', isStreaming: false },
      isStreaming: false,
      isComplete: true,
    }),
  },
  {
    id: 'turn-card-deep-nested',
    name: 'TurnCard (Deep Nesting)',
    category: 'Turn Cards',
    description: 'TurnCard showing 2+ levels of nesting - Task containing another Task with tools',
    component: TurnCard,
    props: [],
    variants: [
      { name: 'Default', props: {} },
    ],
    mockData: () => ({
      activities: deepNestedActivities,
      response: { text: 'Authentication refactoring complete. I implemented OAuth with PKCE, created a callback handler, and all tests pass.', isStreaming: false },
      isStreaming: false,
      isComplete: true,
    }),
  },
  {
    id: 'active-tasks-bar-context',
    name: 'Active Tasks & Badges',
    category: 'Chat',
    description: 'Integrated display of option badges (ultrathink, permission mode) and background tasks in a horizontally scrollable row. Shows full chat context with messages above and input below.',
    component: ActiveTasksBarContext,
    layout: 'full',
    props: [],
    variants: [
      { name: 'With Multiple Tasks', props: { tasks: sampleBackgroundTasks } },
      { name: 'With Single Task', props: { tasks: singleBackgroundTask } },
      { name: 'With Long Running Tasks', props: { tasks: longRunningTasks } },
      { name: 'Empty (Hidden)', props: { tasks: [] } },
    ],
    mockData: () => ({
      tasks: sampleBackgroundTasks,
    }),
  },
  {
    id: 'input-container',
    name: 'InputContainer',
    category: 'Chat Inputs',
    description: 'Full-featured chat input with attachments, model selector, slash commands, permission mode, sources, and working directory',
    component: InputContainer,
    layout: 'full',
    props: [
      {
        name: 'disabled',
        description: 'Disable all inputs',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'isProcessing',
        description: 'Show processing state (disables send, shows stop)',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'placeholder',
        description: 'Textarea placeholder text',
        control: { type: 'string', placeholder: 'Message...' },
        defaultValue: 'Message Craft Agent...',
      },
      {
        name: 'currentModel',
        description: 'Current selected model',
        control: {
          type: 'select',
          options: [
            { label: 'Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' },
            { label: 'Opus 4.6', value: 'claude-opus-4-6' },
            { label: 'Haiku 3.5', value: 'claude-3-5-haiku-20241022' },
          ],
        },
        defaultValue: 'claude-sonnet-4-5-20250929',
      },
      {
        name: 'permissionMode',
        description: 'Permission mode badge',
        control: {
          type: 'select',
          options: [
            { label: 'Safe (read-only)', value: 'safe' },
            { label: 'Ask (prompt)', value: 'ask' },
            { label: 'Allow All', value: 'allow-all' },
          ],
        },
        defaultValue: 'ask',
      },
      {
        name: 'ultrathinkEnabled',
        description: 'Show ultrathink toggle',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'workingDirectory',
        description: 'Current working directory',
        control: { type: 'string', placeholder: '/path/to/project' },
        defaultValue: '/Users/demo/projects/craft-agent',
      },
    ],
    mockData: () => {
      // Ensure electronAPI is available
      ensureMockElectronAPI()

      return {
        sources: mockSources,
        enabledSourceSlugs: ['github-api', 'local-files'],
        sessionId: 'playground-session',
        ...mockInputCallbacks,
      }
    },
    variants: [
      {
        name: 'Default',
        description: 'Normal state',
        props: {},
      },
      {
        name: 'Processing',
        description: 'While agent is processing',
        props: {
          isProcessing: true,
        },
      },
      {
        name: 'Safe Mode',
        description: 'Read-only permission mode',
        props: {
          permissionMode: 'safe',
        },
      },
      {
        name: 'Ultrathink',
        description: 'With ultrathink enabled',
        props: {
          ultrathinkEnabled: true,
        },
      },
      {
        name: 'Disabled',
        description: 'Fully disabled',
        props: {
          disabled: true,
        },
      },
    ],
  },
]
