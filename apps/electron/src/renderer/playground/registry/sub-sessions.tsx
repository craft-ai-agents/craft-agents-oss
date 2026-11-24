/**
 * Sub-sessions in the production SessionList. A session nests under the session that spawned it or
 * runs it as a task step (`parentSessionId`), else the session it was branched from
 * (`branchFromSessionId`), when that session is in the list too. Each family is grouped, sorted and
 * paged by its root, with the newest activity of any member. The chip on a parent row hides and shows
 * its sub-sessions; collapsed families are saved per workspace (localStorage), so they survive a reload.
 *
 * The row actions edit the fixtures: archive a parent to see its sub-sessions move to the top level.
 */

import * as React from 'react'
import type { SessionMeta } from '@/atoms/sessions'
import { SessionList, type ChatGroupingMode } from '@/components/app-shell/SessionList'
import { cn } from '@/lib/utils'
import type { Session } from '../../../shared/types'
import { PlaygroundSessionProviders } from '../PlaygroundSessionProviders'
import { ensureMockElectronAPI } from '../mock-utils'
import { MOCK_LABELS, MOCK_SESSION_STATUSES } from '../demos/mobile-webui/mock-mobile-data'
import type { ComponentEntry } from './types'

const WORKSPACE_ID = 'playground-sub-sessions'
const WORKSPACE_SLUG = 'sub-sessions'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const now = Date.now()

// The label a task gives its whole family (SessionManager.applyTaskLabel): its steps leave it out
const TASK_LABEL = { id: 'task-ship-v0-16-release-notes-1', name: 'TASK-ship-v0-16-release-notes-1', color: { light: '#3B82F6', dark: '#60A5FA' } }
const LABELS = [...MOCK_LABELS, TASK_LABEL]

const PROJECTS = [
  { id: 'proj-platform', slug: 'platform', name: 'Platform', color: '#6366f1' },
  { id: 'proj-release', slug: 'release', name: 'Release', color: '#10b981' },
]

const meta = (id: string, fields: Omit<SessionMeta, 'id' | 'workspaceId'>): SessionMeta => ({ id, workspaceId: WORKSPACE_ID, ...fields })

const SESSIONS: SessionMeta[] = [
  // Spawned sub-sessions: the parent sits in Today through its newest child
  meta('ss-auth', {
    name: 'Refactor the authentication module', sessionStatus: 'in-progress', labels: ['feature'], projectId: 'proj-platform',
    createdAt: now - 3 * HOUR, lastMessageAt: now - 40 * MINUTE,
  }),
  meta('ss-auth-tests', {
    name: 'Write unit tests for the auth flow', parentSessionId: 'ss-auth', sessionStatus: 'in-progress', projectId: 'proj-platform',
    isProcessing: true, createdAt: now - 2 * HOUR, lastMessageAt: now - 3 * MINUTE,
  }),
  meta('ss-auth-docs', {
    name: 'Update the API docs for token refresh', parentSessionId: 'ss-auth', sessionStatus: 'done', projectId: 'proj-platform',
    hasUnread: true, createdAt: now - 100 * MINUTE, lastMessageAt: now - 25 * MINUTE,
  }),

  // A Conductor task two days old, with a step active today and a branch of that step, all with the task's label
  meta('ss-release', {
    name: 'Task: ship the v0.16 release notes', sessionStatus: 'in-progress', labels: [TASK_LABEL.id], projectId: 'proj-release',
    createdAt: now - 2 * DAY - HOUR, lastMessageAt: now - 2 * DAY,
  }),
  meta('ss-release-collect', {
    name: 'Collect the PRs merged since v0.15.6', parentSessionId: 'ss-release', sessionStatus: 'done', labels: [TASK_LABEL.id], projectId: 'proj-release',
    createdAt: now - 2 * DAY, lastMessageAt: now - 2 * DAY + 10 * MINUTE,
  }),
  meta('ss-release-draft', {
    name: 'Draft the release notes', parentSessionId: 'ss-release', sessionStatus: 'needs-review', labels: [TASK_LABEL.id], projectId: 'proj-release',
    lastMessageRole: 'plan', createdAt: now - 2 * DAY + 20 * MINUTE, lastMessageAt: now - 12 * MINUTE,
  }),
  meta('ss-release-draft-short', {
    name: 'Draft the release notes (shorter)', branchFromSessionId: 'ss-release-draft', sessionStatus: 'todo', labels: [TASK_LABEL.id], projectId: 'proj-release',
    createdAt: now - HOUR, lastMessageAt: now - 50 * MINUTE,
  }),
  meta('ss-release-publish', {
    name: 'Publish the notes to the docs site', parentSessionId: 'ss-release', sessionStatus: 'todo', labels: [TASK_LABEL.id], projectId: 'proj-release',
    createdAt: now - 2 * DAY + 40 * MINUTE, lastMessageAt: now - 2 * DAY + 40 * MINUTE,
  }),

  // A branch, and a branch of that branch
  meta('ss-ci', {
    name: 'Investigate the flaky CI pipeline', sessionStatus: 'needs-review', labels: ['bug', 'priority::2'],
    createdAt: now - DAY - 5 * HOUR, lastMessageAt: now - DAY - 2 * HOUR,
  }),
  meta('ss-ci-bisect', {
    name: 'Bisect the failing runs', branchFromSessionId: 'ss-ci', sessionStatus: 'in-progress',
    createdAt: now - DAY - 3 * HOUR, lastMessageAt: now - DAY - HOUR,
  }),
  meta('ss-ci-bisect-cache', {
    name: 'Retry the bisect with the cache disabled', branchFromSessionId: 'ss-ci-bisect', sessionStatus: 'todo',
    createdAt: now - DAY - 90 * MINUTE, lastMessageAt: now - DAY - 80 * MINUTE,
  }),

  // Its parent isn't in the list (archived), so it stays at the top level
  meta('ss-orphan', {
    name: 'Summarize the archived design review', parentSessionId: 'ss-archived-review', sessionStatus: 'todo', labels: ['design'],
    createdAt: now - 6 * HOUR, lastMessageAt: now - 5 * HOUR,
  }),

  meta('ss-onboarding', {
    name: 'Plan the onboarding checklist', sessionStatus: 'todo', hasUnread: true,
    createdAt: now - 2 * HOUR, lastMessageAt: now - 90 * MINUTE,
  }),
  meta('ss-composer', {
    name: 'Why does the composer lose focus after submit?', sessionStatus: 'done',
    createdAt: now - 3 * DAY - HOUR, lastMessageAt: now - 3 * DAY,
  }),
]

const log = (label: string) => (...args: unknown[]) => console.log(`[Playground SubSessions] ${label}`, args)

function createStubSession(id: string): Session {
  return { id, workspaceId: WORKSPACE_ID, workspaceName: 'Playground', lastMessageAt: Date.now(), messages: [], isProcessing: false }
}

/** Search lists only what the server's content search returns (titles and transcripts); here, title matches */
function useTitleSearch(sessions: SessionMeta[]) {
  React.useEffect(() => {
    ensureMockElectronAPI()
    const api = window.electronAPI
    const previous = api.searchSessionContent
    api.searchSessionContent = async (_workspaceId, query) => sessions
      .filter(session => session.name?.toLowerCase().includes(query.toLowerCase()))
      .map(session => ({ sessionId: session.id, matchCount: 1, matches: [{ sessionId: session.id, lineNumber: 1, snippet: session.name! }] }))
    return () => { api.searchSessionContent = previous }
  }, [sessions])
}

interface SubSessionsListDemoProps {
  groupingMode?: ChatGroupingMode
  /** Compact shell (phone width): "⋯" always shows, touch hit areas */
  compact?: boolean
  /** Search query; search lists matches flat */
  searchQuery?: string
}

function SubSessionsListDemo({ groupingMode = 'date', compact = false, searchQuery = '' }: SubSessionsListDemoProps) {
  const [sessions, setSessions] = React.useState(SESSIONS)
  const [query, setQuery] = React.useState(searchQuery)
  React.useEffect(() => setQuery(searchQuery), [searchQuery])

  const update = React.useCallback((id: string, fields: Partial<SessionMeta>) => {
    setSessions(current => current.map(session => (session.id === id ? { ...session, ...fields } : session)))
  }, [])
  const items = React.useMemo(() => sessions.filter(session => !session.isArchived), [sessions])
  useTitleSearch(items)

  return (
    <PlaygroundSessionProviders
      workspaceId={WORKSPACE_ID}
      workspaceSlug={WORKSPACE_SLUG}
      compact={compact}
      sessions={sessions}
      createStubSession={createStubSession}
    >
      {/* Compact: a phone-wide shell, so its touch rules apply (always-visible "⋯", larger hit areas).
          Desktop names no shell: those rules are the only ones written against it. */}
      <div className={cn('flex h-full bg-navigator', compact ? '@container/shell w-[390px]' : 'w-full')}>
        <div
          data-panel-role="navigator"
          className={cn('@container/panel relative flex h-full shrink-0 flex-col overflow-hidden bg-paper shadow-elev-0', compact ? 'w-full' : 'w-[340px]')}
        >
          <SessionList
            items={items}
            onDelete={async (id) => {
              setSessions(current => current.filter(session => session.id !== id))
              return true
            }}
            onFlag={(id) => update(id, { isFlagged: true })}
            onUnflag={(id) => update(id, { isFlagged: false })}
            onArchive={(id) => update(id, { isArchived: true, archivedAt: Date.now() })}
            onUnarchive={(id) => update(id, { isArchived: false })}
            onMarkUnread={(id) => update(id, { hasUnread: true })}
            onSessionStatusChange={(id, status) => update(id, { sessionStatus: status })}
            onRename={(id, name) => update(id, { name })}
            onLabelsChange={(id, labels) => update(id, { labels })}
            onSetProjectId={(id, projectId) => update(id, { projectId: projectId ?? undefined })}
            onFocusChatInput={log('onFocusChatInput')}
            onSessionSelect={log('onSessionSelect')}
            onOpenInNewWindow={log('onOpenInNewWindow')}
            onNavigateToView={log('onNavigateToView')}
            searchActive={query.length > 0}
            searchQuery={query}
            onSearchChange={setQuery}
            onSearchClose={() => setQuery('')}
            sessionStatuses={MOCK_SESSION_STATUSES}
            labels={LABELS}
            projects={PROJECTS}
            groupingMode={groupingMode}
            workspaceId={WORKSPACE_ID}
          />
        </div>
      </div>
    </PlaygroundSessionProviders>
  )
}

export const subSessionsComponents: ComponentEntry[] = [
  {
    id: 'sub-sessions-list',
    name: 'Session list · Sub-sessions',
    category: 'Sub Sessions',
    description: 'Production SessionList with spawned sub-sessions, a Conductor task, branches (a branch of a branch, a branch of a step) and an orphan. The chip on a parent row hides and shows its sub-sessions.',
    component: SubSessionsListDemo,
    layout: 'full',
    props: [
      {
        name: 'groupingMode',
        description: 'How sessions are grouped; a family is placed by its root',
        control: {
          type: 'select',
          options: [
            { label: 'Date', value: 'date' },
            { label: 'Status', value: 'status' },
            { label: 'Unread', value: 'unread' },
            { label: 'Project', value: 'project' },
          ],
        },
        defaultValue: 'date',
      },
      { name: 'compact', description: 'Compact shell (phone width)', control: { type: 'boolean' }, defaultValue: false },
      { name: 'searchQuery', description: 'Search query (results are flat)', control: { type: 'string', placeholder: 'release' }, defaultValue: '' },
    ],
    variants: [
      { name: 'By date', props: { groupingMode: 'date' } },
      { name: 'By status', props: { groupingMode: 'status' } },
      { name: 'By unread', props: { groupingMode: 'unread' } },
      { name: 'By project', props: { groupingMode: 'project' } },
      { name: 'Compact', props: { compact: true } },
      { name: 'Search (flat)', props: { searchQuery: 'release' } },
    ],
  },
]
