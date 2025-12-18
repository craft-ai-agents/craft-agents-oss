import { CraftAgent, type CraftAgentConfig } from '../agent/craft-agent.ts';
import { CraftMcpClient } from '../mcp/client.ts';
import { SubAgentManager } from '../agents/manager.ts';
import type { SubAgentDefinition } from '../agents/types.ts';
import { getWorkspaceAccessTokenAsync, listSessions, getOrCreateSessionById, updateSessionSdkId } from '../config/storage.ts';
import { debug } from '../utils/debug.ts';
import { DEFAULT_MODEL } from '../config/models.ts';
import type {
  HeadlessConfig,
  HeadlessResult,
  HeadlessEvent,
  ToolCallRecord,
} from './types.ts';

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
  private mcpClient: CraftMcpClient | null = null;
  private agentManager: SubAgentManager | null = null;
  private agent: CraftAgent | null = null;

  // Temporary storage for agent activation
  private activeDefinition: SubAgentDefinition | null = null;
  private mcpServers: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }> = {};
  private apiServers: Record<string, unknown> = {};

  // Session ID for persisting SDK session after run (only when --session is used)
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
      const initResult = await this.initializeMcpClient();
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

      // Wrap prompt with headless mode XML tags to signal plan mode should be disabled
      const wrappedPrompt = `<headless_mode tools_usage="no-interactive-tools" plan_mode="disabled">
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
   * Initialize MCP client and agent manager.
   */
  private async initializeMcpClient(): Promise<{ success: true } | { success: false; error: HeadlessResult['error'] }> {
    try {
      // Build MCP URL (same logic as useAgent)
      let mcpUrl = this.config.workspace.mcpUrl.replace(/\/+$/, '');
      if (!mcpUrl.endsWith('/mcp')) {
        mcpUrl = mcpUrl.replace(/\/sse$/, '/mcp');
        if (!mcpUrl.endsWith('/mcp')) {
          mcpUrl = mcpUrl + '/mcp';
        }
      }

      // Get token from credential store
      const { authType, token } = await getWorkspaceAccessTokenAsync(this.config.workspace.id);

      if (authType !== 'public' && !token) {
        return {
          success: false,
          error: { code: 'auth_required', message: 'No authentication credentials found for workspace. Please re-add the workspace.' },
        };
      }

      debug('[HeadlessRunner] Connecting to MCP:', mcpUrl, 'hasToken:', !!token);

      this.mcpClient = new CraftMcpClient({
        url: mcpUrl,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      await this.mcpClient.connect();

      // Create agent manager
      this.agentManager = new SubAgentManager(
        this.config.workspace.id,
        this.mcpClient,
        {
          model: this.config.model || DEFAULT_MODEL,
          mcpUrl,
          mcpToken: token || undefined,
        }
      );

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      return {
        success: false,
        error: { code: 'execution_error', message: `MCP connection failed: ${message}` },
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

    // Activate agent (will use cache or extract definition)
    const definition = await this.agentManager.activateAgent(agentName);
    if (!definition) {
      // List available agents for helpful error message
      const available = await this.agentManager.getAvailableAgents();
      const names = available.map(a => `@${a.name}`).join(', ') || 'none';
      return {
        success: false,
        error: {
          code: 'agent_not_found',
          message: `Agent '@${agentName}' not found. Available: ${names}`,
          details: { availableAgents: available.map(a => a.name) },
        },
      };
    }

    // Check MCP auth requirements - FAIL if missing (don't prompt)
    const serversNeedingAuth = await this.agentManager.getMcpServersNeedingAuth(definition);
    if (serversNeedingAuth.length > 0) {
      const serverNames = serversNeedingAuth.map(s => s.name || s.url).join(', ');
      return {
        success: false,
        error: {
          code: 'auth_required',
          message: `MCP server authentication required: ${serverNames}. Run 'craft' interactively and activate @${agentName} to authenticate.`,
          details: { servers: serversNeedingAuth.map(s => s.name || s.url) },
        },
      };
    }

    // Check API auth requirements - FAIL if missing
    const apisNeedingAuth = await this.agentManager.getApisNeedingAuth(definition);
    if (apisNeedingAuth.length > 0) {
      const apiNames = apisNeedingAuth.map(a => a.name).join(', ');
      return {
        success: false,
        error: {
          code: 'auth_required',
          message: `API authentication required: ${apiNames}. Run 'craft' interactively and activate @${agentName} to authenticate.`,
          details: { apis: apisNeedingAuth.map(a => a.name) },
        },
      };
    }

    // Build MCP and API server configs
    this.mcpServers = await this.agentManager.buildMcpServerConfig(definition);
    this.apiServers = await this.agentManager.buildApiServers(definition);
    this.activeDefinition = definition;

    debug('[HeadlessRunner] Agent activated:', agentName, 'mcpServers:', Object.keys(this.mcpServers).length);

    return { success: true };
  }

  /**
   * Create CraftAgent with headless callbacks for permissions and questions.
   */
  private createAgent(): void {
    const agentConfig: CraftAgentConfig = {
      workspace: this.config.workspace,
      model: this.config.model,
      isHeadless: true,
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
    if (this.config.sessionId) {
      // --session: get or create session with this ID
      const session = getOrCreateSessionById(this.config.sessionId, this.config.workspace.id);
      this.sessionIdToUpdate = session.id;  // Save to update SDK session ID after run
      if (session.sdkSessionId) {
        debug('[HeadlessRunner] Resuming session (--session) - craft:', session.id, 'sdk:', session.sdkSessionId);
        this.agent.setSessionId(session.sdkSessionId);
      } else {
        debug('[HeadlessRunner] New session created (--session) - craft:', session.id, 'sdk: none (will be saved after run)');
        // Fresh SDK session - will be saved after run
      }
    } else if (this.config.sessionResume) {
      // --session-resume: continue the last session for this workspace
      const sessions = listSessions(this.config.workspace.id);
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
    if (this.sessionIdToUpdate && this.agent) {
      const sdkSessionId = this.agent.getSessionId();
      if (sdkSessionId) {
        debug('[HeadlessRunner] Saving session - craft:', this.sessionIdToUpdate, 'sdk:', sdkSessionId);
        updateSessionSdkId(this.sessionIdToUpdate, sdkSessionId);
      }
    }

    if (this.mcpClient) {
      await this.mcpClient.close().catch(() => {});
      this.mcpClient = null;
    }
    this.agentManager = null;
    this.agent = null;
    this.activeDefinition = null;
    this.mcpServers = {};
    this.apiServers = {};
    this.sessionIdToUpdate = null;
  }
}
