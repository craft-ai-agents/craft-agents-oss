import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname, basename } from 'path';
import { getCredentialManager } from '../credentials/index.ts';
import {
  deleteSession,
  generateSessionId,
  getOrCreateLatestSession,
  getOrCreateSessionById,
  listActiveSessions,
  type SessionConfig,
} from '../sessions/index.ts';
import {
  discoverWorkspacesInDefaultLocation,
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  createWorkspaceAtPath,
  normalizeWorkspaceAuthority,
  type WorkspaceCreationIdentity,
} from '../workspaces/storage.ts';
import {
  isCurrentLocalOrganizationMember,
  requireCurrentLocalOrganizationMembership,
} from '../orgs/storage.ts';
import { findIconFile } from '../utils/icon.ts';
import { extractWorkspaceSlugFromPath } from '../utils/workspace-slug.ts';
import { initializeDocs } from '../docs/index.ts';
import { expandPath, toPortablePath, getBundledAssetsDir } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';
import { CONFIG_DIR } from './paths.ts';
import type { StoredAttachment, StoredMessage } from '@craft-agent/core/types';
import type { Plan } from '../agent/plan-types.ts';
import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';
import { isValidThinkingLevel, normalizeThinkingLevel } from '../agent/thinking-levels.ts';
import { parsePermissionMode, PERMISSION_MODE_ORDER } from '../agent/mode-types.ts';
import { type ConfigDefaults } from './config-defaults-schema.ts';
import { isValidThemeFile } from './validators.ts';
import { isToolName } from '../toolchain/types.ts';
import type { ToolName } from '../toolchain/types.ts';
import type { WorkspaceConfig } from '../workspaces/types.ts';

// Re-export CONFIG_DIR for convenience (centralized in paths.ts)
export { CONFIG_DIR } from './paths.ts';

// Re-export base types from core (single source of truth)
export type {
  WorkspaceInfo,
  Workspace,
  McpAuthType,
  AuthType,
  OAuthCredentials,
} from '@craft-agent/core/types';

// Import for local use
import type { Workspace, AuthType, RemoteServerConfig } from '@craft-agent/core/types';
import { normalizeRemoteTlsTrust } from './remote-tls-trust.ts';

// Import LLM connection types and constants
import type { LlmConnection } from './llm-connections.ts';
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from '../memory/types.ts';
import { isValidProviderAuthCombination, getDefaultModelsForConnection, getDefaultModelForConnection, isPiProvider, toBedrockNativeId, type LlmProviderType } from './llm-connections.ts';
import {
  getModelProvider,
  getModelById,
  getModelDisplayName,
  normalizeDeprecatedModelId,
  type ModelDefinition,
} from './models.ts';

// Config stored in JSON file (credentials stored in encrypted file, not here)
export interface StoredConfig {
  // Cloud Runs (PRD docs/cloud-runs-prd.md). Token lives in <configDir>/cloud-runs.env, not here.
  cloudRuns?: {
    enabled?: boolean;
    provider?: 'local' | 'cloudflare' | 'modal' | 'e2b';
    gatewayUrl?: string;
    defaultMaxWallClockSec?: number;
    defaultMaxLlmTokens?: number;
    defaultMaxArtifactsBytes?: number;
    notifyWebhookUrl?: string;  // optional outbound POST on run completion (see server-core watcher)
    cheapModelId?: string;      // F6: draft subtasks (landscape/alternatives) on cheap model
    personas?: boolean;         // F22: default on/off for persona-expanded runs
  };
  // LLM Connections (authoritative source for auth and model config)
  llmConnections?: LlmConnection[];
  defaultLlmConnection?: string;  // Slug of default connection for new sessions
  defaultThinkingLevel?: ThinkingLevel;  // App-level default thinking level for new sessions

  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;  // Currently active session (primary scope)
  // Notifications
  notificationsEnabled?: boolean;  // Desktop notifications for task completion (default: true)
  // Appearance
  colorTheme?: string;  // ID of selected preset theme (e.g., 'dracula', 'nord'). Default: 'default'
  defaultZoomLevel?: number;  // Default app zoom percentage (50-150, default: 90)
  // Auto-update
  dismissedUpdateVersion?: string;  // Version that user dismissed (skip notifications for this version)
  // Input settings
  autoCapitalisation?: boolean;  // Auto-capitalize first letter when typing (default: true)
  sendMessageKey?: 'enter' | 'cmd-enter';  // Key to send messages (default: 'enter')
  spellCheck?: boolean;  // Enable spell check in input (default: false)
  // Power settings
  keepAwakeWhileRunning?: boolean;  // Prevent screen sleep while sessions are running (default: false)
  // Tool metadata
  richToolDescriptions?: boolean;  // Add intent/action metadata to all tool calls (default: true)
  // Tools
  browserToolEnabled?: boolean;  // Enable built-in browser tool (default: true). Disable for Playwright/Puppeteer.
  allowRemoteEvaluate?: boolean;  // Allow remote agents to call `browser_tool evaluate` on local browser (default: true).
  // Prompt caching & context
  extendedPromptCache?: boolean;  // Use 1h prompt cache TTL instead of 5m (default: false)
  enable1MContext?: boolean;  // Enable 1M context window for supported models (default: false — opt-in; requires Anthropic Tier 4+)
  // Token optimization
  rtkEnabled?: boolean;  // Route Bash commands through rtk to compress tool output (default: false). https://github.com/rtk-ai/rtk
  // Self-learning memory (distillation triggers). Missing keys fall back to DEFAULT_MEMORY_CONFIG.
  memory?: {
    enabled?: boolean;           // master switch (default: true)
    distillIdleHours?: number;   // idle hours before full distillation (default: 3)
    distillMsgCount?: number;    // messages between lightweight distillations (default: 30)
    negativeFirst?: boolean;     // distill prompts prefer negative/MUST-NOT lesson formulations (default: true)
    redactExtraPatterns?: string[]; // extra literal strings masked by redactSecrets (project names, paths, …), case-insensitive (default: [])
    ftsLimit?: number;           // top-K results from memory FTS queries (default: 20)
    semantic?: boolean;          // M2: semantic (episodic) memory via local embeddings model, lazy-downloaded to {configDir}/models (default: false)
  };
  // Skills pipeline switches.
  skills?: {
    autoCreateFromSessions?: boolean;  // gate skill candidates produced by distillation (default: false — candidates are dropped)
  };
  // Bundled skill packs (runtime-context-marketplace §0.1). Slugs of packs from
  // apps/electron/resources/skills/ that should be skipped by ensureBundledSkills().
  bundledSkills?: {
    disabled?: string[];
  };
  // Toolchain manager: имена default-on инструментов (ToolName), которые ensureAll
  // пропускает (UI-переключатель, канал toolchain:setDisabled). core/opt-in не затрагиваются.
  toolchain?: {
    disabled?: string[];
  };
  // Agent session runtime settings. envOverrides merge into every spawned agent
  // subprocess env AFTER process.env and proxy vars but BEFORE per-session
  // overrides (CRAFT_WORKSPACE_PATH, mini-model) — session-specific values win.
  runtime?: {
    envOverrides?: Record<string, string>;
  };
  // Marketplace catalog meta (ETag + last fetch). Persisted by createConfigMetaStore
  // in marketplace RPC handlers (plan §0.1).
  marketplace?: {
    catalogEtag?: string;
    lastCatalogFetchAt?: number;
  };
  // Network proxy
  networkProxy?: import('./types.ts').NetworkProxySettings;
  // Windows: path to Git Bash (bash.exe) for the SDK subprocess
  gitBashPath?: string;
  // User chose "Setup later" during onboarding — skip showing onboarding on next launch
  setupDeferred?: boolean;
  // Server mode — embedded remote server settings
  serverConfig?: import('./server-config.ts').ServerConfig;
  // One-shot migration markers. Used by migrations that should run at most
  // once per user (e.g. restoring a previously-removed model to connection
  // lists without re-adding it if the user later removes it deliberately).
  migrationsApplied?: string[];
}

const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CONFIG_DEFAULTS_FILE = join(CONFIG_DIR, 'config-defaults.json');

const WORKSPACE_LIFECYCLE_FILE = join(CONFIG_DIR, 'workspace-lifecycle.json');
const WORKSPACE_LIFECYCLE_VERSION = 1 as const;

type WorkspaceKind = NonNullable<Workspace['kind']>;
type CanonicalWorkspace = Workspace & { kind: WorkspaceKind };

interface WorkspaceMutationInput
  extends Omit<Workspace, 'id' | 'createdAt' | 'slug' | 'name' | 'rootPath'> {
  name: string;
  rootPath: string;
  defaults?: WorkspaceConfig['defaults'];
}

/**
 * A complete local activation state captured only after the folder is bound,
 * an initial session exists, and the registry points at this workspace.
 */
export interface WorkspaceActivationSnapshot {
  workspace: CanonicalWorkspace;
  session: SessionConfig;
  activeWorkspaceId: string;
}

/**
 * Internal lifecycle seam. It is deliberately not reachable through RPC;
 * focused tests use it to prove that a post-folder failure rolls back rather
 * than publishing a partial workspace.
 */
export interface WorkspaceLifecycleHooks {
  afterFolderBound?: (workspace: CanonicalWorkspace) => void;
  beforeRegistryCommit?: (workspace: CanonicalWorkspace) => void;
}

interface PendingWorkspaceLifecycle {
  version: typeof WORKSPACE_LIFECYCLE_VERSION;
  phase: 'prepared' | 'folder-bound' | 'session-prepared' | 'session-created';
  workspace: CanonicalWorkspace;
  resultingActiveWorkspaceId: string | null;
  rootCreated: boolean;
  previousFolderConfig: string | null;
  createdSessionId?: string;
}

interface StagedWorkspaceMutation {
  journal: PendingWorkspaceLifecycle;
  nextConfig: StoredConfig;
  workspace: CanonicalWorkspace;
  hooks?: WorkspaceLifecycleHooks;
}

function normalizeWorkspaceRecord(workspace: Workspace): CanonicalWorkspace {
  const normalized = { ...workspace };
  normalizeWorkspaceAuthority(normalized);

  if (normalized.remoteServer) {
    normalized.remoteServer = {
      ...normalized.remoteServer,
      tlsTrust: normalizeRemoteTlsTrust(normalized.remoteServer),
    };
  }

  if (typeof normalized.name !== 'string' || !normalized.name.trim()) {
    normalized.name =
      typeof normalized.rootPath === 'string' && normalized.rootPath
        ? basename(normalized.rootPath)
        : 'Untitled';
  } else {
    normalized.name = normalized.name.trim();
  }

  if (typeof normalized.slug !== 'string' || !normalized.slug.trim()) {
    normalized.slug = extractWorkspaceSlugFromPath(normalized.rootPath, normalized.id);
  }

  return normalized as CanonicalWorkspace;
}

function workspaceRecordsMatch(
  candidate: Workspace | undefined,
  expected: CanonicalWorkspace,
): boolean {
  if (!candidate) return false;
  const normalizedCandidate = normalizeWorkspaceRecord({
    ...candidate,
    rootPath: expandPath(candidate.rootPath),
  });
  return (
    normalizedCandidate.id === expected.id &&
    normalizedCandidate.name === expected.name &&
    normalizedCandidate.rootPath === expected.rootPath &&
    normalizedCandidate.kind === expected.kind &&
    normalizedCandidate.orgId === expected.orgId
  );
}

function assertWorkspaceAuthority(workspace: CanonicalWorkspace): void {
  if (workspace.kind !== 'team') return;
  if (!workspace.orgId) throw new Error('Team workspace requires a non-empty orgId');
  if (workspace.remoteServer) {
    throw new Error(
      'Remote TeamSpace creation requires a remote prepare/commit/abort endpoint',
    );
  }
  requireCurrentLocalOrganizationMembership(workspace.orgId);
}

function isWorkspaceAccessibleToCurrentIdentity(workspace: CanonicalWorkspace): boolean {
  if (workspace.kind !== 'team') return true;
  return Boolean(
    !workspace.remoteServer &&
      workspace.orgId &&
      isCurrentLocalOrganizationMember(workspace.orgId),
  );
}

function readPendingWorkspaceLifecycle(): PendingWorkspaceLifecycle | null {
  if (!existsSync(WORKSPACE_LIFECYCLE_FILE)) return null;

  const raw = readJsonFileSync<Partial<PendingWorkspaceLifecycle>>(
    WORKSPACE_LIFECYCLE_FILE,
  );
  const workspace = raw.workspace;
  if (
    raw.version !== WORKSPACE_LIFECYCLE_VERSION ||
    !workspace ||
    typeof workspace.id !== 'string' ||
    !workspace.id ||
    typeof workspace.name !== 'string' ||
    !workspace.name ||
    typeof workspace.rootPath !== 'string' ||
    !workspace.rootPath ||
    (raw.phase !== 'prepared' &&
      raw.phase !== 'folder-bound' &&
      raw.phase !== 'session-prepared' &&
      raw.phase !== 'session-created') ||
    (raw.previousFolderConfig !== null &&
      typeof raw.previousFolderConfig !== 'string') ||
    (raw.createdSessionId !== undefined && typeof raw.createdSessionId !== 'string')
  ) {
    throw new Error('Invalid workspace lifecycle journal');
  }

  return {
    version: WORKSPACE_LIFECYCLE_VERSION,
    phase: raw.phase,
    workspace: normalizeWorkspaceRecord(workspace),
    resultingActiveWorkspaceId:
      typeof raw.resultingActiveWorkspaceId === 'string'
        ? raw.resultingActiveWorkspaceId
        : null,
    rootCreated: raw.rootCreated === true,
    previousFolderConfig: raw.previousFolderConfig,
    ...(raw.createdSessionId ? { createdSessionId: raw.createdSessionId } : {}),
  };
}

function writePendingWorkspaceLifecycle(journal: PendingWorkspaceLifecycle): void {
  atomicWriteFileSync(
    WORKSPACE_LIFECYCLE_FILE,
    JSON.stringify(journal, null, 2) + '\n',
  );
}

function clearPendingWorkspaceLifecycle(): void {
  try {
    if (existsSync(WORKSPACE_LIFECYCLE_FILE)) {
      unlinkSync(WORKSPACE_LIFECYCLE_FILE);
    }
  } catch (error) {
    // A committed registry remains authoritative; startup recovery will retry.
    debug(
      '[config] Failed to clear workspace lifecycle journal:',
      error instanceof Error ? error.message : error,
    );
  }
}

function isWorkspaceLifecycleCommitted(
  journal: PendingWorkspaceLifecycle,
): boolean {
  if (!existsSync(CONFIG_FILE)) return false;
  const config = readJsonFileSync<StoredConfig>(CONFIG_FILE);
  const candidate = config.workspaces?.find(
    (workspace) => workspace.id === journal.workspace.id,
  );
  return (
    workspaceRecordsMatch(candidate, journal.workspace) &&
    config.activeWorkspaceId === journal.resultingActiveWorkspaceId
  );
}

function rollbackWorkspaceLifecycle(journal: PendingWorkspaceLifecycle): void {
  if (isWorkspaceLifecycleCommitted(journal)) return;

  if (journal.createdSessionId && !journal.rootCreated) {
    deleteSession(journal.workspace.rootPath, journal.createdSessionId);
  }

  if (journal.rootCreated) {
    // The journal is written before this root is ever created, so only this
    // lifecycle can mark it owned. Never remove a pre-existing user folder.
    rmSync(journal.workspace.rootPath, { recursive: true, force: true });
  } else {
    const folderConfigPath = join(journal.workspace.rootPath, 'config.json');
    if (journal.previousFolderConfig !== null) {
      atomicWriteFileSync(folderConfigPath, journal.previousFolderConfig);
    } else {
      const current = loadWorkspaceConfig(journal.workspace.rootPath);
      if (current?.id === journal.workspace.id && existsSync(folderConfigPath)) {
        unlinkSync(folderConfigPath);
      }
    }
  }

  clearPendingWorkspaceLifecycle();
}

/**
 * Recover a lifecycle that stopped after folder binding but before the atomic
 * registry commit. A committed registry wins; otherwise the durable journal
 * restores the old folder config or removes the root created by this attempt.
 */
export function recoverPendingWorkspaceLifecycle(): void {
  const journal = readPendingWorkspaceLifecycle();
  if (!journal) return;
  if (isWorkspaceLifecycleCommitted(journal)) {
    clearPendingWorkspaceLifecycle();
    return;
  }
  rollbackWorkspaceLifecycle(journal);
}

function canonicalFolderIdentity(
  workspace: CanonicalWorkspace,
): WorkspaceCreationIdentity {
  return {
    id: workspace.id,
    slug: workspace.slug,
    kind: workspace.kind,
    ...(workspace.kind === 'team' ? { orgId: workspace.orgId } : {}),
  };
}

function bindCanonicalWorkspaceFolder(
  workspace: CanonicalWorkspace,
  defaults?: WorkspaceConfig['defaults'],
): void {
  const folderConfigPath = join(workspace.rootPath, 'config.json');
  const existing = loadWorkspaceConfig(workspace.rootPath);
  if (!existing) {
    if (existsSync(folderConfigPath)) {
      throw new Error(
        `Cannot bind workspace with unreadable config: ${folderConfigPath}`,
      );
    }
    createWorkspaceAtPath(
      workspace.rootPath,
      workspace.name,
      defaults,
      canonicalFolderIdentity(workspace),
    );
    return;
  }

  const folderConfig: WorkspaceConfig = {
    ...existing,
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    kind: workspace.kind,
    ...(workspace.kind === 'team' ? { orgId: workspace.orgId } : {}),
  };
  if (workspace.kind !== 'team') delete folderConfig.orgId;
  saveWorkspaceConfig(workspace.rootPath, folderConfig);
}

function configWithWorkspace(
  config: StoredConfig,
  workspace: CanonicalWorkspace,
  activate: boolean,
): StoredConfig {
  const index = config.workspaces.findIndex(
    (candidate) => candidate.id === workspace.id,
  );
  const workspaces =
    index === -1
      ? [...config.workspaces, workspace]
      : config.workspaces.map((candidate, candidateIndex) =>
          candidateIndex === index ? workspace : candidate,
        );

  return {
    ...config,
    workspaces,
    activeWorkspaceId: activate ? workspace.id : config.activeWorkspaceId,
  };
}

function stageWorkspaceMutation(
  config: StoredConfig,
  workspace: CanonicalWorkspace,
  activate: boolean,
  defaults?: WorkspaceConfig['defaults'],
  hooks?: WorkspaceLifecycleHooks,
): StagedWorkspaceMutation {
  const folderConfigPath = join(workspace.rootPath, 'config.json');
  const rootCreated = !existsSync(workspace.rootPath);
  const previousFolderConfig = existsSync(folderConfigPath)
    ? readFileSync(folderConfigPath, 'utf-8')
    : null;
  const journal: PendingWorkspaceLifecycle = {
    version: WORKSPACE_LIFECYCLE_VERSION,
    phase: 'prepared',
    workspace,
    resultingActiveWorkspaceId: activate
      ? workspace.id
      : config.activeWorkspaceId,
    rootCreated,
    previousFolderConfig,
  };

  writePendingWorkspaceLifecycle(journal);
  try {
    bindCanonicalWorkspaceFolder(workspace, defaults);
    journal.phase = 'folder-bound';
    writePendingWorkspaceLifecycle(journal);
    hooks?.afterFolderBound?.(workspace);
    return {
      journal,
      nextConfig: configWithWorkspace(config, workspace, activate),
      workspace,
      hooks,
    };
  } catch (error) {
    try {
      rollbackWorkspaceLifecycle(journal);
    } catch (rollbackError) {
      debug(
        '[config] Workspace lifecycle rollback failed:',
        rollbackError instanceof Error ? rollbackError.message : rollbackError,
      );
    }
    throw error;
  }
}

function commitWorkspaceMutation(staged: StagedWorkspaceMutation): CanonicalWorkspace {
  try {
    staged.hooks?.beforeRegistryCommit?.(staged.workspace);
    saveConfig(staged.nextConfig);
  } catch (error) {
    try {
      if (!isWorkspaceLifecycleCommitted(staged.journal)) {
        rollbackWorkspaceLifecycle(staged.journal);
      }
    } catch (rollbackError) {
      debug(
        '[config] Workspace lifecycle rollback after registry failure failed:',
        rollbackError instanceof Error ? rollbackError.message : rollbackError,
      );
    }
    throw error;
  }

  clearPendingWorkspaceLifecycle();
  return staged.workspace;
}

function configForWorkspaceMutation(): StoredConfig {
  const config = loadStoredConfig();
  if (config) return config;
  if (existsSync(CONFIG_FILE)) {
    throw new Error('Unable to load existing workspace registry');
  }
  ensureConfigDir();
  return { workspaces: [], activeWorkspaceId: null, activeSessionId: null };
}

function buildCanonicalWorkspace(
  input: WorkspaceMutationInput,
  existing?: Workspace,
): CanonicalWorkspace {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const rootPath = typeof input.rootPath === 'string' ? input.rootPath.trim() : '';
  if (!name) throw new Error('Workspace name is required');
  if (!rootPath) throw new Error('Workspace rootPath is required');

  const { defaults: _defaults, ...workspaceFields } = input;
  if (workspaceFields.kind === undefined) delete workspaceFields.kind;
  if (workspaceFields.orgId === undefined) delete workspaceFields.orgId;
  const requestedKind = workspaceFields.kind;
  const requestedOrgId =
    typeof workspaceFields.orgId === 'string' ? workspaceFields.orgId.trim() : '';
  const existingTeamOrgId =
    existing?.kind === 'team' && typeof existing.orgId === 'string'
      ? existing.orgId.trim()
      : '';
  if (requestedKind === 'team' && !(requestedOrgId || existingTeamOrgId)) {
    throw new Error('Team workspace requires a non-empty orgId');
  }
  if (requestedKind !== 'team' && requestedOrgId) {
    throw new Error('orgId is only valid for a team workspace');
  }
  const workspace = normalizeWorkspaceRecord({
    ...existing,
    ...workspaceFields,
    id: existing?.id ?? generateWorkspaceId(),
    name,
    slug: extractWorkspaceSlugFromPath(rootPath, existing?.id ?? ''),
    rootPath,
    createdAt: existing?.createdAt ?? Date.now(),
  });
  assertWorkspaceAuthority(workspace);
  return workspace;
}

/**
 * Creates, canonically binds, and activates a local workspace as one durable
 * lifecycle. The registry is published only after the folder and activation
 * session exist; a crash before commit is recovered from the journal.
 */
export async function createAndActivateLocalWorkspace(
  input: WorkspaceMutationInput,
  hooks?: WorkspaceLifecycleHooks,
): Promise<WorkspaceActivationSnapshot> {
  const config = configForWorkspaceMutation();
  const requestedRootPath =
    typeof input.rootPath === 'string' ? input.rootPath.trim() : '';
  const existing = config.workspaces.find(
    (workspace) => workspace.rootPath === requestedRootPath,
  );
  const workspace = buildCanonicalWorkspace(input, existing);
  if (workspace.remoteServer) {
    throw new Error('Local workspace lifecycle does not support remote workspaces');
  }

  const staged = stageWorkspaceMutation(
    config,
    workspace,
    true,
    input.defaults,
    hooks,
  );
  try {
    const existingSessions = listActiveSessions(workspace.rootPath);
    let session: SessionConfig;
    if (existingSessions.length > 0) {
      session = await getOrCreateLatestSession(workspace.rootPath);
    } else {
      const sessionId = generateSessionId(workspace.rootPath);
      // Persist the generated ID before creating it so crash recovery can
      // remove it from a pre-existing user folder as well as a new root.
      staged.journal.createdSessionId = sessionId;
      staged.journal.phase = 'session-prepared';
      writePendingWorkspaceLifecycle(staged.journal);
      session = await getOrCreateSessionById(workspace.rootPath, sessionId);
      staged.journal.phase = 'session-created';
      writePendingWorkspaceLifecycle(staged.journal);
    }

    const committedWorkspace = commitWorkspaceMutation(staged);
    return {
      workspace: committedWorkspace,
      session,
      activeWorkspaceId: committedWorkspace.id,
    };
  } catch (error) {
    try {
      if (existsSync(WORKSPACE_LIFECYCLE_FILE)) {
        rollbackWorkspaceLifecycle(staged.journal);
      }
    } catch (rollbackError) {
      debug(
        '[config] Workspace activation rollback failed:',
        rollbackError instanceof Error ? rollbackError.message : rollbackError,
      );
    }
    throw error;
  }
}

// Track if config-defaults have been synced this session (prevents re-sync on hot reload)
let configDefaultsSynced = false;

/**
 * Sync config-defaults.json from bundled assets.
 * Always writes on launch to ensure defaults are up-to-date with the running version.
 * Follows the same pattern as docs, themes, and other bundled assets.
 *
 * Source of truth: apps/electron/resources/config-defaults.json
 */
const DEFAULT_ZOOM_LEVEL = 90;

/** Minimal config-defaults used when bundled assets aren't available (CI, standalone server). */
const FALLBACK_CONFIG_DEFAULTS: ConfigDefaults = {
  version: '1.0',
  description: 'Default configuration values for Craft Agents',
  defaults: {
    notificationsEnabled: true,
    colorTheme: 'pierre',
    autoCapitalisation: true,
    sendMessageKey: 'enter',
    spellCheck: false,
    keepAwakeWhileRunning: false,
    richToolDescriptions: true,
    defaultZoomLevel: DEFAULT_ZOOM_LEVEL,
    extendedPromptCache: false,
    browserToolEnabled: true,
    allowRemoteEvaluate: true,
  },
  workspaceDefaults: {
    thinkingLevel: 'medium',
    permissionMode: 'allow-all',
    cyclablePermissionModes: ['safe', 'allow-all'],
    localMcpServers: { enabled: true },
  },
};

function syncConfigDefaults(): void {
  if (configDefaultsSynced) return;
  configDefaultsSynced = true;

  // Get bundled config-defaults.json from resources folder
  const bundledDir = getBundledAssetsDir('.');
  if (!bundledDir) {
    debug('[config] No bundled assets dir found - using fallback config-defaults');
    if (!existsSync(CONFIG_DEFAULTS_FILE)) {
      writeFileSync(CONFIG_DEFAULTS_FILE, JSON.stringify(FALLBACK_CONFIG_DEFAULTS, null, 2), 'utf-8');
    }
    return;
  }

  const bundledFile = join(bundledDir, 'config-defaults.json');
  if (!existsSync(bundledFile)) {
    debug('[config] Bundled config-defaults.json not found at: ' + bundledFile + ' - using fallback');
    if (!existsSync(CONFIG_DEFAULTS_FILE)) {
      writeFileSync(CONFIG_DEFAULTS_FILE, JSON.stringify(FALLBACK_CONFIG_DEFAULTS, null, 2), 'utf-8');
    }
    return;
  }

  // Sync from bundled file (same pattern as docs)
  const content = readFileSync(bundledFile, 'utf-8');
  writeFileSync(CONFIG_DEFAULTS_FILE, content, 'utf-8');
  debug('[config] Synced config-defaults.json from bundled assets');
}

/**
 * Load config defaults from ~/.craft-agent/config-defaults.json
 * This file is synced from bundled assets on every launch.
 */
export function loadConfigDefaults(): ConfigDefaults {
  if (!existsSync(CONFIG_DEFAULTS_FILE)) {
    throw new Error('config-defaults.json not found at ' + CONFIG_DEFAULTS_FILE + '. Ensure ensureConfigDir() was called at startup.');
  }

  const defaults = readJsonFileSync<ConfigDefaults>(CONFIG_DEFAULTS_FILE);

  const parsedPermissionMode =
    typeof defaults.workspaceDefaults?.permissionMode === 'string'
      ? parsePermissionMode(defaults.workspaceDefaults.permissionMode)
      : null;
  defaults.workspaceDefaults.permissionMode = parsedPermissionMode ?? 'ask';

  const rawCyclable = Array.isArray(defaults.workspaceDefaults?.cyclablePermissionModes)
    ? defaults.workspaceDefaults.cyclablePermissionModes
    : [];

  const normalizedCyclable: PermissionMode[] = [];
  for (const mode of rawCyclable) {
    if (typeof mode !== 'string') continue;
    const parsed = parsePermissionMode(mode);
    if (!parsed) continue;
    if (!normalizedCyclable.includes(parsed)) {
      normalizedCyclable.push(parsed);
    }
  }

  defaults.workspaceDefaults.cyclablePermissionModes =
    normalizedCyclable.length >= 2 ? normalizedCyclable : [...PERMISSION_MODE_ORDER];

  return defaults;
}

/**
 * Ensure config-defaults.json exists and is up-to-date.
 * Syncs from bundled assets on every launch (like docs, themes, permissions).
 */
export function ensureConfigDefaults(): void {
  syncConfigDefaults();
}

let configDirInitialized = false;

const MAX_CONFIG_BACKUPS = 3;
const CONFIG_BACKUP_DATE_RE = /^config\.json\.bak-\d{4}-\d{2}-\d{2}$/;

/**
 * Snapshot an existing config.json into a dated file (config.json.bak-YYYY-MM-DD)
 * and keep only the newest MAX_CONFIG_BACKUPS. Runs once at startup, before any
 * path can mutate or (in failure paths) overwrite the workspace registry.
 * Best-effort: failures are logged and swallowed so a backup never blocks startup.
 */
export function backupConfigFile(): void {
  try {
    if (!existsSync(CONFIG_FILE)) return;

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dated = join(CONFIG_DIR, `config.json.bak-${stamp}`);
    // One backup per day, never overwritten: the first snapshot of the day is taken
    // before any mutation, so it holds the good pre-reset state. A second startup that
    // day (e.g. after a reset already nuked the registry) must NOT clobber it.
    if (existsSync(dated)) return;
    writeFileSync(dated, readFileSync(CONFIG_FILE, 'utf-8'), 'utf-8');

    // ISO date in the name → lexical sort is chronological; drop all but the newest few.
    const backups = readdirSync(CONFIG_DIR).filter(f => CONFIG_BACKUP_DATE_RE.test(f)).sort();
    for (const stale of backups.slice(0, Math.max(0, backups.length - MAX_CONFIG_BACKUPS))) {
      try { rmSync(join(CONFIG_DIR, stale)); } catch { /* ignore individual cleanup errors */ }
    }
  } catch (error) {
    debug('[config] backupConfigFile failed:', error instanceof Error ? error.message : error);
  }
}

export function ensureConfigDir(): void {
  if (configDirInitialized) return;

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Snapshot an existing config.json (dated, keep last 3) before anything can
  // mutate or — in a failure path — overwrite the workspace registry.
  backupConfigFile();
  // Initialize bundled docs (creates ~/.craft-agent/docs/ with sources.md, agents.md, permissions.md)
  initializeDocs();

  // Initialize config defaults
  ensureConfigDefaults();

  // Initialize tool icons (CLI tool icons for turn card display)
  ensureToolIcons();

  configDirInitialized = true;
}

export function loadStoredConfig(): StoredConfig | null {
  try {
    // A journal always predates a folder mutation. Recover it before exposing
    // the registry so interrupted local creation never becomes a half-visible
    // workspace on the next start.
    recoverPendingWorkspaceLifecycle();

    if (!existsSync(CONFIG_FILE)) {
      return null;
    }
    const config = readJsonFileSync<StoredConfig>(CONFIG_FILE);

    // Must have workspaces array
    if (!Array.isArray(config.workspaces)) {
      return null;
    }

    let needsSave = false;

    // Expand paths and make the global registry the canonical identity source
    // for every tracked folder. Legacy no-kind records normalize to personal
    // and lose any previously unverified org marker.
    config.workspaces = config.workspaces.map((workspace) => {
      const expanded = {
        ...workspace,
        rootPath: expandPath(workspace.rootPath),
      };
      const normalized = normalizeWorkspaceRecord(expanded);
      if (
        normalized.rootPath !== workspace.rootPath ||
        normalized.name !== workspace.name ||
        normalized.slug !== workspace.slug ||
        normalized.kind !== workspace.kind ||
        normalized.orgId !== workspace.orgId ||
        JSON.stringify(normalized.remoteServer?.tlsTrust) !==
          JSON.stringify(workspace.remoteServer?.tlsTrust)
      ) {
        needsSave = true;
      }
      return normalized;
    });

    // Validate active workspace exists
    const activeWorkspace = config.workspaces.find(
      (workspace) => workspace.id === config.activeWorkspaceId,
    );
    if (!activeWorkspace) {
      // Default to first workspace
      config.activeWorkspaceId = config.workspaces[0]?.id || null;
      needsSave = true;
    }

    // Repair/initialize local folders with the canonical registry identity.
    // Folder failures are non-fatal and never replace the registry identity.
    for (const workspace of config.workspaces) {
      try {
        bindCanonicalWorkspaceFolder(normalizeWorkspaceRecord(workspace));
      } catch (wsError) {
        debug(
          '[config] Failed to bind workspace at',
          workspace.rootPath,
          ':',
          wsError instanceof Error ? wsError.message : wsError,
        );
      }
    }

    // P0: seed cloudRuns when section is absent. Never overwrite a persisted
    // object (enabled:false and custom providers stay as the user left them).
    if (config.cloudRuns === undefined) {
      config.cloudRuns = {
        enabled: true,
        provider: 'cloudflare',
        gatewayUrl:
          process.env.CRAFT_CLOUD_RUNS_GATEWAY_URL
          ?? 'https://craft-cloud-gateway.scharlesky-192.workers.dev',
        defaultMaxWallClockSec: 5400,
        defaultMaxLlmTokens: 2_000_000,
        defaultMaxArtifactsBytes: 25 * 1024 * 1024,
      };
      needsSave = true;
    }

    if (needsSave) {
      try {
        // saveConfig re-portable-izes paths; in-memory config stays expanded.
        saveConfig(config);
      } catch (saveError) {
        debug(
          '[config] Failed to persist workspace/config migration:',
          saveError instanceof Error ? saveError.message : saveError,
        );
      }
    }

    return config;
  } catch (error) {
    debug('[config] loadStoredConfig failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

// Legacy credential helpers removed - use connection-aware credential lookup instead:
// - getAnthropicApiKey() → credentialManager.getLlmApiKey(connectionSlug)
// - getClaudeOAuthToken() → credentialManager.getLlmOAuth(connectionSlug)

export function saveConfig(config: StoredConfig): void {
  ensureConfigDir();

  // Convert paths to portable form for cross-machine compatibility and persist
  // the explicit authority discriminator on every registry write.
  const storageConfig: StoredConfig = {
    ...config,
    workspaces: config.workspaces.map((workspace) => {
      const normalized = normalizeWorkspaceRecord(workspace);
      return {
        ...normalized,
        rootPath: toPortablePath(normalized.rootPath),
      };
    }),
  };

  atomicWriteFileSync(
    CONFIG_FILE,
    JSON.stringify(storageConfig, null, 2) + '\n',
  );
}

// Legacy updateApiKey() removed - use setupLlmConnection IPC handler instead.

// Legacy getters/setters removed - use LLM connections instead:
// - getAuthType/setAuthType -> derive from getDefaultLlmConnection()/getLlmConnection()
// - getAnthropicBaseUrl/setAnthropicBaseUrl -> use connection.baseUrl
// - getCustomModel/setCustomModel -> use connection.defaultModel


/**
 * Get whether desktop notifications are enabled.
 * Defaults to true if not set.
 */
export function getNotificationsEnabled(): boolean {
  const config = loadStoredConfig();
  if (config?.notificationsEnabled !== undefined) {
    return config.notificationsEnabled;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.notificationsEnabled;
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

/**
 * Get whether auto-capitalisation is enabled.
 * Defaults to true if not set.
 */
export function getAutoCapitalisation(): boolean {
  const config = loadStoredConfig();
  if (config?.autoCapitalisation !== undefined) {
    return config.autoCapitalisation;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.autoCapitalisation;
}

/**
 * Set whether auto-capitalisation is enabled.
 */
export function setAutoCapitalisation(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.autoCapitalisation = enabled;
  saveConfig(config);
}

/**
 * Get the key combination used to send messages.
 * Defaults to 'enter' if not set.
 */
export function getSendMessageKey(): 'enter' | 'cmd-enter' {
  const config = loadStoredConfig();
  if (config?.sendMessageKey !== undefined) {
    return config.sendMessageKey;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.sendMessageKey;
}

/**
 * Set the key combination used to send messages.
 */
export function setSendMessageKey(key: 'enter' | 'cmd-enter'): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.sendMessageKey = key;
  saveConfig(config);
}

/**
 * Get whether spell check is enabled in the input.
 */
export function getSpellCheck(): boolean {
  const config = loadStoredConfig();
  if (config?.spellCheck !== undefined) {
    return config.spellCheck;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.spellCheck;
}

/**
 * Set whether spell check is enabled in the input.
 */
export function setSpellCheck(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.spellCheck = enabled;
  saveConfig(config);
}

/**
 * Get whether screen should stay awake while sessions are running.
 * Defaults to false if not set.
 */
export function getKeepAwakeWhileRunning(): boolean {
  const config = loadStoredConfig();
  if (config?.keepAwakeWhileRunning !== undefined) {
    return config.keepAwakeWhileRunning;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.keepAwakeWhileRunning;
}

/**
 * Set whether screen should stay awake while sessions are running.
 */
export function setKeepAwakeWhileRunning(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.keepAwakeWhileRunning = enabled;
  saveConfig(config);
}

/**
 * Get whether rich tool descriptions are enabled.
 * When enabled, all tool calls include intent and display name metadata.
 * Defaults to true if not set.
 */
export function getRichToolDescriptions(): boolean {
  const config = loadStoredConfig();
  if (config?.richToolDescriptions !== undefined) {
    return config.richToolDescriptions;
  }
  return true;
}

/**
 * Set whether rich tool descriptions are enabled.
 */
export function setRichToolDescriptions(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.richToolDescriptions = enabled;
  saveConfig(config);
}

const MIN_DEFAULT_ZOOM_LEVEL = 50;
const MAX_DEFAULT_ZOOM_LEVEL = 150;
const DEFAULT_ZOOM_STEP = 10;

function normalizeDefaultZoomLevel(level: number): number {
  if (!Number.isFinite(level)) return DEFAULT_ZOOM_LEVEL;
  const stepped = Math.round(level / DEFAULT_ZOOM_STEP) * DEFAULT_ZOOM_STEP;
  return Math.min(MAX_DEFAULT_ZOOM_LEVEL, Math.max(MIN_DEFAULT_ZOOM_LEVEL, stepped));
}

/**
 * Get the default app zoom level as a percentage.
 * Defaults to 90 if not set.
 */
export function getDefaultZoomLevel(): number {
  const config = loadStoredConfig();
  if (config?.defaultZoomLevel !== undefined) {
    return normalizeDefaultZoomLevel(config.defaultZoomLevel);
  }
  const defaults = loadConfigDefaults();
  return normalizeDefaultZoomLevel(defaults.defaults.defaultZoomLevel);
}

/**
 * Set the default app zoom level as a percentage.
 */
export function setDefaultZoomLevel(level: number): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.defaultZoomLevel = normalizeDefaultZoomLevel(level);
  saveConfig(config);
}

/**
 * Get whether extended prompt cache (1h TTL) is enabled.
 * When enabled, the interceptor upgrades cache_control TTL from 5m to 1h.
 * Defaults to false if not set.
 */
export function getExtendedPromptCache(): boolean {
  const config = loadStoredConfig();
  return config?.extendedPromptCache ?? false;
}

/**
 * Set whether extended prompt cache (1h TTL) is enabled.
 */
export function setExtendedPromptCache(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.extendedPromptCache = enabled;
  saveConfig(config);
}

/**
 * Get whether the built-in browser tool is enabled.
 * When disabled, browser_tool is not included in session tools.
 * Defaults to true if not set.
 */
export function getBrowserToolEnabled(): boolean {
  const config = loadStoredConfig();
  if (config?.browserToolEnabled !== undefined) {
    return config.browserToolEnabled;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.browserToolEnabled;
}

/**
 * Set whether the built-in browser tool is enabled.
 */
export function setBrowserToolEnabled(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.browserToolEnabled = enabled;
  saveConfig(config);

  // Clear session tool caches so all sessions pick up the change immediately.
  // Lazy import to avoid circular dependency (storage ← session-scoped-tools ← storage).
  import('../agent/session-scoped-tools.ts').then(m => m.invalidateAllSessionToolsCaches()).catch(() => {});
}

/**
 * Whether remote agents may call `browser_tool evaluate <expression>` against this
 * desktop client's local browser. The check is enforced inside the local capability
 * dispatcher; the remote server cannot override it.
 *
 * Defaults to true. Users can flip it off in Settings → AI → Advanced if they don't
 * trust the remote workspaces they connect to.
 */
export function getAllowRemoteEvaluate(): boolean {
  const config = loadStoredConfig();
  if (config?.allowRemoteEvaluate !== undefined) {
    return config.allowRemoteEvaluate;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.allowRemoteEvaluate;
}

export function setAllowRemoteEvaluate(allowed: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.allowRemoteEvaluate = allowed;
  saveConfig(config);
}

/**
 * Get whether 1M context window is enabled.
 * When disabled, models use 200K context and the interceptor strips the context-1m beta header.
 * Defaults to false — the 1M beta requires Anthropic Tier 4+, and enabling it by default
 * causes 400 "Invalid Request" for lower-tier API keys on large contexts (issue #567).
 * Users opt in via AI Settings → Performance → Extended Context (1M).
 */
export function getEnable1MContext(): boolean {
  const config = loadStoredConfig();
  return config?.enable1MContext === true;
}

/**
 * Self-learning memory triggers, resolved with DEFAULT_MEMORY_CONFIG fallbacks
 * (missing keys / missing config file both yield the defaults).
 */
export function getMemoryConfig(): MemoryConfig {
  const raw = loadStoredConfig()?.memory ?? {};
  return {
    enabled: raw.enabled !== undefined ? raw.enabled === true : DEFAULT_MEMORY_CONFIG.enabled,
    distillIdleHours:
      typeof raw.distillIdleHours === 'number' && Number.isFinite(raw.distillIdleHours) && raw.distillIdleHours > 0
        ? raw.distillIdleHours
        : DEFAULT_MEMORY_CONFIG.distillIdleHours,
    distillMsgCount:
      typeof raw.distillMsgCount === 'number' && Number.isFinite(raw.distillMsgCount) && raw.distillMsgCount > 0
        ? Math.floor(raw.distillMsgCount)
        : DEFAULT_MEMORY_CONFIG.distillMsgCount,
    negativeFirst: raw.negativeFirst !== undefined ? raw.negativeFirst === true : DEFAULT_MEMORY_CONFIG.negativeFirst,
    redactExtraPatterns: Array.isArray(raw.redactExtraPatterns)
      ? raw.redactExtraPatterns.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : DEFAULT_MEMORY_CONFIG.redactExtraPatterns,
    ftsLimit:
      typeof raw.ftsLimit === 'number' && Number.isFinite(raw.ftsLimit) && raw.ftsLimit > 0
        ? Math.floor(raw.ftsLimit)
        : DEFAULT_MEMORY_CONFIG.ftsLimit,
    semantic: raw.semantic !== undefined ? raw.semantic === true : DEFAULT_MEMORY_CONFIG.semantic,
  };
}

/**
 * Gate for auto-creating skills from distilled session candidates.
 * Defaults to FALSE (opt-in) — when false, skill candidates from distillation are dropped.
 */
export function getSkillsAutoCreateFromSessions(): boolean {
  return loadStoredConfig()?.skills?.autoCreateFromSessions === true;
}

/**
 * Set whether 1M context window is enabled.
 */
export function setEnable1MContext(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.enable1MContext = enabled;
  saveConfig(config);
}

/**
 * Get whether rtk Bash-output compression is enabled.
 * When enabled, the PreToolUse pipeline rewrites Bash commands to their `rtk` equivalents
 * to reduce token consumption on common dev commands (git, ls, grep, test runners, etc.).
 * Defaults to false — opt-in. Requires the `rtk` binary on PATH or bundled with the app.
 * https://github.com/rtk-ai/rtk
 */
export function getRtkEnabled(): boolean {
  const config = loadStoredConfig();
  return config?.rtkEnabled === true;
}

/**
 * Set whether rtk Bash-output compression is enabled.
 */
export function setRtkEnabled(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.rtkEnabled = enabled;
  saveConfig(config);
}

/**
 * Toolchain: имена default-on инструментов (ToolName), отключённых пользователем.
 * ensureAll их пропускает; core ставится всегда, opt-in — только явным update().
 * Живой менеджер синхронизируется через ToolchainManager.setDisabledTools
 * (хендлер toolchain:setDisabled); стартовое значение читает toolchain-runtime.ts.
 */
export function getToolchainDisabled(): string[] {
  const config = loadStoredConfig();
  return config?.toolchain?.disabled ?? [];
}

/**
 * Persist toolchain.disabled (см. getToolchainDisabled). Порядок сохраняется,
 * дубликаты схлопываются; неизвестные имена отбрасываются (fail-closed).
 */
export function setToolchainDisabled(tools: string[]): void {
  const config = loadStoredConfig();
  if (!config) return;
  const known: ToolName[] = [];
  const seen = new Set<string>();
  for (const raw of tools) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (!name || seen.has(name) || !isToolName(name)) continue;
    seen.add(name);
    known.push(name);
  }
  config.toolchain = { ...config.toolchain, disabled: known };
  saveConfig(config);
}

/**
 * Bundled skill packs skipped by ensureBundledSkills (PRD §7.4).
 * Disk files stay; only future sync is suppressed.
 */
export function getBundledSkillsDisabled(): string[] {
  const config = loadStoredConfig();
  return config?.bundledSkills?.disabled ?? [];
}

/** Persist bundledSkills.disabled (deduped, stable order). */
export function setBundledSkillsDisabled(slugs: string[]): void {
  const config = loadStoredConfig();
  if (!config) return;
  const cleaned = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))];
  config.bundledSkills = { ...config.bundledSkills, disabled: cleaned };
  saveConfig(config);
}

/**
 * Runtime: пользовательские переменные окружения для всех агент-сессий
 * (config runtime.envOverrides). Сливаются в env подпроцесса ПОСЛЕ process.env
 * и proxy, но ДО per-session envOverrides (CRAFT_WORKSPACE_PATH и пр. побеждают).
 */
export function getRuntimeEnvOverrides(): Record<string, string> {
  const config = loadStoredConfig();
  return { ...(config?.runtime?.envOverrides ?? {}) };
}

/**
 * Persist runtime.envOverrides (см. getRuntimeEnvOverrides). Пустые ключи
 * отбрасываются; значения приводятся к строкам. Применяется к новым
 * подпроцессам — живые сессии респавнятся при следующем запуске агента.
 *
 * Ключи: POSIX-имя `^[A-Za-z_][A-Za-z0-9_]*$`. Denylist — переменные, через
 * которые UI env-overrides могли бы сломать изоляцию/загрузчик (PATH hijack,
 * DYLD/LD preload, Node/Bun inject). Структурные CRAFT_* ключи session-manager
 * тоже запрещены — они выставляются кодом, не пользователем.
 */
const ENV_OVERRIDE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const ENV_OVERRIDE_DENY: Record<string, true> = {
  PATH: true,
  Path: true, // win32 casing
  LD_PRELOAD: true,
  LD_LIBRARY_PATH: true,
  DYLD_INSERT_LIBRARIES: true,
  DYLD_LIBRARY_PATH: true,
  DYLD_FRAMEWORK_PATH: true,
  NODE_OPTIONS: true,
  NODE_PATH: true,
  BUN_OPTIONS: true,
  BUN_INSTALL: true,
  BUN_CONFIG_REGISTRY: true,
  OPENSSL_CONF: true,
  PYTHONPATH: true,
  PYTHONHOME: true,
  PERL5LIB: true,
  RUBYLIB: true,
  CRAFT_WORKSPACE_PATH: true,
  CRAFT_CONFIG_DIR: true,
  CRAFT_BUN_PATH: true,
  CRAFT_SESSION_DIR: true,
  CRAFT_STUB_RUNNER: true,
}

export function setRuntimeEnvOverrides(env: Record<string, string>): void {
  const config = loadStoredConfig();
  if (!config) return;
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const trimmedKey = key.trim();
    if (!trimmedKey) continue;
    if (!ENV_OVERRIDE_KEY_RE.test(trimmedKey)) {
      throw new Error(`invalid env override key: ${trimmedKey}`)
    }
    if (ENV_OVERRIDE_DENY[trimmedKey]) {
      throw new Error(`env override key not allowed: ${trimmedKey}`)
    }
    cleaned[trimmedKey] = String(value);
  }
  config.runtime = { ...config.runtime, envOverrides: cleaned };
  saveConfig(config);
}

/**
 * Get persisted Git Bash path (Windows only).
 * Used to set CLAUDE_CODE_GIT_BASH_PATH for the SDK subprocess.
 */
export function getGitBashPath(): string | undefined {
  const config = loadStoredConfig();
  return config?.gitBashPath;
}

/**
 * Set Git Bash path (Windows only).
 * Persists to config so it survives app restarts.
 * Returns false if the config could not be loaded (path not persisted).
 */
export function setGitBashPath(path: string): boolean {
  const config = loadStoredConfig();
  if (!config) {
    console.warn('[storage] Failed to persist Git Bash path: config could not be loaded');
    return false;
  }
  config.gitBashPath = path;
  saveConfig(config);
  return true;
}

/**
 * Clear persisted Git Bash path (Windows only).
 * Used when the stored path is stale or invalid.
 */
export function clearGitBashPath(): void {
  const config = loadStoredConfig();
  if (!config || !config.gitBashPath) return;
  delete config.gitBashPath;
  saveConfig(config);
}

// Note: getDefaultWorkingDirectory/setDefaultWorkingDirectory removed
// Working directory is now stored per-workspace in workspace config.json (defaults.workingDirectory)
// Note: getDefaultPermissionMode/getEnabledPermissionModes removed
// Permission settings are now stored per-workspace in workspace config.json (defaults.permissionMode, defaults.cyclablePermissionModes)

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
  return findIconFile(rootPath) ?? null;
}

/**
 * Lists only workspaces this local server identity may access. Team workspace
 * membership is checked here as a defense in depth; mutation paths also check
 * it before touching disk.
 */
export function getWorkspaces(): Workspace[] {
  const config = loadStoredConfig();
  const workspaces = (config?.workspaces ?? [])
    .map((workspace) => normalizeWorkspaceRecord(workspace))
    .filter(isWorkspaceAccessibleToCurrentIdentity);

  return workspaces.map((workspace) => {
    // A remote URL remains authoritative; local icon files are a convenience
    // for local workspaces only.
    let iconUrl = workspace.iconUrl;
    if (
      !iconUrl ||
      (!iconUrl.startsWith('http://') && !iconUrl.startsWith('https://'))
    ) {
      const localIcon = findWorkspaceIcon(workspace.rootPath);
      if (localIcon) {
        try {
          const mtime = statSync(localIcon).mtimeMs;
          iconUrl = `file://${localIcon}?t=${mtime}`;
        } catch {
          iconUrl = `file://${localIcon}`;
        }
      }
    }

    return { ...workspace, iconUrl };
  });
}

export function getActiveWorkspace(): Workspace | null {
  const activeWorkspaceId = loadStoredConfig()?.activeWorkspaceId;
  const workspaces = getWorkspaces();
  return (
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0] ??
    null
  );
}

/**
 * Find a workspace by name (case-insensitive) or ID.
 * Useful for CLI -w flag to specify workspace.
 */
export function getWorkspaceByNameOrId(nameOrId: string): Workspace | null {
  if (typeof nameOrId !== 'string' || !nameOrId.trim()) return null;
  const requested = nameOrId.trim();
  return (
    getWorkspaces().find(
      (workspace) =>
        workspace.id === requested ||
        workspace.name.toLowerCase() === requested.toLowerCase(),
    ) ?? null
  );
}

export function updateWorkspaceRemoteServer(
  workspaceId: string,
  remoteServer: RemoteServerConfig,
): void {
  const config = loadStoredConfig();
  if (!config) return;
  const index = config.workspaces.findIndex(
    (workspace) => workspace.id === workspaceId,
  );
  if (index === -1) throw new Error('Workspace not found');

  const workspace = normalizeWorkspaceRecord(config.workspaces[index]!);
  if (workspace.kind === 'team') {
    throw new Error(
      'Remote TeamSpace updates require a remote prepare/commit/abort endpoint',
    );
  }
  config.workspaces[index] = {
    ...workspace,
    remoteServer: workspace.remoteServer
      ? { ...workspace.remoteServer, ...remoteServer }
      : remoteServer,
  };
  saveConfig(config);
}

export function setActiveWorkspace(workspaceId: string): void {
  const config = loadStoredConfig();
  if (!config) return;

  const workspace = config.workspaces.find(
    (candidate) => candidate.id === workspaceId,
  );
  if (!workspace) return;
  const normalized = normalizeWorkspaceRecord(workspace);
  if (!isWorkspaceAccessibleToCurrentIdentity(normalized)) {
    throw new Error('Not authorized to activate this team workspace');
  }

  config.activeWorkspaceId = normalized.id;
  saveConfig(config);
}

/**
 * Bind or unbind a local workspace to an organization without allowing the
 * folder and registry identities to drift. A team binding is authorized by
 * the server-local identity before the journal is written.
 */
export function setWorkspaceOrganization(
  workspaceId: string,
  orgId: string | null,
): Workspace {
  const config = configForWorkspaceMutation();
  const existing = config.workspaces.find(
    (workspace) => workspace.id === workspaceId,
  );
  if (!existing) throw new Error(`Workspace not found: ${workspaceId}`);
  const current = normalizeWorkspaceRecord(existing);
  if (!isWorkspaceAccessibleToCurrentIdentity(current)) {
    throw new Error('Not authorized to modify this team workspace');
  }

  const normalizedOrgId = typeof orgId === 'string' ? orgId.trim() : '';
  const workspace = normalizeWorkspaceRecord({
    ...existing,
    kind: normalizedOrgId ? 'team' : 'personal',
    ...(normalizedOrgId ? { orgId: normalizedOrgId } : {}),
  });
  if (!normalizedOrgId) delete workspace.orgId;
  assertWorkspaceAuthority(workspace);

  const staged = stageWorkspaceMutation(config, workspace, false);
  return commitWorkspaceMutation(staged);
}

/**
 * Atomically switch to a workspace and load/create a session.
 * This preserves the legacy return shape while refusing unauthorized team
 * spaces before a session or active-workspace persistence is changed.
 */
export async function switchWorkspaceAtomic(
  workspaceId: string,
): Promise<{ workspace: Workspace; session: SessionConfig } | null> {
  const config = loadStoredConfig();
  if (!config) return null;

  const existing = config.workspaces.find(
    (workspace) => workspace.id === workspaceId,
  );
  if (!existing) return null;
  const workspace = normalizeWorkspaceRecord(existing);
  if (!isWorkspaceAccessibleToCurrentIdentity(workspace)) return null;

  // Get or create the latest session before mutating the active registry.
  const session = await getOrCreateLatestSession(workspace.rootPath);
  const index = config.workspaces.findIndex(
    (candidate) => candidate.id === workspace.id,
  );
  config.workspaces[index] = {
    ...workspace,
    lastAccessedAt: Date.now(),
  };
  config.activeWorkspaceId = workspace.id;
  saveConfig(config);

  return { workspace: config.workspaces[index]!, session };
}

/**
 * Add a workspace to the global config while giving its folder the same
 * canonical id/name/kind/orgId. Kept synchronous for source compatibility;
 * callers that need an initial activation session use
 * `createAndActivateLocalWorkspace`.
 */
export function addWorkspace(
  workspace: Omit<Workspace, 'id' | 'createdAt' | 'slug'>,
): Workspace {
  const config = configForWorkspaceMutation();
  const existing = config.workspaces.find(
    (candidate) => candidate.rootPath === workspace.rootPath.trim(),
  );
  const canonical = buildCanonicalWorkspace(
    workspace as WorkspaceMutationInput,
    existing,
  );
  const staged = stageWorkspaceMutation(
    config,
    canonical,
    config.workspaces.length === 0,
  );
  return commitWorkspaceMutation(staged);
}

/**
 * Sync workspaces discovered in the default location that are not already
 * tracked. A discovered TeamSpace is ignored unless the current server
 * identity is a durable member; discovery must not manufacture authority.
 */
export function syncWorkspaces(): void {
  let config = configForWorkspaceMutation();
  const trackedPaths = new Set(config.workspaces.map((workspace) => workspace.rootPath));

  for (const rootPath of discoverWorkspacesInDefaultLocation()) {
    if (trackedPaths.has(rootPath)) continue;

    const folderConfig = loadWorkspaceConfig(rootPath);
    if (!folderConfig) continue;
    const workspace = normalizeWorkspaceRecord({
      id: folderConfig.id || generateWorkspaceId(),
      name: folderConfig.name,
      slug: folderConfig.slug || extractWorkspaceSlugFromPath(rootPath, ''),
      rootPath,
      kind: folderConfig.kind,
      orgId: folderConfig.orgId,
      createdAt: folderConfig.createdAt || Date.now(),
    });
    if (!isWorkspaceAccessibleToCurrentIdentity(workspace)) continue;

    const staged = stageWorkspaceMutation(
      config,
      workspace,
      !config.activeWorkspaceId,
    );
    commitWorkspaceMutation(staged);
    config = staged.nextConfig;
    trackedPaths.add(rootPath);
  }
}

export async function removeWorkspace(workspaceId: string): Promise<boolean> {
  const config = loadStoredConfig();
  if (!config) return false;

  const index = config.workspaces.findIndex(w => w.id === workspaceId);
  if (index === -1) return false;
  if (!isWorkspaceAccessibleToCurrentIdentity(normalizeWorkspaceRecord(config.workspaces[index]!))) {
    return false;
  }

  config.workspaces.splice(index, 1);

  // If we removed the active workspace, switch to the first accessible one.
  if (config.activeWorkspaceId === workspaceId) {
    config.activeWorkspaceId =
      config.workspaces
        .map((workspace) => normalizeWorkspaceRecord(workspace))
        .find(isWorkspaceAccessibleToCurrentIdentity)?.id ?? null;
  }

  saveConfig(config);

  // Clean up credential store credentials for this workspace
  const manager = getCredentialManager();
  await manager.deleteWorkspaceCredentials(workspaceId);

  // Delete workspace data directory (sessions, plans, etc.)
  const workspaceDataDir = join(WORKSPACES_DIR, workspaceId);
  if (existsSync(workspaceDataDir)) {
    try {
      rmSync(workspaceDataDir, { recursive: true });
    } catch (error) {
      console.error(`[storage] Failed to delete workspace data directory: ${workspaceDataDir}`, error);
    }
  }

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


// Re-export types from core for convenience
export type { StoredAttachment, StoredMessage } from '@craft-agent/core/types';

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
    return readJsonFileSync<WorkspaceConversation>(filePath);
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
    return readJsonFileSync<Plan>(filePath);
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
// Persists composer state (text + attachments) per session across app restarts.
// Two shapes for attachments:
//  - Track P: { path, name } — absolute path captured via webUtils.getPathForFile
//    (file-picker / OS drag). Re-read on hydrate via file:readUserAttachment RPC.
//  - Track C: { path, name, content } — inline content for paste / web-drag Files
//    that never existed on disk. Hydrate reconstructs directly from the stored bytes.
// ============================================

const DRAFTS_FILE = join(CONFIG_DIR, 'drafts.json');

export interface DraftAttachmentContent {
  type: 'image' | 'pdf' | 'text' | 'office' | 'audio' | 'unknown';
  mimeType: string;
  size: number;
  base64?: string;
  text?: string;
  thumbnailBase64?: string;
}

export interface DraftAttachmentRef {
  path: string;
  name: string;
  /** Inline content for attachments without a real filesystem path (paste, web-drag).
   *  When present, hydrate reconstructs from these bytes and skips any disk read. */
  content?: DraftAttachmentContent;
}

export interface SessionDraft {
  text: string;
  attachments?: DraftAttachmentRef[];
}

interface DraftsData {
  drafts: Record<string, SessionDraft>;
  updatedAt: number;
}

const ATTACHMENT_CONTENT_TYPES = new Set(['image', 'pdf', 'text', 'office', 'audio', 'unknown']);

function isAbsoluteDraftPath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  return false;
}

function isDraftAttachmentContent(value: unknown): value is DraftAttachmentContent {
  if (!value || typeof value !== 'object') return false;
  const c = value as DraftAttachmentContent;
  if (!ATTACHMENT_CONTENT_TYPES.has(c.type as string)) return false;
  if (typeof c.mimeType !== 'string') return false;
  if (typeof c.size !== 'number') return false;
  if (c.base64 !== undefined && typeof c.base64 !== 'string') return false;
  if (c.text !== undefined && typeof c.text !== 'string') return false;
  if (c.thumbnailBase64 !== undefined && typeof c.thumbnailBase64 !== 'string') return false;
  return true;
}

function isDraftAttachmentRef(value: unknown): value is DraftAttachmentRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as DraftAttachmentRef;
  if (typeof ref.path !== 'string' || typeof ref.name !== 'string') return false;
  if (ref.content !== undefined && !isDraftAttachmentContent(ref.content)) return false;
  // Post-migration guard: refs without content MUST have an absolute path. This rejects
  // the broken 0.8.11 shape (synthetic path === filename, no content) on first load —
  // user sees empty drafts once instead of attachments silently disappearing forever.
  if (ref.content === undefined && !isAbsoluteDraftPath(ref.path)) return false;
  return true;
}

function isSessionDraft(value: unknown): value is SessionDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as SessionDraft;
  if (typeof candidate.text !== 'string') return false;
  if (candidate.attachments !== undefined) {
    if (!Array.isArray(candidate.attachments)) return false;
    if (!candidate.attachments.every(isDraftAttachmentRef)) return false;
  }
  return true;
}

function isEmptyDraft(draft: SessionDraft): boolean {
  return !draft.text && (!draft.attachments || draft.attachments.length === 0);
}

/**
 * Load all drafts from disk. Entries that don't parse as SessionDraft
 * (e.g. pre-upgrade string drafts) are discarded silently.
 */
function loadDraftsData(): DraftsData {
  try {
    if (!existsSync(DRAFTS_FILE)) {
      return { drafts: {}, updatedAt: 0 };
    }
    const raw = readJsonFileSync<{ drafts?: Record<string, unknown>; updatedAt?: number }>(DRAFTS_FILE);
    const drafts: Record<string, SessionDraft> = {};
    for (const [sessionId, value] of Object.entries(raw.drafts ?? {})) {
      if (isSessionDraft(value)) {
        drafts[sessionId] = value;
      }
    }
    return { drafts, updatedAt: raw.updatedAt ?? 0 };
  } catch {
    return { drafts: {}, updatedAt: 0 };
  }
}

function saveDraftsData(data: DraftsData): void {
  ensureConfigDir();
  data.updatedAt = Date.now();
  writeFileSync(DRAFTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Get the persisted draft for a session (text + attachment refs).
 */
export function getSessionDraft(sessionId: string): SessionDraft | null {
  const data = loadDraftsData();
  return data.drafts[sessionId] ?? null;
}

/**
 * Set the draft for a session. Empty drafts (no text and no attachments)
 * are removed from disk.
 */
export function setSessionDraft(sessionId: string, draft: SessionDraft): void {
  const data = loadDraftsData();
  if (isEmptyDraft(draft)) {
    delete data.drafts[sessionId];
  } else {
    data.drafts[sessionId] = {
      text: draft.text,
      ...(draft.attachments && draft.attachments.length > 0
        ? { attachments: draft.attachments.map(normalizeDraftAttachment) }
        : {}),
    };
  }
  saveDraftsData(data);
}

function normalizeDraftAttachment(ref: DraftAttachmentRef): DraftAttachmentRef {
  const base: DraftAttachmentRef = { path: ref.path, name: ref.name };
  if (ref.content && isDraftAttachmentContent(ref.content)) {
    const c = ref.content;
    base.content = {
      type: c.type,
      mimeType: c.mimeType,
      size: c.size,
      ...(c.base64 !== undefined ? { base64: c.base64 } : {}),
      ...(c.text !== undefined ? { text: c.text } : {}),
      ...(c.thumbnailBase64 !== undefined ? { thumbnailBase64: c.thumbnailBase64 } : {}),
    };
  }
  return base;
}

export function deleteSessionDraft(sessionId: string): void {
  const data = loadDraftsData();
  delete data.drafts[sessionId];
  saveDraftsData(data);
}

/**
 * Get all drafts as a record keyed by sessionId.
 */
export function getAllSessionDrafts(): Record<string, SessionDraft> {
  const data = loadDraftsData();
  return data.drafts;
}

// ============================================
// Theme Storage (App-level only)
// ============================================

import type { ThemeOverrides, ThemeFile, PresetTheme } from './theme.ts';

const APP_THEME_FILE = join(CONFIG_DIR, 'theme.json');
const APP_THEMES_DIR = join(CONFIG_DIR, 'themes');

/**
 * Get the path to the app-level theme override file (~/.craft-agent/theme.json).
 */
export function getAppThemePath(): string {
  return APP_THEME_FILE;
}

// Track if preset themes have been synced this session (prevents re-init on hot reload)
let presetsInitialized = false;

/**
 * Get the app-level themes directory.
 * Preset themes are stored at ~/.craft-agent/themes/
 */
export function getAppThemesDir(): string {
  return APP_THEMES_DIR;
}

/**
 * Load app-level theme overrides
 */
export function loadAppTheme(): ThemeOverrides | null {
  try {
    if (!existsSync(APP_THEME_FILE)) {
      return null;
    }
    return readJsonFileSync<ThemeOverrides>(APP_THEME_FILE);
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


// ============================================
// Preset Themes (app-level)
// ============================================

/**
 * Sync bundled preset themes to disk on launch.
 * Preserves user customizations:
 * - If file doesn't exist → copy from bundle
 * - If file exists but is invalid/corrupt → copy from bundle (auto-heal)
 * - If file exists and is valid → skip (preserve user changes)
 *
 * User-created custom theme files (with non-bundled filenames) are untouched.
 * User color overrides live in theme.json (separate file) and are never touched.
 */
export function ensurePresetThemes(): void {
  // Skip if already initialized this session (prevents re-init on hot reload)
  if (presetsInitialized) {
    return;
  }
  presetsInitialized = true;

  const themesDir = getAppThemesDir();

  // Create themes directory if it doesn't exist
  if (!existsSync(themesDir)) {
    mkdirSync(themesDir, { recursive: true });
  }

  // Resolve bundled themes directory via shared asset resolver
  const bundledThemesDir = getBundledAssetsDir('themes');
  if (!bundledThemesDir) {
    return;
  }

  // Copy bundled preset themes to disk, preserving user customizations.
  // - If file doesn't exist → copy from bundle
  // - If file exists but is invalid/corrupt → copy from bundle (auto-heal)
  // - If file exists and is valid → skip (preserve user changes)
  try {
    const bundledFiles = readdirSync(bundledThemesDir).filter(f => f.endsWith('.json'));
    for (const file of bundledFiles) {
      const srcPath = join(bundledThemesDir, file);
      const destPath = join(themesDir, file);

      // Skip if file exists and is valid (preserve user customizations)
      if (existsSync(destPath) && isValidThemeFile(destPath)) {
        continue;
      }

      // Copy from bundle (new file or auto-heal corrupt file)
      const content = readFileSync(srcPath, 'utf-8');
      writeFileSync(destPath, content, 'utf-8');
    }
  } catch {
    // Ignore errors - themes are optional
  }
}

/**
 * Load all preset themes from app themes directory.
 * Returns array of PresetTheme objects sorted by name.
 */
export function loadPresetThemes(): PresetTheme[] {
  ensurePresetThemes();

  const themesDir = getAppThemesDir();
  if (!existsSync(themesDir)) {
    return [];
  }

  const themes: PresetTheme[] = [];

  try {
    const files = readdirSync(themesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const id = file.replace('.json', '');
      const path = join(themesDir, file);
      try {
        const theme = readJsonFileSync<ThemeFile>(path);
        // Resolve relative backgroundImage paths to file:// URLs
        const resolvedTheme = resolveThemeBackgroundImage(theme, path);
        themes.push({ id, path, theme: resolvedTheme });
      } catch {
        // Skip invalid theme files
      }
    }
  } catch {
    return [];
  }

  // Sort by name (default first, then alphabetically)
  return themes.sort((a, b) => {
    if (a.id === 'default') return -1;
    if (b.id === 'default') return 1;
    return (a.theme.name || a.id).localeCompare(b.theme.name || b.id);
  });
}

/**
 * Get MIME type from file extension for data URL encoding.
 */
function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

/**
 * Resolve relative backgroundImage paths to data URLs.
 * If the backgroundImage is a relative path (no protocol), resolve it relative to the theme's directory,
 * read the file, and convert it to a data URL. This is necessary because the renderer process
 * cannot access file:// URLs directly when running on localhost in dev mode.
 * @param theme - Theme object to process
 * @param themePath - Absolute path to the theme's JSON file
 */
function resolveThemeBackgroundImage(theme: ThemeFile, themePath: string): ThemeFile {
  if (!theme.backgroundImage) {
    return theme;
  }

  // Check if it's already an absolute URL (has protocol like http://, https://, data:)
  const hasProtocol = /^[a-z][a-z0-9+.-]*:/i.test(theme.backgroundImage);
  if (hasProtocol) {
    return theme;
  }

  // It's a relative path - resolve it relative to the theme's directory
  const themeDir = dirname(themePath);
  const absoluteImagePath = join(themeDir, theme.backgroundImage);

  // Read the file and convert to data URL so renderer can use it
  // (file:// URLs are blocked in renderer when running on localhost)
  try {
    if (!existsSync(absoluteImagePath)) {
      console.warn(`Theme background image not found: ${absoluteImagePath}`);
      return theme;
    }

    const imageBuffer = readFileSync(absoluteImagePath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = getMimeType(absoluteImagePath);
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      ...theme,
      backgroundImage: dataUrl,
    };
  } catch (error) {
    console.warn(`Failed to read theme background image: ${absoluteImagePath}`, error);
    return theme;
  }
}

/**
 * Load a specific preset theme by ID.
 * @param id - Theme ID (filename without .json)
 */
export function loadPresetTheme(id: string): PresetTheme | null {
  const themesDir = getAppThemesDir();
  const path = join(themesDir, `${id}.json`);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const theme = readJsonFileSync<ThemeFile>(path);
    // Resolve relative backgroundImage paths to file:// URLs
    const resolvedTheme = resolveThemeBackgroundImage(theme, path);
    return { id, path, theme: resolvedTheme };
  } catch {
    return null;
  }
}

/**
 * Get the path to the app-level preset themes directory.
 */
export function getPresetThemesDir(): string {
  return getAppThemesDir();
}

/**
 * Reset a preset theme to its bundled default.
 * Copies the bundled version over the user's version.
 * Resolves bundled path automatically via getBundledAssetsDir('themes').
 * @param id - Theme ID to reset
 */
export function resetPresetTheme(id: string): boolean {
  // Resolve bundled themes directory via shared asset resolver
  const bundledThemesDir = getBundledAssetsDir('themes');
  if (!bundledThemesDir) {
    return false;
  }

  const bundledPath = join(bundledThemesDir, `${id}.json`);
  const themesDir = getAppThemesDir();
  const destPath = join(themesDir, `${id}.json`);

  if (!existsSync(bundledPath)) {
    return false;
  }

  try {
    const content = readFileSync(bundledPath, 'utf-8');
    if (!existsSync(themesDir)) {
      mkdirSync(themesDir, { recursive: true });
    }
    writeFileSync(destPath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Color Theme Selection (stored in config)
// ============================================

/**
 * Get the currently selected color theme ID.
 * Returns 'default' if not set.
 */
export function getColorTheme(): string {
  const config = loadStoredConfig();
  if (config?.colorTheme !== undefined) {
    return config.colorTheme;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.colorTheme;
}

/**
 * Set the color theme ID.
 */
export function setColorTheme(themeId: string): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.colorTheme = themeId;
  saveConfig(config);
}

// ============================================
// Auto-Update Dismissed Version
// ============================================

/**
 * Get the dismissed update version.
 * Returns null if no version is dismissed.
 */
export function getDismissedUpdateVersion(): string | null {
  const config = loadStoredConfig();
  return config?.dismissedUpdateVersion ?? null;
}

/**
 * Set the dismissed update version.
 * Pass the version string to dismiss notifications for that version.
 */
export function setDismissedUpdateVersion(version: string): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.dismissedUpdateVersion = version;
  saveConfig(config);
}

/**
 * Clear the dismissed update version.
 * Call this when a new version is released (or on successful update).
 */
export function clearDismissedUpdateVersion(): void {
  const config = loadStoredConfig();
  if (!config) return;
  delete config.dismissedUpdateVersion;
  saveConfig(config);
}

// ============================================
// LLM Connections
// ============================================

// Re-export types for convenience (imports are at top of file)
export type {
  LlmConnection,
  LlmProviderType,
  LlmAuthType,
  LlmConnectionWithStatus,
} from './llm-connections.ts';

/**
 * Migrate Codex (OpenAI) and Copilot connections to Pi backend.
 * Runs on startup — transparently routes existing users through PiAgent.
 *
 * No re-auth needed: credentials are keyed by connection slug (not provider),
 * and PiAgent reads the same OAuth tokens via piAuthProvider.
 *
 * Migration rules:
 * - openai + oauth       → pi + openai-codex
 * - openai + api_key     → pi + openai
 * - openai_compat        → pi + openai  (keep baseUrl)
 * - copilot              → pi + github-copilot
 * - defaultModel reset to Pi's default (stale Codex/Copilot model IDs dropped)
 * - codexPath removed (no longer needed)
 */
function migrateCodexCopilotToPi(config: StoredConfig): boolean {
  if (!config.llmConnections) return false;
  let changed = false;

  for (const connection of config.llmConnections) {
    // Cast to string for legacy providerType values that were removed from LlmProviderType
    // but may still exist on disk in old configs. Cast to any for legacy codexPath field.
    const providerStr = connection.providerType as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connAny = connection as any;
    if (providerStr === 'openai' && connection.authType === 'oauth') {
      connection.providerType = 'pi';
      connection.piAuthProvider = 'openai-codex';
      connection.name = 'ChatGPT Plus (via Pi)';
      delete connAny.codexPath;
      connection.defaultModel = undefined; // reset — backfill picks Pi default
      connection.models = undefined;
      changed = true;
    } else if (providerStr === 'openai' && (connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint')) {
      connection.providerType = 'pi';
      connection.piAuthProvider = 'openai';
      connection.name = 'OpenAI API (via Pi)';
      delete connAny.codexPath;
      connection.defaultModel = undefined;
      connection.models = undefined;
      changed = true;
    } else if (providerStr === 'openai_compat') {
      connection.providerType = 'pi';
      connection.piAuthProvider = 'openai';
      // keep baseUrl for custom endpoints
      delete connAny.codexPath;
      connection.defaultModel = undefined;
      connection.models = undefined;
      changed = true;
    } else if (providerStr === 'copilot') {
      connection.providerType = 'pi';
      connection.piAuthProvider = 'github-copilot';
      connection.name = 'GitHub Copilot (via Pi)';
      delete connAny.codexPath;
      connection.defaultModel = undefined;
      connection.models = undefined;
      changed = true;
    }
  }

  // Clean up openaiVariant config field (Codex-specific A/B testing, no longer relevant)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const configAny = config as any;
  if (configAny.openaiVariant) {
    delete configAny.openaiVariant;
    changed = true;
  }

  return changed;
}

/**
 * Backfill models and defaultModel on ALL connections.
 * Ensures built-in connections (anthropic, openai) always have models populated,
 * not just compat connections.
 */
export function shouldMigratePiOpenAiProvider(connection: Pick<LlmConnection, 'providerType' | 'piAuthProvider' | 'authType' | 'baseUrl'>): boolean {
  // Legacy cleanup: old ChatGPT Plus OAuth connections may still be tagged as `openai`.
  // Only migrate those to `openai-codex`.
  //
  // IMPORTANT: Do NOT migrate API-key or custom-endpoint connections:
  // - `api_key` / `api_key_with_endpoint` with `openai` must remain regular OpenAI API auth.
  // - forcing them to `openai-codex` routes requests to ChatGPT backend auth and breaks on restart.
  if (!isPiProvider(connection.providerType)) return false;
  if (connection.piAuthProvider !== 'openai') return false;
  if (connection.authType !== 'oauth') return false;
  if (typeof connection.baseUrl === 'string' && connection.baseUrl.trim().length > 0) return false;
  return true;
}

export function shouldRepairPiApiKeyCodexProvider(connection: Pick<LlmConnection, 'providerType' | 'piAuthProvider' | 'authType'>): boolean {
  // Repair broken state from previous startup migrations:
  // API-key connections tagged as `openai-codex` try ChatGPT backend JWT auth and fail.
  if (!isPiProvider(connection.providerType)) return false;
  if (connection.piAuthProvider !== 'openai-codex') return false;
  return connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint';
}

function normalizeModelIds(models?: Array<{ id: string } | string>): string[] {
  if (!models) return [];
  return models
    .map(m => typeof m === 'string' ? m : m.id)
    .filter((id): id is string => !!id && id.trim().length > 0);
}

function modelSetEquals(a: string[], b: string[]): boolean {
  const as = new Set(a);
  const bs = new Set(b);
  if (as.size !== bs.size) return false;
  for (const id of as) {
    if (!bs.has(id)) return false;
  }
  return true;
}

export function inferModelSelectionMode(
  connection: Pick<LlmConnection, 'models'>,
  providerDefaultModelIds: string[],
): 'automaticallySyncedFromProvider' | 'userDefined3Tier' {
  const currentIds = normalizeModelIds(connection.models);
  if (currentIds.length === 0) return 'automaticallySyncedFromProvider';
  return modelSetEquals(currentIds, providerDefaultModelIds)
    ? 'automaticallySyncedFromProvider'
    : 'userDefined3Tier';
}

function backfillAllConnectionModels(config: StoredConfig): boolean {
  if (!config.llmConnections) return false;
  let changed = false;
  for (const connection of config.llmConnections) {
    // Repair previously broken API-key migration first.
    if (shouldRepairPiApiKeyCodexProvider(connection)) {
      connection.piAuthProvider = 'openai';
      changed = true;
    }

    // Migrate only legacy OAuth-backed Pi OpenAI connections to ChatGPT backend provider key.
    if (shouldMigratePiOpenAiProvider(connection)) {
      connection.piAuthProvider = 'openai-codex';
      changed = true;
    }

    const defaultModels = getDefaultModelsForConnection(connection.providerType, connection.piAuthProvider);
    const defaultModel = getDefaultModelForConnection(connection.providerType, connection.piAuthProvider);
    const providerDefaultModelIds = normalizeModelIds(defaultModels as Array<{ id: string } | string>);

    // Note: bedrock connections are migrated to pi + amazon-bedrock by migrateLegacyProviderTypes()
    // before this function runs, so no bedrock-specific normalization needed here.

    if (isPiProvider(connection.providerType) && connection.piAuthProvider) {
      // Copilot models are always server-managed (GitHub policy controls which
      // models are enabled), so force automaticallySyncedFromProvider regardless
      // of what inferModelSelectionMode would compute from stale static SDK data.
      const isCopilot = connection.piAuthProvider === 'github-copilot';
      const mode = isCopilot
        ? 'automaticallySyncedFromProvider' as const
        : (connection.modelSelectionMode ?? inferModelSelectionMode(connection, providerDefaultModelIds));
      if (connection.modelSelectionMode !== mode) {
        debug('[storage] backfill mode inferred', {
          slug: connection.slug,
          piAuthProvider: connection.piAuthProvider,
          from: connection.modelSelectionMode,
          to: mode,
          currentModelCount: normalizeModelIds(connection.models).length,
        });
        connection.modelSelectionMode = mode;
        changed = true;
      }

      if (mode === 'automaticallySyncedFromProvider') {
        const currentIds = normalizeModelIds(connection.models);
        if (providerDefaultModelIds.length > 0 && !modelSetEquals(currentIds, providerDefaultModelIds)) {
          connection.models = defaultModels;
          changed = true;
        }
      } else {
        const currentIds = normalizeModelIds(connection.models);
        if (providerDefaultModelIds.length > 0) {
          const allowedIds = new Set(providerDefaultModelIds);
          const canonicalCurrentIds = currentIds.map((id) => {
            if (allowedIds.has(id)) return id;
            if (!id.startsWith('pi/')) {
              const prefixed = `pi/${id}`;
              if (allowedIds.has(prefixed)) return prefixed;
            }
            return id;
          });
          const filtered = canonicalCurrentIds.filter(id => allowedIds.has(id));

          if (!modelSetEquals(canonicalCurrentIds, currentIds) || filtered.length !== currentIds.length) {
            debug('[storage] backfill userDefined filtered', {
              slug: connection.slug,
              piAuthProvider: connection.piAuthProvider,
              beforeCount: currentIds.length,
              canonicalCount: canonicalCurrentIds.length,
              afterCount: filtered.length,
              beforeFirst5: currentIds.slice(0, 5),
              afterFirst5: filtered.slice(0, 5),
            });
            connection.models = filtered;
            changed = true;
          }

          if (filtered.length === 0) {
            debug('[storage] backfill userDefined fallback-to-defaults', {
              slug: connection.slug,
              piAuthProvider: connection.piAuthProvider,
              defaultCount: providerDefaultModelIds.length,
            });
            connection.models = defaultModels;
            changed = true;
          }
        }
      }
    }

    if (defaultModels.length > 0 && (!connection.models || (Array.isArray(connection.models) && connection.models.length === 0))) {
      connection.models = defaultModels;
      changed = true;
    }

    if (!connection.defaultModel && defaultModel) {
      connection.defaultModel = defaultModel;
      changed = true;
    }

    // Validate that existing defaultModel is in the models list
    if (connection.defaultModel && connection.models && Array.isArray(connection.models) && connection.models.length > 0) {
      const modelIds = connection.models.map(m => typeof m === 'string' ? m : m.id);
      if (!modelIds.includes(connection.defaultModel)) {
        // Reset to first available model in the list
        const firstModelId = modelIds[0];
        if (firstModelId) {
          connection.defaultModel = firstModelId;
        }
        changed = true;
      }
    }
  }
  return changed;
}

const OPUS_DEFAULT_ID = 'claude-opus-4-8';
const OPUS_FALLBACK_ID = 'claude-opus-4-7';

function defaultModelIdsForConnection(connection: LlmConnection): Set<string> {
  return new Set(
    getDefaultModelsForConnection(connection.providerType, connection.piAuthProvider)
      .map(model => typeof model === 'string' ? model : model.id),
  );
}

function normalizeConnectionModelId(connection: LlmConnection, modelId: string): string {
  const normalized = normalizeDeprecatedModelId(modelId);

  // Bedrock connections run through Pi and need native inference-profile IDs.
  if (connection.providerType === 'pi' && connection.piAuthProvider === 'amazon-bedrock') {
    const hasPiPrefix = normalized.startsWith('pi/');
    const bare = hasPiPrefix ? normalized.slice(3) : normalized;
    const native = toBedrockNativeId(bare);
    const defaults = defaultModelIdsForConnection(connection);
    const prefixedCandidate = `pi/${native}`;
    const candidate = hasPiPrefix || defaults.has(prefixedCandidate) ? prefixedCandidate : native;

    // Pi 0.73.1 does not yet expose Opus 4.8. Keep 4.7 as the selectable fallback
    // until the upstream catalog adds 4.8; the preferred-default list is already future-proofed.
    if (bare === OPUS_DEFAULT_ID || native.endsWith(`.${OPUS_DEFAULT_ID}`)) {
      const fallbackNative = toBedrockNativeId(OPUS_FALLBACK_ID);
      const prefixedFallback = `pi/${fallbackNative}`;
      const fallback = defaults.has(prefixedFallback) ? prefixedFallback : fallbackNative;
      if (!defaults.has(candidate) && defaults.has(fallback)) return fallback;
    }
    return candidate;
  }

  if (connection.providerType === 'pi') {
    const defaults = defaultModelIdsForConnection(connection);
    const hasPiPrefix = normalized.startsWith('pi/');
    const bare = hasPiPrefix ? normalized.slice(3) : normalized;
    const prefixedCandidate = `pi/${bare}`;
    const candidate = hasPiPrefix || defaults.has(prefixedCandidate) ? prefixedCandidate : normalized;
    const prefixedFallback = `pi/${OPUS_FALLBACK_ID}`;
    const fallback = defaults.has(prefixedFallback) ? prefixedFallback : OPUS_FALLBACK_ID;
    if ((bare === OPUS_DEFAULT_ID)
      && !defaults.has(candidate)
      && defaults.has(fallback)) {
      return fallback;
    }
    if (bare === OPUS_DEFAULT_ID && candidate !== normalized) {
      return candidate;
    }
  }

  return normalized;
}

function displayNameForMigratedModel(modelId: string): string {
  const bareModelId = modelId.startsWith('pi/') ? modelId.slice(3) : modelId;
  return getModelDisplayName(bareModelId);
}

function withUpdatedModelEntry(
  connection: LlmConnection,
  entry: ModelDefinition | string,
  nextId: string,
): ModelDefinition | string {
  if (typeof entry === 'string') {
    if (connection.providerType === 'anthropic' && nextId === OPUS_DEFAULT_ID) {
      return { ...getModelById(OPUS_DEFAULT_ID)! };
    }
    return nextId;
  }

  const nextEntry: ModelDefinition = { ...entry, id: nextId };
  if (connection.providerType === 'anthropic' && nextId === OPUS_DEFAULT_ID) {
    return { ...getModelById(OPUS_DEFAULT_ID)! };
  }
  if (nextEntry.name && /Opus 4\.[56]/.test(nextEntry.name)) {
    nextEntry.name = displayNameForMigratedModel(nextId);
  }
  return nextEntry;
}

function modelEntryForDefault(connection: LlmConnection, modelId: string): ModelDefinition | string {
  if (connection.providerType === 'anthropic' && modelId === OPUS_DEFAULT_ID) {
    return { ...getModelById(OPUS_DEFAULT_ID)! };
  }
  return modelId;
}

/**
 * Migrate deprecated Opus 4.5/4.6 IDs and previous direct-Anthropic Opus 4.7 defaults to the current default Opus model.
 * Custom/compat endpoints are intentionally skipped because provider-specific aliases may differ.
 */
function migrateLegacyOpusToDefaultOpus(config: StoredConfig): boolean {
  if (!config.llmConnections) return false;

  let changed = false;

  for (const connection of config.llmConnections) {
    if (connection.providerType !== 'anthropic' && connection.providerType !== 'pi') continue;

    if (connection.defaultModel) {
      let normalizedDefault = normalizeConnectionModelId(connection, connection.defaultModel);
      // The previous direct-Anthropic default was Opus 4.7. Move existing
      // direct-Anthropic defaults to Opus 4.8 while keeping 4.7 in the model list.
      // Pi stays on 4.7 until the current Pi catalog exposes 4.8.
      if (connection.providerType === 'anthropic' && normalizedDefault === OPUS_FALLBACK_ID) {
        normalizedDefault = OPUS_DEFAULT_ID;
      }
      if (normalizedDefault !== connection.defaultModel) {
        connection.defaultModel = normalizedDefault;
        changed = true;
      }
    }

    if (connection.models && Array.isArray(connection.models)) {
      const nextModels: Array<ModelDefinition | string> = [];
      const seen = new Set<string>();
      let connectionModelsChanged = false;

      for (const entry of connection.models) {
        const currentId = typeof entry === 'string' ? entry : entry.id;
        const nextId = normalizeConnectionModelId(connection, currentId);

        if (seen.has(nextId)) {
          connectionModelsChanged = true;
          continue;
        }
        seen.add(nextId);

        if (nextId !== currentId) {
          nextModels.push(withUpdatedModelEntry(connection, entry, nextId));
          connectionModelsChanged = true;
        } else {
          nextModels.push(entry);
        }
      }

      if (connection.defaultModel && !seen.has(connection.defaultModel)) {
        nextModels.unshift(modelEntryForDefault(connection, connection.defaultModel));
        connectionModelsChanged = true;
      }

      if (connectionModelsChanged) {
        connection.models = nextModels;
        changed = true;
      }
    }
  }

  return changed;
}

/**
 * Restore claude-opus-4-6 to direct Anthropic connections that were previously
 * force-migrated to 4.8 and no longer list 4.6. Runs once per user (tracked via
 * config.migrationsApplied). Never touches `defaultModel` — users keep whatever
 * default they had, and can switch models themselves.
 *
 * The marker is versioned ("-2") because the pre-4.8 restore already consumed
 * 'opus-4-6-restored' in long-time users' configs; this restore must fire
 * again after the 4.8-era removal.
 *
 * TODO(opus-4.6-sunset): drop this call and the function when 4.6 is deprecated.
 */
function restoreOpus46ToAnthropicConnections(config: StoredConfig): boolean {
  const OPUS_46_ID = 'claude-opus-4-6';
  const MARKER = 'opus-4-6-restored-2';
  const alreadyRan = config.migrationsApplied?.includes(MARKER) ?? false;

  // Anthropic connection.models entries are stored as full ModelDefinition
  // objects (via backfillAllConnectionModels). The model picker reads
  // model.name and falls back to the raw ID for bare strings, so we must
  // push the object form to render as "Opus 4.6".
  const opus46Model = getModelById(OPUS_46_ID);
  if (!opus46Model) {
    // Defensive — 4.6 is registered in this same PR, should never happen.
    if (!alreadyRan) {
      config.migrationsApplied = [...(config.migrationsApplied ?? []), MARKER];
      return true;
    }
    return false;
  }

  let changed = false;

  for (const connection of config.llmConnections ?? []) {
    if (connection.providerType !== 'anthropic') continue;
    if (!Array.isArray(connection.models) || connection.models.length === 0) continue;

    // Idempotent shape repair: normalize any bare-string 'claude-opus-4-6'
    // entry to the ModelDefinition object form. Runs regardless of the
    // one-shot marker because it's a display-shape fix, not a new entry.
    for (let i = 0; i < connection.models.length; i++) {
      const m = connection.models[i];
      if (typeof m === 'string' && m === OPUS_46_ID) {
        connection.models[i] = { ...opus46Model };
        changed = true;
      }
    }

    // One-shot restore: only append 4.6 on the first run for a given user.
    // A deliberate removal after the marker is set should stick.
    if (alreadyRan) continue;

    const ids = connection.models.map(m => typeof m === 'string' ? m : m.id);
    if ((ids.includes(OPUS_DEFAULT_ID) || ids.includes(OPUS_FALLBACK_ID)) && !ids.includes(OPUS_46_ID)) {
      connection.models.push({ ...opus46Model });
      changed = true;
    }
  }

  // Mark the migration as seen on the first run — even when no connection
  // was eligible — so subsequent runs don't keep re-checking.
  if (!alreadyRan) {
    config.migrationsApplied = [...(config.migrationsApplied ?? []), MARKER];
    return true;
  }
  return changed;
}

/**
 * Migrate Sonnet 4.5 to Sonnet 4.6 for direct Anthropic connections.
 * Updates stored model IDs and names for direct Anthropic connections.
 */
function migrateSonnet45ToSonnet46(config: StoredConfig): boolean {
  if (!config.llmConnections) return false;

  const SONNET_45_ID = 'claude-sonnet-4-5-20250929';
  const SONNET_46_ID = 'claude-sonnet-4-6';

  let changed = false;

  for (const connection of config.llmConnections) {
    // Only migrate direct Anthropic connections (not compat/third-party)
    if (connection.providerType !== 'anthropic') continue;

    // Migrate defaultModel
    if (connection.defaultModel === SONNET_45_ID) {
      connection.defaultModel = SONNET_46_ID;
      changed = true;
    }

    // Migrate models array
    if (connection.models && Array.isArray(connection.models)) {
      const hasNew = connection.models.some(m =>
        (typeof m === 'string' ? m : m.id) === SONNET_46_ID
      );

      if (hasNew) {
        // New model already exists — just remove the old entry to avoid duplicates
        const before = connection.models.length;
        connection.models = connection.models.filter(m =>
          (typeof m === 'string' ? m : m.id) !== SONNET_45_ID
        );
        if (connection.models.length !== before) changed = true;
      } else {
        // New model doesn't exist — rename the old entry in place
        for (let i = 0; i < connection.models.length; i++) {
          const model = connection.models[i];
          if (typeof model === 'string' && model === SONNET_45_ID) {
            connection.models[i] = SONNET_46_ID;
            changed = true;
          } else if (typeof model === 'object' && model.id === SONNET_45_ID) {
            model.id = SONNET_46_ID;
            if (model.name?.includes('4.5')) {
              model.name = model.name.replace('4.5', '4.6');
            }
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}

/**
 * Migrate Sonnet 4.5 to Sonnet 4.6 in workspace default models.
 */
function migrateWorkspaceSonnet45ToSonnet46(config: StoredConfig): void {
  if (!config.workspaces) return;

  const SONNET_45_ID = 'claude-sonnet-4-5-20250929';
  const SONNET_46_ID = 'claude-sonnet-4-6';

  for (const workspace of config.workspaces) {
    const wsConfig = loadWorkspaceConfig(workspace.rootPath);
    if (!wsConfig?.defaults?.model) continue;

    if (wsConfig.defaults.model === SONNET_45_ID) {
      wsConfig.defaults.model = SONNET_46_ID;
      saveWorkspaceConfig(workspace.rootPath, wsConfig);
    }
  }
}

/**
 * Migrate deprecated/previous Opus defaults in workspace default models to the current default Opus model.
 */
function migrateWorkspaceLegacyOpusToDefaultOpus(config: StoredConfig): void {
  if (!config.workspaces) return;

  for (const workspace of config.workspaces) {
    const wsConfig = loadWorkspaceConfig(workspace.rootPath);
    if (!wsConfig?.defaults?.model) continue;

    const normalized = normalizeDeprecatedModelId(wsConfig.defaults.model);
    const nextModel = normalized === OPUS_FALLBACK_ID ? OPUS_DEFAULT_ID : normalized;
    if (nextModel !== wsConfig.defaults.model) {
      wsConfig.defaults.model = nextModel;
      saveWorkspaceConfig(workspace.rootPath, wsConfig);
    }
  }
}

/**
 * Migrate legacy provider types to the active set (anthropic, anthropic_compat, pi, pi_compat).
 *
 * 1. providerType==='bedrock' → 'pi' with piAuthProvider='amazon-bedrock'.
 *    Model IDs are normalized to Bedrock-native (pi-prefixed) for Pi SDK resolution.
 *
 * 2. providerType==='vertex' → 'pi' with piAuthProvider='google-vertex'.
 *
 * 3. providerType==='anthropic_compat' → 'anthropic_compat' with customEndpoint.api='anthropic-messages'.
 *    Preserves baseUrl and models; authType 'api_key_with_endpoint' stays the same.
 *
 * Also normalizes Pi+Bedrock connections that already have correct providerType.
 */
function migrateLegacyProviderTypes(config: StoredConfig): boolean {
  if (!config.llmConnections) return false;

  let changed = false;

  for (const connection of config.llmConnections) {
    // Cast to string for legacy values removed from LlmProviderType
    const providerStr = connection.providerType as string;

    // --- bedrock → pi + amazon-bedrock ---
    if (providerStr === 'bedrock') {
      (connection as { providerType: LlmProviderType }).providerType = 'pi';
      connection.piAuthProvider = connection.piAuthProvider || 'amazon-bedrock';
      // Normalize model IDs to Bedrock-native (pi-prefixed) for Pi SDK
      if (connection.defaultModel) {
        connection.defaultModel = normalizePiBedrockId(connection.defaultModel);
      }
      if (connection.models && Array.isArray(connection.models)) {
        for (let i = 0; i < connection.models.length; i++) {
          const model = connection.models[i];
          if (typeof model === 'string') {
            connection.models[i] = normalizePiBedrockId(model);
          } else if (model && typeof model === 'object') {
            model.id = normalizePiBedrockId(model.id);
          }
        }
      }
      changed = true;
      continue;
    }

    // --- vertex → pi + google-vertex ---
    if (providerStr === 'vertex') {
      (connection as { providerType: LlmProviderType }).providerType = 'pi';
      connection.piAuthProvider = 'google-vertex';
      changed = true;
      continue;
    }

    // --- anthropic_compat → anthropic_compat + customEndpoint ---
    if (providerStr === 'anthropic_compat') {
      (connection as { providerType: LlmProviderType }).providerType = 'anthropic_compat';
      connection.customEndpoint = { api: 'anthropic-messages' };
      // authType 'api_key_with_endpoint' stays; baseUrl and models are preserved
      changed = true;
      continue;
    }

    // Forward migration from the temporary shared compat bucket used for
    // Anthropic-compatible endpoints.
    if (
      connection.providerType === 'pi_compat'
      && connection.customEndpoint?.api === 'anthropic-messages'
    ) {
      connection.providerType = 'anthropic_compat';
      delete connection.piAuthProvider;
      changed = true;
      continue;
    }

    // Forward: Pi+Bedrock connections need Bedrock-native IDs (pi-prefixed) for Pi SDK resolution
    if (connection.providerType === 'pi' && connection.piAuthProvider === 'amazon-bedrock') {
      if (connection.defaultModel) {
        const normalized = normalizePiBedrockId(connection.defaultModel);
        if (normalized !== connection.defaultModel) {
          connection.defaultModel = normalized;
          changed = true;
        }
      }
      if (connection.models && Array.isArray(connection.models)) {
        for (let i = 0; i < connection.models.length; i++) {
          const model = connection.models[i];
          if (typeof model === 'string') {
            const normalized = normalizePiBedrockId(model);
            if (normalized !== model) { connection.models[i] = normalized; changed = true; }
          } else if (model && typeof model === 'object') {
            const normalized = normalizePiBedrockId(model.id);
            if (normalized !== model.id) { model.id = normalized; changed = true; }
          }
        }
      }
    }
  }

  return changed;
}

/** Normalize a pi/-prefixed model ID for Bedrock: pi/claude-opus-4-8 → pi/us.anthropic.claude-opus-4-8 */
function normalizePiBedrockId(id: string): string {
  const bare = id.startsWith('pi/') ? id.slice(3) : id;
  const native = toBedrockNativeId(normalizeDeprecatedModelId(bare));
  return `pi/${native}`;
}

/**
 * Migrate modelDefaults onto connection.defaultModel, then delete modelDefaults.
 * If user had set modelDefaults.anthropic, apply it to the default anthropic connection.
 * Same for openai. Then remove modelDefaults from config.
 */
function migrateModelDefaultsToConnections(config: StoredConfig): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const configAny = config as any;
  if (!configAny.modelDefaults || !config.llmConnections) return false;
  let changed = false;

  // Apply anthropic model default to the default anthropic connection
  if (configAny.modelDefaults.anthropic) {
    const defaultSlug = config.defaultLlmConnection;
    const anthropicConn = config.llmConnections.find(c =>
      c.slug === defaultSlug && c.providerType === 'anthropic'
    ) || config.llmConnections.find(c =>
      c.providerType === 'anthropic'
    );
    if (anthropicConn) {
      anthropicConn.defaultModel = configAny.modelDefaults.anthropic;
      changed = true;
    }
  }

  // Apply openai model default to the default openai connection
  // Cast providerType to string for legacy values removed from LlmProviderType
  if (configAny.modelDefaults.openai) {
    const openaiConn = config.llmConnections.find(c =>
      (c.providerType as string) === 'openai' || (c.providerType as string) === 'openai_compat'
    );
    if (openaiConn) {
      openaiConn.defaultModel = configAny.modelDefaults.openai;
      changed = true;
    }
  }

  // Delete modelDefaults
  delete configAny.modelDefaults;
  changed = true;

  return changed;
}

/**
 * Migrate legacy auth config to LLM connections.
 * Call this on app startup before any getLlmConnections() calls.
 *
 * This is a one-time migration that converts:
 * - Legacy authType field → LlmConnection in llmConnections array
 * - Legacy anthropicBaseUrl → LlmConnection.baseUrl
 * - Legacy customModel → LlmConnection.defaultModel
 * - Legacy model → modelDefaults (per provider)
 *
 * After migration, the legacy fields are deleted since they are no longer used.
 */
export function migrateLegacyLlmConnectionsConfig(): void {
  const config = loadStoredConfig();
  if (!config) return;

  const normalizeModelList = (models?: Array<{ id: string } | string>): string[] => {
    if (!models) return [];
    return models
      .map(model => (typeof model === 'string' ? model : model.id))
      .filter(Boolean);
  };

  const applyCompatDefaults = (target: StoredConfig): boolean => {
    if (!target.llmConnections) return false;
    let changed = false;
    for (const connection of target.llmConnections) {
      // Cast to string for legacy 'openai_compat' values that may still exist on disk
      const providerStr = connection.providerType as string;
      if (providerStr !== 'openai_compat') {
        continue;
      }
      const compatDefaults = getDefaultModelsForConnection(connection.providerType).map(
        m => typeof m === 'string' ? m : m.id
      );
      const normalizedModels = normalizeModelList(connection.models);
      if (normalizedModels.length === 0) {
        connection.models = [...compatDefaults];
        changed = true;
      } else if (normalizedModels.length !== (connection.models?.length ?? 0)) {
        connection.models = [...normalizedModels];
        changed = true;
      }
      // Backfill any new default models that are missing from existing connections
      // (e.g., Sonnet added to compat defaults after user already created connection)
      let currentModels = normalizeModelList(connection.models);
      for (const defaultModel of compatDefaults) {
        if (!currentModels.includes(defaultModel)) {
          currentModels = [...currentModels, defaultModel];
          changed = true;
        }
      }
      if (changed) {
        connection.models = currentModels;
      }
      const currentDefault = connection.defaultModel?.trim();
      if (!currentDefault) {
        connection.defaultModel = (normalizeModelList(connection.models)[0] ?? compatDefaults[0]);
        changed = true;
      } else if (!normalizeModelList(connection.models).includes(currentDefault)) {
        connection.models = [currentDefault, ...normalizeModelList(connection.models).filter(m => m !== currentDefault)];
        changed = true;
      }
    }
    return changed;
  };

  // Already migrated - llmConnections array exists
  if (config.llmConnections !== undefined) {
    // Clean up any remaining legacy fields from previous runs
    let needsSave = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configAny = config as any;
    if ('authType' in config) {
      delete configAny.authType;
      needsSave = true;
    }
    if ('anthropicBaseUrl' in config) {
      delete configAny.anthropicBaseUrl;
      needsSave = true;
    }
    if ('customModel' in config) {
      delete configAny.customModel;
      needsSave = true;
    }
    if ('model' in config) {
      const legacyModel = configAny.model as string | undefined;
      if (legacyModel) {
        const provider = getModelProvider(legacyModel) ?? 'anthropic';
        configAny.modelDefaults = { ...(configAny.modelDefaults ?? {}), [provider]: legacyModel };
      }
      delete configAny.model;
      needsSave = true;
    }
    // Note: applyCompatDefaults() is NOT called here for already-migrated configs.
    // Compat connections are user-owned after creation — the app should not
    // silently extend or override the user's model list on every startup.
    // Compat defaults are only applied during fresh connection creation or
    // first-time legacy migration (the config.llmConnections === undefined path below).

    // Phase 1a-bis: Migrate Codex/Copilot connections to Pi backend
    if (migrateCodexCopilotToPi(config)) {
      needsSave = true;
    }

    // Phase 1b: Normalize legacy Opus IDs/defaults before Pi model-list filtering.
    if (migrateLegacyOpusToDefaultOpus(config)) {
      needsSave = true;
    }
    // Phase 1c: Backfill models/defaultModel on ALL connections (not just compat)
    // This ensures built-in connections (anthropic, openai) always have models populated
    if (backfillAllConnectionModels(config)) {
      needsSave = true;
    }
    // Phase 1d: Migrate modelDefaults onto connection.defaultModel, then delete modelDefaults
    if (migrateModelDefaultsToConnections(config)) {
      needsSave = true;
    }
    // Phase 1e: Normalize anything introduced by modelDefaults.
    if (migrateLegacyOpusToDefaultOpus(config)) {
      needsSave = true;
    }
    // Phase 1f: Migrate legacy/previous Opus workspace defaults → current default Opus
    migrateWorkspaceLegacyOpusToDefaultOpus(config);
    // Phase 1g: Migrate Sonnet 4.5 → Sonnet 4.6 for direct Anthropic connections
    if (migrateSonnet45ToSonnet46(config)) {
      needsSave = true;
    }
    // Phase 1h: Migrate Sonnet 4.5 → Sonnet 4.6 in workspace default models
    migrateWorkspaceSonnet45ToSonnet46(config);
    // Phase 1j: Migrate legacy provider types (bedrock/vertex/anthropic_compat → active provider set)
    if (migrateLegacyProviderTypes(config)) {
      needsSave = true;
    }
    // Phase 1k: Normalize legacy Opus IDs introduced by provider-type migration.
    // Important for old Bedrock connections: they become Pi+Bedrock first, then can
    // fall back from Opus 4.8 to 4.7 while Pi's catalog lacks 4.8.
    if (migrateLegacyOpusToDefaultOpus(config)) {
      needsSave = true;
    }
    // Phase 1m: Restore Opus 4.6 to direct Anthropic connections that were
    // previously force-migrated away from it (one-shot, guarded by marker).
    // TODO(opus-4.6-sunset): drop this call and the function when 4.6 is deprecated.
    if (restoreOpus46ToAnthropicConnections(config)) {
      needsSave = true;
    }

    if (needsSave) {
      saveConfig(config);
    }
    return;
  }

  // Initialize empty array
  config.llmConnections = [];

  // Legacy migration: if user had authType set, create a connection for them
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const configAny = config as any;
  const legacyAuthType = configAny.authType as AuthType | undefined;
  const legacyBaseUrl = configAny.anthropicBaseUrl as string | undefined;
  const legacyCustomModel = configAny.customModel as string | undefined;
  const legacyModel = configAny.model as string | undefined;

  if (legacyAuthType) {
    let migrated: LlmConnection | null = null;

    if (legacyAuthType === 'oauth_token') {
      // Claude Max OAuth
      migrated = {
        slug: 'claude-max',
        name: 'Claude Max',
        providerType: 'anthropic',
        authType: 'oauth',
        models: getDefaultModelsForConnection('anthropic'),
        createdAt: Date.now(),
      };
    } else if (legacyAuthType === 'codex_oauth') {
      // ChatGPT Plus OAuth → Pi backend
      migrated = {
        slug: 'codex',
        name: 'ChatGPT Plus (via Pi)',
        providerType: 'pi',
        authType: 'oauth',
        piAuthProvider: 'openai-codex',
        modelSelectionMode: 'automaticallySyncedFromProvider',
        models: getDefaultModelsForConnection('pi', 'openai-codex'),
        createdAt: Date.now(),
      };
    } else if (legacyAuthType === 'codex_api_key') {
      // OpenAI API Key → Pi backend
      migrated = {
        slug: 'codex-api',
        name: 'OpenAI API (via Pi)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'openai',
        modelSelectionMode: 'automaticallySyncedFromProvider',
        models: getDefaultModelsForConnection('pi', 'openai'),
        createdAt: Date.now(),
      };
    } else if (legacyAuthType === 'api_key') {
      // Anthropic API Key - check if custom endpoint (compat mode → anthropic_compat)
      const hasCustomEndpoint = !!legacyBaseUrl;
      if (hasCustomEndpoint) {
        migrated = {
          slug: 'anthropic-api',
          name: 'Custom Anthropic-Compatible',
          providerType: 'anthropic_compat',
          authType: 'api_key_with_endpoint',
          customEndpoint: { api: 'anthropic-messages' },
          models: getDefaultModelsForConnection('anthropic_compat'),
          createdAt: Date.now(),
        };
      } else {
        migrated = {
          slug: 'anthropic-api',
          name: 'Anthropic (API Key)',
          providerType: 'anthropic',
          authType: 'api_key',
          models: getDefaultModelsForConnection('anthropic'),
          createdAt: Date.now(),
        };
      }
    }

    if (migrated) {
      // Validate the migrated connection has a valid provider/auth combination
      if (!isValidProviderAuthCombination(migrated.providerType, migrated.authType)) {
        console.warn(
          `[config] Legacy migration created invalid provider/auth combination: ` +
          `providerType=${migrated.providerType}, authType=${migrated.authType} ` +
          `(slug: ${migrated.slug}). Skipping migration for this connection.`
        );
      } else {
        // Apply legacy baseUrl if set
        if (legacyBaseUrl) {
          migrated.baseUrl = legacyBaseUrl;
        }

        // Apply legacy customModel if set
        if (legacyCustomModel) {
          migrated.defaultModel = legacyCustomModel;
        }

        config.llmConnections.push(migrated);
        config.defaultLlmConnection = migrated.slug;
      }
    }
  }

  // Delete legacy fields after migration
  delete configAny.authType;
  delete configAny.anthropicBaseUrl;
  delete configAny.customModel;
  delete configAny.model;

  if (legacyModel) {
    const provider = getModelProvider(legacyModel) ?? 'anthropic';
    configAny.modelDefaults = { ...(configAny.modelDefaults ?? {}), [provider]: legacyModel };
  }

  // Run the same backfill and migration on newly created connections
  migrateCodexCopilotToPi(config);
  backfillAllConnectionModels(config);
  migrateModelDefaultsToConnections(config);
  migrateLegacyOpusToDefaultOpus(config);
  migrateWorkspaceLegacyOpusToDefaultOpus(config);

  saveConfig(config);
}

/**
 * Fix defaultLlmConnection references that point to non-existent connections.
 * This can happen when a connection is removed or was never created
 * (e.g. "anthropic-api" is set as default but only "claude-max" exists).
 *
 * Fixes both the global defaultLlmConnection and per-workspace defaults.
 * Called on app startup alongside other migrations.
 */
export function migrateOrphanedDefaultConnections(): void {
  const config = loadStoredConfig();
  if (!config) return;
  if (!config.llmConnections || config.llmConnections.length === 0) return;

  let changed = false;

  // Fix global default if it points to a non-existent connection
  if (ensureDefaultLlmConnection(config)) {
    changed = true;
  }

  // Fix workspace defaults that point to non-existent connections
  try {
    const workspaces = getWorkspaces();
    for (const ws of workspaces) {
      const wsConfig = loadWorkspaceConfig(ws.rootPath);
      if (wsConfig?.defaults?.defaultLlmConnection) {
        const exists = config.llmConnections.some(
          c => c.slug === wsConfig.defaults!.defaultLlmConnection
        );
        if (!exists) {
          delete wsConfig.defaults.defaultLlmConnection;
          saveWorkspaceConfig(ws.rootPath, wsConfig);
        }
      }
    }
  } catch (error) {
    console.error('Failed to clean up workspace default connection references:', error);
  }

  if (changed) {
    saveConfig(config);
  }
}

/**
 * Seed the default LLM connection on first run.
 *
 * When the config has no LLM connections at all (fresh install), a single
 * "rox-kimi" connection is created pointing at the Rox gateway
 * (https://api.rox.one/v1) and runs on the OMP backend (providerType 'omp')
 * with kimi-K3 as the default model. OMP reads the gateway credentials from
 * its own config (~/.omp/agent/config.yml); the ROX_API_KEY env var is still
 * mirrored into the craft credential store for potential pi_compat fallback.
 *
 * The API key is NOT baked into the repo. It is stored in the encrypted
 * credential store when available from the ROX_API_KEY environment variable
 * at first run; otherwise the connection is created keyless and the user is
 * asked for a key in the onboarding/settings UI.
 *
 * Called on app startup before migrateOrphanedDefaultConnections().
 */
export const ROX_DEFAULT_CONNECTION_SLUG = 'rox-kimi';

export async function seedDefaultLlmConnection(): Promise<void> {
  // A null config means a fresh install with no config.json yet — seed into a
  // minimal config; workspace/onboarding flows will fill in the rest.
  let config = loadStoredConfig();
  let createdFresh = false;
  if (!config) {
    if (existsSync(CONFIG_FILE)) return; // unreadable/corrupt — leave it alone
    config = { workspaces: [], activeWorkspaceId: null, activeSessionId: null };
    createdFresh = true;
  }
  if (config.llmConnections && config.llmConnections.length > 0) return;

  const connection: LlmConnection = {
    slug: ROX_DEFAULT_CONNECTION_SLUG,
    name: 'Rox (Kimi K3) · OMP',
    providerType: 'omp',
    baseUrl: 'https://api.rox.one/v1',
    authType: 'none',
    models: [
      {
        id: 'kimi-K3',
        name: 'Kimi K3',
        shortName: 'Kimi K3',
        description: 'Kimi K3 via api.rox.one gateway',
        provider: 'pi',
        contextWindow: 262144,
        supportsThinking: false,
      },
    ],
    defaultModel: 'kimi-K3',
    modelSelectionMode: 'automaticallySyncedFromProvider',
    createdAt: Date.now(),
  };

  config.llmConnections = [connection];
  config.defaultLlmConnection = connection.slug;
  saveConfig(config);
  if (createdFresh) {
    debug('[config] Seeded default rox-kimi connection into a fresh config.json');
  } else {
    debug('[config] Seeded default rox-kimi connection (existing config had no LLM connections)');
  }

  // Store the API key in the encrypted credential store when provided via env.
  const envApiKey = process.env.ROX_API_KEY?.trim();
  if (envApiKey) {
    try {
      await getCredentialManager().setLlmApiKey(connection.slug, envApiKey);
      debug('[config] Seeded API key for default rox-kimi connection from ROX_API_KEY');
    } catch (error) {
      console.error('[config] Failed to seed API key for default connection:', error);
    }
  }
}

/**
 * Ensure default LLM connection is set correctly.
 * Called internally by write operations to fix inconsistent state.
 * This is NOT called on read - reads never modify config.
 */
function ensureDefaultLlmConnection(config: StoredConfig): boolean {
  if (!config.llmConnections || config.llmConnections.length === 0) {
    return false;
  }

  const defaultExists = config.llmConnections.some(c => c.slug === config.defaultLlmConnection);
  if (!config.defaultLlmConnection || !defaultExists) {
    config.defaultLlmConnection = config.llmConnections[0]!.slug;
    return true;
  }

  return false;
}

/**
 * Migrate legacy global credentials to LLM connection-scoped credentials.
 * This ensures that credentials saved before the LLM connections system
 * are available through the new connection-based auth.
 *
 * Called on app startup (async operation, credentials use encrypted storage).
 *
 * Migration mapping:
 * - claude_oauth::global → llm_oauth::claude-max
 * - anthropic_api_key::global → llm_api_key::anthropic-api
 *
 * After successful migration, legacy credentials are deleted to prevent
 * stale data and reduce credential store clutter.
 */
export async function migrateLegacyCredentials(): Promise<void> {
  const manager = getCredentialManager();
  const debug = (await import('../utils/debug.ts')).debug;

  // Migrate Claude OAuth: claude_oauth::global → llm_oauth::claude-max
  const legacyClaudeOAuth = await manager.getClaudeOAuthCredentials();
  if (legacyClaudeOAuth?.accessToken) {
    // Only migrate if llm_oauth::claude-max doesn't exist yet
    const existingLlmOAuth = await manager.getLlmOAuth('claude-max');
    if (!existingLlmOAuth) {
      await manager.setLlmOAuth('claude-max', {
        accessToken: legacyClaudeOAuth.accessToken,
        refreshToken: legacyClaudeOAuth.refreshToken,
        expiresAt: legacyClaudeOAuth.expiresAt,
      });
      debug('[storage] Migrated legacy Claude OAuth to llm_oauth::claude-max');

      // Delete legacy credential after successful migration
      // Global credentials use just the type - the key format is {type}::global
      try {
        await manager.delete({ type: 'claude_oauth' });
        debug('[storage] Deleted legacy claude_oauth::global credential');
      } catch (error) {
        debug('[storage] Failed to delete legacy claude_oauth::global:', error);
      }
    }
  }

  // Migrate Anthropic API key: anthropic_api_key::global → llm_api_key::anthropic-api
  const legacyApiKey = await manager.getApiKey();
  if (legacyApiKey) {
    // Only migrate if llm_api_key::anthropic-api doesn't exist yet
    const existingLlmApiKey = await manager.getLlmApiKey('anthropic-api');
    if (!existingLlmApiKey) {
      await manager.setLlmApiKey('anthropic-api', legacyApiKey);
      debug('[storage] Migrated legacy Anthropic API key to llm_api_key::anthropic-api');

      // Delete legacy credential after successful migration
      // Global credentials use just the type - the key format is {type}::global
      try {
        await manager.delete({ type: 'anthropic_api_key' });
        debug('[storage] Deleted legacy anthropic_api_key::global credential');
      } catch (error) {
        debug('[storage] Failed to delete legacy anthropic_api_key::global:', error);
      }
    }
  }
}

/**
 * Get all LLM connections.
 * Returns only user-added connections (no auto-populated built-ins).
 *
 * Note: This function is read-only and never modifies config.
 * Call migrateLegacyLlmConnectionsConfig() on app startup to handle migration.
 */
export function getLlmConnections(): LlmConnection[] {
  const config = loadStoredConfig();
  if (!config) return [];

  // Return empty array if not migrated yet - caller should call migration on startup
  return config.llmConnections || [];
}

/**
 * Get a specific LLM connection by slug.
 * @param slug - Connection slug
 * @returns Connection or null if not found
 */
export function getLlmConnection(slug: string): LlmConnection | null {
  const connections = getLlmConnections();
  return connections.find(c => c.slug === slug) || null;
}

/**
 * Add a new LLM connection.
 * @param connection - Connection to add (slug must be unique)
 * @returns true if added, false if slug already exists
 */
export function addLlmConnection(connection: LlmConnection): boolean {
  const config = loadStoredConfig();
  if (!config) return false;

  // Initialize array if not yet migrated (safe default for write operations)
  if (!config.llmConnections) {
    config.llmConnections = [];
  }

  // Check for duplicate slug
  if (config.llmConnections.some(c => c.slug === connection.slug)) {
    return false;
  }

  // Add connection with timestamp
  config.llmConnections.push({
    ...connection,
    createdAt: connection.createdAt || Date.now(),
  });

  // Ensure default is set after adding first connection
  ensureDefaultLlmConnection(config);

  saveConfig(config);
  return true;
}

/**
 * Update an existing LLM connection.
 * @param slug - Connection slug to update
 * @param updates - Partial updates to apply (slug is ignored)
 * @returns true if updated, false if not found
 */
export function updateLlmConnection(slug: string, updates: Partial<Omit<LlmConnection, 'slug'>>): boolean {
  const config = loadStoredConfig();
  if (!config) return false;

  // No connections means nothing to update
  if (!config.llmConnections || config.llmConnections.length === 0) {
    return false;
  }

  const connections = config.llmConnections;
  const index = connections.findIndex(c => c.slug === slug);
  if (index === -1) return false;

  const existing = connections[index]!;
  const toModelIds = (models?: Array<{ id: string } | string>): string[] =>
    (models ?? []).map(m => typeof m === 'string' ? m : m.id);

  connections[index] = {
    // Preserve required fields from existing
    slug: existing.slug,
    name: updates.name ?? existing.name,
    providerType: updates.providerType ?? existing.providerType,
    type: updates.type ?? existing.type, // Legacy field
    authType: updates.authType ?? existing.authType,
    createdAt: updates.createdAt ?? existing.createdAt,
    // Optional fields from updates or existing
    baseUrl: updates.baseUrl !== undefined ? updates.baseUrl : existing.baseUrl,
    models: updates.models !== undefined ? updates.models : existing.models,
    defaultModel: updates.defaultModel !== undefined ? updates.defaultModel : existing.defaultModel,
    modelSelectionMode: updates.modelSelectionMode !== undefined ? updates.modelSelectionMode : existing.modelSelectionMode,
    // Pi auth provider
    piAuthProvider: updates.piAuthProvider !== undefined ? updates.piAuthProvider : existing.piAuthProvider,
    // Custom endpoint protocol (Anthropic/OpenAI compatible)
    customEndpoint: updates.customEndpoint !== undefined ? updates.customEndpoint : existing.customEndpoint,
    // Mid-stream send behavior (steer vs queue) — read via resolveMidStreamBehavior()
    midStreamBehavior: updates.midStreamBehavior !== undefined ? updates.midStreamBehavior : existing.midStreamBehavior,
    // Resolved Anthropic OAuth identity (issue #838) — preserved across unrelated saves
    oauthAccountUuid: updates.oauthAccountUuid !== undefined ? updates.oauthAccountUuid : existing.oauthAccountUuid,
    oauthAccountEmail: updates.oauthAccountEmail !== undefined ? updates.oauthAccountEmail : existing.oauthAccountEmail,
    oauthOrganizationUuid: updates.oauthOrganizationUuid !== undefined ? updates.oauthOrganizationUuid : existing.oauthOrganizationUuid,
    oauthOrganizationName: updates.oauthOrganizationName !== undefined ? updates.oauthOrganizationName : existing.oauthOrganizationName,
    oauthProfileVerifiedAt: updates.oauthProfileVerifiedAt !== undefined ? updates.oauthProfileVerifiedAt : existing.oauthProfileVerifiedAt,
    // Timestamps
    lastUsedAt: updates.lastUsedAt !== undefined ? updates.lastUsedAt : existing.lastUsedAt,
  };

  const updated = connections[index]!;
  if (updated.providerType === 'pi') {
    const beforeModelIds = toModelIds(existing.models);
    const afterModelIds = toModelIds(updated.models);
    const changed =
      existing.defaultModel !== updated.defaultModel ||
      existing.modelSelectionMode !== updated.modelSelectionMode ||
      !modelSetEquals(beforeModelIds, afterModelIds);

    if (changed) {
      const stack = (new Error().stack ?? '').split('\n').slice(2, 7).map(s => s.trim());
      debug('[storage] updateLlmConnection(pi) changed', {
        slug,
        before: {
          mode: existing.modelSelectionMode,
          defaultModel: existing.defaultModel,
          modelCount: beforeModelIds.length,
          modelsFirst5: beforeModelIds.slice(0, 5),
        },
        after: {
          mode: updated.modelSelectionMode,
          defaultModel: updated.defaultModel,
          modelCount: afterModelIds.length,
          modelsFirst5: afterModelIds.slice(0, 5),
        },
        updates: {
          keys: Object.keys(updates),
          defaultModel: updates.defaultModel,
          modelSelectionMode: updates.modelSelectionMode,
          modelsCount: Array.isArray(updates.models) ? updates.models.length : undefined,
        },
        stack,
      });
    }
  }

  saveConfig(config);
  return true;
}

/**
 * Delete an LLM connection.
 * @param slug - Connection slug to delete
 * @returns true if deleted, false if not found
 */
export function deleteLlmConnection(slug: string): boolean {
  const config = loadStoredConfig();
  if (!config) return false;

  // No connections means nothing to delete
  if (!config.llmConnections || config.llmConnections.length === 0) {
    return false;
  }

  const connections = config.llmConnections;
  const index = connections.findIndex(c => c.slug === slug);
  if (index === -1) return false;

  connections.splice(index, 1);

  // If deleted connection was the default, reset to first remaining or clear
  if (config.defaultLlmConnection === slug) {
    config.defaultLlmConnection = connections.length > 0 ? connections[0]!.slug : undefined;
  }

  saveConfig(config);

  // Clean up workspace references to the deleted connection (non-blocking)
  try {
    const workspaces = getWorkspaces();
    for (const ws of workspaces) {
      const wsConfig = loadWorkspaceConfig(ws.rootPath);
      if (wsConfig?.defaults?.defaultLlmConnection === slug) {
        wsConfig.defaults.defaultLlmConnection = undefined;
        saveWorkspaceConfig(ws.rootPath, wsConfig);
      }
    }
  } catch (error) {
    console.error('Failed to clean up workspace references:', error);
  }

  // Clean up stored credentials for this connection (API keys, OAuth tokens)
  // This is fire-and-forget but we log errors for debugging
  const credentialManager = getCredentialManager();
  credentialManager.delete({ type: 'llm_api_key', connectionSlug: slug }).catch((error) => {
    console.error(`[storage] Failed to delete API key credential for connection '${slug}':`, error);
  });
  credentialManager.delete({ type: 'llm_oauth', connectionSlug: slug }).catch((error) => {
    console.error(`[storage] Failed to delete OAuth credential for connection '${slug}':`, error);
  });

  return true;
}

/**
 * Get the default LLM connection slug.
 * @returns Default connection slug, or null if no connections exist
 */
export function getDefaultLlmConnection(): string | null {
  const config = loadStoredConfig();
  if (!config) return null;

  // If no connections, return null
  if (!config.llmConnections || config.llmConnections.length === 0) {
    return null;
  }

  return config.defaultLlmConnection || config.llmConnections[0]?.slug || null;
}

/**
 * Set the default LLM connection.
 * @param slug - Connection slug to set as default
 * @returns true if set, false if connection not found
 */
export function setDefaultLlmConnection(slug: string): boolean {
  const config = loadStoredConfig();
  if (!config) return false;

  // No connections means nothing to set as default
  if (!config.llmConnections || config.llmConnections.length === 0) {
    return false;
  }

  // Verify connection exists
  if (!config.llmConnections.some(c => c.slug === slug)) {
    return false;
  }

  config.defaultLlmConnection = slug;
  saveConfig(config);
  return true;
}

/**
 * Get the app-level default thinking level for new sessions.
 * Falls back to bundled config-defaults when unset.
 */
export function getDefaultThinkingLevel(): ThinkingLevel {
  const config = loadStoredConfig();
  if (config?.defaultThinkingLevel) {
    const normalized = normalizeThinkingLevel(config.defaultThinkingLevel);
    if (normalized) return normalized;
  }
  const defaults = loadConfigDefaults();
  return normalizeThinkingLevel(defaults.workspaceDefaults.thinkingLevel) ?? 'medium';
}

/**
 * Set the app-level default thinking level for new sessions.
 * @returns true if persisted, false if config could not be loaded
 */
export function setDefaultThinkingLevel(level: ThinkingLevel): boolean {
  const config = loadStoredConfig();
  if (!config) return false;

  config.defaultThinkingLevel = level;
  saveConfig(config);
  return true;
}

/**
 * Update the lastUsedAt timestamp for a connection.
 * @param slug - Connection slug
 */
export function touchLlmConnection(slug: string): void {
  const config = loadStoredConfig();
  if (!config) return;

  // No connections means nothing to touch
  if (!config.llmConnections) return;

  const connection = config.llmConnections.find(c => c.slug === slug);
  if (connection) {
    connection.lastUsedAt = Date.now();
    saveConfig(config);
  }
}

// ============================================
// Network Proxy Settings
// ============================================

import type { NetworkProxySettings } from './types.ts';

function normalizeProxyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeNetworkProxySettings(
  settings: NetworkProxySettings,
): NetworkProxySettings {
  return {
    enabled: Boolean(settings.enabled),
    httpProxy: normalizeProxyString(settings.httpProxy),
    httpsProxy: normalizeProxyString(settings.httpsProxy),
    noProxy: normalizeProxyString(settings.noProxy),
  };
}

/**
 * Get the current network proxy settings.
 * Returns undefined if not configured.
 */
export function getNetworkProxySettings(): NetworkProxySettings | undefined {
  const config = loadStoredConfig();
  return config?.networkProxy;
}

/**
 * Persist network proxy settings.
 * Deletes the key when disabled and all proxy fields are empty.
 */
export function setNetworkProxySettings(settings: NetworkProxySettings): void {
  const config = loadStoredConfig();
  if (!config) return;

  const normalized = normalizeNetworkProxySettings(settings);

  // Remove the key entirely when proxy is disabled and all fields are blank
  if (!normalized.enabled && !normalized.httpProxy && !normalized.httpsProxy && !normalized.noProxy) {
    delete config.networkProxy;
  } else {
    config.networkProxy = normalized;
  }

  saveConfig(config);
}

// ============================================
// Setup Deferred (user skipped onboarding)
// ============================================

export function isSetupDeferred(): boolean {
  return loadStoredConfig()?.setupDeferred === true;
}

export function setSetupDeferred(deferred: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  if (deferred) {
    config.setupDeferred = true;
  } else {
    delete config.setupDeferred;
  }
  saveConfig(config);
}

// ============================================
// Tool Icons (CLI tool icons for turn card display)
// ============================================

import { copyFileSync } from 'fs';

const TOOL_ICONS_DIR_NAME = 'tool-icons';

/**
 * Returns the path to the tool-icons directory: ~/.craft-agent/tool-icons/
 */
export function getToolIconsDir(): string {
  return join(CONFIG_DIR, TOOL_ICONS_DIR_NAME);
}

/**
 * Ensure tool-icons directory exists and has bundled defaults.
 * Resolves bundled path automatically via getBundledAssetsDir('tool-icons').
 * Copies bundled tool-icons.json and icon files on first run.
 * Only copies files that don't already exist (preserves user customizations).
 */
export function ensureToolIcons(): void {
  const toolIconsDir = getToolIconsDir();

  // Create tool-icons directory if it doesn't exist
  if (!existsSync(toolIconsDir)) {
    mkdirSync(toolIconsDir, { recursive: true });
  }

  // Resolve bundled tool-icons directory via shared asset resolver
  const bundledToolIconsDir = getBundledAssetsDir('tool-icons');
  if (!bundledToolIconsDir) {
    return;
  }

  // Copy each bundled file if it doesn't exist in the target dir
  // This includes tool-icons.json and all icon files (png, ico, svg, jpg)
  try {
    const bundledFiles = readdirSync(bundledToolIconsDir);
    for (const file of bundledFiles) {
      const destPath = join(toolIconsDir, file);
      if (!existsSync(destPath)) {
        const srcPath = join(bundledToolIconsDir, file);
        copyFileSync(srcPath, destPath);
      }
    }
  } catch {
    // Ignore errors — tool icons are optional enhancement
  }
}

// ============================================
// Server Mode Configuration
// ============================================

import { DEFAULT_SERVER_CONFIG, type ServerConfig } from './server-config.ts';
import { randomUUID } from 'crypto';

/**
 * Get the current server configuration.
 * Returns defaults if not yet configured.
 */
export function getServerConfig(): ServerConfig {
  const config = loadStoredConfig();
  return config?.serverConfig ?? { ...DEFAULT_SERVER_CONFIG };
}

/**
 * Persist server configuration.
 * Auto-generates a stable auth token on first enable if none exists.
 */
export function setServerConfig(serverConfig: ServerConfig): void {
  const config = loadStoredConfig();
  if (!config) return;

  // Generate a stable token when first enabled (or if token is missing)
  if (serverConfig.enabled && !serverConfig.token) {
    serverConfig.token = randomUUID();
  }

  config.serverConfig = serverConfig;
  saveConfig(config);
}
