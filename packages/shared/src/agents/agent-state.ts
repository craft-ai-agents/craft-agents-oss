/**
 * AgentStateManager - Unified agent activation state machine
 *
 * Manages the activation lifecycle for sub-agents, handling:
 * - Extraction from Craft documents
 * - Review of concerns
 * - MCP server authentication
 * - API authentication
 * - Final activation with CraftAgent
 *
 * Design: One instance per session. Each session can have at most one agent.
 */

import { EventEmitter } from 'events';

/**
 * Type-safe EventEmitter wrapper
 * Returns unsubscribe functions from on() for React useEffect cleanup
 */
class TypedEventEmitter<TEvents> {
  private emitter = new EventEmitter();

  emit<K extends keyof TEvents>(event: K, data: TEvents[K]): boolean {
    return this.emitter.emit(event as string, data);
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof TEvents>(event: K, listener: (data: TEvents[K]) => void): () => void {
    this.emitter.on(event as string, listener);
    return () => this.emitter.off(event as string, listener);
  }

  off<K extends keyof TEvents>(event: K, listener: (data: TEvents[K]) => void): this {
    this.emitter.off(event as string, listener);
    return this;
  }

  removeAllListeners<K extends keyof TEvents>(event?: K): this {
    this.emitter.removeAllListeners(event as string | undefined);
    return this;
  }
}
import { SubAgentManager } from './manager.ts';
import type {
  SubAgentDefinition,
  McpServerConfig,
  ApiConfig,
  AgentStatus,
  AgentActivateOptions,
  AgentActivationProgress,
} from './types.ts';
import type { ExtractionProgressEvent } from './extractor.ts';
import { clearDefinition, clearAgentCredentialsAsync } from './cache.ts';
import { debug } from '../utils/debug.ts';
import { createApiServer } from './api-tools.ts';

/**
 * Events emitted by AgentStateManager
 */
export interface AgentStateEvents {
  /** Status changed - UI should re-render */
  status: AgentStatus;
  /** Progress during activation - for progress indicators */
  progress: AgentActivationProgress;
  /** Error occurred */
  error: { agentId: string; error: string };
}

/**
 * AgentStateManager orchestrates the agent activation flow.
 *
 * State transitions:
 * idle → extracting → [needs_review] → [needs_mcp_auth] → [needs_api_auth] → ready → active
 *
 * The flow pauses at needs_* states waiting for user input.
 * Call continueAfter*() methods to resume the flow.
 */
export class AgentStateManager extends TypedEventEmitter<AgentStateEvents> {
  private workspaceId: string;
  private subAgentManager: SubAgentManager;
  private currentStatus: AgentStatus = { status: 'idle' };

  // Pending state for multi-step flows
  private pendingAgentId: string | null = null;
  private pendingAgentName: string | null = null;
  private pendingDefinition: SubAgentDefinition | null = null;

  // Lock to prevent concurrent activation calls
  private isActivating = false;

  constructor(workspaceId: string, subAgentManager: SubAgentManager) {
    super();
    this.workspaceId = workspaceId;
    this.subAgentManager = subAgentManager;
  }

  /**
   * Get current activation status
   */
  getStatus(): AgentStatus {
    return this.currentStatus;
  }

  /**
   * Get active agent definition (if status is 'ready' or 'active')
   */
  getDefinition(): SubAgentDefinition | null {
    if (this.currentStatus.status === 'ready' || this.currentStatus.status === 'active') {
      return this.currentStatus.definition;
    }
    return this.pendingDefinition;
  }

  /**
   * Get the agent ID (if any agent is being activated or is active)
   */
  getAgentId(): string | null {
    if (this.currentStatus.status === 'idle') {
      return null;
    }
    if ('agentId' in this.currentStatus) {
      return this.currentStatus.agentId;
    }
    return this.pendingAgentId;
  }

  /**
   * Get the agent name (if any agent is being activated or is active)
   */
  getAgentName(): string | null {
    if (this.currentStatus.status === 'idle') {
      return null;
    }
    if ('agentName' in this.currentStatus) {
      return this.currentStatus.agentName;
    }
    return this.pendingAgentName;
  }

  /**
   * Start agent activation flow
   *
   * Returns when:
   * - Activation completes successfully (status = 'ready')
   * - User input is needed (status = 'needs_review' | 'needs_mcp_auth' | 'needs_api_auth')
   * - An error occurs (status = 'error')
   *
   * @param agentId - Agent ID to activate
   * @param options - Activation options
   * @returns The final status after activation attempt
   */
  async activate(agentId: string, options?: AgentActivateOptions): Promise<AgentStatus> {
    // Prevent concurrent activation calls
    if (this.isActivating) {
      debug('[AgentStateManager.activate] Already activating, ignoring request');
      return this.currentStatus;
    }

    this.isActivating = true;
    debug('[AgentStateManager.activate] Starting activation for:', agentId);

    try {
      // Get agent metadata to get the name
      const agents = await this.subAgentManager.getAvailableAgents();
      const agent = agents.find((a) => a.id === agentId);

      if (!agent) {
        const errorStatus: AgentStatus = {
          status: 'error',
          agentId,
          agentName: 'unknown',
          error: `Agent not found: ${agentId}`,
        };
        this.setStatus(errorStatus);
        return errorStatus;
      }

      this.pendingAgentId = agentId;
      this.pendingAgentName = agent.name;

      // Check if extraction is needed
      const needsExtraction = options?.forceExtraction || this.subAgentManager.needsFreshExtraction(agentId);
      debug('[AgentStateManager.activate] needsExtraction:', needsExtraction);

      // Set extracting status
      this.setStatus({
        status: 'extracting',
        agentId,
        agentName: agent.name,
        message: needsExtraction ? 'Loading agent instructions...' : 'Loading cached definition...',
      });

      // Get definition (from cache or extract)
      const definition = await this.subAgentManager.getDefinition(agentId, (event: ExtractionProgressEvent) => {
        // Update progress
        this.emit('progress', {
          type: 'extraction_progress',
          message: event.message,
        });
        // Also update the extracting status message
        if (this.currentStatus.status === 'extracting') {
          this.setStatus({
            status: 'extracting',
            agentId,
            agentName: agent.name,
            message: event.message,
          });
        }
      });

      if (!definition) {
        const errorStatus: AgentStatus = {
          status: 'error',
          agentId,
          agentName: agent.name,
          error: 'Failed to load agent definition',
        };
        this.setStatus(errorStatus);
        return errorStatus;
      }

      this.pendingDefinition = definition;

      // Set active agent in SubAgentManager for credential lookups
      this.subAgentManager.setActiveAgentId(agentId);

      // Check for concerns (needs review)
      if (definition.concerns?.length && !options?.skipReview) {
        debug('[AgentStateManager.activate] Agent has concerns, needs review');
        const reviewStatus: AgentStatus = {
          status: 'needs_review',
          agentId,
          agentName: agent.name,
          definition,
          concerns: definition.concerns,
        };
        this.setStatus(reviewStatus);
        return reviewStatus;
      }

      // Continue to auth checks
      return this.checkAuthAndProceed(agentId, agent.name, definition);
    } finally {
      this.isActivating = false;
    }
  }

  /**
   * Continue activation after user completes review
   * @param _answers - Map of question -> answer from user (stored elsewhere, not used here)
   */
  async continueAfterReview(_answers: Record<string, string>): Promise<AgentStatus> {
    debug('[AgentStateManager.continueAfterReview] Resuming after review');

    if (this.currentStatus.status !== 'needs_review') {
      debug('[AgentStateManager.continueAfterReview] Invalid state:', this.currentStatus.status);
      return this.currentStatus;
    }

    const { agentId, agentName, definition } = this.currentStatus;

    // Continue to auth checks
    return this.checkAuthAndProceed(agentId, agentName, definition);
  }

  /**
   * Continue activation after MCP server auth completes
   * Called by UI when McpAuth component finishes (success or skip)
   */
  async continueAfterMcpAuth(): Promise<AgentStatus> {
    debug('[AgentStateManager.continueAfterMcpAuth] Resuming after MCP auth');

    if (this.currentStatus.status !== 'needs_mcp_auth') {
      debug('[AgentStateManager.continueAfterMcpAuth] Invalid state:', this.currentStatus.status);
      return this.currentStatus;
    }

    const { agentId, agentName, definition } = this.currentStatus;

    // Check if APIs need auth
    const apisNeedingAuth = await this.subAgentManager.getApisNeedingAuth(definition, agentId);
    if (apisNeedingAuth.length > 0) {
      debug('[AgentStateManager.continueAfterMcpAuth] APIs need auth:', apisNeedingAuth.length);
      const apiAuthStatus: AgentStatus = {
        status: 'needs_api_auth',
        agentId,
        agentName,
        definition,
        apis: apisNeedingAuth,
      };
      this.setStatus(apiAuthStatus);
      return apiAuthStatus;
    }

    // All auth complete, move to ready
    return this.transitionToReady(agentId, agentName, definition);
  }

  /**
   * Continue activation after API auth completes
   * Called by UI when ApiAuth component finishes (success or skip)
   */
  async continueAfterApiAuth(): Promise<AgentStatus> {
    debug('[AgentStateManager.continueAfterApiAuth] Resuming after API auth');

    if (this.currentStatus.status !== 'needs_api_auth') {
      debug('[AgentStateManager.continueAfterApiAuth] Invalid state:', this.currentStatus.status);
      return this.currentStatus;
    }

    const { agentId, agentName, definition } = this.currentStatus;

    // All auth complete, move to ready
    return this.transitionToReady(agentId, agentName, definition);
  }

  /**
   * Mark agent as active (after CraftAgent.setActiveAgentDefinition called)
   * Called by the consuming code after applying the definition to CraftAgent
   */
  markActive(): void {
    if (this.currentStatus.status !== 'ready') {
      debug('[AgentStateManager.markActive] Invalid state:', this.currentStatus.status);
      return;
    }

    const { agentId, agentName, definition } = this.currentStatus;

    const activeStatus: AgentStatus = {
      status: 'active',
      agentId,
      agentName,
      definition,
    };
    this.setStatus(activeStatus);
    debug('[AgentStateManager.markActive] Agent marked active:', agentName);
  }

  /**
   * Deactivate current agent, reset to idle state
   */
  deactivate(): void {
    debug('[AgentStateManager.deactivate] Deactivating agent');
    this.subAgentManager.deactivateAgent();
    this.subAgentManager.clearApiServerCache();
    this.pendingAgentId = null;
    this.pendingAgentName = null;
    this.pendingDefinition = null;
    this.setStatus({ status: 'idle' });
  }

  /**
   * Reload current agent (clear cache, re-extract)
   * Preserves credentials
   */
  async reload(): Promise<AgentStatus> {
    const agentId = this.getAgentId();
    if (!agentId) {
      debug('[AgentStateManager.reload] No agent to reload');
      return this.currentStatus;
    }

    debug('[AgentStateManager.reload] Reloading agent:', agentId);

    // Clear definition cache (preserves credentials)
    clearDefinition(this.workspaceId, agentId);

    // Clear API server cache
    this.subAgentManager.clearApiServerCache();

    // Re-activate with force extraction
    return this.activate(agentId, { forceExtraction: true });
  }

  /**
   * Reset current agent (clear cache AND credentials)
   * Returns to idle state
   */
  async reset(): Promise<void> {
    const agentId = this.getAgentId();
    if (!agentId) {
      debug('[AgentStateManager.reset] No agent to reset');
      return;
    }

    debug('[AgentStateManager.reset] Resetting agent:', agentId);

    // Clear definition cache
    clearDefinition(this.workspaceId, agentId);

    // Clear all credentials for this agent
    await clearAgentCredentialsAsync(this.workspaceId, agentId);

    // Clear API server cache
    this.subAgentManager.clearApiServerCache();

    // Deactivate
    this.deactivate();
  }

  /**
   * Get MCP servers that need auth (for manual auth trigger)
   */
  async getMcpServersNeedingAuth(): Promise<McpServerConfig[]> {
    const definition = this.getDefinition();
    const agentId = this.getAgentId();
    if (!definition || !agentId) {
      return [];
    }
    return this.subAgentManager.getMcpServersNeedingAuth(definition, agentId);
  }

  /**
   * Get APIs that need auth (for manual auth trigger)
   */
  async getApisNeedingAuth(): Promise<ApiConfig[]> {
    const definition = this.getDefinition();
    const agentId = this.getAgentId();
    if (!definition || !agentId) {
      return [];
    }
    return this.subAgentManager.getApisNeedingAuth(definition, agentId);
  }

  /**
   * Build MCP server config for CraftAgent
   * Called when status is 'ready' to get final config
   */
  async buildMcpServerConfig(): Promise<
    Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>
  > {
    const definition = this.getDefinition();
    if (!definition) {
      return {};
    }
    return this.subAgentManager.buildMcpServerConfig(definition);
  }

  /**
   * Build API servers for CraftAgent
   * Called when status is 'ready' to get final config
   */
  async buildApiServers(): Promise<Record<string, ReturnType<typeof createApiServer>>> {
    const definition = this.getDefinition();
    if (!definition) {
      return {};
    }
    return this.subAgentManager.buildApiServers(definition);
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Set status and emit event
   */
  private setStatus(status: AgentStatus): void {
    this.currentStatus = status;
    this.emit('status', status);
    debug('[AgentStateManager.setStatus]', status.status);
  }

  /**
   * Check auth requirements and proceed to appropriate state
   */
  private async checkAuthAndProceed(
    agentId: string,
    agentName: string,
    definition: SubAgentDefinition
  ): Promise<AgentStatus> {
    // Check MCP servers needing auth
    const mcpNeedingAuth = await this.subAgentManager.getMcpServersNeedingAuth(definition, agentId);
    if (mcpNeedingAuth.length > 0) {
      debug('[AgentStateManager.checkAuthAndProceed] MCP servers need auth:', mcpNeedingAuth.length);
      const mcpAuthStatus: AgentStatus = {
        status: 'needs_mcp_auth',
        agentId,
        agentName,
        definition,
        servers: mcpNeedingAuth,
      };
      this.setStatus(mcpAuthStatus);
      return mcpAuthStatus;
    }

    // Check APIs needing auth
    const apisNeedingAuth = await this.subAgentManager.getApisNeedingAuth(definition, agentId);
    if (apisNeedingAuth.length > 0) {
      debug('[AgentStateManager.checkAuthAndProceed] APIs need auth:', apisNeedingAuth.length);
      const apiAuthStatus: AgentStatus = {
        status: 'needs_api_auth',
        agentId,
        agentName,
        definition,
        apis: apisNeedingAuth,
      };
      this.setStatus(apiAuthStatus);
      return apiAuthStatus;
    }

    // No auth needed, move to ready
    return this.transitionToReady(agentId, agentName, definition);
  }

  /**
   * Transition to ready state
   */
  private transitionToReady(
    agentId: string,
    agentName: string,
    definition: SubAgentDefinition
  ): AgentStatus {
    const readyStatus: AgentStatus = {
      status: 'ready',
      agentId,
      agentName,
      definition,
    };
    this.setStatus(readyStatus);
    debug('[AgentStateManager.transitionToReady] Agent ready:', agentName);
    return readyStatus;
  }
}
