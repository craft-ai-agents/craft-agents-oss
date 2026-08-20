/**
 * Workbench platform hosts (PR-2) — the single composition boundary for
 * ActivityRail, SurfaceTabs, InspectorHost, and the existing panel stack.
 *
 * When the two-key rollout is not enabled, this wrapper renders children
 * unchanged. NavigationContext and panel-stack atoms remain the only URL and
 * layout authorities in either path.
 */
import { WorkspaceSurfaceHost } from './WorkspaceSurfaceHost'

export { ActivityRail, ACTIVITY_RAIL_WIDTH, ACTIVITY_RAIL_COLLAPSED_WIDTH } from './ActivityRail'
export { SurfaceTabs } from './SurfaceTabs'
export { InspectorHost } from './InspectorHost'
export { Omnibox } from './Omnibox'
export { OmniboxHost } from './OmniboxHost'
export { parsePrefix, scoreMatch } from './omnibox-helpers'
export {
  readWorkbenchPreference,
  resolveWorkbenchAvailability,
  type PreferenceStorage,
  type WorkbenchAvailability,
} from './workbench-rollout'

export { WorkspaceSurfaceHost, type WorkspaceSurfaceHostProps } from './WorkspaceSurfaceHost'
