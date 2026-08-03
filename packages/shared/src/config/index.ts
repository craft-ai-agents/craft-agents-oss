/**
 * Config Module
 *
 * NOT browser-safe. This barrel re-exports storage.ts and preferences.ts,
 * which import `fs`, `path` and `crypto`, so importing it from renderer code
 * drags Node builtins into the browser bundle.
 *
 * From the renderer, import types only:
 *   import type { SessionDraft } from '@archstudio/shared/config'
 * or reach for a browser-safe leaf directly:
 *   '@archstudio/shared/config/types', '.../provider-labels', '.../paths'
 *
 * `bun run check:renderer-node-imports` enforces this.
 * See labels/index.ts for the browser-safe barrel pattern.
 */

export * from './types.ts';
export * from './llm-connections.ts';
export * from './models.ts';
export * from './models-pi.ts';
export * from './model-fetcher.ts';
export * from './preferences.ts';
export * from './storage.ts';
export * from './theme.ts';
export * from './llm-validation.ts';
export * from './cli-domains.ts';
export * from './provider-labels.ts';
