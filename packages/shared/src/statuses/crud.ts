/**
 * Status CRUD Operations
 *
 * Create, Read, Update, Delete operations for status configurations.
 * Enforces business rules (fixed statuses, default statuses, uniqueness).
 *
 * All functions accept an IStatusStorage interface, making them work
 * with both local filesystem and cloud (WebSocket → Durable Object) storage.
 */

import type { IStatusStorage, ISessionStorage } from '../storage/types.ts';
import type { StatusConfig, CreateStatusInput, UpdateStatusInput } from './types.ts';

/**
 * Generate URL-safe slug from label
 */
function generateStatusSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

/**
 * Create a new custom status
 * @throws Error if ID conflicts or validation fails
 */
export async function createStatus(
  storage: IStatusStorage,
  input: CreateStatusInput
): Promise<StatusConfig> {
  const config = await storage.loadStatusConfig();

  // Generate unique ID
  let id = generateStatusSlug(input.label);
  let suffix = 2;
  while (config.statuses.some(s => s.id === id)) {
    id = `${generateStatusSlug(input.label)}-${suffix}`;
    suffix++;
  }

  const maxOrder = Math.max(...config.statuses.map(s => s.order), -1);

  const status: StatusConfig = {
    id,
    label: input.label,
    color: input.color,
    icon: input.icon,
    category: input.category,
    isFixed: false,
    isDefault: false,
    order: maxOrder + 1,
  };

  config.statuses.push(status);
  await storage.saveStatusConfig(config);

  return status;
}

/**
 * Update a status (label, color, icon, category)
 * Cannot change ID or isFixed/isDefault flags
 * @throws Error if status is fixed and trying to change protected fields
 */
export async function updateStatus(
  storage: IStatusStorage,
  statusId: string,
  updates: UpdateStatusInput
): Promise<StatusConfig> {
  const config = await storage.loadStatusConfig();
  const status = config.statuses.find(s => s.id === statusId);

  if (!status) {
    throw new Error(`Status '${statusId}' not found`);
  }

  // Fixed statuses cannot change category
  if (status.isFixed && updates.category && updates.category !== status.category) {
    throw new Error('Cannot change category of fixed status');
  }

  // Apply updates
  if (updates.label !== undefined) status.label = updates.label;
  if (updates.color !== undefined) status.color = updates.color;
  if (updates.icon !== undefined) status.icon = updates.icon;
  if (updates.category !== undefined) status.category = updates.category;

  await storage.saveStatusConfig(config);
  return status;
}

/**
 * Delete a status
 * @throws Error if status is fixed or default
 * @returns Number of sessions that were auto-migrated to 'todo'
 */
export async function deleteStatus(
  storage: IStatusStorage,
  sessionStorage: ISessionStorage,
  statusId: string
): Promise<{ migrated: number }> {
  const config = await storage.loadStatusConfig();
  const status = config.statuses.find(s => s.id === statusId);

  if (!status) {
    throw new Error(`Status '${statusId}' not found`);
  }

  if (status.isFixed) {
    throw new Error(`Cannot delete fixed status '${statusId}'`);
  }

  if (status.isDefault) {
    throw new Error(`Cannot delete default status '${statusId}'. Modify it instead.`);
  }

  // Remove from config
  config.statuses = config.statuses.filter(s => s.id !== statusId);
  await storage.saveStatusConfig(config);

  // Migrate sessions using this status to 'todo'
  const migrated = await migrateSessionsFromDeletedStatus(sessionStorage, statusId);

  return { migrated };
}

/**
 * Reorder statuses
 */
export async function reorderStatuses(
  storage: IStatusStorage,
  orderedIds: string[]
): Promise<void> {
  const config = await storage.loadStatusConfig();

  // Validate all IDs exist
  const validIds = new Set(config.statuses.map(s => s.id));
  for (const id of orderedIds) {
    if (!validIds.has(id)) {
      throw new Error(`Invalid status ID: ${id}`);
    }
  }

  // Update order based on array position
  for (let i = 0; i < orderedIds.length; i++) {
    const status = config.statuses.find(s => s.id === orderedIds[i]);
    if (status) {
      status.order = i;
    }
  }

  await storage.saveStatusConfig(config);
}

/**
 * Reset to default configuration
 * WARNING: Deletes all custom statuses
 */
export async function resetToDefaults(
  storage: IStatusStorage,
  sessionStorage: ISessionStorage
): Promise<void> {
  const { getDefaultStatusConfig } = await import('./storage.ts');
  const config = getDefaultStatusConfig();
  await storage.saveStatusConfig(config);

  // Migrate any sessions with now-invalid statuses
  const validIds = new Set(config.statuses.map((s: StatusConfig) => s.id));
  const sessions = await sessionStorage.listSessions();

  for (const session of sessions) {
    if (session.todoState && !validIds.has(session.todoState)) {
      await sessionStorage.updateSessionMetadata(session.id, { todoState: 'todo' });
    }
  }
}

/**
 * Migrate sessions from a deleted status to 'todo'
 * Called internally by deleteStatus()
 */
async function migrateSessionsFromDeletedStatus(
  sessionStorage: ISessionStorage,
  deletedStatusId: string
): Promise<number> {
  const sessions = await sessionStorage.listSessions();
  let migratedCount = 0;

  for (const session of sessions) {
    if (session.todoState === deletedStatusId) {
      await sessionStorage.updateSessionMetadata(session.id, { todoState: 'todo' });
      migratedCount++;
    }
  }

  return migratedCount;
}
