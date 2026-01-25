// packages/shared/src/templates/storage.ts

import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { SessionTemplate, CreateTemplateOptions } from './types';

const VESPER_DIR = join(homedir(), '.vesper');

export function getTemplatesDir(scope: 'global' | 'workspace', workspaceId?: string): string {
  if (scope === 'global') {
    return join(VESPER_DIR, 'templates');
  }
  if (!workspaceId) throw new Error('workspaceId required for workspace scope');
  return join(VESPER_DIR, 'workspaces', workspaceId, 'templates');
}

async function loadTemplatesFromDir(dir: string, scope: 'global' | 'workspace'): Promise<SessionTemplate[]> {
  try {
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    const templates: SessionTemplate[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const template = JSON.parse(content) as SessionTemplate;
          templates.push(template);
        } catch (error) {
          console.error(`Failed to load template ${file}:`, error);
        }
      }
    }

    return templates;
  } catch (error) {
    console.error(`Failed to load templates from ${dir}:`, error);
    return [];
  }
}

export async function listTemplates(
  scope: 'global' | 'workspace' | 'all',
  workspaceId?: string
): Promise<SessionTemplate[]> {
  const templates: SessionTemplate[] = [];

  if (scope === 'global' || scope === 'all') {
    const globalDir = getTemplatesDir('global');
    templates.push(...await loadTemplatesFromDir(globalDir, 'global'));
  }

  if ((scope === 'workspace' || scope === 'all') && workspaceId) {
    const workspaceDir = getTemplatesDir('workspace', workspaceId);
    templates.push(...await loadTemplatesFromDir(workspaceDir, 'workspace'));
  }

  return templates.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
}

export async function createTemplate(options: CreateTemplateOptions): Promise<SessionTemplate> {
  const template: SessionTemplate = {
    id: uuidv4(),
    ...options,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
  };

  const dir = getTemplatesDir(options.scope, options.workspaceId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${template.id}.json`), JSON.stringify(template, null, 2));

  return template;
}

export async function getTemplate(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId?: string
): Promise<SessionTemplate | null> {
  try {
    const dir = getTemplatesDir(scope, workspaceId);
    const content = await readFile(join(dir, `${id}.json`), 'utf-8');
    return JSON.parse(content) as SessionTemplate;
  } catch (error) {
    return null;
  }
}

export async function updateTemplate(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId: string | undefined,
  updates: Partial<SessionTemplate>
): Promise<SessionTemplate | null> {
  const template = await getTemplate(id, scope, workspaceId);
  if (!template) return null;

  const updated: SessionTemplate = {
    ...template,
    ...updates,
    id: template.id, // Preserve ID
    createdAt: template.createdAt, // Preserve creation date
    updatedAt: new Date().toISOString(),
  };

  const dir = getTemplatesDir(scope, workspaceId);
  await writeFile(join(dir, `${id}.json`), JSON.stringify(updated, null, 2));

  return updated;
}

export async function deleteTemplate(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId?: string
): Promise<void> {
  const dir = getTemplatesDir(scope, workspaceId);
  await unlink(join(dir, `${id}.json`));
}

export async function incrementUsageCount(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId?: string
): Promise<void> {
  const template = await getTemplate(id, scope, workspaceId);
  if (template) {
    template.usageCount = (template.usageCount || 0) + 1;
    template.updatedAt = new Date().toISOString();
    const dir = getTemplatesDir(scope, workspaceId);
    await writeFile(join(dir, `${id}.json`), JSON.stringify(template, null, 2));
  }
}
