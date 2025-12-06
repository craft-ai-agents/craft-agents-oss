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
  /** Short name for @mention (e.g., "writer", "coder") */
  name: string;
  /** Craft document ID containing the agent definition */
  documentId: string;
  /** Workspace this agent belongs to */
  workspaceId: string;
  /** When the agent was first discovered */
  createdAt: number;
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
 * Stored credentials for agent MCP servers
 */
export interface AgentMcpCredentials {
  /** Agent this belongs to */
  agentId: string;
  /** Credentials keyed by server name */
  servers: Record<
    string,
    {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      clientId?: string;  // Needed for token refresh
    }
  >;
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
