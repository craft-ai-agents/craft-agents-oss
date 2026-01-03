/**
 * AgentStateManager - Unified agent activation state machine
 *
 * Manages the activation lifecycle for folder-based agents, handling:
 * - Loading from agent folders
 * - MCP server authentication
 * - API authentication
 * - Final activation with CraftAgent
 *
 * Design: One instance per session. Each session can have at most one agent.
 */

import { EventEmitter } from 'events';
import { FolderAgentManager } from './folder-manager.ts';
import type { AgentDefinition } from './folder-types.ts';
import type {
  SubAgentDefinition,
  McpServerConfig,
  ApiConfig,
  AgentStatus,
  AgentActivateOptions,
  AgentActivationProgress,
} from './types.ts';
import { debug } from '../utils/debug.ts';
import { createApiServer } from './api-tools.ts';
import { getCredentialManager } from '../credentials/index.ts';
import type { CredentialId, CredentialType } from '../credentials/types.ts';

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
 * idle → extracting → [needs_mcp_auth] → [needs_api_auth] → ready → active
 *
 * The flow pauses at needs_* states waiting for user input.
 * Call continueAfter*() methods to resume the flow.
 */
export class AgentStateManager extends TypedEventEmitter<AgentStateEvents> {
  private workspaceId: string;
  private agentManager: FolderAgentManager;
  private currentStatus: AgentStatus = { status: 'idle' };

  // Pending state for multi-step flows
  private pendingAgentId: string | null = null;
  private pendingAgentName: string | null = null;
  private pendingDefinition: SubAgentDefinition | null = null;

  // Lock to prevent concurrent activation calls
  private isActivating = false;

  constructor(workspaceId: string, agentManager: FolderAgentManager) {
    super();
    this.workspaceId = workspaceId;
    this.agentManager = agentManager;
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
   * - User input is needed (status = 'needs_mcp_auth' | 'needs_api_auth')
   * - An error occurs (status = 'error')
   *
   * @param agentId - Agent ID (slug) to activate
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
      // Load agent definition from folder
      const agentDef = this.agentManager.getAgentDefinition(agentId);

      if (!agentDef) {
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
      this.pendingAgentName = agentDef.name;

      // Set extracting status
      this.setStatus({
        status: 'extracting',
        agentId,
        agentName: agentDef.name,
        message: 'Loading agent definition...',
      });

      // Add slug to AgentDefinition for SubAgentDefinition compatibility
      const definition: SubAgentDefinition = { ...agentDef, slug: agentId };
      this.pendingDefinition = definition;

      // Continue to auth checks
      return this.checkAuthAndProceed(agentId, agentDef.name, definition);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStatus: AgentStatus = {
        status: 'error',
        agentId,
        agentName: this.pendingAgentName || 'unknown',
        error: `Activation failed: ${errorMessage}`,
      };
      this.setStatus(errorStatus);
      return errorStatus;
    } finally {
      this.isActivating = false;
    }
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
    const apisNeedingAuth = await this.getApisNeedingAuthInternal(definition, agentId);
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
    this.pendingAgentId = null;
    this.pendingAgentName = null;
    this.pendingDefinition = null;
    this.setStatus({ status: 'idle' });
  }

  /**
   * Reload current agent
   */
  async reload(): Promise<AgentStatus> {
    const agentId = this.getAgentId();
    if (!agentId) {
      debug('[AgentStateManager.reload] No agent to reload');
      return this.currentStatus;
    }

    debug('[AgentStateManager.reload] Reloading agent:', agentId);

    // Reload agents from disk
    this.agentManager.reload();

    // Re-activate
    return this.activate(agentId, { forceExtraction: true });
  }

  /**
   * Reset current agent, return to idle
   */
  async reset(): Promise<void> {
    const agentId = this.getAgentId();
    if (!agentId) {
      debug('[AgentStateManager.reset] No agent to reset');
      return;
    }

    debug('[AgentStateManager.reset] Resetting agent:', agentId);
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
    return this.getMcpServersNeedingAuthInternal(definition, agentId);
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
    return this.getApisNeedingAuthInternal(definition, agentId);
  }

  /**
   * Build MCP server config for CraftAgent
   * Called when status is 'ready' to get final config
   * Fetches credentials from the credential store for authenticated servers
   */
  async buildMcpServerConfig(): Promise<
    Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>
  > {
    const definition = this.getDefinition();
    if (!definition) {
      return {};
    }

    const result: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }> = {};

    for (const server of definition.mcpServers || []) {
      const config: { type: 'http' | 'sse'; url: string; headers?: Record<string, string> } = {
        type: 'sse', // Default to SSE for MCP servers
        url: server.url,
      };

      // Add authorization header if server requires auth
      if (server.requiresAuth) {
        // Try OAuth first, then bearer token (agent-scoped first, then global)
        let token = await this.getSourceCredential(server.name, 'oauth', server.agentSlug);
        if (!token) {
          token = await this.getSourceCredential(server.name, 'bearer', server.agentSlug);
        }
        if (token) {
          config.headers = {
            Authorization: `Bearer ${token}`,
          };
        }
      }

      result[server.name] = config;
    }

    return result;
  }

  /**
   * Build API servers for CraftAgent
   * Called when status is 'ready' to get final config
   * Fetches credentials from the credential store for authenticated APIs
   */
  async buildApiServers(): Promise<Record<string, ReturnType<typeof createApiServer>>> {
    const definition = this.getDefinition();
    if (!definition) {
      return {};
    }

    const result: Record<string, ReturnType<typeof createApiServer>> = {};

    for (const api of definition.apis || []) {
      // Get credential based on auth type (agent-scoped first, then global)
      let credential = '';
      if (api.auth && api.auth.type !== 'none') {
        const credType = this.apiAuthToCredentialType(api.auth.type);
        const credValue = await this.getSourceCredential(api.name, credType, api.agentSlug);
        credential = credValue || '';
      }
      result[api.name] = createApiServer(api, credential);
    }

    return result;
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
    const mcpNeedingAuth = await this.getMcpServersNeedingAuthInternal(definition, agentId);
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
    const apisNeedingAuth = await this.getApisNeedingAuthInternal(definition, agentId);
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
   * Get MCP servers that need authentication
   * Checks credential store to see if we already have credentials
   */
  private async getMcpServersNeedingAuthInternal(
    definition: SubAgentDefinition,
    agentId: string
  ): Promise<McpServerConfig[]> {
    const serversNeedingAuth: McpServerConfig[] = [];

    for (const server of definition.mcpServers || []) {
      if (!server.requiresAuth) continue;

      // Check if we have credentials for this source (agent-scoped first, then global)
      const hasCredential = await this.hasSourceCredential(server.name, 'oauth', server.agentSlug);
      if (!hasCredential) {
        // Also check bearer token
        const hasBearer = await this.hasSourceCredential(server.name, 'bearer', server.agentSlug);
        if (!hasBearer) {
          serversNeedingAuth.push(server);
        }
      }
    }

    return serversNeedingAuth;
  }

  /**
   * Get APIs that need authentication
   * Checks credential store to see if we already have credentials
   */
  private async getApisNeedingAuthInternal(
    definition: SubAgentDefinition,
    agentId: string
  ): Promise<ApiConfig[]> {
    const apisNeedingAuth: ApiConfig[] = [];

    for (const api of definition.apis || []) {
      if (!api.auth || api.auth.type === 'none') continue;

      // Determine which credential type to check based on auth type (agent-scoped first, then global)
      const credType = this.apiAuthToCredentialType(api.auth.type);
      const hasCredential = await this.hasSourceCredential(api.name, credType, api.agentSlug);
      if (!hasCredential) {
        apisNeedingAuth.push(api);
      }
    }

    return apisNeedingAuth;
  }

  /**
   * Check if a credential exists for a source.
   * Checks agent-scoped credentials first (if agentSlug provided), then falls back to global.
   */
  private async hasSourceCredential(
    sourceSlug: string,
    credType: 'oauth' | 'bearer' | 'apikey' | 'basic',
    agentSlug?: string
  ): Promise<boolean> {
    const credentialManager = getCredentialManager();

    // Try agent-scoped credential first if agentSlug provided
    if (agentSlug) {
      const agentCredentialId: CredentialId = {
        type: `agent_source_${credType}` as CredentialType,
        workspaceId: this.workspaceId,
        agentId: agentSlug,
        sourceId: sourceSlug,
      };
      try {
        const credential = await credentialManager.get(agentCredentialId);
        if (credential !== null && credential.value !== '') {
          return true;
        }
      } catch {
        // Fall through to workspace-level lookup
      }
    }

    // Fall back to workspace-scoped source credential
    const workspaceCredentialId: CredentialId = {
      type: `source_${credType}` as CredentialType,
      workspaceId: this.workspaceId,
      sourceId: sourceSlug,
    };

    try {
      const credential = await credentialManager.get(workspaceCredentialId);
      return credential !== null && credential.value !== '';
    } catch {
      return false;
    }
  }

  /**
   * Get credential value for a source.
   * Checks agent-scoped credentials first (if agentSlug provided), then falls back to global.
   */
  private async getSourceCredential(
    sourceSlug: string,
    credType: 'oauth' | 'bearer' | 'apikey' | 'basic',
    agentSlug?: string
  ): Promise<string | null> {
    const credentialManager = getCredentialManager();

    // Try agent-scoped credential first if agentSlug provided
    if (agentSlug) {
      const agentCredentialId: CredentialId = {
        type: `agent_source_${credType}` as CredentialType,
        workspaceId: this.workspaceId,
        agentId: agentSlug,
        sourceId: sourceSlug,
      };
      try {
        const credential = await credentialManager.get(agentCredentialId);
        if (credential?.value) {
          return credential.value;
        }
      } catch {
        // Fall through to global lookup
      }
    }

    // Fall back to workspace source credential
    const workspaceCredentialId: CredentialId = {
      type: `source_${credType}` as CredentialType,
      workspaceId: this.workspaceId,
      sourceId: sourceSlug,
    };

    try {
      const credential = await credentialManager.get(workspaceCredentialId);
      return credential?.value ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Map API auth type to credential type suffix
   */
  private apiAuthToCredentialType(authType: string): 'oauth' | 'bearer' | 'apikey' | 'basic' {
    switch (authType) {
      case 'bearer':
        return 'bearer';
      case 'header':
      case 'query':
        return 'apikey';
      case 'basic':
        return 'basic';
      default:
        return 'bearer';
    }
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
