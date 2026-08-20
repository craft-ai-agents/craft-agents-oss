export const MIN_MIND_MAP_ZOOM = 0.2
export const MAX_MIND_MAP_ZOOM = 2.75
export const MIND_MAP_FIT_PADDING = 36

export interface MindMapViewportSize {
  width: number
  height: number
}

export interface MindMapViewport {
  x: number
  y: number
  zoom: number
}

export interface MindMapFitBounds {
  minX: number
  minY: number
  width: number
  height: number
}

export function clampMindMapZoom(zoom: number): number {
  return Math.min(MAX_MIND_MAP_ZOOM, Math.max(MIN_MIND_MAP_ZOOM, zoom))
}

/**
 * Centers every laid-out node inside the available viewport. `null` means the
 * map is not mounted or has not received a measurable size yet.
 */
export function fitMindMapViewport(
  size: MindMapViewportSize,
  bounds: MindMapFitBounds,
): MindMapViewport | null {
  const { width, height } = size
  if (width <= 0 || height <= 0) return null
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { x: width / 2, y: height / 2, zoom: 1 }
  }

  const availableWidth = Math.max(1, width - MIND_MAP_FIT_PADDING * 2)
  const availableHeight = Math.max(1, height - MIND_MAP_FIT_PADDING * 2)
  const zoom = clampMindMapZoom(
    Math.min(availableWidth / bounds.width, availableHeight / bounds.height, 1.35),
  )
  const centerX = bounds.minX + bounds.width / 2
  const centerY = bounds.minY + bounds.height / 2
  return {
    x: width / 2 - centerX * zoom,
    y: height / 2 - centerY * zoom,
    zoom,
  }
}
