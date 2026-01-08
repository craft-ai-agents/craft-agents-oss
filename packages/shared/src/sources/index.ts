/**
 * Sources Module
 *
 * Public exports for source management.
 */

// Types
export type {
  SourceType,
  McpAuthType,
  ApiAuthType,
  KnownProvider,
  ApiOAuthProvider,
  McpSourceConfig,
  ApiSourceConfig,
  LocalSourceConfig,
  SourceConnectionStatus,
  FolderSourceConfig,
  SourceGuide,
  LoadedSource,
  CreateSourceInput,
} from './types.ts';

// Constants and helpers
export {
  API_OAUTH_PROVIDERS,
  isApiOAuthProvider,
} from './types.ts';

// Storage functions
export {
  // Directory utilities
  ensureSourcesDir,
  getSourcePath,
  getAgentSourcePath,
  // Config operations
  loadSourceConfig,
  loadAgentSourceConfig,
  saveSourceConfig,
  saveAgentSourceConfig,
  // Agent-aware loading/saving (checks agent folder first, then workspace)
  loadSourceConfigWithFallback,
  saveSourceConfigWithContext,
  // Guide operations
  loadSourceGuide,
  loadAgentSourceGuide,
  saveSourceGuide,
  // Icon operations
  findSourceIcon,
  findIconInDir,
  // Load operations
  loadSource,
  loadAgentSource,
  loadWorkspaceSources,
  loadAgentSources,
  getEnabledSources,
  getSourcesBySlugs,
  // Create/Delete operations
  generateSourceSlug,
  createSource,
  deleteSource,
  sourceExists,
  // Parsing utilities
  parseGuideMarkdown,
} from './storage.ts';
export type { SourceWithContext } from './storage.ts';

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
} from './server-builder.ts';
export type {
  McpServerConfig,
  SourceWithCredential,
  BuiltServers,
} from './server-builder.ts';
