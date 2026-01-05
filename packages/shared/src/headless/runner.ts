import { CraftAgent, type CraftAgentConfig, type PermissionMode, type SdkMcpServerConfig } from '../agent/craft-agent.ts';
import { FolderAgentManager } from '../agents/folder-manager.ts';
import type { SubAgentDefinition } from '../agents/types.ts';
import type { AgentDefinition } from '../agents/folder-types.ts';
import { createApiServer } from '../agents/api-tools.ts';
import { listSessions, getOrCreateSessionById, updateSessionSdkId } from '../sessions/storage.ts';
import { debug } from '../utils/debug.ts';
import { DEFAULT_MODEL } from '../config/models.ts';
import { getCredentialManager } from '../credentials/index.ts';
import type { CredentialId, CredentialType } from '../credentials/types.ts';
import type {
  HeadlessConfig,
  HeadlessResult,
  HeadlessEvent,
  ToolCallRecord,
} from './types.ts';

/**
 * Map headless permission policy to PermissionMode
 * - deny-all: Use 'safe' mode (blocks writes without prompting)
 * - allow-safe: Use 'ask' mode (but headless auto-allows safe commands)
 * - allow-all: Use 'allow-all' mode (skip all permission checks)
 */
function policyToPermissionMode(policy: HeadlessConfig['permissionPolicy']): PermissionMode {
  switch (policy) {
    case 'allow-all':
      return 'allow-all';
    case 'allow-safe':
      return 'ask';
    case 'deny-all':
    default:
      return 'safe';
  }
}

// Safe commands that can be auto-allowed with 'allow-safe' policy
const SAFE_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'pwd', 'echo', 'which',
  'wc', 'sort', 'uniq', 'diff', 'file', 'stat', 'tree', 'less', 'more',
]);

/**
 * HeadlessRunner executes queries in non-interactive mode.
 *
 * Reuses existing components:
 * - CraftMcpClient for MCP connections
 * - SubAgentManager for agent discovery and activation
 * - CraftAgent for query execution
 *
 * Handles interactions automatically:
 * - Permissions: based on policy (deny-all, allow-safe, allow-all)
 * - Questions: returns empty answers
 * - Auth: fails if credentials missing (must run interactively first)
 */
export class HeadlessRunner {
  private config: HeadlessConfig;
  private agentManager: FolderAgentManager | null = null;
  private agent: CraftAgent | null = null;

  // Temporary storage for agent activation
  private activeDefinition: SubAgentDefinition | null = null;
  private mcpServers: Record<string, SdkMcpServerConfig> = {};
  private apiServers: Record<string, unknown> = {};

  // Session management
  private workspaceRootPath: string | null = null;
  private sessionIdToUpdate: string | null = null;

  constructor(config: HeadlessConfig) {
    this.config = config;
  }

  /**
   * Run the query and return result.
   * For streaming output, use runStreaming() instead.
   */
  async run(): Promise<HeadlessResult> {
    for await (const event of this.runStreaming()) {
      if (event.type === 'complete') {
        return event.result;
      }
    }
    return {
      success: false,
      error: { code: 'execution_error', message: 'No completion event received' },
    };
  }

  /**
   * Run the query with streaming events.
   */
  async *runStreaming(): AsyncGenerator<HeadlessEvent> {
    try {
      // 1. Initialize MCP client and agent manager
      yield { type: 'status', message: 'Connecting to workspace...' };
      const initResult = await this.initializeAgentManager();
      if (!initResult.success) {
        yield { type: 'complete', result: { success: false, error: initResult.error } };
        return;
      }

      // 2. Activate agent if specified
      if (this.config.agentName) {
        yield { type: 'status', message: `Activating @${this.config.agentName}...` };
        const activationResult = await this.activateAgent();
        if (!activationResult.success) {
          yield { type: 'complete', result: { success: false, error: activationResult.error } };
          return;
        }
      }

      // 3. Create CraftAgent with headless callbacks
      this.createAgent();

      // 4. Execute query
      yield { type: 'status', message: 'Processing...' };

      let response = '';
      const toolCalls: ToolCallRecord[] = [];
      let usage: HeadlessResult['usage'];

      // Wrap prompt with headless mode XML tags to signal safe mode should be disabled
      const wrappedPrompt = `<headless_mode tools_usage="no-interactive-tools" safe_mode="disabled">
${this.config.prompt}
</headless_mode>`;

      for await (const event of this.agent!.chat(wrappedPrompt)) {
        switch (event.type) {
          case 'status':
            yield { type: 'status', message: event.message };
            break;

          case 'text_delta':
            yield { type: 'text_delta', text: event.text };
            break;

          case 'text_complete':
            response = event.text;
            break;

          case 'tool_start':
            yield {
              type: 'tool_start',
              id: event.toolUseId,
              name: event.toolName,
              input: event.input,
            };
            break;

          case 'tool_result':
            toolCalls.push({
              id: event.toolUseId,
              name: event.toolUseId, // We don't have tool name in result, use ID
              input: event.input ?? {},
              result: event.result,
              isError: event.isError,
            });
            yield {
              type: 'tool_result',
              id: event.toolUseId,
              name: event.toolUseId,
              result: event.result,
              isError: event.isError,
            };
            break;

          case 'error':
            yield { type: 'error', message: event.message };
            break;

          case 'complete':
            if (event.usage) {
              usage = {
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
                cacheReadTokens: event.usage.cacheReadTokens,
                cacheCreationTokens: event.usage.cacheCreationTokens,
                costUsd: event.usage.costUsd ?? 0,
              };
            }
            break;
        }
      }

      // Emit completion
      yield {
        type: 'complete',
        result: {
          success: true,
          response,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage,
          sessionId: this.agent?.getSessionId() ?? undefined,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      debug('[HeadlessRunner] Error:', message);
      yield {
        type: 'complete',
        result: {
          success: false,
          error: { code: 'execution_error', message },
        },
      };
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Initialize agent manager for the workspace.
   */
  private async initializeAgentManager(): Promise<{ success: true } | { success: false; error: HeadlessResult['error'] }> {
    try {
      // Create agent manager (sources handle MCP connections)
      this.workspaceRootPath = this.config.workspace.rootPath;
      this.agentManager = new FolderAgentManager(this.workspaceRootPath);

      debug('[HeadlessRunner] Initialized agent manager for workspace:', this.workspaceRootPath);

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize';
      return {
        success: false,
        error: { code: 'execution_error', message: `Agent manager initialization failed: ${message}` },
      };
    }
  }

  /**
   * Activate the specified agent.
   * Fails if authentication is required but not available.
   */
  private async activateAgent(): Promise<{ success: true } | { success: false; error: HeadlessResult['error'] }> {
    if (!this.agentManager) {
      return {
        success: false,
        error: { code: 'execution_error', message: 'Agent manager not initialized' },
      };
    }

    const agentName = this.config.agentName!;
    debug('[HeadlessRunner] Activating agent:', agentName);

    // Activate agent from folder (no extraction needed - reads from disk)
    const agentDef = this.agentManager.activateAgent(agentName);
    if (!agentDef) {
      // List available agents for helpful error message
      const available = this.agentManager.getAvailableAgents();
      const names = available.map((a: { config: { name: string } }) => `@${a.config.name}`).join(', ') || 'none';
      return {
        success: false,
        error: {
          code: 'agent_not_found',
          message: `Agent '@${agentName}' not found. Available: ${names}`,
          details: { availableAgents: available.map((a: { config: { name: string } }) => a.config.name) },
        },
      };
    }

    // Check MCP auth requirements - FAIL if missing (don't prompt)
    // Note: stdio transport servers don't require auth
    const serversNeedingAuth = (agentDef.mcpServers || []).filter((s: { requiresAuth?: boolean; transport?: string }) =>
      s.requiresAuth && s.transport !== 'stdio'
    );
    if (serversNeedingAuth.length > 0) {
      const serverNames = serversNeedingAuth.map((s: { name: string; url?: string }) => s.name || s.url || 'unknown').join(', ');
      return {
        success: false,
        error: {
          code: 'auth_required',
          message: `MCP server authentication required: ${serverNames}. Run 'craft' interactively and activate @${agentName} to authenticate.`,
          details: { servers: serversNeedingAuth.map((s: { name: string; url?: string }) => s.name || s.url || 'unknown') },
        },
      };
    }

    // Check API auth requirements - FAIL if missing
    const apisNeedingAuth = (agentDef.apis || []).filter((a: { auth?: { type: string } }) => a.auth && a.auth.type !== 'none');
    if (apisNeedingAuth.length > 0) {
      const apiNames = apisNeedingAuth.map((a: { name: string }) => a.name).join(', ');
      return {
        success: false,
        error: {
          code: 'auth_required',
          message: `API authentication required: ${apiNames}. Run 'craft' interactively and activate @${agentName} to authenticate.`,
          details: { apis: apisNeedingAuth.map((a: { name: string }) => a.name) },
        },
      };
    }

    // Build MCP and API server configs (with credential lookup)
    this.mcpServers = await this.buildMcpServers(agentDef);
    this.apiServers = await this.buildApiServers(agentDef);
    this.activeDefinition = agentDef;

    debug('[HeadlessRunner] Agent activated:', agentName, 'mcpServers:', Object.keys(this.mcpServers).length);

    return { success: true };
  }

  /**
   * Create CraftAgent with headless callbacks for permissions and questions.
   */
  private createAgent(): void {
    // Map permission policy to the new PermissionMode system
    const permissionMode = policyToPermissionMode(this.config.permissionPolicy);
    debug('[HeadlessRunner] Using permission mode:', permissionMode, 'from policy:', this.config.permissionPolicy || 'deny-all');

    const agentConfig: CraftAgentConfig = {
      workspace: this.config.workspace,
      model: this.config.model,
      isHeadless: true,
      // Create a minimal session config with the permission mode
      session: {
        id: `headless-${Date.now()}`,
        workspaceRootPath: this.config.workspace.rootPath,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        permissionMode,
      },
    };

    this.agent = new CraftAgent(agentConfig);

    // Set active agent if we activated one
    if (this.activeDefinition) {
      this.agent.setActiveAgentDefinition(
        this.activeDefinition,
        this.mcpServers,
        this.apiServers as Record<string, ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer>>
      );
    }

    // Wire up permission handler based on policy
    this.agent.onPermissionRequest = (request) => {
      const policy = this.config.permissionPolicy || 'deny-all';
      debug('[HeadlessRunner] Permission request:', request.command, 'policy:', policy);

      if (policy === 'allow-all') {
        this.agent!.respondToPermission(request.requestId, true, false);
        return;
      }

      if (policy === 'allow-safe') {
        // Extract base command (first word)
        const baseCommand = request.command.trim().split(/\s+/)[0] || '';
        const allowed = SAFE_COMMANDS.has(baseCommand);
        debug('[HeadlessRunner] Safe check:', baseCommand, 'allowed:', allowed);
        this.agent!.respondToPermission(request.requestId, allowed, false);
        return;
      }

      // deny-all (default)
      this.agent!.respondToPermission(request.requestId, false, false);
    };

    // Wire up question handler - return empty answers in headless mode
    this.agent.onAskUserQuestion = (request) => {
      debug('[HeadlessRunner] Question request, returning empty answers');
      this.agent!.respondToQuestion(request.requestId, {});
    };

    // Set session ID based on flags
    // Default: fresh session (don't set any - SDK will create new)
    if (this.config.sessionId && this.workspaceRootPath) {
      // --session: get or create session with this ID
      const session = getOrCreateSessionById(this.workspaceRootPath, this.config.sessionId);
      this.sessionIdToUpdate = session.id;  // Save to update SDK session ID after run
      if (session.sdkSessionId) {
        debug('[HeadlessRunner] Resuming session (--session) - craft:', session.id, 'sdk:', session.sdkSessionId);
        this.agent.setSessionId(session.sdkSessionId);
      } else {
        debug('[HeadlessRunner] New session created (--session) - craft:', session.id, 'sdk: none (will be saved after run)');
        // Fresh SDK session - will be saved after run
      }
    } else if (this.config.sessionResume && this.workspaceRootPath) {
      // --session-resume: continue the last session for this workspace
      const sessions = listSessions(this.workspaceRootPath);
      if (sessions.length > 0 && sessions[0]) {
        this.sessionIdToUpdate = sessions[0].id;  // Save to update SDK session ID after run
        if (sessions[0].sdkSessionId) {
          debug('[HeadlessRunner] Resuming last session (--session-resume) - craft:', sessions[0].id, 'sdk:', sessions[0].sdkSessionId);
          this.agent.setSessionId(sessions[0].sdkSessionId);
        } else {
          debug('[HeadlessRunner] Last session has no SDK session (--session-resume) - craft:', sessions[0].id, 'sdk: none');
        }
      } else {
        debug('[HeadlessRunner] No previous session found (--session-resume), starting fresh');
      }
    } else {
      // Default: fresh session each run (predictable for automation)
      debug('[HeadlessRunner] Fresh session (default headless mode) - no craft session, no sdk session');
    }
  }

  /**
   * Clean up resources.
   */
  private async cleanup(): Promise<void> {
    // Save SDK session ID to our session storage (if using --session or --session-resume)
    if (this.sessionIdToUpdate && this.agent && this.workspaceRootPath) {
      const sdkSessionId = this.agent.getSessionId();
      if (sdkSessionId) {
        debug('[HeadlessRunner] Saving session - craft:', this.sessionIdToUpdate, 'sdk:', sdkSessionId);
        updateSessionSdkId(this.workspaceRootPath, this.sessionIdToUpdate, sdkSessionId);
      }
    }

    this.agentManager = null;
    this.agent = null;
    this.activeDefinition = null;
    this.mcpServers = {};
    this.apiServers = {};
    this.workspaceRootPath = null;
    this.sessionIdToUpdate = null;
  }

  /**
   * Build MCP server config from agent definition
   * Fetches credentials from the credential store for authenticated servers
   * Supports both HTTP/SSE and stdio transports
   */
  private async buildMcpServers(
    agentDef: AgentDefinition
  ): Promise<Record<string, SdkMcpServerConfig>> {
    const result: Record<string, SdkMcpServerConfig> = {};

    for (const server of agentDef.mcpServers || []) {
      const transport = server.transport || 'http';

      if (transport === 'stdio') {
        // Stdio server - local subprocess, no auth headers
        if (!server.command) {
          debug(`[buildMcpServers] Skipping stdio server "${server.name}" - no command specified`);
          continue;
        }
        result[server.name] = {
          type: 'stdio',
          command: server.command,
          args: server.args,
          env: server.env,
        };
      } else {
        // HTTP/SSE server
        if (!server.url) {
          debug(`[buildMcpServers] Skipping HTTP server "${server.name}" - no URL specified`);
          continue;
        }
        const config: SdkMcpServerConfig = {
          type: transport === 'sse' ? 'sse' : 'http',
          url: server.url,
        };

        // Add authorization header if server requires auth
        if (server.requiresAuth) {
          // Try OAuth first, then bearer token
          let token = await this.getSourceCredential(server.name, 'oauth');
          if (!token) {
            token = await this.getSourceCredential(server.name, 'bearer');
          }
          if (token) {
            (config as { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }).headers = {
              Authorization: `Bearer ${token}`,
            };
          }
        }

        result[server.name] = config;
      }
    }

    return result;
  }

  /**
   * Build API servers from agent definition
   * Fetches credentials from the credential store for authenticated APIs
   */
  private async buildApiServers(agentDef: AgentDefinition): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};

    for (const api of agentDef.apis || []) {
      // Get credential based on auth type
      let credential = '';
      if (api.auth && api.auth.type !== 'none') {
        const credType = this.apiAuthToCredentialType(api.auth.type);
        const credValue = await this.getSourceCredential(api.name, credType);
        credential = credValue || '';
      }
      result[api.name] = createApiServer(api, credential);
    }

    return result;
  }

  /**
   * Get credential value for a source
   */
  private async getSourceCredential(
    sourceSlug: string,
    credType: 'oauth' | 'bearer' | 'apikey' | 'basic'
  ): Promise<string | null> {
    const credentialManager = getCredentialManager();
    const credentialId: CredentialId = {
      type: `source_${credType}` as CredentialType,
      sourceId: sourceSlug,
    };

    try {
      const credential = await credentialManager.get(credentialId);
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
}
