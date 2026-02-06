/**
 * Cloud Session Storage
 *
 * Implements ISessionStorage via WebSocket mutations and REST reads.
 */

import type { ISessionStorage } from '../types.ts';
import type { SessionConfig, StoredSession, SessionMetadata } from '../../sessions/types.ts';
import type { Plan } from '../../agent/plan-types.ts';
import type { CloudConnection } from './connection.ts';
import { formatPlanAsMarkdown, parsePlanFromMarkdown } from '../../sessions/storage.ts';

export class CloudSessionStorage implements ISessionStorage {
  constructor(private connection: CloudConnection) {}

  async createSession(options?: {
    name?: string;
    workingDirectory?: string;
    permissionMode?: SessionConfig['permissionMode'];
    enabledSourceSlugs?: string[];
    model?: string;
    hidden?: boolean;
  }): Promise<SessionConfig> {
    // Generate a session ID client-side (same format as local)
    const id = `${new Date().toISOString().slice(2, 8).replace(/-/g, '')}-cloud-${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();

    const config: SessionConfig = {
      id,
      workspaceRootPath: '', // Not applicable for cloud sessions
      createdAt: now,
      lastUsedAt: now,
      ...options,
    };

    await this.connection.send({
      type: 'session:create',
      data: config as unknown as Record<string, unknown>,
    });

    return config;
  }

  async loadSession(sessionId: string): Promise<StoredSession | null> {
    try {
      return await this.connection.fetch<StoredSession>(`/sessions/${sessionId}`);
    } catch {
      return null;
    }
  }

  async saveSession(session: StoredSession): Promise<void> {
    // Split into header (metadata) and messages for efficient storage
    const { messages, ...header } = session;
    await this.connection.send({
      type: 'session:save',
      data: { id: session.id, header, messages },
    });
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.connection.send({
      type: 'session:delete',
      data: { sessionId },
    });
    return true;
  }

  async listSessions(): Promise<SessionMetadata[]> {
    return this.connection.fetch<SessionMetadata[]>('/sessions');
  }

  async clearSessionMessages(sessionId: string): Promise<void> {
    await this.connection.send({
      type: 'session:clearMessages',
      data: { sessionId },
    });
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
      | 'isRemoteSandbox'
    >>
  ): Promise<void> {
    await this.connection.send({
      type: 'session:updateMeta',
      data: { sessionId, updates },
    });
  }

  async updateSessionSdkId(sessionId: string, sdkSessionId: string): Promise<void> {
    await this.connection.send({
      type: 'session:updateSdkId',
      data: { sessionId, sdkSessionId },
    });
  }

  async savePlan(sessionId: string, plan: Plan, fileName?: string): Promise<string> {
    const name = fileName ?? `${new Date().toISOString().slice(0, 10)}-${plan.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.md`;
    const content = formatPlanAsMarkdown(plan);

    await this.connection.send({
      type: 'plan:save',
      data: { sessionId, fileName: name, content },
    });

    return name;
  }

  async loadPlan(sessionId: string, fileName: string): Promise<Plan | null> {
    try {
      const content = await this.connection.fetch<string>(`/sessions/${sessionId}/plans/${fileName}`);
      return parsePlanFromMarkdown(content, fileName);
    } catch {
      return null;
    }
  }

  async listPlans(sessionId: string): Promise<Array<{ name: string; path: string; modifiedAt: number }>> {
    const plans = await this.connection.fetch<Array<{ name: string; modifiedAt: number }>>(`/sessions/${sessionId}/plans`);
    return plans.map(p => ({ ...p, path: '' })); // path not meaningful for cloud
  }

  async deletePlan(sessionId: string, fileName: string): Promise<boolean> {
    await this.connection.send({
      type: 'plan:delete',
      data: { sessionId, fileName },
    });
    return true;
  }
}
