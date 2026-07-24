/**
 * ARCHstudio design system.
 *
 * Import this once (renderer entry / index.css) to install the token layer.
 * Components consume the CSS custom properties; these TS constants exist so
 * inline styles and tests can reference the same names without stringly-typed
 * drift.
 */

import './tokens.css'
import './typography.css'
import './motion.css'
import './elevation.css'

/** Semantic token names, grouped. Values are `var(--x)` refs, never literals. */
export const DS = {
  surface: {
    canvas: 'var(--ds-canvas)',
    panel: 'var(--ds-panel)',
    panelRaised: 'var(--ds-panel-raised)',
    navigator: 'var(--ds-navigator)',
    border: 'var(--ds-panel-border)',
    borderStrong: 'var(--ds-panel-border-strong)',
  },
  text: {
    primary: 'var(--ds-text)',
    secondary: 'var(--ds-text-secondary)',
    muted: 'var(--ds-text-muted)',
    onBrand: 'var(--ds-text-on-brand)',
  },
} as const

export const DS_STATE = {
  running: 'var(--ds-state-running)',
  queued: 'var(--ds-state-queued)',
  done: 'var(--ds-state-done)',
  failed: 'var(--ds-state-failed)',
  cancelled: 'var(--ds-state-cancelled)',
} as const

export const DS_MODE = {
  explore: 'var(--ds-mode-explore)',
  ownerAuto: 'var(--ds-mode-owner-auto)',
  unrestricted: 'var(--ds-mode-unrestricted)',
  sandbox: 'var(--ds-mode-sandbox)',
} as const

export const DS_MEDIA = {
  image: 'var(--ds-media-image)',
  video: 'var(--ds-media-video)',
  audio: 'var(--ds-media-audio)',
  doc: 'var(--ds-media-doc)',
} as const

export const DS_Z = {
  base: 'var(--ds-z-base)',
  raised: 'var(--ds-z-raised)',
  sticky: 'var(--ds-z-sticky)',
  overlay: 'var(--ds-z-overlay)',
  popover: 'var(--ds-z-popover)',
  toast: 'var(--ds-z-toast)',
  modal: 'var(--ds-z-modal)',
} as const

export type DsStateKey = keyof typeof DS_STATE
export type DsModeKey = keyof typeof DS_MODE
export type DsMediaKey = keyof typeof DS_MEDIA
