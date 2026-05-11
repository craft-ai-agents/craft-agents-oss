/**
 * Mock data for the Mobile WebUI playground demos.
 *
 * Single source of truth for sessions, messages, labels and workspace data
 * shared across AppMenuMobilePreview, SessionListMobilePreview and
 * ChatDisplayMobilePreview. Keep shapes shallow — only fields the components
 * actually read.
 */

import type { Message } from '@craft-agent/core/types'
import type { LabelConfig } from '@craft-agent/shared/labels'
import type { LoadedSource, LoadedSkill, Session, Workspace } from '../../../../shared/types'
import type { SessionMeta } from '@/atoms/sessions'
import type { SessionStatus } from '@/config/session-status-config'
import * as React from 'react'
import { Circle } from 'lucide-react'

const ONE_MINUTE = 60_000
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR

export const MOBILE_WORKSPACE_ID = 'playground-mobile'
export const MOBILE_WORKSPACE_SLUG = 'mobile'

export const MOCK_WORKSPACE: Workspace = {
  id: MOBILE_WORKSPACE_ID,
  name: 'Mobile Demo',
  slug: MOBILE_WORKSPACE_SLUG,
  rootPath: '/mock/workspaces/mobile',
  createdAt: Date.now() - 30 * ONE_DAY,
}

export const MOCK_LABELS: LabelConfig[] = [
  { id: 'feature', name: 'Feature', color: { light: '#10B981', dark: '#34D399' } },
  { id: 'bug', name: 'Bug', color: { light: '#EF4444', dark: '#F87171' } },
  { id: 'priority', name: 'Priority', color: { light: '#F59E0B', dark: '#FBBF24' }, valueType: 'number' },
  { id: 'design', name: 'Design', color: { light: '#8B5CF6', dark: '#A78BFA' } },
]

export const MOCK_SESSION_STATUSES: SessionStatus[] = [
  {
    id: 'todo',
    label: 'Todo',
    resolvedColor: 'var(--muted-foreground)',
    icon: React.createElement(Circle, { className: 'h-3.5 w-3.5', strokeWidth: 1.5 }),
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    resolvedColor: 'var(--info)',
    icon: React.createElement(Circle, { className: 'h-3.5 w-3.5', strokeWidth: 1.5 }),
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'needs-review',
    label: 'Needs Review',
    resolvedColor: 'var(--warning)',
    icon: React.createElement(Circle, { className: 'h-3.5 w-3.5', strokeWidth: 1.5 }),
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'done',
    label: 'Done',
    resolvedColor: 'var(--success)',
    icon: React.createElement(Circle, { className: 'h-3.5 w-3.5', strokeWidth: 1.5 }),
    iconColorable: true,
    category: 'closed',
  },
]

const now = () => Date.now()

/**
 * 10 sessions spread across today / yesterday / older, exercising flagged,
 * unread, archived and various statuses.
 */
export const MOCK_SESSIONS: SessionMeta[] = [
  {
    id: 'mobile-s-1',
    name: 'Fix mobile nav crash on iOS Safari',
    workspaceId: MOBILE_WORKSPACE_ID,
    lastMessageAt: now() - 4 * ONE_MINUTE,
    sessionStatus: 'in-progress',
    isFlagged: true,
    hasUnread: true,
    labels: ['bug', 'priority::1'],
    isProcessing: true,
  },
  {
    id: 'mobile-s-2',
    name: 'Compact toolbar variants for narrow panels',
    workspaceId: MOBILE_WORKSPACE_ID,
    lastMessageAt: now() - 35 * ONE_MINUTE,
    sessionStatus: 'todo',
    labels: ['feature', 'design'],
  },
  {
    id: 'mobile-s-3',
    name: 'Why does the chat input lose focus after submit?',
    workspaceId: MOBILE_WORKSPACE_ID,
    lastMessageAt: now() - 2 * ONE_HOUR,
    sessionStatus: 'needs-review',
    hasUnread: true,
    lastMessageRole: 'plan',
  },
  {
    id: 'mobile-s-4',
    name: 'Migrate session list grouping to atom-based store',
    workspaceId: MOBILE_WORKSPACE_ID,
    lastMessageAt: now() - 5 * ONE_HOUR,
    sessionStatus: 'in-progress',
    labels: ['feature'],
  },
  {
    id: 'mobile-s-5',
    name: 'Audit accessibility for the new app menu',
    workspaceId: MOBILE_WORKSPACE_ID,
    lastMessageAt: now() - ONE_DAY - 30 * ONE_MINUTE,
    sessionStatus: 'todo',
    labels: ['design'],
  },
  {
    id: 'mobile-s-6',
    name: 'Fold "Help" submenu into root on compact mode',
    workspaceId: MOBILE_WORKSPACE_ID,
    lastMessageAt: now() - ONE_DAY - 3 * ONE_HOUR,
    sessionStatus: 'done',
    isFlagged: true,
  },
  {
    id: 'mobile-s-7',
    name: 'Permission mode badge truncation on narrow widths',
    workspaceId: MOBILE_WORKSPACE_ID,
    lastMessageAt: now() - 2 * ONE_DAY,
    sessionStatus: 'needs-review',
    labels: ['bug'],
  },
  {
    id: 'mobile-s-8',
    name: 'Spec the swipe-to-archive interaction',
    workspaceId: MOBILE_WORKSPACE_ID,
    lastMessageAt: now() - 3 * ONE_DAY,
    sessionStatus: 'todo',
    labels: ['design', 'feature'],
  },
  {
    id: 'mobile-s-9',
    name: 'Old: investigate dropdown click-through on Android',
    workspaceId: MOBILE_WORKSPACE_ID,
    lastMessageAt: now() - 8 * ONE_DAY,
    sessionStatus: 'done',
    isArchived: true,
    archivedAt: now() - 7 * ONE_DAY,
  },
  {
    id: 'mobile-s-10',
    name: 'Profile session list scroll perf on iPhone SE',
    workspaceId: MOBILE_WORKSPACE_ID,
    lastMessageAt: now() - 14 * ONE_DAY,
    sessionStatus: 'done',
  },
]

/**
 * Mock messages for ChatDisplay. Includes a user turn with a mention,
 * an assistant turn with markdown + a code block, and a streaming-style
 * trailing assistant turn that callers can flip off.
 */
export const MOCK_MESSAGES: Message[] = [
  {
    id: 'm-user-1',
    role: 'user',
    content: 'Why does my mobile nav crash when I rotate the device on iOS Safari?',
    timestamp: now() - 4 * ONE_MINUTE,
  },
  {
    id: 'm-asst-1',
    role: 'assistant',
    content:
      'Most likely a layout invalidation race during the orientation event. ' +
      'Two things to check first:\n\n' +
      '1. Are you reading `window.innerHeight` *before* the resize event fires?\n' +
      '2. Is your nav drawer using `position: fixed` with `100vh` instead of `100dvh`?\n\n' +
      'Here is a minimal repro for the height problem:\n\n' +
      '```ts\n' +
      'export function useViewportHeight() {\n' +
      '  const [h, setH] = React.useState(() => window.innerHeight)\n' +
      '  React.useEffect(() => {\n' +
      '    const onResize = () => setH(window.innerHeight)\n' +
      '    window.addEventListener("resize", onResize)\n' +
      '    return () => window.removeEventListener("resize", onResize)\n' +
      '  }, [])\n' +
      '  return h\n' +
      '}\n' +
      '```\n\n' +
      'Switch to `100dvh` and the recompute jank disappears in most cases.',
    timestamp: now() - 3 * ONE_MINUTE,
    turnId: 'turn-1',
  },
  {
    id: 'm-user-2',
    role: 'user',
    content: 'Right, dvh fixed the height. What about the crash itself though?',
    timestamp: now() - 2 * ONE_MINUTE,
  },
  {
    id: 'm-asst-2',
    role: 'assistant',
    content:
      'The crash is almost certainly a re-entrant render: your nav listens to `popstate`, ' +
      'which fires *during* the rotation transition on iOS 17+. Adding a `requestAnimationFrame` ' +
      'around the state update breaks the loop:\n\n' +
      '```ts\n' +
      'window.addEventListener("popstate", () => {\n' +
      '  requestAnimationFrame(() => updateNavState())\n' +
      '})\n' +
      '```',
    timestamp: now() - ONE_MINUTE,
    turnId: 'turn-2',
  },
]

export const MOCK_SOURCES: LoadedSource[] = [
  {
    config: {
      id: 'github',
      slug: 'github',
      name: 'GitHub',
      provider: 'github',
      type: 'mcp',
      enabled: true,
      mcp: { command: 'mock', args: [] },
      icon: 'https://www.google.com/s2/favicons?domain=github.com&sz=128',
      tagline: 'Repos, issues, PRs',
      createdAt: now(),
      updatedAt: now(),
    },
    guide: null,
    folderPath: '/mock/sources/github',
    workspaceRootPath: MOCK_WORKSPACE.rootPath,
    workspaceId: MOBILE_WORKSPACE_ID,
  },
  {
    config: {
      id: 'linear',
      slug: 'linear',
      name: 'Linear',
      provider: 'linear',
      type: 'mcp',
      enabled: true,
      mcp: { command: 'mock', args: [] },
      icon: 'https://www.google.com/s2/favicons?domain=linear.app&sz=128',
      tagline: 'Issue tracker',
      createdAt: now(),
      updatedAt: now(),
    },
    guide: null,
    folderPath: '/mock/sources/linear',
    workspaceRootPath: MOCK_WORKSPACE.rootPath,
    workspaceId: MOBILE_WORKSPACE_ID,
  },
]

export const MOCK_SKILLS: LoadedSkill[] = []

/**
 * Build a full Session with messages, given a session id and a slice of mocks.
 */
export function buildMockSession(
  sessionId: string,
  options: {
    messages?: Message[]
    isProcessing?: boolean
    name?: string
  } = {},
): Session {
  return {
    id: sessionId,
    workspaceId: MOBILE_WORKSPACE_ID,
    workspaceName: MOCK_WORKSPACE.name,
    name: options.name ?? 'Fix mobile nav crash on iOS Safari',
    messages: options.messages ?? MOCK_MESSAGES,
    isProcessing: options.isProcessing ?? false,
    lastMessageAt: now(),
    permissionMode: 'ask',
    sessionStatus: 'in-progress',
    createdAt: now() - ONE_HOUR,
  }
}
