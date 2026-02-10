/**
 * Shared test setup for rendering tests.
 *
 * Enforces mandatory TEST_ENGINE environment variable selection.
 * Import this module at the top of any test file that uses rendering.
 *
 * Usage:
 *   import './test-setup'
 *   // or to access the engine value:
 *   import { TEST_ENGINE, ENGINE_LABEL, isSvgEngine } from './test-setup'
 *
 * Valid values:
 *   - svg: SVG rendering with ELK.js layout
 *   - ascii: ASCII rendering (uses own layout logic)
 */

/**
 * Test engine selection via TEST_ENGINE env var.
 * REQUIRED - tests will fail immediately if not set.
 * This ensures explicit choice of rendering mode.
 */
export type TestEngineType = 'svg' | 'svg_elk' | 'ascii'

const VALID_ENGINES: TestEngineType[] = ['svg', 'svg_elk', 'ascii']

export const TEST_ENGINE: TestEngineType = (() => {
  const env = process.env.TEST_ENGINE?.toLowerCase()
  if (!env) {
    throw new Error(
      'TEST_ENGINE environment variable is required.\n' +
        'Please set TEST_ENGINE=svg or TEST_ENGINE=ascii before running tests.\n' +
        'Example: TEST_ENGINE=svg bun test'
    )
  }
  if (!VALID_ENGINES.includes(env as TestEngineType)) {
    throw new Error(
      `Invalid TEST_ENGINE="${env}". Must be one of: ${VALID_ENGINES.join(', ')}`
    )
  }
  return env as TestEngineType
})()

/** Uppercase label for logging (e.g., "SVG", "ASCII") */
export const ENGINE_LABEL = TEST_ENGINE.toUpperCase()

/** Check if current engine is an SVG engine (not ASCII) */
export function isSvgEngine(): boolean {
  return TEST_ENGINE === 'svg' || TEST_ENGINE === 'svg_elk'
}

/** Check if current engine is ASCII */
export function isAsciiEngine(): boolean {
  return TEST_ENGINE === 'ascii'
}
