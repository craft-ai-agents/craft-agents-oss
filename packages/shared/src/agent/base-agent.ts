/**
 * BaseAgent Abstract Class
 *
 * Shared base class for all AI agent backends (ClaudeAgent, CodexAgent, etc.).
 * Extracts common functionality including:
 * - Model/thinking configuration
 * - Permission mode management (via PermissionManager)
 * - Source management (via SourceManager)
 * - Planning heuristics (via PlanningAdvisor)
 * - Config watching (via ConfigWatcherManager)
 * - Usage tracking (via UsageTracker)
 *
 * Provider-specific behavior (chat, abort, capabilities) is implemented in subclasses.
 */

import type { AgentEvent } from '@craft-agent/core/types';
import type { FileAttachment } from '../utils/files.ts';
import type { ThinkingLevel } from './thinking-levels.ts';
import { DEFAULT_THINKING_LEVEL } from './thinking-levels.ts';
import type { PermissionMode } from './mode-manager.ts';
import type { LoadedSource } from '../sources/types.ts';

import type {
  AgentBackend,
  ChatOptions,
  PermissionCallback,
  PlanCallback,
  AuthCallback,
  SourceChangeCallback,
  SourceActivationCallback,
  SdkMcpServerConfig,
  BackendConfig,
} from './backend/types.ts';
import { AbortReason } from './backend/types.ts';
import type { Workspace } from '../config/storage.ts';

// Core modules
import { PermissionManager } from './core/permission-manager.ts';
import { SourceManager } from './core/source-manager.ts';
import { PromptBuilder } from './core/prompt-builder.ts';
import { PathProcessor } from './core/path-processor.ts';
import { ConfigWatcherManager, type ConfigWatcherManagerCallbacks } from './core/config-watcher-manager.ts';
import { PlanningAdvisor } from './core/planning-advisor.ts';
import { UsageTracker, type UsageUpdate } from './core/usage-tracker.ts';
import { getSessionPlansPath } from '../sessions/storage.ts';
import { getMiniAgentSystemPrompt } from '../prompts/system.ts';

// ============================================================
// Mini Agent Configuration
// ============================================================

/**
 * Mini agent configuration - shared across all backends.
 * Centralized here to avoid duplication between Claude/Codex agents.
 */
export interface MiniAgentConfig {
  /** Whether mini agent mode is enabled */
  enabled: boolean;
  /** Allowed tools for mini agent mode */
  tools: readonly string[];
  /** MCP server keys to include (others filtered out) */
  mcpServerKeys: readonly string[];
  /** Thinking/reasoning should be minimized */
  minimizeThinking: boolean;
}

/** Tool list for mini agents - quick config edits only */
export const MINI_AGENT_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'] as const;

/** MCP servers for mini agents - minimal set */
export const MINI_AGENT_MCP_KEYS = ['session', 'craft-agents-docs'] as const;

// ============================================================
// BaseAgent Abstract Class
// ============================================================

/**
 * Abstract base class for agent backends.
 *
 * Provides:
 * - Common state management (model, thinking, workspace, session)
 * - Core module delegation (PermissionManager, SourceManager, etc.)
 * - Callback declarations for UI integration
 *
 * Subclasses must implement:
 * - chat(): Provider-specific agentic loop
 * - abort(): Provider-specific abort handling
 * - capabilities(): Provider-specific capabilities
 * - respondToPermission(): Provider-specific permission resolution
 * - destroy(): Provider-specific cleanup
 */
export abstract class BaseAgent implements AgentBackend {
  // ============================================================
  // Configuration (protected for subclass access)
  // ============================================================
  protected config: BackendConfig;
  protected workingDirectory: string;
  protected _sessionId: string;

  // ============================================================
  // Model Configuration (protected for subclass access)
  // ============================================================
  protected _model: string;
  protected _thinkingLevel: ThinkingLevel;
  protected _ultrathinkOverride: boolean = false;

  // ============================================================
  // Core Modules (protected for subclass access)
  // ============================================================
  protected permissionManager: PermissionManager;
  protected sourceManager: SourceManager;
  protected promptBuilder: PromptBuilder;
  protected pathProcessor: PathProcessor;
  protected configWatcherManager: ConfigWatcherManager | null = null;
  protected planningAdvisor: PlanningAdvisor;
  protected usageTracker: UsageTracker;

  // ============================================================
  // Additional State (protected for subclass access)
  // ============================================================
  protected temporaryClarifications: string | null = null;

  // ============================================================
  // Callbacks (public for facade wiring)
  // ============================================================
  onPermissionRequest: PermissionCallback | null = null;
  onPlanSubmitted: PlanCallback | null = null;
  onAuthRequest: AuthCallback | null = null;
  onSourceChange: SourceChangeCallback | null = null;
  onSourcesListChange: ((sources: LoadedSource[]) => void) | null = null;
  onConfigValidationError: ((file: string, errors: string[]) => void) | null = null;
  onPermissionModeChange: ((mode: PermissionMode) => void) | null = null;
  onDebug: ((message: string) => void) | null = null;
  onSourceActivationRequest: SourceActivationCallback | null = null;
  onUsageUpdate: ((update: UsageUpdate) => void) | null = null;

  // ============================================================
  // Constructor
  // ============================================================

  constructor(config: BackendConfig, defaultModel: string, contextWindow?: number) {
    this.config = config;
    // Use session's workingDirectory if set (user-changeable), fallback to workspace root
    this.workingDirectory = config.session?.workingDirectory ?? config.workspace.rootPath ?? process.cwd();
    this._sessionId = config.session?.id || `agent-${Date.now()}`;
    this._model = config.model || defaultModel;
    this._thinkingLevel = config.thinkingLevel || DEFAULT_THINKING_LEVEL;

    // Initialize core modules
    // PermissionManager: handles permission evaluation, mode management, and command whitelisting
    this.permissionManager = new PermissionManager({
      workspaceId: config.workspace.id,
      sessionId: this._sessionId,
      workingDirectory: this.workingDirectory,
      plansFolderPath: getSessionPlansPath(config.workspace.rootPath, this._sessionId),
    });

    // SourceManager: tracks active/inactive sources and formats state for context injection
    this.sourceManager = new SourceManager({
      onDebug: (msg) => this.debug(msg),
    });

    // PromptBuilder: builds context blocks for user messages
    this.promptBuilder = new PromptBuilder({
      workspace: config.workspace,
      session: config.session,
      debugMode: config.debugMode,
      systemPromptPreset: config.systemPromptPreset,
      isHeadless: config.isHeadless,
    });

    // PathProcessor: expands ~ and normalizes paths
    this.pathProcessor = new PathProcessor();

    // PlanningAdvisor: heuristics for planning mode suggestions
    this.planningAdvisor = new PlanningAdvisor();

    // UsageTracker: token usage and context window tracking
    this.usageTracker = new UsageTracker({
      contextWindow,
      onUsageUpdate: (update) => this.onUsageUpdate?.(update),
      onDebug: (msg) => this.debug(msg),
    });
  }

  // ============================================================
  // Config Watcher Management
  // ============================================================

  /**
   * Start the config file watcher for hot-reloading changes.
   * Called by subclass constructor in non-headless mode.
   */
  protected startConfigWatcher(): void {
    if (this.configWatcherManager) {
      return; // Already running
    }

    const callbacks: ConfigWatcherManagerCallbacks = {
      onSourceChange: (slug, source) => {
        this.debug(`Source changed: ${slug} ${source ? 'updated' : 'deleted'}`);
        this.onSourceChange?.(slug, source);
      },
      onSourcesListChange: (sources) => {
        this.debug(`Sources list changed: ${sources.length} sources`);
        this.onSourcesListChange?.(sources);
      },
      onValidationError: (file, errors) => {
        this.debug(`Config validation error: ${file}`);
        this.onConfigValidationError?.(file, errors);
      },
    };

    this.configWatcherManager = new ConfigWatcherManager(
      {
        workspaceRootPath: this.workingDirectory,
        isHeadless: this.config.isHeadless,
        onDebug: (msg) => this.debug(msg),
      },
      callbacks
    );
    this.configWatcherManager.start();
    this.debug('Config watcher started');
  }

  /**
   * Stop the config file watcher.
   */
  protected stopConfigWatcher(): void {
    if (this.configWatcherManager) {
      this.configWatcherManager.stop();
      this.configWatcherManager = null;
      this.debug('Config watcher stopped');
    }
  }

  // ============================================================
  // Debug Logging (protected for subclass override)
  // ============================================================

  /**
   * Log a debug message. Override in subclass to add prefix.
   */
  protected debug(message: string): void {
    this.onDebug?.(message);
  }

  // ============================================================
  // Model & Thinking Configuration (AgentBackend interface)
  // ============================================================

  getModel(): string {
    return this._model;
  }

  setModel(model: string): void {
    this._model = model;
  }

  getThinkingLevel(): ThinkingLevel {
    return this._thinkingLevel;
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this._thinkingLevel = level;
    this.debug(`Thinking level set to: ${level}`);
  }

  setUltrathinkOverride(enabled: boolean): void {
    this._ultrathinkOverride = enabled;
    this.debug(`Ultrathink override: ${enabled ? 'ENABLED' : 'disabled'}`);
  }

  // ============================================================
  // Permission Mode (delegated to PermissionManager)
  // ============================================================

  getPermissionMode(): PermissionMode {
    return this.permissionManager.getPermissionMode();
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionManager.setPermissionMode(mode);
    this.onPermissionModeChange?.(mode);
  }

  cyclePermissionMode(): PermissionMode {
    const newMode = this.permissionManager.cyclePermissionMode();
    this.onPermissionModeChange?.(newMode);
    return newMode;
  }

  /**
   * Check if currently in safe mode (read-only exploration).
   */
  isInSafeMode(): boolean {
    return this.permissionManager.getPermissionMode() === 'safe';
  }

  // ============================================================
  // Planning Heuristics (delegated to PlanningAdvisor)
  // ============================================================

  /**
   * Check if a task should trigger planning (heuristic).
   * Returns true for complex tasks that would benefit from planning mode.
   */
  shouldSuggestPlanning(userMessage: string): boolean {
    return this.planningAdvisor.shouldSuggestPlanning(userMessage);
  }

  /**
   * Get detailed planning analysis for a user message.
   * Returns confidence score and reasons for planning recommendation.
   */
  analyzePlanningNeed(userMessage: string): { shouldPlan: boolean; confidence: number; reasons: string[] } {
    return this.planningAdvisor.analyze(userMessage);
  }

  // ============================================================
  // Workspace & Session (AgentBackend interface)
  // ============================================================

  getWorkspace(): Workspace {
    return this.config.workspace;
  }

  setWorkspace(workspace: Workspace): void {
    this.config.workspace = workspace;
    // Subclasses should clear session-specific state
  }

  getSessionId(): string | null {
    return this._sessionId;
  }

  setSessionId(sessionId: string | null): void {
    this._sessionId = sessionId || `agent-${Date.now()}`;
  }

  /**
   * Clear conversation history and start fresh.
   * Subclasses should override to clear provider-specific state.
   */
  clearHistory(): void {
    this.usageTracker.reset();
    this.debug('History cleared');
  }

  /**
   * Update the working directory.
   * Also updates PermissionManager and persists to session config.
   */
  updateWorkingDirectory(path: string): void {
    this.workingDirectory = path;
    // Persist to session config for storage and consistency with ClaudeAgent
    if (this.config.session) {
      this.config.session.workingDirectory = path;
    }
    this.permissionManager.updateWorkingDirectory(path);
    this.debug(`Working directory updated: ${path}`);
  }

  /**
   * Update the SDK cwd (used for transcript storage location).
   *
   * This should only be called when it's safe to update - i.e., before any
   * SDK interaction has occurred. The SessionManager checks this condition
   * before calling this method.
   *
   * This updates the session config so the agent uses the new path for
   * SDK operations going forward.
   */
  updateSdkCwd(path: string): void {
    if (this.config.session) {
      this.config.session.sdkCwd = path;
    }
    this.debug(`SDK cwd updated: ${path}`);
  }

  // ============================================================
  // Source Management (delegated to SourceManager)
  // ============================================================

  /**
   * Set the MCP server configurations for sources.
   * Called by facade when sources are activated/deactivated.
   *
   * Subclasses may override to handle provider-specific MCP setup.
   */
  setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, unknown>,
    intendedSlugs?: string[]
  ): void {
    // Update SourceManager state (common tracking)
    this.sourceManager.updateActiveState(
      Object.keys(mcpServers),
      Object.keys(apiServers),
      intendedSlugs
    );
  }

  getActiveSourceSlugs(): string[] {
    return Array.from(this.sourceManager.getIntendedSlugs());
  }

  getAllSources(): LoadedSource[] {
    return this.sourceManager.getAllSources();
  }

  /**
   * Set all sources (for context injection).
   * Uses SourceManager for state tracking.
   */
  setAllSources(sources: LoadedSource[]): void {
    this.sourceManager.setAllSources(sources);
  }

  /**
   * Mark a source as unseen (will show introduction text again).
   */
  markSourceUnseen(sourceSlug: string): void {
    this.sourceManager.markSourceUnseen(sourceSlug);
  }

  /**
   * Check if a source server is currently active.
   */
  isSourceServerActive(serverName: string): boolean {
    return this.sourceManager.isSourceActive(serverName);
  }

  /**
   * Get the set of active source server names.
   */
  getActiveSourceServerNames(): Set<string> {
    return new Set(this.sourceManager.getActiveSlugs());
  }

  /**
   * Set temporary clarifications for context injection.
   * These are injected into prompts but not yet persisted.
   */
  setTemporaryClarifications(text: string | null): void {
    this.temporaryClarifications = text;
  }

  // ============================================================
  // Manager Accessors (for advanced queries)
  // ============================================================

  /**
   * Get SourceManager for advanced source state queries.
   */
  getSourceManager(): SourceManager {
    return this.sourceManager;
  }

  /**
   * Get PermissionManager for advanced permission queries.
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /**
   * Get PromptBuilder for context building.
   */
  getPromptBuilder(): PromptBuilder {
    return this.promptBuilder;
  }

  // ============================================================
  // Mini Agent Mode (centralized for all backends)
  // ============================================================

  /**
   * Check if running in mini agent mode.
   * Centralized detection used by all backends.
   */
  isMiniAgent(): boolean {
    return this.config.systemPromptPreset === 'mini';
  }

  /**
   * Get mini agent configuration for provider-specific application.
   * Returns centralized config that each backend interprets appropriately:
   * - ClaudeAgent: Uses tools array, mcpServers filter, maxThinkingTokens: 0
   * - CodexAgent: Uses baseInstructions, codex-mini model, effort: 'low'
   */
  getMiniAgentConfig(): MiniAgentConfig {
    const enabled = this.isMiniAgent();
    return {
      enabled,
      tools: enabled ? MINI_AGENT_TOOLS : [],
      mcpServerKeys: enabled ? MINI_AGENT_MCP_KEYS : [],
      minimizeThinking: enabled,
    };
  }

  /**
   * Get the mini agent system prompt.
   * Shared across backends for consistency.
   * Uses workspace root path for config file locations.
   */
  getMiniSystemPrompt(): string {
    return getMiniAgentSystemPrompt(this.config.workspace.rootPath);
  }

  /**
   * Filter MCP servers for mini agent mode.
   * Only includes servers whose keys are in the allowed list.
   *
   * @param servers - Full set of MCP servers
   * @param allowedKeys - Keys to include (from getMiniAgentConfig().mcpServerKeys)
   * @returns Filtered servers object
   */
  filterMcpServersForMiniAgent<T>(
    servers: Record<string, T>,
    allowedKeys: readonly string[]
  ): Record<string, T> {
    const filtered: Record<string, T> = {};
    for (const key of allowedKeys) {
      if (servers[key]) {
        filtered[key] = servers[key];
      }
    }
    return filtered;
  }

  // ============================================================
  // Session Recovery (unified across backends)
  // ============================================================

  /**
   * Build recovery context from previous messages when session resume fails.
   * Called when we detect an empty response or thread not found during resume.
   * Injects previous conversation context so the agent can continue naturally.
   *
   * @returns Formatted string to prepend to the user message, or null if no context available.
   */
  protected buildRecoveryContext(): string | null {
    const messages = this.config.getRecoveryMessages?.();
    if (!messages || messages.length === 0) {
      return null;
    }

    // Format messages as a conversation block the agent can understand
    const formattedMessages = messages
      .map((m) => {
        const role = m.type === 'user' ? 'User' : 'Assistant';
        // Truncate very long messages to avoid bloating context (max ~1000 chars each)
        const content =
          m.content.length > 1000
            ? m.content.slice(0, 1000) + '...[truncated]'
            : m.content;
        return `[${role}]: ${content}`;
      })
      .join('\n\n');

    return `<conversation_recovery>
This session was interrupted and is being restored. Here is the recent conversation context:

${formattedMessages}

Please continue the conversation naturally from where we left off.
</conversation_recovery>

`;
  }

  /**
   * Clear session ID and notify callbacks.
   * Called when session resume fails and we need to start fresh.
   */
  protected clearSessionForRecovery(): void {
    this.config.onSdkSessionIdCleared?.();
    this.debug('Session cleared for recovery');
  }

  // ============================================================
  // Cleanup (common base, subclasses extend)
  // ============================================================

  /**
   * Alias for destroy() for consistency.
   */
  dispose(): void {
    this.destroy();
  }

  /**
   * Base cleanup - clears common resources.
   * Subclasses MUST call super.destroy() and add provider-specific cleanup.
   */
  destroy(): void {
    this.stopConfigWatcher();
    this.permissionManager.clearWhitelists();
    this.sourceManager.resetSeenSources();
    this.usageTracker.reset();
    this.debug('Base agent destroyed');
  }

  // ============================================================
  // Abstract Methods (provider-specific, must be implemented)
  // ============================================================

  /**
   * Send a message and stream back events.
   * This is the core agentic loop - handles tool execution, permission checks, etc.
   */
  abstract chat(
    message: string,
    attachments?: FileAttachment[],
    options?: ChatOptions
  ): AsyncGenerator<AgentEvent>;

  /**
   * Abort current query (user stop or internal abort).
   */
  abstract abort(reason?: string): Promise<void>;

  /**
   * Force abort with specific reason.
   * Used for auth requests, plan submissions where we need synchronous abort.
   */
  abstract forceAbort(reason: AbortReason): void;

  /**
   * Check if currently processing a query.
   */
  abstract isProcessing(): boolean;

  /**
   * Respond to a pending permission request.
   */
  abstract respondToPermission(requestId: string, allowed: boolean, alwaysAllow?: boolean): void;
}

// Re-export for convenience
export { AbortReason };
