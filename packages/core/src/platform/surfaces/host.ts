/**
 * WorkspaceSurfaceHost — verbatim API from S-02 §3.4.
 *
 * Interface only: the implementation is the renderer adapter over
 * panel-stack/NavigationContext (URL remains the single source of truth;
 * the host adds no second state-of-truth).
 */

import type { PanelLaneId, SurfaceLayoutSnapshot, SurfaceTab } from './types.ts';

export interface WorkspaceSurfaceHost {
  /**
   * Single creation point. Dedups by policy.singletonPer (generalizes the
   * AppShell.tsx:640-646 check): re-opening focuses the existing panel.
   * Returns the panelId. opts.targetLaneId flows to
   * navigate(route, { newPanel, targetLaneId }).
   */
  open(tab: SurfaceTab, opts?: { newPanel?: boolean; targetLaneId?: PanelLaneId; focus?: boolean }): string;
  close(panelId: string): void;
  focus(panelId: string): void;
  /** Returns the new panelId; resize via PanelResizeSash as today. */
  split(panelId: string, direction: 'right' | 'down', proportion?: number): string;
  /**
   * Restore a snapshot (S-02 §3.10): reconcile via the key-preserving
   * reconcilePanelStackAtom; bounds-managed tabs mount lazily on first
   * focus; broken refs render as error cards without dropping the stack.
   */
  restore(snapshot: SurfaceLayoutSnapshot): Promise<void>;
  /** Written on window close / workspace switch + debounced on resize. */
  serializeLayout(): SurfaceLayoutSnapshot;
  /**
   * Bounds contract for bounds-managed surfaces (generalizes
   * browserPane.syncBounds, S-02 §3.8): null hides/parks the webContents —
   * it never destroys state (switching must not destroy context, S-02 §3.9).
   */
  manageBounds(panelId: string, rect: { x: number; y: number; width: number; height: number } | null): void;
}
