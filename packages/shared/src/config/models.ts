/**
 * Centralized model definitions for the entire application.
 * Update model IDs here when new versions are released.
 */

export interface ModelDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
}

// ============================================
// USER-SELECTABLE MODELS (shown in UI)
// ============================================

export const MODELS: ModelDefinition[] = [
  { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', shortName: 'Opus', description: 'Most capable' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', shortName: 'Sonnet', description: 'Balanced' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', shortName: 'Haiku', description: 'Fast & efficient' },
];

// ============================================
// PURPOSE-SPECIFIC DEFAULTS
// ============================================

/** Default model for main chat (user-facing) */
export const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

/** Model for agent definition extraction (always high quality) */
export const EXTRACTION_MODEL = 'claude-opus-4-5-20251101';

/** Model for API response summarization (cost efficient) */
export const SUMMARIZATION_MODEL = 'claude-haiku-4-5-20251001';

/** Model for instruction updates (high quality for accurate document editing) */
export const INSTRUCTION_UPDATE_MODEL = 'claude-opus-4-5-20251101';

// ============================================
// HELPER FUNCTIONS
// ============================================

/** Get display name for a model ID (full name with version) */
export function getModelDisplayName(modelId: string): string {
  const model = MODELS.find(m => m.id === modelId);
  if (model) return model.name;
  // Fallback: strip prefix and date suffix
  return modelId.replace('claude-', '').replace(/-\d{8}$/, '');
}

/** Get short display name for a model ID (without version number) */
export function getModelShortName(modelId: string): string {
  const model = MODELS.find(m => m.id === modelId);
  if (model) return model.shortName;
  // Fallback: strip prefix and date suffix
  return modelId.replace('claude-', '').replace(/-[\d.-]+$/, '');
}

/** Check if model is an Opus model (for cache TTL decisions) */
export function isOpusModel(modelId: string): boolean {
  return modelId.includes('opus');
}
