/**
 * Session Tools Core - Handlers
 *
 * Exports all handler functions for session-scoped tools.
 * These handlers are used by both Claude and Codex implementations.
 */

// SubmitPlan
export { handleSubmitPlan } from './submit-plan.ts';
export type { SubmitPlanArgs } from './submit-plan.ts';

// Config Validate
export { handleConfigValidate } from './config-validate.ts';
export type { ConfigValidateArgs } from './config-validate.ts';

// Skill Validate
export { handleSkillValidate } from './skill-validate.ts';
export type { SkillValidateArgs } from './skill-validate.ts';

// Mermaid Validate
export { handleMermaidValidate } from './mermaid-validate.ts';
export type { MermaidValidateArgs } from './mermaid-validate.ts';

// Source Test
export { handleSourceTest } from './source-test.ts';
export type { SourceTestArgs } from './source-test.ts';

// OAuth Triggers
export {
  handleSourceOAuthTrigger,
  handleGoogleOAuthTrigger,
  handleSlackOAuthTrigger,
  handleMicrosoftOAuthTrigger,
} from './source-oauth.ts';
export type {
  SourceOAuthTriggerArgs,
  GoogleOAuthTriggerArgs,
  SlackOAuthTriggerArgs,
  MicrosoftOAuthTriggerArgs,
} from './source-oauth.ts';

// Credential Prompt
export { handleCredentialPrompt } from './credential-prompt.ts';
export type { CredentialPromptArgs } from './credential-prompt.ts';

// Update Preferences
export { handleUpdatePreferences } from './update-preferences.ts';
export type { UpdatePreferencesArgs } from './update-preferences.ts';

// Transform Data
export { handleTransformData } from './transform-data.ts';
export type { TransformDataArgs } from './transform-data.ts';

// Script Sandbox
export { handleScriptSandbox } from './script-sandbox.ts';
export type { ScriptSandboxArgs } from './script-sandbox.ts';

// Render Template
export { handleRenderTemplate } from './render-template.ts';
export type { RenderTemplateArgs } from './render-template.ts';

// Send Developer Feedback
export { handleSendDeveloperFeedback } from './send-developer-feedback.ts';
export type { SendDeveloperFeedbackArgs } from './send-developer-feedback.ts';

// Session Self-Management
export { handleSetSessionLabels } from './set-session-labels.ts';
export type { SetSessionLabelsArgs } from './set-session-labels.ts';
export { handleSetSessionStatus } from './set-session-status.ts';
export type { SetSessionStatusArgs } from './set-session-status.ts';
export { handleGetSessionInfo } from './get-session-info.ts';
export type { GetSessionInfoArgs } from './get-session-info.ts';
export { handleListSessions } from './list-sessions.ts';
export type { ListSessionsArgs } from './list-sessions.ts';
export { handleListAgents } from './list-agents.ts';
export type { ListAgentsArgs } from './list-agents.ts';
export { handleListSources } from './list-sources.ts';
export type { ListSourcesArgs } from './list-sources.ts';
export {
  handleListWorkflows,
  handleGetWorkflow,
  handleStartWorkflow,
  handleGetWorkflowRun,
  handleCancelWorkflowRun,
} from './workflows.ts';
export type {
  ListWorkflowsArgs,
  GetWorkflowArgs,
  StartWorkflowArgs,
  GetWorkflowRunArgs,
  CancelWorkflowRunArgs,
} from './workflows.ts';

// Create Agent (agent-creator skill)
export { handleCreateAgent } from './create-agent.ts';
export type {
  CreateAgentToolInput,
  CreateAgentToolMetadata,
  CreateAgentResult,
} from './create-agent.ts';

// Create Automation (automation-creator skill)
export { handleCreateAutomation } from './create-automation.ts';
export type {
  CreateAutomationToolInput,
  CreateAutomationResult,
  CreateAutomationMatcher,
  CreateAutomationAction,
  CreateAutomationPromptAction,
  CreateAutomationWebhookAction,
  CreateAutomationEventName,
} from './create-automation.ts';

// Create Workflow (workflow-creator skill)
export { handleCreateWorkflow } from './create-workflow.ts';
export type {
  CreateWorkflowToolInput,
  CreateWorkflowResult,
  CreateWorkflowMetadata,
  CreateWorkflowStep,
  CreateWorkflowTrigger,
  CreateWorkflowTriggerInput,
} from './create-workflow.ts';

// Memory
export {
  handleSaveMemory,
  handleUpdateMemory,
  handleForgetMemory,
  handleRecallMemory,
} from './memory.ts';
export type {
  SaveMemoryToolInput,
  UpdateMemoryToolInput,
  ForgetMemoryToolInput,
  RecallMemoryToolInput,
  MemoryMutationResult,
  RecalledMemoryEntry,
  RecallMemoryResult,
  MemoryScope,
  MemoryType,
} from './memory.ts';

// Outputs
export { handleCreateOutput } from './outputs.ts';
export type {
  CreateOutputToolInput,
  CreateOutputResult,
  OutputKind,
  OutputAssetRole,
  CreateOutputFileInput,
  CreateOutputLinkInput,
  CreateOutputReceiptInput,
} from './outputs.ts';
