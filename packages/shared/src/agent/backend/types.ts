/**
 * Backend Abstraction Types
 *
 * Defines the core interface that all AI backends (Claude, OpenAI, etc.) must implement.
 * The CraftAgent facade delegates to these backends, enabling provider switching while
 * maintaining a consistent API surface.
 *
 * Key design decisions:
 * - Provider-agnostic events: All backends emit the same AgentEvent types
 * - Capabilities-driven UI: Model/thinking selectors read from capabilities()
 * - Callback pattern: Facade sets callbacks after creating backend
 * - AsyncGenerator for streaming: Consistent with existing CraftAgent API
 */

import type { AgentEvent } from '@craft-agent/core/types';
import type { FileAttachment } from '../../utils/files.ts';
import type { ThinkingLevel } from '../thinking-levels.ts';
import type { PermissionMode } from '../mode-manager.ts';
import type { LoadedSource } from '../../sources/types.ts';
import type { AuthRequest } from '../session-scoped-tools.ts';
import type { McpClientPool } from '../../mcp/mcp-pool.ts';
import type { Workspace } from '../../config/storage.ts';
import type { SessionConfig as Session } from '../../sessions/storage.ts';
import type { SourceManager } from '../core/source-manager.ts';

// Import AbortReason and RecoveryMessage from core module (single source of truth)
import { AbortReason, type RecoveryMessage } from '../core/index.ts';
export { AbortReason, type RecoveryMessage };

import type { ModelProvider } from '../../config/models.ts';

// Import LLM connection types for auth
import type { LlmAuthType, LlmProviderType } from '../../config/llm-connections.ts';
export type { LlmAuthType, LlmProviderType } from '../../config/llm-connections.ts';
import type { HookSystem } from '../../hooks-simple/index.ts';

/**
 * Provider identifier for AI backends.
 * @deprecated Use ModelProvider from config/models.ts instead
 */
export type AgentProvider = ModelProvider;


// ============================================================
// Callback Types
// ============================================================

/**
 * Permission prompt types for different tool categories.
 */
export type PermissionRequestType = 'bash' | 'file_write' | 'mcp_mutation' | 'api_mutation';

/**
 * Permission request callback signature.
 * Called when a tool requires user permission before execution.
 */
export type PermissionCallback = (request: {
  requestId: string;
  toolName: string;
  command?: string;
  description: string;
  type?: PermissionRequestType;
}) => void;

/**
 * Plan submission callback signature.
 * Called when agent submits a plan for user review.
 */
export type PlanCallback = (planPath: string) => void;

/**
 * Auth request callback signature.
 * Called when a source requires authentication.
 */
export type AuthCallback = (request: AuthRequest) => void;

/**
 * Source change callback signature.
 * Called when a source is activated, deactivated, or modified.
 */
export type SourceChangeCallback = (slug: string, source: LoadedSource | null) => void;

/**
 * Source activation request callback.
 * Returns true if source was successfully activated.
 */
export type SourceActivationCallback = (sourceSlug: string) => Promise<boolean>;

// ============================================================
// Lifecycle Types
// ============================================================

/**
 * Result of backend post-initialization (auth injection, config setup).
 * Returned by postInit() so the session layer can surface warnings.
 */
export interface PostInitResult {
  /** Whether auth credentials were successfully injected */
  authInjected: boolean;
  /** Optional warning message to surface in UI */
  authWarning?: string;
  /** Severity level for the warning */
  authWarningLevel?: 'error' | 'warning' | 'info';
}

/**
 * Context for applying bridge/config updates mid-session.
 * Used when sources change, tokens refresh, or auth completes.
 */
export interface BridgeUpdateContext {
  /** Path to the session folder */
  sessionPath: string;
  /** Currently enabled sources */
  enabledSources: LoadedSource[];
  /** Pre-built MCP server configs */
  mcpServers: Record<string, SdkMcpServerConfig>;
  /** Session ID */
  sessionId: string;
  /** Workspace root path */
  workspaceRootPath: string;
  /** Descriptive context for logging (e.g., 'token refresh', 'source enable') */
  context: string;
  /** URL of the McpPoolServer HTTP endpoint */
  poolServerUrl?: string;
}

/**
 * Host runtime context passed from the application shell (Electron/CLI/etc.).
 * This is intentionally provider-agnostic metadata; backend drivers resolve
 * provider-specific paths from this context internally.
 */
export interface BackendHostRuntimeContext {
  /** App root path (packaged app path or repository root in development) */
  appRootPath: string;
  /** Optional resources path (needed for packaged Windows runtime resolution) */
  resourcesPath?: string;
  /** Whether the host app is running as a packaged build */
  isPackaged: boolean;
  /** Optional runtime override for Node/Bun executable */
  nodeRuntimePath?: string;
  /** Optional interceptor bundle override (CJS bundle loaded via --require) */
  interceptorBundlePath?: string;
}

/**
 * Provider-agnostic backend configuration used by the session layer.
 * Provider-specific runtime details are resolved by backend drivers internally.
 */
export interface CoreBackendConfig {
  /** Workspace configuration */
  workspace: Workspace;

  /** Session configuration (for resume) */
  session?: Session;

  /** Initial model ID */
  model?: string;

  /** Mini/utility model for summarization/title generation/mini-completions */
  miniModel?: string;

  /** Initial thinking level */
  thinkingLevel?: ThinkingLevel;

  /** Headless mode flag (disables interactive tools) */
  isHeadless?: boolean;

  /** Debug mode configuration */
  debugMode?: {
    enabled: boolean;
    logFilePath?: string;
  };

  /** System prompt preset ('default' | 'mini' | custom string) */
  systemPromptPreset?: 'default' | 'mini' | string;

  /** Workspace-level hook system for user-defined SDK hooks (hooks.json) */
  hookSystem?: HookSystem;

  /**
   * Per-session environment variable overrides for the SDK subprocess.
   * Spread after process.env in backend-specific option builders.
   */
  envOverrides?: Record<string, string>;

  /**
   * Centralized MCP client pool for source tool execution.
   * Owns all MCP source connections in the main process.
   */
  mcpPool?: McpClientPool;

  /**
   * URL of the McpPoolServer HTTP endpoint for this session.
   * External SDK subprocesses connect here to access pool-managed MCP tools.
   */
  poolServerUrl?: string;

  /** Callback when SDK session ID is captured/updated */
  onSdkSessionIdUpdate?: (sdkSessionId: string) => void;

  /** Callback when SDK session ID is cleared (e.g., after failed resume) */
  onSdkSessionIdCleared?: () => void;

  /** Callback to get recent messages for recovery context */
  getRecoveryMessages?: () => RecoveryMessage[];

  /**
   * Pre-computed source configurations for initial setup.
   * Passed at construction so backends can set up sources in postInit().
   */
  initialSources?: {
    enabledSources: LoadedSource[];
    mcpServers: Record<string, SdkMcpServerConfig>;
    apiServers: Record<string, unknown>;
    enabledSlugs: string[];
  };
}

// ============================================================
// Backend Interface
// ============================================================

/**
 * Options for the chat method.
 */
export interface ChatOptions {
  /** Retry flag (internal use for session recovery) */
  isRetry?: boolean;
  /** Override thinking level for this message only */
  thinkingOverride?: ThinkingLevel;
}

/**
 * SDK-compatible MCP server configuration.
 * Supports HTTP/SSE (remote) and stdio (local subprocess) transports.
 */
export type SdkMcpServerConfig =
  | {
      type: 'http' | 'sse';
      url: string;
      headers?: Record<string, string>;
      /** Environment variable name containing bearer token (Codex-specific) */
      bearerTokenEnvVar?: string;
    }
  | {
      type: 'stdio';
      command: string;
      args?: string[];
      /** Environment variables to set (literal values) */
      env?: Record<string, string>;
      /** Environment variable names to forward from parent process (Codex-specific) */
      envVars?: string[];
      /** Working directory for the server process (Codex-specific) */
      cwd?: string;
    };

/**
 * Core backend interface - all AI providers must implement this.
 *
 * The interface is designed to:
 * 1. Abstract provider differences (Claude SDK vs OpenAI Responses API)
 * 2. Enable the facade pattern in CraftAgent
 * 3. Support streaming via AsyncGenerator
 * 4. Allow capability-based UI adaptation
 */
export interface AgentBackend {
  // ============================================================
  // Chat & Lifecycle
  // ============================================================

  /**
   * Send a message and stream back events.
   * This is the core agentic loop - handles tool execution, permission checks, etc.
   *
   * @param message - User message text
   * @param attachments - Optional file attachments
   * @param options - Optional chat configuration
   * @yields AgentEvent stream
   */
  chat(
    message: string,
    attachments?: FileAttachment[],
    options?: ChatOptions
  ): AsyncGenerator<AgentEvent>;

  /**
   * Abort current query (user stop or internal abort).
   *
   * @param reason - Optional reason for abort (for logging/debugging)
   */
  abort(reason?: string): Promise<void>;

  /**
   * Force abort with specific reason.
   * Used for auth requests, plan submissions where we need synchronous abort.
   *
   * @param reason - AbortReason enum value
   */
  forceAbort(reason: AbortReason): void;

  /**
   * Redirect the agent mid-stream with a new user message.
   * Called when the user sends a message while the agent is still processing.
   *
   * Each backend decides its own strategy:
   * - Backends with native steering (e.g., Pi) inject the message into the
   *   current stream and return true — events continue through the existing
   *   generator, no abort needed.
   * - Backends without steering call forceAbort(Redirect) internally and
   *   return false — the session layer queues the message for re-send.
   *
   * @param message - The new user message
   * @returns true if steered (events flow through existing stream),
   *          false if aborted (session layer must queue + re-send)
   */
  redirect(message: string): boolean;

  /**
   * Run a simple text completion using the backend's auth infrastructure.
   * Used for connection testing, title generation, and summarization.
   */
  runMiniCompletion(prompt: string): Promise<string | null>;

  /**
   * Clean up resources (MCP connections, watchers, etc.)
   */
  destroy(): void;

  /**
   * Alias for destroy() for consistency.
   */
  dispose(): void;

  /**
   * Post-construction initialization.
   * Handles auth injection, initial config generation, etc.
   * Called after construction and callback wiring, before first chat().
   */
  postInit(): Promise<PostInitResult>;

  /**
   * Apply bridge/config updates mid-session.
   * Called when sources change, tokens refresh, or auth completes.
   * Each backend implements its own strategy:
   * - Codex: regenerates config.toml and queues reconnect
   * - Copilot: writes bridge-config.json and credential cache
   * - Claude/Pi: no-op (they don't use bridge-mcp-server)
   */
  applyBridgeUpdates(context: BridgeUpdateContext): Promise<void>;

  /**
   * Check if currently processing a query.
   */
  isProcessing(): boolean;

  // ============================================================
  // Model & Thinking Configuration
  // ============================================================

  /** Get current model ID */
  getModel(): string;

  /** Set model (should validate against capabilities) */
  setModel(model: string): void;

  /** Get current thinking level */
  getThinkingLevel(): ThinkingLevel;

  /** Set thinking level */
  setThinkingLevel(level: ThinkingLevel): void;

  /** Enable/disable ultrathink override for next message */
  setUltrathinkOverride(enabled: boolean): void;

  // ============================================================
  // Permission Mode
  // ============================================================

  /** Get current permission mode */
  getPermissionMode(): PermissionMode;

  /** Set permission mode */
  setPermissionMode(mode: PermissionMode): void;

  /** Cycle to next permission mode */
  cyclePermissionMode(): PermissionMode;

  // ============================================================
  // State
  // ============================================================

  /** Get SDK session ID (for resume, null if no session) */
  getSessionId(): string | null;

  // ============================================================
  // Source Management
  // ============================================================

  /**
   * Set the MCP server configurations for sources.
   * Called by facade when sources are activated/deactivated.
   *
   * @param mcpServers Pre-built MCP server configs with auth headers
   * @param apiServers In-process MCP servers for REST APIs
   * @param intendedSlugs Source slugs that should be considered active
   */
  setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, unknown>,
    intendedSlugs?: string[]
  ): void | Promise<void>;

  /**
   * Get currently active source slugs.
   */
  getActiveSourceSlugs(): string[];

  /**
   * Get all sources (for context injection).
   */
  getAllSources(): LoadedSource[];

  /**
   * Set all sources (for context injection).
   */
  setAllSources(sources: LoadedSource[]): void;

  /**
   * Mark a source as unseen (will show introduction text again).
   */
  markSourceUnseen(sourceSlug: string): void;

  /**
   * Get a bound summarize callback for passing to API tool builders.
   */
  getSummarizeCallback(): (prompt: string) => Promise<string | null>;

  // ============================================================
  // Session & Workspace State
  // ============================================================

  /** Update the working directory */
  updateWorkingDirectory(path: string): void;

  /** Update the SDK cwd (transcript storage location) */
  updateSdkCwd(path: string): void;

  /** Set workspace configuration */
  setWorkspace(workspace: Workspace): void;

  /** Set session ID */
  setSessionId(sessionId: string | null): void;

  /** Get SourceManager for advanced queries */
  getSourceManager(): SourceManager;

  /** Generate a session title from user message */
  generateTitle(message: string): Promise<string | null>;

  /** Regenerate a session title from recent conversation */
  regenerateTitle(recentUserMessages: string[], lastAssistantResponse: string): Promise<string | null>;

  // ============================================================
  // Permission Resolution
  // ============================================================

  /**
   * Respond to a pending permission request.
   *
   * @param requestId - Permission request ID
   * @param allowed - Whether permission was granted
   * @param alwaysAllow - Whether to remember this permission for session
   */
  respondToPermission(requestId: string, allowed: boolean, alwaysAllow?: boolean): void;

  // ============================================================
  // Callbacks (set by facade after construction)
  // ============================================================

  /** Called when a tool requires permission */
  onPermissionRequest: PermissionCallback | null;

  /** Called when agent submits a plan */
  onPlanSubmitted: PlanCallback | null;

  /** Called when a source requires authentication */
  onAuthRequest: AuthCallback | null;

  /** Called when a source config changes */
  onSourceChange: SourceChangeCallback | null;

  /** Called when permission mode changes */
  onPermissionModeChange: ((mode: PermissionMode) => void) | null;

  /** Called with debug messages */
  onDebug: ((message: string) => void) | null;

  /** Called when a source tool is used but source isn't active */
  onSourceActivationRequest: SourceActivationCallback | null;

  /**
   * Called when backend-specific authentication is required.
   * Replaces per-backend callbacks (onChatGptAuthRequired, onGithubAuthRequired).
   * The session layer wires this to surface auth warnings in the UI.
   */
  onBackendAuthRequired: ((reason: string) => void) | null;

  /** Called when agent requests spawning a sub-session */
  onSpawnSession: ((request: import('../base-agent.ts').SpawnSessionRequest) => Promise<import('../base-agent.ts').SpawnSessionResult>) | null;
}

/**
 * Configuration for creating a backend.
 */
export interface BackendConfig extends CoreBackendConfig {
  /**
   * Provider/SDK to use for this backend.
   * Determines which agent class is instantiated:
   * - 'anthropic' → ClaudeAgent (Anthropic SDK)
   * - 'openai' → CodexAgent (OpenAI via app-server)
   * - 'copilot' → CopilotAgent (GitHub Copilot via @github/copilot-sdk)
   * - 'pi' → PiAgent (Pi via @mariozechner/pi-coding-agent)
   */
  provider: AgentProvider;

  /**
   * Full provider type from LLM connection.
   * Includes compat variants and cloud providers.
   * Used for routing validation, credential lookup, etc.
   */
  providerType?: LlmProviderType;

  /**
   * Authentication mechanism from LLM connection.
   * Determines how credentials are retrieved and passed to the backend.
   */
  authType?: LlmAuthType;

  /**
   * @deprecated Use authType instead. Kept for backwards compatibility.
   */
  legacyAuthType?: 'api_key' | 'oauth_token';

  /** MCP token override (for testing) */
  mcpToken?: string;

  /**
   * Connection slug for credential routing.
   * Set by factory when creating from a connection.
   * Used to read/write credentials under the correct key.
   */
  connectionSlug?: string;

  /**
   * Opaque runtime payload resolved by backend drivers.
   * This keeps provider-specific runtime details out of the public config surface.
   */
  runtime?: Record<string, unknown>;
}
