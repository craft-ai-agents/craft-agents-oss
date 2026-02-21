/**
 * Session-Scoped Tools
 *
 * Tools that are scoped to a specific session. Each session gets its own
 * instance of these tools with session-specific callbacks and state.
 *
 * This file is a thin adapter that wraps the shared handlers from
 * @craft-agent/session-tools-core for use with the Claude SDK.
 *
 * All tool definitions, schemas, and handlers live in session-tools-core.
 * This adapter only handles:
 * - Session callback registry (per-session onPlanSubmitted, onAuthRequest, queryFn)
 * - Plan state management
 * - Claude SDK tool() wrapping with DOC_REF-enriched descriptions
 * - call_llm (backend-specific, not in registry)
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { getSessionPlansPath, getSessionPath } from '../sessions/storage.ts';
import { debug } from '../utils/debug.ts';
import { DOC_REFS } from '../docs/index.ts';
import { createClaudeContext } from './claude-context.ts';
import { basename } from 'node:path';

// Import from session-tools-core: registry + schemas + base descriptions
import {
  SESSION_TOOL_REGISTRY,
  SESSION_TOOL_DEFS,
  TOOL_DESCRIPTIONS as BASE_DESCRIPTIONS,
  // Types
  type ToolResult,
  type AuthRequest,
} from '@craft-agent/session-tools-core';
import { createLLMTool, type LLMQueryRequest, type LLMQueryResult } from './llm-tool.ts';
import { createSpawnSessionTool, type SpawnSessionFn } from './spawn-session-tool.ts';

// Re-export types for backward compatibility
export type {
  CredentialInputMode,
  AuthRequestType,
  AuthRequest,
  AuthResult,
  CredentialAuthRequest,
  McpOAuthAuthRequest,
  GoogleOAuthAuthRequest,
  SlackOAuthAuthRequest,
  MicrosoftOAuthAuthRequest,
  GoogleService,
  SlackService,
  MicrosoftService,
} from '@craft-agent/session-tools-core';

// ============================================================
// Session-Scoped Tool Callbacks
// ============================================================

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
   * Callback for spawn_session tool — creates a sub-session and sends initial prompt.
   * Each agent backend delegates to its onSpawnSession callback.
   */
  spawnSessionFn?: SpawnSessionFn;
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
 * Unregister callbacks for a session
 */
export function unregisterSessionScopedToolCallbacks(sessionId: string): void {
  sessionScopedToolCallbackRegistry.delete(sessionId);
  debug('session-scoped-tools', `Unregistered callbacks for session ${sessionId}`);
}

/**
 * Get callbacks for a session
 */
function getSessionScopedToolCallbacks(sessionId: string): SessionScopedToolCallbacks | undefined {
  return sessionScopedToolCallbackRegistry.get(sessionId);
}

// ============================================================
// Plan State Management
// ============================================================

// Map of sessionId -> last submitted plan path (for retrieval after submission)
const sessionPlanFilePaths = new Map<string, string>();

/**
 * Get the last submitted plan file path for a session
 */
export function getLastPlanFilePath(sessionId: string): string | null {
  return sessionPlanFilePaths.get(sessionId) ?? null;
}

/**
 * Set the last submitted plan file path for a session
 */
export function setLastPlanFilePath(sessionId: string, path: string): void {
  sessionPlanFilePaths.set(sessionId, path);
}

/**
 * Clear plan file state for a session
 */
export function clearPlanFileState(sessionId: string): void {
  sessionPlanFilePaths.delete(sessionId);
}

// ============================================================
// Plan Path Helpers
// ============================================================

/**
 * Get the plans directory for a session
 */
export function getSessionPlansDir(workspacePath: string, sessionId: string): string {
  return getSessionPlansPath(workspacePath, sessionId);
}

/**
 * Check if a path is within a session's plans directory
 */
export function isPathInPlansDir(path: string, workspacePath: string, sessionId: string): boolean {
  const plansDir = getSessionPlansDir(workspacePath, sessionId);
  return path.startsWith(plansDir);
}

// ============================================================
// Tool Result Converter
// ============================================================

/**
 * Convert shared ToolResult to SDK format
 */
function convertResult(result: ToolResult): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return {
    content: result.content.map(c => ({ type: 'text' as const, text: c.text })),
    ...(result.isError ? { isError: true } : {}),
  };
}

// ============================================================
// Cache for Session-Scoped Tools
// ============================================================

// Cache tools by session to avoid recreating them
const sessionScopedToolsCache = new Map<string, ReturnType<typeof createSdkMcpServer>>();

/**
 * Clean up cached tools for a session
 */
export function cleanupSessionScopedTools(sessionId: string): void {
  const prefix = `${sessionId}::`;
  for (const key of sessionScopedToolsCache.keys()) {
    if (key.startsWith(prefix)) {
      sessionScopedToolsCache.delete(key);
    }
  }
}

// ============================================================
// Tool Descriptions (base from registry + Claude-specific DOC_REFS)
// ============================================================

const TOOL_DESCRIPTIONS: Record<string, string> = {
  ...BASE_DESCRIPTIONS,
  // Claude-specific enrichments with DOC_REFs
  config_validate: BASE_DESCRIPTIONS.config_validate + `\n\n**Reference:** ${DOC_REFS.sources}`,
  skill_validate: BASE_DESCRIPTIONS.skill_validate + `\n\n**Reference:** ${DOC_REFS.skills}`,
  mermaid_validate: BASE_DESCRIPTIONS.mermaid_validate + `\n\n**Reference:** ${DOC_REFS.mermaid}`,
  source_test: BASE_DESCRIPTIONS.source_test + `\n\n**Reference:** ${DOC_REFS.sources}`,
};

// ============================================================
// Main Factory Function
// ============================================================

/**
 * Get or create session-scoped tools for a session.
 * Returns an MCP server with all session-scoped tools registered.
 *
 * All tools come from the canonical SESSION_TOOL_DEFS registry in session-tools-core,
 * except call_llm which is backend-specific.
 */
export function getSessionScopedTools(
  sessionId: string,
  workspaceRootPath: string,
  workspaceId?: string
): ReturnType<typeof createSdkMcpServer> {
  const cacheKey = `${sessionId}::${workspaceRootPath}`;

  // Return cached if available
  let cached = sessionScopedToolsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Create Claude context with full capabilities
  const ctx = createClaudeContext({
    sessionId,
    workspacePath: workspaceRootPath,
    workspaceId: workspaceId || basename(workspaceRootPath) || '',
    onPlanSubmitted: (planPath: string) => {
      setLastPlanFilePath(sessionId, planPath);
      const callbacks = getSessionScopedToolCallbacks(sessionId);
      callbacks?.onPlanSubmitted?.(planPath);
    },
    onAuthRequest: (request: unknown) => {
      const callbacks = getSessionScopedToolCallbacks(sessionId);
      callbacks?.onAuthRequest?.(request as AuthRequest);
    },
  });

  // Helper to create a tool from the canonical registry.
  // The `as any` on schema bridges a Zod generic-variance issue when .shape
  // types (ZodType<string>) flow into Record<string, ZodType<unknown>>.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function registryTool(name: string, schema: any) {
    const def = SESSION_TOOL_REGISTRY.get(name)!;
    return tool(name, TOOL_DESCRIPTIONS[name] || def.description, schema, async (args: any) => {
      const result = await def.handler!(ctx, args);
      return convertResult(result);
    });
  }

  // Create tools from the canonical registry — all tools with handlers
  const tools = SESSION_TOOL_DEFS
    .filter(def => def.handler !== null) // Skip backend-specific tools (call_llm)
    .map(def => registryTool(def.name, def.inputSchema.shape));

  // Add call_llm — backend-specific (not in registry handler)
  const sessionPath = getSessionPath(workspaceRootPath, sessionId);
  tools.push(
    createLLMTool({
      sessionId,
      sessionPath,
      getQueryFn: () => {
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        return callbacks?.queryFn;
      },
    }),
  );

  // Add spawn_session — backend-specific (not in registry handler)
  tools.push(
    createSpawnSessionTool({
      sessionId,
      getSpawnSessionFn: () => {
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        return callbacks?.spawnSessionFn;
      },
    }),
  );

  // Create MCP server
  cached = createSdkMcpServer({
    name: 'session',
    version: '1.0.0',
    tools,
  });

  sessionScopedToolsCache.set(cacheKey, cached);
  return cached;
}
