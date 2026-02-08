import { ClaudeAgent, type ClaudeAgentConfig, type PermissionMode, type SdkMcpServerConfig } from '../agent/claude-agent.ts';
import { createApiServer } from '../sources/api-tools.ts';
import { listActiveSessions, getOrCreateSessionById, updateSessionSdkId } from '../sessions/storage.ts';
import { debug } from '../utils/debug.ts';
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
 * - ClaudeAgent for query execution
 *
 * Handles interactions automatically:
 * - Permissions: based on policy (deny-all, allow-safe, allow-all)
 * - Questions: returns empty answers
 * - Auth: fails if credentials missing (must run interactively first)
 */
export class HeadlessRunner {
  private config: HeadlessConfig;
  private agent: ClaudeAgent | null = null;

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
      // 1. Initialize
      yield { type: 'status', message: 'Connecting to workspace...' };
      this.workspaceRootPath = this.config.workspace.rootPath;

      // 2. Create CraftAgent with headless callbacks
      await this.createAgent();

      // 3. Execute query
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
   * Create ClaudeAgent with headless callbacks for permissions and questions.
   */
  private async createAgent(): Promise<void> {
    // Map permission policy to the new PermissionMode system
    const permissionMode = policyToPermissionMode(this.config.permissionPolicy);
    debug('[HeadlessRunner] Using permission mode:', permissionMode, 'from policy:', this.config.permissionPolicy || 'deny-all');

    const agentConfig: ClaudeAgentConfig = {
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

    this.agent = new ClaudeAgent(agentConfig);

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
        const command = request.command ?? '';
        const baseCommand = command.trim().split(/\s+/)[0] || '';
        const allowed = SAFE_COMMANDS.has(baseCommand);
        debug('[HeadlessRunner] Safe check:', baseCommand, 'allowed:', allowed);
        this.agent!.respondToPermission(request.requestId, allowed, false);
        return;
      }

      // deny-all (default)
      this.agent!.respondToPermission(request.requestId, false, false);
    };

    // Set session ID based on flags
    // Default: fresh session (don't set any - SDK will create new)
    if (this.config.sessionId && this.workspaceRootPath) {
      // --session: get or create session with this ID
      const session = await getOrCreateSessionById(this.workspaceRootPath, this.config.sessionId);
      this.sessionIdToUpdate = session.id;  // Save to update SDK session ID after run
      if (session.sdkSessionId) {
        debug('[HeadlessRunner] Resuming session (--session) - craft:', session.id, 'sdk:', session.sdkSessionId);
        this.agent.setSessionId(session.sdkSessionId);
      } else {
        debug('[HeadlessRunner] New session created (--session) - craft:', session.id, 'sdk: none (will be saved after run)');
        // Fresh SDK session - will be saved after run
      }
    } else if (this.config.sessionResume && this.workspaceRootPath) {
      // --session-resume: continue the last active (non-archived) session for this workspace
      const sessions = listActiveSessions(this.workspaceRootPath);
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

    this.agent = null;
    this.workspaceRootPath = null;
    this.sessionIdToUpdate = null;
  }
}
