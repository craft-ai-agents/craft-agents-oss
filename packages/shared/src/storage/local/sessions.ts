/**
 * Local Session Storage
 *
 * Delegates to existing session storage functions from sessions/storage.ts
 */

import type { ISessionStorage } from '../types.ts';
import type { SessionConfig, StoredSession, SessionMetadata } from '../../sessions/types.ts';
import type { Plan } from '../../agent/plan-types.ts';

import {
  createSession as fsCreateSession,
  loadSession as fsLoadSession,
  saveSession as fsSaveSession,
  deleteSession as fsDeleteSession,
  listSessions as fsListSessions,
  clearSessionMessages as fsClearSessionMessages,
  updateSessionMetadata as fsUpdateSessionMetadata,
  updateSessionSdkId as fsUpdateSessionSdkId,
  savePlanToFile as fsSavePlanToFile,
  loadPlanFromFile as fsLoadPlanFromFile,
  listPlanFiles as fsListPlanFiles,
  deletePlanFile as fsDeletePlanFile,
} from '../../sessions/storage.ts';

export class LocalSessionStorage implements ISessionStorage {
  constructor(private rootPath: string) {}

  async createSession(options?: {
    name?: string;
    workingDirectory?: string;
    permissionMode?: SessionConfig['permissionMode'];
    enabledSourceSlugs?: string[];
    model?: string;
    hidden?: boolean;
  }): Promise<SessionConfig> {
    return fsCreateSession(this.rootPath, options);
  }

  async loadSession(sessionId: string): Promise<StoredSession | null> {
    return fsLoadSession(this.rootPath, sessionId);
  }

  async saveSession(session: StoredSession): Promise<void> {
    return fsSaveSession(session);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return fsDeleteSession(this.rootPath, sessionId);
  }

  async listSessions(): Promise<SessionMetadata[]> {
    return fsListSessions(this.rootPath);
  }

  async clearSessionMessages(sessionId: string): Promise<void> {
    return fsClearSessionMessages(this.rootPath, sessionId);
  }

  async updateSessionMetadata(
    sessionId: string,
    updates: Partial<Pick<SessionConfig,
      | 'isFlagged'
      | 'name'
      | 'todoState'
      | 'labels'
      | 'lastReadMessageId'
      | 'hasUnread'
      | 'enabledSourceSlugs'
      | 'workingDirectory'
      | 'permissionMode'
      | 'sharedUrl'
      | 'sharedId'
      | 'model'
    >>
  ): Promise<void> {
    return fsUpdateSessionMetadata(this.rootPath, sessionId, updates);
  }

  async updateSessionSdkId(sessionId: string, sdkSessionId: string): Promise<void> {
    return fsUpdateSessionSdkId(this.rootPath, sessionId, sdkSessionId);
  }

  async savePlan(sessionId: string, plan: Plan, fileName?: string): Promise<string> {
    return fsSavePlanToFile(this.rootPath, sessionId, plan, fileName);
  }

  async loadPlan(sessionId: string, fileName: string): Promise<Plan | null> {
    return fsLoadPlanFromFile(this.rootPath, sessionId, fileName);
  }

  async listPlans(sessionId: string): Promise<Array<{ name: string; path: string; modifiedAt: number }>> {
    return fsListPlanFiles(this.rootPath, sessionId);
  }

  async deletePlan(sessionId: string, fileName: string): Promise<boolean> {
    return fsDeletePlanFile(this.rootPath, sessionId, fileName);
  }
}
