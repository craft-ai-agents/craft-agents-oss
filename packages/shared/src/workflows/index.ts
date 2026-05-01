/**
 * @craft-agent/shared/workflows
 *
 * Global library of reusable agent pipelines. One WORKFLOW.md per workflow,
 * activated per-workspace via an activation manifest. Mirrors the
 * agent-definitions module's storage shape.
 */

export type {
  ActivatedWorkflowsManifest,
  JsonSchema,
  LoadedWorkflow,
  WorkflowDefinitionSource,
  WorkflowMetadata,
  WorkflowParseWarning,
  WorkflowParseWarningCode,
  WorkflowStep,
  WorkflowTrigger,
  WorkflowTriggerInput,
  WorkflowTriggerType,
} from './types.ts';

export { WORKFLOW_FILE, WORKFLOW_SLUG_REGEX } from './types.ts';

export {
  parseWorkflowFile,
  serializeWorkflow,
} from './parser.ts';

export {
  GLOBAL_WORKFLOWS_DIR,
  getGlobalWorkflowDir,
  getGlobalWorkflowFile,
  isValidWorkflowSlug,
  loadAllGlobalWorkflows,
  loadGlobalWorkflow,
  readActivatedWorkflows,
  writeActivatedWorkflows,
  setWorkflowActive,
  loadActivatedWorkflows,
  writeGlobalWorkflow,
  deleteGlobalWorkflow,
  seedGlobalWorkflowLibraryIfEmpty,
  ensureRequiredWorkflows,
  type CreateWorkflowInput,
  type WorkflowStorageOptions,
} from './storage.ts';

export {
  resolveTemplate,
  validateTemplateReferences,
  type TemplateContext,
  type TemplateResolveResult,
} from './template.ts';

export {
  appendOutputSchemaInstruction,
  isValidWorkflowOutputSchema,
  parseStructuredStepOutput,
  type StructuredOutputParseResult,
} from './output-schema.ts';

export type {
  WorkflowRunState,
  WorkflowRunStepState,
  WorkflowRunStep,
  WorkflowRunSnapshot,
} from './run-types.ts';

export {
  getRunsDir,
  getRunDir,
  getRunFile,
  writeRun,
  readRun,
  listRuns,
  deleteRun,
} from './run-storage.ts';

export {
  STARTER_WORKFLOWS,
  STARTER_WORKFLOW_SLUGS,
  WEEKLY_CONTENT_PIPELINE_SLUG,
  EMAIL_TRIAGE_SLUG,
} from './starter-templates.ts';
