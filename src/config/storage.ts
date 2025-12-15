import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getCredentialManager } from '../credentials/index.ts';
import { isOpusModel } from './models.ts';

/**
 * OAuth credentials from a fresh authentication flow.
 * Used for temporary state in UI components before saving to credential store.
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

/**
 * How the workspace's MCP server should be authenticated.
 * - 'workspace_oauth': Has OAuth credentials (workspace_oauth::{workspaceId})
 * - 'workspace_bearer': Uses bearer token (workspace_bearer::{workspaceId})
 * - 'public': Truly public, no auth needed
 *
 * Note: Craft OAuth (craft_oauth::global) is ONLY for Craft API (spaces, MCP link management).
 * It should NEVER be used for MCP server authentication - MCP servers have their own OAuth.
 */
export type McpAuthType = 'workspace_oauth' | 'workspace_bearer' | 'public';

export interface Workspace {
  id: string;
  name: string;
  mcpUrl: string;
  mcpAuthType?: McpAuthType;  // Explicit MCP auth type (defaults to workspace_oauth)
  isPublic?: boolean;         // DEPRECATED: Use mcpAuthType instead
  createdAt: number;
  sessionId?: string;  // SDK session ID for conversation continuity
}

export type AuthType = 'api_key' | 'oauth_token' | 'craft_credits';

// Token display mode for status bar
export type TokenDisplayMode = 'hidden' | 'total' | 'separate';

// Global cumulative usage tracking across all workspaces
export interface CumulativeUsage {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  lastUpdated: number;
}

// Config stored in JSON file (credentials stored in encrypted file, not here)
export interface StoredConfig {
  authType?: AuthType;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;  // Currently active session (primary scope)
  model?: string;
  extendedCacheTtl?: boolean;  // Extended cache TTL: true=1h all, false=5m all, undefined=auto (Opus only)
  tokenDisplay?: TokenDisplayMode;  // How to show tokens in status bar: hidden, total, or separate in/out
  showCost?: boolean;  // Whether to show cost in status bar (only relevant for API Key auth)
  cumulativeUsage?: CumulativeUsage;  // Global cumulative cost across all workspaces
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
  return isOpusModel(model);
}

/**
 * Get the Anthropic API key from credential store
 */
export async function getAnthropicApiKey(): Promise<string | null> {
  const manager = getCredentialManager();
  return manager.getApiKey();
}

/**
 * Get the Claude OAuth token from credential store
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


/**
 * Determine the MCP auth type for a workspace.
 * Uses explicit mcpAuthType if set, otherwise infers from legacy isPublic flag.
 */
function getWorkspaceMcpAuthType(workspace: Workspace): McpAuthType {
  if (workspace.mcpAuthType) {
    return workspace.mcpAuthType;
  }
  // Legacy: isPublic was sometimes misused, but treat it as 'public' for backwards compat
  if (workspace.isPublic) {
    return 'public';
  }
  // Default: most workspaces need OAuth
  return 'workspace_oauth';
}

/**
 * Get access token for a specific workspace from credential store.
 *
 * IMPORTANT: This function does NOT fall back to craft_oauth!
 * Craft OAuth is for the Craft API (managing spaces, MCP links).
 * MCP servers require their own workspace-specific authentication.
 */
export async function getWorkspaceAccessTokenAsync(workspaceId: string): Promise<{ authType: McpAuthType; token: string | null }> {
  const config = loadStoredConfig();
  const workspace = config?.workspaces.find(w => w.id === workspaceId);

  if (!workspace) {
    return { authType: 'public', token: null };
  }

  const manager = getCredentialManager();
  const authType = getWorkspaceMcpAuthType(workspace);

  switch (authType) {
    case 'workspace_oauth': {
      const oauth = await manager.getWorkspaceOAuth(workspaceId);
      // Return token if found, null otherwise (no fallback to craft_oauth!)
      return { authType, token: oauth?.accessToken ?? null };
    }

    case 'workspace_bearer': {
      const bearer = await manager.getWorkspaceBearer(workspaceId);
      return { authType, token: bearer ?? null };
    }

    case 'public':
      return { authType: 'public', token: null };

    default:
      return { authType: 'public', token: null };
  }
}

/**
 * Auth status for a workspace's MCP connection.
 * Used by UI to show appropriate feedback when auth is missing.
 */
export interface WorkspaceAuthStatus {
  authType: McpAuthType;
  hasToken: boolean;
  needsAuth: boolean;
  message?: string;
}

/**
 * Check if a workspace has the required MCP authentication configured.
 * Returns status with needsAuth=true if credentials are missing.
 */
export async function checkWorkspaceAuthStatus(workspaceId: string): Promise<WorkspaceAuthStatus> {
  const config = loadStoredConfig();
  const workspace = config?.workspaces.find(w => w.id === workspaceId);

  if (!workspace) {
    return {
      authType: 'workspace_oauth',
      hasToken: false,
      needsAuth: true,
      message: 'Workspace not found'
    };
  }

  const manager = getCredentialManager();
  const authType = getWorkspaceMcpAuthType(workspace);

  switch (authType) {
    case 'workspace_oauth': {
      const oauth = await manager.getWorkspaceOAuth(workspaceId);
      const hasToken = !!oauth?.accessToken;
      return {
        authType,
        hasToken,
        needsAuth: !hasToken,
        message: hasToken ? undefined : 'MCP authentication required'
      };
    }

    case 'workspace_bearer': {
      const bearer = await manager.getWorkspaceBearer(workspaceId);
      const hasToken = !!bearer;
      return {
        authType,
        hasToken,
        needsAuth: !hasToken,
        message: hasToken ? undefined : 'Bearer token required'
      };
    }

    case 'public':
      return { authType, hasToken: true, needsAuth: false };

    default:
      return {
        authType: 'workspace_oauth',
        hasToken: false,
        needsAuth: true,
        message: 'Unknown auth configuration'
      };
  }
}


// Update OAuth tokens for a specific workspace (saves to credential store)
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

  // Save API key to credential store
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

export function setAuthType(authType: AuthType): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.authType = authType;
  saveConfig(config);
}

export function getTokenDisplay(): TokenDisplayMode {
  const config = loadStoredConfig();
  return config?.tokenDisplay || 'hidden';
}

export function setTokenDisplay(mode: TokenDisplayMode): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.tokenDisplay = mode;
  saveConfig(config);
}

export function getShowCost(): boolean {
  const config = loadStoredConfig();
  // Default to true if not set
  return config?.showCost !== false;
}

export function setShowCost(show: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.showCost = show;
  saveConfig(config);
}

export function getCumulativeUsage(): CumulativeUsage {
  const config = loadStoredConfig();
  return config?.cumulativeUsage ?? {
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    lastUpdated: 0,
  };
}

/**
 * Add to cumulative usage (called when workspace token usage changes).
 * Pass the delta (difference from previous), not the absolute values.
 */
export function addToCumulativeUsage(delta: {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}): CumulativeUsage {
  const config = loadStoredConfig();
  if (!config) {
    return getCumulativeUsage();
  }

  const current = config.cumulativeUsage ?? {
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    lastUpdated: 0,
  };

  const updated: CumulativeUsage = {
    totalCostUsd: current.totalCostUsd + delta.costUsd,
    totalInputTokens: current.totalInputTokens + delta.inputTokens,
    totalOutputTokens: current.totalOutputTokens + delta.outputTokens,
    lastUpdated: Date.now(),
  };

  config.cumulativeUsage = updated;
  saveConfig(config);
  return updated;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Clear all configuration and credentials (for logout).
 * Deletes config file and credentials file.
 */
export async function clearAllConfig(): Promise<void> {
  // Delete config file
  if (existsSync(CONFIG_FILE)) {
    rmSync(CONFIG_FILE);
  }

  // Delete credentials file
  const credentialsFile = join(CONFIG_DIR, 'credentials.enc');
  if (existsSync(credentialsFile)) {
    rmSync(credentialsFile);
  }

  // Optionally: Delete workspace data (conversations)
  const workspacesDir = join(CONFIG_DIR, 'workspaces');
  if (existsSync(workspacesDir)) {
    rmSync(workspacesDir, { recursive: true });
  }
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

/**
 * Atomically switch to a different workspace.
 * Performs a single config write with both workspace and session updates.
 *
 * This prevents race conditions where multiple saves could leave config
 * in an inconsistent state if the process crashes mid-switch.
 *
 * @returns The workspace and session to use, or null if workspace not found
 */
export function switchWorkspaceAtomic(workspaceId: string): { workspace: Workspace; session: Session } | null {
  const config = loadStoredConfig();
  if (!config) return null;

  const workspace = config.workspaces.find(w => w.id === workspaceId);
  if (!workspace) return null;

  // Get or create session for the workspace
  const sessions = listSessions(workspaceId);
  let session: Session;

  if (sessions.length > 0 && sessions[0]) {
    // Use existing session
    const latest = sessions[0];
    session = {
      id: latest.id,
      sdkSessionId: latest.sdkSessionId,
      workspaceId: latest.workspaceId,
      name: latest.name,
      createdAt: latest.createdAt,
      lastUsedAt: latest.lastUsedAt,
    };
  } else {
    // Create new session (saves session file but not config)
    const now = Date.now();
    session = {
      id: generateSessionId(),
      workspaceId,
      createdAt: now,
      lastUsedAt: now,
    };

    // Save empty session file
    const storedSession: StoredSession = {
      ...session,
      messages: [],
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        costUsd: 0,
      },
    };
    saveSession(storedSession);
  }

  // Single atomic write for both workspace and session
  config.activeWorkspaceId = workspaceId;
  config.activeSessionId = session.id;
  saveConfig(config);

  return { workspace, session };
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

  // Clean up credential store credentials for this workspace
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
  type: 'user' | 'assistant' | 'tool' | 'error' | 'status' | 'system' | 'info' | 'warning';
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

// ============================================
// Session Storage (Primary Scope)
// ============================================
// Sessions are the primary isolation boundary. Each session maps 1:1
// with a CraftAgent instance and SDK conversation.

const SESSIONS_DIR = join(CONFIG_DIR, 'sessions');

function ensureSessionsDir(): string {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
  return SESSIONS_DIR;
}

// Session token usage (reuse WorkspaceConversation structure)
export type SessionTokenUsage = WorkspaceConversation['tokenUsage'];

// Session represents a conversation scope (SDK session = our scope boundary)
export interface Session {
  id: string;                    // Our UUID (stable, known immediately)
  sdkSessionId?: string;         // SDK session ID (captured after first message)
  workspaceId: string;           // Which workspace this session belongs to
  name?: string;                 // Optional user-defined name
  createdAt: number;
  lastUsedAt: number;
}

// Stored session with conversation data
export interface StoredSession extends Session {
  messages: StoredMessage[];
  tokenUsage: SessionTokenUsage;
}

// Generate a UUID for session IDs
function generateSessionId(): string {
  return randomUUID();
}

// Create a new session for a workspace
export function createSession(workspaceId: string, name?: string): Session {
  const now = Date.now();
  const session: Session = {
    id: generateSessionId(),
    workspaceId,
    name,
    createdAt: now,
    lastUsedAt: now,
  };

  // Save empty session file
  const storedSession: StoredSession = {
    ...session,
    messages: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  };
  saveSession(storedSession);

  // Update active session in config
  const config = loadStoredConfig();
  if (config) {
    config.activeSessionId = session.id;
    saveConfig(config);
  }

  return session;
}

// Save session (conversation data + metadata)
export function saveSession(session: StoredSession): void {
  ensureSessionsDir();
  const filePath = join(SESSIONS_DIR, `${session.id}.json`);
  session.lastUsedAt = Date.now();
  writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

// Load session by ID
export function loadSession(sessionId: string): StoredSession | null {
  const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as StoredSession;
  } catch {
    return null;
  }
}

// Get session metadata (without loading full messages)
export interface SessionMetadata {
  id: string;
  workspaceId: string;
  name?: string;
  createdAt: number;
  lastUsedAt: number;
  messageCount: number;
  preview?: string;  // Preview of first user message
  sdkSessionId?: string;
}

// List sessions, optionally filtered by workspace
export function listSessions(workspaceId?: string): SessionMetadata[] {
  ensureSessionsDir();

  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  const sessions: SessionMetadata[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(SESSIONS_DIR, file), 'utf-8');
      const session = JSON.parse(content) as StoredSession;

      if (!workspaceId || session.workspaceId === workspaceId) {
        // Find first user message for preview
        const firstUserMessage = session.messages?.find(m => m.type === 'user');
        const preview = firstUserMessage?.content?.replace(/\n/g, ' ').substring(0, 100);

        sessions.push({
          id: session.id,
          workspaceId: session.workspaceId,
          name: session.name,
          createdAt: session.createdAt,
          lastUsedAt: session.lastUsedAt,
          messageCount: session.messages?.length ?? 0,
          preview,
          sdkSessionId: session.sdkSessionId,
        });
      }
    } catch {
      // Skip invalid files
    }
  }

  // Sort by lastUsedAt descending (most recent first)
  return sessions.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

// Delete session
export function deleteSession(sessionId: string): boolean {
  const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);

      // If this was the active session, clear it
      const config = loadStoredConfig();
      if (config && config.activeSessionId === sessionId) {
        config.activeSessionId = null;
        saveConfig(config);
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Get or create the latest session for a workspace
export function getOrCreateLatestSession(workspaceId: string): Session {
  const sessions = listSessions(workspaceId);
  if (sessions.length > 0 && sessions[0]) {
    // Return metadata as Session (full data loaded separately if needed)
    const latest = sessions[0];
    return {
      id: latest.id,
      sdkSessionId: latest.sdkSessionId,
      workspaceId: latest.workspaceId,
      name: latest.name,
      createdAt: latest.createdAt,
      lastUsedAt: latest.lastUsedAt,
    };
  }
  // No sessions exist - create one
  return createSession(workspaceId);
}

// Update active session ID in config
export function setActiveSession(sessionId: string | null): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.activeSessionId = sessionId;
  saveConfig(config);
}

// Get active session ID from config
export function getActiveSessionId(): string | null {
  const config = loadStoredConfig();
  return config?.activeSessionId ?? null;
}

// Update SDK session ID for a session (called after first message)
export function updateSessionSdkId(sessionId: string, sdkSessionId: string): void {
  const session = loadSession(sessionId);
  if (session) {
    session.sdkSessionId = sdkSessionId;
    saveSession(session);
  }
}

// Clean up old workspace-based conversations (replaced by session-based storage)
// Called once on startup to remove stale data
export function cleanupLegacyConversations(): void {
  try {
    if (!existsSync(WORKSPACES_DIR)) return;

    const workspaceDirs = readdirSync(WORKSPACES_DIR);
    for (const dir of workspaceDirs) {
      const conversationPath = join(WORKSPACES_DIR, dir, 'conversation.json');
      if (existsSync(conversationPath)) {
        unlinkSync(conversationPath);
      }
    }
  } catch {
    // Ignore cleanup errors - non-critical
  }
}

