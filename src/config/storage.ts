import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

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
  oauth?: OAuthCredentials;
  bearerToken?: string;  // Static bearer token (alternative to OAuth)
  isPublic?: boolean;
  createdAt: number;
  sessionId?: string;  // SDK session ID for conversation continuity
}

export type AuthType = 'api_key' | 'oauth_token';

export interface StoredConfig {
  anthropicApiKey: string;
  // Claude Max OAuth token (alternative to API key)
  claudeOAuthToken?: string;
  // Which auth method to use
  authType?: AuthType;
  // Legacy fields (kept for migration from single-workspace config)
  craftMcpUrl?: string;
  oauth?: OAuthCredentials;
  isPublic?: boolean;
  // Multi-workspace fields
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  model?: string;
}

const CONFIG_DIR = join(homedir(), '.craft-agent');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

// Extract a friendly name from MCP URL for migration
function extractWorkspaceName(mcpUrl: string): string {
  try {
    const url = new URL(mcpUrl);
    // Try to get meaningful name from path (e.g., /links/ABC123/mcp -> ABC123)
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'links' && parts[1]) {
      return `Workspace ${parts[1].substring(0, 6)}`;
    }
    return url.hostname.replace(/^mcp\./, '').split('.')[0] || 'Default';
  } catch {
    return 'Default';
  }
}

// Migrate legacy single-workspace config to multi-workspace format
function migrateConfig(rawConfig: Record<string, unknown>): StoredConfig | null {
  // Check if already migrated (has workspaces array)
  if (Array.isArray(rawConfig.workspaces)) {
    // Already migrated - just validate it has required auth
    const config = rawConfig as unknown as StoredConfig;
    const hasApiKey = config.anthropicApiKey && config.anthropicApiKey.length > 0;
    const hasOAuthToken = config.claudeOAuthToken && config.claudeOAuthToken.length > 0;
    if (!hasApiKey && !hasOAuthToken) {
      return null;
    }
    return config;
  }

  // Validate legacy required fields
  const anthropicApiKey = rawConfig.anthropicApiKey as string | undefined;
  const claudeOAuthToken = rawConfig.claudeOAuthToken as string | undefined;
  const craftMcpUrl = rawConfig.craftMcpUrl as string | undefined;
  const oauth = rawConfig.oauth as OAuthCredentials | undefined;
  const bearerToken = rawConfig.bearerToken as string | undefined;
  const isPublic = rawConfig.isPublic as boolean | undefined;
  const model = rawConfig.model as string | undefined;

  // Must have either API key or OAuth token for Claude auth
  const hasClaudeAuth = (anthropicApiKey && anthropicApiKey.length > 0) || (claudeOAuthToken && claudeOAuthToken.length > 0);
  if (!hasClaudeAuth || !craftMcpUrl) {
    return null;
  }

  // Must have OAuth credentials, bearer token, or be marked as public
  if (!oauth?.accessToken && !bearerToken && !isPublic) {
    return null;
  }

  // Create workspace from legacy config
  const workspace: Workspace = {
    id: randomUUID(),
    name: extractWorkspaceName(craftMcpUrl),
    mcpUrl: craftMcpUrl,
    oauth,
    bearerToken,
    isPublic,
    createdAt: Date.now(),
  };

  const migratedConfig: StoredConfig = {
    anthropicApiKey: anthropicApiKey || '',
    claudeOAuthToken: claudeOAuthToken,
    // Keep legacy fields for backwards compatibility
    craftMcpUrl,
    oauth,
    isPublic,
    // New multi-workspace fields
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    model,
  };

  // Save migrated config
  saveConfig(migratedConfig);

  return migratedConfig;
}

export function loadStoredConfig(): StoredConfig | null {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return null;
    }
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const rawConfig = JSON.parse(content) as Record<string, unknown>;

    // Validate Claude auth exists (either API key or OAuth token)
    const hasApiKey = rawConfig.anthropicApiKey && (rawConfig.anthropicApiKey as string).length > 0;
    const hasOAuthToken = rawConfig.claudeOAuthToken && (rawConfig.claudeOAuthToken as string).length > 0;
    if (!hasApiKey && !hasOAuthToken) {
      return null;
    }

    // Migrate if needed and validate
    const config = migrateConfig(rawConfig);
    if (!config) {
      return null;
    }

    // Must have at least one workspace with valid auth
    if (!config.workspaces || config.workspaces.length === 0) {
      return null;
    }

    // Validate active workspace exists and has valid auth
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

// Check if OAuth token needs refresh (with 5 minute buffer)
export function isTokenExpired(config: StoredConfig): boolean {
  if (!config.oauth?.expiresAt) {
    return false; // No expiry means it doesn't expire (or unknown)
  }
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() + bufferMs >= config.oauth.expiresAt;
}

// Check if workspace OAuth token needs refresh (with 5 minute buffer)
export function isWorkspaceTokenExpired(workspace: Workspace): boolean {
  if (!workspace.oauth?.expiresAt) {
    return false;
  }
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() + bufferMs >= workspace.oauth.expiresAt;
}

// Get the access token to use for API calls (empty string for public servers)
export function getAccessToken(config: StoredConfig): string | null {
  if (config.isPublic) {
    return null; // No auth needed
  }
  if (config.oauth?.accessToken) {
    return config.oauth.accessToken;
  }
  return null;
}

// Get access token for a specific workspace
export function getWorkspaceAccessToken(workspace: Workspace): string | null {
  if (workspace.isPublic) {
    return null;
  }
  // Check bearer token first (static, no refresh needed)
  if (workspace.bearerToken) {
    return workspace.bearerToken;
  }
  return workspace.oauth?.accessToken || null;
}

// Update OAuth tokens after refresh
export function updateOAuthTokens(
  accessToken: string,
  refreshToken?: string,
  expiresAt?: number
): void {
  const config = loadStoredConfig();
  if (!config || !config.oauth) return;

  config.oauth.accessToken = accessToken;
  if (refreshToken) {
    config.oauth.refreshToken = refreshToken;
  }
  if (expiresAt) {
    config.oauth.expiresAt = expiresAt;
  }

  saveConfig(config);
}

// Update OAuth tokens for a specific workspace
export function updateWorkspaceOAuthTokens(
  workspaceId: string,
  accessToken: string,
  refreshToken?: string,
  expiresAt?: number
): void {
  const config = loadStoredConfig();
  if (!config) return;

  const workspace = config.workspaces.find(w => w.id === workspaceId);
  if (!workspace || !workspace.oauth) return;

  workspace.oauth.accessToken = accessToken;
  if (refreshToken) {
    workspace.oauth.refreshToken = refreshToken;
  }
  if (expiresAt) {
    workspace.oauth.expiresAt = expiresAt;
  }

  saveConfig(config);
}

export function saveConfig(config: StoredConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function clearConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, '{}', 'utf-8');
  }
}

export function updateApiKey(newApiKey: string): boolean {
  const config = loadStoredConfig();
  if (!config) return false;

  config.anthropicApiKey = newApiKey;
  config.authType = 'api_key';
  saveConfig(config);
  return true;
}

export function updateOAuthToken(newToken: string): boolean {
  const config = loadStoredConfig();
  if (!config) return false;

  config.claudeOAuthToken = newToken;
  config.authType = 'oauth_token';
  saveConfig(config);
  return true;
}

export function getAuthType(): AuthType {
  const config = loadStoredConfig();
  return config?.authType || 'api_key';
}

export function getAuthCredential(): { type: AuthType; value: string } | null {
  const config = loadStoredConfig();
  if (!config) return null;

  const authType = config.authType || 'api_key';
  if (authType === 'oauth_token' && config.claudeOAuthToken) {
    return { type: 'oauth_token', value: config.claudeOAuthToken };
  }
  return { type: 'api_key', value: config.anthropicApiKey };
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

export function removeWorkspace(workspaceId: string): boolean {
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
  return true;
}

export function getWorkspaceById(workspaceId: string): Workspace | null {
  const config = loadStoredConfig();
  if (!config) return null;
  return config.workspaces.find(w => w.id === workspaceId) || null;
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
  type: 'user' | 'assistant' | 'tool' | 'error' | 'status' | 'system';
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
