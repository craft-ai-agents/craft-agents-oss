/**
 * App navigation destinations — single source of truth for the top-level
 * navigation entries (spec S-03 §3.2 seed list, W1).
 *
 * Consumers:
 * - `AppShell.tsx` `links[]` — consumes identity meta (`icon`, `labelKey`)
 *   per entry; click handling stays in AppShell (context menus, filters).
 * - `platform/ActivityRail.tsx` — consumes the whole entry: icon, label,
 *   route (via NavigationContext) and active-state predicate.
 *
 * Do NOT duplicate this list per consumer: add a destination here once.
 * Wave-gated destinations carry `route: null` + `disabledTooltipKey`; the
 * rail renders them disabled-with-tooltip (spec degradation rule). Knowledge
 * was rail-gated in W1 and navigates since W2 — when the feature flag is off
 * the entry still renders and the surface shows the featureDisabled state.
 */
import {
  Brain,
  DatabaseZap,
  FolderKanban,
  Inbox,
  ListTodo,
  NotebookPen,
  Settings,
  Unplug,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { routes, type ViewRoute } from '../../../shared/routes'
import {
  isAutomationsNavigation,
  isNotesNavigation,
  isMemoryNavigation,
  isProjectsNavigation,
  isSessionsNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isSourcesNavigation,
  isConnectionsNavigation,
  type NavigationState,
} from '../../../shared/types'

export type AppNavDestinationId =
  | 'sessions'
  | 'notes'
  | 'sources'
  | 'skills'
  | 'memory'
  | 'projects'
  | 'automations'
  | 'connections'
  | 'settings'

export interface AppNavDestination {
  /** Stable destination id (rail item id, registry seed id input). */
  id: AppNavDestinationId
  /** Matching `links[]` entry id in AppShell. */
  linkId: string
  icon: LucideIcon
  /** Flat i18n label key (`sidebar.*`). */
  labelKey: string
  /**
   * View route for rail navigation; `null` for wave-gated destinations that
   * cannot be navigated to yet (rendered disabled).
   */
  route: (() => ViewRoute) | null
  /** Active-state predicate over the focused panel's navigation state. */
  isActive: (navState: NavigationState) => boolean
  /**
   * When set, the destination is wave-gated: the rail renders it disabled
   * with this i18n key as the tooltip (spec S-03 §3.2 degradation).
   */
  disabledTooltipKey?: string
}

/** Rail order = `links[]` order in AppShell. */
export const APP_NAV_DESTINATIONS: readonly AppNavDestination[] = [
  {
    id: 'sessions',
    linkId: 'nav:allSessions',
    icon: Inbox,
    labelKey: 'sidebar.allSessions',
    route: () => routes.view.allSessions(),
    isActive: isSessionsNavigation,
  },
  {
    id: 'projects',
    linkId: 'nav:projects',
    icon: FolderKanban,
    labelKey: 'sidebar.projects',
    route: () => routes.view.projects(),
    isActive: isProjectsNavigation,
  },
  {
    id: 'memory',
    linkId: 'nav:memory',
    icon: Brain,
    labelKey: 'sidebar.memory',
    route: () => routes.view.memory(),
    isActive: isMemoryNavigation,
  },
  {
    id: 'sources',
    linkId: 'nav:sources',
    icon: DatabaseZap,
    labelKey: 'sidebar.sources',
    route: () => routes.view.sources(),
    isActive: isSourcesNavigation,
  },
  {
    id: 'skills',
    linkId: 'nav:skills',
    icon: Zap,
    labelKey: 'sidebar.skills',
    route: () => routes.view.skills(),
    isActive: isSkillsNavigation,
  },
  {
    id: 'notes',
    linkId: 'nav:notes',
    icon: NotebookPen,
    labelKey: 'sidebar.notes',
    route: () => routes.view.notes(),
    isActive: isNotesNavigation,
  },
  {
    id: 'automations',
    linkId: 'nav:automations',
    icon: ListTodo,
    labelKey: 'sidebar.automations',
    route: () => routes.view.automations(),
    isActive: isAutomationsNavigation,
  },
  {
    id: 'connections',
    linkId: 'nav:connections',
    icon: Unplug,
    labelKey: 'sidebar.connections',
    route: () => routes.view.connections(),
    isActive: isConnectionsNavigation,
  },
  {
    id: 'settings',
    linkId: 'nav:settings',
    icon: Settings,
    labelKey: 'sidebar.settings',
    route: () => routes.view.settings(),
    isActive: isSettingsNavigation,
  },
] as const

/** Lookup by destination id for AppShell's hand-written `links[]` entries. */
export const APP_NAV_DESTINATIONS_BY_ID: Record<AppNavDestinationId, AppNavDestination> =
  Object.fromEntries(APP_NAV_DESTINATIONS.map((dest) => [dest.id, dest])) as Record<
    AppNavDestinationId,
    AppNavDestination
  >
