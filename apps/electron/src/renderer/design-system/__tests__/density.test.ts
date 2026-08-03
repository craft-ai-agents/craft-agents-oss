/**
 * Density tests.
 *
 * The previous "Compact UI" toggle set a `compact-ui` class on <html> that no
 * stylesheet consumed, so the control did nothing. These tests exist mainly to
 * stop that from being true again: it is not enough for density.css to parse,
 * it has to actually reach the declarations that produce spacing.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DS_DIR = join(import.meta.dir, '..')
const RENDERER_DIR = join(DS_DIR, '..')

const density = readFileSync(join(DS_DIR, 'density.css'), 'utf8')

/** Body of a selector block, so assertions cannot match a neighbouring rule. */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`selector not found: ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

describe('density tokens', () => {
  test('comfortable is the default and is exactly 1', () => {
    // The whole no-visual-regression argument rests on this: at scale 1 every
    // calc(Npx * var(--density-scale)) collapses to Npx.
    expect(block(density, ':root {')).toContain('--density-scale: 1')
  })

  test('compact is keyed off data-density, not a bare class', () => {
    expect(density).toContain(":root[data-density='compact']")
    // The dead implementation used this class. It must not come back.
    expect(density).not.toContain('.compact-ui')
  })

  test('compact scales below comfortable but stays legible', () => {
    const compact = block(density, ":root[data-density='compact'] {")
    const scale = compact.match(/--density-scale:\s*([0-9.]+)/)?.[1]
    expect(scale).toBeDefined()
    const value = Number(scale)
    expect(value).toBeGreaterThan(0.6)
    expect(value).toBeLessThan(1)
  })

  test('compact overrides all three spacing layers', () => {
    const compact = block(density, ":root[data-density='compact'] {")
    // 1. Tailwind's scale — by far the largest surface.
    expect(compact).toContain('--spacing:')
    // 2. The design-system scale.
    expect(compact).toContain('--ds-space-1:')
    expect(compact).toContain('--ds-space-6:')
    // 3. The multiplier hand-written CSS uses.
    expect(compact).toContain('--density-scale:')
  })

  test('the --spacing override matches the declared multiplier', () => {
    const compact = block(density, ":root[data-density='compact'] {")
    const scale = Number(compact.match(/--density-scale:\s*([0-9.]+)/)![1])
    const spacing = Number(compact.match(/--spacing:\s*([0-9.]+)rem/)![1])
    // Tailwind's default is 0.25rem; compact must be that times the scale, or
    // utilities and hand-written CSS would shrink by different amounts.
    expect(spacing).toBeCloseTo(0.25 * scale, 5)
  })

  test('compact ds-space values are whole pixels', () => {
    const compact = block(density, ":root[data-density='compact'] {")
    const values = [...compact.matchAll(/--ds-space-\d:\s*([0-9.]+)px/g)].map((m) => Number(m[1]))
    expect(values.length).toBeGreaterThanOrEqual(6)
    // Fractional px blur borders on non-integer DPI.
    for (const value of values) expect(Number.isInteger(value)).toBe(true)
  })

  test('compact ds-space scale stays monotonic', () => {
    const compact = block(density, ":root[data-density='compact'] {")
    const values = [...compact.matchAll(/--ds-space-(\d):\s*([0-9.]+)px/g)]
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => Number(m[2]))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
  })

  test('density is installed after tokens so it wins the cascade', () => {
    const index = readFileSync(join(DS_DIR, 'index.ts'), 'utf8')
    expect(index).toContain("import './density.css'")
    expect(index.indexOf("import './density.css'")).toBeGreaterThan(
      index.indexOf("import './tokens.css'"),
    )
  })

  test('does not scale what compact must not shrink', () => {
    const compact = block(density, ":root[data-density='compact'] {")
    // Text, hairlines and radii stay put — compact is less air, not smaller UI.
    for (const token of ['--ds-radius', 'font-size', '--ds-elevation', 'border-width']) {
      expect(compact).not.toContain(token)
    }
  })
})

describe('density is actually wired up (anti-placebo)', () => {
  test('ThemeContext applies the attribute the stylesheet selects on', () => {
    const ctx = readFileSync(join(RENDERER_DIR, 'context/ThemeContext.tsx'), 'utf8')
    expect(ctx).toContain('dataset.density')
    expect(ctx).toContain("'compact'")
    // Comfortable removes the attribute rather than setting a second value.
    expect(ctx).toContain('delete root.dataset.density')
  })

  test('density survives an unrelated theme write', () => {
    // Every setter builds a fresh StoredTheme from the fields it knows about,
    // so a replacing write drops density the first time the user touches the
    // theme mode. saveTheme must merge.
    const ctx = readFileSync(join(RENDERER_DIR, 'context/ThemeContext.tsx'), 'utf8')
    const saveTheme = ctx.slice(ctx.indexOf('function saveTheme'))
    expect(saveTheme.slice(0, 400)).toContain('...existing')
  })

  test('an unknown persisted density falls back to comfortable', () => {
    // localStorage is user-writable; an unknown value would leave the DOM
    // attribute set to something no stylesheet matches.
    const ctx = readFileSync(join(RENDERER_DIR, 'context/ThemeContext.tsx'), 'utf8')
    expect(ctx).toContain('DS_DENSITIES.includes')
  })

  test('density is applied before first paint', () => {
    // Without this the layout visibly reflows on every launch for a compact user.
    const html = readFileSync(join(RENDERER_DIR, 'index.html'), 'utf8')
    expect(html).toContain('dataset.density')
    // Must read the same key ThemeContext persists to (PREFIX + KEYS.theme).
    expect(html).toContain('craft-theme')
  })

  test('the pre-paint script runs before the app bundle', () => {
    const html = readFileSync(join(RENDERER_DIR, 'index.html'), 'utf8')
    expect(html.indexOf('dataset.density')).toBeLessThan(html.indexOf('main.tsx'))
  })

  test('the setting is reachable from the settings UI', () => {
    const page = readFileSync(join(RENDERER_DIR, 'pages/settings/AppearanceSettingsPage.tsx'), 'utf8')
    expect(page).toContain('settings.appearance.compactUi')
    expect(page).toContain('setDensity')
  })

  test('every locale carries the setting strings', () => {
    const localesDir = join(RENDERER_DIR, '../../../../packages/shared/src/i18n/locales')
    for (const locale of ['en', 'de', 'es', 'hu', 'ja', 'pl', 'zh-Hans']) {
      const path = join(localesDir, `${locale}.json`)
      if (!existsSync(path)) continue
      const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>
      expect(json['settings.appearance.compactUi']).toBeTruthy()
      expect(json['settings.appearance.compactUiDesc']).toBeTruthy()
    }
  })
})
