/**
 * Agent Backend Abstraction Layer
 *
 * This module provides a unified interface for AI agents (Claude, Codex, etc.)
 * allowing seamless provider switching.
 *
 * Naming convention:
 * - ClaudeAgent: Claude SDK implementation (implements AgentBackend directly)
 * - CodexAgent: OpenAI Codex app-server implementation
 * - AgentBackend: Interface that all agents implement
 * - createAgent: Factory function to create agents
 *
 * Usage:
 * ```typescript
 * import { createAgent, type AgentBackend } from '@craft-agent/shared/agent/backend';
 *
 * const agent = createAgent({
 *   provider: 'anthropic',
 *   workspace: myWorkspace,
 *   model: 'claude-sonnet-4-5-20250929',
 * });
 *
 * for await (const event of agent.chat('Hello')) {
 *   console.log(event);
 * }
 * ```
 */

// Core types
export type {
  AgentBackend,
  AgentProvider,
  BackendConfig,
  PermissionCallback,
  PlanCallback,
  AuthCallback,
  SourceChangeCallback,
  SourceActivationCallback,
  ChatOptions,
  RecoveryMessage,
  SdkMcpServerConfig,
  LlmAuthType,
  LlmProviderType,
} from './types.ts';

// Enums need to be exported as values, not just types
export { AbortReason } from './types.ts';

// Factory
export {
  createBackend,
  createAgent,
  detectProvider,
  getAvailableProviders,
  isProviderAvailable,
  // LLM Connection support
  connectionTypeToProvider,
  connectionAuthTypeToBackendAuthType,
  resolveSessionConnection,
  createConfigFromConnection,
  createBackendFromConnection,
  providerTypeToAgentProvider,
} from './factory.ts';

// Agent implementations
// Both agents implement AgentBackend directly
export { ClaudeAgent } from '../claude-agent.ts';
export { CodexAgent, CodexBackend } from '../codex-agent.ts';
