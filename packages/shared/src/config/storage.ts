import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, unlinkSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getCredentialManager } from '../credentials/index.ts';
import { isOpusModel } from './models.ts';
import type { StoredAttachment } from '@craft-agent/core/types';
import type { Plan } from '../agents/plan-types.ts';

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
  showClock?: boolean;  // Whether to show clock with timezone in header
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

export function getShowClock(): boolean {
  const config = loadStoredConfig();
  // Default to false if not set
  return config?.showClock === true;
}

export function setShowClock(show: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.showClock = show;
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

// Re-export StoredAttachment for convenience (imported at top of file)
export type { StoredAttachment };

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
  /** Stored attachments for user messages (persisted to disk) */
  attachments?: StoredAttachment[];
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

  // Also clear any active plan (plans are session-scoped)
  clearWorkspacePlan(workspaceId);
}

// ============================================
// Plan Storage (Session-Scoped)
// Plans are stored per-workspace and cleared with /clear
// ============================================

/**
 * Save a plan for a workspace.
 * Plans are session-scoped - they persist during the session but are
 * cleared when the user runs /clear or starts a new session.
 */
export function saveWorkspacePlan(workspaceId: string, plan: Plan): void {
  const dir = ensureWorkspaceDir(workspaceId);
  const filePath = join(dir, 'plan.json');
  writeFileSync(filePath, JSON.stringify(plan, null, 2), 'utf-8');
}

/**
 * Load the current plan for a workspace.
 * Returns null if no plan exists.
 */
export function loadWorkspacePlan(workspaceId: string): Plan | null {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'plan.json');

  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Plan;
  } catch {
    return null;
  }
}

/**
 * Clear the plan for a workspace.
 * Called when user runs /clear or cancels a plan.
 */
export function clearWorkspacePlan(workspaceId: string): void {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'plan.json');
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}

// ============================================
// Plan File Storage (Session-scoped)
// ============================================
// Plans are stored as markdown files in ~/.craft-agent/sessions/{sessionId}/plans/
// with descriptive names based on plan title for display in GUI.

/**
 * Get the plans directory for a session.
 * Structure: ~/.craft-agent/sessions/{sessionId}/plans/
 */
function getSessionPlansDir(sessionId: string): string {
  return join(CONFIG_DIR, 'sessions', sessionId, 'plans');
}

/**
 * Generate a plan file name from the plan title.
 * Keeps spaces for readability in GUI, sanitizes dangerous filesystem characters.
 * Includes ==PLAN== prefix for clear identification in file lists.
 * Adds timestamp suffix to ensure uniqueness.
 */
function generatePlanFileName(plan: Plan): string {
  // Start with title or fallback
  let name = plan.title || plan.context?.substring(0, 50) || 'Untitled';

  // Remove or replace dangerous filesystem characters
  // Keep: letters, numbers, spaces, hyphens, underscores
  // Remove: / \ : * ? " < > | and control characters
  name = name
    .replace(/[/\\:*?"<>|]/g, '')  // Remove dangerous chars
    .replace(/[\x00-\x1f\x7f]/g, '')  // Remove control chars
    .replace(/\s+/g, ' ')  // Normalize multiple spaces to single
    .trim();

  // Truncate if too long (max 50 chars for the base name)
  if (name.length > 50) {
    name = name.substring(0, 50).trim();
  }

  // Add timestamp for uniqueness (format: YYYYMMDD-HHmmss)
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .substring(0, 15);  // YYYYMMDD-HHmmss

  return `==PLAN== ${name} (${timestamp})`;
}

/**
 * Ensure the plans directory exists for a session
 */
function ensurePlansDir(sessionId: string): string {
  const plansDir = getSessionPlansDir(sessionId);
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
  }
  return plansDir;
}

/**
 * Format a plan as markdown for file storage
 */
export function formatPlanAsMarkdown(plan: Plan): string {
  const lines: string[] = [];

  lines.push(`# ${plan.title}`);
  lines.push('');
  lines.push(`**Status:** ${plan.state}`);
  lines.push(`**Created:** ${new Date(plan.createdAt).toISOString()}`);
  if (plan.updatedAt !== plan.createdAt) {
    lines.push(`**Updated:** ${new Date(plan.updatedAt).toISOString()}`);
  }
  lines.push('');

  if (plan.context) {
    lines.push('## Summary');
    lines.push('');
    lines.push(plan.context);
    lines.push('');
  }

  lines.push('## Steps');
  lines.push('');
  for (const step of plan.steps) {
    const checkbox = step.status === 'completed' ? '[x]' : '[ ]';
    const status = step.status === 'in_progress' ? ' *(in progress)*' : '';
    lines.push(`- ${checkbox} ${step.description}${status}`);
    if (step.details) {
      lines.push(`  - Tools: ${step.details}`);
    }
  }
  lines.push('');

  if (plan.refinementHistory && plan.refinementHistory.length > 0) {
    lines.push('## Refinement History');
    lines.push('');
    for (const entry of plan.refinementHistory) {
      lines.push(`### Round ${entry.round}`);
      lines.push(`**Feedback:** ${entry.feedback}`);
      if (entry.questions && entry.questions.length > 0) {
        lines.push(`**Questions:** ${entry.questions.join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Parse a markdown plan file back to a Plan object.
 * Note: This is a best-effort parse; some metadata may be lost.
 */
export function parsePlanFromMarkdown(content: string, planId: string): Plan | null {
  try {
    const lines = content.split('\n');

    // Extract title (first # heading)
    const titleLine = lines.find(l => l.startsWith('# '));
    const title = titleLine ? titleLine.substring(2).trim() : 'Untitled Plan';

    // Extract status
    const statusLine = lines.find(l => l.startsWith('**Status:**'));
    const stateStr = statusLine ? statusLine.replace('**Status:**', '').trim() : 'ready';
    const state = (['creating', 'refining', 'ready', 'executing', 'completed', 'cancelled'].includes(stateStr)
      ? stateStr
      : 'ready') as Plan['state'];

    // Extract summary
    const summaryIdx = lines.findIndex(l => l === '## Summary');
    const stepsIdx = lines.findIndex(l => l === '## Steps');
    let context = '';
    if (summaryIdx !== -1 && stepsIdx !== -1) {
      context = lines.slice(summaryIdx + 2, stepsIdx).join('\n').trim();
    }

    // Extract steps
    const steps: Plan['steps'] = [];
    if (stepsIdx !== -1) {
      for (let i = stepsIdx + 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.startsWith('##')) break;
        if (line.startsWith('- [')) {
          const isCompleted = line.startsWith('- [x]');
          const isInProgress = line.includes('*(in progress)*');
          const description = line
            .replace(/^- \[[ x]\] /, '')
            .replace(' *(in progress)*', '')
            .trim();
          steps.push({
            id: `step-${steps.length + 1}`,
            description,
            status: isCompleted ? 'completed' : isInProgress ? 'in_progress' : 'pending',
          });
        }
      }
    }

    return {
      id: planId,
      title,
      state,
      context,
      steps,
      refinementRound: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Save a plan to a markdown file within a session's plans directory.
 * Returns the file path.
 *
 * If fileName is not provided, generates a descriptive name from the plan title.
 * File names include spaces for readability in GUI attachments.
 */
export function savePlanToFile(sessionId: string, plan: Plan, fileName?: string): string {
  const plansDir = ensurePlansDir(sessionId);

  const name = fileName || generatePlanFileName(plan);
  const filePath = join(plansDir, `${name}.md`);
  const content = formatPlanAsMarkdown(plan);

  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Load a plan from a markdown file by name (without .md extension).
 */
export function loadPlanFromFile(sessionId: string, fileName: string): Plan | null {
  const plansDir = getSessionPlansDir(sessionId);
  const filePath = join(plansDir, `${fileName}.md`);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return parsePlanFromMarkdown(content, fileName);
  } catch {
    return null;
  }
}

/**
 * Load a plan from a full file path.
 */
export function loadPlanFromPath(filePath: string): Plan | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const fileName = filePath.split('/').pop()?.replace('.md', '') || 'unknown';
    return parsePlanFromMarkdown(content, fileName);
  } catch {
    return null;
  }
}

/**
 * List all plan files in a session's plans directory.
 * Returns array of { name, path, modifiedAt }.
 */
export function listPlanFiles(sessionId: string): Array<{ name: string; path: string; modifiedAt: number }> {
  const plansDir = ensurePlansDir(sessionId);

  try {
    const files = readdirSync(plansDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const filePath = join(plansDir, f);
        const stats = existsSync(filePath) ? statSync(filePath) : null;
        return {
          name: f.replace('.md', ''),
          path: filePath,
          modifiedAt: stats?.mtimeMs || 0,
        };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt);

    return files;
  } catch {
    return [];
  }
}

/**
 * Delete a plan file by name within a session.
 */
export function deletePlanFile(sessionId: string, fileName: string): boolean {
  const plansDir = getSessionPlansDir(sessionId);
  const filePath = join(plansDir, `${fileName}.md`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Get the most recent plan file for a session (for resuming).
 */
export function getMostRecentPlanFile(sessionId: string): { name: string; path: string } | null {
  const files = listPlanFiles(sessionId);
  return files.length > 0 ? files[0]! : null;
}

/**
 * Get the plans directory path for a session.
 */
export function getPlansDir(sessionId: string): string {
  return ensurePlansDir(sessionId);
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

/**
 * Get the attachments directory path for a session.
 * Files are stored at: ~/.craft-agent/sessions/{sessionId}/attachments/
 */
export function getSessionAttachmentsPath(sessionId: string): string {
  return join(SESSIONS_DIR, sessionId, 'attachments');
}

/**
 * Get the config directory path (~/.craft-agent)
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
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
  // Inbox/Archive/Agent features
  agentId?: string;              // Assigned agent ID (for filtering)
  agentName?: string;            // Cached agent name for display
  isArchived?: boolean;          // Whether this session is archived
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

// Get or create a session with a specific ID
// Used for --session <id> flag to allow user-defined session IDs
export function getOrCreateSessionById(sessionId: string, workspaceId: string): Session {
  // Try to load existing session
  const existing = loadSession(sessionId);
  if (existing) {
    return {
      id: existing.id,
      sdkSessionId: existing.sdkSessionId,
      workspaceId: existing.workspaceId,
      name: existing.name,
      createdAt: existing.createdAt,
      lastUsedAt: existing.lastUsedAt,
    };
  }

  // Create new session with the specified ID
  const now = Date.now();
  const session: Session = {
    id: sessionId,
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
  // Inbox/Archive/Agent features
  agentId?: string;        // Assigned agent ID (for filtering)
  agentName?: string;      // Cached agent name for display (e.g., "work/coder")
  isArchived?: boolean;    // Whether this session is archived
  agents?: string[];  // Distinct agent names used in this session
  planCount?: number;  // Number of plan files for this session
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
        const preview = firstUserMessage?.content?.replace(/\n/g, ' ').substring(0, 150);

        // Extract distinct agent names from "Now chatting with @<name>" messages
        const agentPattern = /Now chatting with @(\S+)/g;
        const agents = new Set<string>();
        for (const msg of session.messages ?? []) {
          if (msg.content) {
            let match;
            while ((match = agentPattern.exec(msg.content)) !== null) {
              if (match[1]) {
                agents.add(match[1]);
              }
            }
          }
        }

        // Count plan files for this session
        const planCount = listPlanFiles(session.id).length;

        sessions.push({
          id: session.id,
          workspaceId: session.workspaceId,
          name: session.name,
          createdAt: session.createdAt,
          lastUsedAt: session.lastUsedAt,
          messageCount: session.messages?.length ?? 0,
          preview,
          sdkSessionId: session.sdkSessionId,
          agentId: session.agentId,
          agentName: session.agentName,
          isArchived: session.isArchived,
          agents: agents.size > 0 ? Array.from(agents) : undefined,
          planCount: planCount > 0 ? planCount : undefined,
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

// Update session metadata (agentId, agentName, isArchived, name)
export function updateSessionMetadata(
  sessionId: string,
  updates: Partial<Pick<Session, 'agentId' | 'agentName' | 'isArchived' | 'name'>>
): void {
  const session = loadSession(sessionId);
  if (session) {
    if (updates.agentId !== undefined) session.agentId = updates.agentId;
    if (updates.agentName !== undefined) session.agentName = updates.agentName;
    if (updates.isArchived !== undefined) session.isArchived = updates.isArchived;
    if (updates.name !== undefined) session.name = updates.name;
    saveSession(session);
  }
}

// Archive a session
export function archiveSession(sessionId: string): void {
  updateSessionMetadata(sessionId, { isArchived: true });
}

// Unarchive a session
export function unarchiveSession(sessionId: string): void {
  updateSessionMetadata(sessionId, { isArchived: false });
}

// Assign agent to a session
export function assignAgentToSession(sessionId: string, agentId: string, agentName?: string): void {
  updateSessionMetadata(sessionId, { agentId, agentName });
}

// List archived sessions for a workspace
export function listArchivedSessions(workspaceId?: string): SessionMetadata[] {
  return listSessions(workspaceId).filter(s => s.isArchived === true);
}

// List non-archived sessions (inbox) for a workspace
export function listInboxSessions(workspaceId?: string): SessionMetadata[] {
  return listSessions(workspaceId).filter(s => !s.isArchived);
}

// List sessions by agent for a workspace
export function listSessionsByAgent(workspaceId: string, agentId: string): SessionMetadata[] {
  return listSessions(workspaceId).filter(s => s.agentId === agentId);
}

/**
 * Clear all messages and token usage from a session.
 * Used by /clear command to reset conversation without creating a new session.
 * Preserves session ID and metadata, clears conversation data and SDK session.
 */
export function clearSessionMessages(sessionId: string): boolean {
  const session = loadSession(sessionId);
  if (!session) return false;

  session.messages = [];
  session.tokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    contextTokens: 0,
    costUsd: 0,
  };
  // Clear SDK session ID so next message starts fresh conversation with Claude
  session.sdkSessionId = undefined;

  saveSession(session);
  return true;
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

