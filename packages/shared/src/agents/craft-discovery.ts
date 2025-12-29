/**
 * Craft Agent Discovery Service
 *
 * Discovers agents from "Agents" folder in connected Craft Space.
 * Each document in the folder becomes an agent with its content as instructions.
 */

import { CraftMcpClient } from '../mcp/client.ts';
import { debug } from '../utils/debug.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { loadWorkspaceSources } from '../sources/storage.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';


/**
 * Discovered agent from Craft
 */
export interface DiscoveredAgent {
  /** Agent name (from document title) */
  name: string;
  /** Craft document ID */
  craftDocumentId: string;
  /** Agent instructions (document content) */
  instructions: string;
  /** Last modified timestamp (if available) */
  lastModified?: number;
  /** Parent folder ID */
  folderId?: string;
}

/**
 * Discovery result
 */
export interface DiscoveryResult {
  /** Successfully discovered agents */
  agents: DiscoveredAgent[];
  /** Discovery errors */
  errors: Array<{ documentId?: string; error: string }>;
  /** Whether an "Agents" folder was found */
  folderFound: boolean;
  /** The folder ID if found */
  folderId?: string;
}

/**
 * Craft discovery service options
 */
export interface CraftDiscoveryOptions {
  /** MCP server URL */
  mcpUrl: string;
  /** Access token for MCP server */
  accessToken?: string;
}

/**
 * Craft Agent Discovery Service
 *
 * Connects to a Craft Space via MCP and discovers agents from the "Agents" folder.
 */
export class CraftAgentDiscovery {
  private client: CraftMcpClient;

  constructor(options: CraftDiscoveryOptions) {
    const headers: Record<string, string> = {};
    if (options.accessToken) {
      headers['Authorization'] = `Bearer ${options.accessToken}`;
    }

    this.client = new CraftMcpClient({
      url: options.mcpUrl,
      headers,
    });
  }

  /**
   * Discover agents from the Craft "Agents" folder
   */
  async discoverAgents(): Promise<DiscoveryResult> {
    const result: DiscoveryResult = {
      agents: [],
      errors: [],
      folderFound: false,
    };

    try {
      console.log('[CraftAgentDiscovery] Connecting to MCP server...');
      await this.client.connect();
      console.log('[CraftAgentDiscovery] Connected to MCP server');
      debug('[CraftAgentDiscovery] Connected to MCP server');

      // List available tools to understand what's available
      const tools = await this.client.listTools();
      console.log('[CraftAgentDiscovery] Available tools:', tools.map(t => t.name).join(', '));

      // Step 1: Find the "Agents" folder
      console.log('[CraftAgentDiscovery] Looking for "Agents" folder...');
      const folderId = await this.findAgentsFolder(tools);
      if (!folderId) {
        console.log('[CraftAgentDiscovery] No "Agents" folder found');
        debug('[CraftAgentDiscovery] No "Agents" folder found');
        return result;
      }

      result.folderFound = true;
      result.folderId = folderId;
      console.log('[CraftAgentDiscovery] Found "Agents" folder:', folderId);
      debug('[CraftAgentDiscovery] Found "Agents" folder:', folderId);

      // Step 2: List documents in the folder
      const documents = await this.listFolderDocuments(folderId);
      debug('[CraftAgentDiscovery] Found', documents.length, 'documents in Agents folder');

      // Step 3: Fetch each document's content
      for (const doc of documents) {
        try {
          const agent = await this.fetchAgentFromDocument(doc.id, doc.title, folderId);
          if (agent) {
            result.agents.push(agent);
          }
        } catch (error) {
          result.errors.push({
            documentId: doc.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      debug('[CraftAgentDiscovery] Discovered', result.agents.length, 'agents');
      return result;
    } catch (error) {
      result.errors.push({
        error: error instanceof Error ? error.message : String(error),
      });
      return result;
    } finally {
      await this.client.close();
    }
  }

  /**
   * Find the "Agents" folder in the Craft space
   */
  private async findAgentsFolder(tools: Tool[]): Promise<string | null> {
    const toolNames = tools.map(t => t.name);
    console.log('[CraftAgentDiscovery] Looking for Agents folder using available tools');

    try {
      // Use folders_list to get all folders at root level
      if (toolNames.includes('folders_list')) {
        console.log('[CraftAgentDiscovery] Using folders_list...');
        const result = await this.client.callTool('folders_list', {});
        const content = this.extractToolContent(result);
        console.log('[CraftAgentDiscovery] Folders list:', content?.substring(0, 2000));
        if (content) {
          // Try parsing as JSON first (the actual format returned by Craft MCP)
          try {
            const parsed = JSON.parse(content);
            if (parsed.folders && Array.isArray(parsed.folders)) {
              const agentsFolder = this.findAgentsFolderRecursive(parsed.folders);
              if (agentsFolder) {
                console.log('[CraftAgentDiscovery] Found Agents folder (JSON):', agentsFolder);
                return agentsFolder;
              }
            }
          } catch {
            // Not JSON, try markdown patterns
          }

          // Fallback: Look for "Agents" folder in markdown format: [Agents](craft://folder/FOLDER_ID)
          const folderMatch = content.match(/\[Agents\]\(craft:\/\/folder\/([a-zA-Z0-9-]+)\)/i);
          if (folderMatch?.[1]) {
            console.log('[CraftAgentDiscovery] Found Agents folder (markdown):', folderMatch[1]);
            return folderMatch[1];
          }
        }
      }

      console.log('[CraftAgentDiscovery] Could not find Agents folder with available tools');
      return null;
    } catch (error) {
      console.error('[CraftAgentDiscovery] Error finding Agents folder:', error);
      debug('[CraftAgentDiscovery] Error finding Agents folder:', error);
      return null;
    }
  }

  /**
   * Recursively search for "Agents" folder in folder tree
   */
  private findAgentsFolderRecursive(folders: Array<{ id: string; name: string; folders?: unknown[] }>): string | null {
    for (const folder of folders) {
      // Case-insensitive match for "Agents"
      if (folder.name.toLowerCase() === 'agents') {
        return folder.id;
      }
      // Search nested folders
      if (folder.folders && Array.isArray(folder.folders)) {
        const nested = this.findAgentsFolderRecursive(folder.folders as Array<{ id: string; name: string; folders?: unknown[] }>);
        if (nested) return nested;
      }
    }
    return null;
  }

  /**
   * List documents in a folder
   */
  private async listFolderDocuments(
    folderId: string
  ): Promise<Array<{ id: string; title: string }>> {
    try {
      console.log('[CraftAgentDiscovery] Listing documents in folder:', folderId);

      // Use documents_list with folderId parameter
      const result = await this.client.callTool('documents_list', {
        folderId,
      });

      const content = this.extractToolContent(result);
      console.log('[CraftAgentDiscovery] Documents list response:', content?.substring(0, 2000));
      if (!content) return [];

      // Parse the folder content to extract document IDs and titles
      // Format: typically markdown list with document links
      const documents: Array<{ id: string; title: string }> = [];
      const docPattern = /\[([^\]]+)\]\(craft:\/\/document\/([a-zA-Z0-9-]+)\)/g;
      let match;
      while ((match = docPattern.exec(content)) !== null) {
        documents.push({
          title: match[1] || 'Untitled',
          id: match[2] || '',
        });
      }

      // Alternative pattern: plain list with IDs
      if (documents.length === 0) {
        const altPattern = /([a-zA-Z0-9-]+)\s*[-:]\s*(.+)/g;
        while ((match = altPattern.exec(content)) !== null) {
          // Skip folder entries
          if (match[0]?.toLowerCase().includes('folder')) continue;
          documents.push({
            id: match[1] || '',
            title: match[2]?.trim() || 'Untitled',
          });
        }
      }

      console.log('[CraftAgentDiscovery] Found', documents.length, 'documents');
      return documents;
    } catch (error) {
      console.error('[CraftAgentDiscovery] Error listing folder documents:', error);
      debug('[CraftAgentDiscovery] Error listing folder documents:', error);
      return [];
    }
  }

  /**
   * Fetch agent from a document
   */
  private async fetchAgentFromDocument(
    documentId: string,
    title: string,
    folderId: string
  ): Promise<DiscoveredAgent | null> {
    try {
      console.log('[CraftAgentDiscovery] Fetching document content:', documentId);

      // Use blocks_get with documentId to fetch the document content
      const result = await this.client.callTool('blocks_get', {
        blockId: documentId,
      });

      const content = this.extractToolContent(result);
      console.log('[CraftAgentDiscovery] Document content (first 500 chars):', content?.substring(0, 500));
      if (!content) return null;

      // Extract the document body as instructions
      // Remove the title if it's at the beginning
      let instructions = content;
      const titlePattern = new RegExp(`^#\\s*${title}\\s*\\n`, 'i');
      instructions = instructions.replace(titlePattern, '').trim();

      return {
        name: title,
        craftDocumentId: documentId,
        instructions,
        folderId,
      };
    } catch (error) {
      console.error('[CraftAgentDiscovery] Error fetching document:', documentId, error);
      debug('[CraftAgentDiscovery] Error fetching document:', documentId, error);
      return null;
    }
  }

  /**
   * Extract text content from MCP tool result
   */
  private extractToolContent(result: unknown): string | null {
    if (!result || typeof result !== 'object') return null;

    const obj = result as Record<string, unknown>;

    // Handle CallToolResult format
    if ('content' in obj && Array.isArray(obj.content)) {
      const textParts = obj.content
        .filter(
          (c): c is { type: 'text'; text: string } =>
            typeof c === 'object' && c !== null && 'type' in c && c.type === 'text'
        )
        .map((c) => c.text);
      return textParts.join('\n');
    }

    // Handle direct text result
    if ('text' in obj && typeof obj.text === 'string') {
      return obj.text;
    }

    return null;
  }
}

/**
 * Create a Craft discovery service for a workspace
 *
 * Uses the auto-created "craft" source (created from workspace MCP URL).
 * Returns null if no Craft source exists.
 */
export async function createCraftDiscoveryForWorkspace(
  workspaceSlug: string
): Promise<CraftAgentDiscovery | null> {
  // Load the auto-created "craft" source
  const sources = loadWorkspaceSources(workspaceSlug);
  const craftSource = sources.find(s => s.config.slug === 'craft' || s.config.provider === 'craft');

  if (!craftSource?.config.mcp?.url) {
    debug('[CraftAgentDiscovery] No Craft source found in workspace:', workspaceSlug);
    return null;
  }

  // Get credentials from the source
  const credManager = getCredentialManager();
  const cred = await credManager.get({
    type: 'source_oauth',
    workspaceSlug,
    sourceSlug: craftSource.config.slug,
  });

  if (!cred?.value) {
    debug('[CraftAgentDiscovery] Craft source has no credentials:', workspaceSlug);
    return null;
  }

  debug('[CraftAgentDiscovery] Using Craft source:', craftSource.config.slug);
  return new CraftAgentDiscovery({
    mcpUrl: craftSource.config.mcp.url,
    accessToken: cred.value,
  });
}
