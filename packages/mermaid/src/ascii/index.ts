// ============================================================================
// beautiful-mermaid — ASCII renderer public API
//
// Renders Mermaid diagrams to ASCII or Unicode box-drawing art.
// No external dependencies — pure TypeScript.
//
// Supported diagram types:
//   - Flowcharts (graph TD / flowchart LR) — grid-based layout with A* pathfinding
//   - State diagrams (stateDiagram-v2) — same pipeline as flowcharts
//   - Sequence diagrams (sequenceDiagram) — column-based timeline layout
//   - Class diagrams (classDiagram) — level-based UML layout
//   - ER diagrams (erDiagram) — grid layout with crow's foot notation
//
// Usage:
//   import { renderMermaidAscii } from 'beautiful-mermaid'
//   const ascii = renderMermaidAscii('graph LR\n  A --> B')
// ============================================================================

import { parseMermaid } from '../parser.ts'
import { convertToAsciiGraph } from './converter.ts'
import { createMapping } from './grid.ts'
import { drawGraph } from './draw.ts'
import { canvasToString, flipCanvasVertically, flipRoleCanvasVertically } from './canvas.ts'
import { renderSequenceAscii } from './sequence.ts'
import { renderClassAscii } from './class-diagram.ts'
import { renderErAscii } from './er-diagram.ts'
import { detectColorMode, DEFAULT_ASCII_THEME } from './ansi.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'

// Re-export types for external use
export type { AsciiTheme, ColorMode }
export { DEFAULT_ASCII_THEME, detectColorMode }

export interface AsciiRenderOptions {
  /** true = ASCII chars (+,-,|,>), false = Unicode box-drawing (┌,─,│,►). Default: false */
  useAscii?: boolean
  /** Horizontal spacing between nodes. Default: 5 */
  paddingX?: number
  /** Vertical spacing between nodes. Default: 5 */
  paddingY?: number
  /** Padding inside node boxes. Default: 1 */
  boxBorderPadding?: number
  /**
   * Color mode for terminal output.
   * - 'none': No colors (plain text)
   * - 'auto': Auto-detect terminal capabilities
   * - 'ansi16': 16-color ANSI
   * - 'ansi256': 256-color xterm
   * - 'truecolor': 24-bit RGB
   * Default: 'none'
   */
  colorMode?: ColorMode | 'auto'
  /** Theme colors for ASCII output. Uses default theme if not provided. */
  theme?: Partial<AsciiTheme>
}

/**
 * Detect the diagram type from the mermaid source text.
 * Mirrors the detection logic in src/index.ts for the SVG renderer.
 */
function detectDiagramType(text: string): 'flowchart' | 'sequence' | 'class' | 'er' {
  const firstLine = text.trim().split('\n')[0]?.trim().toLowerCase() ?? ''

  if (/^sequencediagram\s*$/.test(firstLine)) return 'sequence'
  if (/^classdiagram\s*$/.test(firstLine)) return 'class'
  if (/^erdiagram\s*$/.test(firstLine)) return 'er'

  // Default: flowchart/state (handled by parseMermaid internally)
  return 'flowchart'
}

/**
 * Render Mermaid diagram text to an ASCII/Unicode string.
 *
 * Synchronous — no async layout engine needed (unlike the SVG renderer).
 * Auto-detects diagram type from the header line and dispatches to
 * the appropriate renderer.
 *
 * @param text - Mermaid source text (any supported diagram type)
 * @param options - Rendering options
 * @returns Multi-line ASCII/Unicode string
 *
 * @example
 * ```ts
 * const result = renderMermaidAscii(`
 *   graph LR
 *     A --> B --> C
 * `, { useAscii: true })
 *
 * // Output:
 * // +---+     +---+     +---+
 * // |   |     |   |     |   |
 * // | A |---->| B |---->| C |
 * // |   |     |   |     |   |
 * // +---+     +---+     +---+
 * ```
 */
export function renderMermaidAscii(
  text: string,
  options: AsciiRenderOptions = {},
): string {
  const config: AsciiConfig = {
    useAscii: options.useAscii ?? false,
    paddingX: options.paddingX ?? 5,
    paddingY: options.paddingY ?? 5,
    boxBorderPadding: options.boxBorderPadding ?? 1,
    graphDirection: 'TD', // default, overridden for flowcharts below
  }

  // Resolve color mode ('auto' → detect, or use specified mode)
  const colorMode: ColorMode = options.colorMode === 'auto'
    ? detectColorMode()
    : (options.colorMode ?? 'none')

  // Merge user theme with defaults
  const theme: AsciiTheme = { ...DEFAULT_ASCII_THEME, ...options.theme }

  const diagramType = detectDiagramType(text)

  switch (diagramType) {
    case 'sequence':
      // TODO: Add color support for sequence diagrams
      return renderSequenceAscii(text, config)

    case 'class':
      // TODO: Add color support for class diagrams
      return renderClassAscii(text, config)

    case 'er':
      // TODO: Add color support for ER diagrams
      return renderErAscii(text, config)

    case 'flowchart':
    default: {
      // Flowchart + state diagram pipeline (original)
      const parsed = parseMermaid(text)

      // Normalize direction for grid layout.
      // BT is laid out as TD then flipped vertically after drawing.
      // RL is treated as LR (full RL support not yet implemented).
      if (parsed.direction === 'LR' || parsed.direction === 'RL') {
        config.graphDirection = 'LR'
      } else {
        config.graphDirection = 'TD'
      }

      const graph = convertToAsciiGraph(parsed, config)
      createMapping(graph)
      drawGraph(graph)

      // BT: flip the finished canvas vertically so the flow runs bottom→top.
      // The grid layout ran as TD; flipping + character remapping produces BT.
      if (parsed.direction === 'BT') {
        flipCanvasVertically(graph.canvas)
        flipRoleCanvasVertically(graph.roleCanvas)
      }

      return canvasToString(graph.canvas, {
        roleCanvas: graph.roleCanvas,
        colorMode,
        theme,
      })
    }
  }
}
