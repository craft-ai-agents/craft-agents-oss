/**
 * Local Filesystem Storage Provider
 *
 * Wraps existing filesystem storage functions into the IStorageProvider interface.
 * This is a thin adapter — all behavior is delegated to the existing functions
 * in sessions/storage.ts, sources/storage.ts, statuses/storage.ts, etc.
 */

import type {
  IStorageProvider,
  ISessionStorage,
  ISourceStorage,
  IStatusStorage,
  ILabelStorage,
  ISkillStorage,
  IFileStorage,
  RemoteChangeEvent,
} from '../types.ts';

import { LocalSessionStorage } from './sessions.ts';
import { LocalSourceStorage } from './sources.ts';
import { LocalStatusStorage } from './statuses.ts';
import { LocalLabelStorage } from './labels.ts';
import { LocalSkillStorage } from './skills.ts';
import { LocalFileStorage } from './files.ts';

export class LocalStorageProvider implements IStorageProvider {
  readonly type = 'local' as const;
  readonly workspaceId: string;

  sessions: ISessionStorage;
  sources: ISourceStorage;
  statuses: IStatusStorage;
  labels: ILabelStorage;
  skills: ISkillStorage;
  files: IFileStorage;

  constructor(workspaceId: string, private rootPath: string) {
    this.workspaceId = workspaceId;
    this.sessions = new LocalSessionStorage(rootPath);
    this.sources = new LocalSourceStorage(rootPath, workspaceId);
    this.statuses = new LocalStatusStorage(rootPath);
    this.labels = new LocalLabelStorage(rootPath);
    this.skills = new LocalSkillStorage(rootPath);
    this.files = new LocalFileStorage(rootPath);
  }

  async initialize(): Promise<void> {
    // Directories are created lazily by the existing storage functions
  }

  async dispose(): Promise<void> {
    // Persistence queue flushes are handled by the existing session save logic
  }

  onRemoteChange(_callback: (event: RemoteChangeEvent) => void): () => void {
    // No-op for local storage — there are no remote changes
    return () => {};
  }
}
