/**
 * apps/electron/playwright/tests/affordances.spec.ts
 *
 * Visual regression snapshot tests for three Working Directory tree
 * affordances.  Each spec loads a static HTML harness (under
 * playwright/affordances/) that mirrors the production DOM + the
 * matching CSS rules extracted from LayoutShell.css, captures a
 * device-pixel-ratio screenshot of the captured affordance box, and
 * diffs it against the baseline in tests/__screenshots__/.
 *
 * What we catch:
 *   - CSS drift on selectors that are too long to comfortably
 *     substring-assert (popover background, badge colour, banner
 *     colour tokens, animation timings).
 *   - Class-name renames (dim rule breaks, banner class changes).
 *   - Visual regressions in icon glyphs (e.g. AlertTriangle → AlertOctagon
 *     swaps the silhouette).
 *
 * What we intentionally DON'T catch:
 *   - Real layout/paint of the actual app — no React, no Jotai,
 *     no Theme switching.  These tests are guard-rails only; the
 *     existing bun:happydom snapshots cover structure.
 *
 * To regenerate baselines after an intentional visual change:
 *
 *   bun run playwright:test:update
 *
 * To review a single diff during development:
 *
 *   bunx playwright test --ui
 */
import { test, expect } from '@playwright/test'

test.describe('LayoutShell workspace affordances — visual snapshots', () => {
  test('depth popover open', async ({ page }) => {
    await page.goto('popover-open.html')

    // The captured affordance is the entire stage + contents so we
    // get the trigger, the menu, and the section-header backgrop in
    // one shot, matching how the popover reads in production.
    const stage = page.locator('.affordance-stage')
    await expect(stage).toHaveScreenshot('depth-popover-open.png')
  })

  test('gated row with AlertTriangle banner', async ({ page }) => {
    await page.goto('gated-row.html')

    const stage = page.locator('.affordance-stage')
    await expect(stage).toHaveScreenshot('gated-row-banner.png')
  })

  test('open-dir cap badge (50 / 50 dirs)', async ({ page }) => {
    await page.goto('count-cap.html')

    const stage = page.locator('.affordance-stage')
    await expect(stage).toHaveScreenshot('count-cap-badge.png')
  })

  test('drill-mode chip (depth cap overridden)', async ({ page }) => {
    await page.goto('drill-mode.html')

    const stage = page.locator('.affordance-stage')
    await expect(stage).toHaveScreenshot('drill-mode-chip.png')
  })

  test('refreshing badge (refresh in flight)', async ({ page }) => {
    await page.goto('refreshing-badge.html')

    const stage = page.locator('.affordance-stage')
    await expect(stage).toHaveScreenshot('refreshing-badge.png')
  })

  test('thumbnail hover preview — popover open, pinned', async ({ page }) => {
    await page.goto('thumbnail-popover.html')

    const stage = page.locator('.affordance-stage')
    await expect(stage).toHaveScreenshot('thumbnail-hover-preview-popover.png')
  })

  test('image lightbox scrim — 2 / 3 with chevrons', async ({ page }) => {
    await page.goto('lightbox-scrim.html')

    const stage = page.locator('.affordance-stage')
    await expect(stage).toHaveScreenshot('lightbox-scrim.png')
  })
})
