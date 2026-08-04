/**
 * bun:test axe setup — registers vitest-axe's `toHaveNoViolations` matcher
 * via bun:test's official `expect.extend(...)` API.
 *
 * vitest-axe is vitest-agnostic at the matcher level: `toHaveNoViolations` is
 * a plain jest-style matcher `(received) => { pass, message, actual }`, and
 * bun's `expect.extend` invokes registered matchers with `(actualValue, ...)`.
 * (Bun 1.3.10's built-in matchers are native; the documented extension point
 * is `expect.extend` — assigning to `expect` or its prototype does NOT thread
 * the received value through.)
 *
 * Loaded via `bunfig.toml`:
 *   [test]
 *   preload = ["./scripts/test-setup.ts", "./scripts/test-axe-setup.ts"]
 *
 * The `axe(container)` helper itself is imported per-test from 'vitest-axe'
 * (it needs the test's jsdom `document` — the setup file must not capture it).
 */

import { expect } from 'bun:test'
import { toHaveNoViolations } from 'vitest-axe/dist/matchers.js'

;(expect as unknown as { extend: (m: Record<string, unknown>) => void }).extend({
  toHaveNoViolations,
})
