// packages/shared/src/templates/storage.ts

import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import lockfile from 'proper-lockfile';
import type { SessionTemplate, CreateTemplateOptions } from './types';

const VESPER_DIR = join(homedir(), '.vesper');

/**
 * Custom error class for template operations
 */
export class TemplateError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'INVALID_INPUT' | 'IO_ERROR' | 'CORRUPT_DATA',
    public details?: unknown
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

/**
 * Validate scope and workspaceId consistency
 */
export function validateScopeConsistency(scope: 'global' | 'workspace', workspaceId?: string): void {
  if (scope === 'workspace' && !workspaceId) {
    throw new TemplateError('Workspace ID required for workspace-scoped template', 'INVALID_INPUT');
  }
  if (scope === 'global' && workspaceId) {
    throw new TemplateError('Global-scoped template should not have a workspaceId', 'INVALID_INPUT');
  }
}

/**
 * Validate template creation options
 */
function validateTemplateOptions(options: CreateTemplateOptions): void {
  if (!options.name || options.name.trim().length === 0) {
    throw new TemplateError('Template name is required', 'INVALID_INPUT');
  }
  if (options.name.length > 100) {
    throw new TemplateError('Template name too long (max 100 chars)', 'INVALID_INPUT');
  }
  validateScopeConsistency(options.scope, options.workspaceId);
}

export function getTemplatesDir(scope: 'global' | 'workspace', workspaceId?: string): string {
  if (scope === 'global') {
    return join(VESPER_DIR, 'templates');
  }
  if (!workspaceId) throw new Error('workspaceId required for workspace scope');
  return join(VESPER_DIR, 'workspaces', workspaceId, 'templates');
}

/**
 * Load templates from directory with error reporting
 */
async function loadTemplatesFromDir(
  dir: string,
  scope: 'global' | 'workspace'
): Promise<{ templates: SessionTemplate[]; errors: TemplateError[] }> {
  const templates: SessionTemplate[] = [];
  const errors: TemplateError[] = [];

  try {
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);

    for (const file of files) {
      if (file.endsWith('.json') && !file.startsWith('.')) {
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const template = JSON.parse(content) as SessionTemplate;

          // Validate template structure
          if (!template.id || !template.name || !template.scope) {
            throw new Error('Invalid template structure: missing required fields');
          }

          templates.push(template);
        } catch (error) {
          errors.push(
            new TemplateError(
              `Failed to load template ${file}`,
              'CORRUPT_DATA',
              { file, error }
            )
          );
        }
      }
    }
  } catch (error) {
    errors.push(
      new TemplateError(
        `Failed to read templates directory`,
        'IO_ERROR',
        { dir, error }
      )
    );
  }

  return { templates, errors };
}

export async function listTemplates(
  scope: 'global' | 'workspace' | 'all',
  workspaceId?: string
): Promise<SessionTemplate[]> {
  const templates: SessionTemplate[] = [];

  if (scope === 'global' || scope === 'all') {
    const globalDir = getTemplatesDir('global');
    const { templates: globalTemplates, errors: globalErrors } = await loadTemplatesFromDir(globalDir, 'global');
    templates.push(...globalTemplates);

    // Log errors but don't fail the entire operation
    globalErrors.forEach(error => {
      console.error(`[Templates] ${error.message}`, error.details);
    });
  }

  if ((scope === 'workspace' || scope === 'all') && workspaceId) {
    const workspaceDir = getTemplatesDir('workspace', workspaceId);
    const { templates: workspaceTemplates, errors: workspaceErrors } = await loadTemplatesFromDir(workspaceDir, 'workspace');
    templates.push(...workspaceTemplates);

    // Log errors but don't fail the entire operation
    workspaceErrors.forEach(error => {
      console.error(`[Templates] ${error.message}`, error.details);
    });
  }

  return templates.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
}

export async function createTemplate(options: CreateTemplateOptions): Promise<SessionTemplate> {
  validateTemplateOptions(options);

  const template: SessionTemplate = {
    id: uuidv4(),
    ...options,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
  };

  try {
    const dir = getTemplatesDir(options.scope, options.workspaceId);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, `${template.id}.json`);

    // Check if file already exists (shouldn't happen with UUID, but be safe)
    if (existsSync(filePath)) {
      throw new TemplateError('Template already exists', 'INVALID_INPUT');
    }

    await writeFile(filePath, JSON.stringify(template, null, 2));
    return template;
  } catch (error) {
    if (error instanceof TemplateError) throw error;

    throw new TemplateError(
      'Failed to create template',
      'IO_ERROR',
      { originalError: error }
    );
  }
}

export async function getTemplate(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId?: string
): Promise<SessionTemplate | null> {
  try {
    const dir = getTemplatesDir(scope, workspaceId);
    const content = await readFile(join(dir, `${id}.json`), 'utf-8');
    const template = JSON.parse(content) as SessionTemplate;

    // Validate template structure
    if (!template.id || !template.name || !template.scope) {
      throw new TemplateError('Invalid template structure', 'CORRUPT_DATA', { id });
    }

    return template;
  } catch (error) {
    // Return null for not found, but log corruption errors
    if (error instanceof TemplateError) {
      console.error(`[Templates] ${error.message}`, error.details);
    }
    return null;
  }
}

export async function updateTemplate(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId: string | undefined,
  updates: Partial<SessionTemplate>
): Promise<SessionTemplate | null> {
  // Validate scope consistency in updates
  if (updates.scope) {
    validateScopeConsistency(updates.scope, updates.workspaceId ?? workspaceId);
  }

  const dir = getTemplatesDir(scope, workspaceId);
  const filePath = join(dir, `${id}.json`);

  // Use file locking to prevent race conditions
  let release: (() => Promise<void>) | null = null;
  try {
    // Acquire lock with retry
    release = await lockfile.lock(filePath, {
      stale: 5000,
      retries: { retries: 5, minTimeout: 50 }
    });

    const template = await getTemplate(id, scope, workspaceId);
    if (!template) {
      return null;
    }

    const updated: SessionTemplate = {
      ...template,
      ...updates,
      id: template.id, // Preserve ID
      createdAt: template.createdAt, // Preserve creation date
      updatedAt: new Date().toISOString(),
    };

    await writeFile(filePath, JSON.stringify(updated, null, 2));
    return updated;
  } catch (error) {
    throw new TemplateError(
      'Failed to update template',
      'IO_ERROR',
      { id, scope, originalError: error }
    );
  } finally {
    if (release) {
      await release();
    }
  }
}

export async function deleteTemplate(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId?: string
): Promise<void> {
  const dir = getTemplatesDir(scope, workspaceId);
  const filePath = join(dir, `${id}.json`);

  try {
    // Check if template exists first
    if (!existsSync(filePath)) {
      throw new TemplateError('Template not found', 'NOT_FOUND', { id, scope });
    }

    await unlink(filePath);
  } catch (error) {
    if (error instanceof TemplateError) throw error;

    throw new TemplateError(
      'Failed to delete template',
      'IO_ERROR',
      { id, scope, originalError: error }
    );
  }
}

export async function incrementUsageCount(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId?: string
): Promise<void> {
  const dir = getTemplatesDir(scope, workspaceId);
  const filePath = join(dir, `${id}.json`);

  // Use file locking to prevent race conditions when incrementing usage count
  let release: (() => Promise<void>) | null = null;
  try {
    // Acquire lock with retry
    release = await lockfile.lock(filePath, {
      stale: 5000,
      retries: { retries: 5, minTimeout: 50 }
    });

    const template = await getTemplate(id, scope, workspaceId);
    if (template) {
      template.usageCount = (template.usageCount || 0) + 1;
      template.updatedAt = new Date().toISOString();
      await writeFile(filePath, JSON.stringify(template, null, 2));
    }
  } catch (error) {
    // Don't throw on usage count increment failures - just log
    console.error(`[Templates] Failed to increment usage count for ${id}:`, error);
  } finally {
    if (release) {
      await release();
    }
  }
}
