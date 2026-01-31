/**
 * Lab Module
 *
 * Multi-agent orchestration system with persona-based teams.
 *
 * @example
 * ```typescript
 * import { createProject, createPersona, loadLabProject } from '@craft-agent/shared/lab';
 * import { PERSONA_TEMPLATES } from '@craft-agent/shared/lab/persona-templates';
 * ```
 */

// Types
export type {
  LabPersona,
  CreatePersonaInput,
  LabProject,
  CreateProjectInput,
  LabPipeline,
  LabPhase,
  LabAgentRun,
  LoadedLabProject,
  PipelineStatus,
  PhaseType,
  PhaseStatus,
  AgentRunStatus,
} from './types.ts';

// Storage
export {
  // Path utilities
  getLabPath,
  getPersonasPath,
  getProjectsPath,
  getProjectPath,
  getPipelinesPath,
  // Persona CRUD
  createPersona,
  loadPersona,
  loadAllPersonas,
  listPersonaIds,
  savePersona,
  deletePersona,
  resolvePersonas,
  // Project CRUD
  createProject,
  loadProject,
  loadLabProject,
  loadAllProjects,
  listProjectIds,
  saveProject,
  deleteProject,
  // Pipeline CRUD
  createPipeline,
  loadPipeline,
  loadProjectPipelines,
  listPipelineIds,
  savePipeline,
  deletePipeline,
  deleteAllPipelines,
} from './storage.ts';

// Persona templates
export {
  PERSONA_TEMPLATES,
  getPersonaTemplate,
  getTemplatesByCategory,
  type PersonaTemplate,
} from './persona-templates.ts';

// Pipeline Runner (main process only - uses Node.js APIs)
export {
  runPipeline,
  type PipelineEvent,
  type PipelineEventCallback,
  type PipelineRunnerConfig,
} from './pipeline-runner.ts';
