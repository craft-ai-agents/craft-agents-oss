/**
 * Panel model — verbatim contract from S-03 §3.4/§3.5.
 *
 * Model and registry live in packages/core (att2 §16); React hosts
 * (ActivityRail.tsx, PanelHost.tsx, InspectorHost.tsx) live in the renderer
 * and consume these types.
 */

import type { Disposable } from '../types.ts';
import type { ContextKeys } from '../context-keys/types.ts';

/**
 * Reference to a React component rendering the panel. For
 * `extension`/`siyuan-plugin` sources this is the host adapter component
 * (S-03 §3.4). Typed as unknown here: platform/ is pure TS with zero app
 * deps; the renderer binds it to ComponentType.
 */
export type PanelRenderer = unknown;

/** Verbatim S-03 §3.4. */
export type PanelSlot = 'activity' | 'navigator-primary' | 'navigator-secondary' | 'inspector' | 'bottom' | 'status';

/** Verbatim S-03 §3.4. */
export interface PanelContribution {
  id: string;
  title: string;
  icon: string;
  slot: PanelSlot;
  defaultOrder?: number;
  when?: string;
  defaultVisible?: boolean;
  resizable?: boolean;
  source: { type: 'core' | 'extension' | 'siyuan-plugin'; id: string };
  render: PanelRenderer;
}

/**
 * Runtime API over registered contributions — verbatim S-03 §3.5.
 *
 * Contract notes (S-03 §3.4):
 * - `id` is globally unique (`<domain>.<name>`); a collision throws.
 * - `when` is a Context Keys expression (S-03 §3.9); no `when` = always
 *   available.
 * - `resizable` only permits sash-resize; sizes live in layout-state, not
 *   in the contribution.
 */
export interface PanelRegistry {
  register(contribution: PanelContribution): Disposable;
  /** Sorted by order (ordering.ts), filtered through evaluateWhen. */
  list(slot: PanelSlot, ctx: ContextKeys): PanelContribution[];
  get(id: string): PanelContribution | undefined;
  onDidChange(listener: () => void): Disposable;
}
