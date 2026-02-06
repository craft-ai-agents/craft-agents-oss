/**
 * Cloud Status Storage
 *
 * Implements IStatusStorage via WebSocket mutations and REST reads.
 */

import type { IStatusStorage } from '../types.ts';
import type { WorkspaceStatusConfig, StatusConfig } from '../../statuses/types.ts';
import type { CloudConnection } from './connection.ts';
import { getDefaultStatusConfig } from '../../statuses/storage.ts';

export class CloudStatusStorage implements IStatusStorage {
  constructor(private connection: CloudConnection) {}

  async loadStatusConfig(): Promise<WorkspaceStatusConfig> {
    try {
      const config = await this.connection.fetch<WorkspaceStatusConfig>('/statuses');
      // Return default config if the remote returns an empty/minimal response
      if (!config.statuses || config.statuses.length === 0) {
        return getDefaultStatusConfig();
      }
      return config;
    } catch {
      return getDefaultStatusConfig();
    }
  }

  async saveStatusConfig(config: WorkspaceStatusConfig): Promise<void> {
    await this.connection.send({
      type: 'statuses:save',
      data: config as unknown as Record<string, unknown>,
    });
  }

  async getStatus(statusId: string): Promise<StatusConfig | null> {
    const config = await this.loadStatusConfig();
    return config.statuses.find(s => s.id === statusId) ?? null;
  }

  async listStatuses(): Promise<StatusConfig[]> {
    const config = await this.loadStatusConfig();
    return config.statuses;
  }
}
