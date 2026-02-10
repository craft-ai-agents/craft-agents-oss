// ============================================================================
// ASCII renderer — ANSI color utilities
//
// Provides terminal color escape sequences for themed ASCII output.
// Supports 16-color ANSI, 256-color xterm, and 24-bit true color modes.
// ============================================================================

import type { CharRole, AsciiTheme, ColorMode } from './types.ts'

// ============================================================================
// Default theme — matches SVG theme colors for consistency
// ============================================================================

/**
 * Default ASCII theme derived from the SVG renderer's color palette.
 * Uses the same mixing ratios to maintain visual consistency.
 */
export const DEFAULT_ASCII_THEME: AsciiTheme = {
  fg: '#27272a',      // zinc-800 — primary text
  border: '#a1a1aa',  // zinc-400 — node borders (12% mix)
  line: '#71717a',    // zinc-500 — edge lines (35% mix)
  arrow: '#52525b',   // zinc-600 — arrowheads (60% mix)
  corner: '#71717a',  // same as line
  junction: '#a1a1aa', // same as border
}

// ============================================================================
// Color mode detection
// ============================================================================

/**
 * Detect the best color mode for the current terminal environment.
 * Checks environment variables to determine terminal capabilities.
 *
 * Detection order:
 * 1. COLORTERM=truecolor or COLORTERM=24bit → truecolor
 * 2. TERM contains "256color" → ansi256
 * 3. TERM is set and not "dumb" → ansi16
 * 4. Otherwise → none
 */
export function detectColorMode(): ColorMode {
  // Check if we're in a Node.js-like environment with process object
  // Use globalThis to safely check for process without TypeScript errors
  const proc = (globalThis as { process?: { stdout?: { isTTY?: boolean }, env?: Record<string, string | undefined> } }).process

  if (proc) {
    // Check if stdout is a TTY (not piped/redirected)
    if (!proc.stdout?.isTTY) {
      return 'none'
    }

    const colorTerm = proc.env?.COLORTERM?.toLowerCase() ?? ''
    const term = proc.env?.TERM?.toLowerCase() ?? ''

    // True color support
    if (colorTerm === 'truecolor' || colorTerm === '24bit') {
      return 'truecolor'
    }

    // 256 color support
    if (term.includes('256color') || term.includes('256')) {
      return 'ansi256'
    }

    // Basic color support
    if (term && term !== 'dumb') {
      return 'ansi16'
    }
  }

  return 'none'
}

// ============================================================================
// Hex color parsing
// ============================================================================

/**
 * Parse a hex color string to RGB values.
 * Supports both 3-char (#RGB) and 6-char (#RRGGBB) formats.
 */
function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  if (h.length === 3) {
    return {
      r: parseInt(h[0]! + h[0]!, 16),
      g: parseInt(h[1]! + h[1]!, 16),
      b: parseInt(h[2]! + h[2]!, 16),
    }
  }
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

// ============================================================================
// ANSI escape code generation
// ============================================================================

/** ANSI escape sequence prefix */
const ESC = '\x1b['
/** Reset all attributes */
const RESET = `${ESC}0m`

/**
 * Generate ANSI foreground color escape sequence for 24-bit true color.
 * Format: ESC[38;2;R;G;Bm
 */
function truecolorFg(hex: string): string {
  const { r, g, b } = parseHex(hex)
  return `${ESC}38;2;${r};${g};${b}m`
}

/**
 * Find the closest 256-color palette index for an RGB color.
 * The 256-color palette has:
 * - 0-15: Standard colors (duplicates of 16-color)
 * - 16-231: 6x6x6 color cube (216 colors)
 * - 232-255: Grayscale ramp (24 shades)
 */
function rgbTo256(r: number, g: number, b: number): number {
  // Check if it's close to grayscale
  const avg = (r + g + b) / 3
  const maxDiff = Math.max(Math.abs(r - avg), Math.abs(g - avg), Math.abs(b - avg))

  if (maxDiff < 10) {
    // Use grayscale ramp (232-255)
    // Each step is ~10.625 (256/24)
    const gray = Math.round((avg / 255) * 23)
    return 232 + Math.min(23, Math.max(0, gray))
  }

  // Use 6x6x6 color cube (16-231)
  // Each channel maps to 0-5: 0, 95, 135, 175, 215, 255
  const toIndex = (v: number): number => {
    if (v < 48) return 0
    if (v < 115) return 1
    return Math.min(5, Math.floor((v - 35) / 40))
  }

  const ri = toIndex(r)
  const gi = toIndex(g)
  const bi = toIndex(b)

  return 16 + (36 * ri) + (6 * gi) + bi
}

/**
 * Generate ANSI foreground color escape sequence for 256-color mode.
 * Format: ESC[38;5;Nm
 */
function ansi256Fg(hex: string): string {
  const { r, g, b } = parseHex(hex)
  const index = rgbTo256(r, g, b)
  return `${ESC}38;5;${index}m`
}

/**
 * Map an RGB color to the closest 16-color ANSI code.
 * Returns the foreground color escape sequence.
 *
 * Standard 16 colors:
 * 0=black, 1=red, 2=green, 3=yellow, 4=blue, 5=magenta, 6=cyan, 7=white
 * 8-15 = bright versions
 */
function ansi16Fg(hex: string): string {
  const { r, g, b } = parseHex(hex)
  const luma = 0.299 * r + 0.587 * g + 0.114 * b

  // Determine brightness (use bright colors for better visibility)
  const bright = luma > 100 ? 0 : 60 // 60 = bright variant offset

  // Determine base color based on dominant channel
  let code: number
  if (r > 180 && g < 100 && b < 100) code = 31 // red
  else if (g > 180 && r < 100 && b < 100) code = 32 // green
  else if (r > 150 && g > 150 && b < 100) code = 33 // yellow
  else if (b > 180 && r < 100 && g < 100) code = 34 // blue
  else if (r > 150 && b > 150 && g < 100) code = 35 // magenta
  else if (g > 150 && b > 150 && r < 100) code = 36 // cyan
  else if (luma > 200) code = 37 // white
  else if (luma < 50) code = 30 // black
  else code = 37 // default to white for grays

  return `${ESC}${code + bright}m`
}

/**
 * Get the color for a character role from the theme.
 */
function getRoleColor(role: CharRole, theme: AsciiTheme): string {
  switch (role) {
    case 'text': return theme.fg
    case 'border': return theme.border
    case 'line': return theme.line
    case 'arrow': return theme.arrow
    case 'corner': return theme.corner ?? theme.line
    case 'junction': return theme.junction ?? theme.border
    default: return theme.fg
  }
}

/**
 * Generate the ANSI escape sequence for a role color.
 */
export function getAnsiColor(role: CharRole, theme: AsciiTheme, mode: ColorMode): string {
  if (mode === 'none') return ''

  const hex = getRoleColor(role, theme)

  switch (mode) {
    case 'truecolor': return truecolorFg(hex)
    case 'ansi256': return ansi256Fg(hex)
    case 'ansi16': return ansi16Fg(hex)
    default: return ''
  }
}

/**
 * Get the ANSI reset sequence.
 */
export function getAnsiReset(mode: ColorMode): string {
  return mode === 'none' ? '' : RESET
}

/**
 * Wrap a character with ANSI color codes based on its role.
 */
export function colorizeChar(
  char: string,
  role: CharRole | null,
  theme: AsciiTheme,
  mode: ColorMode,
): string {
  if (mode === 'none' || role === null || char === ' ') {
    return char
  }

  const colorCode = getAnsiColor(role, theme, mode)
  return `${colorCode}${char}${RESET}`
}

/**
 * Colorize an entire line efficiently by grouping consecutive same-role characters.
 * This reduces the number of escape sequences in the output.
 */
export function colorizeLine(
  chars: string[],
  roles: (CharRole | null)[],
  theme: AsciiTheme,
  mode: ColorMode,
): string {
  if (mode === 'none') {
    return chars.join('')
  }

  let result = ''
  let currentRole: CharRole | null = null
  let buffer = ''

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!
    const role = roles[i] ?? null

    // Whitespace doesn't need coloring
    if (char === ' ') {
      // Flush any buffered characters (with or without color)
      if (buffer.length > 0) {
        if (currentRole !== null) {
          result += getAnsiColor(currentRole, theme, mode) + buffer + RESET
        } else {
          result += buffer
        }
        buffer = ''
        currentRole = null
      }
      result += char
      continue
    }

    // Same role as previous — accumulate
    if (role === currentRole) {
      buffer += char
      continue
    }

    // Role changed — flush buffer (with or without color) and start new
    if (buffer.length > 0) {
      if (currentRole !== null) {
        result += getAnsiColor(currentRole, theme, mode) + buffer + RESET
      } else {
        result += buffer
      }
    }
    buffer = char
    currentRole = role
  }

  // Flush remaining buffer
  if (buffer.length > 0 && currentRole !== null) {
    result += getAnsiColor(currentRole, theme, mode) + buffer + RESET
  } else if (buffer.length > 0) {
    result += buffer
  }

  return result
}
