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
  SessionListItem,
  ListSessionsOptions,
  ListSessionsResult,
  AgentListItem,
  ListAgentsOptions,
  ListAgentsResult,
  SkillListItem,
  ListSkillsOptions,
  ListSkillsResult,
  WorkflowListItem,
  WorkflowToolDetail,
  ListWorkflowsOptions,
  ListWorkflowsResult,
  // list_sources types
  SourceTier,
  SourceListItemType,
  SourceListItemAuthStatus,
  SourceListItem,
  ListSourcesOptions,
  ListSourcesResult,
  ResolvedLabelsResult,
  ResolvedStatusResult,
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
  // Agent catalog
  handleListAgents,
  handleListSources,
  // Workflows
  handleListWorkflows,
  handleGetWorkflow,
  handleStartWorkflow,
  handleGetWorkflowRun,
  handleCancelWorkflowRun,
  handleCreateWorkflow,
  // Memory
  handleSaveMemory,
  handleUpdateMemory,
  handleForgetMemory,
  handleRecallMemory,
  // Outputs
  handleCreateOutput,
} from './handlers/index.ts';

export type {
  CreateAgentToolInput,
  CreateAgentToolMetadata,
  CreateAgentResult,
} from './handlers/index.ts';

export {
  handleCreateAgent,
} from './handlers/index.ts';

export type {
  CreateAutomationToolInput,
  CreateAutomationResult,
  CreateAutomationMatcher,
  CreateAutomationAction,
  CreateAutomationPromptAction,
  CreateAutomationWebhookAction,
  CreateAutomationEventName,
} from './handlers/index.ts';

export {
  handleCreateAutomation,
} from './handlers/index.ts';

export type {
  CreateWorkflowToolInput,
  CreateWorkflowResult,
  CreateWorkflowMetadata,
  CreateWorkflowStep,
  CreateWorkflowTrigger,
  CreateWorkflowTriggerInput,
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
  UpdatePreferencesArgs,
  TransformDataArgs,
  ScriptSandboxArgs,
  RenderTemplateArgs,
  SendDeveloperFeedbackArgs,
  ListAgentsArgs,
  ListWorkflowsArgs,
  GetWorkflowArgs,
  StartWorkflowArgs,
  GetWorkflowRunArgs,
  CancelWorkflowRunArgs,
  SaveMemoryToolInput,
  UpdateMemoryToolInput,
  ForgetMemoryToolInput,
  RecallMemoryToolInput,
  MemoryMutationResult,
  RecalledMemoryEntry,
  RecallMemoryResult,
  MemoryScope,
  MemoryType,
  CreateOutputToolInput,
  CreateOutputResult,
  OutputKind,
  OutputAssetRole,
  CreateOutputFileInput,
  CreateOutputLinkInput,
  CreateOutputReceiptInput,
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
  CallLlmSchema,
  UpdatePreferencesSchema,
  TransformDataSchema,
  ScriptSandboxSchema,
  RenderTemplateSchema,
  ListAgentsSchema,
  ListWorkflowsSchema,
  GetWorkflowSchema,
  StartWorkflowSchema,
  GetWorkflowRunSchema,
  CancelWorkflowRunSchema,
  // Browser tool schema
  BrowserToolSchema,
  // Developer feedback schema
  SendDeveloperFeedbackSchema,
  CreateAgentSchema,
  SaveMemorySchema,
  UpdateMemorySchema,
  ForgetMemorySchema,
  RecallMemorySchema,
  CreateOutputSchema,
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
} from './tool-defs.ts';
