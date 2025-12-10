import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getCredentialManager } from '../credentials/index.ts';

/**
 * OAuth credentials from a fresh authentication flow.
 * Used for temporary state in UI components before saving to keychain.
 *
 * Note: `clientId` is required here because OAuth flows always return it.
 * This differs from `StoredCredential` where `clientId` is optional since
 * not all credential types (bearer tokens, API keys) have a clientId.
 */
export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId: string;
  tokenType: string;
}

export interface Workspace {
  id: string;
  name: string;
  mcpUrl: string;
  isPublic?: boolean;
  createdAt: number;
  sessionId?: string;  // SDK session ID for conversation continuity
}

export type AuthType = 'api_key' | 'oauth_token';

// Config stored in JSON file (credentials stored in OS keychain, not here)
export interface StoredConfig {
  authType?: AuthType;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  model?: string;
  extendedCacheTtl?: boolean;  // Extended cache TTL: true=1h all, false=5m all, undefined=auto (Opus only)
}

const CONFIG_DIR = join(homedir(), '.craft-agent');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadStoredConfig(): StoredConfig | null {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return null;
    }
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content) as StoredConfig;

    // Must have workspaces array (legacy single-workspace configs not supported)
    if (!Array.isArray(config.workspaces) || config.workspaces.length === 0) {
      return null;
    }

    // Validate active workspace exists
    const activeWorkspace = config.workspaces.find(w => w.id === config.activeWorkspaceId);
    if (!activeWorkspace) {
      // Default to first workspace
      config.activeWorkspaceId = config.workspaces[0]?.id || null;
    }

    return config;
  } catch {
    return null;
  }
}

/**
 * Get extended cache TTL configuration.
 * @returns true (force 1h), false (force 5m), or null (auto: 1h for Opus only)
 */
export function getExtendedCacheTtlConfig(): boolean | null {
  const config = loadStoredConfig();
  if (config && typeof config.extendedCacheTtl === 'boolean') {
    return config.extendedCacheTtl;
  }
  return null; // Auto mode
}

/**
 * Check if extended cache TTL should be used for the given model.
 * Auto mode enables 1h cache for Opus models only (cost-effective).
 */
export function shouldUseExtendedCacheTtl(model: string): boolean {
  const config = getExtendedCacheTtlConfig();
  if (config === true) return true;
  if (config === false) return false;
  // Auto mode: only for Opus models
  return model.includes('opus');
}

/**
 * Check if config has valid credentials in keychain
 */
export async function hasValidCredentials(): Promise<boolean> {
  const config = loadStoredConfig();
  if (!config) return false;

  const manager = getCredentialManager();
  const apiKey = await manager.getApiKey();
  const oauthToken = await manager.getClaudeOAuth();

  return !!(apiKey || oauthToken);
}

/**
 * Get the Anthropic API key from keychain
 */
export async function getAnthropicApiKey(): Promise<string | null> {
  const manager = getCredentialManager();
  return manager.getApiKey();
}

/**
 * Get the Claude OAuth token from keychain
 */
export async function getClaudeOAuthToken(): Promise<string | null> {
  const manager = getCredentialManager();
  return manager.getClaudeOAuth();
}

// Check if workspace OAuth token needs refresh (with 5 minute buffer)
export async function isWorkspaceTokenExpiredAsync(workspaceId: string): Promise<boolean> {
  const manager = getCredentialManager();
  const oauth = await manager.getWorkspaceOAuth(workspaceId);
  if (!oauth?.expiresAt) {
    return false;
  }
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() + bufferMs >= oauth.expiresAt;
}


// Get access token for a specific workspace from keychain
export async function getWorkspaceAccessTokenAsync(workspaceId: string): Promise<string | null> {
  const config = loadStoredConfig();
  const workspace = config?.workspaces.find(w => w.id === workspaceId);

  if (workspace?.isPublic) {
    return null;
  }

  const manager = getCredentialManager();

  // Check keychain for bearer token
  const bearer = await manager.getWorkspaceBearer(workspaceId);
  if (bearer) return bearer;

  // Check keychain for OAuth
  const oauth = await manager.getWorkspaceOAuth(workspaceId);
  return oauth?.accessToken || null;
}


// Update OAuth tokens for a specific workspace (saves to keychain)
export async function updateWorkspaceOAuthTokensAsync(
  workspaceId: string,
  accessToken: string,
  refreshToken?: string,
  expiresAt?: number,
  clientId?: string,
  tokenType?: string
): Promise<void> {
  const manager = getCredentialManager();
  await manager.setWorkspaceOAuth(workspaceId, {
    accessToken,
    refreshToken,
    expiresAt,
    clientId,
    tokenType,
  });
}


export function saveConfig(config: StoredConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function updateApiKey(newApiKey: string): Promise<boolean> {
  const config = loadStoredConfig();
  if (!config) return false;

  // Save API key to keychain
  const manager = getCredentialManager();
  await manager.setApiKey(newApiKey);

  // Update auth type in config (but not the key itself)
  config.authType = 'api_key';
  saveConfig(config);
  return true;
}

export function getAuthType(): AuthType {
  const config = loadStoredConfig();
  return config?.authType || 'api_key';
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

// ============================================
// Workspace Management Functions
// ============================================

export function generateWorkspaceId(): string {
  return randomUUID();
}

export function getWorkspaces(): Workspace[] {
  const config = loadStoredConfig();
  return config?.workspaces || [];
}

export function getActiveWorkspace(): Workspace | null {
  const config = loadStoredConfig();
  if (!config || !config.activeWorkspaceId) {
    return config?.workspaces[0] || null;
  }
  return config.workspaces.find(w => w.id === config.activeWorkspaceId) || config.workspaces[0] || null;
}

/**
 * Find a workspace by name (case-insensitive) or ID.
 * Useful for CLI -w flag to specify workspace.
 */
export function getWorkspaceByNameOrId(nameOrId: string): Workspace | null {
  const workspaces = getWorkspaces();
  return workspaces.find(w =>
    w.id === nameOrId ||
    w.name.toLowerCase() === nameOrId.toLowerCase()
  ) || null;
}

export function setActiveWorkspace(workspaceId: string): void {
  const config = loadStoredConfig();
  if (!config) return;

  const workspace = config.workspaces.find(w => w.id === workspaceId);
  if (!workspace) return;

  config.activeWorkspaceId = workspaceId;
  saveConfig(config);
}

export function addWorkspace(workspace: Omit<Workspace, 'id' | 'createdAt'>): Workspace {
  const config = loadStoredConfig();
  if (!config) {
    throw new Error('No config found');
  }

  const newWorkspace: Workspace = {
    ...workspace,
    id: generateWorkspaceId(),
    createdAt: Date.now(),
  };

  config.workspaces.push(newWorkspace);

  // If this is the only workspace, make it active
  if (config.workspaces.length === 1) {
    config.activeWorkspaceId = newWorkspace.id;
  }

  saveConfig(config);
  return newWorkspace;
}

export async function removeWorkspace(workspaceId: string): Promise<boolean> {
  const config = loadStoredConfig();
  if (!config) return false;

  const index = config.workspaces.findIndex(w => w.id === workspaceId);
  if (index === -1) return false;

  config.workspaces.splice(index, 1);

  // If we removed the active workspace, switch to first available
  if (config.activeWorkspaceId === workspaceId) {
    config.activeWorkspaceId = config.workspaces[0]?.id || null;
  }

  saveConfig(config);

  // Clean up keychain credentials for this workspace
  const manager = getCredentialManager();
  await manager.deleteWorkspaceCredentials(workspaceId);

  return true;
}

export function renameWorkspace(workspaceId: string, newName: string): boolean {
  const config = loadStoredConfig();
  if (!config) return false;

  const workspace = config.workspaces.find(w => w.id === workspaceId);
  if (!workspace) return false;

  workspace.name = newName.trim();
  saveConfig(config);
  return true;
}

// ============================================
// Workspace Conversation Persistence
// ============================================

const WORKSPACES_DIR = join(CONFIG_DIR, 'workspaces');

function ensureWorkspaceDir(workspaceId: string): string {
  const dir = join(WORKSPACES_DIR, workspaceId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Update workspace session ID
export function updateWorkspaceSessionId(workspaceId: string, sessionId: string | null): void {
  const config = loadStoredConfig();
  if (!config) return;

  const workspace = config.workspaces.find(w => w.id === workspaceId);
  if (!workspace) return;

  if (sessionId) {
    workspace.sessionId = sessionId;
  } else {
    delete workspace.sessionId;
  }

  saveConfig(config);
}

// Stored message format (simplified for persistence)
export interface StoredMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'error' | 'status' | 'system' | 'info';
  content: string;
  timestamp?: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolStatus?: 'pending' | 'executing' | 'completed' | 'error';
  toolDuration?: number;
  isError?: boolean;
}

export interface WorkspaceConversation {
  messages: StoredMessage[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    contextTokens: number;
    costUsd: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  savedAt: number;
}

// Save workspace conversation (messages + token usage)
export function saveWorkspaceConversation(
  workspaceId: string,
  messages: StoredMessage[],
  tokenUsage: WorkspaceConversation['tokenUsage']
): void {
  const dir = ensureWorkspaceDir(workspaceId);
  const filePath = join(dir, 'conversation.json');

  const conversation: WorkspaceConversation = {
    messages,
    tokenUsage,
    savedAt: Date.now(),
  };

  writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
}

// Load workspace conversation
export function loadWorkspaceConversation(workspaceId: string): WorkspaceConversation | null {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'conversation.json');

  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as WorkspaceConversation;
  } catch {
    return null;
  }
}

// Get workspace data directory path
export function getWorkspaceDataPath(workspaceId: string): string {
  return join(WORKSPACES_DIR, workspaceId);
}

// Clear workspace conversation
export function clearWorkspaceConversation(workspaceId: string): void {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'conversation.json');
  if (existsSync(filePath)) {
    writeFileSync(filePath, '{}', 'utf-8');
  }

  // Also clear session ID
  updateWorkspaceSessionId(workspaceId, null);
}

