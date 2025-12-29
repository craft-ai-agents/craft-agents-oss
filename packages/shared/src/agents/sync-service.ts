/**
 * Agent Sync Service
 *
 * Synchronizes agents from Craft Space to local filesystem.
 * Creates and updates local agents from discovered Craft documents.
 */

import { createCraftDiscoveryForWorkspace, type DiscoveredAgent } from './craft-discovery.ts';
import {
  createAgent,
  loadAgent,
  loadWorkspaceAgents,
  saveAgentConfig,
  saveAgentInstructions,
} from './folder-storage.ts';
import type { FolderAgentConfig, LoadedAgent, AgentSourceRef } from './folder-types.ts';
import { debug } from '../utils/debug.ts';

/**
 * Sync result for a single agent
 */
export interface AgentSyncStatus {
  slug: string;
  name: string;
  action: 'created' | 'updated' | 'unchanged' | 'error';
  error?: string;
  craftDocumentId?: string;
}

/**
 * Overall sync result
 */
export interface SyncResult {
  /** Agents that were created */
  created: AgentSyncStatus[];
  /** Agents that were updated */
  updated: AgentSyncStatus[];
  /** Agents that didn't need changes */
  unchanged: AgentSyncStatus[];
  /** Agents that failed to sync */
  errors: AgentSyncStatus[];
  /** Whether an Agents folder was found in Craft */
  folderFound: boolean;
  /** Total agents discovered */
  discoveredCount: number;
}

/**
 * Sync options
 */
export interface SyncOptions {
  /** Only sync specific document IDs (if empty, sync all) */
  documentIds?: string[];
  /** Force update even if unchanged */
  forceUpdate?: boolean;
}

/**
 * Agent Sync Service
 *
 * Manages synchronization between Craft Space agents and local filesystem.
 */
export class AgentSyncService {
  private workspaceSlug: string;

  constructor(workspaceSlug: string) {
    this.workspaceSlug = workspaceSlug;
  }

  /**
   * Sync agents from Craft to local filesystem
   */
  async syncFromCraft(options: SyncOptions = {}): Promise<SyncResult> {
    const result: SyncResult = {
      created: [],
      updated: [],
      unchanged: [],
      errors: [],
      folderFound: false,
      discoveredCount: 0,
    };

    try {
      // Create discovery service using the workspace's Craft source
      const discovery = await createCraftDiscoveryForWorkspace(this.workspaceSlug);
      if (!discovery) {
        debug('[AgentSyncService] No Craft discovery service available');
        return result;
      }

      // Discover agents from Craft
      const discoveryResult = await discovery.discoverAgents();
      result.folderFound = discoveryResult.folderFound;
      result.discoveredCount = discoveryResult.agents.length;

      if (!discoveryResult.folderFound) {
        debug('[AgentSyncService] No Agents folder found in Craft');
        return result;
      }

      // Filter by document IDs if specified
      let agentsToSync = discoveryResult.agents;
      if (options.documentIds && options.documentIds.length > 0) {
        agentsToSync = agentsToSync.filter((a) =>
          options.documentIds!.includes(a.craftDocumentId)
        );
      }

      // Build map of existing Craft-sourced agents
      const existingAgents = this.getExistingCraftAgents();

      // Process each discovered agent
      for (const discovered of agentsToSync) {
        const status = await this.syncAgent(discovered, existingAgents, options.forceUpdate);
        switch (status.action) {
          case 'created':
            result.created.push(status);
            break;
          case 'updated':
            result.updated.push(status);
            break;
          case 'unchanged':
            result.unchanged.push(status);
            break;
          case 'error':
            result.errors.push(status);
            break;
        }
      }

      // Add discovery errors
      for (const error of discoveryResult.errors) {
        result.errors.push({
          slug: 'unknown',
          name: 'Unknown',
          action: 'error',
          error: error.error,
          craftDocumentId: error.documentId,
        });
      }

      debug(
        '[AgentSyncService] Sync complete:',
        result.created.length,
        'created,',
        result.updated.length,
        'updated,',
        result.unchanged.length,
        'unchanged,',
        result.errors.length,
        'errors'
      );

      return result;
    } catch (error) {
      debug('[AgentSyncService] Sync failed:', error);
      result.errors.push({
        slug: 'sync',
        name: 'Sync',
        action: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      return result;
    }
  }

  /**
   * Sync a single agent from Craft
   */
  private async syncAgent(
    discovered: DiscoveredAgent,
    existingAgents: Map<string, LoadedAgent>,
    forceUpdate = false
  ): Promise<AgentSyncStatus> {
    try {
      // Check if we already have an agent from this Craft document
      const existingAgent = existingAgents.get(discovered.craftDocumentId);

      if (existingAgent) {
        // Check if update is needed
        const needsUpdate = forceUpdate || this.needsSync(existingAgent, discovered);

        if (needsUpdate) {
          await this.updateAgent(existingAgent, discovered);
          return {
            slug: existingAgent.config.slug,
            name: discovered.name,
            action: 'updated',
            craftDocumentId: discovered.craftDocumentId,
          };
        } else {
          return {
            slug: existingAgent.config.slug,
            name: discovered.name,
            action: 'unchanged',
            craftDocumentId: discovered.craftDocumentId,
          };
        }
      } else {
        // Create new agent
        const config = await this.createAgentFromCraft(discovered);
        return {
          slug: config.slug,
          name: discovered.name,
          action: 'created',
          craftDocumentId: discovered.craftDocumentId,
        };
      }
    } catch (error) {
      return {
        slug: 'unknown',
        name: discovered.name,
        action: 'error',
        error: error instanceof Error ? error.message : String(error),
        craftDocumentId: discovered.craftDocumentId,
      };
    }
  }

  /**
   * Get map of existing agents sourced from Craft (keyed by document ID)
   */
  private getExistingCraftAgents(): Map<string, LoadedAgent> {
    const map = new Map<string, LoadedAgent>();
    const agents = loadWorkspaceAgents(this.workspaceSlug);

    for (const agent of agents) {
      if (agent.config.source?.type === 'craft' && agent.config.source.documentId) {
        map.set(agent.config.source.documentId, agent);
      }
    }

    return map;
  }

  /**
   * Check if agent needs sync
   */
  needsSync(local: LoadedAgent, craft: DiscoveredAgent): boolean {
    // If instructions have changed
    if (local.instructions !== craft.instructions) {
      return true;
    }

    // If name has changed
    if (local.config.name !== craft.name) {
      return true;
    }

    // If last modified is newer (when available)
    if (craft.lastModified && local.config.source?.lastSynced) {
      if (craft.lastModified > local.config.source.lastSynced) {
        return true;
      }
    }

    return false;
  }

  /**
   * Create a new local agent from Craft document
   */
  private async createAgentFromCraft(discovered: DiscoveredAgent): Promise<FolderAgentConfig> {
    const sourceRef: AgentSourceRef = {
      type: 'craft',
      documentId: discovered.craftDocumentId,
      lastSynced: Date.now(),
    };

    const config = createAgent(this.workspaceSlug, {
      name: discovered.name,
      instructions: discovered.instructions,
      source: sourceRef,
      enabled: true,
    });

    debug('[AgentSyncService] Created agent:', config.slug, 'from Craft document:', discovered.craftDocumentId);
    return config;
  }

  /**
   * Update an existing agent from Craft document
   */
  private async updateAgent(existing: LoadedAgent, discovered: DiscoveredAgent): Promise<void> {
    // Update instructions
    saveAgentInstructions(this.workspaceSlug, existing.config.slug, discovered.instructions);

    // Update config
    const updatedConfig: FolderAgentConfig = {
      ...existing.config,
      name: discovered.name,
      source: {
        ...existing.config.source,
        type: 'craft',
        documentId: discovered.craftDocumentId,
        lastSynced: Date.now(),
      },
      updatedAt: Date.now(),
    };

    saveAgentConfig(this.workspaceSlug, updatedConfig);
    debug('[AgentSyncService] Updated agent:', existing.config.slug);
  }

  /**
   * Get sync status for a specific agent
   */
  getAgentSyncStatus(agentSlug: string): 'synced' | 'modified' | 'local-only' | 'not-found' {
    const agent = loadAgent(this.workspaceSlug, agentSlug);
    if (!agent) {
      return 'not-found';
    }

    if (!agent.config.source || agent.config.source.type !== 'craft') {
      return 'local-only';
    }

    // We'd need to compare with Craft to know if modified
    // For now, if it has a Craft source and lastSynced, consider it synced
    if (agent.config.source.lastSynced) {
      // Check if local modifications since last sync
      if (agent.config.updatedAt > agent.config.source.lastSynced) {
        return 'modified';
      }
      return 'synced';
    }

    return 'local-only';
  }

  /**
   * Get all agents with their sync status
   */
  getAgentsSyncStatus(): Array<{
    slug: string;
    name: string;
    status: 'synced' | 'modified' | 'local-only' | 'not-found';
  }> {
    const agents = loadWorkspaceAgents(this.workspaceSlug);
    return agents.map((agent) => ({
      slug: agent.config.slug,
      name: agent.config.name,
      status: this.getAgentSyncStatus(agent.config.slug),
    }));
  }
}

/**
 * Create a sync service for a workspace
 */
export function createAgentSyncService(workspaceSlug: string): AgentSyncService {
  return new AgentSyncService(workspaceSlug);
}
