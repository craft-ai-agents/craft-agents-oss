export * from './craft-agent.ts';
export * from './errors.ts';
export * from './options.ts';

// Export session-scoped-tools - tools scoped to a specific session
export {
  // Tool factories (creates session-scoped tools)
  createSubmitPlanTool,
  // Session-scoped tools provider
  getSessionScopedTools,
  cleanupSessionScopedTools,
  // Plan file management
  getSessionPlansDir,
  getLastPlanFilePath,
  clearPlanFileState,
  isPathInPlansDir,
  // Callback registry for session-scoped tool notifications
  registerSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
  // Types
  type SessionScopedToolCallbacks,
  type CredentialRequest,
  type CredentialResponse,
  type CredentialInputMode,
} from './session-scoped-tools.ts';

// Export mode-manager - Centralized mode management
export {
  // Permission Mode API (primary)
  getPermissionMode,
  setPermissionMode,
  cyclePermissionMode,
  subscribeModeChanges,
  PERMISSION_MODE_ORDER,
  PERMISSION_MODE_CONFIG,
  hexToRgb,
  type PermissionMode,
  getModeState,
  initializeModeState,
  cleanupModeState,
  // Tool blocking (centralized)
  shouldAllowToolInMode,
  blockWithReason,
  // Session state (lightweight per-message injection)
  getSessionState,
  formatSessionState,
  // Mode manager singleton (for advanced use cases)
  modeManager,
  // Types
  type ModeState,
  type ModeCallbacks,
  type ModeConfig,
} from './mode-manager.ts';

// Export plan review types for electron app (plans can still be submitted via SubmitPlan)
export type { PlanReviewRequest, PlanReviewResult } from '../agents/plan-types.ts';

// Export permissions-config - customizable permissions per workspace/source (permissions.json)
export {
  // Parser and validation
  parsePermissionsJson,
  validatePermissionsConfig,
  PermissionsConfigSchema,
  // API endpoint checking
  isApiEndpointAllowed,
  // Storage functions
  loadWorkspacePermissionsConfig,
  loadSourcePermissionsConfig,
  getWorkspacePermissionsPath,
  getSourcePermissionsPath,
  // Cache singleton
  permissionsConfigCache,
  // Types
  type ApiEndpointRule,
  type CompiledApiEndpointRule,
  type PermissionsCustomConfig,
  type PermissionsConfigFile,
  type MergedPermissionsConfig,
  type PermissionsContext,
} from './permissions-config.ts';
