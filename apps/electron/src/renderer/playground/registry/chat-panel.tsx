/**
 * The chat panel as ChatPage composes it, ChatHeader above a desktop ChatDisplay, for a Coding-mode
 * session with a PR watcher state from fixtures, or for a task that hasn't run (its transcript shows
 * the task brief, served by the playground's `getTask` mock). Resize the preview box to see the
 * header give way: the folder name truncates first, then the session title. Messages sent here (the
 * composer, or the PR card's Fix) are appended to the transcript as user turns; no agent answers.
 */

import * as React from 'react'
import { X } from 'lucide-react'
import type { Message } from '@craft-agent/core/types'
import { ChatDisplay } from '@/components/app-shell/ChatDisplay'
import { ChatHeader } from '@/components/app-shell/chat-header/ChatHeader'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import type { SessionMeta } from '@/atoms/sessions'
import type { AppShellContextType } from '@/context/AppShellContext'
import type { PermissionMode, Session } from '../../../shared/types'
import { PlaygroundSessionProviders } from '../PlaygroundSessionProviders'
import { ensureMockElectronAPI } from '../mock-utils'
import { CHAT_HEADER_LABELS, CHAT_HEADER_LABEL_ENTRIES, CHAT_HEADER_STATUSES } from './chat-header'
import { PR_SCENARIO_OPTIONS, useMockPrWatch, type PrScenario } from './samples/pr-watch'
import { TASK_SPEC_SAMPLES, TASK_SPEC_SAMPLE_OPTIONS, type TaskSpecSample } from './samples/task-specs'
import type { ComponentEntry } from './types'

const WORKSPACE_ID = 'playground-workspace'
const WORKSPACE_SLUG = 'playground'
const SESSION_ID = 'playground-coding-panel'
const WORKING_DIRECTORY = '/Users/demo/craft-agents'
const SESSION_FOLDER = `/mock/workspaces/${WORKSPACE_ID}/sessions/${SESSION_ID}`

const SHORT_TITLE = 'PR watcher in the chat header'
const LONG_TITLE = 'Wire the Coding-mode PR watcher into the chat header and keep the label strip from crushing the title'

const MINUTE = 60_000
const now = Date.now()

const CODING_MESSAGES: Message[] = [
  {
    id: 'cp-user-1',
    role: 'user',
    content: 'The label strip test is flaky on CI. Fix it and open a PR.',
    timestamp: now - 18 * MINUTE,
  },
  {
    id: 'cp-asst-1',
    role: 'assistant',
    content:
      'The test measured chips before fonts loaded, so the first width read was 0. ' +
      'I made the fit rule a pure function and test it with fixed widths:\n\n' +
      '```ts\n' +
      'expect(headerLabelFitCount([50, 40, 30, 20], 1000, 24, 4, 1)).toBe(1)\n' +
      '```\n\n' +
      'Committed as `fix(chat-header): pure label fit rule` and opened **#481** against `main`.',
    timestamp: now - 15 * MINUTE,
    turnId: 'cp-turn-1',
  },
  {
    id: 'cp-user-2',
    role: 'user',
    content: 'CI says typecheck fails. Can you look?',
    timestamp: now - 4 * MINUTE,
  },
  {
    id: 'cp-asst-2',
    role: 'assistant',
    content:
      'Yes: `labelStripBudget` gained a `reserved` parameter and one caller still passed the old shape. ' +
      'Fixed locally; the commit is not pushed yet.',
    timestamp: now - 2 * MINUTE,
    turnId: 'cp-turn-2',
  },
]

const log = (label: string) => (...args: unknown[]) => console.log(`[Playground ChatPanel] ${label}`, args)

function createStubSession(id: string): Session {
  return { id, workspaceId: WORKSPACE_ID, workspaceName: 'Playground', lastMessageAt: Date.now(), messages: [], isProcessing: false }
}

interface ChatPanelDemoProps {
  prScenario?: PrScenario
  codingMode?: boolean
  labelCount?: number
  longTitle?: boolean
  compact?: boolean
  /** A task orchestrator that hasn't run: no messages, so the transcript shows its brief */
  task?: TaskSpecSample
}

function ChatPanelDemo({
  task,
  // A task session defaults to the standard mode, so no PR chip
  prScenario = task ? 'none' : 'open-passing',
  codingMode = !task,
  labelCount = 3,
  longTitle = false,
  compact = false,
}: ChatPanelDemoProps) {
  React.useEffect(() => {
    ensureMockElectronAPI()
  }, [])

  const [status, setStatus] = React.useState(task ? 'todo' : 'in-progress')
  const [labels, setLabels] = React.useState(() => CHAT_HEADER_LABEL_ENTRIES.slice(0, labelCount))
  React.useEffect(() => setLabels(CHAT_HEADER_LABEL_ENTRIES.slice(0, labelCount)), [labelCount])
  const [model, setModel] = React.useState('claude-opus-5-5')
  const [mode, setMode] = React.useState<PermissionMode>('ask')
  const [input, setInput] = React.useState('')
  const pr = useMockPrWatch(prScenario)
  const [messages, setMessages] = React.useState<Message[]>(() => (task ? [] : CODING_MESSAGES))
  React.useEffect(() => setMessages(task ? [] : CODING_MESSAGES), [task])
  const appendUserMessage = React.useCallback((content: string) => {
    log('send')(content)
    setMessages(current => [...current, { id: `cp-sent-${current.length}`, role: 'user', content, timestamp: Date.now() }])
  }, [])

  const name = task ? TASK_SPEC_SAMPLES[task].title : longTitle ? LONG_TITLE : SHORT_TITLE

  const session = React.useMemo<Session>(() => ({
    id: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    workspaceName: 'Playground',
    name,
    messages,
    isProcessing: false,
    lastMessageAt: now - 2 * MINUTE,
    permissionMode: mode,
    sessionStatus: status,
    labels,
    workingDirectory: WORKING_DIRECTORY,
    sessionFolderPath: SESSION_FOLDER,
    codingMode,
    taskSlug: task,
    createdAt: now - 20 * MINUTE,
  }), [name, messages, mode, status, labels, codingMode, task])

  const meta = React.useMemo<SessionMeta>(() => ({
    id: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    name,
    labels,
    sessionStatus: status,
    workingDirectory: WORKING_DIRECTORY,
    codingMode,
    taskSlug: task,
    lastMessageAt: now - 2 * MINUTE,
  }), [name, labels, status, codingMode, task])
  const sessions = React.useMemo(() => [meta], [meta])

  const appShell = React.useMemo<Partial<AppShellContextType>>(() => ({
    sessionStatuses: CHAT_HEADER_STATUSES,
    labels: CHAT_HEADER_LABELS,
    onSessionStatusChange: (_id: string, next: string) => setStatus(next),
    onSessionLabelsChange: (_id: string, next: string[]) => setLabels(next),
    onOpenUrl: log('onOpenUrl'),
    onSendMessage: (_id: string, message: string) => appendUserMessage(message),
    rightSidebarButton: <PanelHeaderCenterButton icon={<X className="h-4 w-4" />} tooltip="Close" />,
  }), [appendUserMessage])

  return (
    <PlaygroundSessionProviders
      workspaceId={WORKSPACE_ID}
      workspaceSlug={WORKSPACE_SLUG}
      compact={compact}
      session={session}
      sessions={sessions}
      appShell={appShell}
      createStubSession={createStubSession}
    >
      {/* The shell and panel containers the header's compact sizes and container queries read */}
      <div className="@container/shell h-full w-full">
        <div data-compact={compact || undefined} className="@container/panel flex h-full w-full flex-col bg-paper">
          <ChatHeader
            sessionId={SESSION_ID}
            item={meta}
            title={name}
            workingDirectory={WORKING_DIRECTORY}
            sessionFolderPath={SESSION_FOLDER}
            prWatch={pr.state}
            prWatchNav={pr.nav}
            prWatchActiveOrigin={pr.activeOrigin}
            onRefreshPrWatch={pr.refresh}
            onUnbindPr={pr.unbind}
            onSetPrAutoMerge={pr.setAutoMerge}
            prWatchAutoFix={pr.autoFix}
            onSetPrAutoFix={pr.setAutoFix}
            onPrCardOpenChange={pr.onCardOpenChange}
          />
          <div className="flex min-h-0 flex-1 flex-col">
            <ChatDisplay
              session={session}
              onSendMessage={appendUserMessage}
              onOpenFile={log('onOpenFile')}
              onOpenUrl={log('onOpenUrl')}
              currentModel={model}
              onModelChange={setModel}
              permissionMode={mode}
              onPermissionModeChange={setMode}
              inputValue={input}
              onInputChange={setInput}
              sources={[]}
              onSourcesChange={log('onSourcesChange')}
              skills={[]}
              labels={CHAT_HEADER_LABELS}
              onLabelsChange={setLabels}
              workspaceId={WORKSPACE_ID}
              workingDirectory={WORKING_DIRECTORY}
              sessionFolderPath={SESSION_FOLDER}
              codingMode={codingMode}
              compactMode={compact}
              enableCompactModelPicker={compact}
            />
          </div>
        </div>
      </div>
    </PlaygroundSessionProviders>
  )
}

export const chatPanelComponents: ComponentEntry[] = [
  {
    id: 'chat-panel-coding-mode',
    name: 'Chat panel · Coding mode',
    category: 'Chat',
    description: 'ChatHeader + ChatDisplay for a Coding-mode session: PR chip (hover opens the card, click pins it; its action is Resolve > Fix > Fix CI > tick) and one label chip + "+N".',
    component: ChatPanelDemo,
    layout: 'full',
    props: [
      { name: 'prScenario', description: 'PR watcher state', control: { type: 'select', options: PR_SCENARIO_OPTIONS }, defaultValue: 'open-passing' },
      { name: 'codingMode', description: 'Coding mode (off: no PR chip, up to three label chips)', control: { type: 'boolean' }, defaultValue: true },
      { name: 'labelCount', description: 'Labels on the session (0–6)', control: { type: 'number', min: 0, max: 6, step: 1 }, defaultValue: 3 },
      { name: 'longTitle', description: 'Long session title', control: { type: 'boolean' }, defaultValue: false },
      { name: 'compact', description: 'Compact shell (phone): the chip is hidden', control: { type: 'boolean' }, defaultValue: false },
    ],
    variants: [
      { name: 'All good (tick)', props: { prScenario: 'open-passing' } },
      { name: 'Checks running', props: { prScenario: 'open-running' } },
      { name: 'Checks failing (Fix CI)', props: { prScenario: 'open-failing' } },
      { name: 'Changes requested (Fix)', props: { prScenario: 'changes-requested' } },
      { name: 'Comments, open threads (Fix)', props: { prScenario: 'open-threads' } },
      { name: 'Approved, open thread (Fix)', props: { prScenario: 'approved-with-threads' } },
      { name: 'Unpushed + uncommitted (orange tick)', props: { prScenario: 'unpushed' } },
      { name: 'Draft', props: { prScenario: 'draft' } },
      { name: 'Merged', props: { prScenario: 'merged' } },
      { name: 'Merge conflicts (Resolve)', props: { prScenario: 'conflicting' } },
      { name: 'Conflicts + review + CI (Resolve first)', props: { prScenario: 'everything-wrong' } },
      { name: 'Card details loading', props: { prScenario: 'details-loading' } },
      { name: 'Long title, 6 labels', props: { prScenario: 'long-title', longTitle: true, labelCount: 6 } },
      { name: 'First lookup running (hidden)', props: { prScenario: 'loading' } },
      { name: 'Not a git repo (hidden)', props: { prScenario: 'not-git' } },
      { name: 'No PR (hidden)', props: { prScenario: 'none' } },
      { name: 'Standard mode (no chip)', props: { codingMode: false } },
      { name: 'Compact', props: { compact: true } },
    ],
  },
  {
    id: 'chat-panel-task',
    name: 'Chat panel · Task',
    category: 'Chat',
    description: 'ChatHeader + ChatDisplay for a task that hasn\'t run: the transcript shows the task brief from task.yaml (Run task, Edit task) instead of the new-chat empty state. Sending a message replaces it with the transcript.',
    component: ChatPanelDemo,
    layout: 'full',
    props: [
      { name: 'task', description: 'task.yaml sample (served by the getTask mock)', control: { type: 'select', options: TASK_SPEC_SAMPLE_OPTIONS }, defaultValue: 'gitignore-the-workspace' },
      { name: 'labelCount', description: 'Labels on the session (0–6)', control: { type: 'number', min: 0, max: 6, step: 1 }, defaultValue: 2 },
      { name: 'compact', description: 'Compact shell (phone)', control: { type: 'boolean' }, defaultValue: false },
    ],
    variants: [
      { name: 'Created by an agent', props: { task: 'gitignore-the-workspace' } },
      { name: 'Four subtasks', props: { task: 'ship-the-release' } },
      { name: 'Long markdown goal', props: { task: 'audit-auth' } },
      { name: 'Already running (Run fails)', props: { task: 'already-running' } },
      { name: 'Compact', props: { task: 'ship-the-release', compact: true } },
    ],
  },
]
