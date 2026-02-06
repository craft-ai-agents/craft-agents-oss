/**
 * Cloud Source Storage
 *
 * Implements ISourceStorage via WebSocket mutations and REST reads.
 */

import type { ISourceStorage } from '../types.ts';
import type { FolderSourceConfig, LoadedSource, SourceGuide, CreateSourceInput } from '../../sources/types.ts';
import type { CloudConnection } from './connection.ts';

export class CloudSourceStorage implements ISourceStorage {
  constructor(
    private connection: CloudConnection,
    private workspaceId: string,
  ) {}

  async createSource(input: CreateSourceInput): Promise<FolderSourceConfig> {
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const now = Date.now();

    const config: FolderSourceConfig = {
      id: slug,
      name: input.name,
      slug,
      enabled: input.enabled ?? true,
      provider: input.provider,
      type: input.type,
      mcp: input.mcp,
      api: input.api,
      local: input.local,
      icon: input.icon,
      createdAt: now,
      updatedAt: now,
    };

    await this.connection.send({
      type: 'source:create',
      data: config as unknown as Record<string, unknown>,
    });

    return config;
  }

  async loadSource(sourceSlug: string): Promise<LoadedSource | null> {
    try {
      const data = await this.connection.fetch<{ config: FolderSourceConfig; guide: SourceGuide | null }>(`/sources/${sourceSlug}`);
      return {
        config: data.config,
        guide: data.guide,
        folderPath: '',
        workspaceRootPath: '',
        workspaceId: this.workspaceId,
      };
    } catch {
      return null;
    }
  }

  async saveSourceConfig(config: FolderSourceConfig): Promise<void> {
    await this.connection.send({
      type: 'source:saveConfig',
      data: config as unknown as Record<string, unknown>,
    });
  }

  async deleteSource(sourceSlug: string): Promise<void> {
    await this.connection.send({
      type: 'source:delete',
      data: { sourceSlug },
    });
  }

  async loadWorkspaceSources(): Promise<LoadedSource[]> {
    const configs = await this.connection.fetch<FolderSourceConfig[]>('/sources');
    return configs.map(config => ({
      config,
      guide: null,
      folderPath: '',
      workspaceRootPath: '',
      workspaceId: this.workspaceId,
    }));
  }

  async sourceExists(sourceSlug: string): Promise<boolean> {
    try {
      await this.connection.fetch(`/sources/${sourceSlug}`);
      return true;
    } catch {
      return false;
    }
  }

  async loadSourceGuide(sourceSlug: string): Promise<SourceGuide | null> {
    try {
      const data = await this.connection.fetch<{ config: FolderSourceConfig; guide: SourceGuide | null }>(`/sources/${sourceSlug}`);
      return data.guide;
    } catch {
      return null;
    }
  }

  async saveSourceGuide(sourceSlug: string, guide: SourceGuide): Promise<void> {
    await this.connection.send({
      type: 'source:saveGuide',
      data: { sourceSlug, guide: guide as unknown as Record<string, unknown> },
    });
  }
}
