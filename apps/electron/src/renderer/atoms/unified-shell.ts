/**
 * Workbench chrome state atoms (PR-2).
 *
 * The explicit user preference is separate from the operator capability. The
 * preference migrates the prior unified-shell key once, while the operator
 * capability is injected at the composition boundary and defaults closed.
 */
import { atomWithStorage } from 'jotai/utils'
import { KEYS, getKeyString } from '@/lib/local-storage'
import { readWorkbenchPreference } from '@/platform/workbench-rollout'

/** Explicit Workbench user preference; operator policy is evaluated elsewhere. */
export const featureWorkbenchAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.workbenchEnabled),
  readWorkbenchPreference(),
  undefined,
  { getOnInit: true },
)

/** Activity rail collapsed (destinations hidden, expand chevron stays). */
export const activityRailCollapsedAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.activityRailCollapsed),
  false,
  undefined,
  { getOnInit: true },
)

/** Inspector panel visibility (the 48px section rail itself always renders). */
export const inspectorVisibleAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.inspectorVisible),
  false,
  undefined,
  { getOnInit: true },
)

/** Inspector sections shipped in W1; `info` is live, the rest are stub sections. */
export type InspectorSectionId = 'info' | 'agent' | 'outline' | 'backlinks'

/** Active inspector section (persisted; validated on read by `inspector-model.ts`). */
export const inspectorSectionAtom = atomWithStorage<InspectorSectionId>(
  getKeyString(KEYS.inspectorSection),
  'info',
  undefined,
  { getOnInit: true },
)
