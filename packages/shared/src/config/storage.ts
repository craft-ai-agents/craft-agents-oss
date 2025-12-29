import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getCredentialManager } from '../credentials/index.ts';
import { isOpusModel } from './models.ts';
import { getOrCreateLatestSession, type SessionConfig } from '../sessions/index.ts';
import type { StoredAttachment } from '@craft-agent/core/types';
import type { Plan } from '../agents/plan-types.ts';
import type { Mode } from '../agent/mode-manager.ts';

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

// How MCP server should be authenticated
export type McpAuthType = 'workspace_oauth' | 'workspace_bearer' | 'public';

export interface Workspace {
  id: string;
  name: string;
  slug?: string;           // URL-safe folder name for workspace-scoped storage (defaults to id if not set)
  createdAt: number;
  sessionId?: string;      // SDK session ID for conversation continuity
  iconUrl?: string;        // Space icon URL from Craft profile
  mcpUrl?: string;         // MCP server URL for this workspace
  mcpAuthType?: McpAuthType;  // How the MCP server authenticates (defaults to workspace_oauth)
}

/**
 * Get the workspace slug (folder name) from a workspace.
 * Falls back to the workspace id if no slug is set.
 */
export function getWorkspaceSlug(workspace: Workspace): string {
  return workspace.slug || workspace.id;
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
  // New session defaults
  defaultModes?: Mode[];  // Modes enabled by default for new sessions (e.g., ['safe'])
  defaultSkipPermissions?: boolean;  // Whether new sessions auto-approve permissions (default: false)
  defaultWorkingDirectory?: string;  // Default working directory for new sessions
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

export function getModel(): string | null {
  const config = loadStoredConfig();
  return config?.model ?? null;
}

export function setModel(model: string): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.model = model;
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

// New session defaults getters/setters

export function getDefaultModes(): Mode[] {
  const config = loadStoredConfig();
  // Backward compatibility: if old defaultSafeMode exists, convert it
  if (config?.defaultModes === undefined && (config as { defaultSafeMode?: boolean })?.defaultSafeMode) {
    return ['safe'];
  }
  return config?.defaultModes ?? [];
}

export function setDefaultModes(modes: Mode[]): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.defaultModes = modes;
  saveConfig(config);
}

export function getDefaultSkipPermissions(): boolean {
  const config = loadStoredConfig();
  return config?.defaultSkipPermissions ?? false;
}

export function setDefaultSkipPermissions(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.defaultSkipPermissions = enabled;
  saveConfig(config);
}

export function getDefaultWorkingDirectory(): string {
  const config = loadStoredConfig();
  return config?.defaultWorkingDirectory ?? homedir();
}

export function setDefaultWorkingDirectory(path: string): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.defaultWorkingDirectory = path;
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

/**
 * Generate a unique workspace ID.
 * Uses a random UUID-like format.
 */
export function generateWorkspaceId(): string {
  // Generate random bytes and format as UUID-like string (8-4-4-4-12)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
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
 * Atomically switch to a workspace and load/create a session.
 * This prevents race conditions by doing both operations together.
 *
 * @param workspaceId The ID of the workspace to switch to
 * @returns The workspace and session, or null if workspace not found
 */
export function switchWorkspaceAtomic(workspaceId: string): { workspace: Workspace; session: SessionConfig } | null {
  const config = loadStoredConfig();
  if (!config) return null;

  const workspace = config.workspaces.find(w => w.id === workspaceId);
  if (!workspace) return null;

  // Get the workspace slug for session storage
  const workspaceSlug = getWorkspaceSlug(workspace);

  // Get or create the latest session for this workspace
  const session = getOrCreateLatestSession(workspaceSlug);

  // Update active workspace in config
  config.activeWorkspaceId = workspaceId;
  saveConfig(config);

  return { workspace, session };
}

export function addWorkspace(workspace: Omit<Workspace, 'id' | 'createdAt'>): Workspace {
  const config = loadStoredConfig();
  if (!config) {
    throw new Error('No config found');
  }

  // Check if workspace with same name already exists
  const existing = config.workspaces.find(w =>
    w.name.toLowerCase() === workspace.name.toLowerCase()
  );
  if (existing) {
    // Update existing workspace with new settings
    const updated: Workspace = {
      ...existing,
      ...workspace,
      id: existing.id,
      createdAt: existing.createdAt, // Preserve original creation time
    };
    const existingIndex = config.workspaces.indexOf(existing);
    config.workspaces[existingIndex] = updated;
    saveConfig(config);
    return updated;
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
  type: 'user' | 'assistant' | 'tool' | 'error' | 'status' | 'system' | 'info' | 'warning' | 'plan';
  content: string;
  timestamp?: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolStatus?: 'pending' | 'executing' | 'completed' | 'error';
  toolDuration?: number;
  /** Tool intent description (from MCP _intent field) */
  toolIntent?: string;
  isError?: boolean;
  /** Stored attachments for user messages (persisted to disk) */
  attachments?: StoredAttachment[];
  /** Tool use ID for deduplication (SDK sends duplicate tool_start events) */
  toolUseId?: string;
  /** Tool result content (for tool messages) */
  toolResult?: string;
  /** Parent tool use ID for nested tool calls (e.g., child tools inside Task subagent) */
  parentToolUseId?: string;
  /** Whether this is an intermediate assistant message (commentary between tool calls) */
  isIntermediate?: boolean;
  /** Turn ID for grouping messages in TurnCard after reload */
  turnId?: string;
  /** Error display fields for typed errors */
  errorCode?: string;
  errorTitle?: string;
  errorDetails?: string[];
  errorOriginal?: string;
  errorCanRetry?: boolean;
  /** Whether this user message was sent with ultrathink (extended thinking) enabled */
  ultrathink?: boolean;
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
// Session Input Drafts
// Persists input text per session across app restarts
// ============================================

const DRAFTS_FILE = join(CONFIG_DIR, 'drafts.json');

interface DraftsData {
  drafts: Record<string, string>;
  updatedAt: number;
}

/**
 * Load all drafts from disk
 */
function loadDraftsData(): DraftsData {
  try {
    if (!existsSync(DRAFTS_FILE)) {
      return { drafts: {}, updatedAt: 0 };
    }
    const content = readFileSync(DRAFTS_FILE, 'utf-8');
    return JSON.parse(content) as DraftsData;
  } catch {
    return { drafts: {}, updatedAt: 0 };
  }
}

/**
 * Save drafts to disk
 */
function saveDraftsData(data: DraftsData): void {
  ensureConfigDir();
  data.updatedAt = Date.now();
  writeFileSync(DRAFTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Get draft text for a session
 */
export function getSessionDraft(sessionId: string): string | null {
  const data = loadDraftsData();
  return data.drafts[sessionId] ?? null;
}

/**
 * Set draft text for a session
 * Pass empty string to clear the draft
 */
export function setSessionDraft(sessionId: string, text: string): void {
  const data = loadDraftsData();
  if (text) {
    data.drafts[sessionId] = text;
  } else {
    delete data.drafts[sessionId];
  }
  saveDraftsData(data);
}

/**
 * Delete draft for a session
 */
export function deleteSessionDraft(sessionId: string): void {
  const data = loadDraftsData();
  delete data.drafts[sessionId];
  saveDraftsData(data);
}

/**
 * Get all drafts as a record
 */
export function getAllSessionDrafts(): Record<string, string> {
  const data = loadDraftsData();
  return data.drafts;
}
