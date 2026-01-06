/**
 * Source Types
 *
 * Sources are external data connections (MCP servers, APIs, local filesystems).
 * They replace the old "connections" concept with a more flexible, folder-based architecture.
 *
 * File structure (workspace-scoped):
 * ~/.craft-agent/workspaces/{workspaceId}/sources/{sourceSlug}/
 *   ├── config.json   - Source settings
 *   └── guide.md      - Usage guidelines + cached data (in YAML frontmatter)
 *
 * Agent-scoped sources:
 * ~/.craft-agent/workspaces/{workspaceId}/agents/{agentSlug}/sources/{sourceSlug}/
 */

/**
 * Source types - how we connect to the source
 */
export type SourceType = 'mcp' | 'api' | 'local';

/**
 * MCP authentication types
 */
export type McpAuthType = 'oauth' | 'bearer' | 'none';

/**
 * API authentication types
 */
export type ApiAuthType = 'bearer' | 'header' | 'query' | 'basic' | 'none';

/**
 * Google service types for OAuth scope selection
 */
export type GoogleService = 'gmail' | 'calendar' | 'drive' | 'docs' | 'sheets';

/**
 * Infer Google service from API baseUrl.
 * Returns undefined if URL doesn't match a known Google API pattern.
 */
export function inferGoogleServiceFromUrl(baseUrl: string | undefined): GoogleService | undefined {
  if (!baseUrl) return undefined;
  const url = baseUrl.toLowerCase();

  if (url.includes('calendar.googleapis.com') || url.includes('/calendar/')) return 'calendar';
  if (url.includes('drive.googleapis.com') || url.includes('/drive/')) return 'drive';
  if (url.includes('gmail.googleapis.com') || url.includes('/gmail/')) return 'gmail';
  if (url.includes('docs.googleapis.com') || url.includes('/documents/')) return 'docs';
  if (url.includes('sheets.googleapis.com') || url.includes('/spreadsheets/')) return 'sheets';
  return undefined;
}

/**
 * Known providers for special handling (OAuth flows, icons, etc.)
 * These have well-known OAuth endpoints or special behavior.
 */
export type KnownProvider =
  | 'google' // Google APIs (Gmail, etc.) - uses Google OAuth
  | 'linear' // Linear - standard MCP OAuth
  | 'github' // GitHub - standard MCP OAuth
  | 'notion' // Notion - standard MCP OAuth
  | 'slack' // Slack - standard MCP OAuth
  | 'exa'; // Exa search API

/**
 * MCP transport type for sources
 * - 'http': HTTP-based MCP server (URL endpoint)
 * - 'sse': Server-Sent Events MCP server (URL endpoint)
 * - 'stdio': Local subprocess MCP server (spawned command)
 */
export type McpTransport = 'http' | 'sse' | 'stdio';

/**
 * MCP-specific configuration
 * Supports both HTTP-based and local stdio-based MCP servers.
 */
export interface McpSourceConfig {
  /**
   * Transport type. Defaults to 'http' if not specified.
   */
  transport?: McpTransport;

  // === HTTP/SSE transport fields ===
  /**
   * URL endpoint for HTTP or SSE transport.
   * Required when transport is 'http' or 'sse' (or undefined).
   */
  url?: string;

  /**
   * Authentication type for HTTP/SSE servers.
   */
  authType?: McpAuthType;

  /**
   * OAuth client ID (stored in config, not secret).
   */
  clientId?: string;

  // === Stdio transport fields ===
  /**
   * Command to spawn for stdio transport.
   * Required when transport is 'stdio'.
   */
  command?: string;

  /**
   * Arguments to pass to the command.
   */
  args?: string[];

  /**
   * Environment variables for the spawned process.
   */
  env?: Record<string, string>;
}

/**
 * API test endpoint configuration for connection validation
 */
export interface ApiTestEndpoint {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>; // For POST requests
  headers?: Record<string, string>; // Custom headers for the test request
}

/**
 * API-specific configuration
 */
export interface ApiSourceConfig {
  baseUrl: string;
  authType: ApiAuthType;
  headerName?: string; // For 'header' auth (e.g., "X-API-Key")
  queryParam?: string; // For 'query' auth (e.g., "api_key")
  authScheme?: string; // For 'bearer' auth (default: "Bearer", could be "Token")
  defaultHeaders?: Record<string, string>; // Headers to include with every request
  testEndpoint?: ApiTestEndpoint; // Endpoint to use for connection testing

  // Google OAuth fields (used when provider is 'google')
  googleService?: GoogleService; // Predefined service for scope selection
  googleScopes?: string[]; // Custom scopes (overrides googleService)
}

/**
 * Local filesystem/app configuration
 */
export interface LocalSourceConfig {
  path: string;
  format?: string; // Optional hint: 'filesystem' | 'obsidian' | 'git' | 'sqlite' | etc.
}

/**
 * Source connection status
 * - 'connected': Source is connected and working
 * - 'needs_auth': Source requires authentication
 * - 'failed': Connection failed with error
 * - 'untested': Connection has not been tested
 * - 'local_disabled': Stdio source is disabled (local MCP servers off)
 */
export type SourceConnectionStatus = 'connected' | 'needs_auth' | 'failed' | 'untested' | 'local_disabled';

/**
 * Main source configuration (stored in config.json)
 */
export interface FolderSourceConfig {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;

  // Provider is a freeform label (e.g., "linear", "todoist", "my-custom-api")
  provider: string;

  // Connection type determines which config block is used
  type: SourceType;

  // Type-specific configuration (exactly one should be present)
  mcp?: McpSourceConfig;
  api?: ApiSourceConfig;
  local?: LocalSourceConfig;

  // Icon: relative path to cached icon (e.g., "./icon.png")
  iconUrl?: string;

  // Original URL the icon was downloaded from (for re-fetching if needed)
  iconSourceUrl?: string;

  // Short description for agent context (e.g., "Issue tracking, bugs, tasks, sprints")
  // If not set, extracted from guide.md first paragraph
  tagline?: string;

  // Status tracking
  isAuthenticated?: boolean;
  connectionStatus?: SourceConnectionStatus;
  connectionError?: string; // Error message if status is 'failed'
  lastTestedAt?: number;

  // Metadata (optional - manually created configs may not have them)
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Parsed guide.md content with embedded cache
 */
export interface SourceGuide {
  // Full raw markdown
  raw: string;

  // Parsed sections (extracted via regex/parsing)
  scope?: string;
  guidelines?: string;
  context?: string;
  apiNotes?: string;

  // Embedded cache data (from YAML frontmatter)
  cache?: Record<string, unknown>;
}

/**
 * Fully loaded source with all files
 */
export interface LoadedSource {
  config: FolderSourceConfig;
  guide: SourceGuide | null;

  /** Absolute path to source folder (for resolving relative icon paths) */
  folderPath: string;

  /**
   * Workspace this source belongs to.
   * Used for credential lookups: source_oauth::{workspaceId}::{sourceSlug}
   */
  workspaceId: string;

  /**
   * If set, this source is agent-scoped.
   * Path: workspaces/{workspaceId}/agents/{agentSlug}/sources/{slug}/
   * Credentials: agent_source_oauth::{workspaceId}::{agentSlug}::{sourceSlug}
   */
  agentSlug?: string;
}

/**
 * Source creation input (without auto-generated fields)
 */
export interface CreateSourceInput {
  name: string;
  provider: string;
  type: SourceType;
  mcp?: McpSourceConfig;
  api?: ApiSourceConfig;
  local?: LocalSourceConfig;
  iconUrl?: string;
  enabled?: boolean;
}
