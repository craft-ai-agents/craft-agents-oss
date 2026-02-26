import { isMac } from '@/lib/platform'

/** Gap between any adjacent panels (sidebar ↔ navigator ↔ content ↔ right sidebar) */
export const PANEL_GAP = 6

/** Padding from window edges to outermost panels (right, bottom, left when sidebar hidden) */
export const PANEL_EDGE_INSET = 6

/** Corner radius for panel edges touching the window boundary (macOS native corners → larger) */
export const RADIUS_EDGE = isMac ? 14 : 8

/** Corner radius for interior corners between panels */
export const RADIUS_INNER = 10

/** Minimum width for any content panel */
export const PANEL_MIN_WIDTH = 440
