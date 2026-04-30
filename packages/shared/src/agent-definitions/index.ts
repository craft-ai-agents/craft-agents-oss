/**
 * @craft-agent/shared/agent-definitions
 *
 * Saved agent personas (LLM + system prompt + skills + sources bundles).
 * Stored globally; activated per-workspace.
 *
 * NOT to be confused with the runtime agent classes in `../agent/`.
 */

export type {
  AgentDefinitionSource,
  AgentMetadata,
  LoadedAgent,
  AgentParseWarning,
  ActivatedAgentsManifest,
} from './types.ts';

export { AGENT_SLUG_REGEX, ORCHESTRATOR_SLUG, CONCIERGE_SLUG } from './types.ts';

export {
  GLOBAL_AGENTS_DIR,
  AGENT_FILE,
  getGlobalAgentDir,
  getGlobalAgentFile,
  isValidAgentSlug,
  parseAgentFile,
  loadAllGlobalAgents,
  loadGlobalAgent,
  readActivatedAgents,
  writeActivatedAgents,
  setAgentActive,
  loadActivatedAgents,
  serializeAgent,
  writeGlobalAgent,
  deleteGlobalAgent,
  seedGlobalLibraryIfEmpty,
  ensureRequiredAgents,
  type AgentStorageOptions,
  type CreateAgentInput,
} from './storage.ts';

export { STARTER_AGENTS } from './starter-templates.ts';
