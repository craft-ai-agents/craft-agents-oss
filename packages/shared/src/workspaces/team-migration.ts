import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  getTeamConfigFile,
  createDisabledTeamConfig,
  ensureMachineTeamMember,
  readOrCreateMachineIdentity,
  writeMachineHeartbeat,
  writeTeamConfigMirror,
} from './team-mode.ts';
import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
} from './storage.ts';
import { WORKSPACE_FORMAT_VERSION, type SharedFolderProvider, type WorkspaceConfig } from './types.ts';

export const TEAM_MIGRATIONS_DIR = 'team/migrations';

export type TeamMigrationStatus = 'in-progress' | 'complete' | 'failed';

export interface TeamMigrationReceipt {
  version: 1;
  migrationId: string;
  status: TeamMigrationStatus;
  sourceRootPath: string;
  destinationParentPath: string;
  finalRootPath: string;
  provider: SharedFolderProvider;
  providerLabel?: string;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
}

export interface TeamSharedFolderPreflightResult {
  ok: boolean;
  sourceRootPath: string;
  destinationParentPath: string;
  finalRootPath: string;
  blockedFiles: string[];
  warnings: string[];
  reason?: string;
}

export interface TeamSharedFolderMigrationResult {
  migrationId: string;
  originalRootPath: string;
  finalRootPath: string;
  receiptPath: string;
  teamConfigPath: string;
  tombstoneWritten?: boolean;
  tombstoneError?: string;
}

const BLOCKED_SECRET_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.credential-cache.json',
  'credentials.enc',
  'auth.json',
]);

const PRIVATE_WORKSPACE_DIRS = new Set([
  'sessions',
]);

function nowIso(): string {
  return new Date().toISOString();
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function assertNotMigratingFolder(rootPath: string): void {
  if (basename(rootPath).startsWith('.craft-migrating-')) {
    throw new Error('This workspace is still migrating. Wait for sync to finish, then open the final folder.');
  }
}

function getMigrationReceiptPath(rootPath: string, migrationId: string): string {
  return join(rootPath, TEAM_MIGRATIONS_DIR, `${migrationId}.json`);
}

function isSameOrInsidePath(parentPath: string, candidatePath: string): boolean {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);
  const pathBetween = relative(parent, candidate);
  return pathBetween === '' || (!pathBetween.startsWith('..') && !isAbsolute(pathBetween));
}

export function listTeamMigrationReceipts(rootPath: string): TeamMigrationReceipt[] {
  const dir = join(rootPath, TEAM_MIGRATIONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<TeamMigrationReceipt>(join(dir, name)))
    .filter((receipt): receipt is TeamMigrationReceipt => Boolean(receipt?.migrationId));
}

export function assertWorkspaceOpenable(rootPath: string): void {
  assertNotMigratingFolder(rootPath);
  const configPath = join(rootPath, 'config.json');
  if (!existsSync(configPath)) {
    throw new Error('Workspace is still syncing. config.json is not available yet.');
  }
  const config = loadWorkspaceConfig(rootPath);
  if (!config) {
    throw new Error('Workspace config could not be parsed.');
  }
  if (config.movedTo?.path) {
    throw new Error(`Workspace moved to ${config.movedTo.path}`);
  }
  const inProgress = listTeamMigrationReceipts(rootPath).find(receipt => receipt.status === 'in-progress');
  if (inProgress) {
    throw new Error('Workspace migration is still in progress.');
  }
}

function collectWorkspaceFiles(rootPath: string): string[] {
  const files: string[] = [];
  const visit = (relativeDir: string) => {
    const absoluteDir = join(rootPath, relativeDir);
    for (const entry of readdirSync(absoluteDir).sort((a, b) => a.localeCompare(b))) {
      if (entry === 'node_modules' || entry === '.git') continue;
      const relativePath = relativeDir ? join(relativeDir, entry) : entry;
      const absolutePath = join(rootPath, relativePath);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        visit(relativePath);
      } else if (stat.isFile()) {
        files.push(relativePath);
      }
    }
  };
  visit('');
  return files;
}

function findBlockedSecretFiles(rootPath: string): string[] {
  return collectWorkspaceFiles(rootPath).filter(relativePath => {
    const name = basename(relativePath);
    return BLOCKED_SECRET_BASENAMES.has(name) || name.startsWith('.env.');
  });
}

function shouldCopyWorkspaceFile(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => PRIVATE_WORKSPACE_DIRS.has(part))) return false;
  return !BLOCKED_SECRET_BASENAMES.has(basename(relativePath));
}

export function preflightSharedFolderMigration(
  sourceRootPath: string,
  destinationParentPath: string,
): TeamSharedFolderPreflightResult {
  const finalRootPath = join(destinationParentPath, basename(sourceRootPath));
  const warnings: string[] = [];

  try {
    assertWorkspaceOpenable(sourceRootPath);
    if (!existsSync(destinationParentPath) || !statSync(destinationParentPath).isDirectory()) {
      return { ok: false, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles: [], warnings, reason: 'Destination folder does not exist.' };
    }
    if (resolve(sourceRootPath) === resolve(finalRootPath)) {
      return { ok: false, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles: [], warnings, reason: 'Destination is already the current workspace folder.' };
    }
    if (isSameOrInsidePath(sourceRootPath, destinationParentPath)) {
      return { ok: false, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles: [], warnings, reason: 'Destination cannot be inside the workspace being moved.' };
    }
    if (existsSync(finalRootPath)) {
      return { ok: false, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles: [], warnings, reason: 'Destination already contains a workspace folder with this name.' };
    }
    const blockedFiles = findBlockedSecretFiles(sourceRootPath);
    if (blockedFiles.length > 0) {
      return { ok: false, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles, warnings, reason: 'Workspace contains files that should not be synced.' };
    }
    return { ok: true, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles, warnings };
  } catch (error) {
    return {
      ok: false,
      sourceRootPath,
      destinationParentPath,
      finalRootPath,
      blockedFiles: [],
      warnings,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function copyWorkspaceFilesConfigLast(sourceRootPath: string, tempRootPath: string): void {
  for (const relativePath of collectWorkspaceFiles(sourceRootPath)) {
    if (relativePath === 'config.json') continue;
    if (!shouldCopyWorkspaceFile(relativePath)) continue;
    const destPath = join(tempRootPath, relativePath);
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(join(sourceRootPath, relativePath), destPath);
  }
}

function writeMigratedWorkspaceConfig(
  sourceRootPath: string,
  tempRootPath: string,
  input: {
    provider: SharedFolderProvider;
    providerLabel?: string;
    makeRunner?: boolean;
  },
): void {
  const sourceConfig = loadWorkspaceConfig(sourceRootPath);
  if (!sourceConfig) throw new Error(`Failed to load workspace config: ${sourceRootPath}`);
  const timestamp = nowIso();
  const previousTeam = sourceConfig.team ?? createDisabledTeamConfig();
  const machine = readOrCreateMachineIdentity(sourceConfig.id);
  const automationsPolicy = input.makeRunner
    ? 'runner-only'
    : previousTeam.enabled
      ? previousTeam.automationsPolicy
      : 'manual-only';
  const backgroundTriggersEnabled = input.makeRunner
    ? true
    : previousTeam.enabled
      ? previousTeam.backgroundTriggersEnabled
      : false;
  let migratedConfig: WorkspaceConfig = {
    ...sourceConfig,
    formatVersion: WORKSPACE_FORMAT_VERSION,
    storage: {
      mode: 'shared-folder',
      portabilityVersion: 1,
      provider: input.provider,
      providerLabel: input.providerLabel,
      sharedRootId: sourceConfig.storage?.mode === 'shared-folder'
        ? sourceConfig.storage.sharedRootId
        : `shared_${randomUUID().slice(0, 8)}`,
      enabledAt: sourceConfig.storage?.mode === 'shared-folder'
        ? sourceConfig.storage.enabledAt
        : timestamp,
      movedFrom: sourceRootPath,
      vaultPolicy: 'copy-into-workspace',
      pathPolicy: 'relative-required',
    },
    team: {
      ...previousTeam,
      enabled: true,
      revision: previousTeam.revision + 1,
      runnerMachineId: input.makeRunner ? machine.machineId : previousTeam.runnerMachineId,
      automationsPolicy,
      backgroundTriggersEnabled,
      updatedAt: timestamp,
    },
  };
  migratedConfig = ensureMachineTeamMember(tempRootPath, migratedConfig, machine, 'owner').config;
  saveWorkspaceConfig(tempRootPath, migratedConfig);
  writeTeamConfigMirror(tempRootPath, migratedConfig);
  writeMachineHeartbeat(tempRootPath, migratedConfig, machine);
}

export function moveWorkspaceToSharedFolder(
  sourceRootPath: string,
  destinationParentPath: string,
  input: {
    provider?: SharedFolderProvider;
    providerLabel?: string;
    makeRunner?: boolean;
  } = {},
): TeamSharedFolderMigrationResult {
  const preflight = preflightSharedFolderMigration(sourceRootPath, destinationParentPath);
  if (!preflight.ok) {
    throw new Error(preflight.reason ?? 'Shared folder migration preflight failed.');
  }

  const provider = input.provider ?? 'generic-folder';
  const migrationId = `mig_${randomUUID().slice(0, 12)}`;
  const tempRootPath = join(destinationParentPath, `.craft-migrating-${migrationId}`);
  const startedAt = nowIso();
  const receiptPath = getMigrationReceiptPath(tempRootPath, migrationId);
  const receipt: TeamMigrationReceipt = {
    version: 1,
    migrationId,
    status: 'in-progress',
    sourceRootPath,
    destinationParentPath,
    finalRootPath: preflight.finalRootPath,
    provider,
    providerLabel: input.providerLabel,
    startedAt,
  };

  try {
    mkdirSync(tempRootPath, { recursive: true });
    writeJson(receiptPath, receipt);
    copyWorkspaceFilesConfigLast(sourceRootPath, tempRootPath);

    writeMigratedWorkspaceConfig(sourceRootPath, tempRootPath, {
      provider,
      providerLabel: input.providerLabel,
      makeRunner: input.makeRunner,
    });

    const completeReceipt: TeamMigrationReceipt = {
      ...receipt,
      status: 'complete',
      completedAt: nowIso(),
    };
    writeJson(receiptPath, completeReceipt);
    renameSync(tempRootPath, preflight.finalRootPath);

    return {
      migrationId,
      originalRootPath: sourceRootPath,
      finalRootPath: preflight.finalRootPath,
      receiptPath: getMigrationReceiptPath(preflight.finalRootPath, migrationId),
      teamConfigPath: getTeamConfigFile(preflight.finalRootPath),
    };
  } catch (error) {
    try {
      if (existsSync(tempRootPath)) {
        writeJson(receiptPath, {
          ...receipt,
          status: 'failed',
          failedAt: nowIso(),
          error: error instanceof Error ? error.message : String(error),
        } satisfies TeamMigrationReceipt);
        rmSync(tempRootPath, { recursive: true, force: true });
      }
    } catch {
      // Original workspace remains authoritative when rollback cleanup fails.
    }
    throw error;
  }
}

export function writeMovedToTombstone(
  originalRootPath: string,
  movedToPath: string,
  migrationId: string,
): WorkspaceConfig {
  const config = loadWorkspaceConfig(originalRootPath);
  if (!config) throw new Error(`Failed to load original workspace config: ${originalRootPath}`);
  const tombstone: WorkspaceConfig = {
    ...config,
    movedTo: {
      path: movedToPath,
      migrationId,
      movedAt: nowIso(),
    },
  };
  saveWorkspaceConfig(originalRootPath, tombstone, { allowMovedTombstoneWrite: true });
  return tombstone;
}

export { getMigrationReceiptPath };
