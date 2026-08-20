/**
 * InspectorHost model (W1) — pure state transitions for the right inspector.
 * Behavior contract (S-03 §3.3): clicking an inactive section icon opens the
 * panel with that section; clicking the icon of the section already shown
 * hides the panel; the icon rail itself is always visible.
 */
import type { InspectorSectionId } from '@/atoms/unified-shell'

export const INSPECTOR_SECTION_IDS: readonly InspectorSectionId[] = [
  'info',
  'agent',
  'outline',
  'backlinks',
]

/** Sections with a real implementation in W1; the rest render i18n empty states. */
export const INSPECTOR_LIVE_SECTIONS: readonly InspectorSectionId[] = ['info']

export function isInspectorSectionId(value: unknown): value is InspectorSectionId {
  return typeof value === 'string' && (INSPECTOR_SECTION_IDS as readonly string[]).includes(value)
}

/** Persisted values can be arbitrary (older builds); fall back to `info`. */
export function normalizeInspectorSection(value: unknown): InspectorSectionId {
  return isInspectorSectionId(value) ? value : 'info'
}

export interface InspectorUiState {
  visible: boolean
  section: InspectorSectionId
}

export function resolveInspectorToggle(
  prev: InspectorUiState,
  clicked: InspectorSectionId,
): InspectorUiState {
  // Click on the already-shown section hides the panel; anything else shows it.
  if (prev.visible && prev.section === clicked) {
    return { visible: false, section: clicked }
  }
  return { visible: true, section: clicked }
}
