/**
 * Default zoom for app windows (Settings → Appearance → Default zoom), in percent. The choices
 * follow the browser zoom steps around 100%; the main process applies the stored one to every
 * app window after each load and on View → Reset Zoom.
 */
export const DEFAULT_ZOOM_LEVELS = [80, 90, 100, 110, 125, 150] as const

export const STANDARD_ZOOM_LEVEL = 100

/** The choice nearest to `level`; 100 for anything that isn't a finite number. */
export function normalizeZoomLevel(level: unknown): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) return STANDARD_ZOOM_LEVEL
  let nearest: number = STANDARD_ZOOM_LEVEL
  for (const choice of DEFAULT_ZOOM_LEVELS) {
    if (Math.abs(choice - level) < Math.abs(nearest - level)) nearest = choice
  }
  return nearest
}
