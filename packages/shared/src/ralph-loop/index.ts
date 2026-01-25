/**
 * Ralph Loop Module
 *
 * Autonomous coding loop system for processing PRD documents
 * with checkbox-formatted user stories.
 *
 * @example
 * ```typescript
 * import {
 *   parsePRD,
 *   createLoopRunner,
 *   type LoopConfig,
 * } from '@vesper/shared/ralph-loop';
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
  LoopConfig,
  LoopStatus,
  LoopError,
  StoryResult,
  ChangeSummary,
  LoopState,
  LoopResult,
  LoopRunnerEvent,
  PersistedLoopState,
} from './types.ts'

export { DEFAULT_LOOP_CONFIG } from './types.ts'

// PRD Parser
export {
  parsePRD,
  markStoryComplete,
  markStoryFailed,
  markStorySkipped,
  getNextPendingStory,
  getStoryById,
  getStoryIndex,
  validatePRD,
  generateStoryPrompt,
} from './prd-parser.ts'

// Git Operations
export type { GitOperations } from './git-ops.ts'
export { createGitOperations, validateGitRepository } from './git-ops.ts'

// Loop Runner
export type { RalphLoopRunnerEvents } from './loop-runner.ts'
export { RalphLoopRunner, createLoopRunner } from './loop-runner.ts'
