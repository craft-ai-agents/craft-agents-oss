/**
 * Hooks Playground Registry
 *
 * Registry entries for all hook UI components with comprehensive mock data
 * and playground variants for testing every visual state.
 */

import { useState, type ReactNode } from 'react'
import type { ComponentEntry } from './types'
import { HooksListPanel } from '@/components/hooks/HooksListPanel'
import { HookInfoPage } from '@/components/hooks/HookInfoPage'
import { HookCard } from '@/components/hooks/HookCard'
import { HookAvatar } from '@/components/hooks/HookAvatar'
import { CronBuilder } from '@/components/hooks/CronBuilder'
import { HookTestPanel } from '@/components/hooks/HookTestPanel'
import { HookEventTimeline } from '@/components/hooks/HookEventTimeline'
import { getEventDisplayName, type HookListItem, type ExecutionEntry, type TestResult, type HookEvent } from '@/components/hooks/types'

// ============================================================================
// Wrappers
// ============================================================================

function PaddedWrapper({ children }: { children: ReactNode }) {
  return <div className="p-6">{children}</div>
}

/** Stateful wrapper for HooksListPanel */
function HooksListPanelPlayground({
  hooks,
  selectedHookId: initialSelectedId,
}: {
  hooks: HookListItem[]
  selectedHookId?: string | null
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null)
  const [hookList, setHookList] = useState(hooks)

  return (
    <HooksListPanel
      hooks={hookList}
      selectedHookId={selectedId}
      onHookClick={(id) => setSelectedId(id)}
      onDeleteHook={(id) => {
        setHookList(prev => prev.filter(h => h.id !== id))
        if (selectedId === id) setSelectedId(null)
      }}
      onToggleHook={(id) => {
        setHookList(prev => prev.map(h =>
          h.id === id ? { ...h, enabled: !h.enabled } : h
        ))
      }}
      onTestHook={(id) => console.log('[Playground] Test hook:', id)}
      onDuplicateHook={(id) => console.log('[Playground] Duplicate hook:', id)}
    />
  )
}

/** Stateful wrapper for HookInfoPage with test simulation */
function HookInfoPagePlayground({
  hook,
  executions,
}: {
  hook: HookListItem
  executions?: ExecutionEntry[]
}) {
  const [currentHook, setCurrentHook] = useState(hook)
  const [testResult, setTestResult] = useState<TestResult>({ state: 'idle' })

  const handleTest = () => {
    setTestResult({ state: 'running' })
    setTimeout(() => {
      setTestResult({
        state: 'success',
        stdout: 'Automation executed successfully.\nOutput: OK',
        duration: 42,
      })
    }, 1500)
  }

  return (
    <HookInfoPage
      hook={currentHook}
      executions={executions}
      testResult={testResult}
      onToggleEnabled={() => setCurrentHook(prev => ({ ...prev, enabled: !prev.enabled }))}
      onTest={handleTest}
      onDuplicate={() => console.log('[Playground] Duplicate')}
      onDelete={() => console.log('[Playground] Delete')}
    />
  )
}

/** Stateful wrapper for CronBuilder */
function CronBuilderPlayground({
  initialValue,
  timezone,
}: {
  initialValue?: string
  timezone?: string
}) {
  const [value, setValue] = useState(initialValue ?? '0 9 * * 1-5')

  return (
    <CronBuilder
      value={value}
      onChange={setValue}
      timezone={timezone}
    />
  )
}

/** Wrapper showing all HookAvatar variants in a grid */
function HookAvatarGallery() {
  const events: HookEvent[] = [
    'SchedulerTick', 'LabelAdd', 'LabelRemove', 'LabelConfigChange',
    'PermissionModeChange', 'FlagChange', 'TodoStateChange',
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'Notification', 'UserPromptSubmit', 'SessionStart', 'SessionEnd',
    'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact',
    'PermissionRequest', 'Setup',
  ]

  return (
    <div className="space-y-6">
      {/* Size variants */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Sizes</h4>
        <div className="flex items-end gap-4">
          {(['xs', 'sm', 'md', 'lg'] as const).map(size => (
            <div key={size} className="flex flex-col items-center gap-1">
              <HookAvatar event="SchedulerTick" size={size} />
              <span className="text-[10px] text-muted-foreground">{size}</span>
            </div>
          ))}
        </div>
      </div>

      {/* All event types */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">All Events</h4>
        <div className="grid grid-cols-4 gap-3">
          {events.map(event => (
            <div key={event} className="flex items-center gap-2">
              <HookAvatar event={event} size="md" />
              <span className="text-xs text-foreground/70 truncate">{getEventDisplayName(event)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Stateful wrapper for HookCard */
function HookCardPlayground({
  hook,
  defaultExpanded,
}: {
  hook: HookListItem
  defaultExpanded?: boolean
}) {
  const [currentHook, setCurrentHook] = useState(hook)

  return (
    <HookCard
      hook={currentHook}
      defaultExpanded={defaultExpanded}
      onToggleEnabled={(enabled) => setCurrentHook(prev => ({ ...prev, enabled }))}
      onTest={() => console.log('[Playground] Test hook:', currentHook.id)}
    />
  )
}

// ============================================================================
// Mock Data
// ============================================================================

const now = Date.now()

const mockHooks: HookListItem[] = [
  {
    id: 'hook-1',
    event: 'SchedulerTick',
    name: 'Daily Weather Report',
    summary: 'Weekdays at 9:00 AM',
    enabled: true,
    cron: '0 9 * * 1-5',
    timezone: 'Europe/Budapest',
    hooks: [{ type: 'prompt', prompt: 'Run the @weather skill and give me today\'s forecast for Budapest' }],
    labels: ['Scheduled', 'weather'],
    permissionMode: 'safe',
    lastExecutedAt: now - 120_000, // 2 minutes ago
  },
  {
    id: 'hook-2',
    event: 'LabelAdd',
    name: 'Urgent Label Notification',
    summary: 'When "urgent" label is added',
    enabled: true,
    matcher: '^urgent$',
    hooks: [{ type: 'command', command: 'osascript -e \'display notification "Urgent task flagged!" with title "Craft Agent"\'' }],
    permissionMode: 'allow-all',
    lastExecutedAt: now - 300_000, // 5 minutes ago
  },
  {
    id: 'hook-3',
    event: 'PreToolUse',
    name: 'Git Pre-commit Check',
    summary: 'Before any Bash tool use',
    enabled: false,
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'git diff --cached --check', timeout: 30 }],
    permissionMode: 'safe',
  },
  {
    id: 'hook-4',
    event: 'LabelAdd',
    name: 'Label Change Logger',
    summary: 'Logs all label additions',
    enabled: true,
    hooks: [{ type: 'command', command: 'echo "[$(date)] Added: $CRAFT_LABEL" >> ~/label-log.txt' }],
    permissionMode: 'allow-all',
    lastExecutedAt: now - 3600_000, // 1 hour ago
  },
  {
    id: 'hook-5',
    event: 'SchedulerTick',
    name: 'Hourly Health Check',
    summary: 'Every hour',
    enabled: true,
    cron: '0 * * * *',
    hooks: [
      { type: 'command', command: 'curl -s https://api.example.com/health' },
      { type: 'prompt', prompt: 'Analyze the health check result and alert if there are issues' },
    ],
    labels: ['Monitoring'],
    lastExecutedAt: now - 900_000, // 15 minutes ago
  },
  {
    id: 'hook-6',
    event: 'PostToolUse',
    name: 'Build Artifact Logger',
    summary: 'After Bash tool completes',
    enabled: true,
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'echo "[$(date)] Tool completed: $TOOL_NAME" >> ~/build-log.txt' }],
    lastExecutedAt: now - 172800_000, // 2 days ago
  },
  {
    id: 'hook-7',
    event: 'SessionStart',
    name: 'Welcome Prompt',
    summary: 'Greet on new session',
    enabled: true,
    hooks: [{ type: 'prompt', prompt: 'Welcome! Check if there are any pending @linear issues assigned to me.' }],
    labels: ['Onboarding'],
    lastExecutedAt: now - 7200_000, // 2 hours ago
  },
  {
    id: 'hook-8',
    event: 'PostToolUseFailure',
    name: 'Error Alert',
    summary: 'Notify on tool failures',
    enabled: true,
    hooks: [{ type: 'command', command: 'osascript -e \'display notification "Tool failed: $TOOL_NAME" with title "Error"\'' }],
    permissionMode: 'allow-all',
    lastExecutedAt: now - 86400_000, // 1 day ago
  },
]

const mockExecutions: ExecutionEntry[] = [
  { id: 'ex-1', hookId: 'hook-1', event: 'SchedulerTick', status: 'success', duration: 42, timestamp: now - 120_000, actionSummary: 'prompt → @weather forecast' },
  { id: 'ex-2', hookId: 'hook-4', event: 'LabelAdd', status: 'success', duration: 8, timestamp: now - 300_000, actionSummary: 'echo "[...] Added: urgent"' },
  { id: 'ex-3', hookId: 'hook-5', event: 'SchedulerTick', status: 'error', duration: 1200, timestamp: now - 900_000, error: 'Connection refused' },
  { id: 'ex-4', hookId: 'hook-3', event: 'PreToolUse', status: 'blocked', duration: 0, timestamp: now - 3600_000, actionSummary: 'git diff --cached --check' },
  { id: 'ex-5', hookId: 'hook-1', event: 'SchedulerTick', status: 'success', duration: 38, timestamp: now - 86400_000, actionSummary: 'prompt → @weather forecast' },
  { id: 'ex-6', hookId: 'hook-6', event: 'PostToolUse', status: 'success', duration: 5, timestamp: now - 172800_000, actionSummary: 'echo "[...] Tool completed: Bash"' },
]

const testResultSuccess: TestResult = {
  state: 'success',
  stdout: 'Automation executed successfully.\nOutput: {"status":"ok","temperature":"12°C"}',
  duration: 42,
}

const testResultError: TestResult = {
  state: 'error',
  stderr: 'curl: (7) Failed to connect to api.example.com port 443: Connection refused',
  exitCode: 7,
  duration: 1200,
}

const testResultBlocked: TestResult = {
  state: 'blocked',
  blockedReason: 'The action "rm -rf /tmp/cache" is not allowed in Safe Mode. Switch to Ask First or Allow All to run it.',
}

const testResultRunning: TestResult = {
  state: 'running',
}

// ============================================================================
// Registry Entries
// ============================================================================

export const hookComponents: ComponentEntry[] = [
  // ==========================================================================
  // HooksListPanel
  // ==========================================================================
  {
    id: 'hooks-list-panel',
    name: 'HooksListPanel',
    category: 'Automations',
    description: 'Navigator panel with automation list, filters, and contextual actions',
    component: HooksListPanelPlayground,
    layout: 'full',
    props: [
      {
        name: 'selectedHookId',
        description: 'Currently selected automation ID',
        control: { type: 'string', placeholder: 'e.g., hook-1' },
        defaultValue: null,
      },
    ],
    variants: [
      {
        name: 'Default (All)',
        description: '8 automations with mixed states',
        props: { hooks: mockHooks, selectedHookId: 'hook-1' },
      },
      {
        name: 'Empty State',
        description: 'No automations configured',
        props: { hooks: [], selectedHookId: null },
      },
      {
        name: 'Few Items (3)',
        description: 'Small list without scrolling',
        props: { hooks: mockHooks.slice(0, 3), selectedHookId: null },
      },
      {
        name: 'With Selection',
        description: 'Second automation selected',
        props: { hooks: mockHooks, selectedHookId: 'hook-2' },
      },
      {
        name: 'Mixed Enabled/Disabled',
        description: 'Shows disabled automations dimmed',
        props: {
          hooks: mockHooks.map((h, i) => ({ ...h, enabled: i % 2 === 0 })),
          selectedHookId: null,
        },
      },
    ],
    mockData: () => ({
      hooks: mockHooks,
    }),
  },

  // ==========================================================================
  // HookInfoPage
  // ==========================================================================
  {
    id: 'hook-info-page',
    name: 'HookInfoPage',
    category: 'Automations',
    description: 'Detail view using Info_Page with When/Then/Settings sections',
    component: HookInfoPagePlayground,
    layout: 'full',
    props: [],
    variants: [
      {
        name: 'Scheduled',
        description: 'Recurring schedule with timezone and upcoming runs',
        props: { hook: mockHooks[0], executions: mockExecutions.filter(e => e.hookId === 'hook-1') },
      },
      {
        name: 'Label Event',
        description: 'Triggered when a label is added, with filter and command',
        props: { hook: mockHooks[1], executions: mockExecutions.filter(e => e.hookId === 'hook-2') },
      },
      {
        name: 'Before Tool Runs (Disabled)',
        description: 'Pre-tool automation with filter, showing disabled state warning',
        props: { hook: mockHooks[2], executions: mockExecutions.filter(e => e.hookId === 'hook-3') },
      },
      {
        name: 'Multi-Action',
        description: 'Automation with both command and prompt actions',
        props: { hook: mockHooks[4], executions: mockExecutions.filter(e => e.hookId === 'hook-5') },
      },
      {
        name: 'Session Start',
        description: 'Prompt automation with @mentions and labels',
        props: { hook: mockHooks[6], executions: [] },
      },
      {
        name: 'Error Handler',
        description: 'Runs when a tool fails',
        props: { hook: mockHooks[7], executions: [] },
      },
      {
        name: 'With Full History',
        description: 'All 6 execution entries visible',
        props: { hook: mockHooks[0], executions: mockExecutions },
      },
    ],
    mockData: () => ({
      hook: mockHooks[0],
      executions: mockExecutions,
    }),
  },

  // ==========================================================================
  // HookCard
  // ==========================================================================
  {
    id: 'hook-card',
    name: 'HookCard',
    category: 'Automations',
    description: 'Expandable inline row with trigger/action preview',
    component: HookCardPlayground,
    wrapper: PaddedWrapper,
    layout: 'top',
    props: [
      {
        name: 'defaultExpanded',
        description: 'Start expanded',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      {
        name: 'Collapsed',
        description: 'Default collapsed state',
        props: { hook: mockHooks[0], defaultExpanded: false },
      },
      {
        name: 'Expanded',
        description: 'Expanded with trigger and action details',
        props: { hook: mockHooks[0], defaultExpanded: true },
      },
      {
        name: 'Disabled',
        description: 'Disabled automation (dimmed)',
        props: { hook: mockHooks[2], defaultExpanded: true },
      },
      {
        name: 'Command Action',
        description: 'Automation with command action',
        props: { hook: mockHooks[1], defaultExpanded: true },
      },
      {
        name: 'Multi-Action',
        description: 'Automation with both command and prompt',
        props: { hook: mockHooks[4], defaultExpanded: true },
      },
    ],
    mockData: () => ({
      hook: mockHooks[0],
    }),
  },

  // ==========================================================================
  // CronBuilder
  // ==========================================================================
  {
    id: 'cron-builder',
    name: 'CronBuilder',
    category: 'Automations',
    description: 'Visual schedule builder with common presets and custom timing',
    component: CronBuilderPlayground,
    wrapper: PaddedWrapper,
    layout: 'top',
    props: [
      {
        name: 'timezone',
        description: 'IANA timezone',
        control: { type: 'string', placeholder: 'e.g., Europe/Budapest' },
        defaultValue: 'Europe/Budapest',
      },
    ],
    variants: [
      {
        name: 'Weekdays at 9am',
        description: 'Common work schedule',
        props: { initialValue: '0 9 * * 1-5', timezone: 'Europe/Budapest' },
      },
      {
        name: 'Every 15 Minutes',
        description: 'High-frequency schedule',
        props: { initialValue: '*/15 * * * *', timezone: 'UTC' },
      },
      {
        name: 'Daily at Midnight',
        description: 'Nightly batch job',
        props: { initialValue: '0 0 * * *', timezone: 'America/New_York' },
      },
      {
        name: 'Monthly on 1st',
        description: 'Monthly report schedule',
        props: { initialValue: '30 14 1 * *', timezone: 'Europe/London' },
      },
      {
        name: 'Every Minute',
        description: 'Maximum frequency',
        props: { initialValue: '* * * * *' },
      },
    ],
    mockData: () => ({
      initialValue: '0 9 * * 1-5',
      timezone: 'Europe/Budapest',
    }),
  },

  // ==========================================================================
  // HookAvatar Gallery
  // ==========================================================================
  {
    id: 'hook-avatar',
    name: 'HookAvatar',
    category: 'Automations',
    description: 'Event-categorized icons with size and color variants',
    component: HookAvatarGallery,
    wrapper: PaddedWrapper,
    layout: 'top',
    props: [],
    variants: [],
    mockData: () => ({}),
  },

  // ==========================================================================
  // HookTestPanel
  // ==========================================================================
  {
    id: 'hook-test-panel',
    name: 'HookTestPanel',
    category: 'Automations',
    description: 'Test execution result states (success, error, blocked, running)',
    component: HookTestPanel,
    wrapper: PaddedWrapper,
    layout: 'top',
    props: [],
    variants: [
      {
        name: 'Running',
        description: 'Test in progress with spinner',
        props: { result: testResultRunning },
      },
      {
        name: 'Success',
        description: 'Successful test with stdout output',
        props: { result: testResultSuccess },
      },
      {
        name: 'Error',
        description: 'Failed test with stderr and exit code',
        props: { result: testResultError },
      },
      {
        name: 'Blocked',
        description: 'Command blocked by permission mode',
        props: { result: testResultBlocked },
      },
    ],
    mockData: () => ({
      result: testResultSuccess,
    }),
  },

  // ==========================================================================
  // HookEventTimeline
  // ==========================================================================
  {
    id: 'hook-event-timeline',
    name: 'HookEventTimeline',
    category: 'Automations',
    description: 'Execution history with status, time, event, and duration',
    component: HookEventTimeline,
    wrapper: PaddedWrapper,
    layout: 'top',
    props: [],
    variants: [
      {
        name: 'Mixed Results',
        description: 'Success, error, and blocked entries',
        props: { entries: mockExecutions },
      },
      {
        name: 'All Success',
        description: 'All executions successful',
        props: {
          entries: mockExecutions
            .filter(e => e.status === 'success')
            .map((e, i) => ({ ...e, id: `success-${i}` })),
        },
      },
      {
        name: 'Empty',
        description: 'No executions yet',
        props: { entries: [] },
      },
    ],
    mockData: () => ({
      entries: mockExecutions,
    }),
  },
]
