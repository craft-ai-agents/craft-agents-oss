/**
 * Views Module
 *
 * Dynamic views computed from session/knowledge state using Filtrex expressions.
 * Session views are never persisted on sessions — purely runtime evaluation.
 * Knowledge views may carry structured knowledgeFilter (P5).
 */

export type {
  ViewConfig,
  CompiledView,
  ViewEvaluationContext,
  KnowledgeViewEvaluationContext,
  ViewDomain,
  KnowledgeViewFilter,
  KnowledgeViewPresetAction,
} from './types.ts';
export {
  compileView,
  compileAllViews,
  evaluateViews,
  evaluateView,
  buildViewContext,
  buildKnowledgeViewContext,
} from './evaluator.ts';
export type {
  KnowledgeViewContextHit,
  KnowledgeViewContextNode,
  KnowledgeViewContextEnvelope,
} from './evaluator.ts';
export { validateViewExpression, AVAILABLE_FIELDS, AVAILABLE_FUNCTIONS } from './validation.ts';
export { getDefaultViews, getDefaultKnowledgeViews } from './defaults.ts';
export { VIEW_FUNCTIONS } from './functions.ts';
