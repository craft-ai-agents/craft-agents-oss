const STRUCTURED_INPUT_MAX_HEIGHT = 480
const STRUCTURED_INPUT_MIN_HEIGHT = 160
const STRUCTURED_INPUT_VIEWPORT_RATIO = 0.7

export function getStructuredInputMaxHeight(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return STRUCTURED_INPUT_MAX_HEIGHT
  }

  return Math.max(
    STRUCTURED_INPUT_MIN_HEIGHT,
    Math.min(STRUCTURED_INPUT_MAX_HEIGHT, Math.floor(viewportHeight * STRUCTURED_INPUT_VIEWPORT_RATIO))
  )
}
