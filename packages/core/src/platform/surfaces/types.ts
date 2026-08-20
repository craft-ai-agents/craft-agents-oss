/**
 * Surface model — verbatim contracts from S-02 §3.1 (SurfaceTab), §3.2
 * (SurfaceDescriptor), §3.3 (SurfaceContribution), §3.10
 * (SurfaceLayoutSnapshot).
 *
 * Pure TS: renderer types (NavigationState/ViewRoute/ReactNode) appear here
 * as documented structural placeholders — the renderer binds them.
 */

import type { Disposable } from '../types.ts';

/**
 * Canonical KnowledgeRef from the Knowledge Provider contract (K-03 §3.1,
 * packages/core/src/knowledge/refs.ts, suite K phase P1). Re-exported here
 * so SurfaceTab/SurfaceDescriptor references and consumer imports from
 * @craft-agent/core/platform stay type-identical with the knowledge package.
 */
export type { KnowledgeRef } from '../../knowledge/refs.ts';
import type { KnowledgeRef } from '../../knowledge/refs.ts';

/**
 * Panel lane. W1: only 'main' is live (S-02 §3.1.1 / panel-stack.ts:17);
 * the open string form keeps assignments compatible with the multi-lane
 * renderer union later without widening call sites.
 */
export type PanelLaneId = 'main' | (string & {});

/**
 * Render output of a contribution. ReactNode at the renderer boundary;
 * unknown here to keep platform/ dependency-free (S-02 §3.3).
 */
export type RenderNode = unknown;

/** Normative 7-variant tab union — verbatim S-02 §3.1. */
export type SurfaceTab =
  | { kind: 'session'; sessionId: string }
  | { kind: 'knowledge'; ref: KnowledgeRef }
  | { kind: 'browser'; tabId: string }
  | { kind: 'database'; ref: KnowledgeRef }
  | { kind: 'cloud-run'; runId: string }
  | { kind: 'extension'; extensionId: string; viewId: string }
  | { kind: 'diff'; proposalId: string };

export type SurfaceTabKind = SurfaceTab['kind'];

/**
 * Normative 5-variant host descriptor — verbatim S-02 §3.2. Downgrade rules
 * (enforced by surfaceTabToDescriptor in descriptor.ts, documented on the
 * type per the spec):
 * - tab kind 'session'  → descriptor 'chat';
 * - tab kind 'database' → descriptor 'knowledge' with ref.kind 'database';
 * - tab kind 'extension' is NOT part of this union: it renders through the
 *   plugin-bridge sandbox (S-02 §3.2), so the downgrade yields null.
 */
export type SurfaceDescriptor =
  | { kind: 'chat'; sessionId: string }
  | { kind: 'browser'; tabId: string }
  | { kind: 'knowledge'; ref: KnowledgeRef }
  | { kind: 'cloud-run'; runId: string }
  | { kind: 'diff'; proposalId: string };

/** Minimal render context the host passes to a contribution (S-02 §3.3). */
export interface SurfaceRenderContext {
  panelId: string;
  laneId: PanelLaneId;
  focused: boolean;
}

/**
 * Verbatim S-02 §3.3, parameterized over the renderer's navigation/route
 * types so platform/ stays app-free. Defaults (`unknown`, `string`) keep
 * spec-form usage valid.
 */
export interface SurfaceContribution<TNav = unknown, TRoute extends string = string> {
  kind: SurfaceTabKind;
  /** Extract a tab from NavigationState/route; null = the route is not ours. */
  match(navState: TNav): SurfaceTab | null;
  /** Build the route for a tab (inverse of routes.view.*). */
  buildRoute(tab: SurfaceTab): TRoute;
  title(tab: SurfaceTab): string;
  icon(tab: SurfaceTab): string;
  /** Open policy: lane, singleton behavior, dedup key (by durable ref, S-02 §3.7). */
  policy: { singletonPer(tab: SurfaceTab): string; preferredLane?: PanelLaneId };
  render(tab: SurfaceTab, ctx: SurfaceRenderContext): RenderNode;
  /** 'bounds-managed' surfaces need a host frame with manageBounds (embedded webContents). */
  hostKind: 'dom' | 'bounds-managed';
}

/**
 * Serializable layout snapshot — verbatim S-02 §3.10. Tabs carry durable
 * refs only, never ephemeral instance ids (S-02 §3.7).
 */
export interface SurfaceLayoutSnapshot {
  version: 1;
  workspaceId: string;
  /** W1: always [{ laneId: 'main', locked: false }]. */
  lanes: Array<{ laneId: PanelLaneId; locked: boolean }>;
  tabs: Array<{
    panelId: string;
    laneId: PanelLaneId;
    /** Durable ref only — no instance ids (S-02 §3.7). */
    tab: SurfaceTab;
    proportion: number;
    /** Optional, surface-specific. */
    scrollState?: unknown;
  }>;
  focusedIndex: number;
  savedAt: number;
}

/**
 * Store of surface contributions (S-02 §3.3). `resolve` walks registered
 * contributions in order; null means the legacy renderer branches handle
 * the route (registry → legacy fallback).
 *
 * The spec's `tabs()` (current panel stack as tabs) is provided by the
 * renderer host that owns panel-stack — it is stateful stack projection,
 * not a property of the contribution store.
 */
export interface SurfaceRegistry<TNav = unknown> {
  register(contribution: SurfaceContribution<TNav>): Disposable;
  unregister(kind: SurfaceTabKind): void;
  get(kind: SurfaceTabKind): SurfaceContribution<TNav> | undefined;
  list(): SurfaceContribution<TNav>[];
  resolve(navState: TNav): SurfaceContribution<TNav> | null;
  onDidChange(listener: () => void): Disposable;
}
