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
import { validateHooks } from '../hooks-simple/index.ts';
import {
  validateMcpConnection as validateMcpConnectionImpl,
  validateStdioMcpConnection as validateStdioMcpConnectionImpl,
} from '../mcp/validation.ts';
import {
  getDefaultLlmConnection,
  getLlmConnection,
} from '../config/storage.ts';
import { getCredentialManager } from '../credentials/index.ts';
import {
  loadSourceConfig as loadSourceConfigImpl,
  saveSourceConfig as saveSourceConfigImpl,
  getSourcePath,
} from '../sources/storage.ts';
import type { FolderSourceConfig, LoadedSource as SharedLoadedSource } from '../sources/types.ts';
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
import { debug } from '../utils/debug.ts';
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
    validateHooks: (wsPath: string) => validateHooks(wsPath),
    validateToolIcons: () => validateToolIcons(),
    validateAll: (wsPath: string) => validateAll(wsPath),
    validateSkill: (wsPath: string, slug: string) => validateSkill(wsPath, slug),
  };

  // Credential manager adapter
  const credentialManager: CredentialManagerInterface = {
    hasValidCredentials: async (source: LoadedSource): Promise<boolean> => {
      const mgr = getSourceCredentialManager();
      // Convert to shared type (guide not needed for credential operations)
      const sharedSource: SharedLoadedSource = {
        config: source.config as unknown as FolderSourceConfig,
        guide: null,
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
        guide: null,
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
        guide: null,
        folderPath: source.folderPath,
        workspaceRootPath: source.workspaceRootPath,
        workspaceId: source.workspaceId,
      };
      return mgr.refresh(sharedSource);
    },
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
      // Resolve credentials from the default LLM connection
      const defaultSlug = getDefaultLlmConnection();
      const connection = defaultSlug ? getLlmConnection(defaultSlug) : null;
      const credManager = getCredentialManager();

      let apiKey: string | null = null;
      let oauthToken: string | null = null;

      if (connection && defaultSlug) {
        if (connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint') {
          apiKey = await credManager.getLlmApiKey(defaultSlug);
        } else if (connection.authType === 'oauth') {
          const oauth = await credManager.getLlmOAuth(defaultSlug);
          oauthToken = oauth?.accessToken || null;
        }
      }

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
