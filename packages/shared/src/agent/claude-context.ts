/**
 * Claude Context Factory
 *
 * Creates a SessionToolContext implementation for Claude with full access
 * to Electron internals, credential managers, MCP validation, etc.
 *
 * This enables the shared handlers in session-tools-core to work with
 * Claude's full feature set.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import type {
  SessionToolContext,
  SessionToolCallbacks,
  FileSystemInterface,
  CredentialManagerInterface,
  ValidatorInterface,
  LoadedSource,
  LlmCallParams,
  LlmCallResult,
  StdioMcpConfig,
  StdioValidationResult,
  HttpMcpConfig,
  McpValidationResult,
  ApiTestResult,
  SourceConfig,
} from '@craft-agent/session-tools-core';
import {
  validateConfig,
  validateSource,
  validateAllSources,
  validateStatuses,
  validatePreferences,
  validateAll,
  validateSkill,
  validateWorkspacePermissions,
  validateSourcePermissions,
  validateAllPermissions,
  validateToolIcons,
} from '../config/validators.ts';
import {
  validateMcpConnection as validateMcpConnectionImpl,
  validateStdioMcpConnection as validateStdioMcpConnectionImpl,
} from '../mcp/validation.ts';
import {
  getAnthropicApiKey,
  getClaudeOAuthToken,
  getDefaultLlmConnection,
  getLlmConnection,
} from '../config/storage.ts';
import {
  loadSourceConfig as loadSourceConfigImpl,
  saveSourceConfig as saveSourceConfigImpl,
  getSourcePath,
} from '../sources/storage.ts';
import type { FolderSourceConfig, LoadedSource as SharedLoadedSource, SourceGuide } from '../sources/types.ts';
import { getSourceCredentialManager } from '../sources/index.ts';
import {
  inferGoogleServiceFromUrl,
  inferSlackServiceFromUrl,
  inferMicrosoftServiceFromUrl,
  type GoogleService,
  type SlackService,
  type MicrosoftService,
} from '../sources/types.ts';
import { isGoogleOAuthConfigured as isGoogleOAuthConfiguredImpl } from '../auth/google-oauth.ts';
import Anthropic from '@anthropic-ai/sdk';
import { debug } from '../utils/debug.ts';
import { HAIKU_MODEL_ID } from '../config/models.ts';
import { getSessionPlansPath } from '../sessions/storage.ts';

// Re-export types that may be needed by consumers
export type { SessionToolContext, SessionToolCallbacks } from '@craft-agent/session-tools-core';

/**
 * Options for creating a Claude context
 */
export interface ClaudeContextOptions {
  sessionId: string;
  workspacePath: string;
  workspaceId: string;
  onPlanSubmitted: (planPath: string) => void;
  onAuthRequest: (request: unknown) => void;
}

/**
 * Create a SessionToolContext for Claude with full capabilities.
 *
 * This provides:
 * - Full file system access
 * - Full Zod validators
 * - Credential manager with keychain access
 * - MCP connection validation
 * - Icon management
 * - LLM calls via Anthropic SDK
 */
export function createClaudeContext(options: ClaudeContextOptions): SessionToolContext {
  const { sessionId, workspacePath, workspaceId, onPlanSubmitted, onAuthRequest } = options;

  // File system implementation
  const fs: FileSystemInterface = {
    exists: (path: string) => existsSync(path),
    readFile: (path: string) => readFileSync(path, 'utf-8'),
    readFileBuffer: (path: string) => readFileSync(path),
    writeFile: (path: string, content: string) => writeFileSync(path, content, 'utf-8'),
    isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
    readdir: (path: string) => readdirSync(path),
    stat: (path: string) => {
      const stats = statSync(path);
      return {
        size: stats.size,
        isDirectory: () => stats.isDirectory(),
      };
    },
  };

  // Callbacks implementation
  const callbacks: SessionToolCallbacks = {
    onPlanSubmitted,
    onAuthRequest: (request) => onAuthRequest(request),
  };

  // Validators implementation
  const validators: ValidatorInterface = {
    validateConfig: () => validateConfig(),
    validateSource: (wsPath: string, slug: string) => validateSource(wsPath, slug),
    validateAllSources: (wsPath: string) => validateAllSources(wsPath),
    validateStatuses: (wsPath: string) => validateStatuses(wsPath),
    validatePreferences: () => validatePreferences(),
    validatePermissions: (wsPath: string, sourceSlug?: string) => {
      if (sourceSlug) {
        return validateSourcePermissions(wsPath, sourceSlug);
      }
      return validateAllPermissions(wsPath);
    },
    validateToolIcons: () => validateToolIcons(),
    validateAll: (wsPath: string) => validateAll(wsPath),
    validateSkill: (wsPath: string, slug: string) => validateSkill(wsPath, slug),
  };

  // Credential manager adapter
  const credentialManager: CredentialManagerInterface = {
    hasValidCredentials: async (source: LoadedSource): Promise<boolean> => {
      const mgr = getSourceCredentialManager();
      // Convert to shared type (guide: string → SourceGuide)
      const sharedSource: SharedLoadedSource = {
        config: source.config as unknown as FolderSourceConfig,
        guide: source.guide ? { raw: source.guide } as SourceGuide : null,
        folderPath: source.folderPath,
        workspaceRootPath: source.workspaceRootPath,
        workspaceId: source.workspaceId,
      };
      const token = await mgr.getToken(sharedSource);
      return !!token;
    },
    getToken: async (source: LoadedSource): Promise<string | null> => {
      const mgr = getSourceCredentialManager();
      const sharedSource: SharedLoadedSource = {
        config: source.config as unknown as FolderSourceConfig,
        guide: source.guide ? { raw: source.guide } as SourceGuide : null,
        folderPath: source.folderPath,
        workspaceRootPath: source.workspaceRootPath,
        workspaceId: source.workspaceId,
      };
      return mgr.getToken(sharedSource);
    },
    refresh: async (source: LoadedSource): Promise<string | null> => {
      const mgr = getSourceCredentialManager();
      const sharedSource: SharedLoadedSource = {
        config: source.config as unknown as FolderSourceConfig,
        guide: source.guide ? { raw: source.guide } as SourceGuide : null,
        folderPath: source.folderPath,
        workspaceRootPath: source.workspaceRootPath,
        workspaceId: source.workspaceId,
      };
      return mgr.refresh(sharedSource);
    },
  };

  // LLM call implementation
  const callLlm = async (params: LlmCallParams): Promise<LlmCallResult> => {
    const apiKey = await getAnthropicApiKey();
    const oauthToken = await getClaudeOAuthToken();

    if (!apiKey && !oauthToken) {
      return {
        success: false,
        error: 'No authentication configured. Configure Anthropic API key or Claude OAuth.',
      };
    }

    if (!apiKey && oauthToken) {
      return {
        success: false,
        error: 'call_llm requires an Anthropic API key. OAuth tokens cannot be used for secondary API calls.',
      };
    }

    try {
      const defaultConnSlug = getDefaultLlmConnection();
      const defaultConn = defaultConnSlug ? getLlmConnection(defaultConnSlug) : null;
      const baseUrl = defaultConn?.baseUrl;
      const client = new Anthropic({
        apiKey: apiKey!,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });

      // Build message content with attachments
      const messageContent: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

      if (params.attachments?.length) {
        for (const attachment of params.attachments) {
          const filePath = typeof attachment === 'string' ? attachment : attachment.path;
          const startLine = typeof attachment === 'object' ? attachment.startLine : undefined;
          const endLine = typeof attachment === 'object' ? attachment.endLine : undefined;

          if (!existsSync(filePath)) {
            return { success: false, error: `Attachment not found: ${filePath}` };
          }

          const content = readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');

          let finalContent: string;
          if (startLine !== undefined || endLine !== undefined) {
            const start = (startLine || 1) - 1;
            const end = endLine || lines.length;
            finalContent = lines.slice(start, end).join('\n');
          } else {
            finalContent = content;
          }

          const filename = basename(filePath) || filePath;
          messageContent.push({
            type: 'text',
            text: `<file path="${filename}">\n${finalContent}\n</file>`,
          });
        }
      }

      messageContent.push({ type: 'text', text: params.prompt });

      const model = params.model || HAIKU_MODEL_ID;
      const maxTokens = params.maxTokens || 4096;

      const request: Anthropic.MessageCreateParams = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: messageContent }],
        ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      };

      if (params.thinking) {
        const thinkingBudget = params.thinkingBudget || 10000;
        request.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
        request.max_tokens = thinkingBudget + maxTokens;
        request.temperature = 1;
      }

      const response = await client.messages.create(request);

      if (params.thinking) {
        const thinkingBlock = response.content.find(
          (block): block is Anthropic.ThinkingBlock => block.type === 'thinking'
        );
        const textBlock = response.content.find(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );

        const parts: string[] = [];
        if (thinkingBlock) {
          parts.push(`<thinking>\n${thinkingBlock.thinking}\n</thinking>`);
        }
        if (textBlock) {
          parts.push(textBlock.text);
        }

        return { success: true, content: parts.join('\n\n') || '(Empty response)' };
      }

      const textContent = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      return { success: true, content: textContent || '(Empty response)' };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        return { success: false, error: `API Error (${error.status}): ${error.message}` };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  };

  // MCP validation
  const validateStdioMcpConnection = async (config: StdioMcpConfig): Promise<StdioValidationResult> => {
    try {
      const result = await validateStdioMcpConnectionImpl(config);
      return {
        success: result.success,
        error: result.error,
        toolCount: result.tools?.length,
        toolNames: result.tools,
        serverName: result.serverInfo?.name,
        serverVersion: result.serverInfo?.version,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Validation failed' };
    }
  };

  const validateMcpConnection = async (config: HttpMcpConfig): Promise<McpValidationResult> => {
    try {
      const apiKey = await getAnthropicApiKey();
      const oauthToken = await getClaudeOAuthToken();

      if (!apiKey && !oauthToken) {
        return { success: false, error: 'No Claude API key or OAuth token configured' };
      }

      const result = await validateMcpConnectionImpl({
        mcpUrl: config.url,
        claudeApiKey: apiKey || undefined,
        claudeOAuthToken: oauthToken || undefined,
      });
      return {
        success: result.success,
        error: result.error,
        needsAuth: result.errorType === 'needs-auth',
        toolCount: result.tools?.length,
        toolNames: result.tools,
        serverName: result.serverInfo?.name,
        serverVersion: result.serverInfo?.version,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Validation failed' };
    }
  };

  // Build context
  const context: SessionToolContext = {
    sessionId,
    workspacePath,
    get sourcesPath() { return join(workspacePath, 'sources'); },
    get skillsPath() { return join(workspacePath, 'skills'); },
    plansFolderPath: getSessionPlansPath(workspacePath, sessionId),
    callbacks,
    fs,
    validators,
    credentialManager,
    callLlm,

    // Source management
    loadSourceConfig: (sourceSlug: string): SourceConfig | null => {
      const config = loadSourceConfigImpl(workspacePath, sourceSlug);
      return config as unknown as SourceConfig | null;
    },
    saveSourceConfig: (source: SourceConfig) => {
      saveSourceConfigImpl(workspacePath, source as unknown as FolderSourceConfig);
    },

    // Service inference
    inferGoogleService: (url?: string): GoogleService | undefined => {
      return inferGoogleServiceFromUrl(url);
    },
    inferSlackService: (url?: string): SlackService | undefined => {
      return inferSlackServiceFromUrl(url);
    },
    inferMicrosoftService: (url?: string): MicrosoftService | undefined => {
      return inferMicrosoftServiceFromUrl(url);
    },

    // OAuth config check
    isGoogleOAuthConfigured: (clientId?: string, clientSecret?: string): boolean => {
      return isGoogleOAuthConfiguredImpl(clientId, clientSecret);
    },

    // MCP validation
    validateStdioMcpConnection,
    validateMcpConnection,

    // Icon helpers (simplified - full implementation would use logo.ts)
    isIconUrl: (value: string): boolean => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },

    deriveServiceUrl: (source: SourceConfig): string | null => {
      if (source.type === 'api' && source.api?.baseUrl) {
        try {
          const url = new URL(source.api.baseUrl);
          return `${url.protocol}//${url.hostname}`;
        } catch {
          return null;
        }
      }
      if (source.type === 'mcp' && source.mcp?.url) {
        try {
          const url = new URL(source.mcp.url);
          return `${url.protocol}//${url.hostname}`;
        } catch {
          return null;
        }
      }
      return null;
    },
  };

  return context;
}
