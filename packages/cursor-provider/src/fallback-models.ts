/**
 * Fallback model list used before OAuth completes or when Cursor's model
 * discovery endpoint fails. Sourced from the Cursor model catalog snapshot
 * bundled alongside this package.
 */

import rawFallbackModels from './cursor-models-raw.json' with { type: 'json' };
import type { CursorModel } from './proxy.ts';
import { supportsReasoningModelId } from './models.ts';

export const FALLBACK_MODELS: CursorModel[] = (rawFallbackModels as CursorModel[]).map(
  (model) => ({
    ...model,
    reasoning: supportsReasoningModelId(model.id),
  }),
);
