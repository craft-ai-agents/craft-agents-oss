// ============================================================================
// Dagre layout adapter — shared utilities for @dagrejs/dagre integration
//
// Provides:
//   1. snapToOrthogonal()       — post-processes edge points into 90-degree segments
//   2. centerToTopLeft()        — converts dagre's center-based coords to top-left
//   3. clipToDiamondBoundary()  — projects rectangle-boundary points onto the diamond
//   4. clipEndpointsToNodes()   — fixes endpoints after orthogonalization
//
// Dagre outputs node positions as center coordinates and edge points that
// may not be strictly orthogonal. These helpers bridge the gap so our SVG
// renderers receive the same top-left coords and orthogonal edge paths
// they previously got from ELK.
// ============================================================================

import type { Point } from './types.ts'

/**
 * Convert dagre's center-based node coordinates to top-left origin.
 * Dagre returns (x, y) as the center of the node bounding box.
 * Our renderers expect top-left coordinates.
 */
export function centerToTopLeft(cx: number, cy: number, width: number, height: number): Point {
  return { x: cx - width / 2, y: cy - height / 2 }
}

/**
 * Project a point from the rectangular bounding box onto the diamond boundary.
 *
 * Dagre treats all nodes as rectangles, so edge connection points land on the
 * rectangle boundary. For diamond shapes (rotated squares), the actual visual
 * boundary is an inscribed diamond whose vertices touch the rectangle's edge
 * midpoints. At non-cardinal angles, the rectangle boundary is *outside* the
 * diamond — making edges appear to float in the air.
 *
 * Math: the diamond boundary satisfies |dx|/hw + |dy|/hh = 1 where (dx,dy) is
 * the offset from center and (hw,hh) are half-width/height. We scale the
 * direction vector so it lands exactly on this boundary.
 */
export function clipToDiamondBoundary(
  point: Point,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): Point {
  const dx = point.x - cx
  const dy = point.y - cy
  // Point is at (or very near) center — nothing to clip
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return point
  // Scale the direction vector to land on the diamond boundary
  const scale = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
  return { x: cx + scale * dx, y: cy + scale * dy }
}

/**
 * Project a point from the rectangular bounding box onto the circle boundary.
 *
 * Dagre treats all nodes as rectangles, so edge connection points land on the
 * rectangle boundary. For circular shapes (circle, doublecircle, state-start,
 * state-end), the actual visual boundary is inscribed within the rectangle.
 * At non-cardinal angles, the rectangle boundary is *outside* the circle —
 * making edges appear to float in the air.
 *
 * Math: scale the direction vector (from center to point) so its length equals
 * the circle radius.
 */
export function clipToCircleBoundary(
  point: Point,
  cx: number,
  cy: number,
  r: number,
): Point {
  const dx = point.x - cx
  const dy = point.y - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  // Point is at (or very near) center — nothing to clip
  if (dist < 0.5) return point
  const scale = r / dist
  return { x: cx + scale * dx, y: cy + scale * dy }
}

/**
 * Post-process dagre edge points into strictly orthogonal (90-degree) segments.
 *
 * Dagre's Sugiyama layout routes edges through intermediate dummy nodes at each
 * rank, so most segments are already axis-aligned. However, when source and target
 * are at different horizontal positions, diagonal segments can appear.
 *
 * Strategy: walk consecutive point pairs. If both x and y differ, insert an
 * intermediate bend point to create an L-shaped orthogonal path. The bend
 * direction depends on the layout axis:
 *   - verticalFirst=true  (TD/BT): drop vertically, then adjust sideways
 *   - verticalFirst=false (LR/RL): move sideways, then adjust vertically
 *
 * After orthogonalization, collinear points (three consecutive points on the
 * same axis) are eliminated to avoid redundant micro-segments.
 */
export function snapToOrthogonal(points: Point[], verticalFirst = true): Point[] {
  if (points.length < 2) return points

  const result: Point[] = [points[0]!]

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]!
    const curr = points[i]!

    const dx = Math.abs(curr.x - prev.x)
    const dy = Math.abs(curr.y - prev.y)

    // If already axis-aligned (or close enough), keep as-is
    if (dx < 1 || dy < 1) {
      result.push(curr)
      continue
    }

    // Insert an L-bend whose direction matches the layout flow.
    // TD/BT layouts: vertical first — edge drops along the rank axis, then adjusts.
    // LR/RL layouts: horizontal first — edge moves along the rank axis, then adjusts.
    if (verticalFirst) {
      result.push({ x: prev.x, y: curr.y })
    } else {
      result.push({ x: curr.x, y: prev.y })
    }
    result.push(curr)
  }

  // Eliminate collinear points — if three consecutive points share the same x
  // (vertical segment) or same y (horizontal segment), the middle point is
  // redundant and creates visual artifacts at polyline corners.
  return removeCollinear(result)
}

/** Remove middle points from three-in-a-row collinear sequences. */
function removeCollinear(pts: Point[]): Point[] {
  if (pts.length < 3) return pts
  const out: Point[] = [pts[0]!]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]!
    const b = pts[i]!
    const c = pts[i + 1]!
    // Skip b if a-b-c are all on the same horizontal or vertical line
    const sameX = Math.abs(a.x - b.x) < 1 && Math.abs(b.x - c.x) < 1
    const sameY = Math.abs(a.y - b.y) < 1 && Math.abs(b.y - c.y) < 1
    if (sameX || sameY) continue
    out.push(b)
  }
  out.push(pts[pts.length - 1]!)
  return out
}

/**
 * Node rectangle for endpoint clipping — uses dagre's center-based coordinates.
 */
export interface NodeRect {
  /** Center x (dagre coordinate) */
  cx: number
  /** Center y (dagre coordinate) */
  cy: number
  /** Half-width */
  hw: number
  /** Half-height */
  hh: number
}

/**
 * Clip edge endpoints to the correct side of rectangular node boundaries.
 *
 * After snapToOrthogonal(), the final/first segment direction may differ from
 * dagre's original boundary intersection direction. Dagre computes boundary
 * points based on the diagonal direction between nodes, but orthogonalization
 * converts the path to L-bends — changing the approach direction of the
 * first/last segment.
 *
 * Example: in a TB layout, dagre places the target endpoint at the TOP of a
 * node (correct for a diagonal approach). After snapToOrthogonal, the last
 * segment becomes horizontal — but the endpoint stays on the top edge. The
 * arrow visually enters the box from the side at the top, going "inside."
 *
 * This function corrects both endpoints so they connect to the side the edge
 * actually approaches from:
 *   - Horizontal last segment → endpoint on left/right side
 *   - Vertical last segment  → endpoint on top/bottom
 *   - Similarly for the first segment and source node
 *
 * When the edge path is within the node's bounds, connects at the natural
 * position to avoid unnecessary bends. Otherwise routes to node center.
 *
 * For 2-point edges (direct connections), clips based on the overall direction
 * between endpoints to ensure arrowheads render at node boundaries.
 */
export function clipEndpointsToNodes(
  points: Point[],
  sourceNode: NodeRect | null,
  targetNode: NodeRect | null,
): Point[] {
  if (points.length < 2) return points
  const result = points.map(p => ({ ...p }))

  // --- Fix target endpoint ---
  if (targetNode) {
    const last = result.length - 1

    if (points.length === 2) {
      // 2-point edge: clip based on overall direction between endpoints
      // This ensures arrowheads render at node boundaries, not inside nodes
      const first = result[0]!
      const curr = result[last]!
      const dx = Math.abs(curr.x - first.x)
      const dy = Math.abs(curr.y - first.y)

      if (dy >= dx) {
        // Primarily vertical — clip to top/bottom
        const approachFromTop = curr.y > first.y
        const sideY = approachFromTop
          ? targetNode.cy - targetNode.hh
          : targetNode.cy + targetNode.hh
        result[last] = { x: curr.x, y: sideY }
      } else {
        // Primarily horizontal — clip to left/right
        const approachFromLeft = curr.x > first.x
        const sideX = approachFromLeft
          ? targetNode.cx - targetNode.hw
          : targetNode.cx + targetNode.hw
        result[last] = { x: sideX, y: curr.y }
      }
    } else {
      // 3+ point edge: use last segment direction
      const prev = result[last - 1]!
      const curr = result[last]!
      const dx = Math.abs(curr.x - prev.x)
      const dy = Math.abs(curr.y - prev.y)

      // Strictly axis-aligned segments (< 1px deviation) route to center for visual balance.
      // Primarily axis-aligned segments (dx >> dy) can use natural positions within bounds.
      const isStrictlyHorizontal = dy < 1 && dx >= 1
      const isStrictlyVertical = dx < 1 && dy >= 1
      const isPrimarilyHorizontal = !isStrictlyHorizontal && !isStrictlyVertical && dy < dx
      const isPrimarilyVertical = !isStrictlyHorizontal && !isStrictlyVertical && dx < dy

      if (isStrictlyHorizontal) {
        // Strictly horizontal — route to center for visual balance
        const approachFromLeft = curr.x > prev.x
        const sideX = approachFromLeft
          ? targetNode.cx - targetNode.hw
          : targetNode.cx + targetNode.hw
        result[last] = { x: sideX, y: targetNode.cy }
        result[last - 1] = { ...prev, y: targetNode.cy }
      } else if (isStrictlyVertical) {
        // Strictly vertical — route to center for visual balance
        const approachFromTop = curr.y > prev.y
        const sideY = approachFromTop
          ? targetNode.cy - targetNode.hh
          : targetNode.cy + targetNode.hh
        result[last] = { x: targetNode.cx, y: sideY }
        result[last - 1] = { ...prev, x: targetNode.cx }
      } else if (isPrimarilyHorizontal) {
        // Primarily horizontal — use natural Y if within bounds
        const approachFromLeft = curr.x > prev.x
        const sideX = approachFromLeft
          ? targetNode.cx - targetNode.hw
          : targetNode.cx + targetNode.hw

        const withinVerticalBounds =
          prev.y >= targetNode.cy - targetNode.hh &&
          prev.y <= targetNode.cy + targetNode.hh

        if (withinVerticalBounds) {
          result[last] = { x: sideX, y: prev.y }
        } else {
          result[last] = { x: sideX, y: targetNode.cy }
          result[last - 1] = { ...prev, y: targetNode.cy }
        }
      } else if (isPrimarilyVertical) {
        // Primarily vertical — use natural X if within bounds
        const approachFromTop = curr.y > prev.y
        const sideY = approachFromTop
          ? targetNode.cy - targetNode.hh
          : targetNode.cy + targetNode.hh

        const withinHorizontalBounds =
          prev.x >= targetNode.cx - targetNode.hw &&
          prev.x <= targetNode.cx + targetNode.hw

        if (withinHorizontalBounds) {
          result[last] = { x: prev.x, y: sideY }
        } else {
          result[last] = { x: targetNode.cx, y: sideY }
          result[last - 1] = { ...prev, x: targetNode.cx }
        }
      }
    }
  }

  // --- Fix source endpoint (first segment) ---
  if (sourceNode && points.length >= 3) {
    // Only process 3+ point edges for source — 2-point edges don't need source adjustment
    const first = result[0]!
    const next = result[1]!
    const dx = Math.abs(next.x - first.x)
    const dy = Math.abs(next.y - first.y)

    // Strictly axis-aligned segments (< 1px deviation) route to center for visual balance.
    // Primarily axis-aligned segments (dx >> dy) can use natural positions within bounds.
    const isStrictlyHorizontal = dy < 1 && dx >= 1
    const isStrictlyVertical = dx < 1 && dy >= 1
    const isPrimarilyHorizontal = !isStrictlyHorizontal && !isStrictlyVertical && dy < dx
    const isPrimarilyVertical = !isStrictlyHorizontal && !isStrictlyVertical && dx < dy

    if (isStrictlyHorizontal) {
      // Strictly horizontal — route from center for visual balance
      const exitToRight = next.x > first.x
      const sideX = exitToRight
        ? sourceNode.cx + sourceNode.hw
        : sourceNode.cx - sourceNode.hw
      result[0] = { x: sideX, y: sourceNode.cy }
      result[1] = { ...result[1]!, y: sourceNode.cy }
    } else if (isStrictlyVertical) {
      // Strictly vertical — route from center for visual balance
      const exitDownward = next.y > first.y
      const sideY = exitDownward
        ? sourceNode.cy + sourceNode.hh
        : sourceNode.cy - sourceNode.hh
      result[0] = { x: sourceNode.cx, y: sideY }
      result[1] = { ...result[1]!, x: sourceNode.cx }
    } else if (isPrimarilyHorizontal) {
      // Primarily horizontal — use natural Y if within bounds
      const exitToRight = next.x > first.x
      const sideX = exitToRight
        ? sourceNode.cx + sourceNode.hw
        : sourceNode.cx - sourceNode.hw

      const withinVerticalBounds =
        next.y >= sourceNode.cy - sourceNode.hh &&
        next.y <= sourceNode.cy + sourceNode.hh

      if (withinVerticalBounds) {
        result[0] = { x: sideX, y: next.y }
      } else {
        result[0] = { x: sideX, y: sourceNode.cy }
        result[1] = { ...result[1]!, y: sourceNode.cy }
      }
    } else if (isPrimarilyVertical) {
      // Primarily vertical — use natural X if within bounds
      const exitDownward = next.y > first.y
      const sideY = exitDownward
        ? sourceNode.cy + sourceNode.hh
        : sourceNode.cy - sourceNode.hh

      const withinHorizontalBounds =
        next.x >= sourceNode.cx - sourceNode.hw &&
        next.x <= sourceNode.cx + sourceNode.hw

      if (withinHorizontalBounds) {
        result[0] = { x: next.x, y: sideY }
      } else {
        result[0] = { x: sourceNode.cx, y: sideY }
        result[1] = { ...result[1]!, x: sourceNode.cx }
      }
    }
  }

  return result
}
