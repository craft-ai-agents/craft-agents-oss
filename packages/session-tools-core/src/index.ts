/**
 * Session Tools Core
 *
 * Shared utilities for session-scoped tools used by both
 * Claude (in-process) and Codex (subprocess) implementations.
 *
 * @packageDocumentation
 */

// Types
export type {
  // Credential types
  CredentialInputMode,

  // Service types
  GoogleService,
  SlackService,
  MicrosoftService,

  // Auth request types
  AuthRequestType,
  BaseAuthRequest,
  CredentialAuthRequest,
  McpOAuthAuthRequest,
  GoogleOAuthAuthRequest,
  SlackOAuthAuthRequest,
  MicrosoftOAuthAuthRequest,
  AuthRequest,
  AuthResult,

  // IPC types
  CallbackMessage,

  // Tool result types
  TextContent,
  ToolResult,

  // Developer feedback
  DeveloperFeedback,

  // Validation types
  ValidationIssue,
  ValidationResult,

  // Source config types
  SourceType,
  McpTransport,
  McpAuthType,
  ApiAuthType,
  McpSourceConfig,
  ApiSourceConfig,
  LocalSourceConfig,
  SourceConfig,
  ConnectionStatus,
} from './types.ts';

// Response helpers
export {
  successResponse,
  errorResponse,
  textContent,
  multiBlockResponse,
} from './response.ts';

// Source helpers
export {
  getSourcePath,
  getSourceConfigPath,
  getSourceGuidePath,
  sourceExists,
  sourceConfigExists,
  loadSourceConfig,
  listSourceSlugs,
  getSkillPath,
  getSkillMdPath,
  skillExists,
  skillMdExists,
  listSkillSlugs,
  generateRequestId,
  // Multi-header credential helpers
  detectCredentialMode,
  getEffectiveHeaderNames,
} from './source-helpers.ts';

// API credential parsing and request-auth assembly (shared with @craft-agent/shared)
export {
  isBasicAuthCredential,
  isMultiHeaderCredential,
  parseJsonHeaderMap,
  apiAuthSpecFromConfig,
  parseStoredApiCredential,
  serializeHeaderCredential,
  buildAuthorizationHeader,
  buildApiAuthHeaders,
  appendQueryAuth,
  describeApiAuth,
} from './api-auth.ts';
export type {
  ApiCredential,
  BasicAuthCredential,
  MultiHeaderCredential,
  ApiAuthKind,
  ApiAuthSpec,
  StoredCredentialShape,
} from './api-auth.ts';

// Validation
export {
  // Result helpers
  validResult,
  invalidResult,
  mergeResults,

  // Formatting
  formatValidationResult,

  // JSON utilities
  readJsonFile,
  validateJsonFileHasFields,
  zodErrorToIssues,

  // Slug validation
  SLUG_REGEX,
  validateSlug,

  // Skill validation
  SkillMetadataSchema,
  validateSkillContent,

  // Source validation
  SOURCE_CONFIG_REQUIRED_FIELDS,
  SOURCE_TYPES,
  validateSourceConfigBasic,
} from './validation.ts';

// Context interface
export type {
  SessionToolContext,
  SessionToolCallbacks,
  FileSystemInterface,
  CredentialManagerInterface,
  ValidatorInterface,
  LoadedSource,
  // MCP validation types
  StdioMcpConfig,
  HttpMcpConfig,
  StdioValidationResult,
  McpValidationResult,
  ApiTestResult,
  // Session self-management types
  SessionInfo,
  SessionTaskInfo,
  SessionListItem,
  ListSessionsOptions,
  ListSessionsResult,
  BackgroundTaskInfo,
  SendAgentMessageResult,
  ResolvedLabelsResult,
  ResolvedStatusResult,
  CreateTaskInput,
  CreateTaskResult,
  ProjectMemoryAppendInput,
  ProjectMemoryAppendResult,
  // Pages types
  PagesToolCallbacks,
  PageToolRefreshSpec,
  PageToolSummary,
  PageToolDataSummary,
  PageToolDetails,
  CreatePageToolInput,
  UpdatePageToolPatch,
  PageDataToolPatch,
  PageDataWriteSummary,
  DeletePageToolResult,
  // MCP source resources & prompts types
  McpSourceToolCallbacks,
  McpSourceResource,
  McpSourceResourceTemplate,
  McpSourceResourceList,
  McpSourcePrompt,
  McpSourcePromptArgument,
  McpSourcePromptList,
  // Decision tool types
  DecisionToolCallbacks,
  DecisionToolQuestionType,
  DecisionToolInstructions,
  DecisionToolCriteria,
  DecisionToolQuestion,
  DecisionToolState,
  DecisionToolRequest,
  DecisionToolAnswer,
  DecisionToolUsage,
  DecisionToolError,
  DecisionToolResult,
  // PR watcher tool types
  PrWatchToolCallbacks,
  PrToolMergeMethod,
  PrToolStatus,
  PrToolStatusResult,
  PrBindToolResult,
  PrUnbindToolResult,
  PrAutoMergeToolResult,
} from './context.ts';

export { createNodeFileSystem } from './context.ts';

// Handlers
export {
  // SubmitPlan
  handleSubmitPlan,
  // Config Validate
  handleConfigValidate,
  // Skill Validate
  handleSkillValidate,
  // Mermaid Validate
  handleMermaidValidate,
  // Source Test
  handleSourceTest,
  // OAuth Triggers
  handleSourceOAuthTrigger,
  handleGoogleOAuthTrigger,
  handleSlackOAuthTrigger,
  handleMicrosoftOAuthTrigger,
  // Credential Prompt
  handleCredentialPrompt,
  // MCP source resources & prompts
  handleSourceListResources,
  handleSourceReadResource,
  handleSourceListPrompts,
  handleSourceGetPrompt,
  // Update Preferences
  handleUpdatePreferences,
  // Transform Data
  handleTransformData,
  // Script Sandbox
  handleScriptSandbox,
  // Render Template
  handleRenderTemplate,
  // Send Developer Feedback
  handleSendDeveloperFeedback,
  // Pages
  handleListPages,
  handleGetPage,
  handleCreatePage,
  handleUpdatePage,
  handleWritePageData,
  handleDeletePage,
  // Decision model
  handleDecide,
} from './handlers/index.ts';

export type {
  SubmitPlanArgs,
  ConfigValidateArgs,
  SkillValidateArgs,
  MermaidValidateArgs,
  SourceTestArgs,
  SourceOAuthTriggerArgs,
  GoogleOAuthTriggerArgs,
  SlackOAuthTriggerArgs,
  MicrosoftOAuthTriggerArgs,
  CredentialPromptArgs,
  SourceListResourcesArgs,
  SourceReadResourceArgs,
  SourceListPromptsArgs,
  SourceGetPromptArgs,
  UpdatePreferencesArgs,
  TransformDataArgs,
  ScriptSandboxArgs,
  RenderTemplateArgs,
  SendDeveloperFeedbackArgs,
  ListPagesArgs,
  GetPageArgs,
  CreatePageArgs,
  UpdatePageArgs,
  WritePageDataArgs,
  DeletePageArgs,
  DecideArgs,
} from './handlers/index.ts';

// Tool definitions — single source of truth
export {
  // Individual Zod schemas
  SubmitPlanSchema,
  ConfigValidateSchema,
  SkillValidateSchema,
  MermaidValidateSchema,
  SourceTestSchema,
  SourceOAuthTriggerSchema,
  CredentialPromptSchema,
  // MCP source resources & prompts schemas
  SourceListResourcesSchema,
  SourceReadResourceSchema,
  SourceListPromptsSchema,
  SourceGetPromptSchema,
  CallLlmSchema,
  DecideSchema,
  UpdatePreferencesSchema,
  TransformDataSchema,
  ScriptSandboxSchema,
  RenderTemplateSchema,
  // Browser tool schema
  BrowserToolSchema,
  // Developer feedback schema
  SendDeveloperFeedbackSchema,
  // Pages schemas
  ListPagesSchema,
  GetPageSchema,
  CreatePageSchema,
  UpdatePageSchema,
  WritePageDataSchema,
  DeletePageSchema,
  // Descriptions
  TOOL_DESCRIPTIONS,
  // Registry
  SESSION_TOOL_DEFS,
  SESSION_TOOL_NAMES,
  SESSION_BACKEND_TOOL_NAMES,
  SESSION_REGISTRY_TOOL_NAMES,
  SESSION_SAFE_ALLOWED_TOOL_NAMES,
  SESSION_SAFE_BLOCKED_TOOL_NAMES,
  SESSION_TOOL_REGISTRY,
  CODING_PROFILE_TOOLS,
  CODING_ONLY_TOOLS,
  // Filtered helper views
  getSessionToolDefs,
  getSessionToolNames,
  getSessionBackendToolNames,
  getSessionRegistryToolNames,
  getSessionToolRegistry,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
  // JSON Schema converter
  getToolDefsAsJsonSchema,
} from './tool-defs.ts';

export type {
  SessionToolExecutionMode,
  SessionToolSafeMode,
  SessionToolDef,
  RegistrySessionToolDef,
  BackendSessionToolDef,
  SessionToolHandler,
  JsonSchemaToolDef,
  SessionToolFilterOptions,
  SessionToolNameOptions,
  AgentProfile,
} from './tool-defs.ts';

// Script runtime resolution + path containment (also used by the shared
// automations script action — keep these exports runtime-only, no zod)
export {
  resolveScriptRuntime,
} from './runtime/resolve-script-runtime.ts';
export type {
  ScriptRuntimeLanguage,
  ResolvedScriptRuntime,
  ResolveScriptRuntimeContext,
} from './runtime/resolve-script-runtime.ts';
export {
  isPathWithinDirectory,
  isPathWithinDirectoryForCreation,
} from './runtime/path-security.ts';
