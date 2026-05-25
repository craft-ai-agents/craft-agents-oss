/**
 * Session-Scoped Tool Callback Registry
 *
 * Extracted from session-scoped-tools.ts to break the dependency between
 * the callback registry (shared by Claude + Pi paths) and the Claude SDK
 * adapter layer (only used by ClaudeAgent).
 *
 * The registry is a simple Map keyed by sessionId. Each backend registers
 * callbacks when a session starts and merges additional callbacks (e.g.
 * browser pane functions) as they become available.
 */

import type { LLMQueryRequest, LLMQueryResult } from './llm-tool.ts';
import type { SpawnSessionFn } from './spawn-session-tool.ts';
import type { BrowserPaneFns } from './browser-tools.ts';
import type { AuthRequest } from '@craft-agent/session-tools-core';
import { debug } from '../utils/debug.ts';

/**
 * Callbacks that can be registered per-session
 */
export interface SessionScopedToolCallbacks {
  /**
   * Called when a plan is submitted via SubmitPlan tool.
   * Receives the path to the plan markdown file.
   */
  onPlanSubmitted?: (planPath: string) => void;

  /**
   * Called when authentication is requested via OAuth/credential tools.
   * The auth UI should be shown and execution paused.
   */
  onAuthRequest?: (request: AuthRequest) => void;

  /**
   * Agent-native LLM query callback for call_llm tool (OAuth path).
   * Each agent backend sets this to its own queryLlm implementation.
   */
  queryFn?: (request: LLMQueryRequest) => Promise<LLMQueryResult>;

  /**
   * Callback for spawn_session tool — creates an independent session and sends initial prompt.
   * Each agent backend delegates to its onSpawnSession callback.
   */
  spawnSessionFn?: SpawnSessionFn;

  /**
   * Browser pane functions for browser_* tools.
   * Set by the Electron session manager — wraps BrowserPaneManager
   * with the session's bound browser instance.
   */
  browserPaneFns?: BrowserPaneFns;

  /** Set labels on a session (defaults to current). */
  setSessionLabelsFn?: (sessionId: string | undefined, labels: string[]) => void | Promise<void>;
  /** Set status on a session (defaults to current). */
  setSessionStatusFn?: (sessionId: string | undefined, status: string) => void | Promise<void>;
  /** Get detailed info about a session (defaults to current). */
  getSessionInfoFn?: (sessionId?: string) => import('@craft-agent/session-tools-core').SessionInfo | null;
  /** List sessions in the workspace with pagination. */
  listSessionsFn?: (options?: import('@craft-agent/session-tools-core').ListSessionsOptions) => import('@craft-agent/session-tools-core').ListSessionsResult;
  /** List saved agents available to the workspace. */
  listAgentsFn?: (options?: import('@craft-agent/session-tools-core').ListAgentsOptions) => import('@craft-agent/session-tools-core').ListAgentsResult;
  /** List skills (workspace-active + dormant globals) available to the workspace. */
  listSkillsFn?: (options?: import('@craft-agent/session-tools-core').ListSkillsOptions) => import('@craft-agent/session-tools-core').ListSkillsResult;
  /** List workflows available to the workspace. */
  listWorkflowsFn?: (options?: import('@craft-agent/session-tools-core').ListWorkflowsOptions) => import('@craft-agent/session-tools-core').ListWorkflowsResult;
  /** Get workflow details by slug. */
  getWorkflowFn?: (slug: string) => import('@craft-agent/session-tools-core').WorkflowToolDetail | null;
  /** Start a workflow run. */
  startWorkflowFn?: (slug: string, triggerInputs: Record<string, unknown>) => Promise<unknown>;
  /** Get workflow run snapshot. */
  getWorkflowRunFn?: (runId: string) => unknown | null;
  /** Cancel workflow run. */
  cancelWorkflowRunFn?: (runId: string) => Promise<unknown>;
  /** Resolve label display names to IDs. */
  resolveLabelsFn?: (labels: string[]) => import('@craft-agent/session-tools-core').ResolvedLabelsResult;
  /** Resolve a status display name to its ID. */
  resolveStatusFn?: (status: string) => import('@craft-agent/session-tools-core').ResolvedStatusResult;
  /** Send a message to another session (inter-session messaging). */
  sendAgentMessageFn?: (sessionId: string, message: string, attachments?: Array<{ path: string; name?: string }>) => Promise<void>;
  /**
   * Activate a source in the running session (source_test auto-enable flow).
   * Wired by SessionManager to the per-session onSourceActivationRequest callback
   * plus a backend-aware readiness signal (Pi vs Claude).
   */
  activateSourceInSessionFn?: (sourceSlug: string) => Promise<{
    ok: boolean;
    reason?: string;
    availability?: 'immediate' | 'next-turn';
  }>;
  /** Get messaging bindings for a session. */
  getMessagingBindingsFn?: (sessionId: string) => Array<{ platform: string; channelId: string; channelName?: string; enabled: boolean }>;
  /** Unbind messaging channels from a session. Returns count of removed bindings. */
  unbindMessagingChannelFn?: (sessionId: string, platform?: string) => number;
  /** Create an agent in the global library (used by the agent-creator skill's create_agent tool). */
  createAgentFn?: (
    input: import('@craft-agent/session-tools-core').CreateAgentToolInput,
  ) => Promise<import('@craft-agent/session-tools-core').CreateAgentResult>;
  /** Create an automation matcher in the workspace (used by the automation-creator skill's create_automation tool). */
  createAutomationFn?: (
    input: import('@craft-agent/session-tools-core').CreateAutomationToolInput,
  ) => Promise<import('@craft-agent/session-tools-core').CreateAutomationResult>;
  /** Create a workflow in the global library (used by the workflow-creator skill's create_workflow tool). */
  createWorkflowFn?: (
    input: import('@craft-agent/session-tools-core').CreateWorkflowToolInput,
  ) => Promise<import('@craft-agent/session-tools-core').CreateWorkflowResult>;
  /** Save a memory entry to USER.md or the current agent's MEMORY.md. */
  saveMemoryFn?: (
    input: import('@craft-agent/session-tools-core').SaveMemoryToolInput,
  ) => Promise<import('@craft-agent/session-tools-core').MemoryMutationResult>;
  /** Update an existing memory entry. */
  updateMemoryFn?: (
    input: import('@craft-agent/session-tools-core').UpdateMemoryToolInput,
  ) => Promise<import('@craft-agent/session-tools-core').MemoryMutationResult>;
  /** Forget an existing memory entry and record its tombstone. */
  forgetMemoryFn?: (
    input: import('@craft-agent/session-tools-core').ForgetMemoryToolInput,
  ) => Promise<import('@craft-agent/session-tools-core').MemoryMutationResult>;
  /** Recall relevant memory entries. */
  recallMemoryFn?: (
    input: import('@craft-agent/session-tools-core').RecallMemoryToolInput,
  ) => Promise<import('@craft-agent/session-tools-core').RecallMemoryResult>;
  /** Publish a first-class output from the current session. */
  createOutputFn?: (
    input: import('@craft-agent/session-tools-core').CreateOutputToolInput,
  ) => Promise<import('@craft-agent/session-tools-core').CreateOutputResult>;
  /** Apply a safe visual surface operation to the current session Canvas. */
  applyVisualSurfaceEventFn?: (
    input: import('@craft-agent/session-tools-core').VisualSurfaceToolInput,
  ) => Promise<import('@craft-agent/session-tools-core').VisualSurfaceToolResult>;
  /** Read current session Canvas and visual Output state. */
  getVisualSurfaceStateFn?: () => Promise<import('@craft-agent/session-tools-core').VisualSurfaceStateToolResult>;
}

// Registry of callbacks keyed by sessionId
const sessionScopedToolCallbackRegistry = new Map<string, SessionScopedToolCallbacks>();

/**
 * Register callbacks for a specific session
 */
export function registerSessionScopedToolCallbacks(
  sessionId: string,
  callbacks: SessionScopedToolCallbacks
): void {
  sessionScopedToolCallbackRegistry.set(sessionId, callbacks);
  debug('session-scoped-tools', `Registered callbacks for session ${sessionId}`);
}

/**
 * Merge additional callbacks into an existing session's callback set.
 * Used by the Electron session manager to add browser pane functions
 * after the agent has already registered its core callbacks.
 */
export function mergeSessionScopedToolCallbacks(
  sessionId: string,
  callbacks: Partial<SessionScopedToolCallbacks>
): void {
  const existing = sessionScopedToolCallbackRegistry.get(sessionId) ?? {};
  sessionScopedToolCallbackRegistry.set(sessionId, { ...existing, ...callbacks });
  debug('session-scoped-tools', `Merged callbacks for session ${sessionId}`);
}

/**
 * Unregister callbacks for a session
 */
export function unregisterSessionScopedToolCallbacks(sessionId: string): void {
  sessionScopedToolCallbackRegistry.delete(sessionId);
  debug('session-scoped-tools', `Unregistered callbacks for session ${sessionId}`);
}

/**
 * Get callbacks for a session
 */
export function getSessionScopedToolCallbacks(sessionId: string): SessionScopedToolCallbacks | undefined {
  return sessionScopedToolCallbackRegistry.get(sessionId);
}
