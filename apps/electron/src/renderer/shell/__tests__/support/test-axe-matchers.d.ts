/**
 * Type augmentation for the vitest-axe `toHaveNoViolations` matcher registered
 * at runtime by `scripts/test-axe-setup.ts` (via bun:test preload).
 *
 * Follows bun-types' documented module-augmentation pattern:
 *   declare module "bun:test" { interface Matchers<T> extends MyCustomMatchers {} }
 *
 * The type is declared inline rather than re-exported from vitest-axe so the
 * augmentation cannot break on that package's internal module layout.
 */

declare module 'bun:test' {
  interface Matchers<T = unknown> {
    /**
     * Assert that axe-core's results contain no accessibility violations.
     * Registered by scripts/test-axe-setup.ts via expect.extend.
     */
    toHaveNoViolations(): void
  }
}
