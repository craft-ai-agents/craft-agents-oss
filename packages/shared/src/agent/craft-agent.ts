import { query, createSdkMcpServer, tool, AbortError, type Query, type SDKMessage, type SDKUserMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from './options.ts';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources';
import { z } from 'zod';
import { getSystemPrompt, getDateTimeContext, getWorkingDirectoryContext } from '../prompts/system.ts';
import type { SubAgentDefinition } from '../agents/types.ts';
// Plan types are used by UI components; not needed in craft-agent.ts since Safe Mode is user-controlled
import { parseError, type AgentError } from './errors.ts';
import { runErrorDiagnostics } from './diagnostics.ts';
import { updateAgentInstructions as agenticUpdateInstructions, type UpdateInstructionsContext, type UpdateInstructionsResult, type UpdateInstructionsProgressEvent } from '../agents/instruction-updater.ts';
import { getWorkspaceAccessTokenAsync, isWorkspaceTokenExpiredAsync, updateWorkspaceOAuthTokensAsync, shouldUseExtendedCacheTtl, loadStoredConfig, loadPlanFromPath, type Workspace, type Session } from '../config/storage.ts';
import { DEFAULT_MODEL } from '../config/models.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { updatePreferences, loadPreferences, type UserPreferences } from '../config/preferences.ts';
import { CraftOAuth, getMcpBaseUrl } from '../auth/oauth.ts';
import type { FileAttachment } from '../utils/files.ts';
import { debug } from '../utils/debug.ts';
import { estimateTokens, summarizeLargeResult, TOKEN_LIMIT } from '../utils/summarize.ts';
import {
  getSessionPlansDir,
  getLastPlanFilePath,
  clearPlanFileState,
  registerSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
  getSessionScopedTools,
  cleanupSessionScopedTools,
} from './session-scoped-tools.ts';
import {
  isModeActive,
  enterMode,
  exitMode,
  toggleMode,
  initializeModeState,
  cleanupModeState,
  formatSessionState,
  shouldAllowToolInMode,
  blockWithReason,
  getActiveModes,
} from './mode-manager.ts';
import { getPlansDir } from '../config/storage.ts';

// Re-export mode functions for TUI/Electron usage
export {
  // Generic mode API
  isModeActive,
  enterMode,
  exitMode,
  toggleMode,
  subscribeModeChanges,
  type Mode,
} from './mode-manager.ts';
// Documentation is now served via external HTTP MCP at agents.craft.do/docs/mcp

// Import and re-export AgentEvent from core (single source of truth)
import type { AgentEvent } from '@craft-agent/core/types';
export type { AgentEvent };

export interface CraftAgentConfig {
  workspace: Workspace;
  session?: Session;           // Current session (primary isolation boundary)
  mcpToken?: string;           // Override token (for testing)
  model?: string;
  onSdkSessionIdUpdate?: (sdkSessionId: string) => void;  // Callback when SDK session ID is captured
  isHeadless?: boolean;        // Running in headless mode (disables interactive tools)
}

// Permission request tracking
interface PendingPermission {
  resolve: (allowed: boolean, alwaysAllow?: boolean) => void;
  toolName: string;
  command: string;
  baseCommand: string;
  type?: 'bash' | 'safe_mode';  // Type of permission request
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

// Cached MCP servers for performance (recreated when agent state changes)
let cachedPrefToolsServerForBase: ReturnType<typeof createSdkMcpServer> | null = null;
let cachedPrefToolsServerForAgent: ReturnType<typeof createSdkMcpServer> | null = null;

// Preferences MCP server - user preferences and agent instruction tools
function getPreferencesServer(hasActiveAgent: boolean): ReturnType<typeof createSdkMcpServer> {
  if (hasActiveAgent) {
    // Agent is active - include agent-specific tools
    if (!cachedPrefToolsServerForAgent) {
      cachedPrefToolsServerForAgent = createSdkMcpServer({
        name: 'preferences',
        version: '1.0.0',
        tools: [updateUserPreferencesTool, reloadAgentInstructionsTool, updateAgentInstructionsTool],
      });
    }
    return cachedPrefToolsServerForAgent;
  } else {
    // No agent - only user preferences
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
  private isHeadless: boolean = false;
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  private alwaysAllowedCommands: Set<string> = new Set(); // Base commands allowed for this session (e.g., "ls", "cat")
  private alwaysAllowedDomains: Set<string> = new Set(); // Domains allowed for curl/wget (session-scoped)
  private activeAgentDefinition: SubAgentDefinition | null = null;
  // Pre-built MCP server configs for the active agent (includes auth headers)
  private agentMcpServers: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }> = {};
  // In-process MCP servers for API integrations (created from ApiConfig)
  private agentApiServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};
  // Pre-built connection server configs (user-defined connections, separate from agent)
  private connectionMcpServers: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }> = {};
  // In-process MCP servers for connection API integrations
  private connectionApiServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};
  // Temporary clarifications (not yet saved to Craft document)
  private temporaryClarifications: string | null = null;
  // Map tool_use_id → explicit intent from _intent field (for summarization and UI display)
  private toolIntents: Map<string, string> = new Map();
  // Map tool_use_id → display name from _displayName field (for UI tool name display)
  private toolDisplayNames: Map<string, string> = new Map();
  // Safe mode state - user-controlled read-only exploration mode
  private safeMode: boolean = false;
  // SDK tools list (captured from init message)
  private sdkTools: string[] = [];
  // Ultrathink mode - when enabled, sets maxThinkingTokens for extended reasoning
  private ultrathinkMode: boolean = false;

  /**
   * Get the session ID for mode operations.
   * Returns a temp ID if no session is configured (shouldn't happen in practice).
   */
  private get modeSessionId(): string {
    return this.config.session?.id || `temp-${Date.now()}`;
  }

  // Callback for permission requests - set by TUI to receive permission prompts
  public onPermissionRequest: ((request: { requestId: string; toolName: string; command: string; description: string; type?: 'bash' | 'safe_mode' }) => void) | null = null;

  // Debug callback for status messages
  public onDebug: ((message: string) => void) | null = null;

  // Callback for AskUserQuestion tool - set by TUI to receive question prompts
  public onAskUserQuestion: ((request: { requestId: string; questions: Question[] }) => void) | null = null;

  // Callback for safe mode changes - set by TUI to sync React state
  public onSafeModeChange: ((safeMode: boolean) => void) | null = null;

  // Callback when a plan is submitted - set by TUI to display plan message
  public onPlanSubmitted: ((planPath: string) => void) | null = null;

  // Callback when working directory changes (e.g., Bash cd command)
  public onWorkingDirectoryChange: ((path: string) => void) | null = null;

  constructor(config: CraftAgentConfig) {
    this.config = config;
    this.isHeadless = config.isHeadless ?? false;

    // Initialize sessionId from session config for conversation resumption
    if (config.session?.sdkSessionId) {
      this.sessionId = config.session.sdkSessionId;
    }

    // Initialize safe mode state with callbacks
    const sessionId = this.modeSessionId;
    const initialSafeMode = config.session?.activeModes?.includes('safe') ?? false;

    initializeModeState(sessionId, { safeMode: initialSafeMode }, {
      onStateChange: (state) => {
        // Sync safe mode state with agent
        const isSafe = state.activeModes.has('safe');
        this.safeMode = isSafe;
        // Notify TUI of safe mode changes
        this.onSafeModeChange?.(isSafe);
      },
    });

    // Register session-scoped tool callbacks
    registerSessionScopedToolCallbacks(sessionId, {
      onPlanSubmitted: (planPath) => {
        this.onDebug?.(`[CraftAgent] onPlanSubmitted received: ${planPath}`);
        this.onPlanSubmitted?.(planPath);
      },
      onWorkingDirectoryChange: (path) => {
        this.onDebug?.(`[CraftAgent] onWorkingDirectoryChange received: ${path}`);
        if (this.config.session) {
          this.config.session.workingDirectory = path;
        }
        this.onWorkingDirectoryChange?.(path);
      },
    });
  }

  /**
   * Enable or disable ultrathink mode
   * When enabled, maxThinkingTokens will be set for extended reasoning
   */
  setUltrathinkMode(enabled: boolean): void {
    this.ultrathinkMode = enabled;
    this.onDebug?.(`[CraftAgent] Ultrathink mode: ${enabled ? 'ENABLED' : 'disabled'}`);
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
  // ============================================
  // Safe Mode Methods
  // ============================================

  /**
   * Check if currently in safe mode (read-only exploration)
   * Uses modeManager as single source of truth.
   */
  isInSafeMode(): boolean {
    return isModeActive(this.modeSessionId, 'safe');
  }

  /**
   * Check if a task should trigger planning (heuristic)
   * Returns true for complex tasks that would benefit from planning
   */
  shouldSuggestPlanning(userMessage: string): boolean {
    const message = userMessage.toLowerCase();

    // Keywords that suggest complex tasks
    const complexKeywords = [
      'implement', 'create', 'build', 'develop', 'design',
      'refactor', 'migrate', 'upgrade', 'restructure',
      'add feature', 'new feature', 'integrate',
      'set up', 'setup', 'configure', 'install',
      'multiple', 'several', 'all', 'entire', 'whole',
    ];

    // Check for complex keywords
    const hasComplexKeyword = complexKeywords.some(keyword => message.includes(keyword));

    // Check message length (longer messages often indicate complex tasks)
    const isLongMessage = message.length > 200;

    // Check for multiple sentences (indicates multi-step task)
    const sentenceCount = message.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    const hasMultipleSentences = sentenceCount > 2;

    return hasComplexKeyword || isLongMessage || hasMultipleSentences;
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
      const sessionId = this.config.session?.id || `temp-${Date.now()}`;

      // Clear intent and display name maps for new turn
      this.toolIntents.clear();
      this.toolDisplayNames.clear();

      // Check if we have binary attachments that need the AsyncIterable interface
      const hasBinaryAttachments = attachments?.some(a => a.type === 'image' || a.type === 'pdf');

      // Validate we have something to send
      if (!userMessage.trim() && (!attachments || attachments.length === 0)) {
        yield { type: 'error', message: 'Cannot send empty message' };
        yield { type: 'complete' };
        return;
      }

      // Block SDK's plan mode tools (we don't use them - safe mode is user-controlled)
      const disallowedTools: string[] = ['EnterPlanMode', 'ExitPlanMode'];

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
      debug('[chat] connectionMcpServers:', this.connectionMcpServers);
      debug('[chat] connectionApiServers:', this.connectionApiServers);

      const hasActiveAgent = this.activeAgentDefinition !== null;
      const mcpServers: Options['mcpServers'] = {
        craft: {
          type: 'http',
          url: mcpUrl,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        },
        preferences: getPreferencesServer(hasActiveAgent),
        // Session-scoped tools (SubmitPlan, change_working_directory, etc.)
        session: getSessionScopedTools(sessionId),
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
        // Add user-defined connection servers (MCP and API)
        ...this.connectionMcpServers,
        ...this.connectionApiServers,
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

      // Determine maxThinkingTokens based on model when ultrathink is enabled
      // Opus/Sonnet support up to 128k, Haiku up to 8k
      const getUltrathinkTokens = (modelName: string): number => {
        const lowerModel = modelName.toLowerCase();
        if (lowerModel.includes('haiku')) return 8000;
        return 64000; // Opus and Sonnet
      };

      const options: Options = {
        ...getDefaultOptions(),
        model,
        // Enable extended prompt cache TTL (1 hour instead of 5 minutes) when configured
        // The actual TTL injection happens in src/cache-ttl-interceptor.ts
        ...(useExtendedCache ? { betas: ['extended-cache-ttl-2025-04-11'] as any } : {}),
        // Extended thinking: set tokens based on model when ultrathink mode is active, otherwise 0
        maxThinkingTokens: this.ultrathinkMode ? getUltrathinkTokens(model) : 0,
        // Option A: Append to Claude Code's system prompt (recommended by docs)
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: getSystemPrompt(
            this.activeAgentDefinition ?? undefined,
            this.temporaryClarifications ?? undefined
          ),
        },
        // Option B: Custom system prompt (uncomment to use instead)
        // systemPrompt: getSystemPrompt(this.activeAgentDefinition ?? undefined),
        cwd: this.config.session?.workingDirectory ?? process.cwd(),
        includePartialMessages: true,
        // Enable the full Claude Code toolset (includes AskUserQuestion)
        tools: { type: 'preset', preset: 'claude_code' },
        // Note: permissionMode: 'plan' is "not currently supported" in SDK
        // We enforce plan mode restrictions via PreToolUse hook instead
        permissionMode: 'default',
        // Use PreToolUse hook to intercept tool calls (plan mode blocking happens here)
        hooks: {
          PreToolUse: [{
            hooks: [async (input) => {
              // Only handle PreToolUse events
              if (input.hook_event_name !== 'PreToolUse') {
                return { continue: true };
              }

              // Check safe mode directly from modeManager (single source of truth)
              // This ensures tool blocking and LLM context are always in sync
              const isSafeMode = isModeActive(sessionId, 'safe');
              this.onDebug?.(`PreToolUse hook: ${input.tool_name} (safeMode=${isSafeMode})`);

              // ============================================================
              // SAFE MODE: Block write operations when in read-only mode
              // All logic is centralized in mode-manager.ts
              // ============================================================
              if (isSafeMode) {
                const plansFolderPath = sessionId ? getPlansDir(sessionId) : undefined;
                const result = shouldAllowToolInMode(
                  input.tool_name,
                  input.tool_input,
                  'safe',
                  { plansFolderPath }
                );

                if (!result.allowed) {
                  this.onDebug?.(`BLOCKED in safe mode: ${input.tool_name}`);
                  return blockWithReason(result.reason);
                }

                this.onDebug?.(`Allowed in safe mode: ${input.tool_name}`);
                return { continue: true };
              }

              // Built-in SDK tools (don't extract _intent from these)
              const builtInTools = new Set([
                'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
                'WebFetch', 'WebSearch', 'Task', 'TaskOutput', 'AskUserQuestion',
                'TodoWrite', 'MultiEdit', 'NotebookEdit', 'KillShell',
                'SubmitPlan', 'Skill', 'SlashCommand',
              ]);

              // Extract _intent and _displayName from MCP tool inputs (not built-in SDK tools)
              if (!builtInTools.has(input.tool_name)) {
                const toolInput = input.tool_input as Record<string, unknown>;
                const intent = toolInput._intent as string | undefined;
                const displayName = toolInput._displayName as string | undefined;

                // Store metadata if present
                if (intent) {
                  this.toolIntents.set(input.tool_use_id, intent);
                  this.onDebug?.(`Extracted intent for ${input.tool_use_id}: ${intent}`);
                }
                if (displayName) {
                  this.toolDisplayNames.set(input.tool_use_id, displayName);
                  this.onDebug?.(`Extracted displayName for ${input.tool_use_id}: ${displayName}`);
                }

                // Strip metadata fields before forwarding to MCP server
                if (intent || displayName) {
                  const { _intent, _displayName, ...cleanInput } = toolInput;

                  // Return with updatedInput - SDK will use this instead of original
                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      updatedInput: cleanInput,
                    },
                  };
                }
              }

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
          // PostToolUse hook to summarize large MCP tool results
          PostToolUse: [{
            hooks: [async (input) => {
              // Only handle PostToolUse events
              if (input.hook_event_name !== 'PostToolUse') {
                return { continue: true };
              }

              // Note: EnterPlanMode/ExitPlanMode are disallowed (line ~811) since Safe Mode is user-controlled.
              // The agent uses SubmitPlan (universal) to submit plans at any time.

              // ─────────────────────────────────────────────────────────────────────
              // WORKING DIRECTORY SYNC: Detect when Bash cd changes the cwd
              // The SDK tracks cwd internally and passes it to hooks. When it changes,
              // we update our session config and notify the callback so the UI stays in sync.
              // ─────────────────────────────────────────────────────────────────────
              if (input.cwd && this.config.session?.workingDirectory !== input.cwd) {
                this.onDebug?.(`PostToolUse: cwd changed to ${input.cwd}`);

                // Update internal state
                if (this.config.session) {
                  this.config.session.workingDirectory = input.cwd;
                }

                // Notify callback so UI can update the folder selector
                this.onWorkingDirectoryChange?.(input.cwd);
              }

              // Skip built-in SDK tools (they have their own context management)
              const builtInTools = new Set([
                'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
                'WebFetch', 'WebSearch', 'Task', 'AskUserQuestion',
                'TodoWrite', 'MultiEdit', 'NotebookEdit', 'KillShell',
                'SubmitPlan', 'Skill', 'SlashCommand',
              ]);

              // Skip in-process MCP tools (preferences, agent management)
              const inProcessTools = new Set([
                'update_user_preferences', 'reload_agent_instructions',
                'update_agent_instructions',
              ]);

              // Skip API tools - they already handle summarization internally
              if (builtInTools.has(input.tool_name) ||
                  inProcessTools.has(input.tool_name) ||
                  input.tool_name.startsWith('api_')) {
                return { continue: true };
              }

              // For MCP tools, always clean up stored intent after processing
              // Use try/finally to ensure cleanup even on early returns or errors
              try {
                // Check if response is large enough to warrant summarization
                const response = input.tool_response;
                let responseStr: string;
                try {
                  responseStr = typeof response === 'string'
                    ? response
                    : JSON.stringify(response);
                } catch {
                  // Response has circular references or can't be stringified
                  // Skip summarization for non-serializable responses
                  return { continue: true };
                }

                const tokens = estimateTokens(responseStr);
                if (tokens <= TOKEN_LIMIT) {
                  return { continue: true };
                }

                this.onDebug?.(`PostToolUse: ${input.tool_name} response too large (~${tokens} tokens), summarizing...`);

                // Get explicit intent for this tool call (from _intent field, extracted by PreToolUse hook)
                const explicitIntent = this.toolIntents.get(input.tool_use_id);
                this.onDebug?.(`PostToolUse: Using intent for summarization: ${explicitIntent || '(none - will use tool params)'}`);

                try {
                  const summary = await summarizeLargeResult(responseStr, {
                    toolName: input.tool_name,
                    input: input.tool_input as Record<string, unknown>,
                    // Use explicit intent if available - otherwise summarizer uses tool name/params
                    modelIntent: explicitIntent,
                  });

                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'PostToolUse' as const,
                      updatedMCPToolOutput: `[Large result (~${tokens} tokens) was summarized to fit context. ` +
                        `If key details are missing, consider re-calling with more specific filters or pagination.]\n\n${summary}`,
                    },
                  };
                } catch (error) {
                  debug(`[PostToolUse] Summarization failed for ${input.tool_name}: ${error}`);
                  // On error, truncate rather than fail
                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'PostToolUse' as const,
                      updatedMCPToolOutput: responseStr.substring(0, 40000) + '\n\n[Result truncated due to size]',
                    },
                  };
                }
              } finally {
                // Always clean up stored metadata for MCP tools to prevent memory leak
                this.toolIntents.delete(input.tool_use_id);
                this.toolDisplayNames.delete(input.tool_use_id);
              }
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
          // Note: SDK plan mode tools (EnterPlanMode/ExitPlanMode) are blocked via disallowedTools
          // We use safe mode instead, which is user-controlled via UI (not agent-controlled)
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
      // Track tool IDs that have been matched to results (but not yet deleted from pendingToolUses)
      // This prevents the FIFO fallback from matching multiple results to the same tool
      const matchedToolIds = new Set<string>();

      // ═══════════════════════════════════════════════════════════════════════════
      // PARENT-CHILD TOOL TRACKING (for Task/subagent tools)
      // ═══════════════════════════════════════════════════════════════════════════
      //
      // The SDK's `parent_tool_use_id` field has different semantics depending on context:
      //
      // 1. REGULAR TOOLS (Read, Grep, Bash, etc.):
      //    - parent_tool_use_id = the tool's own ID (self-reference)
      //    - OR null for in-process MCP tools (preferences, plan mode tools)
      //
      // 2. SUBAGENT CHILD TOOLS (tools running inside Task):
      //    - parent_tool_use_id = the PARENT Task's ID, NOT the child tool's ID
      //    - SDK is saying "this result belongs to a child of Task"
      //
      // Example flow:
      //   tool_start: Task (toolu_PARENT)     ← Parent starts
      //   tool_start: Grep (toolu_CHILD1)     ← Child starts inside Task
      //   tool_start: Read (toolu_CHILD2)     ← Another child
      //   tool_result: parent_tool_use_id=toolu_PARENT  ← Result for CHILD1!
      //   tool_result: parent_tool_use_id=toolu_PARENT  ← Result for CHILD2!
      //
      // Without tracking, we'd match all results to Task (wrong!).
      // Solution: Track which tools are children of which parent, match results
      // to children in FIFO order when parent_tool_use_id points to a parent tool.
      //
      // See also: apps/electron/src/main/sessions.ts implements similar tracking
      // at the session manager level (parentToolStack, toolToParentMap).
      // ═══════════════════════════════════════════════════════════════════════════
      const PARENT_TOOL_NAMES = ['Task', 'AgentOutputTool'];
      // Track parent tools that are currently running
      const activeParentTools = new Set<string>();
      // Track which tools are children of which parent (parentId -> childIds in order)
      // Using array to preserve insertion order for FIFO matching
      const parentToChildren = new Map<string, string[]>();
      // Track child's parent for hierarchy (childId -> parentId)
      const childToParent = new Map<string, string>();

      // Process SDK messages and convert to AgentEvents
      let receivedComplete = false;
      // Track text waiting for stop_reason from message_delta
      let pendingTextForStopReason: string | null = null;
      // Track current turn ID from message_start (correlation ID for grouping events)
      let currentTurnId: string | null = null;
      try {
        for await (const message of this.currentQuery) {
          // Capture session ID for conversation continuity
          if ('session_id' in message && message.session_id) {
            this.sessionId = message.session_id;
            // Notify caller of new SDK session ID (for immediate persistence)
            this.config.onSdkSessionIdUpdate?.(message.session_id);
          }

          const events = this.convertSDKMessage(
            message,
            pendingToolUses,
            emittedToolStarts,
            matchedToolIds,
            { PARENT_TOOL_NAMES, activeParentTools, parentToChildren, childToParent },
            pendingTextForStopReason,
            (text) => { pendingTextForStopReason = text; },
            currentTurnId,
            (id) => { currentTurnId = id; }
          );
          for (const event of events) {
            if (event.type === 'complete') {
              receivedComplete = true;
            }
            yield event;
          }
        }

        // Defensive: flush any pending text that wasn't emitted
        // This can happen if the SDK sends an assistant message with text but skips the
        // message_delta event that normally triggers text_complete (e.g., in some ultrathink scenarios)
        if (pendingTextForStopReason) {
          yield { type: 'text_complete', text: pendingTextForStopReason, isIntermediate: false, turnId: currentTurnId || undefined };
          pendingTextForStopReason = null;
        }

        // Defensive: emit complete if SDK didn't send result message
        if (!receivedComplete) {
          yield { type: 'complete' };
        }
      } catch (sdkError) {
        // Debug: log inner catch trigger (stderr to avoid SDK JSON pollution)
        console.error(`[CraftAgent] INNER CATCH triggered: ${sdkError instanceof Error ? sdkError.message : String(sdkError)}`);

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
          // Run diagnostics to identify specific cause (2s timeout)
          const storedConfig = loadStoredConfig();
          const diagnostics = await runErrorDiagnostics({
            authType: storedConfig?.authType,
            workspaceId: this.config.workspace?.id,
            mcpUrl: this.config.workspace?.mcpUrl,
            rawError: rawErrorMsg,
          });

          // Get recovery actions based on diagnostic code
          const actions = diagnostics.code === 'credits_exhausted'
            ? [
                { key: 'c', label: 'Top up credits', command: '/credits', action: 'credits' as const },
                { key: 's', label: 'Switch to API key', command: '/settings', action: 'settings' as const },
              ]
            : diagnostics.code === 'token_expired' || diagnostics.code === 'mcp_unreachable'
            ? [
                { key: 'w', label: 'Open workspace menu', command: '/workspace' },
                { key: 'r', label: 'Retry', action: 'retry' as const },
              ]
            : diagnostics.code === 'invalid_credentials'
            ? [
                { key: 's', label: 'Update credentials', command: '/settings', action: 'settings' as const },
              ]
            : [
                { key: 'r', label: 'Retry', action: 'retry' as const },
                { key: 's', label: 'Check settings', command: '/settings', action: 'settings' as const },
              ];

          yield {
            type: 'typed_error',
            error: {
              code: diagnostics.code,
              title: diagnostics.title,
              message: diagnostics.message,
              details: diagnostics.details,
              actions,
              canRetry: diagnostics.code !== 'credits_exhausted' && diagnostics.code !== 'invalid_credentials',
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
      // Debug: log outer catch trigger (stderr to avoid SDK JSON pollution)
      console.error(`[CraftAgent] OUTER CATCH triggered: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`[CraftAgent] Error stack: ${error instanceof Error ? error.stack : 'no stack'}`);

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
      // Reset ultrathink mode after query completes (single-shot activation)
      this.ultrathinkMode = false;
    }
  }

  /**
   * Build a simple text prompt with embedded text file contents (for text-only messages)
   * Prepends date/time context for prompt caching optimization (keeps system prompt static)
   * Injects session state (including mode state) for every message
   */
  private buildTextPrompt(text: string, attachments?: FileAttachment[]): string {
    const parts: string[] = [];

    // Add date/time context first (moved from system prompt to enable caching)
    parts.push(getDateTimeContext());

    // Add session state (always includes all modes with true/false state)
    // This lightweight format replaces the verbose mode context
    parts.push(formatSessionState(this.modeSessionId));

    // Add working directory context if set
    const workingDirContext = getWorkingDirectoryContext(this.config.session?.workingDirectory);
    if (workingDirContext) {
      parts.push(workingDirContext);
    }

    // Add file attachments with stored path info
    if (attachments) {
      for (const attachment of attachments) {
        if (attachment.type === 'text' && attachment.text) {
          const pathInfo = attachment.storedPath ? `\n[Stored at: ${attachment.storedPath}]` : '';
          parts.push(`[File: ${attachment.name}]${pathInfo}\n\`\`\`\n${attachment.text}\n\`\`\``);
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
   * Injects session state (including mode state) for every message
   */
  private buildSDKUserMessage(text: string, attachments?: FileAttachment[]): SDKUserMessage {
    const contentBlocks: ContentBlockParam[] = [];

    // Add date/time context first (moved from system prompt to enable caching)
    contentBlocks.push({ type: 'text', text: getDateTimeContext() });

    // Add session state (always includes all modes with true/false state)
    // This lightweight format replaces the verbose mode context
    contentBlocks.push({ type: 'text', text: formatSessionState(this.modeSessionId) });

    // Add working directory context if set
    const workingDirContext = getWorkingDirectoryContext(this.config.session?.workingDirectory);
    if (workingDirContext) {
      contentBlocks.push({ type: 'text', text: workingDirContext });
    }

    // Add attachments with stored path info
    if (attachments) {
      for (const attachment of attachments) {
        // Add path info text block before binary attachments so the agent knows where the file is stored
        if (attachment.storedPath && (attachment.type === 'image' || attachment.type === 'pdf')) {
          contentBlocks.push({
            type: 'text',
            text: `[Attached file: ${attachment.name}]\n[Stored at: ${attachment.storedPath}]`,
          });
        }

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
          // Send text files as document blocks (not inline text) to:
          // - Avoid context overflow for large files
          // - Enable citation support (char_location)
          // - Consistent handling with PDFs
          // Include stored path in title for reference
          const titleWithPath = attachment.storedPath
            ? `${attachment.name} (stored at: ${attachment.storedPath})`
            : attachment.name;
          contentBlocks.push({
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: attachment.text,
            },
            title: titleWithPath,
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
    emittedToolStarts: Set<string>,
    matchedToolIds: Set<string>,
    parentChildTracking: {
      PARENT_TOOL_NAMES: string[];
      activeParentTools: Set<string>;
      parentToChildren: Map<string, string[]>;
      childToParent: Map<string, string>;
    },
    pendingText: string | null,
    setPendingText: (text: string | null) => void,
    turnId: string | null,
    setTurnId: (id: string | null) => void
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
            // Extract intent and displayName from the tool_use input for UI display
            // Note: PreToolUse hook also extracts and stores these for summarization
            // We only extract here for emitting in tool_start events (UI display)
            const toolInput = block.input as Record<string, unknown>;
            let intent: string | undefined = toolInput._intent as string | undefined;
            const displayName: string | undefined = toolInput._displayName as string | undefined;

            // Debug: log tool input to see if metadata is present
            debug(`[convertSDKMessage] tool_use ${block.name}: _intent=${intent}, _displayName=${displayName}, input keys=${Object.keys(toolInput).join(', ')}`);

            // For Bash, use its description field instead of intent
            if (!intent && block.name === 'Bash') {
              const bashInput = block.input as { description?: string };
              intent = bashInput.description;
            }

            // Only emit if not already emitted via stream_event
            if (!emittedToolStarts.has(block.id)) {
              emittedToolStarts.add(block.id);
              pendingToolUses.set(block.id, {
                name: block.name,
                input: block.input as Record<string, unknown>,
              });

              // ─────────────────────────────────────────────────────────────────────
              // PARENT-CHILD TRACKING: Register this tool in the hierarchy
              // ─────────────────────────────────────────────────────────────────────
              const { PARENT_TOOL_NAMES, activeParentTools, parentToChildren, childToParent } = parentChildTracking;
              const isParentTool = PARENT_TOOL_NAMES.includes(block.name);

              let parentToolUseId: string | undefined;
              if (isParentTool) {
                // This is a parent tool (Task, AgentOutputTool) - it can spawn children
                activeParentTools.add(block.id);
                parentToChildren.set(block.id, []);
                this.onDebug?.(`Parent tool started: ${block.name} (${block.id})`);
              } else if (activeParentTools.size > 0) {
                // This is a child tool - associate it with the most recent parent
                // Note: We use the last active parent (most recently started)
                const parentIds = Array.from(activeParentTools);
                const lastParentId = parentIds[parentIds.length - 1];
                if (lastParentId) {
                  parentToChildren.get(lastParentId)?.push(block.id);
                  childToParent.set(block.id, lastParentId);
                  parentToolUseId = lastParentId;
                  this.onDebug?.(`Child tool started: ${block.name} (${block.id}) under parent ${lastParentId}`);
                }
              }

              events.push({
                type: 'tool_start',
                toolName: block.name,
                toolUseId: block.id,
                input: block.input as Record<string, unknown>,
                intent,
                displayName,
                turnId: turnId || undefined,
                parentToolUseId, // Include parent for hierarchy tracking
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
                // Emit another tool_start with the full input, intent, and displayName
                events.push({
                  type: 'tool_start',
                  toolName: block.name,
                  toolUseId: block.id,
                  input: newInput,
                  intent,
                  displayName,
                  turnId: turnId || undefined,
                });
              }
            }
          }
        }

        if (textContent) {
          // Don't emit text_complete yet - wait for message_delta to get actual stop_reason
          // The assistant message arrives with stop_reason: null during streaming
          // The actual stop_reason comes in the message_delta event
          setPendingText(textContent);
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
        // Capture turn ID from message_start (arrives before any content events)
        // This ID correlates all events in an assistant turn
        if (event.type === 'message_start') {
          const messageId = (event as any).message?.id;
          if (messageId) {
            setTurnId(messageId);
          }
        }
        // message_delta contains the actual stop_reason - emit pending text now
        if (event.type === 'message_delta') {
          const stopReason = (event as any).delta?.stop_reason;
          if (pendingText) {
            const isIntermediate = stopReason === 'tool_use';
            events.push({ type: 'text_complete', text: pendingText, isIntermediate, turnId: turnId || undefined });
            setPendingText(null);
          }
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          events.push({ type: 'text_delta', text: event.delta.text, turnId: turnId || undefined });
        } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          const toolBlock = event.content_block;
          // Only emit if not already emitted
          if (!emittedToolStarts.has(toolBlock.id)) {
            emittedToolStarts.add(toolBlock.id);
            pendingToolUses.set(toolBlock.id, {
              name: toolBlock.name,
              input: {},
            });

            // ─────────────────────────────────────────────────────────────────────
            // PARENT-CHILD TRACKING: Register this tool in the hierarchy
            // This MUST happen here (stream_event), not just in assistant message,
            // because stream_event arrives first and sets emittedToolStarts
            // ─────────────────────────────────────────────────────────────────────
            const { PARENT_TOOL_NAMES, activeParentTools, parentToChildren, childToParent } = parentChildTracking;
            const isParentTool = PARENT_TOOL_NAMES.includes(toolBlock.name);

            let parentToolUseId: string | undefined;
            if (isParentTool) {
              // This is a parent tool (Task, AgentOutputTool) - it can spawn children
              activeParentTools.add(toolBlock.id);
              parentToChildren.set(toolBlock.id, []);
              console.log(`[CraftAgent] PARENT REGISTERED (stream): ${toolBlock.name} (${toolBlock.id})`);
            } else if (activeParentTools.size > 0) {
              // This is a child tool - associate it with the most recent parent
              const parentIds = Array.from(activeParentTools);
              const lastParentId = parentIds[parentIds.length - 1];
              if (lastParentId) {
                parentToChildren.get(lastParentId)?.push(toolBlock.id);
                childToParent.set(toolBlock.id, lastParentId);
                parentToolUseId = lastParentId;
                console.log(`[CraftAgent] CHILD REGISTERED (stream): ${toolBlock.name} (${toolBlock.id}) under parent ${lastParentId}`);
              }
            }

            events.push({
              type: 'tool_start',
              toolName: toolBlock.name,
              toolUseId: toolBlock.id,
              input: {},
              turnId: turnId || undefined,
              parentToolUseId,
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

        // ─────────────────────────────────────────────────────────────────────────
        // TOOL RESULT MATCHING
        // ─────────────────────────────────────────────────────────────────────────
        // Three cases to handle:
        //
        // Case 1: parent_tool_use_id is a PARENT tool (Task, AgentOutputTool)
        //   → Result is for a CHILD of that parent, match using FIFO
        //
        // Case 2: parent_tool_use_id is a regular tool ID
        //   → Result is for that tool directly
        //
        // Case 3: parent_tool_use_id is null (in-process MCP tools)
        //   → Use FIFO fallback with matchedToolIds to avoid double-matching
        // ─────────────────────────────────────────────────────────────────────────
        if (message.tool_use_result !== undefined) {
          let toolUseId = message.parent_tool_use_id;
          let toolUse: { name: string; input: Record<string, unknown> } | undefined;

          const { activeParentTools, parentToChildren, childToParent } = parentChildTracking;

          if (toolUseId && activeParentTools.has(toolUseId)) {
            // Case 1: parent_tool_use_id points to a PARENT tool (Task, AgentOutputTool)
            // This result is for a CHILD of that parent, not the parent itself
            // Match to the first unmatched child in FIFO order
            const children = parentToChildren.get(toolUseId);
            console.log(`[CraftAgent] RESULT MATCHING: parent=${toolUseId}, children.length=${children?.length || 0}`);
            if (children && children.length > 0) {
              const firstChild = children.shift()!; // Remove first child (FIFO)
              console.log(`[CraftAgent] MATCHED TO CHILD: ${firstChild}`);
              this.onDebug?.(`Matched child result: parent=${toolUseId}, child=${firstChild}`);
              toolUseId = firstChild;
              toolUse = pendingToolUses.get(toolUseId);
              // Clean up child-to-parent mapping
              childToParent.delete(firstChild);
            } else {
              // No more children - this must be the parent's own result
              console.log(`[CraftAgent] NO CHILDREN LEFT - treating as parent's own result: ${toolUseId}`);
              this.onDebug?.(`Parent tool completing: ${toolUseId} (no more children)`);
              toolUse = pendingToolUses.get(toolUseId);
              // Clean up parent tracking
              activeParentTools.delete(toolUseId);
              parentToChildren.delete(toolUseId);
            }
          } else if (toolUseId) {
            // Case 2: Regular tool result - parent_tool_use_id is the tool's own ID
            toolUse = pendingToolUses.get(toolUseId);
          } else if (pendingToolUses.size > 0) {
            // Case 3: parent_tool_use_id is null (in-process MCP tools)
            // Match with first pending tool not yet matched (FIFO)
            for (const [id, use] of pendingToolUses.entries()) {
              if (!matchedToolIds.has(id)) {
                toolUseId = id;
                toolUse = use;
                matchedToolIds.add(id);
                this.onDebug?.(`Matched null parent_tool_use_id to pending tool: ${toolUseId} (${toolUse.name})`);
                break;
              }
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
              turnId: turnId || undefined,
              // Include original parent_tool_use_id for parent-child tracking
              parentToolUseId: message.parent_tool_use_id || undefined,
            });

            pendingToolUses.delete(toolUseId);
            matchedToolIds.delete(toolUseId);
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
        // Debug: log result message details (stderr to avoid SDK JSON pollution)
        console.error(`[CraftAgent] result message: subtype=${message.subtype}, errors=${'errors' in message ? JSON.stringify((message as any).errors) : 'none'}`);

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
        if (message.subtype === 'init') {
          // Capture tools list from SDK init message
          if ('tools' in message && Array.isArray(message.tools)) {
            this.sdkTools = message.tools;
            this.onDebug?.(`SDK init: captured ${this.sdkTools.length} tools`);
          }
        } else if (message.subtype === 'compact_boundary') {
          events.push({
            type: 'info',
            message: 'Compacted Conversation',
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

  /**
   * Get the list of SDK tools (captured from init message)
   */
  getSdkTools(): string[] {
    return this.sdkTools;
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

  /**
   * Update the working directory for this agent's session.
   * Called when user changes the working directory in the UI.
   */
  updateWorkingDirectory(path: string): void {
    if (this.config.session) {
      this.config.session.workingDirectory = path;
    }
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
   * Set connection servers (user-defined connections, separate from agent)
   * These are MCP servers and API tools added via the connection selector UI
   * @param mcpServers Pre-built MCP server configs with auth headers
   * @param apiServers In-process MCP servers for REST APIs
   */
  setConnectionServers(
    mcpServers: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>,
    apiServers: Record<string, ReturnType<typeof createSdkMcpServer>>
  ): void {
    this.connectionMcpServers = mcpServers;
    this.connectionApiServers = apiServers;
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
    this.onSafeModeChange = null;
    this.onPlanSubmitted = null;

    // Clean up session-specific state
    const configSessionId = this.config.session?.id;
    if (configSessionId) {
      cleanupModeState(configSessionId);
      cleanupSessionScopedTools(configSessionId);
    }

    // Clear session
    this.sessionId = null;
  }
}
