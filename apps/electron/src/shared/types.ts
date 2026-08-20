// =============================================================================
// Protocol re-exports (channels, DTOs, events, wire types)
// =============================================================================
export * from '@craft-agent/shared/protocol'

// =============================================================================
// Package re-exports (convenience for renderer imports)
// =============================================================================

// Core types
import type {
  Message as CoreMessage,
  MessageRole as CoreMessageRole,
  TypedError,
  TokenUsage as CoreTokenUsage,
  WorkspaceInfo as CoreWorkspaceInfo,
  Workspace as CoreWorkspace,
  SessionMetadata as CoreSessionMetadata,
  StoredAttachment as CoreStoredAttachment,
  ContentBadge,
  ToolDisplayMeta,
  AnnotationV1,
  RemoteServerConfig,
  SessionMemoryMode,
} from '@craft-agent/core/types';

// Mode types from dedicated subpath export (avoids pulling in SDK)
import type { PermissionMode } from '@craft-agent/shared/agent/modes';
export type { PermissionMode };
export { PERMISSION_MODE_CONFIG } from '@craft-agent/shared/agent/modes';

// Thinking level types
import type { ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels';
import type { ContextDocContent, ContextDocInfo } from '@craft-agent/shared/context-docs';
import type {
  AutomationGraphProjection,
  SaveAutomationGraphPayload,
  SavedAutomationGraph,
} from '@craft-agent/shared/automations';
export type { ContextDocContent, ContextDocInfo };
import type { BundledSkillPackStatus } from '@craft-agent/shared/skills';
export type { BundledSkillPackStatus };
import type {
  MarketplaceCatalogResult,
  MarketplaceEntryStats,
  MarketplaceInstallResult,
  MarketplaceRemoveResult,
} from '@craft-agent/shared/marketplace';
export type {
  MarketplaceCatalogResult,
  MarketplaceEntryStats,
  MarketplaceInstallResult,
  MarketplaceRemoveResult,
};
import type { AddLessonResult, Lesson, LessonCategory, LessonScope, MemoryInsights, PendingSkill, PendingSkillDiff, ProjectMemoryDto, PromoteLessonResult, PromotionCandidate, SessionProvenance, SkillExportResult, SkillPruneResult, SkillUsageMap } from '@craft-agent/shared/memory/types';
export type { Lesson, LessonCategory, LessonScope, MemoryInsights };
export type { ThinkingLevel };
export { THINKING_LEVELS, DEFAULT_THINKING_LEVEL } from '@craft-agent/shared/agent/thinking-levels';

export type {
  CoreMessage as Message,
  CoreMessageRole as MessageRole,
  TypedError,
  CoreTokenUsage as TokenUsage,
  CoreWorkspaceInfo as WorkspaceInfo,
  CoreWorkspace as Workspace,
  CoreSessionMetadata as SessionMetadata,
  CoreStoredAttachment as StoredAttachment,
  ContentBadge,
  ToolDisplayMeta,
  AnnotationV1,
};

/**
 * Client-side request authority for local workspace creation. Team creation
 * requires a selected organization; personal creation must never carry one.
 */
export type WorkspaceCreationAuthority =
  | { kind: 'team'; orgId: string }
  | { kind?: 'personal'; orgId?: never };

/** Lifecycle evidence returned only after a local workspace is durable and active. */
export interface WorkspaceActivation {
  workspaceId: string;
  activeWorkspaceId: string;
  session: {
    id: string;
    name?: string;
    createdAt: number;
    lastUsedAt: number;
  };
}

/** Local creation includes activation; remote creation retains its legacy workspace response. */
export type WorkspaceCreationResult = Workspace & { activation?: WorkspaceActivation };

// Auth types for onboarding
import type { AuthState, SetupNeeds } from '@craft-agent/shared/auth/types';
import type { AuthType } from '@craft-agent/shared/config/types';
export type { AuthState, SetupNeeds, AuthType };

import type {
  SshHostConfig,
  SshHostInput,
  SshConfigImportSuggestion,
} from '@craft-agent/shared/config';
export type { SshHostConfig, SshHostInput, SshConfigImportSuggestion };

/** Renderer-safe copies of the SSH defaults (the renderer bundle can't value-import
 * the Node-only shared config); parity is asserted in ssh-tunnel.test.ts. */
export const DEFAULT_SSH_PORT = 22;
export const DEFAULT_REMOTE_SERVER_PORT = 9100;

// SSH wire types — type-only re-exports from the main-process modules (erased at
// build, so the renderer bundle never pulls in Node-only code).
import type { BootstrapPhase as SshBootstrapPhase } from '../main/ssh-tunnel/server-bootstrap';
import type { SshConnectionPhase, SshConnectionStatus } from '../main/ssh-tunnel/connection-resolver';
export type { SshBootstrapPhase, SshConnectionPhase, SshConnectionStatus };

/** Progress event pushed to the renderer during one-click bootstrap (main adds hostId). */
export interface SshBootstrapProgress {
  hostId: string;
  phase: SshBootstrapPhase;
  /** Human-readable detail (never contains secrets). */
  detail?: string;
}

// Credential health types
import type { CredentialHealthStatus, CredentialHealthIssue, CredentialHealthIssueType } from '@craft-agent/shared/credentials/types';
export type { CredentialHealthStatus, CredentialHealthIssue, CredentialHealthIssueType };

// Identity Center (S-07)
import type {
  IdentityState,
  UpdateProfileInput,
  ServiceProvider,
  ServiceConnection,
} from '@craft-agent/core/platform/identity/types';
export type { IdentityState, UpdateProfileInput, ServiceProvider, ServiceConnection };

// Extension Center (S-05) + SiYuan plugin bridge / Extension Host (W6)
import type {
  BridgeProjectedContributions,
  CatalogEntry,
  CatalogFilter,
  ExtensionHostStatus,
  ExtensionRecord,
  ExtensionsChangedPayload,
  ExtensionsGetStateResult,
  ExtensionsListCatalogResult,
  ExtensionsListInstalledResult,
  ExtensionsSetEnabledResult,
  ExtensionStateFile,
  PluginBridgeGetProjectionsArgs,
  PluginBridgeInstallBazaarArgs,
  PluginBridgeInstallBazaarResult,
  PluginBridgeListResult,
  PluginBridgeSetEnabledArgs,
  PluginBridgeSetEnabledResult,
  PluginBridgeUninstallBazaarArgs,
  PluginBridgeUninstallBazaarResult,
} from '@craft-agent/shared/extensions'
export type {
  BridgeProjectedContributions,
  CatalogEntry,
  CatalogFilter,
  ExtensionHostStatus,
  ExtensionRecord,
  ExtensionsChangedPayload,
  ExtensionsGetStateResult,
  ExtensionsListCatalogResult,
  ExtensionsListInstalledResult,
  ExtensionsSetEnabledResult,
  ExtensionStateFile,
  PluginBridgeGetProjectionsArgs,
  PluginBridgeInstallBazaarArgs,
  PluginBridgeInstallBazaarResult,
  PluginBridgeListResult,
  PluginBridgeSetEnabledArgs,
  PluginBridgeSetEnabledResult,
  PluginBridgeUninstallBazaarArgs,
  PluginBridgeUninstallBazaarResult,
}

// Source types for session source selection
import type { LoadedSource, FolderSourceConfig, SourceConnectionStatus } from '@craft-agent/shared/sources/types';
export type { LoadedSource, FolderSourceConfig, SourceConnectionStatus };

// Skill types
import type { LoadedSkill, SkillMetadata } from '@craft-agent/shared/skills/types';
export type { LoadedSkill, SkillMetadata };

// Resource bundle types (cross-workspace export/import)
import type { ExportResourcesOptions, ExportResult, ResourceImportMode, ResourceBundle, ResourceImportResult } from '@craft-agent/shared/resources';
export type { ExportResourcesOptions, ExportResult, ResourceImportMode, ResourceBundle, ResourceImportResult };

// LLM connection types
import type { LlmConnection, LlmConnectionWithStatus, LlmAuthType, LlmProviderType, NetworkProxySettings } from '@craft-agent/shared/config';
export type { LlmConnection, LlmConnectionWithStatus, LlmAuthType, LlmProviderType, NetworkProxySettings };
// Knowledge provider contract types (P1 read-only — spec 2026-08-07-siyuan-integration/03;
// mutation types are intentionally not surfaced: no mutation channels exist at P1)
import type {
  ContextMode,
  ContextPayload,
  ContextSnapshot,
  KnowledgeCapabilities,
  KnowledgeConnection,
  KnowledgeNode,
  KnowledgeRef,
  KnowledgeWorkEnvelope,
  SearchHit,
  SearchInput,
  SearchPage,
} from '@craft-agent/core/knowledge';
export type {
  ContextMode,
  ContextPayload,
  ContextSnapshot,
  KnowledgeCapabilities,
  KnowledgeConnection,
  KnowledgeNode,
  KnowledgeRef,
  KnowledgeWorkEnvelope,
  SearchHit,
  SearchInput,
  SearchPage,
};

import type { ViewConfig as KnowledgeViewConfig } from '@craft-agent/shared/views';
export type { KnowledgeViewConfig };

// Toolchain manager types (first-run download manager, spec 2026-08-06)
import type { ToolStatus as ToolchainToolStatus, ToolName as ToolchainToolName } from '@craft-agent/shared/toolchain/types';
export type { ToolchainToolStatus, ToolchainToolName };

// OpenClaw runtime and security audit data contracts. These are data-only,
// remote-safe projections; native host controls live on window.openClawHostControl?.
import type {
  AcceptSecurityRiskRequest,
  AuditMode,
  OpenClawRuntimeStatus,
  SecurityAuditSnapshot,
} from '@craft-agent/shared/openclaw';
export type {
  AcceptSecurityRiskRequest,
  AuditMode,
  OpenClawRuntimeStatus,
  SecurityAuditSnapshot,
};

// =============================================================================
// GUI-only types (not used by server/handler code)
// =============================================================================

/**
 * Browser toolbar window IPC channels (preload <-> BrowserPaneManager).
 * Kept separate from RPC_CHANNELS because these are scoped to toolbar windows.
 */
export const BROWSER_TOOLBAR_CHANNELS = {
  NAVIGATE: 'browser-toolbar:navigate',
  GO_BACK: 'browser-toolbar:go-back',
  GO_FORWARD: 'browser-toolbar:go-forward',
  RELOAD: 'browser-toolbar:reload',
  STOP: 'browser-toolbar:stop',
  OPEN_MENU: 'browser-toolbar:open-menu',
  HIDE: 'browser-toolbar:hide',
  DESTROY: 'browser-toolbar:destroy',
  STATE_UPDATE: 'browser-toolbar:state-update',
  THEME_COLOR: 'browser-toolbar:theme-color',
} as const

/** Tool icon mapping entry from tool-icons.json (with icon resolved to data URL) */
export interface ToolIconMapping {
  id: string
  displayName: string
  /** Data URL of the icon (e.g., data:image/png;base64,...) */
  iconDataUrl: string
  commands: string[]
}

/**
 * Browser pane creation options
 */
export interface BrowserPaneCreateOptions {
  id?: string
  show?: boolean
  bindToSessionId?: string
}

/**
 * Empty-state launch request from the browser empty-state renderer.
 */
export interface BrowserEmptyStateLaunchPayload {
  route: string
  token?: string
}

/**
 * Result of browser empty-state launch handling.
 */
export interface BrowserEmptyStateLaunchResult {
  ok: boolean
  handled: boolean
  reason?: string
}

export type TransportMode = 'local' | 'remote'

export type TransportConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed'

export type TransportConnectionErrorKind =
  | 'auth'
  | 'protocol'
  | 'timeout'
  | 'network'
  | 'server'
  | 'unknown'

export interface TransportConnectionError {
  kind: TransportConnectionErrorKind
  message: string
  code?: string
}

export interface TransportCloseInfo {
  code?: number
  reason?: string
  wasClean?: boolean
}

export interface TransportConnectionState {
  mode: TransportMode
  status: TransportConnectionStatus
  url: string
  attempt: number
  nextRetryInMs?: number
  lastError?: TransportConnectionError
  lastClose?: TransportCloseInfo
  updatedAt: number
}

// =============================================================================
// ElectronAPI — type-safe IPC API exposed to renderer
// =============================================================================

// Re-import types for ElectronAPI
import type { WorkspaceInfo, Workspace, SessionMetadata, StoredAttachment as StoredAttachmentType } from '@craft-agent/core/types';

// Import protocol types used by ElectronAPI (they come through the `export *` above,
// but we need them in scope for the interface definition)
import type {
  Session,
  UnreadSummary,
  CreateSessionOptions,
  TaskValidationResultDto,
  TaskCreateRequest,
  TaskCreateResult,
  TaskGenerateRequest,
  TaskGenerateAck,
  TaskGenerateResult,
  TaskRunRequest,
  TaskRunSnapshotDto,
  TaskGetResult,
  TaskResultsDto,
  FileAttachment,
  SendMessageOptions,
  SessionEvent,
  PermissionResponseOptions,
  CredentialResponse,
  SessionCommand,
  ShareResult,
  RefreshTitleResult,
  UndoResult,
  FileSearchResult,
  SessionSearchResult,
  LlmConnectionSetup,
  TestLlmConnectionParams,
  TestLlmConnectionResult,
  SkillFile,
  SessionFile,
  OAuthResult,
  McpToolsResult,
  GitBashStatus,
  ClaudeOAuthResult,
  UpdateInfo,
  WorkspaceSettings,
  PermissionModeState,
  BrowserInstanceInfo,
  DeepLinkNavigation,
  TestAutomationPayload,
  TestAutomationResult,
  WindowCloseRequest,
  DirectoryListingResult,
  NoteChangedPayload,
  NoteAsset,
  MarketplaceChangedPayload,
  MarketplaceProgressPayload,
  NoteAssetImportResult,
  NoteAssetRenameResult,
  NoteBacklink,
  NoteDocument,
  NoteRenameImpact,
  NoteRenameResult,
  NoteSummary,
  RemoteSessionTransferPayload,
  ImportRemoteSessionTransferResult,
  KnowledgeChangedPayload,
  KnowledgeDetectEngineResult,
  KnowledgeEngineStartResult,
  KnowledgeEngineStatus,
  KnowledgeLinkRecord,
  KnowledgeMetricsSnapshot,
  MutationInput,
  MutationProposal,
  MutationProposalStatus,
  ApplyResult,
  PublicationRecord,
  PublishApplyResult,
  PublishDraft,
  PublishPrepareResult,
  SiyuanSurfaceState,
  ExtensionSurfaceState,
} from '@craft-agent/shared/protocol'

export interface WorkGraphConnectionRecord {
  readonly id: string
  readonly workspaceId: string
  readonly integrationId: string
  readonly credentialRefId: string
  readonly storageMode: 'reference' | 'copy' | 'mirror' | 'managed' | 'ephemeral'
  readonly scopes: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ElectronAPI {
  // Cloud Runs (PRD docs/cloud-runs-prd.md)
  getCloudRunsConfig(): Promise<{
    enabled: boolean
    provider: 'local' | 'cloudflare' | 'modal' | 'e2b'
    gatewayUrl?: string
    notifyWebhookUrl?: string
    cheapModelId?: string
    personas?: boolean
    tokenConfigured: boolean
    estimatedRunTokens?: number | null
    defaults: { maxWallClockSec: number; maxLlmTokens: number; maxArtifactsBytes: number }
  }>
  setCloudRunsConfig(patch: {
    enabled?: boolean
    provider?: 'local' | 'cloudflare' | 'modal' | 'e2b'
    gatewayUrl?: string
    defaultMaxWallClockSec?: number
    defaultMaxLlmTokens?: number
    defaultMaxArtifactsBytes?: number
    notifyWebhookUrl?: string
    cheapModelId?: string
    personas?: boolean
  }): Promise<{ ok: boolean }>
  submitCloudRun(args: {
    topic: string
    sessionId?: string
    language?: 'en' | 'ru'
    kind?: 'research' | 'competitor' | 'literature' | 'vendor'
    personas?: boolean
    fromRunId?: string
    model?: { connectionSlug?: string; modelId?: string }
  }): Promise<{ id: string; provider: string; createdAt: number }>
  resumeCloudRun(args: { runId: string }): Promise<{ ok: boolean }>
  sessionTopicCloudRun(args: { sessionId: string }): Promise<{ topic: string }>
  readCloudRunArtifact(args: { runId: string; path: string }): Promise<{ content: string }>
  getCloudRunEvents(args: { runId: string }): Promise<{ t: number; message: string }[]>
  shareCloudRun(args: { runId: string }): Promise<{ url: string }>
  revokeCloudRunShare(args: { runId: string }): Promise<{ ok: boolean }>
  listCloudRunSchedules(): Promise<{
    id: string
    topic: string
    everyHours: number
    sessionId: string
    kind?: string
    enabled: boolean
    lastFireAt?: number
  }[]>
  saveCloudRunSchedule(args: {
    schedule: {
      id: string
      topic: string
      everyHours: number
      sessionId: string
      kind?: string
      enabled: boolean
      lastFireAt?: number
    }
  }): Promise<{ ok: boolean }>
  deleteCloudRunSchedule(args: { id: string }): Promise<{ ok: boolean }>
  listCloudRuns(): Promise<{
    enabled: boolean
    provider: string
    runs: {
      id: string
      name: string
      provider: string
      createdAt: number
      sessionId?: string
      topic?: string
      status: {
        id: string
        state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
        failureReason?: string
        progress?: { completed: number; total: number }
        usage?: { promptTokens: number; completionTokens: number; cpuMs?: number }
      } | null
    }[]
  }>
  getCloudRunStatus(id: string): Promise<unknown>
  cancelCloudRun(id: string): Promise<{ ok: boolean }>
  listCloudRunArtifacts(id: string): Promise<{ path: string; size: number }[]>
  importCloudRun(args: { runId: string; sessionId: string }): Promise<{ root: string; files: string[] }>
  aggregateCloudRun(args: { runId: string; sessionId: string; language?: 'en' | 'ru' }): Promise<{ ok: boolean; artifactsRoot: string }>
  // Session management
  getSessions(): Promise<Session[]>
  getUnreadSummary(): Promise<UnreadSummary>
  markAllSessionsRead(workspaceId: string): Promise<void>
  getSessionMessages(sessionId: string): Promise<Session | null>
  createSession(workspaceId: string, options?: CreateSessionOptions): Promise<Session>
  deleteSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachmentType[], options?: SendMessageOptions): Promise<void>
  cancelProcessing(sessionId: string, silent?: boolean): Promise<void>
  killShell(sessionId: string, shellId: string): Promise<{ success: boolean; error?: string }>
  getTaskOutput(taskId: string): Promise<string | null>

  // Tasks (Conductor)
  validateTask(workspaceId: string, yaml: string): Promise<TaskValidationResultDto>
  createTask(workspaceId: string, req: TaskCreateRequest): Promise<TaskCreateResult>
  generateTask(workspaceId: string, req: TaskGenerateRequest): Promise<TaskGenerateAck>
  /** Async generate result (or error), keyed by orchestratorSessionId. Subscribe before/after generateTask. */
  onTaskGenerated(callback: (workspaceId: string, result: TaskGenerateResult) => void): () => void
  runTask(workspaceId: string, req: TaskRunRequest): Promise<TaskRunSnapshotDto>
  pauseTask(workspaceId: string, slug: string, runId: string): Promise<void>
  resumeTask(workspaceId: string, slug: string, runId: string): Promise<void>
  stopTask(workspaceId: string, slug: string, runId: string): Promise<void>
  getTask(workspaceId: string, slug: string, runId?: string): Promise<TaskGetResult>
  listTasks(workspaceId: string): Promise<string[]>
  getTaskResults(workspaceId: string, slug: string, runId?: string): Promise<TaskResultsDto>

  respondToPermission(sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean, options?: PermissionResponseOptions): Promise<boolean>
  respondToCredential(sessionId: string, requestId: string, response: CredentialResponse): Promise<boolean>

  // Consolidated session command handler
  sessionCommand(sessionId: string, command: SessionCommand): Promise<void | ShareResult | RefreshTitleResult | UndoResult | { count: number }>

  // B4: multi-select bulk patch over sessions:command setters (rank forbidden; 200 ids max)
  bulkUpdateSessions(input: import('@craft-agent/shared/protocol/dto').BulkUpdateSessionsInput): Promise<import('@craft-agent/shared/protocol/dto').BulkUpdateSessionsResult>
  onSessionsBulkChanged(callback: (event: import('@craft-agent/shared/protocol/dto').SessionsBulkChangedEvent) => void): () => void

  // Server info (REMOTE_ELIGIBLE — returns data from whichever server owns the workspace)
  getServerHomeDir(): Promise<string>

  // Server mode configuration
  getServerConfig(): Promise<import('@craft-agent/shared/config/server-config').ServerConfig>
  setServerConfig(config: import('@craft-agent/shared/config/server-config').ServerConfig): Promise<void>
  getServerStatus(): Promise<import('@craft-agent/shared/config/server-config').ServerStatus>

  // App lifecycle
  relaunchApp(): Promise<void>
  removeWorkspace(workspaceId: string): Promise<boolean>
  invokeOnServer(url: string, token: string, channel: string, ...args: any[]): Promise<any>

  // SSH remote hosts + tunnels (Remote-SSH style bootstrap to a remote server)
  sshListHosts(): Promise<SshHostConfig[]>
  sshAddHost(input: SshHostInput): Promise<SshHostConfig>
  sshUpdateHost(id: string, updates: Partial<SshHostConfig>): Promise<SshHostConfig | undefined>
  sshDeleteHost(id: string): Promise<boolean>
  sshImportFromConfig(): Promise<SshConfigImportSuggestion[]>
  sshConnect(hostId: string): Promise<{ url?: string; localPort?: number; token?: string }>
  /** One-click: install (if needed) + start a managed server, then tunnel. */
  sshBootstrapConnect(hostId: string): Promise<{ url?: string; localPort?: number; token?: string; hostId: string }>
  /** Resolve a persisted RemoteServerConfig into a live { url, token } before dialing:
   * plain-ws passes through, SSH-backed (re)establishes a fresh tunnel + server. */
  sshResolveWorkspaceConnection(remoteServer: RemoteServerConfig): Promise<{ url: string; token: string; remoteWorkspaceId: string }>
  onSshBootstrapProgress(cb: (progress: SshBootstrapProgress) => void): () => void
  onSshConnectionStatus(cb: (status: SshConnectionStatus) => void): () => void
  /** Main → renderer: open omnibox when ⌘K arrives from embedded BrowserView focus. */
  onOmniboxOpen(cb: () => void): () => void

  // Remote session transfer (main-process orchestrated, supports chunked upload)
  transferSessionToWorkspace(sessionId: string, targetWorkspaceId: string, sessionIndex?: number, sessionCount?: number): Promise<{ sessionId: string }>
  onTransferProgress(callback: (progress: { sessionIndex: number; sessionCount: number; chunkSent: number; chunkTotal: number }) => void): () => void

  // Session export/import (cross-workspace transfer)
  exportSession(sessionId: string): Promise<unknown>
  importSession(targetWorkspaceId: string, bundle: unknown, mode: 'move' | 'fork'): Promise<{ sessionId: string; warnings?: string[] }>
  exportRemoteSessionTransfer(sessionId: string): Promise<RemoteSessionTransferPayload>
  importRemoteSessionTransfer(targetWorkspaceId: string, payload: RemoteSessionTransferPayload): Promise<ImportRemoteSessionTransferResult>

  // Pending plan execution (for reload recovery)
  getPendingPlanExecution(sessionId: string): Promise<{ planPath: string; draftInputSnapshot?: string; awaitingCompaction: boolean; executionDispatched: boolean } | null>
  // Permission mode reconciliation
  getSessionPermissionModeState(sessionId: string): Promise<PermissionModeState | null>
  // Self-learning memory mode (spec F3): persistent | incognito | temporary
  setMemoryMode(sessionId: string, mode: SessionMemoryMode): Promise<void>
  // Memory provenance (spec F4/Y2): lessons/skills injected into the session's
  // prompts. Null for unknown sessions or sessions with no provenance record.
  getSessionProvenance(sessionId: string): Promise<SessionProvenance | null>

  // Workspace management
  getWorkspaces(): Promise<Workspace[]>
  createWorkspace(
    folderPath: string,
    name: string,
    remoteServer?: RemoteServerConfig,
    authority?: WorkspaceCreationAuthority,
  ): Promise<WorkspaceCreationResult>
  checkWorkspaceSlug(slug: string): Promise<{ exists: boolean; path: string }>
  updateWorkspaceRemoteServer(workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }): Promise<{ success: boolean }>

  // Server-level workspace operations (for thin client / remote workspace discovery)
  getServerWorkspaces(): Promise<WorkspaceInfo[]>
  createServerWorkspace(
    name: string,
    authority?: WorkspaceCreationAuthority,
  ): Promise<WorkspaceInfo & { activation: WorkspaceActivation }>

  testRemoteConnection(url: string, token: string): Promise<{
    ok: boolean
    error?: string
    needsWorkspace?: boolean
    remoteWorkspaces?: Array<{ id: string; name: string }>
    remoteWorkspaceId?: string   // auto-set when exactly one workspace
    remoteWorkspaceName?: string // auto-set when exactly one workspace
    serverVersion?: string       // server app version from handshake
  }>

  // Window management
  getWindowWorkspace(): Promise<string | null>
  getWindowMode(): Promise<string | null>
  openWorkspace(workspaceId: string): Promise<void>
  openSessionInNewWindow(workspaceId: string, sessionId: string): Promise<void>
  switchWorkspace(workspaceId: string): Promise<void>
  closeWindow(): Promise<void>
  confirmCloseWindow(): Promise<void>
  /** Cancel a pending close request (renderer handled it by closing a modal/panel). */
  cancelCloseWindow(): Promise<void>
  /** Listen for close requests and receive source metadata. Returns cleanup function. */
  onCloseRequested(callback: (request: WindowCloseRequest) => void): () => void
  /** Show/hide macOS traffic light buttons (for fullscreen overlays) */
  setTrafficLightsVisible(visible: boolean): Promise<void>

  // Event listeners
  onSessionEvent(callback: (event: SessionEvent) => void): () => void
  onUnreadSummaryChanged(callback: (summary: UnreadSummary) => void): () => void

  // File operations
  readFile(path: string): Promise<string>
  /** Read a file as binary data (Uint8Array) */
  readFileBinary(path: string): Promise<Uint8Array>
  /** Read a file as a data URL (data:{mime};base64,...) for binary preview (images, PDFs) */
  readFileDataUrl(path: string): Promise<string>
  /** Read an image file as a size-bounded preview data URL for lightweight thumbnail rendering. */
  readFilePreviewDataUrl(path: string, maxSize?: number): Promise<string>
  openFileDialog(): Promise<string[]>
  readFileAttachment(path: string): Promise<FileAttachment | null>
  /** Re-read a user-attached file by absolute path (bypasses workspace-dir validation).
   *  Used only by draft hydration for paths the user explicitly picked via OS dialog / drag. */
  readUserAttachment(path: string): Promise<FileAttachment | null>
  storeAttachment(sessionId: string, attachment: FileAttachment): Promise<import('../../../../packages/core/src/types/index.ts').StoredAttachment>
  generateThumbnail(base64: string, mimeType: string): Promise<string | null>
  /** Returns the absolute filesystem path for a File (only works for file-picker / OS-drag Files). */
  getFilePath(file: File): string | null

  // Filesystem search (for @ mention file selection)
  searchFiles(basePath: string, query: string): Promise<FileSearchResult[]>

  // Server filesystem browsing (remote mode)
  listServerDirectory(dirPath: string): Promise<DirectoryListingResult>

  // Notes
  listNotes(workspaceId: string): Promise<NoteSummary[]>
  readNote(workspaceId: string, noteId: string): Promise<NoteDocument>
  saveNote(workspaceId: string, noteId: string, content: string): Promise<NoteDocument>
  createNote(workspaceId: string, title: string, folder?: string): Promise<NoteDocument>
  renameNote(workspaceId: string, noteId: string, nextTitle: string): Promise<NoteRenameResult>
  deleteNote(workspaceId: string, noteId: string): Promise<boolean>
  renameFolderNote(workspaceId: string, folder: string, nextName: string): Promise<{ movedNotes: string[] }>
  deleteFolderNote(workspaceId: string, folder: string): Promise<{ deletedNotes: string[] }>
  searchNotes(workspaceId: string, query: string): Promise<NoteSummary[]>
  getNoteBacklinks(workspaceId: string, noteId: string): Promise<NoteBacklink[]>
  getNoteRenameImpact(workspaceId: string, noteId: string, nextTitle: string): Promise<NoteRenameImpact>
  getDailyNote(workspaceId: string, date?: string): Promise<NoteDocument>
  importNoteAsset(workspaceId: string, attachment: FileAttachment): Promise<NoteAssetImportResult>
  listNoteAssets(workspaceId: string): Promise<NoteAsset[]>
  deleteNoteAsset(workspaceId: string, relativePath: string): Promise<boolean>
  renameNoteAsset(workspaceId: string, relativePath: string, nextName: string): Promise<NoteAssetRenameResult>
  updateNoteProperties(workspaceId: string, noteId: string, properties: Record<string, unknown>): Promise<NoteDocument>
  watchNotes(workspaceId: string): Promise<void>
  unwatchNotes(workspaceId: string): Promise<void>
  onNotesChanged(callback: (payload: NoteChangedPayload | string) => void): () => void

  // Knowledge (P1 read-only provider — spec 2026-08-07-siyuan-integration/03 §3.5.1;
  // P3 write-back mutation proposals — spec 05; P4 publication pipeline — spec 06).
  // Nested namespace via dotted CHANNEL_MAP keys + buildClientApi (browserPane pattern);
  // the WS-mode preload needs no per-domain wiring.
  workgraph: {
    listConnections(workspaceId: string): Promise<WorkGraphConnectionRecord[]>
    listConnectionAudit(input: {
      workspaceId: string
      connectionId?: string
    }): Promise<Array<{
      connectionId: string
      eventType: string
      occurredAt: number
      actorId: string | null
      outcome: string
      payloadDigest: string
      action?: string
    }>>
    listConnectionBindings(input: {
      workspaceId: string
      connectionId?: string
    }): Promise<Array<{
      id: string
      connectionId: string
      consumerId: string
      purpose: string
      actions: readonly string[]
      resources: readonly string[]
    }>>
    convertConnection(input: {
      workspaceId: string
      connectionId: string
    }): Promise<{ storageMode: 'reference'; consumers: Array<{ consumerId: string; status: string }> }>
    revokeConnectionBinding(input: {
      workspaceId: string
      bindingId: string
    }): Promise<{ consumers: Array<{ consumerId: string; status: string }> }>
    getConnection(args: { workspaceId: string; connectionId: string }): Promise<WorkGraphConnectionRecord | null>
    createConnection(input: {
      workspaceId: string
      integrationId: string
      credentialRefId: string
      storageMode: WorkGraphConnectionRecord['storageMode']
      scopes?: readonly string[]
    }): Promise<WorkGraphConnectionRecord>
    grantConnection(input: {
      workspaceId: string
      connectionId: string
      consumerId: string
      purpose: string
      actions: readonly string[]
      resources: readonly string[]
    }): Promise<{ bindingId: string; grantId: string }>
    previewGithubEnv(envPath: string): Promise<Array<{ candidateId: string; label: string; maskedSummary: string }>>
    importGithubEnv(input: {
      envPath: string
      candidateId: string
      workspaceId: string
    }): Promise<WorkGraphConnectionRecord>
    previewGitHelper(configPath: string): Promise<Array<{ candidateId: string; label: string; maskedSummary: string }>>
    importGitHelper(input: {
      configPath: string
      candidateId: string
      workspaceId: string
    }): Promise<WorkGraphConnectionRecord>
    revokeConnection(input: {
      workspaceId: string
      connectionId: string
    }): Promise<{ consumers: Array<{ consumerId: string; status: string }> }>
    repairConnection(input: {
      workspaceId: string
      connectionId: string
    }): Promise<{ consumers: Array<{ consumerId: string; status: string }> }>
    rotateConnection(input: {
      workspaceId: string
      connectionId: string
    }): Promise<{ consumers: Array<{ consumerId: string; status: string }> }>
    testConnection(input: {
      workspaceId: string
      connectionId: string
    }): Promise<{ login: string }>
    previewDockerHelper(configPath: string): Promise<Array<{ candidateId: string; label: string; maskedSummary: string }>>
    importDockerHelper(input: { configPath: string; candidateId: string; workspaceId: string }): Promise<WorkGraphConnectionRecord>
    previewAwsProfiles(input: { credentialsPath: string; configPath: string }): Promise<Array<{ candidateId: string; label: string; maskedSummary: string }>>
    importAwsProfile(input: { credentialsPath: string; configPath: string; candidateId: string; workspaceId: string }): Promise<WorkGraphConnectionRecord>
    previewKeychain(): Promise<Array<{ candidateId: string; label: string; maskedSummary: string }>>
    importKeychain(input: { candidateId: string; workspaceId: string }): Promise<WorkGraphConnectionRecord>
    previewAdc(credentialsPath: string): Promise<Array<{ candidateId: string; label: string; maskedSummary: string }>>
    importAdc(input: { credentialsPath: string; candidateId: string; workspaceId: string }): Promise<WorkGraphConnectionRecord>
    previewSshAgent(): Promise<Array<{ candidateId: string; label: string; maskedSummary: string }>>
    importSshAgent(input: { candidateId: string; workspaceId: string }): Promise<WorkGraphConnectionRecord>
  }

  knowledge: {
    listConnections(): Promise<KnowledgeConnection[]>
    capabilities(args: { workspaceId: string; connectionId: string }): Promise<KnowledgeCapabilities>
    search(args: { workspaceId: string; connectionId: string; input: SearchInput }): Promise<SearchPage>
    get(args: { workspaceId: string; connectionId: string; ref: KnowledgeRef }): Promise<KnowledgeNode>
    getContext(args: { workspaceId: string; connectionId: string; ref: KnowledgeRef; mode: ContextMode }): Promise<ContextPayload>
    getBacklinks(args: { workspaceId: string; connectionId: string; ref: KnowledgeRef }): Promise<ContextPayload['backlinks']>
    getExportPayload(args: {
      connectionId: string
      ref: KnowledgeRef
      formats?: Array<'markdown' | 'deepLink' | 'id' | 'hPath' | 'blockKramdown'>
    }): Promise<{
      id: string
      deepLink?: string
      markdown?: string
      hPath?: string
      blockKramdown?: string
      title?: string
    }>
    createSnapshot(args: {
      workspaceId: string
      connectionId: string
      ref: KnowledgeRef
      mode?: ContextMode
      sessionId: string
      provenance?: ContextPayload['provenance']
    }): Promise<ContextSnapshot>
    getSnapshot(args: { workspaceId: string; snapshotId: string }): Promise<ContextSnapshot>
    // P3 write-back (spec 05): mutation-proposal lifecycle. All seven REMOTE_ELIGIBLE;
    // proposal changes also push via onChanged (ref of target + change:'updated').
    proposeMutation(args: { connectionId: string; input: MutationInput }): Promise<MutationProposal>
    approveProposal(args: { proposalId: string }): Promise<MutationProposal>
    rejectProposal(args: { proposalId: string }): Promise<{ ok: true }>
    applyProposal(args: { proposalId: string; workspaceId?: string }): Promise<ApplyResult>
    rollbackProposal(args: { proposalId: string }): Promise<ApplyResult>
    getProposal(args: { proposalId: string }): Promise<MutationProposal>
    listProposals(args: { workspaceId?: string; connectionId?: string; status?: MutationProposalStatus }): Promise<MutationProposal[]>
    // P4 publication pipeline (spec 06): Session→Knowledge distill/prepare/apply/finalize.
    publishDistill(args: {
      connectionId: string
      sessionId?: string
      runIds?: string[]
      language?: string
      messages?: Array<{ id: string; role: string; content: string }>
      model?: { connectionSlug: string; modelId: string }
    }): Promise<PublishDraft>
    publishGetDraft(args: { draftId: string; connectionId?: string }): Promise<PublishDraft | null>
    publishUpdateDraft(args: {
      draftId: string
      connectionId?: string
      title?: string
      markdown?: string
    }): Promise<PublishDraft>
    publishPrepare(args: {
      draftId: string
      connectionId: string
      notebookId: string
      path: string
      adoptExisting?: boolean
    }): Promise<PublishPrepareResult>
    publishApply(args: { draftId: string; connectionId: string }): Promise<PublishApplyResult>
    publishFinalize(args: {
      draftId: string
      proposalId: string
      connectionId?: string
      appliedDocRef?: KnowledgeRef
    }): Promise<PublishApplyResult>
    publishList(args: {
      connectionId?: string
      sessionId?: string
      runId?: string
    }): Promise<PublicationRecord[]>
    listLinks(args: {
      connectionId?: string
      craftId?: string
      knowledgeId?: string
    }): Promise<KnowledgeLinkRecord[]>
    // P5 saved knowledge views + work envelopes (K-09 §3.5 / S-08).
    // ViewConfig shape matches packages/shared views (domain knowledgeFilter
    // fields optional until shared types land; UI treats unknown fields loosely).
    viewsList(args?: { connectionId?: string }): Promise<KnowledgeViewConfig[]>
    viewRun(args: {
      connectionId: string
      viewId: string
      workspaceId?: string
    }): Promise<{
      items: Array<SearchHit & { attributes?: Record<string, string>; topic?: string }>
      view: KnowledgeViewConfig
    }>
    viewSetAttribute(args: {
      connectionId: string
      ref: KnowledgeRef
      name: string
      value: string
    }): Promise<{ proposalId: string }>
    envelopeGet(args: {
      connectionId?: string
      ref: KnowledgeRef
    }): Promise<KnowledgeWorkEnvelope | null>
    envelopeUpsert(args: {
      connectionId?: string
      envelope: KnowledgeWorkEnvelope
    }): Promise<KnowledgeWorkEnvelope>
    envelopeList(args?: { connectionId?: string }): Promise<KnowledgeWorkEnvelope[]>
    /** P6: start polling watcher → AutomationSystem knowledge events. */
    watch(args: { connectionId: string; workspaceId: string; intervalMs?: number }): Promise<{ ok: true }>
    unwatch(args: { connectionId: string; workspaceId: string }): Promise<{ ok: true }>
    /** User-initiated local Craft Markdown import into the Notes store. */
    migrateNotes(args: {
      workspaceId: string
      sourceRoot: string
      format?: 'craft-markdown'
    }): Promise<{
      migrated: number
      skipped: number
      failed: Array<{ noteId: string; error: string }>
      mapPath: string
      sourceRoot: string
      destinationRoot: string
      format: 'craft-markdown'
    }>
    /** LOCAL_ONLY routing: reflects the engine on the answering host. */
    engineStatus(args: { workspaceId?: string; connectionId?: string }): Promise<KnowledgeEngineStatus>
    /** LOCAL_ONLY: seed default connection + start/open local SiYuan if installed. */
    engineStart(args?: { workspaceId?: string; connectionId?: string }): Promise<KnowledgeEngineStartResult>
    /** G1 metrics snapshot (REMOTE_ELIGIBLE workspace data). */
    metricsGet(args?: { workspaceId?: string }): Promise<KnowledgeMetricsSnapshot>
    /** LOCAL_ONLY: detect user-installed SiYuan + default port (never downloads). */
    detectEngine(): Promise<KnowledgeDetectEngineResult>
    onChanged(callback: (payload: KnowledgeChangedPayload) => void): () => void
  }

  // OpenClaw safe data APIs. Dotted CHANNEL_MAP keys expose these names in both
  // local Electron and remote WebUI; native host controls are deliberately absent.
  openclawRuntime: {
    getStatus(args: { workspaceId: string }): Promise<OpenClawRuntimeStatus>
    install(args: { workspaceId: string }): Promise<OpenClawRuntimeStatus>
    provision(args: { workspaceId: string }): Promise<OpenClawRuntimeStatus>
    start(args: { workspaceId: string }): Promise<OpenClawRuntimeStatus>
    stop(args: { workspaceId: string }): Promise<OpenClawRuntimeStatus>
  }
  securityAudit: {
    run(args: { workspaceId: string; mode: AuditMode }): Promise<SecurityAuditSnapshot>
    getLatest(args: { workspaceId: string }): Promise<SecurityAuditSnapshot | null>
    acceptRisk(args: AcceptSecurityRiskRequest): Promise<void>
    revokeRiskAcceptance(args: { workspaceId: string; fingerprint: string }): Promise<void>
  }
  // Debug: send renderer logs to main process log file
  debugLog(...args: unknown[]): void

  // Theme
  getSystemTheme(): Promise<boolean>
  onSystemThemeChange(callback: (isDark: boolean) => void): () => void

  // System
  getVersions(): { node: string; chrome: string; electron: string }
  /** Returns the renderer host environment without going through RPC. */
  getRuntimeEnvironment(): 'electron' | 'web'
  getHomeDir(): Promise<string>
  isDebugMode(): Promise<boolean>

  // Transport connection status (preload-local, not RPC channels)
  getTransportConnectionState(): Promise<TransportConnectionState>
  onTransportConnectionStateChanged(callback: (state: TransportConnectionState) => void): () => void
  reconnectTransport(): Promise<void>

  /** Fired after a WebSocket reconnect. isStale=true means buffer was evicted — full refresh needed. */
  onReconnected(callback: (isStale: boolean) => void): () => void

  /** Check whether the server registered a handler for a given RPC channel. */
  isChannelAvailable(channel: string): boolean

  // Auto-update
  checkForUpdates(): Promise<UpdateInfo>
  getUpdateInfo(): Promise<UpdateInfo>
  installUpdate(): Promise<void>
  dismissUpdate(version: string): Promise<void>
  getDismissedUpdateVersion(): Promise<string | null>
  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
  onUpdateDownloadProgress(callback: (progress: number) => void): () => void

  // Toolchain manager (first-run download manager)
  /** Current per-tool status snapshot. */
  getToolchainStatus(): Promise<ToolchainToolStatus[]>
  /** Push stream of per-tool status updates (download progress, phase changes). */
  onToolchainStatusChanged(callback: (status: ToolchainToolStatus) => void): () => void
  /** Force update/retry of a single tool (outdated/error/missing). */
  updateToolchainTool(name: ToolchainToolName): Promise<ToolchainToolStatus>
  /** Disabled default-on tools (config toolchain.disabled); ensureAll skips them. */
  getToolchainDisabled(): Promise<ToolchainToolName[]>
  /** Replace the disabled default-on list; persists config and restarts background ensureAll. */
  setToolchainDisabled(names: ToolchainToolName[]): Promise<ToolchainToolName[]>

  // Session env overrides (config runtime.envOverrides — applied to new agent subprocesses)
  getEnvOverrides(): Promise<Record<string, string>>
  setEnvOverrides(env: Record<string, string>): Promise<{ success: boolean; error?: string }>

  // Release notes
  getReleaseNotes(): Promise<string>
  getLatestReleaseVersion(): Promise<string | undefined>

  // System warnings (startup checks)
  getSystemWarnings(): Promise<{ vcredistMissing: boolean; downloadUrl?: string }>

  // Shell operations
  openUrl(url: string): Promise<void>
  openFile(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  exportNotePdf(opts: { html: string; defaultPath: string }): Promise<{ canceled: boolean; filePath?: string }>
  /** Save plain text via native save dialog (knowledge export, etc.). */
  saveTextFile(opts: {
    content: string
    defaultPath: string
    filters?: Array<{ name: string; extensions: string[] }>
  }): Promise<{ canceled: boolean; filePath?: string }>

  // Menu event listeners
  onMenuNewChat(callback: () => void): () => void
  onMenuOpenSettings(callback: () => void): () => void
  onMenuKeyboardShortcuts(callback: () => void): () => void
  onMenuToggleFocusMode(callback: () => void): () => void
  onMenuToggleSidebar(callback: () => void): () => void

  // Deep link navigation listener (for external craftagents:// URLs)
  onDeepLinkNavigate(callback: (nav: DeepLinkNavigation) => void): () => void

  // Auth
  showLogoutConfirmation(): Promise<boolean>
  showDeleteSessionConfirmation(name: string): Promise<boolean>
  showDeleteWorkspaceConfirmation(name: string): Promise<boolean>
  logout(): Promise<void>

  // Credential health check (startup validation)
  getCredentialHealth(): Promise<CredentialHealthStatus>

  // Identity Center (S-07)
  identityGetState(args?: { workspaceId?: string }): Promise<IdentityState>
  identityUpdateProfile(input: UpdateProfileInput): Promise<IdentityState>
  identityConnect(args: {
    provider: ServiceProvider
    workspaceId: string
    accountLabel?: string
    credentialValue?: string
    connectionId?: string
  }): Promise<IdentityState>
  identityDisconnect(args: { connectionId: string }): Promise<IdentityState>
  identityRefreshStatus(args?: { workspaceId?: string }): Promise<IdentityState>
  onIdentityChanged(callback: () => void): () => void

  // Extension Center (S-05)
  extensionsListCatalog(args?: { filter?: CatalogFilter }): Promise<ExtensionsListCatalogResult>
  extensionsListInstalled(args?: {
    workspaceId?: string
    workingDirectory?: string
  }): Promise<ExtensionsListInstalledResult>
  extensionsSetEnabled(args: { id: string; enabled: boolean }): Promise<ExtensionsSetEnabledResult>
  extensionsGetState(): Promise<ExtensionsGetStateResult>
  onExtensionsChanged(callback: (payload: ExtensionsChangedPayload) => void): () => void

  // SiYuan plugin bridge (W6)
  pluginBridgeListPlugins(): Promise<PluginBridgeListResult>
  pluginBridgeGetProjections(args: PluginBridgeGetProjectionsArgs): Promise<BridgeProjectedContributions>
  pluginBridgeSetEnabled(args: PluginBridgeSetEnabledArgs): Promise<PluginBridgeSetEnabledResult>
  pluginBridgeOpenCompat(args?: { pluginId?: string }): Promise<{
    route: string
    ref: { kind: 'notebook'; id: string }
  }>
  pluginBridgeInstallBazaar(args: PluginBridgeInstallBazaarArgs): Promise<PluginBridgeInstallBazaarResult>
  pluginBridgeUninstallBazaar(args: PluginBridgeUninstallBazaarArgs): Promise<PluginBridgeUninstallBazaarResult>

  // Extension Host lifecycle (S-05 §3.5) — craft-sandbox only; does not execute SiYuan plugins
  extensionHostStatus(args?: { workspaceId?: string | null }): Promise<ExtensionHostStatus>
  extensionHostStatusAll(): Promise<Array<{ workspaceId: string } & ExtensionHostStatus>>
  extensionHostStart(args?: { workspaceId?: string | null }): Promise<ExtensionHostStatus>
  extensionHostStop(args?: { workspaceId?: string | null }): Promise<ExtensionHostStatus>
  extensionHostRestart(args?: { workspaceId?: string | null }): Promise<ExtensionHostStatus>
  extensionHostLoad(args: {
    extensionId: string
    entryPath: string
    /**
     * Ignored by main. Grants are loaded from workspace permissions.json only.
     * Kept optional so older callers do not break; do not rely on this field.
     */
    grantedPermissions?: string[]
    workspaceId?: string | null
  }): Promise<{ ok: true }>
  extensionHostCall(args: {
    extensionId: string
    method: string
    args?: unknown[]
    permissions?: string[]
    workspaceId?: string | null
  }): Promise<unknown>
  extensionHostListCommands(args: {
    extensionId: string
    workspaceId?: string | null
  }): Promise<
    Array<{
      id: string
      title: string
      when?: string
      defaultHotkey?: string
      keywords?: string[]
    }>
  >
  /** Mint scoped capability token — never returns raw secret. Grants from load only. */
  extensionHostMintCapability(args: {
    extensionId: string
    permission: string
    ttlMs?: number
    singleUse?: boolean
    workspaceId?: string | null
  }): Promise<{ token: string; expiresAt: number; permission: string }>
  extensionHostRevokeCapability(args: {
    token?: string
    extensionId?: string
    workspaceId?: string | null
  }): Promise<{ ok: true }>
  /** Main-side authenticated fetch via capability token. */
  extensionHostProxyFetch(args: {
    token: string
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    allowedUrlPrefixes?: string[]
    workspaceId?: string | null
  }): Promise<{ status: number; body: string; headers: Record<string, string> }>
  extensionHostGetUrlAllowlist(args: { extensionId: string }): Promise<{ prefixes: string[] }>
  extensionHostSetUrlAllowlist(args: {
    extensionId: string
    prefixes: string[]
  }): Promise<{ prefixes: string[] }>

  /**
   * Sandboxed extension UI surface (partition persist:ext-${extensionId}).
   * All channels are LOCAL_ONLY.
   */
  extensionSurface: {
    createEmbedded(args: {
      durableKey: string
      url: string
      extensionId: string
      viewId: string
      workspaceId?: string | null
    }): Promise<string>
    destroy(args: { instanceId: string }): Promise<void>
    list(args?: { workspaceId?: string | null }): Promise<ExtensionSurfaceState[]>
    syncBounds(args: {
      instanceId: string
      rect: { x: number; y: number; width: number; height: number } | null
    }): Promise<void>
    focus(args: { instanceId: string }): Promise<void>
    onStateChanged(callback: (state: ExtensionSurfaceState) => void): () => void
    onRemoved(callback: (id: string) => void): () => void
  }

  // Onboarding
  getAuthState(): Promise<AuthState>
  getSetupNeeds(): Promise<SetupNeeds>
  startWorkspaceMcpOAuth(mcpUrl: string): Promise<OAuthResult & { clientId?: string }>
  // Claude OAuth (two-step flow)
  startClaudeOAuth(): Promise<{ success: boolean; authUrl?: string; error?: string }>
  exchangeClaudeCode(code: string, connectionSlug: string): Promise<ClaudeOAuthResult>
  hasClaudeOAuthState(): Promise<boolean>
  clearClaudeOAuthState(): Promise<{ success: boolean }>
  /** Defer onboarding setup — user chose "Setup later" */
  startRoxConnect(): Promise<{
    success: boolean
    userCode?: string
    verificationUri?: string
    verificationUriComplete?: string
    expiresIn?: number
    error?: string
    authBaseUrl?: string
  }>
  getRoxCloudState(): Promise<{
    required: boolean
    connected: boolean
    authBaseUrl: string
    user: { id?: string; email?: string; name?: string } | null
  }>
  clearRoxCloud(): Promise<{ success: boolean }>
  deferSetup(): Promise<{ success: boolean }>

  // ChatGPT OAuth (for Codex chatgptAuthTokens mode)
  startChatGptOAuth(connectionSlug: string): Promise<{ success: boolean; error?: string }>
  cancelChatGptOAuth(): Promise<{ success: boolean }>
  getChatGptAuthStatus(connectionSlug: string): Promise<{ authenticated: boolean; expiresAt?: number; hasRefreshToken?: boolean }>
  chatGptLogout(connectionSlug: string): Promise<{ success: boolean }>

  // GitHub Copilot OAuth
  startCopilotOAuth(connectionSlug: string): Promise<{ success: boolean; error?: string }>
  cancelCopilotOAuth(): Promise<{ success: boolean }>
  getCopilotAuthStatus(connectionSlug: string): Promise<{ authenticated: boolean }>
  copilotLogout(connectionSlug: string): Promise<{ success: boolean }>
  onCopilotDeviceCode(callback: (data: { userCode: string; verificationUri: string }) => void): () => void

  /** Unified LLM connection setup */
  setupLlmConnection(setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }>
  /** Unified connection test — spawns a lightweight agent subprocess to validate credentials */
  testLlmConnectionSetup(params: TestLlmConnectionParams): Promise<TestLlmConnectionResult>
  // Pi provider discovery (main process only — Pi SDK can't run in renderer)
  getPiApiKeyProviders(): Promise<Array<{ key: string; label: string; placeholder: string }>>
  getPiProviderBaseUrl(provider: string): Promise<string | undefined>
  getPiProviderModels(provider: string): Promise<{ models: Array<{ id: string; name: string; costInput: number; costOutput: number; contextWindow: number; reasoning: boolean }>; totalCount: number }>

  // Session-specific model (overrides global)
  getSessionModel(sessionId: string, workspaceId: string): Promise<string | null>
  setSessionModel(sessionId: string, workspaceId: string, model: string | null, connection?: string): Promise<void>

  // Workspace Settings (per-workspace configuration)
  getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings | null>
  updateWorkspaceSetting<K extends keyof WorkspaceSettings>(workspaceId: string, key: K, value: WorkspaceSettings[K]): Promise<void>

  // Folder dialog
  openFolderDialog(): Promise<string | null>

  // User Preferences
  readPreferences(): Promise<{ content: string; exists: boolean; path: string }>
  writePreferences(content: string): Promise<{ success: boolean; error?: string }>

  // Gamification profile (XP/level/balance)
  getGamificationProfile(): Promise<{
    xp: number
    level: number
    balance: number | null
    progress: number
    xpIntoLevel: number
    xpForNext: number
    nextThreshold: number | null
    currentThreshold: number
  }>
  awardGamificationXp(event: 'session_completed' | 'automation_ran' | 'cloud_run_imported' | 'note_linked'): Promise<{
    xp: number
    level: number
    balance: number | null
    progress: number
    xpIntoLevel: number
    xpForNext: number
    nextThreshold: number | null
    currentThreshold: number
    awarded: number
    event: string
    leveledUp: boolean
    previousLevel: number
  }>
  onGamificationChanged(callback: (payload: {
    xp: number
    level: number
    balance: number | null
    progress: number
    xpIntoLevel: number
    xpForNext: number
    nextThreshold: number | null
    currentThreshold?: number
  }) => void): () => void

  // Session Drafts (persisted composer state — text + attachment refs)
  getDraft(sessionId: string): Promise<import('@craft-agent/shared/config').SessionDraft | null>
  setDraft(sessionId: string, draft: import('@craft-agent/shared/config').SessionDraft): Promise<void>
  deleteDraft(sessionId: string): Promise<void>
  getAllDrafts(): Promise<Record<string, import('@craft-agent/shared/config').SessionDraft>>

  // Session Info Panel
  getSessionFiles(sessionId: string): Promise<SessionFile[]>
  getSessionNotes(sessionId: string): Promise<string>
  setSessionNotes(sessionId: string, content: string): Promise<void>
  watchSessionFiles(sessionId: string): Promise<void>
  unwatchSessionFiles(): Promise<void>
  onSessionFilesChanged(callback: (sessionId: string) => void): () => void

  // Sources
  getSources(workspaceId: string): Promise<LoadedSource[]>
  createSource(workspaceId: string, config: Partial<FolderSourceConfig>): Promise<FolderSourceConfig>
  updateSource(
    workspaceId: string,
    sourceSlug: string,
    updates: {
      name?: string
      enabled?: boolean
      tagline?: string
      url?: string
      guide?: string
    },
  ): Promise<LoadedSource>
  deleteSource(workspaceId: string, sourceSlug: string): Promise<void>
  startSourceOAuth(workspaceId: string, sourceSlug: string): Promise<{ success: boolean; error?: string }>
  saveSourceCredentials(workspaceId: string, sourceSlug: string, credential: string): Promise<void>
  getSourcePermissionsConfig(workspaceId: string, sourceSlug: string): Promise<import('@craft-agent/shared/agent').PermissionsConfigFile | null>
  getWorkspacePermissionsConfig(workspaceId: string): Promise<import('@craft-agent/shared/agent').PermissionsConfigFile | null>
  getDefaultPermissionsConfig(): Promise<{ config: import('@craft-agent/shared/agent').PermissionsConfigFile | null; path: string }>
  getMcpTools(workspaceId: string, sourceSlug: string): Promise<McpToolsResult>
  reindexSources(workspaceId: string): Promise<{
    indexed: number
    skipped: number
    truncated: boolean
    dbPath: string
    fts: boolean
    fileCount: number
    rootCount: number
  }>
  searchSourcesIndex(
    workspaceId: string,
    query: string,
    limit?: number,
  ): Promise<{
    hits: Array<{
      path: string
      chars: number
      tokens: number
      mtime: number
      snippet: string
      rank: number
    }>
    total: number
    fts: boolean
    query: string
  }>

  // OAuth (server-owned credentials, client-orchestrated flow)
  performOAuth(args: { sourceSlug: string; sessionId?: string; authRequestId?: string }): Promise<{ success: boolean; error?: string; email?: string }>
  oauthRevoke(sourceSlug: string): Promise<{ success: boolean }>

  // Session content search (full-text search via ripgrep)
  searchSessionContent(workspaceId: string, query: string, searchId?: string): Promise<SessionSearchResult[]>

  // Sources change listener (live updates when sources are added/removed)
  onSourcesChanged(callback: (workspaceId: string, sources: LoadedSource[]) => void): () => void

  // Default permissions change listener (live updates when default.json changes)
  onDefaultPermissionsChanged(callback: () => void): () => void

  // Skills
  getSkills(workspaceId: string, workingDirectory?: string): Promise<LoadedSkill[]>
  getSkillFiles?(workspaceId: string, skillSlug: string): Promise<SkillFile[]>
  updateSkill(
    workspaceId: string,
    skillSlug: string,
    updates: import('@craft-agent/shared/skills').UpdateSkillContentInput,
  ): Promise<LoadedSkill>
  deleteSkill(workspaceId: string, skillSlug: string): Promise<void>
  /** Import an OMP skill into workspace craft skills. Returns the materialized slug (may get a `-omp` suffix on conflict). */
  importOmpSkill(workspaceId: string, skillSlug: string): Promise<{ slug: string; path: string; renamed: boolean }>
  openSkillInEditor(workspaceId: string, skillSlug: string): Promise<void>
  openSkillInFinder(workspaceId: string, skillSlug: string): Promise<void>
  /**
   * S4: per-slug usage stats aggregated from {workspace}/skills/.usage.jsonl.
   * Empty map when no session ever mentioned a skill.
   */
  getSkillUsage(workspaceId: string): Promise<SkillUsageMap>
  /**
   * S4: archive (never delete) unused workspace skills into skills/.archive/.
   * `slugs` is the pre-confirmed panel list; pass undefined to let the server
   * compute candidates from `olderThanDays` (30 by default at the UI).
   */
  pruneSkills(workspaceId: string, olderThanDays: number, slugs?: string[]): Promise<SkillPruneResult>
  /** T1: copy a workspace skill into {projectRoot}/.agents/skills/<slug>; refuses overwrites of differing targets. */
  exportSkillToProject(workspaceId: string, skillSlug: string, projectRoot: string): Promise<SkillExportResult>

  // Skills change listener (live updates when skills are added/removed/modified)
  onSkillsChanged(callback: (workspaceId: string, skills: LoadedSkill[]) => void): () => void
  // Pending skill candidates (self-learning distillation queue)
  listPendingSkills(workspaceId: string): Promise<PendingSkill[]>
  approvePendingSkill(workspaceId: string, slug: string, force?: boolean): Promise<boolean>
  dismissPendingSkill(workspaceId: string, slug: string, description?: string): Promise<boolean>
  diffPendingSkill(workspaceId: string, slug: string): Promise<PendingSkillDiff>
  onSkillsPendingChanged(callback: (workspaceId: string) => void): () => void
  // Memory (self-learning lessons, context, history)
  listMemoryLessons(scope: LessonScope | 'both', workspaceId?: string): Promise<Lesson[]>
  addMemoryLesson(workspaceId: string | null, input: { rule: string; category: LessonCategory; negative?: boolean; scope: LessonScope }): Promise<AddLessonResult>
  updateMemoryLesson(workspaceId: string | null, scope: LessonScope, match: string | number, patch: Partial<Omit<Lesson, 'scope'>>): Promise<Lesson | null>
  deleteMemoryLesson(workspaceId: string | null, scope: LessonScope, match: string | number): Promise<boolean>
  getMemoryContext(workspaceId?: string): Promise<{ preferences: string; context: string }>
  getProjectMemory(workspaceId: string, projectId: string): Promise<ProjectMemoryDto | null>
  updateMemoryContext(workspaceId: string | null, scope: LessonScope, content: string): Promise<boolean>
  listMemoryHistory(workspaceId: string, date?: string): Promise<{ dates: string[]; date: string | null; content: string }>
  // Learning-quality surface (spec L3): cross-workspace rule promotion
  listPromotionCandidates(): Promise<PromotionCandidate[]>
  promoteLesson(workspaceId: string | null, rule: string): Promise<PromoteLessonResult | null>
  // Y1: memory dashboard insights card (7-day audit counters + live store aggregates)
  listInsights(workspaceId?: string): Promise<MemoryInsights>
  // Y4: stamp the one-shot onboarding marker ({configDir}/memory/.onboarded)
  markMemoryOnboarded(): Promise<void>
  enrichMindMap(input: {
    workspaceId: string
    entity: import('@craft-agent/core/mindmap').MindMapEntityRef
    graph: import('@craft-agent/core/mindmap').MindMapGraph
    sourceExcerpt?: string
    heuristicOnly?: boolean
  }): Promise<
    | { ok: true; graph: import('@craft-agent/core/mindmap').MindMapGraph; mode: 'llm' | 'heuristic' }
    | { ok: false; error: string; graph: import('@craft-agent/core/mindmap').MindMapGraph; mode?: 'passthrough' }
  >
  mindmapPinLoad(input: {
    workspaceId: string
    entity: import('@craft-agent/core/mindmap').MindMapEntityRef
  }): Promise<import('@craft-agent/core/mindmap').PinnedMap | null>
  mindmapPinSave(input: {
    workspaceId: string
    pin: import('@craft-agent/core/mindmap').PinnedMap
  }): Promise<{ ok: true } | { ok: false; error: string }>
  mindmapPinClear(input: {
    workspaceId: string
    entity: import('@craft-agent/core/mindmap').MindMapEntityRef
  }): Promise<{ ok: true } | { ok: false; error: string }>
  onMemoryChanged(callback: (workspaceId: string | null, scope: LessonScope | 'both') => void): () => void

  // Statuses (workspace-scoped)
  listStatuses(workspaceId: string): Promise<import('@craft-agent/shared/statuses').StatusConfig[]>
  reorderStatuses(workspaceId: string, orderedIds: string[]): Promise<void>
  onStatusesChanged(callback: (workspaceId: string) => void): () => void

  // Labels (workspace-scoped)
  listLabels(workspaceId: string): Promise<import('@craft-agent/shared/labels').LabelConfig[]>
  createLabel(workspaceId: string, input: import('@craft-agent/shared/labels').CreateLabelInput): Promise<import('@craft-agent/shared/labels').LabelConfig>
  updateLabel(
    workspaceId: string,
    labelId: string,
    updates: import('@craft-agent/shared/labels').UpdateLabelInput,
  ): Promise<import('@craft-agent/shared/labels').LabelConfig>
  deleteLabel(workspaceId: string, labelId: string): Promise<{ stripped: number }>
  onLabelsChanged(callback: (workspaceId: string) => void): () => void

  // Organizations (P3.1 team workspaces)
  listOrganizations(): Promise<import('@craft-agent/shared/orgs').OrganizationWithMembers[]>
  createOrganization(input: import('@craft-agent/shared/orgs').CreateOrganizationInput): Promise<import('@craft-agent/shared/orgs').OrganizationWithMembers>
  inviteToOrganization(input: import('@craft-agent/shared/orgs').InviteToOrgInput): Promise<import('@craft-agent/shared/orgs').OrgInvite>
  acceptOrganizationInvite(input: import('@craft-agent/shared/orgs').AcceptInviteInput): Promise<{
    org: import('@craft-agent/shared/orgs').OrganizationWithMembers
    member: import('@craft-agent/shared/orgs').OrgMember
    invite: import('@craft-agent/shared/orgs').OrgInvite
  }>
  listOrganizationMembers(orgId: string): Promise<import('@craft-agent/shared/orgs').OrgMember[]>
  getOrgIdentity(): Promise<{ userId: string; username?: string; email?: string; name?: string }>
  updateOrgIdentity(updates: { username?: string; email?: string; name?: string }): Promise<{ userId: string; username?: string; email?: string; name?: string }>

  // LLM connections change listener
  onLlmConnectionsChanged(callback: () => void): () => void

  // Views (workspace-scoped, stored in views.json)
  listViews(workspaceId: string): Promise<import('@craft-agent/shared/views').ViewConfig[]>
  saveViews(workspaceId: string, views: import('@craft-agent/shared/views').ViewConfig[]): Promise<void>

  // Generic workspace image loading/saving
  readWorkspaceImage(workspaceId: string, relativePath: string): Promise<string>
  writeWorkspaceImage(workspaceId: string, relativePath: string, base64: string, mimeType: string): Promise<void>

  // Tool icon mappings
  getToolIconMappings(): Promise<ToolIconMapping[]>

  // Theme (app-level default)
  getAppTheme(): Promise<import('@config/theme').ThemeOverrides | null>
  loadPresetThemes(): Promise<import('@config/theme').PresetTheme[]>
  loadPresetTheme(themeId: string): Promise<import('@config/theme').PresetTheme | null>
  getColorTheme(): Promise<string>
  setColorTheme(themeId: string): Promise<void>
  getWorkspaceColorTheme(workspaceId: string): Promise<string | null>
  setWorkspaceColorTheme(workspaceId: string, themeId: string | null): Promise<void>
  getAllWorkspaceThemes(): Promise<Record<string, string | undefined>>

  // Theme change listeners
  onAppThemeChange(callback: (theme: import('@config/theme').ThemeOverrides | null) => void): () => void

  // Logo URL resolution
  getLogoUrl(serviceUrl: string, provider?: string): Promise<string | null>

  // Notifications
  showNotification(title: string, body: string, workspaceId: string, sessionId: string): Promise<void>
  getNotificationsEnabled(): Promise<boolean>
  setNotificationsEnabled(enabled: boolean): Promise<void>

  // Input settings
  getAutoCapitalisation(): Promise<boolean>
  setAutoCapitalisation(enabled: boolean): Promise<void>
  getSendMessageKey(): Promise<'enter' | 'cmd-enter'>
  setSendMessageKey(key: 'enter' | 'cmd-enter'): Promise<void>
  getSpellCheck(): Promise<boolean>
  setSpellCheck(enabled: boolean): Promise<void>

  // Power settings
  getKeepAwakeWhileRunning(): Promise<boolean>
  setKeepAwakeWhileRunning(enabled: boolean): Promise<void>

  // Tools settings
  getBrowserToolEnabled(): Promise<boolean>
  setBrowserToolEnabled(enabled: boolean): Promise<void>

  // Appearance settings
  getRichToolDescriptions(): Promise<boolean>
  setRichToolDescriptions(enabled: boolean): Promise<void>
  getDefaultZoomLevel(): Promise<number>
  setDefaultZoomLevel(level: number): Promise<void>

  // Prompt caching & context
  getExtendedPromptCache(): Promise<boolean>
  setExtendedPromptCache(enabled: boolean): Promise<void>
  getEnable1MContext(): Promise<boolean>
  setEnable1MContext(enabled: boolean): Promise<void>

  // RTK token optimization
  getRtkEnabled(): Promise<boolean>
  setRtkEnabled(enabled: boolean): Promise<void>
  getRtkStatus(opts?: { forceRecheck?: boolean }): Promise<{ installed: boolean; path: string | null; version: string | null }>
  getRtkGain(): Promise<{ totalCommands: number; totalInput: number; totalOutput: number; totalSaved: number; avgSavingsPct: number; totalTimeMs: number; avgTimeMs: number } | null>

  // Network proxy settings
  getNetworkProxySettings(): Promise<NetworkProxySettings | undefined>
  setNetworkProxySettings(settings: NetworkProxySettings): Promise<void>

  refreshBadge(): Promise<void>
  setDockIconWithBadge(dataUrl: string): Promise<void>
  onBadgeDraw(callback: (data: { count: number; iconDataUrl: string }) => void): () => void
  onBadgeDrawWindows(callback: (data: { count: number }) => void): () => void
  getWindowFocusState(): Promise<boolean>
  onWindowFocusChange(callback: (isFocused: boolean) => void): () => void
  onNotificationNavigate(callback: (data: { workspaceId: string; sessionId: string }) => void): () => void

  // Theme preferences sync across windows
  broadcastThemePreferences(preferences: { mode: string; colorTheme: string; font: string }): Promise<void>
  onThemePreferencesChange(callback: (preferences: { mode: string; colorTheme: string; font: string }) => void): () => void

  // Workspace theme sync across windows
  broadcastWorkspaceThemeChange(workspaceId: string, themeId: string | null): Promise<void>
  onWorkspaceThemeChange(callback: (data: { workspaceId: string; themeId: string | null }) => void): () => void

  // Git operations
  getGitBranch(dirPath: string): Promise<string | null>

  // Git Bash (Windows)
  checkGitBash(): Promise<GitBashStatus>
  browseForGitBash(): Promise<string | null>
  setGitBashPath(path: string): Promise<{ success: boolean; error?: string }>

  // Menu actions (from renderer to main)
  menuQuit(): Promise<void>
  menuNewWindow(): Promise<void>
  menuMinimize(): Promise<void>
  menuMaximize(): Promise<void>
  menuZoomIn(): Promise<void>
  menuZoomOut(): Promise<void>
  menuZoomReset(): Promise<void>
  menuToggleDevTools(): Promise<void>
  menuUndo(): Promise<void>
  menuRedo(): Promise<void>
  menuCut(): Promise<void>
  menuCopy(): Promise<void>
  menuPaste(): Promise<void>
  menuSelectAll(): Promise<void>

  // Browser pane management
  browserPane: {
    create(input?: string | BrowserPaneCreateOptions): Promise<string>
    createEmbedded(input?: { url?: string }): Promise<string>
    syncBounds(id: string, rect: { x: number; y: number; width: number; height: number } | null): Promise<void>
    destroy(id: string): Promise<void>
    list(): Promise<BrowserInstanceInfo[]>
    navigate(id: string, url: string): Promise<{ url: string; title: string }>
    goBack(id: string): Promise<void>
    goForward(id: string): Promise<void>
    reload(id: string): Promise<void>
    stop(id: string): Promise<void>
    focus(id: string): Promise<void>
    resize(id: string, width: number, height: number): Promise<{ width: number; height: number }>
    snapshot(id: string): Promise<{ url: string; title: string; nodes: Array<{ ref: string; role: string; name: string; value?: string; description?: string; focused?: boolean; checked?: boolean; disabled?: boolean }> }>
    click(id: string, ref: string): Promise<void>
    clickAt(id: string, x: number, y: number): Promise<void>
    fill(id: string, ref: string, value: string): Promise<void>
    typeText(id: string, text: string): Promise<void>
    sendKey(id: string, args: { key: string; modifiers?: Array<'shift' | 'control' | 'alt' | 'meta'> }): Promise<void>
    select(id: string, ref: string, value: string): Promise<void>
    screenshotImage(id: string, options?: { format?: 'png' | 'jpeg'; annotate?: boolean }): Promise<{ base64: string; imageFormat: 'png' | 'jpeg'; metadata?: Record<string, unknown> }>
    scroll(id: string, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void>
    evaluate(id: string, expression: string): Promise<unknown>
    emptyStateLaunch(payload: BrowserEmptyStateLaunchPayload): Promise<BrowserEmptyStateLaunchResult>
    onStateChanged(callback: (info: BrowserInstanceInfo) => void): () => void
    onRemoved(callback: (id: string) => void): () => void
    onInteracted(callback: (id: string) => void): () => void
  }

  // SiYuan engine surfaces (P2 native knowledge mode). Nested namespace via
  // dotted CHANNEL_MAP keys, same as browserPane. Embedded SiYuan desktop
  // panes keyed by durable document keys (`siyuan:{kind}:{id}`) — the durable
  // key supersedes the ephemeral browser-embedded-${n} id for dedup + restore.
  // All channels are LOCAL_ONLY.
  siyuanEngine: {
    /**
     * Dedups by durableKey: re-opening the same document focuses + reuses the
     * live surface. Returns the browser-pane instanceId (same id the matching
     * STATE_CHANGED push carries inside SiyuanSurfaceState).
     */
    createEmbedded(args: { durableKey: string; url: string; workspaceId?: string | null }): Promise<string>
    destroy(args: { instanceId: string }): Promise<void>
    /** Surviving surfaces — optionally workspace-scoped. Renderer uses this for restore. */
    list(args?: { workspaceId?: string | null }): Promise<SiyuanSurfaceState[]>
    syncBounds(args: { instanceId: string; rect: { x: number; y: number; width: number; height: number } | null }): Promise<void>
    focus(args: { instanceId: string }): Promise<void>
    /** Run JS in the embedded surface (dock open / location assign). LOCAL_ONLY. */
    evaluate(args: { instanceId: string; expression: string }): Promise<unknown>
    onStateChanged(callback: (state: SiyuanSurfaceState) => void): () => void
    onRemoved(callback: (id: string) => void): () => void
  }

  // LLM Connections (provider configurations)
  listLlmConnections(): Promise<LlmConnection[]>
  listLlmConnectionsWithStatus(): Promise<LlmConnectionWithStatus[]>
  getLlmConnection(slug: string): Promise<LlmConnection | null>
  getLlmConnectionApiKey(slug: string): Promise<string | null>
  saveLlmConnection(connection: LlmConnection): Promise<{ success: boolean; error?: string }>
  deleteLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  testLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  setDefaultLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  getDefaultThinkingLevel(): Promise<ThinkingLevel>
  setDefaultThinkingLevel(level: ThinkingLevel): Promise<{ success: boolean; error?: string }>
  setWorkspaceDefaultLlmConnection(workspaceId: string, slug: string | null): Promise<{ success: boolean; error?: string }>

  // Projects (workspace-scoped)
  getProjects(workspaceId: string): Promise<unknown>
  getProject(workspaceId: string, projectIdOrSlug: string): Promise<unknown | null>
  createProject(workspaceId: string, input: import('@craft-agent/shared/projects/types').CreateProjectInput): Promise<import('@craft-agent/shared/projects/types').ProjectConfig>
  updateProject(workspaceId: string, projectSlug: string, patch: Partial<Omit<import('@craft-agent/shared/projects/types').ProjectConfig, 'id' | 'slug' | 'createdAt'>>): Promise<import('@craft-agent/shared/projects/types').ProjectConfig>
  deleteProject(workspaceId: string, projectSlug: string): Promise<void>
  listProjectAssets(workspaceId: string, projectSlug: string): Promise<unknown>
  uploadProjectAsset(workspaceId: string, projectSlug: string, input: { filename: string; base64?: string; text?: string; sourcePath?: string }): Promise<import('@craft-agent/shared/projects/types').ProjectAsset>
  deleteProjectAsset(workspaceId: string, projectSlug: string, filename: string): Promise<void>
  onProjectsChanged(callback: (workspaceId: string, projects: unknown) => void): () => void

  // Kanban board config (workspace-scoped)
  getKanbanConfig(workspaceId: string): Promise<import('@craft-agent/shared/kanban').KanbanBoardConfig>
  setKanbanConfig(workspaceId: string, config: import('@craft-agent/shared/kanban').KanbanBoardConfig): Promise<import('@craft-agent/shared/kanban').KanbanBoardConfig>
  onKanbanConfigChanged(callback: (workspaceId: string, config: import('@craft-agent/shared/kanban').KanbanBoardConfig) => void): () => void

  // Sessions collection display (workspace-scoped)
  getCollectionDisplay(workspaceId: string): Promise<import('@craft-agent/shared/sessions').CollectionDisplay>
  setCollectionDisplay(workspaceId: string, display: import('@craft-agent/shared/sessions').CollectionDisplay): Promise<import('@craft-agent/shared/sessions').CollectionDisplay>
  onCollectionDisplayChanged(callback: (workspaceId: string, display: import('@craft-agent/shared/sessions').CollectionDisplay) => void): () => void


  // Automations
  getAutomations(workspaceId: string): Promise<unknown>
  getAutomationGraph(workspaceId: string): Promise<AutomationGraphProjection>
  saveAutomationGraph(payload: SaveAutomationGraphPayload): Promise<SavedAutomationGraph>

  // Automation testing (manual trigger)
  testAutomation(payload: TestAutomationPayload): Promise<TestAutomationResult>

  // Automation state management
  setAutomationEnabled(workspaceId: string, eventName: string, matcherIndex: number, enabled: boolean): Promise<void>
  duplicateAutomation(workspaceId: string, eventName: string, matcherIndex: number): Promise<void>
  deleteAutomation(workspaceId: string, eventName: string, matcherIndex: number): Promise<void>
  getAutomationHistory(workspaceId: string, automationId: string, limit?: number): Promise<Array<{ id: string; ts: number; ok: boolean; sessionId?: string; prompt?: string; error?: string; webhook?: { method: string; url: string; statusCode: number; durationMs: number; attempts?: number; error?: string; responseBody?: string } }>>
  getAutomationLastExecuted(workspaceId: string): Promise<Record<string, number>>
  replayAutomation(workspaceId: string, automationId: string, eventName: string): Promise<{ results: Array<{ type: string; url: string; statusCode: number; success: boolean; error?: string; duration: number }> }>

  // Automations change listener
  onAutomationsChanged(callback: (workspaceId: string) => void): () => void

  // Language
  changeLanguage(lang: string): Promise<void>

  // Resources (cross-workspace export/import)
  exportResources(workspaceId: string, options: ExportResourcesOptions): Promise<ExportResult>
  importResources(workspaceId: string, bundle: ResourceBundle, mode: ResourceImportMode): Promise<ResourceImportResult>

  // Messaging gateway — workspaceId is taken from the client handshake (ctx.workspaceId)
  getMessagingConfig(): Promise<{
    enabled: boolean
    platforms: Record<string, { enabled: boolean; accessMode?: MessagingPlatformAccessMode; owners?: MessagingPlatformOwnerInfo[] } | undefined>
    runtime: Record<string, MessagingPlatformRuntimeInfo | undefined>
  } | null>
  updateMessagingConfig(config: Record<string, unknown>): Promise<void>
  testTelegramToken(token: string): Promise<{ success: boolean; botName?: string; botUsername?: string; error?: string }>
  saveTelegramToken(token: string): Promise<void>
  testLarkCredentials(creds: { appId: string; appSecret: string; domain: 'lark' | 'feishu' }): Promise<{ success: boolean; botName?: string; error?: string }>
  saveLarkCredentials(creds: { appId: string; appSecret: string; domain: 'lark' | 'feishu' }): Promise<void>
  testDiscordCredentials(creds: { token: string }): Promise<{ success: boolean; botName?: string; error?: string }>
  saveDiscordCredentials(creds: { token: string }): Promise<void>
  disconnectMessagingPlatform(platform: string): Promise<void>
  forgetMessagingPlatform(platform: string): Promise<void>
  getMessagingBindings(): Promise<Array<{ id: string; workspaceId: string; sessionId: string; platform: string; channelId: string; threadId?: number; channelName?: string; enabled: boolean; createdAt: number; accessMode?: MessagingBindingAccessMode; allowedSenderIds?: string[] }>>
  generateMessagingPairingCode(sessionId: string, platform: string): Promise<{ code: string; expiresAt: number; botUsername?: string }>
  /** Telegram supergroup pairing — returns a code typed in the supergroup to capture its chatId. */
  generateMessagingSupergroupCode(platform: string): Promise<{ code: string; expiresAt: number; botUsername?: string }>
  /** Read the workspace's currently paired Telegram supergroup, if any. */
  getMessagingSupergroup(): Promise<{ chatId: string; title: string; capturedAt: number } | null>
  /** Forget the paired Telegram supergroup (existing topic bindings stay on disk but stop matching). */
  unbindMessagingSupergroup(): Promise<{ success: boolean }>
  unbindMessagingSession(sessionId: string, platform?: string): Promise<void>
  unbindMessagingBinding(bindingId: string): Promise<{ success: boolean }>
  onMessagingBindingChanged(callback: (workspaceId: string) => void): () => void
  onMessagingPlatformStatus(callback: (workspaceId: string, platform: string, status: MessagingPlatformRuntimeInfo) => void): () => void
  // WhatsApp (subprocess-based Baileys adapter)
  startWhatsAppConnect(): Promise<{ success: boolean }>
  submitWhatsAppPhone(phoneNumber: string): Promise<{ success: boolean }>
  onWhatsAppEvent(callback: (payload: { workspaceId: string; event: WhatsAppUiEvent }) => void): () => void
  // WeChat (微信 iLink ClawBot adapter)
  startWeChatConnect(): Promise<{ success: boolean }>
  submitWeChatVerifyCode(code: string): Promise<{ success: boolean }>
  onWeChatEvent(callback: (payload: { workspaceId: string; event: WeChatUiEvent }) => void): () => void
  // Messaging access control (Phase 3)
  getMessagingPlatformOwners(platform: string): Promise<MessagingPlatformOwnerInfo[]>
  setMessagingPlatformOwners(platform: string, owners: MessagingPlatformOwnerInfo[]): Promise<MessagingPlatformOwnerInfo[]>
  getMessagingPlatformAccessMode(platform: string): Promise<MessagingPlatformAccessMode>
  setMessagingPlatformAccessMode(platform: string, mode: MessagingPlatformAccessMode): Promise<{ success: boolean }>
  getMessagingPendingSenders(platform?: string): Promise<MessagingPendingSenderInfo[]>
  dismissMessagingPendingSender(platform: string, userId: string, opts?: { reason?: MessagingPendingRejectReason; bindingId?: string }): Promise<{ success: boolean }>
  allowMessagingPendingSender(
    platform: string,
    userId: string,
    entryKey?: { reason?: MessagingPendingRejectReason; bindingId?: string },
  ): Promise<{ owners: MessagingPlatformOwnerInfo[]; bindingId?: string }>
  setMessagingBindingAccess(bindingId: string, access: { mode: MessagingBindingAccessMode; allowedSenderIds?: string[] }): Promise<{ success: boolean }>
  onMessagingPendingChanged(callback: (workspaceId: string) => void): () => void

  // Context documents (runtime context/*.md — soul, rules, user docs)
  listContextDocs(): Promise<ContextDocInfo[]>
  readContextDoc(filename: string): Promise<ContextDocContent>
  writeContextDoc(filename: string, content: string): Promise<ContextDocInfo>
  deleteContextDoc(filename: string): Promise<void>
  readContextDocTemplate(filename: string): Promise<string | null>
  acceptContextDocTemplate(filename: string): Promise<ContextDocInfo>
  keepMineContextDocTemplate(filename: string): Promise<ContextDocInfo>
  onContextDocsChanged(callback: () => void): () => void

  // Bundled skill packs (preset skills)
  listBundledSkillPacks(): Promise<BundledSkillPackStatus[]>
  getBundledSkillsDisabled(): Promise<string[]>
  setBundledSkillsDisabled(slugs: string[]): Promise<string[]>
  onBundledSkillsChanged(callback: (payload: { disabled: string[] }) => void): () => void

  // Marketplace (curated catalog → local config-dir installs)
  getMarketplaceCatalog(): Promise<MarketplaceCatalogResult>
  getMarketplaceStats(): Promise<Record<string, MarketplaceEntryStats>>
  installMarketplaceEntry(id: string): Promise<MarketplaceInstallResult>
  removeMarketplaceEntry(id: string): Promise<MarketplaceRemoveResult>
  updateMarketplaceEntry(id: string): Promise<MarketplaceInstallResult>
  refreshMarketplaceCatalog(): Promise<MarketplaceCatalogResult>
  onMarketplaceProgress(callback: (payload: MarketplaceProgressPayload) => void): () => void
  onMarketplaceChanged(callback: (payload: MarketplaceChangedPayload) => void): () => void
}

export interface MessagingPlatformRuntimeInfo {
  platform: string
  configured: boolean
  connected: boolean
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnect_required' | 'error'
  identity?: string
  lastError?: string
  updatedAt: number
}

/**
 * Workspace-level access policy for a messaging platform.
 * Mirrors the canonical type in `@craft-agent/messaging-gateway`.
 */
export type MessagingPlatformAccessMode = 'public-inbox' | 'owner-control' | 'disabled'

/** Per-binding access policy. */
export type MessagingBindingAccessMode = 'public-inbox' | 'owner-control' | 'disabled'

export interface MessagingPlatformOwnerInfo {
  userId: string
  displayName?: string
  username?: string
  addedAt: number
}

export type MessagingPendingRejectReason = 'not-owner' | 'not-on-binding-allowlist'

export interface MessagingPendingSenderInfo {
  platform: string
  userId: string
  displayName?: string
  username?: string
  lastAttemptAt: number
  attemptCount: number
  reason?: MessagingPendingRejectReason
  bindingId?: string
  sessionId?: string
  channelId?: string
  threadId?: number
}

/** Event payloads broadcast from the WhatsApp subprocess to the UI. */
export type WhatsAppUiEvent =
  | { type: 'qr'; qr: string }
  | { type: 'pairing_code'; code: string }
  | { type: 'connected'; jid?: string; name?: string }
  | { type: 'disconnected'; loggedOut: boolean; reason?: string }
  | { type: 'unavailable'; reason: string; message: string }
  | { type: 'error'; message: string }

/** Event payloads broadcast from the WeChat login flow to the UI. */
export type WeChatUiEvent =
  | { type: 'qr'; qr: string }
  | { type: 'scanned' }
  | { type: 'need_verifycode' }
  | { type: 'connected' }
  | { type: 'error'; message: string }

// =============================================================================
// Navigation types (renderer-only)
// =============================================================================

/**
 * Right sidebar panel types
 */
export type RightSidebarPanel =
  | { type: 'files'; path?: string }
  | { type: 'history' }
  | { type: 'none' }

/**
 * Session filter options
 */
export type SessionFilter =
  | { kind: 'allSessions' }
  | { kind: 'flagged' }
  | { kind: 'state'; stateId: string }
  | { kind: 'label'; labelId: string }
  | { kind: 'view'; viewId: string }
  | { kind: 'archived' }

/**
 * Settings subpage options - re-exported from settings-registry (single source of truth)
 */
export type { SettingsSubpage } from './settings-registry'
import { isValidSettingsSubpage, type SettingsSubpage } from './settings-registry'

/**
 * Sessions navigation state
 */
export interface SessionsNavigationState {
  navigator: 'sessions'
  filter: SessionFilter
  details: { type: 'session'; sessionId: string } | null
  rightSidebar?: RightSidebarPanel
  /**
   * Presentation mode for the sessions navigator.
   * - Absent/`'list'` — default list + chat.
   * - `'board'` — Kanban (all sessions, To Do / In Progress / Done) in the content area.
   * - `'table'` — dense collection/issue-line table view in the content area.
   */
  viewMode?: 'list' | 'board' | 'table'
}

/**
 * Source type filter for sources navigation
 */
export interface SourceFilter {
  kind: 'type'
  sourceType: 'api' | 'mcp' | 'local'
}

/**
 * Automation type filter for automations navigation
 */
export interface AutomationFilter {
  kind: 'type'
  automationType: 'scheduled' | 'event' | 'agentic'
}

/**
 * Sources navigation state
 */
export interface SourcesNavigationState {
  navigator: 'sources'
  filter?: SourceFilter
  details: { type: 'source'; sourceSlug: string } | null
  rightSidebar?: RightSidebarPanel
}

/**
 * Settings navigation state
 *
 * `subpage: null` means the bare `settings` route — navigator-only view in compact
 * mode. On desktop, the content panel falls back to the App page so it isn't empty.
 * Sources/Skills/Automations use `details: null` for the same purpose.
 */
export interface SettingsNavigationState {
  navigator: 'settings'
  subpage: SettingsSubpage | null
  rightSidebar?: RightSidebarPanel
}

/**
 * Skills navigation state
 */
export interface SkillsNavigationState {
  navigator: 'skills'
  details: { type: 'skill'; skillSlug: string } | null
  rightSidebar?: RightSidebarPanel
}

/**
 * Notes navigation state
 */
export interface NotesNavigationState {
  navigator: 'notes'
  details: { type: 'note'; noteId: string } | null
  rightSidebar?: RightSidebarPanel
}

/**
 * Automations navigation state
 */
export interface AutomationsNavigationState {
  navigator: 'automations'
  filter?: AutomationFilter
  details: { type: 'automation'; automationId: string } | null
  rightSidebar?: RightSidebarPanel
}

/**
 * Projects navigation state
 */
export interface ProjectsNavigationState {
  navigator: 'projects'
  details: { type: 'project'; projectSlug: string } | null
  rightSidebar?: RightSidebarPanel
}

/**
 * Browser navigation state (embedded browser instance panel)
 */
export interface BrowserNavigationState {
  navigator: 'browser'
  details: { type: 'browser'; id: string } | null
  rightSidebar?: RightSidebarPanel
}

/**
 * Memory navigator state (self-learning panel)
 */
export interface MemoryNavigationState {
  navigator: 'memory'
  details: null
  rightSidebar?: RightSidebarPanel
}

export interface ConnectionsNavigationState {
  navigator: 'connections'
  details: null
  rightSidebar?: RightSidebarPanel
}

/**
 * Knowledge ref kinds, mirrored from the Knowledge Provider contract
 * (spec K-03 §3.1: `KnowledgeRef { scheme:'siyuan'; kind; id }`). Declared
 * locally because apps/electron does not import @craft-agent/core.
 */
export type KnowledgeRefKind = 'notebook' | 'document' | 'block' | 'database' | 'asset'

/**
 * Knowledge surface navigation state (W1 scaffolding; host UI lands in W2).
 * `details.kind === 'database'` is the database SurfaceTab kind — same navigator.
 * P5: `type: 'knowledge-view'` carries a saved-view id for KnowledgeHome deep-links.
 */
export interface KnowledgeNavigationState {
  navigator: 'knowledge'
  details:
    | { type: 'knowledge'; kind: KnowledgeRefKind; id: string }
    | { type: 'knowledge-view'; viewId: string }
    | null
  rightSidebar?: RightSidebarPanel
}

/**
 * Cloud run surface navigation state (W1 scaffolding; run surface lands in W2).
 */
export interface CloudRunNavigationState {
  navigator: 'cloud-run'
  details: { type: 'cloud-run'; runId: string } | null
  rightSidebar?: RightSidebarPanel
}

/**
 * Extension surface navigation state (W1 scaffolding; sandbox views land in W5).
 */
export interface ExtensionNavigationState {
  navigator: 'extension'
  details: { type: 'extension'; extensionId: string; viewId?: string } | null
  rightSidebar?: RightSidebarPanel
}

/**
 * Write-proposal diff surface navigation state (W1 scaffolding; host arrives
 * with the mutation-safety contour, spec K-05).
 */
export interface DiffNavigationState {
  navigator: 'diff'
  details: { type: 'diff'; proposalId: string } | null
  rightSidebar?: RightSidebarPanel
}

/**
 * Unified navigation state
 */
export type NavigationState =
  | SessionsNavigationState
  | SourcesNavigationState
  | SettingsNavigationState
  | SkillsNavigationState
  | NotesNavigationState
  | AutomationsNavigationState
  | ProjectsNavigationState
  | BrowserNavigationState
  | MemoryNavigationState
  | KnowledgeNavigationState
  | CloudRunNavigationState
  | ExtensionNavigationState
  | DiffNavigationState
  | ConnectionsNavigationState

export const isSessionsNavigation = (
  state: NavigationState
): state is SessionsNavigationState => state.navigator === 'sessions'

export const isSourcesNavigation = (
  state: NavigationState
): state is SourcesNavigationState => state.navigator === 'sources'

export const isSettingsNavigation = (
  state: NavigationState
): state is SettingsNavigationState => state.navigator === 'settings'

export const isSkillsNavigation = (
  state: NavigationState
): state is SkillsNavigationState => state.navigator === 'skills'

export const isNotesNavigation = (
  state: NavigationState
): state is NotesNavigationState => state.navigator === 'notes'

export const isAutomationsNavigation = (
  state: NavigationState
): state is AutomationsNavigationState => state.navigator === 'automations'

export const isProjectsNavigation = (
  state: NavigationState
): state is ProjectsNavigationState => state.navigator === 'projects'

export const isBrowserNavigation = (
  state: NavigationState
): state is BrowserNavigationState => state.navigator === 'browser'
export const isMemoryNavigation = (
  state: NavigationState
): state is MemoryNavigationState => state.navigator === 'memory'

export const isConnectionsNavigation = (
  state: NavigationState
): state is ConnectionsNavigationState => state.navigator === 'connections'

export const isKnowledgeNavigation = (
  state: NavigationState
): state is KnowledgeNavigationState => state.navigator === 'knowledge'

export const isCloudRunNavigation = (
  state: NavigationState
): state is CloudRunNavigationState => state.navigator === 'cloud-run'

export const isExtensionNavigation = (
  state: NavigationState
): state is ExtensionNavigationState => state.navigator === 'extension'

export const isDiffNavigation = (
  state: NavigationState
): state is DiffNavigationState => state.navigator === 'diff'

export const DEFAULT_NAVIGATION_STATE: NavigationState = {
  navigator: 'sessions',
  filter: { kind: 'allSessions' },
  details: null,
}

export const getNavigationStateKey = (state: NavigationState): string => {
  if (state.navigator === 'sources') {
    if (state.details) {
      return `sources/source/${state.details.sourceSlug}`
    }
    return 'sources'
  }
  if (state.navigator === 'skills') {
    if (state.details?.type === 'skill') {
      return `skills/skill/${state.details.skillSlug}`
    }
    return 'skills'
  }
  if (state.navigator === 'notes') {
    if (state.details?.type === 'note') {
      return `notes/note/${encodeURIComponent(state.details.noteId)}`
    }
    return 'notes'
  }
  if (state.navigator === 'automations') {
    if (state.details?.type === 'automation') {
      return `automations/automation/${state.details.automationId}`
    }
    return 'automations'
  }
  if (state.navigator === 'projects') {
    if (state.details?.type === 'project') {
      return `projects/project/${state.details.projectSlug}`
    }
    return 'projects'
  }
  if (state.navigator === 'settings') {
    if (state.subpage === null) return 'settings'
    return `settings:${state.subpage}`
  }
  if (state.navigator === 'browser') {
    if (state.details?.type === 'browser') {
      return `browser/instance/${state.details.id}`
    }
    return 'browser'
  }
  if (state.navigator === 'memory') {
    return 'memory'
  }
  if (state.navigator === 'connections') {
    return 'connections'
  }
  // Unified-shell surfaces (W1) — key format mirrors the route format
  if (state.navigator === 'knowledge') {
    if (state.details?.type === 'knowledge') {
      return `knowledge/${state.details.kind}/${encodeURIComponent(state.details.id)}`
    }
    if (state.details?.type === 'knowledge-view') {
      return `knowledge/view/${encodeURIComponent(state.details.viewId)}`
    }
    return 'knowledge'
  }
  if (state.navigator === 'cloud-run') {
    if (state.details?.type === 'cloud-run') {
      return `cloud-run/${encodeURIComponent(state.details.runId)}`
    }
    return 'cloud-run'
  }
  if (state.navigator === 'extension') {
    if (state.details?.type === 'extension') {
      const base = `extension/${encodeURIComponent(state.details.extensionId)}`
      return state.details.viewId ? `${base}/${encodeURIComponent(state.details.viewId)}` : base
    }
    return 'extension'
  }
  if (state.navigator === 'diff') {
    if (state.details?.type === 'diff') {
      return `diff/${encodeURIComponent(state.details.proposalId)}`
    }
    return 'diff'
  }
  // Chats
  const f = state.filter
  let base: string
  if (f.kind === 'state') base = `state:${f.stateId}`
  else if (f.kind === 'label') base = `label:${f.labelId}`
  else if (f.kind === 'view') base = `view:${f.viewId}`
  else base = f.kind
  if (state.details) {
    return `${base}/chat/${state.details.sessionId}`
  }
  return base
}

export const parseNavigationStateKey = (key: string): NavigationState | null => {
  // Handle sources
  if (key === 'sources') return { navigator: 'sources', details: null }
  if (key.startsWith('sources/source/')) {
    const sourceSlug = key.slice(15)
    if (sourceSlug) {
      return { navigator: 'sources', details: { type: 'source', sourceSlug } }
    }
    return { navigator: 'sources', details: null }
  }

  // Handle skills
  if (key === 'skills') return { navigator: 'skills', details: null }
  if (key.startsWith('skills/skill/')) {
    const skillSlug = key.slice(13)
    if (skillSlug) {
      return { navigator: 'skills', details: { type: 'skill', skillSlug } }
    }
    return { navigator: 'skills', details: null }
  }

  // Canonical local Markdown Notes keys.
  if (key === 'notes') return { navigator: 'notes', details: null }
  if (key.startsWith('notes/note/')) {
    const noteId = decodeURIComponent(key.slice('notes/note/'.length))
    if (noteId) {
      return { navigator: 'notes', details: { type: 'note', noteId } }
    }
    return { navigator: 'notes', details: null }
  }


  // Handle automations
  if (key === 'automations') return { navigator: 'automations', details: null }
  if (key.startsWith('automations/automation/')) {
    const automationId = key.slice(22)
    if (automationId) {
      return { navigator: 'automations', details: { type: 'automation', automationId } }
    }
    return { navigator: 'automations', details: null }
  }

  // Handle projects
  if (key === 'projects') return { navigator: 'projects', details: null }
  if (key.startsWith('projects/project/')) {
    const projectSlug = key.slice(17)
    if (projectSlug) {
      return { navigator: 'projects', details: { type: 'project', projectSlug } }
    }
    return { navigator: 'projects', details: null }
  }

  // Handle browser
  if (key === 'browser') return { navigator: 'browser', details: null }
  if (key.startsWith('browser/instance/')) {
    const id = key.slice(17)
    if (id) {
      return { navigator: 'browser', details: { type: 'browser', id } }
    }
    return { navigator: 'browser', details: null }
  }

  // Handle settings
  if (key === 'settings') return { navigator: 'settings', subpage: null }
  if (key.startsWith('settings:')) {
    const subpage = key.slice(9)
    // Legacy subpages absorbed into other tabs
    if (subpage === 'toolchain') return { navigator: 'settings', subpage: 'runtime' }
    if (subpage === 'preferences') return { navigator: 'settings', subpage: 'context' }
    if (isValidSettingsSubpage(subpage)) {
      return { navigator: 'settings', subpage }
    }
  }

  // Handle unified-shell surfaces (W1) — key format mirrors the route format
  if (key === 'knowledge') return { navigator: 'knowledge', details: null }
  if (key.startsWith('knowledge/')) {
    const rest = key.slice(10)
    const kind = rest.split('/')[0]
    const id = rest.slice(kind.length + 1)
    if (kind === 'view' && id) {
      return {
        navigator: 'knowledge',
        details: { type: 'knowledge-view', viewId: decodeURIComponent(id) },
      }
    }
    if ((['notebook', 'document', 'block', 'database', 'asset'] as const).includes(kind as KnowledgeRefKind) && id) {
      return {
        navigator: 'knowledge',
        details: { type: 'knowledge', kind: kind as KnowledgeRefKind, id: decodeURIComponent(id) },
      }
    }
    return { navigator: 'knowledge', details: null }
  }

  if (key === 'cloud-run') return { navigator: 'cloud-run', details: null }
  if (key.startsWith('cloud-run/')) {
    const runId = key.slice(10)
    if (runId) {
      return { navigator: 'cloud-run', details: { type: 'cloud-run', runId: decodeURIComponent(runId) } }
    }
    return { navigator: 'cloud-run', details: null }
  }

  if (key === 'extension') return { navigator: 'extension', details: null }
  if (key.startsWith('extension/')) {
    const rest = key.slice(10)
    const slash = rest.indexOf('/')
    const extensionId = slash === -1 ? rest : rest.slice(0, slash)
    const viewId = slash === -1 ? '' : rest.slice(slash + 1)
    if (extensionId) {
      return {
        navigator: 'extension',
        details: {
          type: 'extension',
          extensionId: decodeURIComponent(extensionId),
          ...(viewId ? { viewId: decodeURIComponent(viewId) } : {}),
        },
      }
    }
    return { navigator: 'extension', details: null }
  }

  if (key === 'diff') return { navigator: 'diff', details: null }
  if (key.startsWith('diff/')) {
    const proposalId = key.slice(5)
    if (proposalId) {
      return { navigator: 'diff', details: { type: 'diff', proposalId: decodeURIComponent(proposalId) } }
    }
    return { navigator: 'diff', details: null }
  }

  if (key === 'connections') return { navigator: 'connections', details: null }

  // Handle sessions
  const parseSessionsKey = (filterKey: string, sessionId?: string): NavigationState | null => {
    let filter: SessionFilter
    if (filterKey === 'allSessions') filter = { kind: 'allSessions' }
    else if (filterKey === 'flagged') filter = { kind: 'flagged' }
    else if (filterKey === 'archived') filter = { kind: 'archived' }
    else if (filterKey.startsWith('state:')) {
      const stateId = filterKey.slice(6)
      if (!stateId) return null
      filter = { kind: 'state', stateId }
    } else if (filterKey.startsWith('label:')) {
      const labelId = filterKey.slice(6)
      if (!labelId) return null
      filter = { kind: 'label', labelId }
    } else if (filterKey.startsWith('view:')) {
      const viewId = filterKey.slice(5)
      if (!viewId) return null
      filter = { kind: 'view', viewId }
    } else {
      return null
    }
    return {
      navigator: 'sessions',
      filter,
      details: sessionId ? { type: 'session', sessionId } : null,
    }
  }

  // Check for session details
  if (key.includes('/session/')) {
    const [filterPart, , sessionId] = key.split('/')
    return parseSessionsKey(filterPart, sessionId)
  }

  // Simple filter key
  return parseSessionsKey(key)
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
