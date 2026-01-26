/**
 * Orchestrate Module
 *
 * Autonomous coding orchestration system for processing PRD documents
 * with checkbox-formatted user stories.
 *
 * @example
 * ```typescript
 * import {
 *   parsePRD,
 *   createLoopRunner,
 *   type OrchestrateConfig,
 * } from '@vesper/shared/orchestrate';
 *
 * const prd = parsePRD(markdownContent);
 * const runner = createLoopRunner(sessionId, agent, workingDirectory);
 *
 * runner.on('progress', (state) => console.log('Progress:', state));
 * runner.on('complete', (result) => console.log('Done:', result));
 *
 * await runner.start(prd);
 * ```
 */

// Types
export type {
  Story,
  StoryStatus,
  PRD,
  OrchestrateConfig,
  OrchestrateStatus,
  OrchestrateError,
  StoryResult,
  ChangeSummary,
  OrchestrateState,
  OrchestrateResult,
  OrchestrateEvent,
  OrchestrateMeta,
  // Legacy aliases for backwards compatibility
  LoopConfig,
  LoopStatus,
  LoopError,
  LoopState,
  LoopResult,
  LoopRunnerEvent,
} from './types.ts'

export { DEFAULT_ORCHESTRATE_CONFIG, DEFAULT_LOOP_CONFIG } from './types.ts'

// PRD Parser
export {
  parsePRD,
  markStoryComplete,
  markStoryFailed,
  markStorySkipped,
  markStoryInProgress,
  getNextPendingStory,
  getStoryById,
  getStoryIndex,
  validatePRD,
  generateStoryPrompt,
} from './prd-parser.ts'

// Meta Codec
export {
  encodeMeta,
  decodeMeta,
  hasMeta,
  stripMeta,
} from './meta-codec.ts'

// Dispatch Adapter
export {
  storiesToDispatchTasks,
  generateDispatchCommand,
  type DispatchTask,
} from './dispatch-adapter.ts'

// Progress Monitor
export {
  watchTaskProgress,
  getTaskDir,
  type TaskFileContent,
  type ProgressUpdate,
  type ProgressCallback,
} from './progress-monitor.ts'

// Git Operations
export type { GitOperations } from './git-ops.ts'
export { createGitOperations, validateGitRepository } from './git-ops.ts'

// Orchestrator
export type { OrchestratorEvents } from './orchestrator.ts'
export { Orchestrator, createOrchestrator } from './orchestrator.ts'

// Legacy aliases for backwards compatibility during migration
export type { OrchestratorEvents as RalphLoopRunnerEvents } from './orchestrator.ts'
export { Orchestrator as RalphLoopRunner, createOrchestrator as createLoopRunner } from './orchestrator.ts'
