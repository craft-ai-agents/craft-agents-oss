// ============================================================================
// Multi-line Text Rendering Utilities
//
// Shared utilities for rendering multi-line text in SVG using <tspan> elements.
// Used across all diagram types (flowcharts, state, sequence, class, ER).
// ============================================================================

import { LINE_HEIGHT_RATIO } from './text-metrics.ts'

/**
 * Normalize <br>, <br/>, <br /> tags to newline characters.
 * Case-insensitive to match Mermaid standard behavior.
 */
export function normalizeBrTags(label: string): string {
  return label.replace(/<br\s*\/?>/gi, '\n')
}

/**
 * Escape special XML characters in text content.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Render a multi-line text element with proper vertical centering.
 *
 * For single-line text, returns a simple <text> element.
 * For multi-line text (containing \n), returns <text> with <tspan> children.
 *
 * @param text - The text to render (may contain \n)
 * @param cx - Center x coordinate
 * @param cy - Center y coordinate
 * @param fontSize - Font size in pixels
 * @param attrs - Additional SVG attributes (e.g., 'text-anchor="middle" fill="var(--_text)"')
 * @param baselineShift - Baseline shift for vertical alignment (default 0.35)
 * @returns SVG text element string
 */
export function renderMultilineText(
  text: string,
  cx: number,
  cy: number,
  fontSize: number,
  attrs: string,
  baselineShift: number = 0.35
): string {
  const lines = text.split('\n')

  // Single line — simple text element
  if (lines.length === 1) {
    const dy = fontSize * baselineShift
    return `<text x="${cx}" y="${cy}" ${attrs} dy="${dy}">${escapeXml(text)}</text>`
  }

  // Multi-line — use tspan elements with vertical centering
  const lineHeight = fontSize * LINE_HEIGHT_RATIO
  // First line dy: shift up by (n-1)/2 line heights, then add baseline shift
  const firstDy = -((lines.length - 1) / 2) * lineHeight + fontSize * baselineShift

  const tspans = lines.map((line, i) => {
    const dy = i === 0 ? firstDy : lineHeight
    return `<tspan x="${cx}" dy="${dy}">${escapeXml(line)}</tspan>`
  }).join('')

  return `<text x="${cx}" y="${cy}" ${attrs}>${tspans}</text>`
}

/**
 * Render a multi-line text element with a background rectangle (pill).
 *
 * Used for edge labels that need a background for readability.
 *
 * @param text - The text to render (may contain \n)
 * @param cx - Center x coordinate
 * @param cy - Center y coordinate
 * @param textWidth - Pre-calculated text width (max line width)
 * @param textHeight - Pre-calculated text height (lines × lineHeight)
 * @param fontSize - Font size in pixels
 * @param padding - Padding around text
 * @param textAttrs - SVG attributes for the text element
 * @param bgAttrs - SVG attributes for the background rect
 * @returns SVG elements string (rect + text)
 */
export function renderMultilineTextWithBackground(
  text: string,
  cx: number,
  cy: number,
  textWidth: number,
  textHeight: number,
  fontSize: number,
  padding: number,
  textAttrs: string,
  bgAttrs: string
): string {
  const bgWidth = textWidth + padding * 2
  const bgHeight = textHeight + padding * 2

  const rect = `<rect x="${cx - bgWidth / 2}" y="${cy - bgHeight / 2}" ` +
    `width="${bgWidth}" height="${bgHeight}" ${bgAttrs} />`

  const textEl = renderMultilineText(text, cx, cy, fontSize, textAttrs)

  return `${rect}\n${textEl}`
}
