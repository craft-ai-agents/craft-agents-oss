/**
 * Default Status Icon SVGs
 *
 * Embedded SVG strings for default status icons.
 * These are auto-created as files in statuses/icons/ when missing.
 */

/**
 * Default icon SVGs mapped by filename (without .svg extension)
 */
export const DEFAULT_ICON_SVGS: Record<string, string> = {
  /**
   * Backlog - CircleDashed (larger gaps)
   * Empty circle with widely-spaced dashed stroke for "not yet planned"
   */
  'backlog': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9" stroke-dasharray="6 5" />
</svg>`,

  /**
   * Todo - Circle (solid outline)
   * Empty circle with solid stroke for "ready to work on"
   */
  'todo': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9" />
</svg>`,

  /**
   * In Progress - CircleProgress
   * Half-filled circle (left side filled)
   */
  'in-progress': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9" />
  <path d="M12 3a9 9 0 0 0 0 18" fill="currentColor" stroke="none" />
</svg>`,

  /**
   * Needs Review - CircleEye
   * Circle with dot in center
   */
  'needs-review': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9" />
  <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
</svg>`,

  /**
   * Done - CircleCheckFilled
   * Filled circle with checkmark
   */
  'done': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
  <circle cx="12" cy="12" r="10" />
  <path d="M8 12l3 3 5-5" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
</svg>`,

  /**
   * Cancelled - CircleXFilled
   * Filled circle with X mark
   */
  'cancelled': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
  <circle cx="12" cy="12" r="10" />
  <path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
</svg>`,

  // Procurement task-type statuses. Same lucide icons as the TaskBar task buttons
  // (Search / Replace / GitCompareArrows / Users / FileText) so status and launcher
  // stay visually consistent. stroke=currentColor → tinted by the status color
  // (must be a real SVG, not the empty-icon fallback which forces text-muted-foreground).
  'find': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="m21 21-4.34-4.34" />
  <circle cx="11" cy="11" r="8" />
</svg>`,
  'alternative': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 4a1 1 0 0 1 1-1" />
  <path d="M15 10a1 1 0 0 1-1-1" />
  <path d="M21 4a1 1 0 0 0-1-1" />
  <path d="M21 9a1 1 0 0 1-1 1" />
  <path d="m3 7 3 3 3-3" />
  <path d="M6 10V5a2 2 0 0 1 2-2h2" />
  <rect x="3" y="14" width="7" height="7" rx="1" />
</svg>`,
  'compare': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="5" cy="6" r="3" />
  <path d="M12 6h5a2 2 0 0 1 2 2v7" />
  <path d="m15 9-3-3 3-3" />
  <circle cx="19" cy="18" r="3" />
  <path d="M12 18H7a2 2 0 0 1-2-2V9" />
  <path d="m9 15 3 3-3 3" />
</svg>`,
  'supplier': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
  <path d="M16 3.128a4 4 0 0 1 0 7.744" />
  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
  <circle cx="9" cy="7" r="4" />
</svg>`,
  'doc': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  <path d="M10 9H8" />
  <path d="M16 13H8" />
  <path d="M16 17H8" />
</svg>`,
};

/**
 * Get default icon SVG by status ID
 */
export function getDefaultIconSvg(statusId: string): string | undefined {
  return DEFAULT_ICON_SVGS[statusId];
}
