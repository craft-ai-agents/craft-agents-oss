/**
 * Workspace Types
 *
 * Workspaces are the top-level organizational unit. Everything (sources, sessions)
 * is scoped to a workspace.
 *
 * Directory structure:
 * ~/.craft-agent/workspaces/{slug}/
 *   ├── config.json      - Workspace settings
 *   ├── sources/         - Data sources (MCP, API, local)
 *   └── sessions/        - Conversation sessions
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';
import type { DeveloperConfig } from '../config/self-edit.ts';

/**
 * Local MCP server configuration
 * Controls whether stdio-based (local subprocess) MCP servers can be spawned.
 */
export interface LocalMcpConfig {
  /**
   * Whether local (stdio) MCP servers are enabled for this workspace.
   * When false, only HTTP-based MCP servers will be used.
   * Default: true (can be overridden by CRAFT_LOCAL_MCP_ENABLED env var)
   */
  enabled: boolean;
}

export const WORKSPACE_FORMAT_VERSION = 1;

export type WorkspaceStorageMode = 'solo' | 'shared-folder' | 'git';

export type SharedFolderProvider =
  | 'google-drive'
  | 'dropbox'
  | 'icloud-drive'
  | 'onedrive'
  | 'syncthing'
  | 'generic-folder';

export interface SoloWorkspaceStorageConfig {
  mode: 'solo';
  portabilityVersion: 1;
}

export interface SharedFolderWorkspaceStorageConfig {
  mode: 'shared-folder';
  portabilityVersion: 1;
  provider: SharedFolderProvider;
  providerLabel?: string;
  sharedRootId: string;
  enabledAt: string;
  movedFrom?: string;
  vaultPolicy: 'copy-into-workspace' | 'allow-external-with-overrides';
  pathPolicy: 'relative-required';
}

export interface GitWorkspaceStorageConfig {
  mode: 'git';
  portabilityVersion: 1;
  remoteUrl?: string;
  branch?: string;
  vaultPolicy: 'git-lfs' | 'external-media-folder' | 'text-only';
  pathPolicy: 'relative-required';
}

export type WorkspaceStorageConfig =
  | SoloWorkspaceStorageConfig
  | SharedFolderWorkspaceStorageConfig
  | GitWorkspaceStorageConfig;

export interface WorkspaceTeamRunnerHandover {
  from?: string;
  to: string;
  initiatedAt: string;
  revision: number;
}

export type WorkspaceTeamRole = 'owner' | 'editor';

export interface WorkspaceTeamMember {
  memberId: string;
  displayName: string;
  role: WorkspaceTeamRole;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkspaceTeamConfig {
  enabled: boolean;
  teamId: string;
  revision: number;
  members?: WorkspaceTeamMember[];
  runnerMachineId?: string;
  runnerHandover?: WorkspaceTeamRunnerHandover;
  automationsPolicy: 'runner-only' | 'manual-only';
  backgroundTriggersEnabled: boolean;
  runnerMissedTickPolicy?: 'skip' | 'run-once';
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMovedToTombstone {
  path: string;
  migrationId: string;
  movedAt: string;
}

/**
 * Workspace configuration (stored in config.json)
 */
export interface WorkspaceConfig {
  formatVersion?: number;
  id: string;
  name: string;
  slug: string; // Folder name (URL-safe)

  /**
   * Default settings for new sessions in this workspace
   */
  defaults?: {
    model?: string;
    /** Default LLM connection for new sessions (slug). Overrides global default. */
    defaultLlmConnection?: string;
    enabledSourceSlugs?: string[]; // Sources to enable by default
    permissionMode?: PermissionMode; // Default permission mode ('safe', 'ask', 'allow-all')
    cyclablePermissionModes?: PermissionMode[]; // Which modes can be cycled with SHIFT+TAB (min 2, default: all 3)
    workingDirectory?: string;
    thinkingLevel?: ThinkingLevel; // Default thinking level for new sessions (default: 'medium')
    colorTheme?: string; // Color theme override for this workspace (preset ID). Undefined = inherit from app default.
  };

  /**
   * Local MCP server configuration.
   * Controls whether stdio-based MCP servers can be spawned in this workspace.
   * Resolution order: ENV (CRAFT_LOCAL_MCP_ENABLED) > workspace config > default (true)
   */
  localMcpServers?: LocalMcpConfig;

  /**
   * Workspace-specific developer capabilities. These override app-level
   * developer settings when present.
   */
  developer?: DeveloperConfig;

  /**
   * Local-first storage mode metadata. Missing means legacy solo workspace.
   */
  storage?: WorkspaceStorageConfig;

  /**
   * Team-mode metadata. Generated mirror lives at team/config.json.
   */
  team?: WorkspaceTeamConfig;

  /**
   * Tombstone left behind at an old workspace path after moving to shared storage.
   */
  movedTo?: WorkspaceMovedToTombstone;

  createdAt: number;
  updatedAt: number;
}

/**
 * Workspace creation input
 */
export interface CreateWorkspaceInput {
  name: string;
  defaults?: WorkspaceConfig['defaults'];
}

/**
 * Loaded workspace with resolved sources
 */
export interface LoadedWorkspace {
  config: WorkspaceConfig;
  sourceSlugs: string[]; // Available source slugs (not fully loaded to save memory)
  sessionCount: number; // Number of sessions
}

/**
 * Workspace summary for listing (lightweight)
 */
export interface WorkspaceSummary {
  slug: string;
  name: string;
  sourceCount: number;
  sessionCount: number;
  createdAt: number;
  updatedAt: number;
}
