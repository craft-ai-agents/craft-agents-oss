/**
 * Mock data for the Kanban playground demos.
 *
 * Single source of truth for statuses, projects, tasks and the task-window
 * transcript shared across the Kanban registry entries. Keep shapes shallow —
 * only fields the presentational components actually read.
 *
 * Coverage exercised here: project-colored tiles, a `needs-review` tile parked
 * in the In Progress column (status independent from column), expanded vs
 * collapsed subtasks, auto-routed Haiku/Sonnet sub-models, a no-project tile,
 * and a `cancelled` tile in Done.
 */

import * as React from 'react'
import { Circle } from 'lucide-react'
import type { SessionStatus } from '@/config/session-status-config'
import type {
  KanbanProject,
  KanbanSubtask,
  KanbanTask,
} from '@/components/app-shell/kanban/types'

// Model ids (from the centralized registry — see @config/models).
const OPUS = 'claude-opus-4-7'
const SONNET = 'claude-sonnet-4-6'
const HAIKU = 'claude-haiku-4-5-20251001'

// Relative timestamps for the footer's "last activity" (resolved once at import).
const MIN = 60_000
const NOW = Date.now()

const circleIcon = () => React.createElement(Circle, { className: 'h-3.5 w-3.5', strokeWidth: 1.5 })

export const mockStatuses: SessionStatus[] = [
  { id: 'todo', label: 'Todo', resolvedColor: 'var(--muted-foreground)', icon: circleIcon(), iconColorable: true, category: 'open' },
  { id: 'in-progress', label: 'In Progress', resolvedColor: 'var(--info)', icon: circleIcon(), iconColorable: true, category: 'open' },
  { id: 'needs-review', label: 'Needs Review', resolvedColor: 'var(--warning)', icon: circleIcon(), iconColorable: true, category: 'open' },
  { id: 'done', label: 'Done', resolvedColor: 'var(--success)', icon: circleIcon(), iconColorable: true, category: 'closed' },
  { id: 'cancelled', label: 'Cancelled', resolvedColor: 'var(--muted-foreground)', icon: circleIcon(), iconColorable: true, category: 'closed' },
]

export const mockProjects: KanbanProject[] = [
  { id: 'p-eng', name: 'Engineering', color: '#6366f1' }, // indigo
  { id: 'p-growth', name: 'Growth', color: '#10b981' }, // emerald
  { id: 'p-research', name: 'Research', color: '#f59e0b' }, // amber
]

export const mockStatusesById = new Map(mockStatuses.map(s => [s.id, s]))
export const mockProjectsById = new Map(mockProjects.map(p => [p.id, p]))

// Subtasks for the "Migrate auth" task — reused by the tile anatomy + task window.
const AUTH_SUBTASKS: KanbanSubtask[] = [
  { id: 'auth-1', title: 'Audit current auth middleware', runState: 'done', model: HAIKU },
  { id: 'auth-2', title: 'Draft migration plan', runState: 'running', model: SONNET },
  { id: 'auth-3', title: 'Update integration tests', runState: 'pending', model: SONNET },
]

export const mockTasks: KanbanTask[] = [
  // ToDo
  { id: 't1', title: 'Redesign onboarding flow', column: 'todo', statusId: 'todo', model: OPUS, projectId: 'p-eng', subtasks: [], isFlagged: true, lastMessageAt: NOW - 1440 * MIN, messageCount: 3 },
  { id: 't2', title: 'Draft Q3 launch announcement', column: 'todo', statusId: 'todo', model: SONNET, projectId: 'p-growth', subtasks: [] },
  { id: 't3', title: 'Investigate flaky CI on Windows runners', column: 'todo', statusId: 'todo', model: OPUS, subtasks: [] },

  // In Progress
  // Live: an in-flight turn in the active column drives the pulse + card glow.
  { id: 't4', title: 'Migrate auth to new session model', column: 'in-progress', statusId: 'in-progress', model: OPUS, projectId: 'p-eng', subtasks: AUTH_SUBTASKS, isProcessing: true, lastMessageAt: NOW - 2 * MIN, messageCount: 14, costUsd: 0.42 },
  // needs-review badge while physically sitting in In Progress — demonstrates column ⊥ status
  {
    id: 't5',
    title: 'Synthesize user interviews',
    column: 'in-progress',
    statusId: 'needs-review',
    model: SONNET,
    projectId: 'p-research',
    isFlagged: true,
    lastMessageAt: NOW - 180 * MIN,
    messageCount: 8,
    costUsd: 0.18,
    subtasks: [
      { id: 't5-1', title: 'Cluster recurring themes', runState: 'done', model: HAIKU },
      { id: 't5-2', title: 'Summarize findings', runState: 'done', model: SONNET },
    ],
  },

  // Done
  {
    id: 't6',
    title: 'Ship pricing page copy',
    column: 'done',
    statusId: 'done',
    model: SONNET,
    projectId: 'p-growth',
    lastMessageAt: NOW - 2880 * MIN,
    messageCount: 22,
    costUsd: 0.91,
    subtasks: [
      { id: 't6-1', title: 'Rewrite hero section', runState: 'done', model: HAIKU },
      { id: 't6-2', title: 'Generate A/B variants', runState: 'done', model: SONNET },
    ],
  },
  // cancelled badge in Done, no project
  { id: 't7', title: 'Legacy CSV export tool', column: 'done', statusId: 'cancelled', model: HAIKU, subtasks: [] },
]

/** Tiles expanded by default in the board preview. */
export const DEFAULT_EXPANDED_TASK_IDS = new Set<string>(['t4'])

/** Subtasks surfaced in the tile-anatomy preview. */
export const ANATOMY_SUBTASKS = AUTH_SUBTASKS

/** Props for the focused task-window preview (TaskChatPreview). */
export const mockTaskWindow = {
  title: 'Migrate auth to new session model',
  project: mockProjectsById.get('p-eng'),
  status: mockStatusesById.get('in-progress'),
  model: OPUS,
  userMessage:
    'Migrate our auth layer to the new session model. Coordinate the work and use the best model for each part.',
  assistantIntro:
    "I'll act as the orchestrator for this task — breaking it into focused subtasks and routing each to the best-fit model rather than doing everything inline:",
  subtasks: AUTH_SUBTASKS,
  assistantFollowUp:
    "The migration plan is in progress. I'll update each subtask here as the spawned sessions report back.",
}
