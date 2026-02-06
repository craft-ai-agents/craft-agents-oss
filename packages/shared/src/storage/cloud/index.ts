/**
 * Cloud Storage Provider
 *
 * Implements IStorageProvider via WebSocket (mutations + real-time) and
 * REST (bulk reads) to a Cloudflare Worker + Durable Object backend.
 */

import type {
  IStorageProvider,
  ISessionStorage,
  ISourceStorage,
  IStatusStorage,
  ILabelStorage,
  ISkillStorage,
  IFileStorage,
  IAssetStorage,
  RemoteChangeEvent,
} from '../types.ts';
import type { CloudConnectionState } from '@craft-agent/core/types/cloud';

import { CloudConnection } from './connection.ts';
import { CloudSessionStorage } from './sessions.ts';
import { CloudSourceStorage } from './sources.ts';
import { CloudStatusStorage } from './statuses.ts';
import { CloudLabelStorage } from './labels.ts';
import { CloudSkillStorage } from './skills.ts';
import { CloudFileStorage } from './files.ts';
import { CloudAssetStorage } from './assets.ts';

export interface CloudStorageProviderConfig {
  remoteUrl: string;
  workspaceSlug: string;
  apiKey: string;
}

export class CloudStorageProvider implements IStorageProvider {
  readonly type = 'cloud' as const;
  readonly workspaceId: string;

  sessions: ISessionStorage;
  sources: ISourceStorage;
  statuses: IStatusStorage;
  labels: ILabelStorage;
  skills: ISkillStorage;
  files: IFileStorage;
  assets: IAssetStorage;

  private connection: CloudConnection;

  constructor(config: CloudStorageProviderConfig) {
    this.workspaceId = config.workspaceSlug;
    this.connection = new CloudConnection(config.remoteUrl, config.workspaceSlug, config.apiKey);

    this.sessions = new CloudSessionStorage(this.connection);
    this.sources = new CloudSourceStorage(this.connection, config.workspaceSlug);
    this.statuses = new CloudStatusStorage(this.connection);
    this.labels = new CloudLabelStorage(this.connection);
    this.skills = new CloudSkillStorage(this.connection);
    this.files = new CloudFileStorage(config.remoteUrl, config.workspaceSlug, config.apiKey);
    this.assets = new CloudAssetStorage(config.remoteUrl, config.workspaceSlug, config.apiKey);
  }

  async initialize(): Promise<void> {
    await this.connection.connect();
  }

  async dispose(): Promise<void> {
    this.connection.disconnect();
  }

  onRemoteChange(callback: (event: RemoteChangeEvent) => void): () => void {
    // Map WSRemoteChangeEvent → RemoteChangeEvent (structurally compatible)
    return this.connection.onRemoteChange((wsEvent) => {
      callback(wsEvent as unknown as RemoteChangeEvent);
    });
  }

  /** Get the current connection state */
  get connectionState(): CloudConnectionState {
    return this.connection.state;
  }

  /** Register a listener for connection state changes */
  onConnectionStateChange(callback: (state: CloudConnectionState) => void): () => void {
    return this.connection.onStateChange(callback);
  }
}
