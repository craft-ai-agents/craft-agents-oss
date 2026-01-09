import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getCredentialManager } from '../credentials/index.ts';
import { isOpusModel } from './models.ts';
import { getOrCreateLatestSession, type SessionConfig } from '../sessions/index.ts';
import {
  discoverWorkspacesInDefaultLocation,
  loadWorkspaceConfig,
  createWorkspaceAtPath,
  isValidWorkspace,
} from '../workspaces/storage.ts';
import { findIconInDir } from '../sources/storage.ts';
import { initializeDocs } from '../docs/index.ts';
import { expandPath, toPortablePath } from '../utils/paths.ts';
import type { StoredAttachment } from '@craft-agent/core/types';
import type { Plan } from '../agents/plan-types.ts';
import type { PermissionMode } from '../agent/mode-manager.ts';

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
  name: string;            // Read from workspace folder config (not stored in global config)
  rootPath: string;        // Absolute path to workspace folder (e.g., ~/Projects/my-app/craft-agent)
  createdAt: number;
  lastAccessedAt?: number; // For sorting recent workspaces
  iconUrl?: string;
  mcpUrl?: string;
  mcpAuthType?: McpAuthType;
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
  // New session defaults
  defaultPermissionMode?: PermissionMode;  // Default permission mode for new sessions ('safe', 'ask', 'allow-all')
  // Note: defaultWorkingDirectory is stored per-workspace in workspace config.json, not here
  // Notifications
  notificationsEnabled?: boolean;  // Desktop notifications for task completion (default: true)
}

const CONFIG_DIR = join(homedir(), '.craft-agent');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  // Initialize bundled docs (creates ~/.craft-agent/docs/ with sources.md, agents.md, permissions.md)
  initializeDocs();
}

export function loadStoredConfig(): StoredConfig | null {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return null;
    }
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content) as StoredConfig;

    // Must have workspaces array
    if (!Array.isArray(config.workspaces)) {
      return null;
    }

    // Expand path variables (~ and ${HOME}) for portability
    for (const workspace of config.workspaces) {
      workspace.rootPath = expandPath(workspace.rootPath);
    }

    // Validate active workspace exists
    const activeWorkspace = config.workspaces.find(w => w.id === config.activeWorkspaceId);
    if (!activeWorkspace) {
      // Default to first workspace
      config.activeWorkspaceId = config.workspaces[0]?.id || null;
    }

    // Ensure workspace folder structure exists for all workspaces
    for (const workspace of config.workspaces) {
      if (!isValidWorkspace(workspace.rootPath)) {
        createWorkspaceAtPath(workspace.rootPath, workspace.name);
      }
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

  // Convert paths to portable form (~ prefix) for cross-machine compatibility
  const storageConfig: StoredConfig = {
    ...config,
    workspaces: config.workspaces.map(ws => ({
      ...ws,
      rootPath: toPortablePath(ws.rootPath),
    })),
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(storageConfig, null, 2), 'utf-8');
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

/**
 * Get the default permission mode for new sessions.
 * Defaults to 'safe' if not set.
 */
export function getDefaultPermissionMode(): PermissionMode {
  const config = loadStoredConfig();
  return config?.defaultPermissionMode ?? 'ask';
}

/**
 * Set the default permission mode for new sessions.
 */
export function setDefaultPermissionMode(mode: PermissionMode): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.defaultPermissionMode = mode;
  saveConfig(config);
}

/**
 * Get whether desktop notifications are enabled.
 * Defaults to true if not set.
 */
export function getNotificationsEnabled(): boolean {
  const config = loadStoredConfig();
  return config?.notificationsEnabled !== false; // Default to true
}

/**
 * Set whether desktop notifications are enabled.
 */
export function setNotificationsEnabled(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.notificationsEnabled = enabled;
  saveConfig(config);
}

// Note: getDefaultWorkingDirectory/setDefaultWorkingDirectory removed
// Working directory is now stored per-workspace in workspace config.json (defaults.workingDirectory)

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

/**
 * Find workspace icon file at workspace_root/icon.*
 * Returns absolute path to icon file if found, null otherwise
 */
export function findWorkspaceIcon(rootPath: string): string | null {
  return findIconInDir(rootPath);
}

export function getWorkspaces(): Workspace[] {
  const config = loadStoredConfig();
  const workspaces = config?.workspaces || [];

  // Resolve workspace names from folder config and local icons
  return workspaces.map(w => {
    // Read name from workspace folder config (single source of truth)
    const wsConfig = loadWorkspaceConfig(w.rootPath);
    const name = wsConfig?.name || w.rootPath.split('/').pop() || 'Untitled';

    // If workspace has a stored iconUrl that's a remote URL, use it
    // Otherwise check for local icon file
    let iconUrl = w.iconUrl;
    if (!iconUrl || (!iconUrl.startsWith('http://') && !iconUrl.startsWith('https://'))) {
      const localIcon = findWorkspaceIcon(w.rootPath);
      if (localIcon) {
        // Convert absolute path to file:// URL for Electron renderer
        // Append mtime as cache-buster so UI refreshes when icon changes
        try {
          const mtime = statSync(localIcon).mtimeMs;
          iconUrl = `file://${localIcon}?t=${mtime}`;
        } catch {
          iconUrl = `file://${localIcon}`;
        }
      }
    }

    return { ...w, name, iconUrl };
  });
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

  // Get or create the latest session for this workspace
  const session = getOrCreateLatestSession(workspace.rootPath);

  // Update active workspace in config
  config.activeWorkspaceId = workspaceId;
  workspace.lastAccessedAt = Date.now();
  saveConfig(config);

  return { workspace, session };
}

/**
 * Add a workspace to the global config.
 * @param workspace - Workspace data (must include rootPath)
 */
export function addWorkspace(workspace: Omit<Workspace, 'id' | 'createdAt'>): Workspace {
  const config = loadStoredConfig();
  if (!config) {
    throw new Error('No config found');
  }

  // Check if workspace with same rootPath already exists
  const existing = config.workspaces.find(w => w.rootPath === workspace.rootPath);
  if (existing) {
    // Update existing workspace with new settings
    const updated: Workspace = {
      ...existing,
      ...workspace,
      id: existing.id,
      createdAt: existing.createdAt,
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

  // Create workspace folder structure if it doesn't exist
  if (!isValidWorkspace(newWorkspace.rootPath)) {
    createWorkspaceAtPath(newWorkspace.rootPath, newWorkspace.name);
  }

  config.workspaces.push(newWorkspace);

  // If this is the only workspace, make it active
  if (config.workspaces.length === 1) {
    config.activeWorkspaceId = newWorkspace.id;
  }

  saveConfig(config);
  return newWorkspace;
}

/**
 * Sync workspaces by discovering workspaces in the default location
 * that aren't already tracked in the global config.
 * Call this on app startup.
 */
export function syncWorkspaces(): void {
  const config = loadStoredConfig();
  if (!config) return;

  const discoveredPaths = discoverWorkspacesInDefaultLocation();
  const trackedPaths = new Set(config.workspaces.map(w => w.rootPath));

  let added = false;
  for (const rootPath of discoveredPaths) {
    if (trackedPaths.has(rootPath)) continue;

    // Load the workspace config to get name
    const wsConfig = loadWorkspaceConfig(rootPath);
    if (!wsConfig) continue;

    const newWorkspace: Workspace = {
      id: wsConfig.id || generateWorkspaceId(),
      name: wsConfig.name,
      rootPath,
      createdAt: wsConfig.createdAt || Date.now(),
    };

    config.workspaces.push(newWorkspace);
    added = true;
  }

  if (added) {
    // If no active workspace, set to first
    if (!config.activeWorkspaceId && config.workspaces.length > 0) {
      config.activeWorkspaceId = config.workspaces[0]!.id;
    }
    saveConfig(config);
  }
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

// Note: renameWorkspace() was removed - workspace names are now stored only in folder config
// Use updateWorkspaceSetting('name', ...) to rename workspaces via the folder config

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

  try {
    writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
  } catch (e) {
    // Handle cyclic structures or other serialization errors
    console.error(`[storage] [CYCLIC STRUCTURE] Failed to save workspace conversation:`, e);
    console.error(`[storage] Message count: ${messages.length}, message types: ${messages.map(m => m.type).join(', ')}`);
    // Try to save with sanitized messages
    try {
      const sanitizedMessages = messages.map((m, i) => {
        let safeToolInput = m.toolInput;
        if (m.toolInput) {
          try {
            JSON.stringify(m.toolInput);
          } catch (inputErr) {
            console.error(`[storage] [CYCLIC STRUCTURE] in message ${i} toolInput (tool: ${m.toolName}), keys: ${Object.keys(m.toolInput).join(', ')}, error: ${inputErr}`);
            safeToolInput = { error: '[non-serializable input]' };
          }
        }
        return { ...m, toolInput: safeToolInput };
      });
      const sanitizedConversation: WorkspaceConversation = {
        messages: sanitizedMessages,
        tokenUsage,
        savedAt: Date.now(),
      };
      writeFileSync(filePath, JSON.stringify(sanitizedConversation, null, 2), 'utf-8');
      console.error(`[storage] Saved sanitized workspace conversation successfully`);
    } catch (e2) {
      console.error(`[storage] Failed to save even sanitized workspace conversation:`, e2);
    }
  }
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

// ============================================
// Theme Storage (Cascading: app → workspace → agent)
// ============================================

import type { ThemeOverrides } from './theme.ts';

const APP_THEME_FILE = join(CONFIG_DIR, 'theme.json');

/**
 * Load app-level theme overrides
 */
export function loadAppTheme(): ThemeOverrides | null {
  try {
    if (!existsSync(APP_THEME_FILE)) {
      return null;
    }
    const content = readFileSync(APP_THEME_FILE, 'utf-8');
    return JSON.parse(content) as ThemeOverrides;
  } catch {
    return null;
  }
}

/**
 * Save app-level theme overrides
 */
export function saveAppTheme(theme: ThemeOverrides): void {
  ensureConfigDir();
  writeFileSync(APP_THEME_FILE, JSON.stringify(theme, null, 2), 'utf-8');
}

/**
 * Load workspace-level theme overrides
 */
export function loadWorkspaceTheme(workspaceRootPath: string): ThemeOverrides | null {
  try {
    const themePath = join(workspaceRootPath, 'theme.json');
    if (!existsSync(themePath)) {
      return null;
    }
    const content = readFileSync(themePath, 'utf-8');
    return JSON.parse(content) as ThemeOverrides;
  } catch {
    return null;
  }
}

/**
 * Save workspace-level theme overrides
 */
export function saveWorkspaceTheme(workspaceRootPath: string, theme: ThemeOverrides): void {
  const themePath = join(workspaceRootPath, 'theme.json');
  writeFileSync(themePath, JSON.stringify(theme, null, 2), 'utf-8');
}

/**
 * Load agent-level theme overrides
 */
export function loadAgentTheme(workspaceRootPath: string, agentSlug: string): ThemeOverrides | null {
  try {
    const themePath = join(workspaceRootPath, 'agents', agentSlug, 'theme.json');
    if (!existsSync(themePath)) {
      return null;
    }
    const content = readFileSync(themePath, 'utf-8');
    return JSON.parse(content) as ThemeOverrides;
  } catch {
    return null;
  }
}

/**
 * Save agent-level theme overrides
 */
export function saveAgentTheme(workspaceRootPath: string, agentSlug: string, theme: ThemeOverrides): void {
  const agentDir = join(workspaceRootPath, 'agents', agentSlug);
  if (!existsSync(agentDir)) {
    mkdirSync(agentDir, { recursive: true });
  }
  const themePath = join(agentDir, 'theme.json');
  writeFileSync(themePath, JSON.stringify(theme, null, 2), 'utf-8');
}
