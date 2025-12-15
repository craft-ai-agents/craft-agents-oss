import { query, createSdkMcpServer, tool, AbortError, type Query, type SDKMessage, type SDKUserMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from './options.ts';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources';
import { z } from 'zod';
import { getSystemPrompt, getDateTimeContext } from '../prompts/system.ts';
import type { SubAgentDefinition } from '../agents/types.ts';
import { parseError, type AgentError } from './errors.ts';
import { updateAgentInstructions as agenticUpdateInstructions, type UpdateInstructionsContext, type UpdateInstructionsResult, type UpdateInstructionsProgressEvent } from '../agents/instruction-updater.ts';
import { getWorkspaceAccessTokenAsync, isWorkspaceTokenExpiredAsync, updateWorkspaceOAuthTokensAsync, shouldUseExtendedCacheTtl, type Workspace, type Session } from '../config/storage.ts';
import { DEFAULT_MODEL } from '../config/models.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { updatePreferences, loadPreferences, type UserPreferences } from '../config/preferences.ts';
import { CraftOAuth, getMcpBaseUrl } from '../auth/oauth.ts';
import type { FileAttachment } from '../tui/utils/files.ts';
import { debug } from '../tui/utils/debug.ts';
// Documentation is now served via external HTTP MCP at agents.craft.do/docs/mcp

export interface CraftAgentConfig {
  workspace: Workspace;
  session?: Session;           // Current session (primary isolation boundary)
  mcpToken?: string;           // Override token (for testing)
  model?: string;
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
  | { type: 'typed_error'; error: AgentError }
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

// Context provider for agent instructions update (set by TUI when agent is active)
// Provides all context needed for agentic update
let updateAgentInstructionsContextProvider: (() => UpdateInstructionsContext | null) | null = null;

export function setUpdateAgentInstructionsContextProvider(
  provider: (() => UpdateInstructionsContext | null) | null
): void {
  updateAgentInstructionsContextProvider = provider;
}

// Result callback for update_agent_instructions (set by TUI)
// Called after update completes to invalidate cache
let updateAgentInstructionsResultCallback: ((success: boolean) => Promise<void>) | null = null;

export function setUpdateAgentInstructionsResultCallback(
  callback: ((success: boolean) => Promise<void>) | null
): void {
  updateAgentInstructionsResultCallback = callback;
}

// Progress callback for update_agent_instructions (set by TUI)
// Called during agentic update to show nested tool progress
let updateAgentInstructionsProgressCallback: ((event: UpdateInstructionsProgressEvent) => void) | null = null;

export function setUpdateAgentInstructionsProgressCallback(
  callback: ((event: UpdateInstructionsProgressEvent) => void) | null
): void {
  updateAgentInstructionsProgressCallback = callback;
}

// ============================================================
// Global Tool Permission System
// Used by both bash commands (via agent instance) and MCP tools (via global functions)
// ============================================================

interface GlobalPendingPermission {
  resolve: (allowed: boolean) => void;
  toolName: string;
  command: string;
}

const globalPendingPermissions = new Map<string, GlobalPendingPermission>();

// Handler set by TUI to receive permission requests
let globalPermissionHandler: ((request: { requestId: string; toolName: string; command: string; description: string }) => void) | null = null;

/**
 * Set the global permission request handler (called by TUI)
 */
export function setGlobalPermissionHandler(
  handler: ((request: { requestId: string; toolName: string; command: string; description: string }) => void) | null
): void {
  globalPermissionHandler = handler;
}

/**
 * Request permission for a tool operation (used by MCP tools)
 * Returns a promise that resolves to true if allowed, false if denied
 */
export function requestToolPermission(
  toolName: string,
  command: string,
  description: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = `perm-${toolName}-${Date.now()}`;

    globalPendingPermissions.set(requestId, {
      resolve,
      toolName,
      command,
    });

    if (globalPermissionHandler) {
      globalPermissionHandler({ requestId, toolName, command, description });
    } else {
      // No handler - deny by default
      globalPendingPermissions.delete(requestId);
      resolve(false);
    }
  });
}

/**
 * Resolve a pending global permission request (called by TUI)
 */
export function resolveGlobalPermission(requestId: string, allowed: boolean): void {
  const pending = globalPendingPermissions.get(requestId);
  if (pending) {
    pending.resolve(allowed);
    globalPendingPermissions.delete(requestId);
  }
}

/**
 * Clear all pending global permissions (called on workspace switch)
 */
export function clearGlobalPermissions(): void {
  globalPendingPermissions.clear();
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


// Base tool: update_user_preferences (always available)
const updateUserPreferencesTool = tool(
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
);

// Agent-only tool: reload_agent_instructions
const reloadAgentInstructionsTool = tool(
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
);

// Agent-only tool: update_agent_instructions
const updateAgentInstructionsTool = tool(
  'update_agent_instructions',
  `Update your Instructions document with a new learning or instruction. Use this when you learn something from the user that should persist across conversations.

**CRITICAL: This is the ONLY way to update your source instructions.** Never use direct Craft MCP tools (blocks_update, markdown_add, etc.) to modify your Instructions document. Always use this tool instead - it handles the update safely and correctly.

This tool requires user permission before running. It will:
1. Read the current Instructions document from Craft (source of truth)
2. Intelligently add or update the content based on your request
3. Write the changes back to the document

IMPORTANT guidelines for what to write:
- Write ONLY the new learning or instruction, not your full instructions
- Use human-friendly references: "this document", "this page", "the Instructions section"
- Do NOT include document IDs or block IDs in your content
- Keep it concise and actionable
- Format as a clear instruction or note that your future self can follow

Example good content:
- "When the user asks about projects, always check the Projects folder first"
- "User prefers bullet points over numbered lists"
- "Always confirm before making destructive changes"

Example bad content:
- "Update document 12345 with..." (don't include IDs)
- [Entire rewrite of instructions] (only add what's new)`,
  {
    content: z.string().describe('The new learning or instruction to add. Should be a concise, actionable note.'),
    section: z.string().optional().describe('Optional: which section to add this to (e.g., "Learnings", "User Preferences"). Defaults to appending at the end.'),
  },
  async (args) => {
    // Check if context provider is set
    if (!updateAgentInstructionsContextProvider) {
      return {
        content: [{ type: 'text', text: 'No agent is currently active. This tool only works when a sub-agent is active.' }],
      };
    }

    // Get the context
    const context = updateAgentInstructionsContextProvider();
    if (!context) {
      return {
        content: [{ type: 'text', text: 'Could not get agent context. Ensure an agent is active.' }],
      };
    }

    // Request user permission via global permission system
    const allowed = await requestToolPermission(
      'update_agent_instructions',
      args.content.substring(0, 100) + (args.content.length > 100 ? '...' : ''),
      `Update ${context.agentName}'s instructions with:\n${args.content}`
    );
    if (!allowed) {
      return {
        content: [{ type: 'text', text: 'User denied permission to update instructions.' }],
      };
    }

    try {
      // Format the content with optional section header
      const section = args.section ? `## ${args.section}\n` : '';
      const formattedContent = section ? `${section}${args.content}` : args.content;

      // Run the agentic update
      debug('[update_agent_instructions] Running agentic update with context:', {
        documentId: context.documentId,
        instructionsBlockId: context.instructionsBlockId,
        agentName: context.agentName,
      });

      const result: UpdateInstructionsResult = await agenticUpdateInstructions(
        formattedContent,
        context,
        updateAgentInstructionsProgressCallback ?? undefined
      );

      // Notify TUI of result to invalidate cache
      if (updateAgentInstructionsResultCallback) {
        await updateAgentInstructionsResultCallback(result.success);
      }

      return {
        content: [{
          type: 'text',
          text: result.success
            ? `${result.message}\n\nUpdated content:\n${result.updatedContent || args.content}\n\nThis will persist across conversations.`
            : result.message,
        }],
        ...(result.success ? {} : { isError: true }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: `Failed to update instructions: ${message}` }],
        isError: true,
      };
    }
  }
);

// Create the preferences MCP server dynamically based on whether an agent is active
// Cached servers for performance (recreated when agent state changes)
let cachedPrefToolsServerForBase: ReturnType<typeof createSdkMcpServer> | null = null;
let cachedPrefToolsServerForAgent: ReturnType<typeof createSdkMcpServer> | null = null;

function getPreferencesServer(hasActiveAgent: boolean): ReturnType<typeof createSdkMcpServer> {
  if (hasActiveAgent) {
    // Agent is active - include all tools
    if (!cachedPrefToolsServerForAgent) {
      cachedPrefToolsServerForAgent = createSdkMcpServer({
        name: 'preferences',
        version: '1.0.0',
        tools: [updateUserPreferencesTool, reloadAgentInstructionsTool, updateAgentInstructionsTool],
      });
    }
    return cachedPrefToolsServerForAgent;
  } else {
    // No agent - only include base preferences tool
    if (!cachedPrefToolsServerForBase) {
      cachedPrefToolsServerForBase = createSdkMcpServer({
        name: 'preferences',
        version: '1.0.0',
        tools: [updateUserPreferencesTool],
      });
    }
    return cachedPrefToolsServerForBase;
  }
}

export class CraftAgent {
  private config: CraftAgentConfig;
  private currentQuery: Query | null = null;
  private sessionId: string | null = null;
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  private alwaysAllowedCommands: Set<string> = new Set(); // Base commands allowed for this session (e.g., "ls", "cat")
  private alwaysAllowedDomains: Set<string> = new Set(); // Domains allowed for curl/wget (session-scoped)
  private activeAgentDefinition: SubAgentDefinition | null = null;
  // Pre-built MCP server configs for the active agent (includes auth headers)
  private agentMcpServers: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }> = {};
  // In-process MCP servers for API integrations (created from ApiConfig)
  private agentApiServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};
  // Temporary clarifications (not yet saved to Craft document)
  private temporaryClarifications: string | null = null;

  // Callback for permission requests - set by TUI to receive permission prompts
  public onPermissionRequest: ((request: { requestId: string; toolName: string; command: string; description: string }) => void) | null = null;

  // Debug callback for status messages
  public onDebug: ((message: string) => void) | null = null;

  // Callback for AskUserQuestion tool - set by TUI to receive question prompts
  public onAskUserQuestion: ((request: { requestId: string; questions: Question[] }) => void) | null = null;

  constructor(config: CraftAgentConfig) {
    this.config = config;
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
   * Extract domain from a curl/wget command
   * e.g., curl https://api.example.com/path -> "api.example.com"
   */
  private extractDomainFromNetworkCommand(command: string): string | null {
    const urlMatch = command.match(/https?:\/\/([^\/\s"']+)/i);
    return urlMatch?.[1] ?? null;
  }

  /**
   * Respond to a pending permission request
   */
  respondToPermission(requestId: string, allowed: boolean, alwaysAllow: boolean = false): void {
    this.onDebug?.(`respondToPermission: ${requestId}, allowed=${allowed}, alwaysAllow=${alwaysAllow}, pending=${this.pendingPermissions.has(requestId)}`);
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      this.onDebug?.(`Resolving permission promise for ${requestId}`);

      // If "always allow" was selected, remember it (with special handling for curl/wget)
      if (alwaysAllow && allowed) {
        if (['curl', 'wget'].includes(pending.baseCommand)) {
          // For curl/wget, whitelist the domain instead of the command
          const domain = this.extractDomainFromNetworkCommand(pending.command);
          if (domain) {
            this.alwaysAllowedDomains.add(domain);
            this.onDebug?.(`Added domain "${domain}" to always-allowed domains`);
          }
        } else if (!this.isDangerousCommand(pending.baseCommand)) {
          this.alwaysAllowedCommands.add(pending.baseCommand);
          this.onDebug?.(`Added "${pending.baseCommand}" to always-allowed commands`);
        }
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
    // Bash commands require permission
    if (toolName === 'Bash') {
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

    // Get token from credential store (handles bearer token, OAuth, and legacy config fallback)
    const { authType, token } = await getWorkspaceAccessTokenAsync(workspace.id);
    if (!token && authType !== 'public') {
      throw new Error('No authentication credentials found for workspace. Please re-add the workspace.');
    }

    // Check if token is expired and needs refresh
    const isExpired = await isWorkspaceTokenExpiredAsync(workspace.id);
    if (isExpired) {
      // Get full OAuth credentials from credential store for refresh
      const manager = getCredentialManager();
      const oauthCreds = await manager.getWorkspaceOAuth(workspace.id);

      if (oauthCreds?.refreshToken && oauthCreds?.clientId) {
        try {
          const oauth = new CraftOAuth(
            { mcpBaseUrl: getMcpBaseUrl(workspace.mcpUrl) },
            { onStatus: () => {}, onError: () => {} }
          );

          const newTokens = await oauth.refreshAccessToken(
            oauthCreds.refreshToken,
            oauthCreds.clientId
          );

          // Save refreshed tokens to credential store
          await updateWorkspaceOAuthTokensAsync(
            workspace.id,
            newTokens.accessToken,
            newTokens.refreshToken,
            newTokens.expiresAt,
            oauthCreds.clientId,
            newTokens.tokenType
          );

          return newTokens.accessToken;
        } catch {
          // Refresh failed, return existing token (may still work)
          return token;
        }
      }
    }

    return token;
  }

  async *chat(
    userMessage: string,
    attachments?: FileAttachment[],
    _isRetry: boolean = false // Internal flag for session expiry retry
  ): AsyncGenerator<AgentEvent> {
    try {
      // Check if we have binary attachments that need the AsyncIterable interface
      const hasBinaryAttachments = attachments?.some(a => a.type === 'image' || a.type === 'pdf');

      // Validate we have something to send
      if (!userMessage.trim() && (!attachments || attachments.length === 0)) {
        yield { type: 'error', message: 'Cannot send empty message' };
        yield { type: 'complete' };
        return;
      }

      // All tools are enabled - no disallowed tools
      const disallowedTools: string[] = [];

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

      const agentMcpServers = this.getAgentMcpServers();
      const agentApiServers = this.getAgentApiServers();
      debug('[chat] agentMcpServers:', agentMcpServers);
      debug('[chat] agentApiServers:', agentApiServers);

      const hasActiveAgent = this.activeAgentDefinition !== null;
      const mcpServers: Options['mcpServers'] = {
        craft: {
          type: 'http',
          url: mcpUrl,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        },
        preferences: getPreferencesServer(hasActiveAgent),
        // External docs MCP server (public, no auth required)
        // Provides Craft Agent documentation for agents, MCP servers, APIs, and setup
        docs: {
          type: 'http',
          url: 'https://agents.craft.do/docs/mcp',
        },
        // Add agent-specific MCP servers if an agent is active
        ...agentMcpServers,
        // Add in-process API servers (REST APIs converted to MCP tools)
        ...agentApiServers,
      };

      // Debug: log active agent before building system prompt
      debug('[chat] activeAgentDefinition:', this.activeAgentDefinition?.name || 'none');
      debug('[chat] activeAgentDefinition instructions:', this.activeAgentDefinition?.instructions?.length || 0, 'chars');
      if (this.activeAgentDefinition?.instructions) {
        debug('[chat] instructions:', this.activeAgentDefinition.instructions);
      }
      
      // Configure SDK options
      const model = this.config.model || DEFAULT_MODEL;
      const useExtendedCache = shouldUseExtendedCacheTtl(model);
      const options: Options = {
        ...getDefaultOptions(),
        model,
        // Enable extended prompt cache TTL (1 hour instead of 5 minutes) when configured
        // The actual TTL injection happens in src/cache-ttl-interceptor.ts
        ...(useExtendedCache ? { betas: ['extended-cache-ttl-2025-04-11'] as any } : {}),
        // Option A: Append to Claude Code's system prompt (recommended by docs)
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: getSystemPrompt(this.activeAgentDefinition ?? undefined, this.temporaryClarifications ?? undefined),
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

              this.onDebug?.(`PreToolUse hook: ${input.tool_name}`);

              // For Bash, check if we need permission
              if (input.tool_name === 'Bash') {
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

                // For curl/wget, check if the domain is whitelisted
                if (['curl', 'wget'].includes(baseCommand)) {
                  const domain = this.extractDomainFromNetworkCommand(commandStr);
                  if (domain && this.alwaysAllowedDomains.has(domain)) {
                    this.onDebug?.(`Auto-allowing ${baseCommand} to "${domain}" (domain whitelisted)`);
                    return { continue: true };
                  }
                }

                // Ask for permission
                const requestId = `perm-${input.tool_use_id}`;
                debug(`[PreToolUse] Requesting permission for Bash command: ${commandStr}`);

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
        // Skip resume on retry (after session expiry) to start fresh
        ...(!_isRetry && this.sessionId ? { resume: this.sessionId } : {}),
        mcpServers,
        // Custom permission handler for Bash commands and AskUserQuestion
        canUseTool: async (toolName, input, toolOptions) => {
          // Debug: show what tools are being called
          this.onDebug?.(`canUseTool: ${toolName}`);

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

          // Bash commands require user permission
          if (toolName === 'Bash') {
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

      // Track whether we're trying to resume a session (for error handling)
      const wasResuming = !_isRetry && !!this.sessionId;

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

        // Get error message regardless of error type
        // Note: SDK text errors like "API Error: 402..." are primarily handled in useAgent.ts
        // via text_complete event. This is a fallback for errors that don't emit text first.
        // parseError() will detect status codes (402, 401, etc.) in the raw message.
        const rawErrorMsg = sdkError instanceof Error ? sdkError.message : String(sdkError);
        const errorMsg = rawErrorMsg.toLowerCase();

        // Debug logging - always log the actual error and context
        this.onDebug?.(`Error in chat: ${rawErrorMsg}`);
        this.onDebug?.(`Context: wasResuming=${wasResuming}, isRetry=${_isRetry}`);

        // Check for auth errors - these won't be fixed by clearing session
        const isAuthError =
          errorMsg.includes('unauthorized') ||
          errorMsg.includes('401') ||
          errorMsg.includes('authentication failed') ||
          errorMsg.includes('invalid api key') ||
          errorMsg.includes('invalid x-api-key');

        if (isAuthError) {
          // Auth errors should surface immediately, not retry
          // Parse to typed error using the captured/processed error message
          const typedError = parseError(new Error(rawErrorMsg));
          yield { type: 'typed_error', error: typedError };
          yield { type: 'complete' };
          return;
        }

        // Rate limit errors - don't retry immediately, surface to user
        const isRateLimitError =
          errorMsg.includes('429') ||
          errorMsg.includes('rate limit') ||
          errorMsg.includes('too many requests');

        if (isRateLimitError) {
          // Parse to typed error using the captured/processed error message
          const typedError = parseError(new Error(rawErrorMsg));
          yield { type: 'typed_error', error: typedError };
          yield { type: 'complete' };
          return;
        }

        // Check for billing/payment errors (402) - don't retry these
        const isBillingError =
          errorMsg.includes('402') ||
          errorMsg.includes('payment required') ||
          errorMsg.includes('insufficient credits') ||
          errorMsg.includes('billing');

        if (isBillingError) {
          // Parse to typed error using the captured/processed error message, not the original SDK error
          // This ensures parseError sees "402 Payment required" instead of "process exited with code 1"
          const typedError = parseError(new Error(rawErrorMsg));
          yield { type: 'typed_error', error: typedError };
          yield { type: 'complete' };
          return;
        }

        // Check for SDK process errors - these often wrap underlying billing/auth issues
        // The SDK's internal Claude Code process exits with code 1 for various API errors
        const isProcessError = errorMsg.includes('process exited with code');
        if (isProcessError) {
          // Show a helpful error that suggests common causes
          yield {
            type: 'typed_error',
            error: {
              code: 'service_error' as const,
              title: 'Request Failed',
              message: 'The AI service request failed. This is often caused by billing issues (insufficient credits), expired or incorrect API tokens, or temporary service problems.',
              actions: [
                { key: 'c', label: 'Check credits', command: '/credits', action: 'credits' as const },
                { key: 's', label: 'Re-authenticate via settings', command: '/settings', action: 'settings' as const },
                { key: 'r', label: 'Retry', action: 'retry' as const },
              ],
              canRetry: true,
              retryDelayMs: 1000,
              originalError: rawErrorMsg,
            },
          };
          yield { type: 'complete' };
          return;
        }

        // Session-related retry: only if we were resuming and haven't retried yet
        if (wasResuming && !_isRetry) {
          this.sessionId = null;

          // Provide context-aware message (conservative: only match explicit session/resume terms)
          const isSessionError =
            errorMsg.includes('session') ||
            errorMsg.includes('resume');

          const statusMessage = isSessionError
            ? 'Conversation sync failed, starting fresh...'
            : 'Request failed, retrying without history...';

          yield { type: 'status', message: statusMessage };
          // Recursively call with isRetry=true (yield* delegates all events)
          yield* this.chat(userMessage, attachments, true);
          return;
        }

        // Retry also failed, or wasn't resuming - show generic error
        // (Auth, billing, and rate limit errors are handled above)
        const rawMessage = sdkError instanceof Error ? sdkError.message : String(sdkError);
        yield { type: 'error', message: rawMessage };
        yield { type: 'complete' };
        return;
      }

    } catch (error) {
      // Check if this is a recognizable error type
      const typedError = parseError(error);
      if (typedError.code !== 'unknown_error') {
        // Known error type - show user-friendly message with recovery actions
        yield { type: 'typed_error', error: typedError };
      } else {
        // Unknown error - show raw message
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        yield { type: 'error', message: errorMessage };
      }
      // emit complete even on error so TUI knows we're done
      yield { type: 'complete' };
    } finally {
      this.currentQuery = null;
    }
  }

  /**
   * Build a simple text prompt with embedded text file contents (for text-only messages)
   * Prepends date/time context for prompt caching optimization (keeps system prompt static)
   */
  private buildTextPrompt(text: string, attachments?: FileAttachment[]): string {
    const parts: string[] = [];

    // Add date/time context first (moved from system prompt to enable caching)
    parts.push(getDateTimeContext());

    // Add file attachments
    if (attachments) {
      for (const attachment of attachments) {
        if (attachment.type === 'text' && attachment.text) {
          parts.push(`[File: ${attachment.name}]\n\`\`\`\n${attachment.text}\n\`\`\``);
        }
      }
    }

    // Add user's message
    if (text) {
      parts.push(text);
    }

    return parts.join('\n\n');
  }

  /**
   * Build an SDK user message with proper content blocks for binary attachments
   * Prepends date/time context for prompt caching optimization (keeps system prompt static)
   */
  private buildSDKUserMessage(text: string, attachments?: FileAttachment[]): SDKUserMessage {
    const contentBlocks: ContentBlockParam[] = [];

    // Add date/time context first (moved from system prompt to enable caching)
    contentBlocks.push({ type: 'text', text: getDateTimeContext() });

    // Add attachments
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
        // Debug: log all stream events to understand tool result flow
        if (this.onDebug && event.type !== 'content_block_delta') {
          this.onDebug(`stream_event: ${event.type}, content_type=${(event as any).content_block?.type || (event as any).delta?.type || 'n/a'}`);
        }
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
          this.onDebug(`User message for tool ${message.parent_tool_use_id}: hasResult=${hasResult}, pendingTools=${pendingToolUses.size}`);
        }

        // User message (including tool results)
        // For in-process MCP tools, parent_tool_use_id may be null
        // In that case, match with the oldest pending tool
        if (message.tool_use_result !== undefined) {
          let toolUseId = message.parent_tool_use_id;
          let toolUse: { name: string; input: Record<string, unknown> } | undefined;

          if (toolUseId) {
            toolUse = pendingToolUses.get(toolUseId);
          } else if (pendingToolUses.size > 0) {
            // parent_tool_use_id is null - match with first pending tool (FIFO order)
            // Map iteration is in insertion order per ES6 spec
            const firstEntry = pendingToolUses.entries().next().value;
            if (firstEntry) {
              [toolUseId, toolUse] = firstEntry;
              this.onDebug?.(`Matched null parent_tool_use_id to pending tool: ${toolUseId} (${toolUse.name})`);
            }
          }

          if (toolUseId) {
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
              toolUseId,
              result: resultStr,
              isError,
              input: toolUse?.input,
            });

            pendingToolUses.delete(toolUseId);
          }
        }
        break;
      }

      case 'tool_progress': {
        // Debug: log tool_progress structure to understand when tools complete
        if (this.onDebug) {
          const progress = message as any;
          this.onDebug(`tool_progress: tool_use_id=${progress.tool_use_id}, content_type=${progress.content?.type}, is_error=${progress.is_error}`);
        }
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
    return this.config.model || DEFAULT_MODEL;
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

  /**
   * Reset all workspace-scoped state. Called when switching workspaces.
   * Clears security whitelists, active agent, and pending operations.
   */
  resetWorkspaceState(): void {
    // Clear security whitelists (CRITICAL - commands approved in one workspace shouldn't auto-approve in another)
    this.alwaysAllowedCommands.clear();
    this.alwaysAllowedDomains.clear();

    // Clear active agent and its servers
    this.activeAgentDefinition = null;
    this.agentMcpServers = {};
    this.agentApiServers = {};
    this.temporaryClarifications = null;

    // Clear pending operations (they belong to the old workspace's agent)
    this.pendingPermissions.clear();
    this.pendingQuestions.clear();
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
  }

  getActiveAgentDefinition(): SubAgentDefinition | null {
    return this.activeAgentDefinition;
  }

  /**
   * Set the active agent definition and optionally its pre-built MCP server configs
   * @param definition The agent definition (or null to deactivate)
   * @param mcpServers Pre-built MCP server configs with auth headers (from SubAgentManager.buildMcpServerConfig)
   * @param apiServers In-process MCP servers for REST APIs (from SubAgentManager.buildApiServers)
   */
  setActiveAgentDefinition(
    definition: SubAgentDefinition | null,
    mcpServers?: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>,
    apiServers?: Record<string, ReturnType<typeof createSdkMcpServer>>
  ): void {
    this.activeAgentDefinition = definition;
    this.agentMcpServers = mcpServers ?? {};
    this.agentApiServers = apiServers ?? {};
  }

  /**
   * Set temporary clarifications that are injected into the system prompt
   * but not yet persisted to the Craft document
   */
  setTemporaryClarifications(text: string | null): void {
    this.temporaryClarifications = text;
  }

  /**
   * Get SDK-compatible MCP server config for the active agent's custom MCP servers
   * Returns the pre-built config that was set via setActiveAgentDefinition()
   * The config is built by SubAgentManager.buildMcpServerConfig() which handles auth
   */
  private getAgentMcpServers(): Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }> {
    return this.agentMcpServers;
  }

  /**
   * Get in-process MCP servers for REST APIs
   * These are created by createApiServer() from API configs extracted from agent documents
   */
  private getAgentApiServers(): Record<string, ReturnType<typeof createSdkMcpServer>> {
    return this.agentApiServers;
  }

  async close(): Promise<void> {
    this.interrupt();
  }

  /**
   * Dispose the agent instance and clean up all resources.
   * Called when the session ends (component unmount).
   * Clears all instance state and module-level callbacks that reference this instance.
   */
  dispose(): void {
    // Stop any running query
    this.interrupt();

    // Clear pending operations
    this.pendingPermissions.clear();
    this.pendingQuestions.clear();

    // Clear security whitelists
    this.alwaysAllowedCommands.clear();
    this.alwaysAllowedDomains.clear();

    // Clear active agent state
    this.activeAgentDefinition = null;
    this.agentMcpServers = {};
    this.agentApiServers = {};
    this.temporaryClarifications = null;

    // Clear callbacks
    this.onPermissionRequest = null;
    this.onDebug = null;
    this.onAskUserQuestion = null;

    // Clear session
    this.sessionId = null;
  }
}
