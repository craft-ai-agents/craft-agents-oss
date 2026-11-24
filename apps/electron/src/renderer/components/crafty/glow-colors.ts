/**
 * The Crafty glow's colors: the theme accent with its two neighbours on the color wheel, so it
 * reads like Ultrathink's cyan-magenta-orange glow but in the theme's own colors.
 */

/** Ultrathink's palette (PulsingBorder's default), for an accent without a hue (greyscale themes). */
export const FALLBACK_GLOW_COLORS = ['#0dc1fd', '#d915ef', '#ff3f2e']

/** How far the neighbours sit from the accent's hue, in degrees. */
const HUE_STEP = 55

export function craftyGlowColors(accentHex: string): string[] {
  const match = accentHex.trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!match) return FALLBACK_GLOW_COLORS
  const [r, g, b] = match.slice(1).map(hex => parseInt(hex, 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma < 0.08) return FALLBACK_GLOW_COLORS
  let hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
  hue = (hue * 60 + 360) % 360
  const lightness = (max + min) / 2
  // Vivid and mid-light whatever the theme: a glow, not a tint of the accent
  const saturation = Math.max(0.75, chroma / (1 - Math.abs(2 * lightness - 1)))
  const light = Math.min(0.62, Math.max(0.52, lightness))
  return [hue - HUE_STEP, hue, hue + HUE_STEP].map(h => hslToHex((h + 360) % 360, Math.min(1, saturation), light))
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lightness - chroma / 2
  const [r, g, b] = hue < 60 ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0]
      : hue < 180 ? [0, chroma, x]
        : hue < 240 ? [0, x, chroma]
          : hue < 300 ? [x, 0, chroma]
            : [chroma, 0, x]
  return `#${[r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`
}
