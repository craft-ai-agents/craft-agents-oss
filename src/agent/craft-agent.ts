import { query, createSdkMcpServer, tool, AbortError, type Query, type SDKMessage, type SDKUserMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources';
import { z } from 'zod';
import { getSystemPrompt } from '../prompts/system.ts';
import type { SubAgentDefinition } from '../agents/types.ts';
import { isWorkspaceTokenExpired, updateWorkspaceOAuthTokens, type Workspace } from '../config/storage.ts';
import { updatePreferences, loadPreferences, type UserPreferences } from '../config/preferences.ts';
import { CraftOAuth, getMcpBaseUrl } from '../auth/oauth.ts';
import type { FileAttachment } from '../tui/utils/files.ts';
import { debug } from '../tui/utils/debug.ts';

export interface CraftAgentConfig {
  workspace: Workspace;
  mcpToken?: string;           // Override token (for testing)
  model?: string;
  enableWebSearch?: boolean;
  enableWebFetch?: boolean;
  enableCodeExecution?: boolean;
}

// Message types for streaming - kept for TUI compatibility
export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text_complete'; text: string }
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; result: string; isError: boolean; input?: Record<string, unknown> }
  | { type: 'permission_request'; requestId: string; toolName: string; command: string; description: string }
  | { type: 'ask_user'; requestId: string; questions: Question[] }
  | { type: 'error'; message: string }
  | { type: 'complete'; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number; costUsd?: number } };

// Permission request tracking
interface PendingPermission {
  resolve: (allowed: boolean, alwaysAllow?: boolean) => void;
  toolName: string;
  command: string;
  baseCommand: string;
}

// Dangerous commands that should always require permission (never auto-allow)
const DANGEROUS_COMMANDS = new Set([
  'rm', 'rmdir', 'sudo', 'su', 'chmod', 'chown', 'chgrp',
  'mv', 'cp', 'dd', 'mkfs', 'fdisk', 'parted',
  'kill', 'killall', 'pkill',
  'reboot', 'shutdown', 'halt', 'poweroff',
  'curl', 'wget', 'ssh', 'scp', 'rsync',
  'git push', 'git reset', 'git rebase', 'git checkout',
]);

// AskUserQuestion types
export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

interface PendingQuestion {
  resolve: (answers: Record<string, string>) => void;
  questions: Question[];
}

// Callback for agent instructions update (set by TUI when agent is active)
let updateAgentInstructionsCallback: ((content: string) => Promise<boolean>) | null = null;

export function setUpdateAgentInstructionsCallback(
  callback: ((content: string) => Promise<boolean>) | null
): void {
  updateAgentInstructionsCallback = callback;
}

export function getUpdateAgentInstructionsCallback(): ((content: string) => Promise<boolean>) | null {
  return updateAgentInstructionsCallback;
}

// Callback for agent instructions reload (set by TUI when agent is active)
let reloadAgentInstructionsCallback: (() => Promise<boolean>) | null = null;

export function setReloadAgentInstructionsCallback(
  callback: (() => Promise<boolean>) | null
): void {
  reloadAgentInstructionsCallback = callback;
}

export function getReloadAgentInstructionsCallback(): (() => Promise<boolean>) | null {
  return reloadAgentInstructionsCallback;
}

// Handle preferences update (extracted for use in MCP tool)
function handleUpdatePreferences(input: Record<string, unknown>): string {
  const updates: Partial<UserPreferences> = {};

  if (input.name && typeof input.name === 'string') {
    updates.name = input.name;
  }
  if (input.timezone && typeof input.timezone === 'string') {
    updates.timezone = input.timezone;
  }
  if (input.language && typeof input.language === 'string') {
    updates.language = input.language;
  }

  // Handle location fields
  if (input.city || input.region || input.country) {
    updates.location = {};
    if (input.city && typeof input.city === 'string') {
      updates.location.city = input.city;
    }
    if (input.region && typeof input.region === 'string') {
      updates.location.region = input.region;
    }
    if (input.country && typeof input.country === 'string') {
      updates.location.country = input.country;
    }
  }

  // Handle notes (append to existing)
  if (input.notes && typeof input.notes === 'string') {
    const current = loadPreferences();
    const existingNotes = current.notes || '';
    const newNote = input.notes;
    updates.notes = existingNotes
      ? `${existingNotes}\n- ${newNote}`
      : `- ${newNote}`;
  }

  // Check if anything was actually updated
  const fields = Object.keys(updates).filter(k => k !== 'location');
  if (updates.location) {
    fields.push(...Object.keys(updates.location).map(k => `location.${k}`));
  }

  if (fields.length === 0) {
    return 'No preferences were updated (no valid fields provided)';
  }

  updatePreferences(updates);
  return `Updated user preferences: ${fields.join(', ')}`;
}


// Create the preferences MCP server with the update_user_preferences tool
// Lazy-initialized singleton
let preferencesServerInstance: ReturnType<typeof createSdkMcpServer> | null = null;

function getPreferencesServer() {
  if (!preferencesServerInstance) {
    preferencesServerInstance = createSdkMcpServer({
      name: 'preferences',
      version: '1.0.0',
      tools: [
        tool(
          'update_user_preferences',
          `Update stored user preferences. Use this when you learn information about the user that would be helpful to remember for future conversations. This includes their name, timezone, location, preferred language, or any other relevant notes. Only update fields you have confirmed information about - don't guess.`,
          {
            name: z.string().optional().describe("The user's preferred name or how they'd like to be addressed"),
            timezone: z.string().optional().describe("The user's timezone in IANA format (e.g., 'America/New_York', 'Europe/London')"),
            city: z.string().optional().describe("The user's city"),
            region: z.string().optional().describe("The user's state/region/province"),
            country: z.string().optional().describe("The user's country"),
            language: z.string().optional().describe("The user's preferred language for responses"),
            notes: z.string().optional().describe('Additional notes about the user that would be helpful to remember (preferences, context, etc.). This appends to existing notes.'),
          },
          async (args) => {
            try {
              const result = handleUpdatePreferences(args);
              return {
                content: [{ type: 'text', text: result }],
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error';
              return {
                content: [{ type: 'text', text: `Failed to update preferences: ${message}` }],
                isError: true,
              };
            }
          }
        ),
        tool(
          'reload_agent_instructions',
          `Reload the current agent's instructions from the Craft document. Use this when the user asks you to refresh, reload, or update your instructions. This will fetch the latest version of your instructions from the source document.`,
          {},
          async () => {
            const callback = getReloadAgentInstructionsCallback();
            if (!callback) {
              return {
                content: [{ type: 'text', text: 'No agent is currently active. This tool only works when a sub-agent is active.' }],
              };
            }
            try {
              const success = await callback();
              return {
                content: [{
                  type: 'text',
                  text: success
                    ? 'Instructions reloaded successfully from the Craft document. My instructions have been updated.'
                    : 'Failed to reload instructions. Please try again or use /agent reload.',
                }],
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error';
              return {
                content: [{ type: 'text', text: `Failed to reload instructions: ${message}` }],
                isError: true,
              };
            }
          }
        ),
      ],
    });
  }
  return preferencesServerInstance;
}

export class CraftAgent {
  private config: CraftAgentConfig;
  private currentQuery: Query | null = null;
  private sessionId: string | null = null;
  private webSearchEnabled: boolean;
  private webFetchEnabled: boolean;
  private codeExecutionEnabled: boolean;
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  private alwaysAllowedCommands: Set<string> = new Set(); // Base commands allowed for this session (e.g., "ls", "cat")
  private activeAgentDefinition: SubAgentDefinition | null = null;
  // Pre-built MCP server configs for the active agent (includes auth headers)
  private agentMcpServers: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }> = {};

  // Callback for permission requests - set by TUI to receive permission prompts
  public onPermissionRequest: ((request: { requestId: string; toolName: string; command: string; description: string }) => void) | null = null;

  // Debug callback for status messages
  public onDebug: ((message: string) => void) | null = null;

  // Callback for AskUserQuestion tool - set by TUI to receive question prompts
  public onAskUserQuestion: ((request: { requestId: string; questions: Question[] }) => void) | null = null;

  constructor(config: CraftAgentConfig) {
    this.config = config;
    this.webSearchEnabled = config.enableWebSearch ?? true;
    this.webFetchEnabled = config.enableWebFetch ?? true;
    this.codeExecutionEnabled = config.enableCodeExecution ?? true; // Default true - permission required per command
  }

  /**
   * Extract the base command from a bash command string
   * e.g., "ls -la /tmp" -> "ls", "git push origin main" -> "git push"
   */
  private getBaseCommand(command: string): string {
    const trimmed = command.trim();

    // Handle git subcommands specially (git push, git reset, etc.)
    if (trimmed.startsWith('git ')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        return `${parts[0]} ${parts[1]}`;
      }
    }

    // For other commands, just take the first word
    const firstWord = trimmed.split(/\s+/)[0] || trimmed;
    return firstWord;
  }

  /**
   * Check if a command is dangerous (should never be auto-allowed)
   */
  private isDangerousCommand(baseCommand: string): boolean {
    return DANGEROUS_COMMANDS.has(baseCommand);
  }

  /**
   * Respond to a pending permission request
   */
  respondToPermission(requestId: string, allowed: boolean, alwaysAllow: boolean = false): void {
    this.onDebug?.(`respondToPermission: ${requestId}, allowed=${allowed}, alwaysAllow=${alwaysAllow}, pending=${this.pendingPermissions.has(requestId)}`);
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      this.onDebug?.(`Resolving permission promise for ${requestId}`);

      // If "always allow" was selected and it's not a dangerous command, remember it
      if (alwaysAllow && allowed && !this.isDangerousCommand(pending.baseCommand)) {
        this.alwaysAllowedCommands.add(pending.baseCommand);
        this.onDebug?.(`Added "${pending.baseCommand}" to always-allowed commands`);
      }

      pending.resolve(allowed);
      this.pendingPermissions.delete(requestId);
    } else {
      this.onDebug?.(`No pending permission found for ${requestId}`);
    }
  }

  /**
   * Respond to a pending AskUserQuestion request
   */
  respondToQuestion(requestId: string, answers: Record<string, string>): void {
    const pending = this.pendingQuestions.get(requestId);
    if (pending) {
      pending.resolve(answers);
      this.pendingQuestions.delete(requestId);
    }
  }

  /**
   * Check if a tool requires permission and handle it
   * Returns true if allowed, false if denied
   */
  private async checkToolPermission(
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string
  ): Promise<{ allowed: boolean; updatedInput: Record<string, unknown> }> {
    // Bash commands require permission when code execution is enabled
    if (toolName === 'Bash' && this.codeExecutionEnabled) {
      const command = typeof input.command === 'string' ? input.command : JSON.stringify(input);
      const baseCommand = command.trim().split(/\s+/)[0] || command;
      const requestId = `perm-${toolUseId}`;

      // Create a promise that will be resolved when user responds
      const permissionPromise = new Promise<boolean>((resolve) => {
        this.pendingPermissions.set(requestId, {
          resolve,
          toolName,
          command,
          baseCommand,
        });
      });

      // Notify TUI of permission request via callback (not event yield)
      if (this.onPermissionRequest) {
        this.onPermissionRequest({
          requestId,
          toolName,
          command,
          description: `Execute bash command: ${command}`,
        });
      } else {
        // No permission handler - deny by default for safety
        this.pendingPermissions.delete(requestId);
        return { allowed: false, updatedInput: input };
      }

      // Wait for user response
      const allowed = await permissionPromise;
      return { allowed, updatedInput: input };
    }

    // All other tools are auto-approved
    return { allowed: true, updatedInput: input };
  }

  private async getToken(): Promise<string | null> {
    if (this.config.mcpToken) {
      return this.config.mcpToken;
    }

    const workspace = this.config.workspace;

    if (workspace.isPublic) {
      return null;
    }

    // Bearer token - static, no refresh needed
    if (workspace.bearerToken) {
      return workspace.bearerToken;
    }

    if (!workspace.oauth) {
      throw new Error('No authentication credentials found for workspace. Please re-add the workspace.');
    }

    if (isWorkspaceTokenExpired(workspace) && workspace.oauth.refreshToken) {
      try {
        const oauth = new CraftOAuth(
          { mcpBaseUrl: getMcpBaseUrl(workspace.mcpUrl) },
          { onStatus: () => {}, onError: () => {} }
        );

        const newTokens = await oauth.refreshAccessToken(
          workspace.oauth.refreshToken,
          workspace.oauth.clientId
        );

        updateWorkspaceOAuthTokens(
          workspace.id,
          newTokens.accessToken,
          newTokens.refreshToken,
          newTokens.expiresAt
        );

        // Update local workspace reference too
        workspace.oauth.accessToken = newTokens.accessToken;
        if (newTokens.refreshToken) {
          workspace.oauth.refreshToken = newTokens.refreshToken;
        }
        if (newTokens.expiresAt) {
          workspace.oauth.expiresAt = newTokens.expiresAt;
        }

        return newTokens.accessToken;
      } catch {
        return workspace.oauth.accessToken;
      }
    }

    return workspace.oauth.accessToken;
  }

  async *chat(userMessage: string, attachments?: FileAttachment[]): AsyncGenerator<AgentEvent> {
    try {
      // Check if we have binary attachments that need the AsyncIterable interface
      const hasBinaryAttachments = attachments?.some(a => a.type === 'image' || a.type === 'pdf');

      // Validate we have something to send
      if (!userMessage.trim() && (!attachments || attachments.length === 0)) {
        yield { type: 'error', message: 'Cannot send empty message' };
        yield { type: 'complete' };
        return;
      }

      // Build disallowed tools list based on user settings
      const disallowedTools: string[] = [];
      if (!this.webSearchEnabled) disallowedTools.push('WebSearch');
      if (!this.webFetchEnabled) disallowedTools.push('WebFetch');
      if (!this.codeExecutionEnabled) {
        disallowedTools.push('Bash');
        disallowedTools.push('BashOutput');
      }

      // Build MCP servers config - always use HTTP (SDK handles connections efficiently)
      const token = await this.getToken();

      let mcpUrl = this.config.workspace.mcpUrl;
      mcpUrl = mcpUrl.replace(/\/+$/, '');
      if (!mcpUrl.endsWith('/mcp')) {
        mcpUrl = mcpUrl.replace(/\/sse$/, '/mcp');
        if (!mcpUrl.endsWith('/mcp')) {
          mcpUrl = mcpUrl + '/mcp';
        }
      }

      const mcpServers: Options['mcpServers'] = {
        craft: {
          type: 'http',
          url: mcpUrl,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        },
        preferences: getPreferencesServer(),
        // Add agent-specific MCP servers if an agent is active
        ...this.getAgentMcpServers(),
      };

      // Debug: log active agent before building system prompt
      debug('[chat] activeAgentDefinition:', this.activeAgentDefinition?.name || 'none');
      debug('[chat] activeAgentDefinition instructions:', this.activeAgentDefinition?.instructions?.length || 0, 'chars');
      if (this.activeAgentDefinition?.instructions) {
        debug('[chat] instructions:', this.activeAgentDefinition.instructions);
      }

      // Configure SDK options
      const options: Options = {
        model: this.config.model || 'claude-sonnet-4-5-20250929',
        // Option A: Append to Claude Code's system prompt (recommended by docs)
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: getSystemPrompt(this.activeAgentDefinition ?? undefined),
        },
        // Option B: Custom system prompt (uncomment to use instead)
        // systemPrompt: getSystemPrompt(this.activeAgentDefinition ?? undefined),
        cwd: process.cwd(),
        includePartialMessages: true,
        // Enable the full Claude Code toolset (includes AskUserQuestion)
        tools: { type: 'preset', preset: 'claude_code' },
        // Use default permission mode with hooks for control
        permissionMode: 'default',
        // Use PreToolUse hook to intercept tool calls
        hooks: {
          PreToolUse: [{
            hooks: [async (input) => {
              // Only handle PreToolUse events
              if (input.hook_event_name !== 'PreToolUse') {
                return { continue: true };
              }

              this.onDebug?.(`PreToolUse hook: ${input.tool_name}, codeExec=${this.codeExecutionEnabled}`);

              // For Bash, check if we need permission
              if (input.tool_name === 'Bash') {
                if (!this.codeExecutionEnabled) {
                  return {
                    continue: false,
                    decision: 'block' as const,
                    reason: 'Bash is disabled. Use /bash to enable.',
                  };
                }

                // Extract command and base command
                const command = typeof input.tool_input === 'object' && input.tool_input !== null
                  ? (input.tool_input as Record<string, unknown>).command
                  : JSON.stringify(input.tool_input);
                const commandStr = String(command);
                const baseCommand = this.getBaseCommand(commandStr);

                // Check if this base command is already allowed (and not dangerous)
                if (this.alwaysAllowedCommands.has(baseCommand) && !this.isDangerousCommand(baseCommand)) {
                  this.onDebug?.(`Auto-allowing "${baseCommand}" (previously approved)`);
                  return { continue: true };
                }

                // Ask for permission
                const requestId = `perm-${input.tool_use_id}`;

                const permissionPromise = new Promise<boolean>((resolve) => {
                  this.pendingPermissions.set(requestId, {
                    resolve,
                    toolName: input.tool_name,
                    command: commandStr,
                    baseCommand,
                  });
                });

                if (this.onPermissionRequest) {
                  this.onPermissionRequest({
                    requestId,
                    toolName: input.tool_name,
                    command: commandStr,
                    description: `Execute: ${commandStr}`,
                  });
                } else {
                  this.pendingPermissions.delete(requestId);
                  return {
                    continue: false,
                    decision: 'block' as const,
                    reason: 'No permission handler available',
                  };
                }

                const allowed = await permissionPromise;
                if (!allowed) {
                  return {
                    continue: false,
                    decision: 'block' as const,
                    reason: 'User denied permission',
                  };
                }
              }

              return { continue: true };
            }],
          }],
        },
        // Continue from previous session if we have one (enables conversation history & auto compaction)
        // If resume fails (invalid session), SDK should start fresh
        ...(this.sessionId ? { resume: this.sessionId } : {}),
        mcpServers,
        // Custom permission handler for Bash commands and AskUserQuestion
        canUseTool: async (toolName, input, toolOptions) => {
          // Debug: show what tools are being called
          this.onDebug?.(`canUseTool: ${toolName}, codeExec=${this.codeExecutionEnabled}`);

          // Handle AskUserQuestion tool - needs user input
          if (toolName === 'AskUserQuestion') {
            const typedInput = input as { questions?: unknown[] };
            if (typedInput.questions && Array.isArray(typedInput.questions)) {
              const requestId = `ask-${toolOptions.toolUseID}`;

              // Parse questions from input
              const questions: Question[] = typedInput.questions.map((q: unknown) => {
                const qObj = q as Record<string, unknown>;
                return {
                  question: String(qObj.question || ''),
                  header: String(qObj.header || ''),
                  options: Array.isArray(qObj.options)
                    ? (qObj.options as Array<Record<string, unknown>>).map(o => ({
                        label: String(o.label || ''),
                        description: String(o.description || ''),
                      }))
                    : [],
                  multiSelect: Boolean(qObj.multiSelect),
                };
              });

              // Create promise for user response
              const answerPromise = new Promise<Record<string, string>>((resolve) => {
                this.pendingQuestions.set(requestId, { resolve, questions });
              });

              // Notify TUI
              if (this.onAskUserQuestion) {
                this.onAskUserQuestion({ requestId, questions });
              } else {
                // No handler - return empty answers
                this.pendingQuestions.delete(requestId);
                return { behavior: 'allow' as const, updatedInput: { ...input, answers: {} } };
              }

              // Wait for user to answer
              const answers = await answerPromise;
              return { behavior: 'allow' as const, updatedInput: { ...input, answers } };
            }
          }

          // Bash commands require user permission when code execution is enabled
          if (toolName === 'Bash' && this.codeExecutionEnabled) {
            const result = await this.checkToolPermission(toolName, input as Record<string, unknown>, toolOptions.toolUseID);
            if (result.allowed) {
              return { behavior: 'allow' as const, updatedInput: result.updatedInput };
            } else {
              return { behavior: 'deny' as const, message: 'User denied permission' };
            }
          }

          // Auto-approve MCP tools and other allowed tools
          return { behavior: 'allow' as const, updatedInput: input as Record<string, unknown> };
        },
        // Selectively disable tools - file tools are disabled (use MCP), web/code controlled by settings
        disallowedTools,
      };

      // Create the query - use AsyncIterable for messages with binary attachments
      if (hasBinaryAttachments) {
        const sdkMessage = this.buildSDKUserMessage(userMessage, attachments);
        async function* singleMessage(): AsyncIterable<SDKUserMessage> {
          yield sdkMessage;
        }
        this.currentQuery = query({ prompt: singleMessage(), options });
      } else {
        // Simple string prompt for text-only messages (may include text file contents)
        const prompt = this.buildTextPrompt(userMessage, attachments);
        this.currentQuery = query({ prompt, options });
      }

      // Track tool uses for mapping results and preventing duplicates
      const pendingToolUses = new Map<string, { name: string; input: Record<string, unknown> }>();
      // SDK emits tool_use in both stream_event (partial) and assistant (complete) messages
      // Track emitted tool_starts to avoid duplicate UI updates
      const emittedToolStarts = new Set<string>();

      // Process SDK messages and convert to AgentEvents
      let receivedComplete = false;
      try {
        for await (const message of this.currentQuery) {
          // Capture session ID for conversation continuity
          if ('session_id' in message && message.session_id) {
            this.sessionId = message.session_id;
          }

          const events = this.convertSDKMessage(message, pendingToolUses, emittedToolStarts);
          for (const event of events) {
            if (event.type === 'complete') {
              receivedComplete = true;
            }
            yield event;
          }
        }

        // Defensive: emit complete if SDK didn't send result message
        if (!receivedComplete) {
          yield { type: 'complete' };
        }
      } catch (sdkError) {
        // Handle user interruption
        if (sdkError instanceof AbortError) {
          yield { type: 'status', message: 'Interrupted' };
          yield { type: 'complete' };
          return;
        }

        // Session resume failures - clear session on any error during resume
        if (this.sessionId && sdkError instanceof Error) {
          this.sessionId = null;
          yield { type: 'error', message: 'Session expired. Please try again.' };
          yield { type: 'complete' };
          return;
        }

        throw sdkError;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', message: errorMessage };
      // Emit complete even on error so TUI knows we're done
      yield { type: 'complete' };
    } finally {
      this.currentQuery = null;
    }
  }

  /**
   * Build a simple text prompt with embedded text file contents (for text-only messages)
   */
  private buildTextPrompt(text: string, attachments?: FileAttachment[]): string {
    if (!attachments || attachments.length === 0) {
      return text;
    }

    const parts: string[] = [];

    for (const attachment of attachments) {
      if (attachment.type === 'text' && attachment.text) {
        parts.push(`[File: ${attachment.name}]\n\`\`\`\n${attachment.text}\n\`\`\``);
      }
    }

    if (text) {
      parts.push(text);
    }

    return parts.join('\n\n');
  }

  /**
   * Build an SDK user message with proper content blocks for binary attachments
   */
  private buildSDKUserMessage(text: string, attachments?: FileAttachment[]): SDKUserMessage {
    const contentBlocks: ContentBlockParam[] = [];

    // Add attachments first
    if (attachments) {
      for (const attachment of attachments) {
        if (attachment.type === 'image' && attachment.base64) {
          const mediaType = this.mapImageMediaType(attachment.mimeType);
          if (mediaType) {
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: attachment.base64,
              },
            });
          }
        } else if (attachment.type === 'pdf' && attachment.base64) {
          contentBlocks.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: attachment.base64,
            },
          });
        } else if (attachment.type === 'text' && attachment.text) {
          contentBlocks.push({
            type: 'text',
            text: `[File: ${attachment.name}]\n\`\`\`\n${attachment.text}\n\`\`\``,
          });
        }
      }
    }

    // Add user's text message
    if (text.trim()) {
      contentBlocks.push({ type: 'text', text });
    }

    return {
      type: 'user',
      message: {
        role: 'user',
        content: contentBlocks,
      },
      parent_tool_use_id: null,
      session_id: this.sessionId || '',
    } as SDKUserMessage;
  }

  /**
   * Map file MIME types to SDK-supported image types
   */
  private mapImageMediaType(mimeType?: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null {
    if (!mimeType) return null;
    const supported: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
      'image/jpeg': 'image/jpeg',
      'image/png': 'image/png',
      'image/gif': 'image/gif',
      'image/webp': 'image/webp',
    };
    return supported[mimeType] || null;
  }

  private convertSDKMessage(
    message: SDKMessage,
    pendingToolUses: Map<string, { name: string; input: Record<string, unknown> }>,
    emittedToolStarts: Set<string>
  ): AgentEvent[] {
    const events: AgentEvent[] = [];

    // Debug: log all SDK message types to understand MCP tool result flow
    if (this.onDebug) {
      const msgInfo = message.type === 'user' && 'tool_use_result' in message
        ? `user (tool_result for ${(message as any).parent_tool_use_id})`
        : message.type;
      this.onDebug(`SDK message: ${msgInfo}`);
    }

    switch (message.type) {
      case 'assistant': {
        // Skip replayed messages when resuming a session - they're historical
        if ('isReplay' in message && message.isReplay) {
          break;
        }

        // Full assistant message with content blocks
        const content = message.message.content;
        let textContent = '';

        for (const block of content) {
          if (block.type === 'text') {
            textContent += block.text;
          } else if (block.type === 'tool_use') {
            // Only emit if not already emitted via stream_event
            if (!emittedToolStarts.has(block.id)) {
              emittedToolStarts.add(block.id);
              pendingToolUses.set(block.id, {
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
              events.push({
                type: 'tool_start',
                toolName: block.name,
                toolUseId: block.id,
                input: block.input as Record<string, unknown>,
              });
            } else {
              // Update input if we have more complete data now
              const existing = pendingToolUses.get(block.id);
              const newInput = block.input as Record<string, unknown>;
              const hasNewInput = Object.keys(newInput).length > 0;
              const hadEmptyInput = existing && Object.keys(existing.input).length === 0;

              if (hasNewInput && hadEmptyInput) {
                pendingToolUses.set(block.id, {
                  name: block.name,
                  input: newInput,
                });
                // Emit another tool_start with the full input
                events.push({
                  type: 'tool_start',
                  toolName: block.name,
                  toolUseId: block.id,
                  input: newInput,
                });
              }
            }
          }
        }

        if (textContent) {
          events.push({ type: 'text_complete', text: textContent });
        }
        break;
      }

      case 'stream_event': {
        // Streaming partial message
        const event = message.event;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          events.push({ type: 'text_delta', text: event.delta.text });
        } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          const toolBlock = event.content_block;
          // Only emit if not already emitted
          if (!emittedToolStarts.has(toolBlock.id)) {
            emittedToolStarts.add(toolBlock.id);
            pendingToolUses.set(toolBlock.id, {
              name: toolBlock.name,
              input: {},
            });
            events.push({
              type: 'tool_start',
              toolName: toolBlock.name,
              toolUseId: toolBlock.id,
              input: {},
            });
          }
        }
        break;
      }

      case 'user': {
        // Skip replayed messages when resuming a session - they're historical
        if ('isReplay' in message && message.isReplay) {
          break;
        }

        // Debug: log user message structure for tool results
        if (this.onDebug && 'parent_tool_use_id' in message) {
          const hasResult = 'tool_use_result' in message && message.tool_use_result !== undefined;
          this.onDebug(`User message for tool ${message.parent_tool_use_id}: hasResult=${hasResult}`);
        }

        // User message (including tool results)
        if (message.tool_use_result !== undefined && message.parent_tool_use_id) {
          const toolUse = pendingToolUses.get(message.parent_tool_use_id);

          // Safely stringify result, handling circular references
          let resultStr: string;
          if (typeof message.tool_use_result === 'string') {
            resultStr = message.tool_use_result;
          } else {
            try {
              resultStr = JSON.stringify(message.tool_use_result, null, 2);
            } catch {
              resultStr = '[Result contains non-serializable data]';
            }
          }

          // Check if result indicates an error
          const isError = this.isToolResultError(message.tool_use_result);

          events.push({
            type: 'tool_result',
            toolUseId: message.parent_tool_use_id,
            result: resultStr,
            isError,
            input: toolUse?.input,
          });

          pendingToolUses.delete(message.parent_tool_use_id);
        }
        break;
      }

      case 'tool_progress': {
        // Tool is in progress - we already emitted tool_start
        break;
      }

      case 'result': {
        // Build usage info with all token types
        // Total input = input_tokens + cache_creation + cache_read
        const cacheRead = message.usage.cache_read_input_tokens ?? 0;
        const cacheCreation = message.usage.cache_creation_input_tokens ?? 0;
        const usage = {
          inputTokens: message.usage.input_tokens + cacheRead + cacheCreation,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
          costUsd: message.total_cost_usd,
        };

        if (message.subtype === 'success') {
          events.push({ type: 'complete', usage });
        } else {
          // Error result - emit error then complete with whatever usage we have
          const errorMsg = 'errors' in message ? message.errors.join(', ') : 'Query failed';
          events.push({ type: 'error', message: errorMsg });
          events.push({ type: 'complete', usage });
        }
        break;
      }

      case 'system': {
        // System messages (init, compaction, status)
        if (message.subtype === 'compact_boundary') {
          events.push({
            type: 'status',
            message: `Compacted conversation (was ${message.compact_metadata.pre_tokens} tokens)`,
          });
        } else if (message.subtype === 'status' && message.status === 'compacting') {
          events.push({ type: 'status', message: 'Compacting conversation...' });
        }
        break;
      }

      case 'auth_status': {
        if (message.error) {
          events.push({ type: 'error', message: `Auth error: ${message.error}. Try running /auth to re-authenticate.` });
        }
        break;
      }

      default: {
        // Log unhandled message types for debugging
        if (this.onDebug) {
          this.onDebug(`Unhandled SDK message type: ${(message as any).type}`);
        }
        break;
      }
    }

    return events;
  }

  /**
   * Check if a tool result indicates an error
   */
  private isToolResultError(result: unknown): boolean {
    if (result === null || result === undefined) {
      return false;
    }

    // Check for common error patterns in the result
    if (typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      // MCP error format
      if (obj.isError === true) return true;
      if (obj.error !== undefined) return true;
      // Content array with error type
      if (Array.isArray(obj.content)) {
        for (const item of obj.content) {
          if (typeof item === 'object' && item !== null) {
            const contentItem = item as Record<string, unknown>;
            if (contentItem.type === 'error') return true;
          }
        }
      }
    }

    // Check string results for error indicators
    if (typeof result === 'string') {
      const lower = result.toLowerCase();
      if (lower.startsWith('error:') || lower.startsWith('failed:')) {
        return true;
      }
    }

    return false;
  }

  clearHistory(): void {
    // Clear session to start fresh conversation
    this.sessionId = null;
  }

  interrupt(): void {
    if (this.currentQuery) {
      this.currentQuery.interrupt();
      this.currentQuery = null;
    }
  }

  getModel(): string {
    return this.config.model || 'claude-sonnet-4-5-20250929';
  }

  setModel(model: string): void {
    this.config.model = model;
    // Note: Model change takes effect on the next query
  }

  getWorkspace(): Workspace {
    return this.config.workspace;
  }

  setWorkspace(workspace: Workspace, restoreSession: boolean = false): void {
    this.config.workspace = workspace;
    // Either restore the saved session ID from workspace or start fresh
    if (restoreSession && workspace.sessionId) {
      this.sessionId = workspace.sessionId;
    } else {
      this.sessionId = null;
    }
    // Note: MCP proxy needs to be reinitialized by the caller (useAgent hook)
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
  }

  isWebSearchEnabled(): boolean {
    return this.webSearchEnabled;
  }

  setWebSearchEnabled(enabled: boolean): void {
    this.webSearchEnabled = enabled;
  }

  isWebFetchEnabled(): boolean {
    return this.webFetchEnabled;
  }

  setWebFetchEnabled(enabled: boolean): void {
    this.webFetchEnabled = enabled;
  }

  isCodeExecutionEnabled(): boolean {
    return this.codeExecutionEnabled;
  }

  setCodeExecutionEnabled(enabled: boolean): void {
    this.codeExecutionEnabled = enabled;
  }

  getActiveAgentDefinition(): SubAgentDefinition | null {
    return this.activeAgentDefinition;
  }

  /**
   * Set the active agent definition and optionally its pre-built MCP server configs
   * @param definition The agent definition (or null to deactivate)
   * @param mcpServers Pre-built MCP server configs with auth headers (from SubAgentManager.buildMcpServerConfig)
   */
  setActiveAgentDefinition(
    definition: SubAgentDefinition | null,
    mcpServers?: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>
  ): void {
    this.activeAgentDefinition = definition;
    this.agentMcpServers = mcpServers ?? {};
  }

  /**
   * Get SDK-compatible MCP server config for the active agent's custom MCP servers
   * Returns the pre-built config that was set via setActiveAgentDefinition()
   * The config is built by SubAgentManager.buildMcpServerConfig() which handles auth
   */
  private getAgentMcpServers(): Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }> {
    return this.agentMcpServers;
  }

  async close(): Promise<void> {
    this.interrupt();
  }
}
