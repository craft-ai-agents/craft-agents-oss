/**
 * Folder-Based Agent Types
 *
 * Agents stored as folders with editable markdown instructions.
 *
 * File structure (workspace-scoped):
 * ~/.craft-agent/workspaces/{workspaceId}/agents/{agentSlug}/
 *   ├── config.json       - Agent metadata
 *   ├── instructions.md   - System prompt addition
 *   ├── icon.png          - Optional custom icon
 *   └── sources/          - Agent-scoped sources
 *       └── {sourceSlug}/
 *           ├── config.json
 *           └── guide.md
 */

import type { LoadedSource, LocalSourceConfig } from '../sources/types.ts';
import type { McpServerConfig, ApiConfig } from './types.ts';

/**
 * Agent source reference (where instructions came from)
 */
export interface AgentSourceRef {
  type: 'url' | 'local';

  // For URL sources
  url?: string;

  // Sync tracking
  lastSynced?: number;
}

/**
 * Main agent configuration (stored in config.json)
 * Note: slug is the unique identifier for the agent (folder name)
 */
export interface FolderAgentConfig {
  name: string;
  slug: string;
  enabled: boolean;

  // Optional: where instructions originated
  source?: AgentSourceRef;

  // Global sources this agent should have access to
  useSources?: string[]; // Array of source slugs

  // Metadata
  createdAt: number;
  updatedAt: number;
}

/**
 * Fully loaded agent with all files
 */
export interface LoadedAgent {
  config: FolderAgentConfig;
  instructions: string | null; // Content of instructions.md
  iconPath: string | null;
  sources: LoadedSource[]; // Resolved agent-scoped + referenced workspace sources

  /**
   * Workspace this agent belongs to.
   * Used for source resolution and credential lookups.
   */
  workspaceId: string;
}

/**
 * Agent definition for CraftAgent (compatible with existing SubAgentDefinition)
 */
export interface AgentDefinition {
  name: string;
  instructions: string;

  // Sources converted to existing format for compatibility
  mcpServers?: McpServerConfig[];
  apis?: ApiConfig[];

  // Local sources get special handling
  localSources?: LocalSourceConfig[];

  // Raw content for reference
  rawContent: string;
  parsedAt: number;
}

/**
 * Agent creation input (without auto-generated fields)
 */
export interface CreateAgentInput {
  name: string;
  instructions: string;
  source?: AgentSourceRef;
  useSources?: string[];
  enabled?: boolean;
}
