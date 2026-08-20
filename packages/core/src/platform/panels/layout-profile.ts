/**
 * Layout profiles and per-workspace registry state — verbatim format from
 * S-03 §3.7. The model lives in packages/core; persistence is renderer-side
 * (apps/electron local-storage.ts, KEYS.panelProfile / KEYS.panelState).
 *
 * Invariants (S-03 §3.7):
 * 1. Reads go through typed get with fallback — parse failure yields the
 *    fallback, never throws.
 * 2. `version` is mandatory; unknown versions are read best-effort.
 * 3. Overrides never duplicate contribution defaults (delta-only).
 * 4. State stays within a workspace (`${workspaceId}` suffix) except global
 *    rail visibility.
 */

import type { PanelSlot } from './types.ts';

/** Named slot composition (S-03 §3.7/§3.8); builtin ids: agent|knowledge|research|review|browser|focus|debug. */
export interface LayoutProfile {
  id: string;
  title: string;
  builtin?: boolean;
  slots: Partial<Record<PanelSlot, {
    visible: boolean;
    /** For resizable slots (navigator-* / inspector). */
    width?: number;
    /** Active contribution of the slot (e.g. activeInspector). */
    active?: string;
  }>>;
  /** Selected Activity Rail item (e.g. "rail.knowledge"). */
  activityItem?: string;
  createdAt: number;
  updatedAt: number;
}

/** User delta over a contribution's defaults (S-03 §3.7, delta-only). */
export interface PanelOverride {
  order?: number;
  pinned?: boolean;
  hidden?: boolean;
  width?: number;
}

/** Serializable content of `panel-registry-state:${workspaceId}` (S-03 §3.7). */
export interface PanelRegistryState {
  version: 1;
  activeProfile?: string;
  rails: {
    activity?: { collapsed?: boolean };
    inspector?: { open?: boolean; activeInspector?: string; width?: number };
  };
  overrides: Record<string, PanelOverride>;
  customProfiles: Record<string, LayoutProfile>;
}
