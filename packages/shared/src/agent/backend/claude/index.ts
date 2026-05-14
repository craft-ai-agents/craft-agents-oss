/**
 * Claude Agent Module
 *
 * Exports the ClaudeEventAdapter for Claude SDK message → AgentEvent conversion.
 *
 * Note: The main ClaudeAgent class is at ../claude-agent.ts. This index
 * re-exports it alongside the event adapter for convenience.
 */

export { ClaudeAgent } from '../../claude-agent.ts';
export { ClaudeEventAdapter, buildWindowsSkillsDirError } from './event-adapter.ts';
export type { ClaudeAdapterCallbacks } from './event-adapter.ts';
