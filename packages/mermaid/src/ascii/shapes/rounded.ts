// ============================================================================
// Rounded rectangle shape renderer — uses rounded corner decorators
// ============================================================================

import type { ShapeRenderer } from './types.ts'
import { getBoxDimensions, renderBox, getBoxAttachmentPoint } from './rectangle.ts'
import { getCorners } from './corners.ts'

/**
 * Rounded rectangle shape renderer.
 * Uses rounded corner markers (╭╮╰╯) to indicate soft edges.
 *
 * Renders as:
 *   ╭─────────╮
 *   │  Label  │
 *   ╰─────────╯
 */
export const roundedRenderer: ShapeRenderer = {
  getDimensions: getBoxDimensions,

  render(label, dimensions, options) {
    const corners = getCorners('rounded', options.useAscii)
    return renderBox(label, dimensions, corners, options.useAscii)
  },

  getAttachmentPoint: getBoxAttachmentPoint,
}
