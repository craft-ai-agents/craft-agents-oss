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

// Export mode-manager - Safe Mode is user-controlled read-only exploration
export {
  // Safe Mode state management
  isSafeModeActive,
  enterSafeMode,
  exitSafeMode,
  toggleSafeMode,
  initializeModeState,
  cleanupModeState,
  getModeState,
  // Safe Mode context for user messages
  getSafeModeContext,
  // Tool blocking utilities
  isToolBlockedInSafeMode,
  isMcpToolAllowedInSafeMode,
  isApiCallAllowedInSafeMode,
  getSafeModeBlockReason,
  isReadOnlyMcpTool,
  isReadOnlyApiMethod,
  SAFE_MODE_BLOCKED_TOOLS,
  // Mode manager singleton (for advanced use cases)
  modeManager,
  // Types
  type ModeState,
  type ModeCallbacks,
} from './mode-manager.ts';

// Export plan review types for electron app (plans can still be submitted via SubmitPlan)
export type { PlanReviewRequest, PlanReviewResult } from '../agents/plan-types.ts';
