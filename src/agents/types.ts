/**
 * Sub-agent type definitions
 *
 * Sub-agents are specialized AI personas defined by Craft documents.
 * Users @mention agents to activate them, and agents can self-modify
 * their instructions via the von Neumann architecture pattern.
 */

/**
 * Metadata for a sub-agent stored in local cache
 */
export interface SubAgentMetadata {
  /** Unique identifier (derived from document ID) */
  id: string;
  /** Short name for @mention (e.g., "writer", "work/coder") */
  name: string;
  /** Original document title for display (e.g., "My Writer Agent") */
  displayName?: string;
  /** Craft document ID containing the agent definition */
  documentId: string;
  /** Workspace this agent belongs to */
  workspaceId: string;
  /** When the agent was first discovered */
  createdAt: number;
  /** Folder path within Agents folder (e.g., ["work"] or ["personal", "creative"]) */
  folderPath?: string[];
}

/**
 * Parsed content from a sub-agent document
 *
 * Document structure:
 * - Agent Name (document title)
 *   ├── Instructions (subpage - contains behavior + learnings)
 *   └── MCP Servers (optional - configs in code blocks)
 */
export interface SubAgentDefinition {
  /** Agent name (from document title) */
  name: string;
  /** Content of Instructions subpage */
  instructions: string;
  /** Block ID of Instructions subpage (for self-modification, optional with AI extraction) */
  instructionsBlockId?: string;
  /** MCP server configs parsed from code blocks */
  mcpServers?: McpServerConfig[];
  /** REST API configs extracted from curl examples or documentation */
  apis?: ApiConfig[];
  /** Info messages from extraction (warnings, notices, etc.) */
  info?: string[];
  /** Concerns identified during extraction that need user clarification */
  concerns?: Concern[];
  /** Auto-generated list of key capabilities this agent has */
  capabilities?: string[];
  /** Full raw content for reference */
  rawContent: string;
  /** When this was parsed */
  parsedAt: number;
}

/**
 * MCP server configuration parsed from agent document
 */
export interface McpServerConfig {
  /** Server identifier */
  name: string;
  /** MCP server URL */
  url: string;
  /** If true, needs OAuth authentication */
  requiresAuth?: boolean;
  /** Static bearer token (alternative to OAuth) */
  bearerToken?: string;
  /** Optional description */
  description?: string;
  /** Tools available on this server (populated after connection) */
  tools?: string[];
}

/**
 * REST API configuration extracted from agent document
 * APIs are converted to in-process MCP servers at runtime.
 *
 * Each API becomes ONE flexible tool that accepts { path, method, params }.
 * The documentation field contains rich API reference text that helps
 * Claude figure out how to use the API correctly.
 */
export interface ApiConfig {
  /** API identifier - becomes the tool name (e.g., "exa") */
  name: string;
  /** Base URL for API requests */
  baseUrl: string;
  /**
   * Authentication configuration.
   * - 'none': No authentication required (public API)
   * - 'header': Custom header (uses headerName field)
   * - 'bearer': Authorization: {authScheme} {key} (authScheme defaults to "Bearer")
   * - 'query': Query parameter (uses queryParam field)
   * - 'basic': HTTP Basic Authentication (username:password)
   */
  auth?: {
    type: 'none' | 'header' | 'bearer' | 'query' | 'basic';
    /** Header name for type='header' (e.g., "x-api-key") */
    headerName?: string;
    /** Query param name for type='query' (e.g., "api_key", "key") */
    queryParam?: string;
    /** Custom Authorization scheme for type='bearer' (default: "Bearer"). Examples: "Token", "ApiKey" */
    authScheme?: string;
    /** Custom label for credential prompt (e.g., "API Key" instead of default). For basic auth, this is the username label. */
    credentialLabel?: string;
    /** Custom label for password field in basic auth (e.g., "Secret Key" instead of "password") */
    secretLabel?: string;
  };
  /**
   * Rich API documentation as markdown text.
   * Included directly in the tool description so Claude knows how to use the API.
   * Should contain: endpoints, parameters, examples, constraints, etc.
   * Optional for backwards compatibility with old cached definitions.
   */
  documentation?: string;
  /** Link to official API documentation if found */
  docsUrl?: string;
}

/**
 * Concern identified during agent definition extraction
 */
export interface Concern {
  /** Type of concern */
  type: 'confusing' | 'conflicting' | 'missing' | 'general';
  /** Description of the concern */
  description: string;
  /** Relevant text from instructions (optional) */
  context?: string;
  /** Suggested question to ask user (optional) */
  suggestedQuestion?: string;
  /** Pre-defined answer options if logical choices exist (optional) */
  suggestedAnswers?: string[];
}

/**
 * Current active agent state
 */
export interface ActiveAgentState {
  /** Whether main agent or sub-agent is active */
  type: 'main' | 'sub-agent';
  /** Sub-agent ID if type is 'sub-agent' */
  agentId?: string;
  /** When the agent was activated */
  activatedAt?: number;
}

/**
 * Cached sub-agent with metadata and optional definition
 */
export interface CachedSubAgent {
  metadata: SubAgentMetadata;
  /** Definition is null if not yet fetched */
  definition: SubAgentDefinition | null;
  /** Unix timestamp when cache expires */
  cacheExpiry: number;
}

/**
 * Agent registry stored per workspace
 */
export interface AgentRegistry {
  /** All discovered agents */
  agents: SubAgentMetadata[];
  /** ID of the "Agents" folder in Craft */
  agentsFolderId?: string;
  /** When the registry was last refreshed */
  lastRefreshed: number;
}
