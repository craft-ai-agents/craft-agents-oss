# apps/electron/playwright

Visual regression snapshots for three LayoutShell workspace affordances:

1. **Depth popover open** — the keyboard-first depth-selector menu.
2. **Gated row with AlertTriangle banner** — the capped-row affordance
   surfaced when `expandedPaths` carries a row whose depth exceeds the
   active `expandDepth`.
3. **Open-dir cap badge** — the destructive-color pill that appears
   when `expandedPaths.size >= openDirCap` (default 50).

## Why this lives here, not in the happy-dom snapshot test

The existing `apps/electron/src/renderer/shell/__tests__/LayoutShell.
gated-row-snapshot.test.tsx` uses `bun:test` + `toMatchSnapshot` on
innerHTML — it catches HTML structure + class-name changes but NOT
gradients, `backdrop-filter`, `color-mix()`, animation timings, or
theme transitions. This is the explicit gap documented at the top of
that file. The tests in this directory close that gap for the
three affordances that carry the most visual weight.

## How it works

- `affordances/` — static HTML pages whose DOM mirrors the production
  render path in `LayoutShell.tsx` (verified against the existing
  snapshot file) and whose CSS comes from `styles.css`. The styles file
  is a curated subset of `apps/electron/src/renderer/shell/
  LayoutShell.css` containing exactly the selectors that drive the
  three affordances. No React, no Jotai, no theme provider — the goal
  is pixel-fidelity to the affordances, not full-app fidelity.
- `tests/affordances.pw.ts` — Playwright-only visual specs. The `.pw.ts`
  suffix keeps Bun's unit-test discovery from loading browser-runner tests.
- `tests/__screenshots__/` — committed, platform-neutral baselines;
  pixel-diff drives detection of unintended CSS refactors.

## Setup (one-time)

```bash
cd apps/electron
bun install                    # picks up @playwright/test
bun run playwright:install     # downloads Chromium (~300MB)
bun run playwright:test:update # record baselines
git add playwright/tests/__screenshots__
git commit
```

## Day-to-day

```bash
# Run all visual specs.
bun run playwright:test

# Re-record after an intentional CSS change.
bun run playwright:test:update
```

## Updating the curated CSS

When any of these selectors change in `LayoutShell.css`, mirror the
change in `affordances/styles.css`:

- `.wd-depth-popover*`
- `.wd-files-gated-banner*`
- `.wd-files-capped-badge`

Stale CSS in the curated file = missed regressions. Keep them in
sync manually. Each diff to `LayoutShell.css` that touches one of
these selectors should be paired with a diff to `styles.css` + a
`playwright:test:update` run.

## Future enhancements

- **CSS auto-extraction** — write `scripts/extract-affordance-css.ts`
  that parses `LayoutShell.css`, locates the three selector blocks
  plus their `@keyframes`/`@media` companions, and emits a fresh
  `affordances/styles.css`. Run from a pre-commit hook so the
  curated file can never drift.
- **Wire into `validate:dev` / `validate:ci`** — root-level passthroughs
  now exist, but CI still needs an explicit Chromium-install/cache step and
  cross-platform baseline policy before the visual suite can be made mandatory.
- **Reduced-motion spec** — a fourth spec that emulates
  `reducedMotion: 'reduce'` and snapshots the static
  fallback for `.wd-files-gated-banner__icon` and
  `.wd-files-capped-badge`.
- **Stable font bundle** — capture screenshots with a bundled font
  for `system-ui` so the Chromium cache doesn't drift between
  CI runs.

## Diffing

```bash
bunx playwright test --ui
```

Opens the Playwright UI, which lets you step through failing tests,
view the diff side-by-side, and approve or reject each pixel change.

## When this cost is too high

If the visual snapshot becomes a friction spot (font-rendering flicker
across Chromium versions, theme flicker on `:root` swaps), raise the
threshold:

```typescript
// playwright.config.ts
expect: { maxDiffPixelRatio: 0.005 }   // ~5 px per 1000
```

Drop it back to `0` after fixing the noise source. A drift-tolerant
threshold is fine for "I want to know about most regressions" — it's
not fine for "I want to know about every regression."
