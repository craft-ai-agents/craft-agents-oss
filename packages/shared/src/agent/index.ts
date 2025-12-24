export * from './craft-agent.ts';
export * from './errors.ts';
export * from './options.ts';

// Export plan-tools - SubmitPlan is universal (agent can use anytime)
export {
  // Tool factory (creates session-scoped SubmitPlan tool)
  createSubmitPlanTool,
  // Plan file management
  getSessionPlansDir,
  getLastPlanFilePath,
  setLastPlanFilePath,
  clearPlanFileState,
  isPathInPlansDir,
  // Callback registry for plan submission notifications
  registerPlanCallbacks,
  unregisterPlanCallbacks,
  // Types
  type PlanCallbacks,
} from './plan-tools.ts';

// Export mode-manager - Centralized mode management
export {
  // Generic Mode API
  isModeActive,
  enterMode,
  exitMode,
  toggleMode,
  getActiveModes,
  getModeState,
  initializeModeState,
  cleanupModeState,
  // Tool blocking (centralized)
  shouldAllowToolInMode,
  blockWithReason,
  getBlockReason,
  // Session state (lightweight per-message injection)
  getSessionState,
  formatSessionState,
  // Mode context for user messages (deprecated - use formatSessionState)
  getModeContext,
  // Mode configurations
  MODE_CONFIGS,
  // Mode manager singleton (for advanced use cases)
  modeManager,
  // Types
  type Mode,
  type ModeState,
  type ModeCallbacks,
  type ModeConfig,
} from './mode-manager.ts';

// Export plan review types for electron app (plans can still be submitted via SubmitPlan)
export type { PlanReviewRequest, PlanReviewResult } from '../agents/plan-types.ts';
