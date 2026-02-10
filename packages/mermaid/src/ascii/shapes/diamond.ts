// ============================================================================
// Diamond shape renderer — uses corner decorators instead of diagonals
// ============================================================================

import type { ShapeRenderer } from './types.ts'
import { getBoxDimensions, renderBox, getBoxAttachmentPoint } from './rectangle.ts'
import { getCorners } from './corners.ts'

/**
 * Diamond shape renderer.
 * Uses diamond markers (◇) at corners to indicate decision node semantics.
 *
 * Renders as:
 *   ◇─────────◇
 *   │  Label  │
 *   ◇─────────◇
 */
export const diamondRenderer: ShapeRenderer = {
  getDimensions: getBoxDimensions,

  render(label, dimensions, options) {
    const corners = getCorners('diamond', options.useAscii)
    return renderBox(label, dimensions, corners, options.useAscii)
  },

  getAttachmentPoint: getBoxAttachmentPoint,
}
