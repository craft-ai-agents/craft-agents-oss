/**
 * Local Status Storage
 *
 * Delegates to existing status storage functions from statuses/storage.ts
 */

import type { IStatusStorage } from '../types.ts';
import type { WorkspaceStatusConfig, StatusConfig } from '../../statuses/types.ts';

import {
  loadStatusConfig as fsLoadStatusConfig,
  saveStatusConfig as fsSaveStatusConfig,
  getStatus as fsGetStatus,
  listStatuses as fsListStatuses,
} from '../../statuses/storage.ts';

export class LocalStatusStorage implements IStatusStorage {
  constructor(private rootPath: string) {}

  async loadStatusConfig(): Promise<WorkspaceStatusConfig> {
    return fsLoadStatusConfig(this.rootPath);
  }

  async saveStatusConfig(config: WorkspaceStatusConfig): Promise<void> {
    fsSaveStatusConfig(this.rootPath, config);
  }

  async getStatus(statusId: string): Promise<StatusConfig | null> {
    return fsGetStatus(this.rootPath, statusId);
  }

  async listStatuses(): Promise<StatusConfig[]> {
    return fsListStatuses(this.rootPath);
  }
}
