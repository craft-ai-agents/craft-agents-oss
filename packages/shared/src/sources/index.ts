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
  McpSourceConfig,
  ApiSourceConfig,
  LocalSourceConfig,
  FolderSourceConfig,
  SourceGuide,
  LoadedSource,
  CreateSourceInput,
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
  updateSourceCache,
  setNestedValue,
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
  // Workspace Craft source auto-creation
  ensureWorkspaceCraftSource,
  // Parsing utilities
  parseGuideMarkdown,
} from './storage.ts';
export type { SourceWithContext } from './storage.ts';

// Service
export { SourceService, createSourceService, getSourcesNeedingAuth } from './service.ts';
export type { McpServerConfig, BuiltServers } from './service.ts';
