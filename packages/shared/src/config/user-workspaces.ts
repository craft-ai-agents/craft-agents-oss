import { existsSync, mkdirSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { join } from 'path';
import { CONFIG_DIR } from './paths.ts';
import { addWorkspace, getActiveWorkspace, getWorkspaces } from './storage.ts';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';
import {
  createWorkspaceAtPath,
  isValidWorkspace,
  loadWorkspaceConfig,
  saveWorkspaceConfig,
} from '../workspaces/storage.ts';
import type { Workspace } from '@craft-agent/core/types';

type UserWorkspaceRegistry = Record<string, string>;

const USER_WORKSPACES_REGISTRY_FILE = join(CONFIG_DIR, 'user-workspaces.json');
const USER_WORKSPACES_DIR = join(CONFIG_DIR, 'user-workspaces');

export interface RegisteredUserWorkspaceOwner {
  openId: string;
  workspaceId: string;
}

const userWorkspaceLocks = new Map<string, Promise<string>>();

function loadUserWorkspaceRegistry(): UserWorkspaceRegistry {
  if (!existsSync(USER_WORKSPACES_REGISTRY_FILE)) return {};

  try {
    const raw = readJsonFileSync<Record<string, unknown>>(USER_WORKSPACES_REGISTRY_FILE);
    const registry: UserWorkspaceRegistry = {};
    for (const [openId, workspaceId] of Object.entries(raw)) {
      if (typeof openId === 'string' && typeof workspaceId === 'string' && openId && workspaceId) {
        registry[openId] = workspaceId;
      }
    }
    return registry;
  } catch {
    return {};
  }
}

function saveUserWorkspaceRegistry(registry: UserWorkspaceRegistry): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  atomicWriteFileSync(USER_WORKSPACES_REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

function getSharedWorkingDirectory(): string | undefined {
  const configuredDefault = process.env.CRAFT_DEFAULT_WORKSPACE_PATH?.trim();
  if (configuredDefault) return configuredDefault;

  const activeWorkspace = getActiveWorkspace();
  if (!activeWorkspace) return undefined;

  const workspaceConfig = loadWorkspaceConfig(activeWorkspace.rootPath);
  return workspaceConfig?.defaults?.workingDirectory || activeWorkspace.rootPath;
}

function getWorkspaceById(workspaceId: string): Workspace | null {
  return getWorkspaces().find((workspace) => workspace.id === workspaceId) ?? null;
}

function getUserWorkspaceRootPath(openId: string): string {
  const sanitized = openId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

  const suffix = createHash('sha256').update(openId).digest('hex').slice(0, 12);
  const folder = sanitized ? `${sanitized}-${suffix}` : `user-${randomUUID()}`;
  return join(USER_WORKSPACES_DIR, folder);
}

function ensureWorkspaceDefaults(rootPath: string, workingDirectory: string | undefined): void {
  if (!workingDirectory) return;

  const config = loadWorkspaceConfig(rootPath);
  if (!config) return;

  if (config.defaults?.workingDirectory === workingDirectory) return;

  config.defaults = {
    ...(config.defaults ?? {}),
    workingDirectory,
  };
  saveWorkspaceConfig(rootPath, config);
}

async function resolveUserWorkspaceIdUnlocked(openId: string): Promise<string> {
  const registry = loadUserWorkspaceRegistry();
  const existingWorkspaceId = registry[openId];
  if (existingWorkspaceId) {
    const existingWorkspace = getWorkspaceById(existingWorkspaceId);
    if (existingWorkspace) return existingWorkspace.id;
    delete registry[openId];
  }

  const workingDirectory = getSharedWorkingDirectory();
  const rootPath = getUserWorkspaceRootPath(openId);
  const workspaceName = `Feishu ${openId.slice(0, 12)}`;

  if (!isValidWorkspace(rootPath)) {
    createWorkspaceAtPath(rootPath, workspaceName, {
      workingDirectory,
    });
  } else {
    ensureWorkspaceDefaults(rootPath, workingDirectory);
  }

  const workspace = addWorkspace({ name: workspaceName, rootPath });
  ensureWorkspaceDefaults(workspace.rootPath, workingDirectory);

  registry[openId] = workspace.id;
  saveUserWorkspaceRegistry(registry);
  return workspace.id;
}

export async function resolveUserWorkspaceId(openId: string): Promise<string> {
  const normalizedOpenId = openId.trim();
  if (!normalizedOpenId) {
    throw new Error('Feishu open_id is required');
  }

  const existingLock = userWorkspaceLocks.get(normalizedOpenId);
  if (existingLock) return existingLock;

  const lock = resolveUserWorkspaceIdUnlocked(normalizedOpenId)
    .finally(() => {
      userWorkspaceLocks.delete(normalizedOpenId);
    });
  userWorkspaceLocks.set(normalizedOpenId, lock);
  return lock;
}

export function getRegisteredUserWorkspaceId(openId: string): string | null {
  const workspaceId = loadUserWorkspaceRegistry()[openId.trim()];
  return workspaceId && getWorkspaceById(workspaceId) ? workspaceId : null;
}

export function getRegisteredUserWorkspaceOwnerByWorkspaceId(workspaceId: string): RegisteredUserWorkspaceOwner | null {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) return null;

  const registry = loadUserWorkspaceRegistry();
  for (const [openId, registeredWorkspaceId] of Object.entries(registry)) {
    if (registeredWorkspaceId !== normalizedWorkspaceId) continue;
    if (!getWorkspaceById(registeredWorkspaceId)) return null;
    return {
      openId,
      workspaceId: registeredWorkspaceId,
    };
  }
  return null;
}
