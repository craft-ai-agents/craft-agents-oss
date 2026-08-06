/**
 * @craft-agent/server-core/tasks
 *
 * The Conductor — the in-process DAG runner for Tasks. Builds on the spec,
 * validation, and storage primitives in @craft-agent/shared/tasks and the
 * SessionManager completion/output seams.
 */
export { TaskRunner } from './TaskRunner';
export { createTaskFromSpec, finishTaskOrchestrator, resolveCreateTaskProjectId } from './create-task';
export type { CreateTaskFromSpecResult, TaskOrchestratorSetupResult } from './create-task';
export type {
  ConductorSessionHost,
  TaskRunnerDeps,
  RunOptions,
  RunSnapshot,
  RunStatus,
  NodeRunStatus,
} from './TaskRunner';
