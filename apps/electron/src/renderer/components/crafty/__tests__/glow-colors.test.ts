import { describe, expect, it } from 'bun:test'
import { craftyGlowColors, FALLBACK_GLOW_COLORS } from '../glow-colors'

describe('craftyGlowColors', () => {
  it('three vivid colors around the accent\'s hue', () => {
    const colors = craftyGlowColors('#6f49ca')
    expect(colors).toHaveLength(3)
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(colors).size).toBe(3)
  })

  it('Ultrathink\'s palette for a greyscale accent or one it can\'t read', () => {
    expect(craftyGlowColors('#808080')).toEqual(FALLBACK_GLOW_COLORS)
    expect(craftyGlowColors('oklch(0.5 0.2 290)')).toEqual(FALLBACK_GLOW_COLORS)
    expect(craftyGlowColors('')).toEqual(FALLBACK_GLOW_COLORS)
  })

  it('reads the CSS value with its whitespace', () => {
    expect(craftyGlowColors(' #6f49ca ')).toEqual(craftyGlowColors('#6f49ca'))
  })
})
