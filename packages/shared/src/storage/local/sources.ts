/**
 * Local Source Storage
 *
 * Delegates to existing source storage functions from sources/storage.ts
 */

import type { ISourceStorage } from '../types.ts';
import type { FolderSourceConfig, LoadedSource, SourceGuide, CreateSourceInput } from '../../sources/types.ts';

import {
  createSource as fsCreateSource,
  loadSource as fsLoadSource,
  saveSourceConfig as fsSaveSourceConfig,
  deleteSource as fsDeleteSource,
  loadWorkspaceSources as fsLoadWorkspaceSources,
  sourceExists as fsSourceExists,
  loadSourceGuide as fsLoadSourceGuide,
  saveSourceGuide as fsSaveSourceGuide,
} from '../../sources/storage.ts';

export class LocalSourceStorage implements ISourceStorage {
  constructor(private rootPath: string, private workspaceId: string) {}

  async createSource(input: CreateSourceInput): Promise<FolderSourceConfig> {
    return fsCreateSource(this.rootPath, input);
  }

  async loadSource(sourceSlug: string): Promise<LoadedSource | null> {
    return fsLoadSource(this.rootPath, sourceSlug);
  }

  async saveSourceConfig(config: FolderSourceConfig): Promise<void> {
    fsSaveSourceConfig(this.rootPath, config);
  }

  async deleteSource(sourceSlug: string): Promise<void> {
    fsDeleteSource(this.rootPath, sourceSlug);
  }

  async loadWorkspaceSources(): Promise<LoadedSource[]> {
    return fsLoadWorkspaceSources(this.rootPath);
  }

  async sourceExists(sourceSlug: string): Promise<boolean> {
    return fsSourceExists(this.rootPath, sourceSlug);
  }

  async loadSourceGuide(sourceSlug: string): Promise<SourceGuide | null> {
    return fsLoadSourceGuide(this.rootPath, sourceSlug);
  }

  async saveSourceGuide(sourceSlug: string, guide: SourceGuide): Promise<void> {
    fsSaveSourceGuide(this.rootPath, sourceSlug, guide);
  }
}
