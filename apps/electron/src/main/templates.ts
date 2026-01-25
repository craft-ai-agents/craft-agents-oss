// apps/electron/src/main/templates.ts

import { ipcMain } from 'electron';
import * as templateStorage from '@vesper/shared/templates';
import type { CreateTemplateOptions, SaveSessionAsTemplateOptions, SessionTemplate } from '@vesper/shared/templates';
import type { SessionManager } from './sessions';
import { loadSession as loadStoredSession } from '@vesper/shared/sessions';
import { getWorkspaceByNameOrId } from '@vesper/shared/config';
import type { StoredMessage } from '@vesper/shared/sessions';

/**
 * Extract the first user message from a session's message history
 */
function extractFirstUserMessage(messages: StoredMessage[]): string | undefined {
  const firstUserMsg = messages.find(msg => msg.role === 'user');
  if (!firstUserMsg) return undefined;

  // Extract text content from the message
  if (typeof firstUserMsg.content === 'string') {
    return firstUserMsg.content;
  }

  // Handle content blocks
  if (Array.isArray(firstUserMsg.content)) {
    const textBlock = firstUserMsg.content.find(block => block.type === 'text');
    return textBlock?.text;
  }

  return undefined;
}

/**
 * Register template IPC handlers
 */
export function registerTemplateIpcHandlers(sessionManager: SessionManager) {
  // List templates
  ipcMain.handle('template:list', async (_, scope: 'global' | 'workspace' | 'all', workspaceId?: string) => {
    return templateStorage.listTemplates(scope, workspaceId);
  });

  // Create template
  ipcMain.handle('template:create', async (_, options: CreateTemplateOptions) => {
    return templateStorage.createTemplate(options);
  });

  // Get template
  ipcMain.handle('template:get', async (_, id: string, scope: 'global' | 'workspace', workspaceId?: string) => {
    return templateStorage.getTemplate(id, scope, workspaceId);
  });

  // Update template
  ipcMain.handle(
    'template:update',
    async (_, id: string, scope: 'global' | 'workspace', workspaceId: string | undefined, updates: Partial<SessionTemplate>) => {
      return templateStorage.updateTemplate(id, scope, workspaceId, updates);
    }
  );

  // Delete template
  ipcMain.handle('template:delete', async (_, id: string, scope: 'global' | 'workspace', workspaceId?: string) => {
    return templateStorage.deleteTemplate(id, scope, workspaceId);
  });

  // Save session as template
  ipcMain.handle('template:save-from-session', async (_, options: SaveSessionAsTemplateOptions) => {
    // Get live session data
    const session = await sessionManager.getSession(options.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Get workspace to load stored session
    const workspace = getWorkspaceByNameOrId(session.workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    // Load stored session from disk to get messages
    const storedSession = loadStoredSession(workspace.rootPath, options.sessionId);
    if (!storedSession) {
      throw new Error('Session not found in storage');
    }

    return templateStorage.createTemplate({
      name: options.name,
      description: options.description,
      scope: options.scope,
      workspaceId: session.workspaceId,
      initialPrompt: options.includeInitialPrompt
        ? extractFirstUserMessage(storedSession.messages)
        : undefined,
      skillIds: session.skills?.map(s => s.id),
      permissionMode: session.permissionMode,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      workingDirectory: session.workingDirectory,
    });
  });

  // Use template (increments usage count)
  ipcMain.handle('template:use', async (_, templateId: string, scope: 'global' | 'workspace', workspaceId?: string) => {
    await templateStorage.incrementUsageCount(templateId, scope, workspaceId);
    return templateStorage.getTemplate(templateId, scope, workspaceId);
  });
}
