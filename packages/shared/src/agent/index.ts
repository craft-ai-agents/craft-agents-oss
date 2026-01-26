export * from './vesper-agent.ts';
export * from './errors.ts';
export * from './options.ts';
export { buildDiagramContext } from './diagram-context.ts';

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
  // Auth request types (unified auth flow)
  type AuthRequest,
  type AuthRequestType,
  type AuthResult,
  type CredentialAuthRequest,
  type McpOAuthAuthRequest,
  type GoogleOAuthAuthRequest,
  type SlackOAuthAuthRequest,
  type MicrosoftOAuthAuthRequest,
  type CredentialInputMode,
  // Schedule types (conversational schedule management)
  type ScheduleCreateData,
  type ScheduleCreateResult,
  type ScheduleUpdateData,
  type ScheduleUpdateResult,
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
  // Default Explore mode patterns (for UI display)
  SAFE_MODE_CONFIG,
  // Types
  type ModeState,
  type ModeCallbacks,
  type ModeConfig,
} from './mode-manager.ts';

// Export plan types and permission mode messages
export type { Plan, PlanStep, PlanState, PlanReviewRequest, PlanReviewResult } from './plan-types.ts';
export { PERMISSION_MODE_MESSAGES, PERMISSION_MODE_PROMPTS } from './plan-types.ts';

// Export thinking-levels - extended reasoning configuration
export {
  type ThinkingLevel,
  type ThinkingLevelDefinition,
  THINKING_LEVELS,
  DEFAULT_THINKING_LEVEL,
  getThinkingTokens,
  getThinkingLevelName,
  isValidThinkingLevel,
} from './thinking-levels.ts';

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
  // App-level default permissions (at ~/.vesper/permissions/)
  getAppPermissionsDir,
  ensureDefaultPermissions,
  loadDefaultPermissions,
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
