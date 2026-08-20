/**
 * SiYuan surface URL helpers (P4 surface modes).
 *
 * Base: `${baseUrl}/stage/build/desktop/`
 * - document/block refs append `?id=<id>` (SiYuan web supports this)
 * - graph / global-graph / outline / backlinks still open the desktop build and
 *   pass `craftSurface=<mode>` so the host can inject a dock-open script after load
 *
 * KnowledgeKind (notebook|document|block|database|asset) is unchanged for refs;
 * surface presentation is a separate SiyuanSurfaceMode.
 */

import type { KnowledgeRefKind } from '../../shared/types'

/** Local SiYuan kernel default (mirrors SIYUAN_DEFAULT_BASE_URL in core). */
export const DEFAULT_BASE_URL = 'http://localhost:6806'

/** Compat-surface sentinel: `knowledge/notebook/__full__` = full-UI surface. */
export const SIYUAN_FULL_SURFACE_ID = '__full__'

/**
 * Presentation mode for an embedded SiYuan surface.
 * Orthogonal to KnowledgeKind — kind/id identify the ref; mode chooses the UI.
 */
export type SiyuanSurfaceMode =
  | 'editor'
  | 'graph'
  | 'global-graph'
  | 'outline'
  | 'backlinks'
  | 'flashcard'
  | 'plugins'

export const SIYUAN_SURFACE_MODES: readonly SiyuanSurfaceMode[] = [
  'editor',
  'graph',
  'global-graph',
  'outline',
  'backlinks',
  'flashcard',
  'plugins',
] as const

export interface SiyuanSurfaceRef {
  kind: KnowledgeRefKind
  id: string
}

export interface BuildSiyuanSurfaceUrlOptions {
  mode?: SiyuanSurfaceMode
}

/**
 * JS injected after load when craftSurface is set — opens the matching SiYuan
 * dock/panel for the requested mode. Safe no-op if selectors miss.
 *
 * Modes:
 * - graph / global-graph → graph dock (Alt+G fallback)
 * - outline → outline dock
 * - backlinks → backlink dock
 * - flashcard → riff/flashcard dock
 * - plugins → plugin marketplace / plugin panel
 */
export const SIYUAN_OPEN_DOCK_SCRIPT = `(() => {
  const params = new URLSearchParams(document.location.search);
  const surface = params.get('craftSurface') || '';
  const tryClick = (sel) => {
    const el = document.querySelector(sel);
    if (el) { el.click(); return true; }
    return false;
  };
  const clickAny = (sels) => {
    for (const sel of sels) { if (tryClick(sel)) return true; }
    return false;
  };

  if (surface === 'outline') {
    if (clickAny([
      '[data-type="outline"]',
      '.dock__item[data-type="outline"]',
      '#dockLeft [data-type="outline"]',
      '#dockRight [data-type="outline"]',
    ])) return 'clicked-outline';
    return 'miss-outline';
  }

  if (surface === 'backlinks') {
    if (clickAny([
      '[data-type="backlink"]',
      '[data-type="backlinks"]',
      '.dock__item[data-type="backlink"]',
      '.dock__item[data-type="backlinks"]',
      '#dockLeft [data-type="backlink"]',
      '#dockRight [data-type="backlink"]',
    ])) return 'clicked-backlinks';
    return 'miss-backlinks';
  }

  if (surface === 'flashcard') {
    if (clickAny([
      '[data-type="riff"]',
      '[data-type="flashcard"]',
      '.dock__item[data-type="riff"]',
      '.dock__item[data-type="flashcard"]',
      '#dockLeft [data-type="riff"]',
      '#dockRight [data-type="riff"]',
      '#dockLeft [data-type="flashcard"]',
      '#dockRight [data-type="flashcard"]',
    ])) return 'clicked-flashcard';
    return 'miss-flashcard';
  }

  if (surface === 'plugins') {
    if (clickAny([
      '[data-type="plugin"]',
      '[data-type="plugins"]',
      '.dock__item[data-type="plugin"]',
      '.dock__item[data-type="plugins"]',
      '#dockLeft [data-type="plugin"]',
      '#dockRight [data-type="plugin"]',
      'button[data-type="plugin"]',
      '.b3-menu__item[data-id="plugin"]',
    ])) return 'clicked-plugins';
    return 'miss-plugins';
  }

  // graph / global-graph (default non-editor dock path)
  if (clickAny([
    '[data-type="graph"]',
    '.dock__item[data-type="graph"]',
    '#dockLeft [data-type="graph"]',
    '#dockRight [data-type="graph"]',
  ])) return 'clicked-graph';
  // hotkey Alt+G (graph)
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'g', code:'KeyG', altKey:true, bubbles:true}));
  return 'hotkey-graph';
})()`


/**
 * URL of the embedded SiYuan desktop surface.
 * - document/block → `?id=<id>`
 * - non-editor modes → `craftSurface=<mode>` (and id when document-like)
 */
export function buildSiyuanSurfaceUrl(
  baseUrl: string,
  ref?: SiyuanSurfaceRef,
  options?: BuildSiyuanSurfaceUrlOptions,
): string {
  const root = `${baseUrl.replace(/\/+$/, '')}/stage/build/desktop/`
  const mode: SiyuanSurfaceMode = options?.mode ?? 'editor'
  const params = new URLSearchParams()

  if (
    ref &&
    (ref.kind === 'document' || ref.kind === 'block') &&
    ref.id &&
    ref.id !== SIYUAN_FULL_SURFACE_ID
  ) {
    params.set('id', ref.id)
  }

  if (mode !== 'editor') {
    params.set('craftSurface', mode)
  }

  const qs = params.toString()
  return qs ? `${root}?${qs}` : root
}

/** Stable surface key — kind+id+mode so graph/editor don't share a BrowserView. */
export function buildSiyuanDurableKey(
  ref: SiyuanSurfaceRef,
  mode: SiyuanSurfaceMode = 'editor',
): string {
  return `siyuan:${ref.kind}:${ref.id}:${mode}`
}

/** True when the route targets the compat full-interface surface. */
export function isSiyuanCompatRef(ref: SiyuanSurfaceRef): boolean {
  return ref.kind === 'notebook' && ref.id === SIYUAN_FULL_SURFACE_ID
}

/** True when the mode needs the post-load dock-open evaluate. */
export function needsSiyuanDockOpen(mode: SiyuanSurfaceMode): boolean {
  return mode !== 'editor'
}
