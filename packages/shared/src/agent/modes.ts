/**
 * Barrel re-export for `@craft-agent/shared/agent/modes`.
 *
 * All permission-mode types, constants, and helpers live in `mode-types.ts`.
 * This file exists so imports like `import { PermissionMode } from
 * '@craft-agent/shared/agent/modes'` resolve correctly without requiring
 * callers to know the internal file name.
 */
export * from './mode-types';