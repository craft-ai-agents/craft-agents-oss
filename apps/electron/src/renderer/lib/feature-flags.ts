/**
 * Renderer-side readers for feature flags.
 *
 * Re-exports the shared runtime-evaluated checks so renderer code
 * (Knowledge mode gate, nav tree, surfaces) reads flags through one
 * canonical mechanism. CRAFT_FEATURE_KNOWLEDGE defaults ON; set
 * CRAFT_FEATURE_KNOWLEDGE=0 to fall back to the compatibility view.
 */
export { isKnowledgeFeatureEnabled } from '@craft-agent/shared/feature-flags';
