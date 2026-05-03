/**
 * Sources Module
 *
 * Public exports for source management.
 */

// Types
export type {
  SourceType,
  SourceTier,
  SourceMcpAuthType,
  ApiAuthType,
  KnownProvider,
  ApiOAuthProvider,
  ApiOAuthConfig,
  McpSourceConfig,
  ApiSourceConfig,
  LocalSourceConfig,
  SourceConnectionStatus,
  FolderSourceConfig,
  SourceGuide,
  LoadedSource,
  CreateSourceInput,
  ApiRenewEndpoint,
} from './types.ts';

// Constants and helpers
export {
  API_OAUTH_PROVIDERS,
  isApiOAuthProvider,
  isGenericOAuthSource,
  hasRenewEndpoint,
  isRefreshableSource,
} from './types.ts';

// Storage types
export type {
  GlobalSourcesManifest,
  LoadAllSourcesOptions,
  MirrorSourceOptions,
  MirrorSourceResult,
} from './storage.ts';

// Storage functions
export {
  // Directory utilities
  ensureSourcesDir,
  getSourcePath,
  // Config operations
  loadSourceConfig,
  saveSourceConfig,
  markSourceAuthenticated,
  markLoadedSourceAuthenticated,
  markLoadedSourceNeedsReauth,
  // Guide operations
  loadSourceGuide,
  saveSourceGuide,
  // Icon operations
  findSourceIcon,
  downloadSourceIcon,
  sourceNeedsIconDownload,
  isIconUrl,
  // Load operations
  loadSource,
  loadWorkspaceSources,
  loadAllSources,
  getEnabledSources,
  isSourceUsable,
  getSourcesBySlugs,
  // Global tier
  GLOBAL_WORKSPACE_ID,
  GLOBAL_AGENT_SOURCES_DIR,
  WORKSPACE_GLOBAL_SOURCES_MANIFEST,
  getGlobalSourcePath,
  getWorkspaceGlobalSourcesManifestPath,
  readGlobalSourcesManifest,
  isGlobalSourceActivatedInWorkspace,
  loadGlobalSource,
  loadGlobalSources,
  listGlobalSourceSlugs,
  // Write-path (Phase 2)
  writeGlobalSourcesManifest,
  activateGlobalSourceInWorkspace,
  deactivateGlobalSourceInWorkspace,
  mirrorSourceToGlobal,
  // Create/Delete operations
  generateSourceSlug,
  createSource,
  deleteSource,
  sourceExists,
  // Parsing utilities
  parseGuideMarkdown,
} from './storage.ts';

// Credential Manager (unified credential operations)
export {
  SourceCredentialManager,
  getSourceCredentialManager,
  getSourcesNeedingAuth,
} from './credential-manager.ts';
export type {
  AuthResult,
  ApiCredential,
  BasicAuthCredential,
} from './credential-manager.ts';

// Server Builder (builds MCP/API servers from sources)
export {
  SourceServerBuilder,
  getSourceServerBuilder,
  normalizeMcpUrl,
  SERVER_BUILD_ERRORS,
} from './server-builder.ts';
export type {
  McpServerConfig,
  SourceWithCredential,
  BuiltServers,
} from './server-builder.ts';

// Built-in Sources (always available in every workspace)
export {
  getDocsSource,
  getBuiltinSources,
  isBuiltinSource,
} from './builtin-sources.ts';

// API Tools (types)
export type { SummarizeCallback } from './api-tools.ts';

// Token Refresh Manager (handles OAuth token refresh with rate limiting)
export {
  TokenRefreshManager,
  createTokenGetter,
} from './token-refresh-manager.ts';
export type {
  TokenRefreshResult,
  RefreshManagerOptions,
} from './token-refresh-manager.ts';
